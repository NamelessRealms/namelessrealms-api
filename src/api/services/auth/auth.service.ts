import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import uniqid from "uniqid";
const argon2 = require("argon2");

import Mysql from "../../utils/mysql";

import { IUser } from "../../../interface/auth/IUser";
import { RegisterDTO } from "../../../interface/auth/RegisterDTO";
import { environment } from "../../../environment/environment";
import Logs from "../../utils/logs";
import { config } from "../../../config/config.service";
import MailService from "../mail.service";
import { AppError } from "../../utils/response/AppError";

export default class AuthService {
  private _mailService = new MailService();
  /**
   *
   *
   * @param {*} verifyData
   * @return {*}  {Promise<{ tokenCode: string, username: string, role: string[] }>}
   * @memberof AuthService
   */
  public async verify(
    verifyData: any,
  ): Promise<{ tokenCode: string; username: string; role: string[] }> {
    // 驗證 OAuth 2.0 授權類型
    if (!verifyData.grant_type || verifyData.grant_type !== "password") {
      throw {
        error: "unsupported_response_type",
        error_description:
          "授權伺服器不支援要求中的回應類型，本伺服器僅支持 Password 類型。",
      };
    }

    // 1. 先根據使用者名稱搜尋使用者 (不再直接在 SQL 比對密碼，為了實作 Lazy Migration)
    const results = await Mysql.getPool().query(
      "SELECT * FROM users WHERE username = ?",
      [verifyData.username],
    );
    const users = results[0] as Array<IUser>;

    if (users.length === 0) {
      throw {
        error: "invalid_client",
        error_description: "用戶端驗證失敗。",
      };
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
      throw {
        error: "invalid_client",
        error_description: "用戶端驗證失敗。",
      };
    }

    // 3. Lazy Migration: 如果密碼正確且是舊格式，則升級為 Argon2
    if (needsUpgrade) {
      try {
        const newArgon2Hash = await argon2.hash(plainPassword);
        await Mysql.getPool().query(
          "UPDATE users SET password = ? WHERE `unique` = ?",
          [newArgon2Hash, user.unique],
        );
        Logs.info(
          `User [${user.username}] password has been migrated to Argon2.`,
        );
      } catch (upgradeError) {
        // 升級失敗僅記錄日誌，不影響本次登入
        Logs.error(
          `Lazy migration failed for user [${user.username}]: ${upgradeError}`,
        );
      }
    }

    // 4. 產生 OAuth 2.0 和 JWT 的 JSON 格式令牌訊息
    const payload = {
      _id: user.unique,
      iss: user.username,
      sub: "Mkl System Web API",
      role: user.roles,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      algorithm: "HS256",
      expiresIn: `${environment.jwt.increaseTime}ms`,
    });

    return {
      tokenCode: token,
      username: user.username,
      role: user.roles as unknown as string[], // 修正型別問題
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
    const code = Math.floor(100000 + Math.random() * 900000).toString();
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
  public async registerUser(
    data: RegisterDTO,
    code: string,
  ): Promise<void> {
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

    // 3. 寫入資料庫
    const newUser = {
      unique: uniqid(),
      username: data.username,
      email: data.email,
      password: hashedPassword,
      roles: JSON.stringify(["user"]), // 預設權限
    };

    await Mysql.getPool().query("INSERT INTO users SET ?", [newUser]);

    // 4. 刪除已使用的驗證碼
    await Mysql.getPool().query(
      "DELETE FROM verification_codes WHERE email = ?",
      [data.email],
    );
  }
}
