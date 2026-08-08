/**
 * @file auth.logout.test.ts
 * @description F35 登出與 refresh token 撤銷的端點契約測試：撤銷寫入、重複撤銷、換發被擋、
 *              以及撤銷查詢失敗時的 fail-closed 行為
 * @notes 沿既有慣例以 vi.mock 攔截 Mysql 連線池（不連真實 DB）；
 *        撤銷表「不存在」以「查詢 reject」精確模擬，⛔ 不需真的砍表
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";

import { config } from "../../src/config/config.service";

const poolQuery = vi.fn();
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: poolQuery })) },
}));

import { createTestApp } from "../helpers/testApp";
import AuthRoutes from "../../src/api/routes/auth.routes";

const app = createTestApp(AuthRoutes);

/** 簽一個結構與正式簽發一致的 refresh token */
function signRefreshToken(expiresIn: string | number = "7d"): string {
  return jwt.sign(
    { sub: "u-1", username: "quasi", iss: "NR System API", role: ["user"] },
    config.jwt.refreshSecret,
    { algorithm: "HS256", expiresIn: expiresIn as any },
  );
}

/** 撤銷清單的鍵，與 service 端的算法必須一致 */
function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** 取出送往 DB 的某段 SQL 的呼叫（找不到回 undefined） */
function findQuery(fragment: string) {
  return poolQuery.mock.calls.find((c) => String(c[0]).includes(fragment));
}

const USER_ROW = {
  unique: "u-1",
  username: "quasi",
  password: "$argon2id$dummy",
  roles: ["user"],
};

/**
 * 依 SQL 片段分流的預設 mock：撤銷表查無資料、users 查得到人。
 * @param revokedRows 撤銷表 SELECT 要回傳的列
 */
function mockPool(revokedRows: Array<any> = []) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM revoked_refresh_tokens")) return [revokedRows];
    if (sql.includes("INSERT INTO revoked_refresh_tokens")) return [{ affectedRows: 1 }];
    if (sql.includes("DELETE FROM revoked_refresh_tokens")) return [{ affectedRows: 0 }];
    if (sql.includes("FROM users")) return [[USER_ROW]];
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

beforeEach(() => {
  poolQuery.mockReset();
  mockPool();
});

describe("POST /auth/logout", () => {
  it("缺少 refresh_token 時回傳 400 InvalidRequest", async () => {
    const res = await request(app).post("/auth/logout").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "InvalidRequest" });
  });

  it("refresh_token 無效時回傳 401 Unauthorized", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .send({ refresh_token: "not-a-real-token" });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "Unauthorized" });
  });

  it("合法 refresh_token 以 SHA-256 為鍵寫入撤銷清單並回 200", async () => {
    const token = signRefreshToken();

    const res = await request(app).post("/auth/logout").send({ refresh_token: token });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const insert = findQuery("INSERT INTO revoked_refresh_tokens");
    expect(insert).toBeDefined();
    expect(String(insert![0])).toContain("ON DUPLICATE KEY UPDATE");
    // 鍵為 token 原字串的 SHA-256 十六進位小寫
    expect(insert![1][0]).toBe(sha256Hex(token));
    // expires_at 取自 token 的 exp（秒級 Unix → DATETIME）
    const exp = (jwt.decode(token) as any).exp as number;
    expect((insert![1][1] as Date).getTime()).toBe(exp * 1000);
  });

  it("重複登出同一 token 不報錯（兩次皆 200）", async () => {
    const token = signRefreshToken();

    const first = await request(app).post("/auth/logout").send({ refresh_token: token });
    const second = await request(app).post("/auth/logout").send({ refresh_token: token });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("登出時順手清掉已過期的撤銷列", async () => {
    await request(app).post("/auth/logout").send({ refresh_token: signRefreshToken() });

    const cleanup = findQuery("DELETE FROM revoked_refresh_tokens");
    expect(cleanup).toBeDefined();
    expect(String(cleanup![0])).toContain("expires_at < NOW()");
  });
});

describe("POST /oauth2/token（grant_type=refresh_token）的撤銷檢查", () => {
  it("未被撤銷的 token 可正常換發", async () => {
    const res = await request(app)
      .post("/oauth2/token")
      .send({ grant_type: "refresh_token", refresh_token: signRefreshToken() });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.info).toEqual({ username: "quasi" });
  });

  it("已撤銷的 token 換發時回 401，且不查 users", async () => {
    const token = signRefreshToken();
    mockPool([{ token_hash: sha256Hex(token) }]);

    const res = await request(app)
      .post("/oauth2/token")
      .send({ grant_type: "refresh_token", refresh_token: token });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "Unauthorized" });
    // 撤銷檢查發生在查 users 之前
    expect(findQuery("FROM users")).toBeUndefined();
  });

  it("撤銷表查詢失敗（如表不存在）時 fail-closed 回 401，⛔ 不放行", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM revoked_refresh_tokens")) {
        throw new Error("ER_NO_SUCH_TABLE: Table 'revoked_refresh_tokens' doesn't exist");
      }
      if (sql.includes("FROM users")) return [[USER_ROW]];
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await request(app)
      .post("/oauth2/token")
      .send({ grant_type: "refresh_token", refresh_token: signRefreshToken() });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "Unauthorized" });
    expect(findQuery("FROM users")).toBeUndefined();
  });
});
