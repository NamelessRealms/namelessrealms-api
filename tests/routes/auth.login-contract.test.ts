/**
 * @file auth.login-contract.test.ts
 * @description fix-login-contract 的後端契約測試：登入身分兩段式查找（Email 優先）、
 *              註冊/登入 token 效期同源、註冊回應與登入對稱、JWT payload `role` 型別統一
 * @notes 沿 auth.logout.test.ts 慣例以 vi.mock 攔截 Mysql 連線池（⛔ 不連真實 DB）；
 *        `expires_in` 的語意為「絕對 epoch 毫秒」（非 OAuth2 剩餘秒數），D2/D3 兩條把它釘住
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import request from "supertest";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
const argon2 = require("argon2");

import { config } from "../../src/config/config.service";
import { environment } from "../../src/environment/environment";

const poolQuery = vi.fn();
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: poolQuery })) },
}));

import { createTestApp } from "../helpers/testApp";
import AuthRoutes from "../../src/api/routes/auth.routes";
import { loginLimiter } from "../../src/api/middlewares/rateLimiters";

const app = createTestApp(AuthRoutes);

const PASSWORD = "correct-horse-battery";
const EMAIL = "someone@example.test";
const USERNAME = "someone";

/** 以 argon2 雜湊過的使用者列（beforeAll 內填入實際雜湊） */
let ARGON2_HASH = "";

/** 舊格式 MD5 + salt 雜湊，用於 Lazy Migration 回歸 */
function md5WithSalt(plain: string): string {
  return crypto.createHash("md5").update(plain + config.jwt.salt).digest("hex");
}

/** 組一列 users 資料 */
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    unique: "u-1",
    username: USERNAME,
    email: EMAIL,
    password: ARGON2_HASH,
    roles: ["user"],
    ...overrides,
  };
}

/** 取出送往 DB 的某段 SQL 的呼叫（找不到回 undefined） */
function findQuery(fragment: string) {
  return poolQuery.mock.calls.find((c) => String(c[0]).includes(fragment));
}

/**
 * 依 SQL 片段分流的 mock。
 *
 * @param emailRows  第一段 `WHERE email = ?` 要回傳的列
 * @param usernameRows 第二段 `WHERE username = ?` 要回傳的列
 */
function mockLoginPool(emailRows: Array<any>, usernameRows: Array<any>) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users WHERE email = ?")) return [emailRows];
    if (sql.includes("FROM users WHERE username = ?")) return [usernameRows];
    if (sql.includes("UPDATE users SET password = ?")) return [{ affectedRows: 1 }];
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

/**
 * 註冊路徑的 mock：驗證碼有效、無重複帳號、INSERT 成功。
 */
function mockRegisterPool() {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM verification_codes")) return [[{ email: EMAIL, code: "123456" }]];
    if (sql.includes("DELETE FROM verification_codes")) return [{ affectedRows: 1 }];
    if (sql.includes("username = ? OR email = ?")) return [[]];
    if (sql.includes("INSERT INTO users SET ?")) return [{ affectedRows: 1 }];
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

/** 送一發 password grant 登入 */
function login(identifier: string, password: string = PASSWORD) {
  return request(app)
    .post("/oauth2/token")
    .send({ grant_type: "password", username: identifier, password });
}

/** 送一發註冊 */
function register() {
  return request(app)
    .post("/register")
    .send({ username: USERNAME, email: EMAIL, password: PASSWORD, code: "123456" });
}

/** 解出 JWT payload（不驗簽，只看形狀） */
function decode(token: string): any {
  return jwt.decode(token, { complete: true }) as any;
}

beforeAll(async () => {
  ARGON2_HASH = await argon2.hash(PASSWORD);
});

beforeEach(() => {
  poolQuery.mockReset();
  // 本檔的登入次數超過 loginLimiter 的 15 分鐘 10 次，逐測重置計數。
  // ⛔ 不改 loginLimiter 本身（界外），只在測試端清掉本機 IP 的計數。
  for (const key of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) {
    loginLimiter.resetKey(key);
  }
});

describe("缺陷 A：登入身分兩段式查找（Email 優先）", () => {
  it("A1：以 Email 登入成功，第一發查詢即為 email 精確比對，回應六欄位齊全", async () => {
    mockLoginPool([userRow()], []);

    const res = await login(EMAIL);

    expect(res.status).toBe(200);
    // 第一發 SQL 就是 email 段，且參數為使用者輸入的字串
    const first = poolQuery.mock.calls[0];
    expect(String(first[0])).toContain("FROM users WHERE email = ?");
    expect(first[1]).toEqual([EMAIL]);
    expect(res.body).toMatchObject({
      token_type: "bearer",
      scope: ["user"],
      info: { username: USERNAME },
    });
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(typeof res.body.expires_in).toBe("number");
  });

  it("A2：Email 查無時退回 username 段，使用者名稱登入仍可用（回歸）", async () => {
    mockLoginPool([], [userRow()]);

    const res = await login(USERNAME);

    expect(res.status).toBe(200);
    expect(String(poolQuery.mock.calls[0][0])).toContain("FROM users WHERE email = ?");
    expect(String(poolQuery.mock.calls[1][0])).toContain("FROM users WHERE username = ?");
    expect(poolQuery.mock.calls[1][1]).toEqual([USERNAME]);
    expect(res.body.info).toEqual({ username: USERNAME });
  });

  it("A3：兩段皆查無時回 401 InvalidCredentials（結構化錯誤，⛔ 非框架純文字）", async () => {
    mockLoginPool([], []);

    const res = await login("nobody@example.test");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "InvalidCredentials" });
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("A4：Email 段命中但密碼錯 ⇒ ⛔ 不 fall through 到 username 段", async () => {
    // username 段若被查到，會是一個「密碼剛好對得上」的別人
    mockLoginPool([userRow()], [userRow({ unique: "u-2", username: EMAIL })]);

    const res = await login(EMAIL, "wrong-password");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "InvalidCredentials" });
    // ⛔ 完全不得發出第二段查詢
    expect(findQuery("FROM users WHERE username = ?")).toBeUndefined();
  });

  it("A5：Lazy Migration 經 Email 路徑仍會觸發升級寫回", async () => {
    mockLoginPool([userRow({ password: md5WithSalt(PASSWORD) })], []);

    const res = await login(EMAIL);

    expect(res.status).toBe(200);
    const upgrade = findQuery("UPDATE users SET password = ?");
    expect(upgrade).toBeDefined();
    expect(String(upgrade![1][0])).toContain("$argon2");
    expect(upgrade![1][1]).toBe("u-1");
  });
});

describe("缺陷 C：註冊與登入的 access token 效期同源", () => {
  it("C1：註冊路徑的 exp - iat 等於 increaseTime / 1000", async () => {
    mockRegisterPool();

    const res = await register();

    expect(res.status).toBe(201);
    const payload = decode(res.body.access_token).payload;
    expect(payload.exp - payload.iat).toBe(environment.jwt.increaseTime / 1000);
  });

  it("C2：登入路徑的 exp - iat 與註冊路徑相等", async () => {
    mockRegisterPool();
    const registerRes = await register();
    const registerLifetime = (() => {
      const p = decode(registerRes.body.access_token).payload;
      return p.exp - p.iat;
    })();

    poolQuery.mockReset();
    mockLoginPool([userRow()], []);
    const loginRes = await login(EMAIL);
    const loginPayload = decode(loginRes.body.access_token).payload;

    expect(loginPayload.exp - loginPayload.iat).toBe(registerLifetime);
    expect(registerLifetime).toBe(environment.jwt.increaseTime / 1000);
  });
});

describe("缺陷 D：註冊回應與登入回應對稱", () => {
  it("D1：201 回應含 token_type / expires_in / scope / refresh_token / info.username，且既有欄位保留", async () => {
    mockRegisterPool();

    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      message: "註冊成功！",
      token_type: "bearer",
      scope: ["user"],
      info: { username: USERNAME },
    });
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(typeof res.body.expires_in).toBe("number");
  });

  it("D2：register 的 expires_in 是絕對 epoch 毫秒（⛔ 不是剩餘秒數）", async () => {
    mockRegisterPool();
    const before = Date.now();

    const res = await register();

    // 若有人把語意改成「剩餘秒數」，值會是 600 而遠小於當下 epoch → 立刻紅
    expect(res.body.expires_in).toBeGreaterThan(before);
    expect(res.body.expires_in).toBeLessThanOrEqual(Date.now() + environment.jwt.increaseTime);
  });

  it("D3：login（password 分支）的 expires_in 同樣是絕對 epoch 毫秒", async () => {
    mockLoginPool([userRow()], []);
    const before = Date.now();

    const res = await login(EMAIL);

    expect(res.body.expires_in).toBeGreaterThan(before);
    expect(res.body.expires_in).toBeLessThanOrEqual(Date.now() + environment.jwt.increaseTime);
  });
});

describe("缺陷 F：JWT payload 的 role 型別統一為字串陣列", () => {
  it("F1：register / password / refresh_token 三條簽發路徑的 role 皆為陣列", async () => {
    mockRegisterPool();
    const registerRes = await register();
    expect(decode(registerRes.body.access_token).payload.role).toEqual(["user"]);
    expect(Array.isArray(decode(registerRes.body.access_token).payload.role)).toBe(true);

    poolQuery.mockReset();
    mockLoginPool([userRow()], []);
    const loginRes = await login(EMAIL);
    expect(Array.isArray(decode(loginRes.body.access_token).payload.role)).toBe(true);

    // refresh_token 分支：撤銷表查無、users 依 `unique` 查得到
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM revoked_refresh_tokens")) return [[]];
      if (sql.includes("DELETE FROM revoked_refresh_tokens")) return [{ affectedRows: 0 }];
      if (sql.includes("FROM users WHERE `unique` = ?")) return [[userRow()]];
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const refreshRes = await request(app)
      .post("/oauth2/token")
      .send({ grant_type: "refresh_token", refresh_token: loginRes.body.refresh_token });

    expect(refreshRes.status).toBe(200);
    expect(Array.isArray(decode(refreshRes.body.access_token).payload.role)).toBe(true);
  });

  it("F2a：DB 值已是陣列時原樣帶出", async () => {
    mockLoginPool([userRow({ roles: ["user", "admin"] })], []);

    const res = await login(EMAIL);

    expect(res.body.scope).toEqual(["user", "admin"]);
    expect(decode(res.body.access_token).payload.role).toEqual(["user", "admin"]);
  });

  it("F2b：DB 值為 JSON 字串時 parse 成陣列", async () => {
    mockLoginPool([userRow({ roles: '["user","admin"]' })], []);

    const res = await login(EMAIL);

    expect(res.body.scope).toEqual(["user", "admin"]);
    expect(decode(res.body.access_token).payload.role).toEqual(["user", "admin"]);
  });

  it("F2c：DB 值為 null 時回空陣列（⛔ 不是 null、⛔ 不是 [\"\"]）", async () => {
    mockLoginPool([userRow({ roles: null })], []);

    const res = await login(EMAIL);

    expect(res.body.scope).toEqual([]);
    expect(decode(res.body.access_token).payload.role).toEqual([]);
  });

  it("F2d：DB 值為裸字串時包成單元素陣列", async () => {
    mockLoginPool([userRow({ roles: "user" })], []);

    const res = await login(EMAIL);

    expect(res.body.scope).toEqual(["user"]);
  });
});
