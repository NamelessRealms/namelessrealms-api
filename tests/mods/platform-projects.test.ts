/**
 * @file platform-projects.test.ts
 * @description F13a-3 POST /mods/platform/projects 契約：批次回傳、查不到靜默略過、上限 50、CF key 缺席 → 503。
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

beforeEach(() => {
  vi.restoreAllMocks();
  getMock.mockReset();
  postMock.mockReset();
  vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("TESTKEY");
});

describe("POST /mods/platform/projects", () => {
  it("curseforge：批次回傳，查不到的 id 靜默略過（上游只回有值者）", async () => {
    // 請求 2 個 id，上游只回 1 個
    postMock.mockImplementation(async () => ({
      body: { data: [{ id: 111, name: "Dep A", slug: "dep-a", logo: { url: "https://cf/a.png" } }] },
    }));
    const res = await request(app)
      .post("/mods/platform/projects")
      .set(auth)
      .send({ source: "curseforge", projectIds: ["111", "999"] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { projectId: "111", name: "Dep A", slug: "dep-a", iconUrl: "https://cf/a.png" },
    ]);
  });

  it("modrinth：批次回傳", async () => {
    getMock.mockImplementation(async () => ({
      body: [{ id: "aaa", title: "Lib A", slug: "lib-a", icon_url: "https://mr/a.png" }],
    }));
    const res = await request(app)
      .post("/mods/platform/projects")
      .set(auth)
      .send({ source: "modrinth", projectIds: ["aaa"] });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ projectId: "aaa", name: "Lib A", iconUrl: "https://mr/a.png" });
  });

  it("超過上限 50 → 400", async () => {
    const projectIds = Array.from({ length: 51 }, (_, i) => String(i));
    const res = await request(app)
      .post("/mods/platform/projects")
      .set(auth)
      .send({ source: "curseforge", projectIds });
    expect(res.status).toBe(400);
  });

  it("curseforge + CF key 缺席 → 503", async () => {
    vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("");
    const res = await request(app)
      .post("/mods/platform/projects")
      .set(auth)
      .send({ source: "curseforge", projectIds: ["111"] });
    expect(res.status).toBe(503);
  });
});