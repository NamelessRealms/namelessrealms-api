/**
 * @file platform-search.test.ts
 * @description F13a-3 GET /mods/platform/search 契約：兩平台正規化各一例、source=all 合併、
 *   CF key 缺席（all 靜默跳過 / 明指 CF → 503）、limit 上限夾制、未帶 q → 400。
 *   mock got 攔截上游、以真實 JWT（僅需 verifyToken）走 supertest。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("got", () => ({ default: { get: getMock, post: postMock } }));

import { createTestApp } from "../helpers/testApp";
import { signTestToken } from "../helpers/auth";
import { config } from "../../src/config/config.service";
import ModsRoutes from "../../src/api/routes/mods.routes";

const app = createTestApp(ModsRoutes);
const auth = { Authorization: `Bearer ${signTestToken()}` };

/** 一筆 CF 搜尋回應（單 mod） */
function cfSearchBody() {
  return {
    data: [
      {
        id: 238222,
        slug: "jei",
        name: "Just Enough Items",
        summary: "item viewer",
        downloadCount: 12345,
        logo: { url: "https://cf/icon.png" },
        authors: [{ name: "mezz" }],
      },
    ],
  };
}

/** 一筆 Modrinth 搜尋回應（單 mod） */
function mrSearchBody() {
  return {
    hits: [
      {
        project_id: "P7dR8mSH",
        slug: "fabric-api",
        title: "Fabric API",
        description: "core lib",
        author: "modmuss50",
        downloads: 67890,
        icon_url: "https://mr/icon.png",
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  getMock.mockReset();
  postMock.mockReset();
  vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("TESTKEY");
  getMock.mockImplementation(async (url: string) => {
    if (url.includes("api.curseforge.com")) return { body: cfSearchBody() };
    if (url.includes("api.modrinth.com")) return { body: mrSearchBody() };
    return { body: {} };
  });
});

describe("GET /mods/platform/search", () => {
  it("source=all：兩平台正規化各一例、合併回傳", async () => {
    const res = await request(app).get("/mods/platform/search?q=jei").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const bySource = Object.fromEntries(res.body.map((r: any) => [r.source, r]));
    expect(bySource.curseforge).toMatchObject({
      source: "curseforge",
      projectId: "238222",
      slug: "jei",
      name: "Just Enough Items",
      author: "mezz",
      iconUrl: "https://cf/icon.png",
      downloads: 12345,
    });
    expect(bySource.modrinth).toMatchObject({
      source: "modrinth",
      projectId: "P7dR8mSH",
      name: "Fabric API",
      author: "modmuss50",
      iconUrl: "https://mr/icon.png",
      downloads: 67890,
    });
  });

  it("CF key 缺席 + source=all → 靜默跳過 CF（只回 Modrinth）", async () => {
    vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("");
    const res = await request(app).get("/mods/platform/search?q=jei").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].source).toBe("modrinth");
    // CF 上游完全未被呼叫
    expect(getMock.mock.calls.some((c) => String(c[0]).includes("api.curseforge.com"))).toBe(false);
  });

  it("CF key 缺席 + 明指 source=curseforge → 503", async () => {
    vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("");
    const res = await request(app)
      .get("/mods/platform/search?q=jei&source=curseforge")
      .set(auth);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ServiceUnavailable");
  });

  it("limit 上限夾制到 50", async () => {
    await request(app).get("/mods/platform/search?q=jei&source=modrinth&limit=999").set(auth);
    const mrCall = getMock.mock.calls.find((c) => String(c[0]).includes("api.modrinth.com"));
    expect(mrCall![1].searchParams.limit).toBe(50);
  });

  it("未帶 q → 400", async () => {
    const res = await request(app).get("/mods/platform/search").set(auth);
    expect(res.status).toBe(400);
  });

  it("缺 token → 401", async () => {
    const res = await request(app).get("/mods/platform/search?q=jei");
    expect(res.status).toBe(401);
  });
});