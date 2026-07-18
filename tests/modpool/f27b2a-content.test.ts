/**
 * @file f27b2a-content.test.ts
 * @description F27b-2a 檔案內容讀寫端點後端契約：
 *   - getFileContent：draft/published 讀取成功；draft_files 空舊 published → 404；
 *     size 超限 → 422（不觸發 getObject）；內容含 null byte → 422。
 *   - updateFileContent：published → 409；baseSha256 不符 → 409；成功替換（id 沿用、
 *     policy/disabled 保留、file_count 不變、url/hash/size 更新）；上傳 key 為
 *     modpacks/{serverId}/files/{sha256}{ext}（非 mods/files/）；no-op（hash 同）不上傳；
 *     超限/null byte/缺 body → 422/422/400；refs 不被寫入。
 */
import crypto from "crypto";
import { vi, describe, it, expect, beforeEach } from "vitest";

/** 計算字串/Buffer 的 sha256 裸 hex（與 controller 一致） */
const sha256 = (b: Buffer | string) =>
  crypto.createHash("sha256").update(b).digest("hex");

// vi.mock 工廠會被提升到檔案頂端，故共享 mock 用 vi.hoisted 建立。
const h = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(),
  headObjectExists: vi.fn(async () => false),
  uploadToS3: vi.fn(async (key: string) => `https://minio/bucket/${key}?v=1`),
  keyFromUrl: vi.fn((url: string) =>
    url.split("?")[0].replace("https://minio/bucket/", "")
  ),
  publicUrlForKey: vi.fn((k: string) => `https://minio/bucket/${k}?v=1`),
}));

vi.mock("../../src/api/utils/s3/s3", () => ({
  getObjectBuffer: h.getObjectBuffer,
  headObjectExists: h.headObjectExists,
  uploadToS3: h.uploadToS3,
  keyFromUrl: h.keyFromUrl,
  publicUrlForKey: h.publicUrlForKey,
}));

const poolQuery = vi.fn();
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: poolQuery, getConnection: async () => ({}) })) },
}));

import {
  getFileContent,
  updateFileContent,
} from "../../src/api/controllers/server-modpack.controller";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

/** 取出某 SQL 片段的 poolQuery 呼叫（找不到回 undefined） */
function findQuery(fragment: string) {
  return poolQuery.mock.calls.find((c) => String(c[0]).includes(fragment));
}

/** 讓版本查詢回傳指定 row（其餘查詢回空） */
function mockVersion(row: any) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT status, draft_files")) return [[row], []];
    return [[], []];
  });
}

const ORIG_URL = "https://minio/bucket/modpacks/srv1/files/" + "a".repeat(64) + ".properties?v=1";

beforeEach(() => {
  vi.clearAllMocks();
  h.headObjectExists.mockResolvedValue(false);
});

describe("getFileContent", () => {
  it("draft 讀取成功：content/sha256/size 形狀正確", async () => {
    const content = "key = value\nother=1";
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: content.length },
      ]),
    });
    h.getObjectBuffer.mockResolvedValue(Buffer.from(content, "utf8"));

    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" } };
    const res = mockRes();
    await getFileContent(req, res);

    expect(res.json).toHaveBeenCalledWith({
      content,
      sha256: "a".repeat(64),
      size: content.length,
    });
  });

  it("published 版讀取成功（draft_files 全量路徑）", async () => {
    const content = "server-name=hi";
    mockVersion({
      status: "published",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: content.length },
      ]),
    });
    h.getObjectBuffer.mockResolvedValue(Buffer.from(content, "utf8"));

    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" } };
    const res = mockRes();
    await getFileContent(req, res);

    expect((res.json as any).mock.calls[0][0].content).toBe(content);
  });

  it("draft_files 空/NULL 舊 published 版 → 404", async () => {
    mockVersion({ status: "published", draft_files: null });
    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" } };
    const res = mockRes();
    await getFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(h.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("entry.size 超限 → 422（不觸發 getObject）", async () => {
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 256 * 1024 + 1 },
      ]),
    });
    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" } };
    const res = mockRes();
    await getFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(h.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("內容含 null byte → 422", async () => {
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.bin", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 3 },
      ]),
    });
    h.getObjectBuffer.mockResolvedValue(Buffer.from([0x61, 0x00, 0x62]));
    const req: any = { params: { serverId: "srv1", versionId: "v1", fileId: "f1" } };
    const res = mockRes();
    await getFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe("updateFileContent", () => {
  it("published → 409 Conflict", async () => {
    mockVersion({ status: "published", draft_files: "[]" });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content: "x", baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as any).mock.calls[0][0].code).toBe("Conflict");
  });

  it("baseSha256 不符 → 409 Conflict", async () => {
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5 },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content: "new", baseSha256: "b".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as any).mock.calls[0][0].code).toBe("Conflict");
  });

  it("成功替換：id 沿用、policy/disabled 保留、file_count 不變、url/hash/size 更新", async () => {
    // 內容刻意含空格（真實 properties 格式）；若守門誤判為空格，此案當場翻紅。
    const content = "key = value\nother = 1";
    const newSha = sha256(Buffer.from(content, "utf8"));
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", version_id: "v1", file_name: "a.properties", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5, policy: "default", disabled: true },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content, baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);

    const update = findQuery("UPDATE server_modpack_versions SET draft_files");
    expect(String(update![0])).not.toContain("file_count");
    const persisted = JSON.parse(update![1][0]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe("f1"); // id 沿用
    expect(persisted[0].policy).toBe("default"); // policy 保留
    expect(persisted[0].disabled).toBe(true); // disabled 保留
    expect(persisted[0].file_hash).toBe(newSha); // hash 更新
    expect(persisted[0].file_size_bytes).toBe(Buffer.byteLength(content, "utf8")); // size 更新
    expect(persisted[0].file_url).toContain(newSha); // url 更新
    expect(res.json).toHaveBeenCalledWith({ sha256: newSha, size: Buffer.byteLength(content, "utf8") });
  });

  it("上傳 key 為 modpacks/{serverId}/files/{sha256}{ext}，非 mods/files/", async () => {
    const content = "difficulty = hard";
    const newSha = sha256(Buffer.from(content, "utf8"));
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5 },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content, baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);

    const uploadKey = h.uploadToS3.mock.calls[0][0];
    expect(uploadKey).toBe(`modpacks/srv1/files/${newSha}.properties`);
    expect(uploadKey).not.toContain("mods/files/");
  });

  it("no-op（新內容 hash 等於舊值）：不上傳、entry 不變、回 200", async () => {
    const content = "already = saved";
    const sameSha = sha256(Buffer.from(content, "utf8"));
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: sameSha, file_size_bytes: Buffer.byteLength(content, "utf8") },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content, baseSha256: sameSha },
    };
    const res = mockRes();
    await updateFileContent(req, res);

    expect(h.uploadToS3).not.toHaveBeenCalled();
    expect(h.headObjectExists).not.toHaveBeenCalled();
    expect(findQuery("UPDATE server_modpack_versions SET draft_files")).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith({ sha256: sameSha, size: Buffer.byteLength(content, "utf8") });
  });

  it("headObject 命中 → 跳過上傳、URL 沿用該 key", async () => {
    const content = "level = 3";
    const newSha = sha256(Buffer.from(content, "utf8"));
    h.headObjectExists.mockResolvedValue(true);
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5 },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content, baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);

    expect(h.uploadToS3).not.toHaveBeenCalled();
    const persisted = JSON.parse(findQuery("UPDATE server_modpack_versions SET draft_files")![1][0]);
    expect(persisted[0].file_url).toContain(`modpacks/srv1/files/${newSha}.properties`);
  });

  it("內容超限 → 422", async () => {
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5 },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content: "x".repeat(256 * 1024 + 1), baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(h.uploadToS3).not.toHaveBeenCalled();
  });

  it("內容含 null byte → 422", async () => {
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5 },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content: "a\0b", baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("缺 body 欄位 → 400", async () => {
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content: "x" }, // 缺 baseSha256
    };
    const res = mockRes();
    await updateFileContent(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("refs 不被寫入：PUT 成功後無 modpack_file_refs 相關 SQL", async () => {
    const content = "pvp = true";
    mockVersion({
      status: "draft",
      draft_files: JSON.stringify([
        { id: "f1", dest_path: "config/a.properties", file_url: ORIG_URL, file_hash: "a".repeat(64), file_size_bytes: 5 },
      ]),
    });
    const req: any = {
      params: { serverId: "srv1", versionId: "v1", fileId: "f1" },
      body: { content, baseSha256: "a".repeat(64) },
    };
    const res = mockRes();
    await updateFileContent(req, res);

    expect(res.json).toHaveBeenCalled();
    expect(findQuery("modpack_file_refs")).toBeUndefined();
  });
});