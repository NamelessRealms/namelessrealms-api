/**
 * @file from-platform.test.ts
 * @description F13a-3 POST .../files/from-platform 契約：draft guard（published→409）、
 *   權限（無 MANAGE_SERVER→403）、CF downloadUrl null 原樣傳入池（觸發 flx 重建而非 502）、
 *   同 dest_path 替換沿用 id/disabled/policy、上游失敗→502 且 draft_files 不變、
 *   metadata 委派進池（controller 不另呼叫 captureModMetadata）。
 *
 * 以真實 verifyToken + requirePermission + handler 鏈（最小 app）走 supertest，
 * mock 進池管線、平台 service、requirePermission 的 server/member service 與 mysql。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import * as jwt from "jsonwebtoken";

// --- 進池管線 mock（from-platform 委派此層） ---
const pool = vi.hoisted(() => ({
  ensureCurseforgeFileInPool: vi.fn(),
  ensureModrinthFileInPool: vi.fn(),
}));
vi.mock("../../src/api/utils/modpool/pool", () => ({
  ensureCurseforgeFileInPool: pool.ensureCurseforgeFileInPool,
  ensureModrinthFileInPool: pool.ensureModrinthFileInPool,
  ensureBufferInPool: vi.fn(),
  createImportLimiter: vi.fn(() => (fn: any) => fn()),
  PoolResolveError: class PoolResolveError extends Error {
    constructor(public fileName: string, message: string) {
      super(message);
      this.name = "PoolResolveError";
    }
  },
}));

// --- 平台 service mock ---
const cfSvc = vi.hoisted(() => ({ getVersionFile: vi.fn() }));
const mrSvc = vi.hoisted(() => ({ getVersionFile: vi.fn() }));
vi.mock("../../src/api/services/mods/platform-curseforge.service", () => ({
  default: class {
    getVersionFile = cfSvc.getVersionFile;
  },
}));
vi.mock("../../src/api/services/mods/platform-modrinth.service", () => ({
  default: class {
    getVersionFile = mrSvc.getVersionFile;
  },
}));

// --- metadata 掛鉤 mock（用於斷言 from-platform 不另呼叫 captureModMetadata） ---
const meta = vi.hoisted(() => ({ captureModMetadata: vi.fn() }));
vi.mock("../../src/api/services/mods/mod-metadata.service", () => ({
  captureModMetadata: meta.captureModMetadata,
  captureModMetadataFromFile: vi.fn(),
  lookupModMetadata: vi.fn(),
}));

// --- requirePermission 依賴的 service mock ---
const perm = vi.hoisted(() => ({ getServerById: vi.fn(), getMemberWithRole: vi.fn() }));
vi.mock("../../src/api/services/server/server.service", () => ({
  default: class {
    getServerById = perm.getServerById;
  },
}));
vi.mock("../../src/api/services/server/server-member.service", () => ({
  default: class {
    getMemberWithRole = perm.getMemberWithRole;
  },
}));

// --- mysql mock ---
const poolQuery = vi.fn();
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: poolQuery })) },
}));

import AuthJwtVerify from "../../src/api/middlewares/authJwtVerify";
import { requirePermission } from "../../src/api/middlewares/requirePermission";
import { Permission } from "../../src/api/utils/permissions";
import { asyncHandler } from "../../src/api/middlewares/asyncHandler";
import { errorMiddleware } from "../../src/api/middlewares/error.middleware";
import { addFileFromPlatform } from "../../src/api/controllers/server-modpack.controller";
import { PoolResolveError } from "../../src/api/utils/modpool/pool";
import { config } from "../../src/config/config.service";

/** 建最小 app：鏡射 server.routes 的 from-platform 中介層鏈 */
function buildApp() {
  const app = express();
  app.use(express.json());
  const authv = new AuthJwtVerify();
  app.post(
    "/servers/:serverId/modpack-versions/:versionId/files/from-platform",
    authv.verifyToken,
    requirePermission(Permission.MANAGE_SERVER),
    asyncHandler((req, res) => addFileFromPlatform(req, res))
  );
  app.use(errorMiddleware);
  return app;
}
const app = buildApp();

/** 簽發帶 sub 的 token（requirePermission 讀 sub） */
function token(userId = "u-owner") {
  return jwt.sign({ _id: userId, sub: userId, role: "user" }, config.jwt.secret, {
    expiresIn: 3600,
  });
}
const OWNER = { Authorization: `Bearer ${token("u-owner")}` };

/** 令 requirePermission 以 owner 放行 */
function ownerBypass() {
  perm.getServerById.mockResolvedValue({ owner_user_id: "u-owner" });
}

/** 設定版本列查詢（draft/ published + draft_files） */
function mockVersion(row: any) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (String(sql).startsWith("SELECT status, draft_files")) return [[row], []];
    return [{}, []];
  });
}

/** 取某 SQL 前綴的 UPDATE 呼叫（找不到回 undefined） */
function findUpdate() {
  return poolQuery.mock.calls.find((c) =>
    String(c[0]).startsWith("UPDATE server_modpack_versions SET draft_files")
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  poolQuery.mockReset();
  pool.ensureCurseforgeFileInPool.mockReset();
  pool.ensureModrinthFileInPool.mockReset();
  cfSvc.getVersionFile.mockReset();
  mrSvc.getVersionFile.mockReset();
  meta.captureModMetadata.mockReset();
  perm.getServerById.mockReset();
  perm.getMemberWithRole.mockReset();
  vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("TESTKEY");
});

describe("POST .../files/from-platform", () => {
  it("published → 409（在取檔前擋下）", async () => {
    ownerBypass();
    mockVersion({ status: "published", draft_files: "[]" });
    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "modrinth", projectId: "p1", versionId: "ver1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("Conflict");
    expect(mrSvc.getVersionFile).not.toHaveBeenCalled();
  });

  it("無 MANAGE_SERVER → 403", async () => {
    perm.getServerById.mockResolvedValue({ owner_user_id: "someone-else" });
    perm.getMemberWithRole.mockResolvedValue({ role: { permissions: 0 } });
    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set({ Authorization: `Bearer ${token("u-nobody")}` })
      .send({ source: "modrinth", projectId: "p1", versionId: "ver1" });
    expect(res.status).toBe(403);
  });

  it("curseforge：downloadUrl null 原樣傳入池（觸發 flx 重建而非 502）", async () => {
    ownerBypass();
    mockVersion({ status: "draft", draft_files: "[]" });
    cfSvc.getVersionFile.mockResolvedValue({
      fileId: 6000001,
      fileName: "mod.jar",
      downloadUrl: null,
    });
    pool.ensureCurseforgeFileInPool.mockResolvedValue({
      sha256: "a".repeat(64),
      url: "https://pool/mods/files/a.jar",
      size: 100,
    });

    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "curseforge", projectId: "238222", versionId: "6000001" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      dest_path: "mods/mod.jar",
      file_hash: "a".repeat(64),
      policy: "enforced",
      disabled: false,
    });
    // 佐證：傳入池的 file 形狀 downloadUrl 為 null（真實 pool 會走 forgecdn 重建，非直接 502）
    const fileArg = pool.ensureCurseforgeFileInPool.mock.calls[0][0];
    expect(fileArg.downloadUrl).toBeNull();
    expect(fileArg.fileId).toBe(6000001);
    // metadata 委派進池，controller 不另呼叫 captureModMetadata
    expect(meta.captureModMetadata).not.toHaveBeenCalled();
  });

  it("modrinth：組正確的 f 形狀交進池，回 201 entry", async () => {
    ownerBypass();
    mockVersion({ status: "draft", draft_files: "[]" });
    mrSvc.getVersionFile.mockResolvedValue({
      fileName: "lib.jar",
      sha512: "b".repeat(128),
      url: "https://mr/dl",
      size: 200,
    });
    pool.ensureModrinthFileInPool.mockResolvedValue({
      sha256: "b".repeat(64),
      url: "https://pool/mods/files/b.jar",
      size: 200,
    });

    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "modrinth", projectId: "p1", versionId: "ver1" });

    expect(res.status).toBe(201);
    expect(res.body.dest_path).toBe("mods/lib.jar");
    const fArg = pool.ensureModrinthFileInPool.mock.calls[0][0];
    expect(fArg).toMatchObject({
      path: "lib.jar",
      hashes: { sha512: "b".repeat(128) },
      downloads: ["https://mr/dl"],
      fileSize: 200,
    });
  });

  it("同 dest_path 替換：沿用原 id / disabled / policy", async () => {
    ownerBypass();
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        {
          id: "f1",
          version_id: "v1",
          file_name: "mod.jar",
          dest_path: "mods/mod.jar",
          file_url: "u-old",
          file_hash: "o".repeat(64),
          file_size_bytes: 5,
          policy: "default",
          disabled: true,
        },
      ]),
    });
    cfSvc.getVersionFile.mockResolvedValue({
      fileId: 6000001,
      fileName: "mod.jar",
      downloadUrl: "https://cf/dl",
    });
    pool.ensureCurseforgeFileInPool.mockResolvedValue({
      sha256: "c".repeat(64),
      url: "https://pool/new",
      size: 999,
    });

    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "curseforge", projectId: "238222", versionId: "6000001" });

    expect(res.status).toBe(201);
    const update = findUpdate();
    expect(String(update![0])).not.toContain("file_count + 1"); // 替換分支
    const persisted = JSON.parse(update![1][0]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe("f1"); // 沿用原 id
    expect(persisted[0].file_hash).toBe("c".repeat(64)); // hash 更新
    expect(persisted[0].policy).toBe("default"); // 沿用
    expect(persisted[0].disabled).toBe(true); // 沿用
    expect(res.body.disabled).toBe(true);
  });

  it("上游取檔失敗 → 502 且 draft_files 不變", async () => {
    ownerBypass();
    mockVersion({ status: "draft", draft_files: "[]" });
    cfSvc.getVersionFile.mockRejectedValue(new Error("CF 500"));

    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "curseforge", projectId: "238222", versionId: "6000001" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("BadGateway");
    expect(pool.ensureCurseforgeFileInPool).not.toHaveBeenCalled();
    expect(findUpdate()).toBeUndefined(); // draft_files 未被寫入
  });

  it("進池失敗（PoolResolveError）→ 502 且 draft_files 不變", async () => {
    ownerBypass();
    mockVersion({ status: "draft", draft_files: "[]" });
    mrSvc.getVersionFile.mockResolvedValue({
      fileName: "lib.jar",
      sha256: "b".repeat(64),
      url: "https://mr/dl",
      size: 200,
    });
    pool.ensureModrinthFileInPool.mockRejectedValue(
      new PoolResolveError("lib.jar", "下載失敗：HTTP 404")
    );

    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "modrinth", projectId: "p1", versionId: "ver1" });

    expect(res.status).toBe(502);
    expect(findUpdate()).toBeUndefined();
  });

  it("非法 source → 400", async () => {
    ownerBypass();
    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "bogus", projectId: "p1", versionId: "ver1" });
    expect(res.status).toBe(400);
  });

  it("curseforge + CF key 缺席 → 503", async () => {
    ownerBypass();
    vi.spyOn(config, "curseforgeKey", "get").mockReturnValue("");
    mockVersion({ status: "draft", draft_files: "[]" });
    const res = await request(app)
      .post("/servers/srv1/modpack-versions/v1/files/from-platform")
      .set(OWNER)
      .send({ source: "curseforge", projectId: "238222", versionId: "6000001" });
    expect(res.status).toBe(503);
  });
});