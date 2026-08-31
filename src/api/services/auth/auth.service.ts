/**
 * @file auth.service.ts
 * @description 認證核心邏輯，包含密碼驗證（支援 MD5 → Argon2 Lazy Migration）、JWT 簽發、用戶註冊與 Refresh Token 流程
 * @methods
 *   - verify: OAuth2 密碼授權驗證並回傳 Access / Refresh Token
 *   - hashPassword: Argon2 密碼雜湊
 *   - generateAndSaveCode: 產生並發送信箱驗證碼
 *   - registerUser: 驗證碼驗證後建立新用戶帳號
 *   - refreshAccessToken: 以 Refresh Token 換取新的 Access Token
 *   - revokeRefreshToken: 將 Refresh Token 加入撤銷清單（登出）
 * @dependencies crypto, jsonwebtoken, argon2, mysql, MailService, AppError
 * @notes Lazy Migration：舊 MD5 密碼在首次登入成功後自動升級為 Argon2
 *        撤銷清單以 token 的 SHA-256 為鍵（per-device），refreshAccessToken 的檢查為 fail-closed
 */
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import uniqid from "uniqid";
const argon2 = require("argon2");

import Mysql from "../../utils/mysql";

import { IUser } from "../../../interface/auth/IUser";
import { RegisterDTO } from "../../../interface/auth/RegisterDTO";
import { environment } from "../../../environment/environment";
import logger from "../../utils/logger";
import { config } from "../../../config/config.service";
import MailService from "../mail.service";
import { AppError } from "../../utils/response/AppError";

export default class AuthService {
  private _mailService = new MailService();
  /**
   * 將 DB 的 `users.roles` 值正規化為字串陣列
   *
   * `users.roles` 宣告為 JSON（mysql2 會自動 parse 成陣列），但歷史遷移可能留下 varchar 存的
   * JSON 字串或裸字串，舊列也可能為 NULL。三態一律收斂成字串陣列，避免 JWT payload 的 `role`
   * 型別在不同簽發路徑之間漂移。
   *
   * @param dbValue - `users.roles` 的原始值（陣列 / JSON 字串 / 裸字串 / NULL）
   * @returns 角色字串陣列；無法解讀或無角色時回 `[]`（⛔ 不回 `[""]` 這種假角色）
   */
  private static normalizeRoles(dbValue: unknown): string[] {
    if (Array.isArray(dbValue)) {
      return dbValue as string[];
    }

    if (typeof dbValue === "string") {
      const trimmed = dbValue.trim();
      if (trimmed === "") {
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? (parsed as string[]) : [trimmed];
      } catch {
        // 非 JSON 的裸字串（例：'user'）視為單一角色
        return [trimmed];
      }
    }

    // NULL / undefined / 其他型別：寧可無角色也不要偽角色
    return [];
  }

  /**
   * OAuth2 密碼授權驗證，支援 MD5 → Argon2 Lazy Migration，成功後回傳 Access / Refresh Token
   *
   * 身分查找為兩段式：先以 Email 精確比對，查無再比使用者名稱。
   *
   * @param verifyData - 包含 grant_type、username、password 的授權資料。
   *                     ⚠️ `username` 欄位名沿用 OAuth2 password grant 的既定名稱，
   *                     但語意為「Email 或使用者名稱」（Email 優先）
   * @returns Access Token、Refresh Token、使用者名稱與角色列表
   * @throws AppError 若授權類型不符、帳號不存在或密碼錯誤
   */
  public async verify(
    verifyData: any,
  ): Promise<{ tokenCode: string; refreshToken: string; username: string; role: string[] }> {
    // 驗證 OAuth 2.0 授權類型
    if (!verifyData.grant_type || verifyData.grant_type !== "password") {
      throw new AppError(
        "登入方式不支援，請重新操作。",
        400,
        "InvalidRequest",
      );
    }

    // 1. 兩段式身分查找：Email 精確比對優先，查無再比使用者名稱
    //    (不在 SQL 比對密碼，為了實作 Lazy Migration)
    //    ⛔ 不得改回 `WHERE email = ? OR username = ?` 單查：username 與 email 各自 UNIQUE 但跨欄位不互斥，
    //       單查的結果會依列序而非語意決定身分。
    const emailResults = await Mysql.getPool().query(
      "SELECT * FROM users WHERE email = ?",
      [verifyData.username],
    );
    let users = emailResults[0] as Array<IUser>;

    // ⛔ Email 段命中即定案，不 fall through 到 username 段（即使密碼不符）：
    //    fall through 會讓最終身分由「哪個帳號的密碼恰好對得上」決定（正是上面要避免的巧合決定身分），
    //    且單次請求的密碼比對次數加倍，使 loginLimiter 的實際保護強度減半。
    if (users.length === 0) {
      const usernameResults = await Mysql.getPool().query(
        "SELECT * FROM users WHERE username = ?",
        [verifyData.username],
      );
      users = usernameResults[0] as Array<IUser>;
    }

    if (users.length === 0) {
      throw new AppError(
        "帳號或密碼錯誤。",
        401,
        "InvalidCredentials",
      );
    }

    const user = users[0];
    const storedPassword = user.password;
    const plainPassword = verifyData.password;
    let isPasswordMatch = false;
    let needsUpgrade = false;

    // 2. 判斷密碼格式並驗證
    // Argon2 特徵：通常以 $argon2... 開頭
    if (storedPassword.startsWith("$argon2")) {
      isPasswordMatch = await argon2.verify(storedPassword, plainPassword);
    } else {
      // 判定為舊 MD5 格式 (32位元 hex)
      const md5Hash = crypto
        .createHash("md5")
        .update(plainPassword + config.jwt.salt)
        .digest("hex");
      isPasswordMatch = storedPassword === md5Hash;

      if (isPasswordMatch) {
        needsUpgrade = true;
      }
    }

    if (!isPasswordMatch) {
      throw new AppError(
        "帳號或密碼錯誤。",
        401,
        "InvalidCredentials",
      );
    }

    // 3. Lazy Migration: 如果密碼正確且是舊格式，則升級為 Argon2
    if (needsUpgrade) {
      try {
        const newArgon2Hash = await argon2.hash(plainPassword);
        await Mysql.getPool().query(
          "UPDATE users SET password = ? WHERE `unique` = ?",
          [newArgon2Hash, user.unique],
        );
        logger.info(
          `User [${user.username}] password has been migrated to Argon2.`,
        );
      } catch (upgradeError) {
        // 升級失敗僅記錄日誌，不影響本次登入
        logger.error(
          `Lazy migration failed for user [${user.username}]: ${upgradeError}`,
        );
      }
    }

    // 4. 產生 OAuth 2.0 和 JWT 的 JSON 格式令牌訊息
    const role = AuthService.normalizeRoles(user.roles);
    const payload = {
      sub: user.unique,
      username: user.username,
      iss: "NR System API",
      role
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      algorithm: "HS256",
      expiresIn: `${environment.jwt.increaseTime}ms`,
    });

    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
      algorithm: "HS256",
      expiresIn: "7d",
    });

    return {
      tokenCode: token,
      refreshToken,
      username: user.username,
      role,
    };
  }

  /**
   * 加密密碼 (用於新註冊或手動更新)
   * @param password 明文密碼
   */
  public async hashPassword(password: string): Promise<string> {
    return await argon2.hash(password);
  }

  /**
   * 生成並發送驗證碼
   * @param email 收件者信箱
   */
  public async generateAndSaveCode(email: string): Promise<void> {
    // 1. 生成 6 位數驗證碼
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後過期

    // 2. 存入資料庫 (假設表名為 verification_codes)
    // 如果資料表不存在，請執行以下 SQL:
    // CREATE TABLE verification_codes (email VARCHAR(255), code VARCHAR(6), expires_at DATETIME, PRIMARY KEY (email));
    await Mysql.getPool().query(
      "INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE code = ?, expires_at = ?",
      [email, code, expiresAt, code, expiresAt],
    );

    // 3. 發送郵件
    await this._mailService.sendVerificationCode(email, code);
  }

  /**
   * 註冊新使用者，成功後回傳與登入路徑同形狀的 Token 與身分資訊
   *
   * @param data 註冊資訊
   * @param code 驗證碼
   * @returns Access Token、Refresh Token、使用者名稱與角色列表（與 `verify()` 對稱）
   * @throws AppError 若驗證碼不正確／已過期，或使用者名稱／Email 已被註冊
   */
  public async registerUser(data: RegisterDTO, code: string): Promise<{
    accessToken: string,
    refreshToken: string,
    username: string,
    role: string[]
  }> {
    // 0. 驗證驗證碼
    const codeResults = await Mysql.getPool().query(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND expires_at > NOW()",
      [data.email, code],
    );
    const validCodes = codeResults[0] as Array<any>;

    if (validCodes.length === 0) {
      throw new AppError(
        "驗證碼不正確或已過期。",
        400,
        "InvalidVerificationCode",
      );
    }

    // 1. 檢查使用者是否已存在 (username 或 email)
    // 註：如果資料庫目前沒有 email 欄位，這裡會報錯，請根據實際情況調整 SQL
    const checkResults = await Mysql.getPool().query(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [data.username, data.email],
    );
    const existingUsers = checkResults[0] as Array<IUser>;

    if (existingUsers.length > 0) {
      throw new AppError(
        "該使用者名稱或 Email 已被註冊。",
        409,
        "Conflict",
      );
    }

    // 2. 密碼雜湊處理
    const hashedPassword = await this.hashPassword(data.password);

    const id = uniqid();
    // 預設權限。⚠️ DB 欄位維持寫入 JSON 字串（⛔ 不改既有資料形狀）；
    //    JWT payload 與回應一律用字串陣列，與 verify() / refreshAccessToken() 同型別。
    const role = ["user"];
    const roles = JSON.stringify(role);

    // 3. 寫入資料庫
    const newUser = {
      unique: id,
      username: data.username,
      email: data.email,
      password: hashedPassword,
      roles
    };

    await Mysql.getPool().query("INSERT INTO users SET ?", [newUser]);

    const payload = {
      sub: id,
      username: data.username,
      iss: "NR System API",
      role
    };

    // Access Token: 短效。效期與 verify() / refreshAccessToken() 同源，⛔ 不硬寫字面值
    const accessToken = jwt.sign(payload, config.jwt.secret, {
      algorithm: "HS256",
      expiresIn: `${environment.jwt.increaseTime}ms`,
    });

    // Refresh Token: 長效 (7天)
    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
      algorithm: "HS256",
      expiresIn: "7d"
    });

    // 4. 刪除已使用的驗證碼
    await Mysql.getPool().query(
      "DELETE FROM verification_codes WHERE email = ?",
      [data.email],
    );

    return {
      accessToken,
      refreshToken,
      username: data.username,
      role
    }
  }

  /**
   * 以 Refresh Token 換取新的 Access Token 與 Refresh Token
   *
   * @param refreshToken - 有效的 Refresh Token
   * @returns 新的 Access Token、Refresh Token、使用者名稱與角色
   * @throws AppError 若 Refresh Token 無效、過期或對應用戶不存在
   */
  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    username: string;
    role: string[];
  }> {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
    }

    await this.assertNotRevoked(refreshToken);

    const results = await Mysql.getPool().query(
      "SELECT * FROM users WHERE `unique` = ?",
      [decoded.sub],
    );
    const users = results[0] as Array<IUser>;

    if (users.length === 0) {
      throw new AppError("用戶不存在。", 401, "Unauthorized");
    }

    const user = users[0];
    const role = AuthService.normalizeRoles(user.roles);
    const payload = {
      sub: user.unique,
      username: user.username,
      iss: "NR System API",
      role,
    };

    const newAccessToken = jwt.sign(payload, config.jwt.secret, {
      algorithm: "HS256",
      expiresIn: `${environment.jwt.increaseTime}ms`,
    });

    const newRefreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
      algorithm: "HS256",
      expiresIn: "7d",
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      username: user.username,
      role,
    };
  }

  /**
   * 將 Refresh Token 加入撤銷清單，使其無法再換發 Access Token（登出）
   *
   * 以 token 的 SHA-256 為鍵，故撤銷只影響這一台裝置，不影響同帳號的其他裝置。
   * 重複撤銷同一 token 不報錯（`ON DUPLICATE KEY UPDATE`），並順手清掉已過期的列。
   *
   * @param refreshToken - 要撤銷的 Refresh Token
   * @throws AppError 若 Refresh Token 無效、已過期或不帶 `exp`
   */
  public async revokeRefreshToken(refreshToken: string): Promise<void> {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
    }

    // 無 exp 的 token 沒有清理上界，寫進去會讓撤銷表無上限成長。簽發端一律帶 expiresIn，故此路徑理論上不會發生。
    if (typeof decoded.exp !== "number") {
      throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
    }

    const tokenHash = AuthService.hashRefreshToken(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);

    await Mysql.getPool().query(
      "INSERT INTO revoked_refresh_tokens (token_hash, expires_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)",
      [tokenHash, expiresAt],
    );

    // 順手清理已過期的列：token 過期後本來就換不了發，留著只是佔空間。⛔ 不另設排程。
    await Mysql.getPool().query(
      "DELETE FROM revoked_refresh_tokens WHERE expires_at < NOW()",
    );
  }

  /**
   * 確認 Refresh Token 未被撤銷，命中撤銷清單則拋出 401
   *
   * ⚠️ fail-closed：查詢本身失敗（表不存在、DB 異常）一律視為「無法確認未被撤銷」而拒絕，
   * ⛔ 不得放行——fail-open 會製造「DB 異常時撤銷失效」的安全洞。
   *
   * @param refreshToken - 待檢查的 Refresh Token
   * @throws AppError 401 若命中撤銷清單或查詢失敗
   */
  private async assertNotRevoked(refreshToken: string): Promise<void> {
    let revoked: Array<any>;
    try {
      const results = await Mysql.getPool().query(
        "SELECT token_hash FROM revoked_refresh_tokens WHERE token_hash = ?",
        [AuthService.hashRefreshToken(refreshToken)],
      );
      revoked = results[0] as Array<any>;
    } catch (error) {
      logger.error(`Refresh token revocation check failed: ${error}`);
      throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
    }

    // ⛔ 此判斷刻意留在 try 之外：包進去會讓這裡丟的 401 被自己的 catch 吞掉再重丟。
    if (revoked.length > 0) {
      // 訊息與 jwt.verify 失敗一致，⛔ 不對外洩漏「這個 token 曾被撤銷」。
      throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
    }
  }

  /** 撤銷清單的鍵：refresh token 原字串的 SHA-256 十六進位小寫 */
  private static hashRefreshToken(refreshToken: string): string {
    return crypto.createHash("sha256").update(refreshToken).digest("hex");
  }
}
