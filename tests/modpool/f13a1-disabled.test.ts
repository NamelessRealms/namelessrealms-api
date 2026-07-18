/**
 * @file f13a1-disabled.test.ts
 * @description F13a-1 模組停用（entry disabled 旗標，C 案）後端契約：
 *   - updateFilePolicy（PATCH）：disabled 更新、非法值 400、published 409、policy+disabled 併帶、
 *     兩者皆缺 400、disabled=false 移除欄位（齊一風格）。
 *   - publishVersion：停用項不入 manifest、enabled 正常帶出、發布後 draft_files 仍為全量（不清空）。
 *   - refs：含停用項（池條目）的 sha256 仍寫 refs（全量計）。
 *   - deriveVersion：停用狀態帶回新草稿；基底 draft_files 空 → fallback manifest（全 enabled）。
 *   - getFiles：published 優先回含停用項全量、明確補值；舊版本（draft_files 空）fallback manifest。
 *   - addFile：替換沿用 disabled、新增缺省不寫欄位；restoreFile：連同 disabled 抄回（含還原停用中檔案）。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.mock 工廠會被提升到檔案頂端，故共享 mock 與常數用 vi.hoisted 建立。
const NEW_SHA = "f".repeat(64);
const h = vi.hoisted(() => ({
  uploadToS3: vi.fn(async () => "https://pool.test/manifest.json"),
  ensureBufferInPool: vi.fn(async () => ({ sha256: "f".repeat(64), url: "https://pool.test/new.jar", size: 999 })),
}));
const uploadToS3 = h.uploadToS3;

vi.mock("../../src/api/utils/s3/s3", () => ({
  uploadToS3: h.uploadToS3,
  headObjectExists: vi.fn(),
  uploadFileToS3: vi.fn(),
  publicUrlForKey: vi.fn((k: string) => `https://pool.test/${k}`),
}));

vi.mock("../../src/api/utils/modpool/pool", () => ({
  ensureBufferInPool: h.ensureBufferInPool,
  createImportLimiter: vi.fn(),
  ensureCurseforgeFileInPool: vi.fn(),
  ensureModrinthFileInPool: vi.fn(),
  PoolResolveError: class extends Error {},
}));

const poolQuery = vi.fn();
const connQuery = vi.fn(async () => [{}, []]);
const conn = {
  beginTransaction: vi.fn(async () => {}),
  query: connQuery,
  commit: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
  release: vi.fn(),
};
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: poolQuery, getConnection: async () => conn })) },
}));

import {
  deriveVersion,
  publishVersion,
  getFiles,
  addFile,
  restoreFile,
  updateFilePolicy,
} from "../../src/api/controllers/server-modpack.controller";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

/** 取出某 SQL 前綴的 poolQuery 呼叫參數陣列（找不到回 undefined） */
function findQuery(prefix: string) {
  return poolQuery.mock.calls.find((c) => String(c[0]).includes(prefix));
}

/** 取出某 SQL 前綴的 conn.query（transaction）呼叫（找不到回 undefined） */
function findConnQuery(prefix: string) {
  return connQuery.mock.calls.find((c) => String(c[0]).startsWith(prefix));
}

/** 從 uploadToS3 攔截的 buffer 解析出上傳的 manifest */
function capturedManifest(): any {
  const call: any = uploadToS3.mock.calls[0];
  return JSON.parse((call[1] as Buffer).toString("utf-8"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateFilePolicy 擴充 disabled", () => {
  function mockDraft(files: any[], status = "draft") {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, draft_files"))
        return [[{ status, draft_files: JSON.stringify(files) }], []];
      return [[], []];
    });
  }

  it("disabled=true 更新成功並持久化", async () => {
    mockDraft([{ id: "f1", dest_path: "mods/a.jar", policy: "enforced" }]);
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: { disabled: true } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect(persisted[0].disabled).toBe(true);
    expect(res.json).toHaveBeenCalled();
  });

  it("非法 disabled（非 boolean）→ 400", async () => {
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: { disabled: "yes" } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("兩者皆缺 → 400", async () => {
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: {} };
    const res = mockRes();
    await updateFilePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("published → 409", async () => {
    mockDraft([{ id: "f1", dest_path: "mods/a.jar" }], "published");
    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" }, body: { disabled: true } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("policy + disabled 併帶：兩欄同時更新", async () => {
    mockDraft([{ id: "f1", dest_path: "mods/a.jar", policy: "enforced" }]);
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: { policy: "default", disabled: true } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect(persisted[0].policy).toBe("default");
    expect(persisted[0].disabled).toBe(true);
  });

  it("disabled=false：移除欄位（齊一 addFile 省略風格）", async () => {
    mockDraft([{ id: "f1", dest_path: "mods/a.jar", disabled: true }]);
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: { disabled: false } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect("disabled" in persisted[0]).toBe(false);
  });
});

describe("publishVersion 停用分流", () => {
  const POOL_SHA_ENABLED = "a".repeat(64);
  const POOL_SHA_DISABLED = "c".repeat(64);

  function mockPublish(draftFiles: any[]) {
    const versionRow = {
      id: "v1", server_id: "srv1", mc_version: "1.20.1", modloader: "Fabric",
      modloader_version: "0.15", is_active: 0, status: "draft",
      draft_files: JSON.stringify(draftFiles),
    };
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE id = ? AND server_id = ?")) return [[versionRow], []];
      if (sql.startsWith("SELECT * FROM server_modpack_versions WHERE id = ?"))
        return [[{ ...versionRow, status: "published" }], []];
      return [[], []];
    });
  }

  it("停用項不入 manifest、enabled 正常帶出；發布後 draft_files 不清空", async () => {
    mockPublish([
      { dest_path: "mods/a.jar", file_url: `https://minio/mods/files/${POOL_SHA_ENABLED}.jar`, file_hash: POOL_SHA_ENABLED, file_size_bytes: 10 },
      { dest_path: "mods/b.jar", file_url: `https://minio/mods/files/${POOL_SHA_DISABLED}.jar`, file_hash: POOL_SHA_DISABLED, file_size_bytes: 20, disabled: true },
    ]);
    const req: any = { params: { serverId: "srv1", versionId: "v1" } };
    const res = mockRes();
    await publishVersion(req, res);

    const paths = capturedManifest().files.map((f: any) => f.path);
    expect(paths).toEqual(["mods/a.jar"]); // 只帶 enabled，停用項不出現

    // draft_files 不清空：UPDATE 語句不含 draft_files 欄位設定。
    const update = findConnQuery("UPDATE server_modpack_versions SET status");
    expect(String(update![0])).not.toContain("draft_files");
  });

  it("refs 全量計：停用池條目的 sha256 仍寫 refs", async () => {
    mockPublish([
      { dest_path: "mods/a.jar", file_url: `https://minio/mods/files/${POOL_SHA_ENABLED}.jar`, file_hash: POOL_SHA_ENABLED, file_size_bytes: 10 },
      { dest_path: "mods/b.jar", file_url: `https://minio/mods/files/${POOL_SHA_DISABLED}.jar`, file_hash: POOL_SHA_DISABLED, file_size_bytes: 20, disabled: true },
    ]);
    const req: any = { params: { serverId: "srv1", versionId: "v1" } };
    const res = mockRes();
    await publishVersion(req, res);

    const inserts = connQuery.mock.calls.filter((c) => String(c[0]).startsWith("INSERT IGNORE INTO modpack_file_refs"));
    const insertedShas = inserts.map((c) => c[1][0]);
    expect(insertedShas).toContain(POOL_SHA_ENABLED);
    expect(insertedShas).toContain(POOL_SHA_DISABLED); // 停用項也計，位元組不被回收
  });
});

describe("deriveVersion 帶回 disabled", () => {
  it("基底 draft_files 有停用項 → 新草稿原樣帶回", async () => {
    const baseRow = {
      id: "v1", server_id: "srv1", sub_server_id: null, version_label: "v1.2",
      mc_version: "1.20.1", modloader: "Fabric", modloader_version: "0.15",
      notes: null, is_active: 0, status: "published", manifest_url: "https://pool.test/manifest.json",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "mods/a.jar", file_url: "u1", file_hash: "h1", file_size_bytes: 1, policy: "enforced" },
        { id: "f2", dest_path: "mods/b.jar", file_url: "u2", file_hash: "h2", file_size_bytes: 2, policy: "enforced", disabled: true },
      ]),
    };
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE id = ? AND server_id = ?")) return [[baseRow], []];
      if (sql.startsWith("SELECT * FROM server_modpack_versions WHERE id = ?"))
        return [[{ id: "draft1", server_id: "srv1", status: "draft", is_active: 0, base_version_id: "v1" }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "v1" }, body: {} };
    const res = mockRes();
    await deriveVersion(req, res);

    const draftFiles = JSON.parse(findQuery("INSERT INTO server_modpack_versions")![1][9]);
    const byPath = Object.fromEntries(draftFiles.map((f: any) => [f.dest_path, f]));
    expect(byPath["mods/a.jar"].disabled).toBe(false);
    expect(byPath["mods/b.jar"].disabled).toBe(true); // 停用狀態帶回
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("基底 draft_files 空 → fallback manifest（全 enabled）", async () => {
    const baseRow = {
      id: "v1", server_id: "srv1", sub_server_id: null, version_label: "v1.2",
      mc_version: "1.20.1", modloader: "Fabric", modloader_version: "0.15",
      notes: null, is_active: 0, status: "published", manifest_url: "https://pool.test/manifest.json",
      draft_files: "[]",
    };
    const manifest = { files: [{ path: "mods/jei.jar", url: "u", hash: "h", size: 2 }] };
    global.fetch = vi.fn(async () => ({ json: async () => manifest })) as any;
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE id = ? AND server_id = ?")) return [[baseRow], []];
      if (sql.startsWith("SELECT * FROM server_modpack_versions WHERE id = ?"))
        return [[{ id: "draft1", server_id: "srv1", status: "draft", is_active: 0, base_version_id: "v1" }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "v1" }, body: {} };
    const res = mockRes();
    await deriveVersion(req, res);

    const draftFiles = JSON.parse(findQuery("INSERT INTO server_modpack_versions")![1][9]);
    expect(draftFiles).toHaveLength(1);
    expect(draftFiles[0].disabled).toBe(false);
  });
});

describe("getFiles disabled 補值", () => {
  it("published 優先回 draft_files 全量（含停用項、明確 boolean）", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, manifest_url, draft_files"))
        return [[{
          status: "published", manifest_url: "https://pool.test/manifest.json",
          draft_files: JSON.stringify([
            { id: "f1", dest_path: "mods/a.jar", policy: "enforced" },
            { id: "f2", dest_path: "mods/b.jar", policy: "enforced", disabled: true },
          ]),
        }], []];
      return [[], []];
    });
    const req: any = { params: { versionId: "v1" } };
    const res = mockRes();
    await getFiles(req, res);
    const out = res.json.mock.calls[0][0];
    const byPath = Object.fromEntries(out.map((f: any) => [f.dest_path, f]));
    expect(byPath["mods/a.jar"].disabled).toBe(false);
    expect(byPath["mods/b.jar"].disabled).toBe(true);
  });

  it("published 舊版本 draft_files 空 → fallback manifest（全 enabled）", async () => {
    const manifest = { files: [{ path: "mods/a.jar", url: "u", hash: "h", size: 1 }] };
    global.fetch = vi.fn(async () => ({ json: async () => manifest })) as any;
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, manifest_url, draft_files"))
        return [[{ status: "published", manifest_url: "https://pool.test/manifest.json", draft_files: "[]" }], []];
      return [[], []];
    });
    const req: any = { params: { versionId: "v1" } };
    const res = mockRes();
    await getFiles(req, res);
    const out = res.json.mock.calls[0][0];
    expect(out[0].disabled).toBe(false);
  });
});

describe("addFile 替換沿用 disabled", () => {
  it("同 dest_path 替換：未帶 disabled → 沿用原 entry 的 disabled:true", async () => {
    const draftRow = {
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "mods/x.jar", file_url: "u-old", file_hash: "o".repeat(64), file_size_bytes: 5, disabled: true },
      ]),
    };
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, draft_files")) return [[draftRow], []];
      return [[], []];
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1" },
      body: { dest_path: "mods/x.jar" },
      file: { originalname: "x.jar", buffer: Buffer.from("new"), mimetype: "application/java-archive" },
    };
    const res = mockRes();
    await addFile(req, res);
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect(persisted[0].id).toBe("f1");
    expect(persisted[0].file_hash).toBe(NEW_SHA);
    expect(persisted[0].disabled).toBe(true); // 沿用，不重置
  });

  it("新增 entry：缺省不寫 disabled 欄位", async () => {
    const draftRow = { status: "draft", draft_files: "[]" };
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, draft_files")) return [[draftRow], []];
      return [[], []];
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1" },
      body: { dest_path: "mods/new.jar" },
      file: { originalname: "new.jar", buffer: Buffer.from("j"), mimetype: "application/java-archive" },
    };
    const res = mockRes();
    await addFile(req, res);
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect("disabled" in persisted[0]).toBe(false);
  });
});

describe("restoreFile 抄回 disabled", () => {
  function mockRestore(draftFiles: any[], baseDraft: any[]) {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, base_version_id, draft_files"))
        return [[{ status: "draft", base_version_id: "v1", draft_files: JSON.stringify(draftFiles) }], []];
      if (sql.startsWith("SELECT manifest_url, draft_files"))
        return [[{ manifest_url: "https://pool.test/manifest.json", draft_files: JSON.stringify(baseDraft) }], []];
      return [[], []];
    });
  }

  it("還原一個停用中的檔案 → disabled 正確抄回", async () => {
    // 基底該 entry 為停用；當前草稿已把它改成啟用（或改動）→ restore 抄回停用狀態。
    mockRestore(
      [{ id: "d1", dest_path: "mods/a.jar", file_url: "u-mod", file_hash: "mod".padEnd(64, "0"), file_size_bytes: 99 }],
      [{ id: "f1", dest_path: "mods/a.jar", file_url: "u-base", file_hash: "base".padEnd(64, "0"), file_size_bytes: 7, policy: "enforced", disabled: true }],
    );
    const req: any = { params: { serverId: "srv1", versionId: "d1" }, body: { destPath: "mods/a.jar" } };
    const res = mockRes();
    await restoreFile(req, res);
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect(persisted[0].id).toBe("d1"); // 還原修改沿用原 id
    expect(persisted[0].file_hash).toBe("base".padEnd(64, "0")); // 還原成基底位元組
    expect(persisted[0].disabled).toBe(true); // 連同 disabled 抄回
  });
});