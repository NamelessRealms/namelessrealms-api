/**
 * @file publish-refs.test.ts
 * @description publishVersion 引用計數測試：只對 url 指向 mods/files/ 池的條目寫 refs
 *   （overrides 條目跳過）；DELETE 舊列 + INSERT 新列於同一 transaction（beginTransaction/commit/release）。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/api/utils/s3/s3", () => ({
  uploadToS3: vi.fn(async () => "https://pool.test/manifest.json"),
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

import { publishVersion } from "../../src/api/controllers/server-modpack.controller";

const POOL_SHA = "a".repeat(64);
const OVERRIDE_SHA = "b".repeat(64);

const versionRow = {
  id: "v1",
  server_id: "srv1",
  mc_version: "1.20.1",
  modloader: "Fabric",
  modloader_version: "0.15",
  is_active: 0,
  status: "draft",
  draft_files: JSON.stringify([
    // 池條目（url 指向 mods/files/）→ 應寫 refs
    {
      dest_path: "mods/a.jar",
      file_url: `https://minio/bucket/mods/files/${POOL_SHA}.jar?v=1`,
      file_hash: POOL_SHA,
      file_size_bytes: 10,
    },
    // overrides 條目（url 指向 modpacks/{serverId}/files/）→ 不寫 refs
    {
      dest_path: "config/b.txt",
      file_url: `https://minio/bucket/modpacks/srv1/files/${OVERRIDE_SHA}.txt?v=1`,
      file_hash: OVERRIDE_SHA,
      file_size_bytes: 5,
    },
  ]),
};

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("WHERE id = ? AND server_id = ?")) return [[versionRow], []];
    if (sql.startsWith("SELECT * FROM server_modpack_versions WHERE id = ?"))
      return [[{ ...versionRow, status: "published" }], []];
    return [[], []];
  });
});

describe("publishVersion 引用計數", () => {
  it("只對池條目寫 refs，overrides 條目跳過；DELETE+INSERT 於同一 transaction", async () => {
    const req: any = { params: { serverId: "srv1", versionId: "v1" } };
    const res = mockRes();

    await publishVersion(req, res);

    // transaction 邊界
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();

    // 重 publish：先 DELETE 該 version 全部舊列
    const del = connQuery.mock.calls.find((c) =>
      String(c[0]).startsWith("DELETE FROM modpack_file_refs")
    );
    expect(del).toBeTruthy();
    expect(del![1]).toEqual(["v1"]);

    // 只插入池條目的 sha256（不含 overrides 的 sha256）
    const inserts = connQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT IGNORE INTO modpack_file_refs")
    );
    const insertedShas = inserts.map((c) => c[1][0]);
    expect(insertedShas).toEqual([POOL_SHA]);
    expect(insertedShas).not.toContain(OVERRIDE_SHA);

    expect(res.json).toHaveBeenCalled();
  });
});
