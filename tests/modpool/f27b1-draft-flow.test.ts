/**
 * @file f27b1-draft-flow.test.ts
 * @description F27b-1 草稿流後端契約：
 *   - deriveVersion：published 衍生（欄位複製、draft_files 完整複製、policy 缺省補值）；draft 衍生 → 409。
 *   - publishVersion guard：published 重 publish → 409 且 manifest 未被覆寫（uploadToS3 未呼叫）。
 *   - addFile 替換語意：同 dest_path 二次上傳 → entry 數不變、hash 更新、policy 沿用（不重置）。
 *   - restoreFile：還原修改（不變 count）、還原刪除（count+1）、基底無此 path → 404、無 base → 422、非 draft → 409。
 *   - updateFilePolicy：合法切換、非法值 400、published → 409。
 *   - publish policy value-based：全 enforced 草稿發布後 manifest entry 不含 policy 欄位。
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

// addFile 走 ensureBufferInPool 進池；mock 回固定新 sha/url/size 供替換斷言。
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

/** 從 uploadToS3 攔截的 buffer 解析出上傳的 manifest */
function capturedManifest(): any {
  const call: any = uploadToS3.mock.calls[0];
  return JSON.parse((call[1] as Buffer).toString("utf-8"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveVersion 衍生草稿", () => {
  it("published 衍生：複製 metadata、完整複製 draft_files、policy 缺省補 enforced、base_version_id 指回基底", async () => {
    const baseRow = {
      id: "v1",
      server_id: "srv1",
      sub_server_id: "sub1",
      version_label: "v1.2",
      mc_version: "1.20.1",
      modloader: "Fabric",
      modloader_version: "0.15",
      notes: "base notes",
      is_active: 0,
      status: "published",
      manifest_url: "https://pool.test/manifest.json",
    };
    const manifest = {
      files: [
        { path: "config/x.txt", url: "u1", hash: "h1", size: 1, policy: "default" },
        { path: "mods/jei.jar", url: "u2", hash: "h2", size: 2 }, // 無 policy → 補 enforced
      ],
    };
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

    const insert = findQuery("INSERT INTO server_modpack_versions");
    expect(insert).toBeTruthy();
    const args = insert![1];
    // [3]=label, [4]=mc_version, [8]=base_version_id, [9]=draft_files, [10]=file_count
    expect(args[3]).toBe("v1.2-draft"); // 缺省命名
    expect(args[4]).toBe("1.20.1"); // metadata 複製
    expect(args[8]).toBe("v1"); // base_version_id 指回基底
    const draftFiles = JSON.parse(args[9]);
    expect(draftFiles).toHaveLength(2);
    expect(args[10]).toBe(2); // file_count
    const byPath = Object.fromEntries(draftFiles.map((f: any) => [f.dest_path, f]));
    expect(byPath["config/x.txt"].policy).toBe("default");
    expect(byPath["mods/jei.jar"].policy).toBe("enforced"); // 缺省補值落地
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("對 draft 衍生 → 409", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE id = ? AND server_id = ?"))
        return [[{ id: "d1", status: "draft" }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "d1" }, body: {} };
    const res = mockRes();
    await deriveVersion(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("publishVersion §12.7 guard", () => {
  it("published 重 publish → 409 且 manifest 未被覆寫", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE id = ? AND server_id = ?"))
        return [[{ id: "v1", server_id: "srv1", status: "published", draft_files: "[]" }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "v1" } };
    const res = mockRes();
    await publishVersion(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  it("value-based policy：全 enforced 草稿發布，manifest entry 不含 policy 欄位", async () => {
    const versionRow = {
      id: "v1",
      server_id: "srv1",
      mc_version: "1.20.1",
      modloader: "Fabric",
      modloader_version: "0.15",
      is_active: 0,
      status: "draft",
      draft_files: JSON.stringify([
        { dest_path: "mods/a.jar", file_url: "https://minio/overrides/a.jar", file_hash: "a".repeat(64), file_size_bytes: 10, policy: "enforced" },
        { dest_path: "config/b.txt", file_url: "https://minio/overrides/b.txt", file_hash: "b".repeat(64), file_size_bytes: 20, policy: "default" },
      ]),
    };
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE id = ? AND server_id = ?")) return [[versionRow], []];
      if (sql.startsWith("SELECT * FROM server_modpack_versions WHERE id = ?"))
        return [[{ ...versionRow, status: "published" }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "v1" } };
    const res = mockRes();
    await publishVersion(req, res);

    const byPath = Object.fromEntries(capturedManifest().files.map((f: any) => [f.path, f]));
    expect("policy" in byPath["mods/a.jar"]).toBe(false); // 明確 enforced 仍省略
    expect(byPath["config/b.txt"].policy).toBe("default");
  });
});

describe("addFile §12.8 替換語意", () => {
  it("同 dest_path 二次上傳：entry 數不變、hash 更新、policy 沿用（不重置為 enforced）", async () => {
    const draftRow = {
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", version_id: "v1", file_name: "old.txt", dest_path: "config/x.txt", file_url: "u-old", file_hash: "o".repeat(64), file_size_bytes: 5, policy: "default" },
      ]),
    };
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, draft_files")) return [[draftRow], []];
      return [[], []];
    });

    const req: any = {
      params: { serverId: "srv1", versionId: "v1" },
      body: { dest_path: "config/x.txt" }, // 未帶 policy
      file: { originalname: "new.txt", buffer: Buffer.from("new"), mimetype: "text/plain" },
    };
    const res = mockRes();
    await addFile(req, res);

    // 替換分支：UPDATE 不含 file_count + 1
    const update = findQuery("UPDATE server_modpack_versions SET draft_files");
    expect(String(update![0])).not.toContain("file_count + 1");
    const persisted = JSON.parse(update![1][0]);
    expect(persisted).toHaveLength(1); // entry 數不變
    expect(persisted[0].id).toBe("f1"); // 沿用原 id
    expect(persisted[0].file_hash).toBe(NEW_SHA); // hash 更新
    expect(persisted[0].policy).toBe("default"); // policy 沿用，未重置
  });

  it("不同 dest_path：追加且 file_count + 1", async () => {
    const draftRow = {
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/x.txt", file_hash: "o".repeat(64), file_size_bytes: 5 },
      ]),
    };
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
    const update = findQuery("UPDATE server_modpack_versions SET draft_files");
    expect(String(update![0])).toContain("file_count + 1");
  });
});

describe("restoreFile 從基底還原", () => {
  const baseManifest = {
    files: [
      { path: "config/x.txt", url: "u-base", hash: "base".padEnd(64, "0"), size: 7, policy: "default" },
    ],
  };

  function mockRestore(draftFiles: any[], opts?: { status?: string; base?: string | null; baseManifestUrl?: string | null }) {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, base_version_id, draft_files"))
        return [[{ status: opts?.status ?? "draft", base_version_id: opts?.base === undefined ? "v1" : opts.base, draft_files: JSON.stringify(draftFiles) }], []];
      // F13a-1：基底查詢改 SELECT manifest_url, draft_files（還原來源優先 draft_files，此處基底 draft_files 為空 → fallback manifest）。
      if (sql.startsWith("SELECT manifest_url, draft_files"))
        return [[{ manifest_url: opts?.baseManifestUrl === undefined ? "https://pool.test/manifest.json" : opts.baseManifestUrl, draft_files: "[]" }], []];
      return [[], []];
    });
    global.fetch = vi.fn(async () => ({ json: async () => baseManifest })) as any;
  }

  it("還原修改：替換原 entry、沿用原 id、file_count 不變", async () => {
    mockRestore([
      { id: "f1", version_id: "d1", dest_path: "config/x.txt", file_url: "u-mod", file_hash: "mod".padEnd(64, "0"), file_size_bytes: 99, policy: "enforced" },
    ]);
    const req: any = { params: { serverId: "srv1", versionId: "d1" }, body: { destPath: "config/x.txt" } };
    const res = mockRes();
    await restoreFile(req, res);
    const update = findQuery("UPDATE server_modpack_versions SET draft_files");
    expect(String(update![0])).not.toContain("file_count + 1");
    const persisted = JSON.parse(update![1][0]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe("f1"); // 沿用原 id
    expect(persisted[0].file_hash).toBe("base".padEnd(64, "0")); // 還原成基底
    expect(persisted[0].policy).toBe("default"); // 還原基底 policy
  });

  it("還原刪除：加回 entry、file_count + 1", async () => {
    mockRestore([]); // draft 無此 path
    const req: any = { params: { serverId: "srv1", versionId: "d1" }, body: { destPath: "config/x.txt" } };
    const res = mockRes();
    await restoreFile(req, res);
    const update = findQuery("UPDATE server_modpack_versions SET draft_files");
    expect(String(update![0])).toContain("file_count + 1");
    const persisted = JSON.parse(update![1][0]);
    expect(persisted).toHaveLength(1);
  });

  it("基底無此 path → 404", async () => {
    mockRestore([]);
    const req: any = { params: { serverId: "srv1", versionId: "d1" }, body: { destPath: "nope/none.txt" } };
    const res = mockRes();
    await restoreFile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("無 base_version_id → 422", async () => {
    mockRestore([], { base: null });
    const req: any = { params: { serverId: "srv1", versionId: "d1" }, body: { destPath: "config/x.txt" } };
    const res = mockRes();
    await restoreFile(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("非 draft → 409", async () => {
    mockRestore([], { status: "published" });
    const req: any = { params: { serverId: "srv1", versionId: "v1" }, body: { destPath: "config/x.txt" } };
    const res = mockRes();
    await restoreFile(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("updateFilePolicy", () => {
  it("合法切換：draft 內檔案 policy 更新並回傳清單", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, draft_files"))
        return [[{ status: "draft", draft_files: JSON.stringify([{ id: "f1", dest_path: "mods/a.jar", policy: "enforced" }]) }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: { policy: "default" } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    const update = findQuery("UPDATE server_modpack_versions SET draft_files");
    const persisted = JSON.parse(update![1][0]);
    expect(persisted[0].policy).toBe("default");
    expect(res.json).toHaveBeenCalled();
  });

  it("非法 policy → 400", async () => {
    const req: any = { params: { serverId: "srv1", versionId: "d1", fileId: "f1" }, body: { policy: "bogus" } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("published → 409", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, draft_files"))
        return [[{ status: "published", draft_files: "[]" }], []];
      return [[], []];
    });
    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" }, body: { policy: "default" } };
    const res = mockRes();
    await updateFilePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});