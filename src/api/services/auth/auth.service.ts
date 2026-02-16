import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
const argon2 = require("argon2");

import Mysql from "../../utils/mysql";

import { IUser } from "../../../interface/auth/IUser";
import { environment } from "../../../environment/environment";
import Logs from "../../utils/logs";
import { config } from "../../../config/config.service";

export default class AuthService {
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
}
