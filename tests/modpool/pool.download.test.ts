/**
 * @file pool.download.test.ts
 * @description 全域池「真實串流下載 + 算 sha256」路徑測試：以本機 http server 餵已知位元組，
 *   mock S3（headObject/upload）與 Mysql。涵蓋 key 無 serverId、headObject 命中跳過、
 *   Modrinth 下載後親算 sha256（池 key）+ 以 API sha512 完整性核對（相符上傳、不符/缺 sha512 報錯）。
 * @notes Modrinth API 只給 sha512/sha1（不含 sha256），故池一律下載後親算 sha256、無 sha256-免下載。
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { startBytesServer, type TestServer } from "../helpers/httpServer";

vi.mock("../../src/api/utils/s3/s3", () => ({
  headObjectExists: vi.fn(),
  uploadFileToS3: vi.fn(async () => "https://pool.test/uploaded"),
  uploadToS3: vi.fn(async () => "https://pool.test/uploaded"),
  publicUrlForKey: vi.fn((key: string) => `https://pool.test/${key}`),
}));
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: vi.fn(async () => [[], []]) })) },
}));

import * as s3 from "../../src/api/utils/s3/s3";
import {
  ensureBufferInPool,
  ensureModrinthFileInPool,
  createImportLimiter,
  PoolResolveError,
} from "../../src/api/utils/modpool/pool";

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const sha512 = (b: Buffer) => crypto.createHash("sha512").update(b).digest("hex");

let server: TestServer | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

describe("ensureBufferInPool（手動上傳）", () => {
  it("池 key 為 mods/files/{sha256}{ext}（無 serverId），未命中則上傳", async () => {
    (s3.headObjectExists as any).mockResolvedValue(false);
    const buf = Buffer.from("hello world");
    const expected = sha256(buf);

    const r = await ensureBufferInPool(buf, "mod.jar", "application/java-archive");

    expect(r.sha256).toBe(expected);
    expect(s3.headObjectExists).toHaveBeenCalledWith(`mods/files/${expected}.jar`);
    expect(s3.uploadToS3).toHaveBeenCalledWith(
      `mods/files/${expected}.jar`,
      buf,
      "application/java-archive"
    );
  });

  it("headObject 命中 → 跳過上傳", async () => {
    (s3.headObjectExists as any).mockResolvedValue(true);
    await ensureBufferInPool(Buffer.from("hello world"), "mod.jar", "ct");
    expect(s3.uploadToS3).not.toHaveBeenCalled();
  });
});

describe("ensureModrinthFileInPool（sha512 核對，親算 sha256 當池 key）", () => {
  it("缺有效 sha512 → 報錯（PoolResolveError），不下載", async () => {
    const body = Buffer.from("no sha512");
    server = await startBytesServer(body);
    const f = {
      path: "mods/x.jar",
      hashes: { sha1: "abc" }, // 無 sha512
      downloads: [`${server.url}/x.jar`],
      fileSize: body.length,
    };
    await expect(
      ensureModrinthFileInPool(f, createImportLimiter())
    ).rejects.toBeInstanceOf(PoolResolveError);
    expect(server.count()).toBe(0);
  });

  it("下載 → 親算 sha256 當池 key、以 API sha512 核對相符 → 上傳", async () => {
    (s3.headObjectExists as any).mockResolvedValue(false);
    const body = Buffer.from("real streamed bytes");
    server = await startBytesServer(body);

    const f = {
      path: "mods/x.jar",
      hashes: { sha512: sha512(body) },
      downloads: [`${server.url}/x.jar`],
      fileSize: body.length,
    };
    const r = await ensureModrinthFileInPool(f, createImportLimiter());

    expect(server.count()).toBe(1);
    expect(r.sha256).toBe(sha256(body)); // 池 key 為親算 sha256
    expect(r.size).toBe(body.length);
    expect(s3.uploadFileToS3).toHaveBeenCalledWith(
      `mods/files/${sha256(body)}.jar`,
      expect.any(String),
      "application/octet-stream"
    );
  });

  it("親算 sha512 與 API sha512 不符 → 報錯（PoolResolveError），不上傳", async () => {
    (s3.headObjectExists as any).mockResolvedValue(false);
    const body = Buffer.from("served bytes");
    server = await startBytesServer(body);

    const f = {
      path: "mods/x.jar",
      hashes: { sha512: "a".repeat(128) }, // 與實際內容不符
      downloads: [`${server.url}/x.jar`],
      fileSize: body.length,
    };
    await expect(
      ensureModrinthFileInPool(f, createImportLimiter())
    ).rejects.toBeInstanceOf(PoolResolveError);
    expect(s3.uploadFileToS3).not.toHaveBeenCalled();
  });

  it("池 key（親算 sha256）headObject 命中 → 仍下載算 sha256，但跳過上傳", async () => {
    (s3.headObjectExists as any).mockResolvedValue(true);
    const body = Buffer.from("already pooled bytes");
    server = await startBytesServer(body);

    const f = {
      path: "mods/x.jar",
      hashes: { sha512: sha512(body) },
      downloads: [`${server.url}/x.jar`],
      fileSize: body.length,
    };
    const r = await ensureModrinthFileInPool(f, createImportLimiter());

    expect(server.count()).toBe(1); // 無 sha256-免下載：仍需下載算 sha256
    expect(s3.uploadFileToS3).not.toHaveBeenCalled(); // headObject 命中 → 免上傳
    expect(r.sha256).toBe(sha256(body));
  });
});
