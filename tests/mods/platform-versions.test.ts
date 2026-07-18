/**
 * @file platform-versions.test.ts
 * @description F13a-3 GET /mods/platform/:source/:projectId/versions 契約：依賴型別對映
 *   （CF relationType 與 Modrinth dependency_type 各一例，required/optional 保留、其餘丟棄）、
 *   過濾參數透傳、CF key 缺席 → 503。
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

/** CF 檔案清單回應：deps 含 required(3)/optional(2)/embedded(1，應丟棄) */
function cfFilesBody() {
  return {
    data: [
      {
        id: 5001,
        displayName: "JEI 1.21.4",
        fileName: "jei-1.21.4.jar",
        fileLength: 4096,
        fileDate: "2026-01-02T00:00:00Z",
        gameVersions: ["1.21.4", "Fabric"],
        dependencies: [
          { modId: 111, relationType: 3 },
          { modId: 222, relationType: 2 },
          { modId: 333, relationType: 1 },
        ],
      },
    ],
  };
}

/** Modrinth 版本清單回應：deps 含 required/optional/incompatible(丟棄)/無 project_id(丟棄) */
function mrVersionsBody() {
  return [
    {
      id: "vAAA",
      name: "1.0.0",
      game_versions: ["1.21.4"],
      loaders: ["fabric"],
      date_published: "2026-01-03T00:00:00Z",
      files: [
        { primary: true, filename: "lib-1.0.0.jar", size: 2048, hashes: { sha256: "a".repeat(64) }, url: "https://mr/dl" },
      ],
      dependencies: [
        { project_id: "aaa", dependency_type: "required" },
        { project_id: "bbb", dependency_type: "optional" },
        { project_id: "ccc", dependency_type: "incompatible" },
        { project_id: null, dependency_type: "required" },
      ],
    },
  ];
}

beforeEach(() => {
  vi.restoreAllMocks();
  getMock.mockReset();
  postMock.mockReset();
  vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("TESTKEY");
});

describe("GET /mods/platform/:source/:projectId/versions", () => {
  it("curseforge：relationType 對映（3→required、2→optional、其餘丟棄）+ 過濾參數透傳", async () => {
    getMock.mockImplementation(async () => ({ body: cfFilesBody() }));
    const res = await request(app)
      .get("/mods/platform/curseforge/238222/versions?mcVersion=1.21.4&loader=Fabric")
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      versionId: "5001",
      fileName: "jei-1.21.4.jar",
      size: 4096,
      mcVersions: ["1.21.4"],
      loaders: ["Fabric"],
      dependencies: [
        { projectId: "111", type: "required" },
        { projectId: "222", type: "optional" },
      ],
    });
    // 過濾參數透傳：gameVersion + modLoaderType(Fabric=4)
    const sp = getMock.mock.calls[0][1].searchParams;
    expect(sp.gameVersion).toBe("1.21.4");
    expect(sp.modLoaderType).toBe(4);
  });

  it("modrinth：dependency_type 對映（required/optional 保留、其餘與無 project_id 丟棄）+ 過濾透傳", async () => {
    getMock.mockImplementation(async () => ({ body: mrVersionsBody() }));
    const res = await request(app)
      .get("/mods/platform/modrinth/fabric-api/versions?mcVersion=1.21.4&loader=Fabric")
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      versionId: "vAAA",
      fileName: "lib-1.0.0.jar",
      size: 2048,
      mcVersions: ["1.21.4"],
      loaders: ["fabric"],
      dependencies: [
        { projectId: "aaa", type: "required" },
        { projectId: "bbb", type: "optional" },
      ],
    });
    const sp = getMock.mock.calls[0][1].searchParams;
    expect(sp.loaders).toBe(JSON.stringify(["fabric"]));
    expect(sp.game_versions).toBe(JSON.stringify(["1.21.4"]));
  });

  it("curseforge + CF key 缺席 → 503", async () => {
    vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("");
    const res = await request(app).get("/mods/platform/curseforge/238222/versions").set(auth);
    expect(res.status).toBe(503);
  });

  it("非法 source → 400", async () => {
    const res = await request(app).get("/mods/platform/bogus/238222/versions").set(auth);
    expect(res.status).toBe(400);
  });
});