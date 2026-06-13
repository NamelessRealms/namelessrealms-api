/**
 * @file auth.ts
 * @description 測試用 JWT 簽發工具，以測試環境的 JWT_SECRET 產生受保護端點所需的 Bearer token
 * @methods signTestToken - 簽發一個合法的測試 JWT
 * @notes secret 取自 config.service，與 vitest.config.ts 注入的 JWT_SECRET 一致
 */
import * as jwt from "jsonwebtoken";
import { config } from "../../src/config/config.service";

/** 簽發測試 JWT 時可覆寫的欄位。 */
interface TestTokenOptions {
  _id?: string;
  role?: string;
  expiresIn?: number;
}

/**
 * 以測試 secret 簽發一個合法的 Bearer JWT。
 *
 * 預設帶 admin 角色與 1 小時效期，可透過 options 覆寫以測試不同權限或過期情境。
 */
export function signTestToken(options: TestTokenOptions = {}): string {
  const { _id = "test-user", role = "admin", expiresIn = 3600 } = options;
  return jwt.sign({ _id, role }, config.jwt.secret, { expiresIn });
}
