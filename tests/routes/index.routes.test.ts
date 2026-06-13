/**
 * @file index.routes.test.ts
 * @description 健康檢查端點契約測試：GET / 與 GET /status 應回傳標準狀態 JSON
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/testApp";
import IndexRoutes from "../../src/api/routes/index.routes";

const app = createTestApp(IndexRoutes);

describe("GET /status", () => {
  it("回傳 200 與健康狀態契約欄位", async () => {
    const res = await request(app).get("/status");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "OK" });
    expect(res.body).toHaveProperty("version");
    expect(res.body).toHaveProperty("timestamp");
  });
});

describe("GET /", () => {
  it("回傳 200 與健康狀態契約欄位", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "OK" });
  });
});
