/**
 * @file mod-metadata.test.ts
 * @description mod metadata 落庫服務與查詢端點測試（mock mysql / s3 / 解析器）：
 *   captureModMetadata 的略過/吞錯/落庫行為，與 POST /mods/metadata/lookup 的契約。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

const { queryMock, headObjectExists, uploadToS3, publicUrlForKey, parseModJar } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  headObjectExists: vi.fn(),
  uploadToS3: vi.fn(async () => "https://pool.test/icon"),
  publicUrlForKey: vi.fn((k: string) => `https://pool.test/${k}`),
  parseModJar: vi.fn(),
}));
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: queryMock })) },
}));
vi.mock("../../src/api/utils/s3/s3", () => ({ headObjectExists, uploadToS3, publicUrlForKey }));
vi.mock("../../src/api/utils/modJarParser", () => ({ parseModJar }));

import { captureModMetadata, backfillModDeps } from "../../src/api/services/mods/mod-metadata.service";
import { createTestApp } from "../helpers/testApp";
import { signTestToken } from "../helpers/auth";
import ModsRoutes from "../../src/api/routes/mods.routes";

const app = createTestApp(ModsRoutes);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureModMetadata", () => {
  it("非 .jar → 直接 return，不碰 DB", async () => {
    await captureModMetadata("sha1", Buffer.from("x"), ".zip");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("已有 row → 跳過（不解析、不 INSERT）", async () => {
    queryMock.mockResolvedValueOnce([[{ "1": 1 }], []]); // SELECT 命中
    await captureModMetadata("sha2", Buffer.from("x"), ".jar");
    expect(queryMock).toHaveBeenCalledTimes(1); // 只有 SELECT
    expect(parseModJar).not.toHaveBeenCalled();
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  it("解析成功含 icon → 上傳 icon + INSERT 帶 icon_url", async () => {
    queryMock.mockResolvedValueOnce([[], []]); // SELECT 未命中
    queryMock.mockResolvedValueOnce([{}, []]); // INSERT
    headObjectExists.mockResolvedValue(false);
    parseModJar.mockReturnValue({
      mod_id: "m",
      mod_name: "M",
      mod_version: "1.0.0",
      loader_hint: "fabric",
      deps: ["sodium"],
      iconBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    await captureModMetadata("shaicon", Buffer.from("x"), ".jar");

    expect(uploadToS3).toHaveBeenCalledWith("mods/icons/shaicon.png", expect.any(Buffer), "image/png");
    const insertCall = queryMock.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT IGNORE INTO mod_metadata");
    expect(insertCall[0]).toContain("deps");
    expect(insertCall[1][0]).toBe("shaicon");
    expect(insertCall[1][5]).toBe("https://pool.test/mods/icons/shaicon.png");
    expect(insertCall[1][6]).toBe(JSON.stringify(["sodium"]));
  });

  it("解析成功無依賴 → INSERT deps 存 \"[]\"", async () => {
    queryMock.mockResolvedValueOnce([[], []]); // SELECT 未命中
    queryMock.mockResolvedValueOnce([{}, []]); // INSERT
    parseModJar.mockReturnValue({
      mod_id: "m",
      mod_name: "M",
      mod_version: "1.0.0",
      loader_hint: "fabric",
      deps: [],
    });
    await captureModMetadata("shanodeps", Buffer.from("x"), ".jar");
    expect(queryMock.mock.calls[1][1][6]).toBe("[]");
  });

  it("解析失敗（parseModJar 回 null）→ INSERT 全 NULL row，deps 亦 NULL", async () => {
    queryMock.mockResolvedValueOnce([[], []]); // SELECT 未命中
    queryMock.mockResolvedValueOnce([{}, []]); // INSERT
    parseModJar.mockReturnValue(null);
    await captureModMetadata("shafail", Buffer.from("x"), ".jar");
    const insertCall = queryMock.mock.calls[1];
    expect(insertCall[1][1]).toBeNull(); // mod_id
    expect(insertCall[1][6]).toBeNull(); // deps
  });

  it("解析器 throw → 吞錯不 throw、不 INSERT", async () => {
    queryMock.mockResolvedValueOnce([[], []]); // SELECT 未命中
    parseModJar.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(captureModMetadata("sha3", Buffer.from("x"), ".jar")).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(1); // 只走到 SELECT，未 INSERT
  });
});

describe("POST /mods/metadata/lookup", () => {
  it("沒有 token → 401", async () => {
    const res = await request(app).post("/mods/metadata/lookup").send({ hashes: ["a"] });
    expect(res.status).toBe(401);
  });

  it("缺 hashes 參數 → 400", async () => {
    const res = await request(app)
      .post("/mods/metadata/lookup")
      .set("Authorization", `Bearer ${signTestToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("空陣列 → 200 回 {}（不查 DB）", async () => {
    const res = await request(app)
      .post("/mods/metadata/lookup")
      .set("Authorization", `Bearer ${signTestToken()}`)
      .send({ hashes: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("多 hash → 回多筆，且查詢帶 mod_name IS NOT NULL 過濾", async () => {
    queryMock.mockResolvedValueOnce([
      [
        { sha256: "a", mod_id: "ma", mod_name: "A", mod_version: "1", loader_hint: "fabric", icon_url: null, deps: ["sodium"] },
        { sha256: "b", mod_id: "mb", mod_name: "B", mod_version: "2", loader_hint: "forge", icon_url: "u", deps: null },
      ],
      [],
    ]);
    const res = await request(app)
      .post("/mods/metadata/lookup")
      .set("Authorization", `Bearer ${signTestToken()}`)
      .send({ hashes: ["a", "b"] });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["a", "b"]);
    expect(res.body.a.mod_name).toBe("A");
    expect(res.body.b.icon_url).toBe("u");
    expect(res.body.a.deps).toEqual(["sodium"]);
    expect(res.body.b.deps).toBeNull();
    expect(queryMock.mock.calls[0][0]).toContain("deps");
    expect(queryMock.mock.calls[0][0]).toContain("mod_name IS NOT NULL");
    expect(queryMock.mock.calls[0][1]).toEqual([["a", "b"]]); // 陣列參數整包綁定（query 展開 IN）
  });

  it("deps 欄若真機回字串（mysql2 未 parse）→ 防禦性 JSON.parse", async () => {
    queryMock.mockResolvedValueOnce([
      [{ sha256: "c", mod_id: "mc", mod_name: "C", mod_version: "1", loader_hint: "fabric", icon_url: null, deps: '["sodium","jei"]' }],
      [],
    ]);
    const res = await request(app)
      .post("/mods/metadata/lookup")
      .set("Authorization", `Bearer ${signTestToken()}`)
      .send({ hashes: ["c"] });
    expect(res.body.c.deps).toEqual(["sodium", "jei"]);
  });

  it(">500 筆 → 400（不查 DB）", async () => {
    const hashes = Array.from({ length: 501 }, (_, i) => String(i));
    const res = await request(app)
      .post("/mods/metadata/lookup")
      .set("Authorization", `Bearer ${signTestToken()}`)
      .send({ hashes });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("backfillModDeps", () => {
  it("解析成功 → UPDATE 僅 deps 欄、帶 WHERE deps IS NULL guard", async () => {
    queryMock.mockResolvedValueOnce([{}, []]); // UPDATE
    parseModJar.mockReturnValue({
      mod_id: "m",
      mod_name: "M",
      mod_version: "1.0.0",
      loader_hint: "fabric",
      deps: ["sodium"],
    });
    await backfillModDeps("shadeps", Buffer.from("x"));
    const updateCall = queryMock.mock.calls[0];
    expect(updateCall[0]).toContain("UPDATE mod_metadata SET deps");
    expect(updateCall[0]).toContain("deps IS NULL");
    expect(updateCall[1]).toEqual([JSON.stringify(["sodium"]), "shadeps"]);
  });

  it("re-parse 失敗（parseModJar 回 null）→ 不 UPDATE、不覆蓋", async () => {
    parseModJar.mockReturnValue(null);
    await backfillModDeps("shafail", Buffer.from("x"));
    expect(queryMock).not.toHaveBeenCalled();
  });
});