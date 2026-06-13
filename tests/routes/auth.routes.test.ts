/**
 * @file auth.routes.test.ts
 * @description 認證端點契約測試：OAuth2 參數驗證與 JWT 受保護端點的守衛行為
 * @notes 僅覆蓋免 DB 的驗證/守衛路徑；登入成功路徑依賴 AuthService 與 DB，不在骨架範圍內
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/testApp";
import { signTestToken } from "../helpers/auth";
import AuthRoutes from "../../src/api/routes/auth.routes";

const app = createTestApp(AuthRoutes);

describe("POST /oauth2/token", () => {
  it("缺少 grant_type 時回傳 400 InvalidRequest", async () => {
    const res = await request(app).post("/oauth2/token").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "InvalidRequest" });
  });

  it("password 授權但缺少帳密時回傳 400 InvalidRequest", async () => {
    const res = await request(app)
      .post("/oauth2/token")
      .send({ grant_type: "password" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "InvalidRequest" });
  });

  it("不支援的 grant_type 回傳 400 InvalidRequest", async () => {
    const res = await request(app)
      .post("/oauth2/token")
      .send({ grant_type: "client_credentials" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "InvalidRequest" });
  });
});

describe("GET /auth/validate", () => {
  it("沒有 token 時回傳 401", async () => {
    const res = await request(app).get("/auth/validate");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it("無效 token 時回傳 401", async () => {
    const res = await request(app)
      .get("/auth/validate")
      .set("Authorization", "Bearer not-a-real-token");

    expect(res.status).toBe(401);
  });

  it("合法 token 時回傳 200 與 success", async () => {
    const res = await request(app)
      .get("/auth/validate")
      .set("Authorization", `Bearer ${signTestToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
