/**
 * @file policy.test.ts
 * @description F30a per-file 同步策略契約：
 *   - publishVersion 僅對非缺省（default）帶出 policy，enforced/未帶省略（manifest 精簡）。
 *   - getFiles 回傳一律補上明確 policy（缺省 enforced）。
 *   - addFile 對非法 policy 值回 400（不帶 = 缺省，靜默降級難查故拒絕）。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// uploadToS3 攔截：把上傳的 manifest buffer 解析出來供斷言。
let capturedManifest: any = null;
vi.mock("../../src/api/utils/s3/s3", () => ({
  uploadToS3: vi.fn(async (_key: string, buffer: Buffer) => {
    capturedManifest = JSON.parse(buffer.toString("utf-8"));
    return "https://pool.test/manifest.json";
  }),
  headObjectExists: vi.fn(),
  uploadFileToS3: vi.fn(),
  publicUrlForKey: vi.fn((k: string) => `https://pool.test/${k}`),
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
  publishVersion,
  getFiles,
  addFile,
} from "../../src/api/controllers/server-modpack.controller";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedManifest = null;
});

describe("publishVersion policy 透傳", () => {
  it("default 檔帶出 policy；enforced 與未帶一律省略", async () => {
    const versionRow = {
      id: "v1",
      server_id: "srv1",
      mc_version: "1.20.1",
      modloader: "Fabric",
      modloader_version: "0.15",
      is_active: 0,
      status: "draft",
      draft_files: JSON.stringify([
        { dest_path: "config/xaeros.txt", file_url: "https://minio/overrides/x.txt", file_hash: "c".repeat(64), file_size_bytes: 12, policy: "default" },
        { dest_path: "mods/jei.jar", file_url: "https://minio/overrides/jei.jar", file_hash: "d".repeat(64), file_size_bytes: 34, policy: "enforced" },
        { dest_path: "mods/lib.jar", file_url: "https://minio/overrides/lib.jar", file_hash: "e".repeat(64), file_size_bytes: 56 },
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

    expect(capturedManifest).toBeTruthy();
    const byPath: Record<string, any> = Object.fromEntries(
      capturedManifest.files.map((f: any) => [f.path, f])
    );
    expect(byPath["config/xaeros.txt"].policy).toBe("default");
    expect("policy" in byPath["mods/jei.jar"]).toBe(false);
    expect("policy" in byPath["mods/lib.jar"]).toBe(false);
  });
});

describe("getFiles policy 補值", () => {
  it("published 分支：缺 policy 補 enforced，帶 policy 保留", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT status, manifest_url, draft_files"))
        return [[{ status: "published", manifest_url: "https://pool.test/manifest.json", draft_files: null }], []];
      return [[], []];
    });
    const manifest = {
      files: [
        { path: "config/xaeros.txt", url: "u1", hash: "h1", size: 1, policy: "default" },
        { path: "mods/jei.jar", url: "u2", hash: "h2", size: 2 },
      ],
    };
    global.fetch = vi.fn(async () => ({ json: async () => manifest })) as any;

    const req: any = { params: { versionId: "v1" } };
    const res = mockRes();
    await getFiles(req, res);

    const files = res.json.mock.calls[0][0];
    const byPath: Record<string, any> = Object.fromEntries(files.map((f: any) => [f.dest_path, f]));
    expect(byPath["config/xaeros.txt"].policy).toBe("default");
    expect(byPath["mods/jei.jar"].policy).toBe("enforced");
  });
});

describe("addFile policy 驗證", () => {
  it("非法 policy 值回 400", async () => {
    const req: any = {
      params: { serverId: "srv1", versionId: "v1" },
      body: { dest_path: "config/x.txt", policy: "bogus" },
      file: { originalname: "x.txt", buffer: Buffer.from("x"), mimetype: "text/plain" },
    };
    const res = mockRes();
    await addFile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});