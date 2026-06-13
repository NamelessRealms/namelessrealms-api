/**
 * @file launcherV2.routes.test.ts
 * @description Launcher V2 端點契約測試：資產讀取的回應形狀與寫入端點的 JWT 守衛
 * @notes LauncherService 會觸及 DB，這裡以 vi.mock 替換掉，只測路由 → controller → 回應的契約
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/testApp";
import { signTestToken } from "../helpers/auth";

const sampleAssets = { version: "1.2.3", files: [{ name: "a.jar" }] };

// 以假的 LauncherService 取代，避免測試連線資料庫。
vi.mock("../../src/api/services/launcher/launcher.service", () => ({
  default: class {
    async getLauncherAssetsV2() {
      return sampleAssets;
    }
    async updateLauncherAssetsV2() {
      return { modified: true };
    }
  },
}));

// route 在 import 時就會 new LauncherController()，故 mock 後才動態載入 route。
const { default: LauncherV2Router } = await import(
  "../../src/api/routes/launcherV2.routes"
);
const app = createTestApp(LauncherV2Router);

describe("GET /launcher/v2/assets", () => {
  it("回傳 200 與資產設定（公開讀取，免 token）", async () => {
    const res = await request(app).get("/launcher/v2/assets");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleAssets);
  });
});

describe("PUT /launcher/v2/assets", () => {
  it("沒有 token 時回傳 401", async () => {
    const res = await request(app)
      .put("/launcher/v2/assets")
      .send({ version: "9.9.9" });

    expect(res.status).toBe(401);
  });

  it("帶合法 token 時回傳 201 success", async () => {
    const res = await request(app)
      .put("/launcher/v2/assets")
      .set("Authorization", `Bearer ${signTestToken()}`)
      .send({ version: "9.9.9" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ message: "success" });
  });
});
