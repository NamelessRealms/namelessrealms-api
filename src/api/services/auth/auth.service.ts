/**
 * @file auth.service.ts
 * @description 認證核心邏輯，包含密碼驗證（支援 MD5 → Argon2 Lazy Migration）、JWT 簽發、用戶註冊與 Refresh Token 流程
 * @methods
 *   - verify: OAuth2 密碼授權驗證並回傳 Access / Refresh Token
 *   - hashPassword: Argon2 密碼雜湊
 *   - generateAndSaveCode: 產生並發送信箱驗證碼
 *   - registerUser: 驗證碼驗證後建立新用戶帳號
 *   - refreshAccessToken: 以 Refresh Token 換取新的 Access Token
 * @dependencies crypto, jsonwebtoken, argon2, mysql, MailService, AppError
 * @notes Lazy Migration：舊 MD5 密碼在首次登入成功後自動升級為 Argon2
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
   * OAuth2 密碼授權驗證，支援 MD5 → Argon2 Lazy Migration，成功後回傳 Access / Refresh Token
   *
   * @param verifyData - 包含 grant_type、username、password 的授權資料
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

    // 1. 先根據使用者名稱搜尋使用者 (不再直接在 SQL 比對密碼，為了實作 Lazy Migration)
    const results = await Mysql.getPool().query(
      "SELECT * FROM users WHERE username = ?",
      [verifyData.username],
    );
    const users = results[0] as Array<IUser>;

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
    const payload = {
      sub: user.unique,
      username: user.username,
      iss: "NR System API",
      role: user.roles
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
      role: user.roles as unknown as string[],
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
   * 註冊新使用者
   * @param data 註冊資訊
   * @param code 驗證碼
   */
  public async registerUser(data: RegisterDTO, code: string): Promise<{
    accessToken: string,
    refreshToken: string
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
    const roles = JSON.stringify(["user"]); // 預設權限

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
      role: roles
    };

    // Access Token: 短效 (15分鐘)
    const accessToken = jwt.sign(payload, config.jwt.secret, {
      algorithm: "HS256",
      expiresIn: "15m",
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
      refreshToken
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

    const results = await Mysql.getPool().query(
      "SELECT * FROM users WHERE `unique` = ?",
      [decoded.sub],
    );
    const users = results[0] as Array<IUser>;

    if (users.length === 0) {
      throw new AppError("用戶不存在。", 401, "Unauthorized");
    }

    const user = users[0];
    const payload = {
      sub: user.unique,
      username: user.username,
      iss: "NR System API",
      role: user.roles,
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
      role: user.roles as unknown as string[],
    };
  }
}
