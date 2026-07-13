/**
 * @file pool.curseforge.test.ts
 * @description CF 進池路徑測試（mock got 以攔截 URL/headers）：cf_file_hashes 命中免下載、
 *   親算後寫快取、downloadUrl 空走 fallback 重建、forgecdn 帶 x-api-key、fallback 失敗 → 報錯、
 *   in-flight 去重（同 fileId 並發只下載一次）。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Readable } from "stream";
import crypto from "crypto";

const { streamMock, queryMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  queryMock: vi.fn(),
}));
vi.mock("got", () => ({ default: { stream: streamMock } }));

vi.mock("../../src/api/utils/s3/s3", () => ({
  headObjectExists: vi.fn(),
  uploadFileToS3: vi.fn(async () => "https://pool.test/uploaded"),
  uploadToS3: vi.fn(async () => "https://pool.test/uploaded"),
  publicUrlForKey: vi.fn((key: string) => `https://pool.test/${key}`),
}));

vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: queryMock })) },
}));

import * as s3 from "../../src/api/utils/s3/s3";
import {
  ensureCurseforgeFileInPool,
  createImportLimiter,
  PoolResolveError,
} from "../../src/api/utils/modpool/pool";

const BODY = Buffer.from("curseforge mod bytes");
const BODY_SHA = crypto.createHash("sha256").update(BODY).digest("hex");

/** 預設 Mysql 行為：cf_file_hashes 查詢未命中、INSERT 成功 */
function cacheMiss() {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT sha256, file_size FROM cf_file_hashes")) return [[], []];
    return [{}, []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  streamMock.mockImplementation(() => Readable.from([BODY]));
});

describe("ensureCurseforgeFileInPool", () => {
  it("cf_file_hashes 命中 → 不下載", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT sha256, file_size FROM cf_file_hashes"))
        return [[{ sha256: BODY_SHA, file_size: BODY.length }], []];
      return [{}, []];
    });
    (s3.headObjectExists as any).mockResolvedValue(true);

    const r = await ensureCurseforgeFileInPool(
      { fileId: 6000001, fileName: "mod.jar", downloadUrl: "http://unused" },
      "KEY",
      createImportLimiter()
    );

    expect(streamMock).not.toHaveBeenCalled();
    expect(r.sha256).toBe(BODY_SHA);
  });

  it("親算後寫入 cf_file_hashes（INSERT IGNORE）", async () => {
    cacheMiss();
    (s3.headObjectExists as any).mockResolvedValue(false);

    await ensureCurseforgeFileInPool(
      { fileId: 6000002, fileName: "mod.jar", downloadUrl: "https://edge.forgecdn.net/x" },
      "KEY",
      createImportLimiter()
    );

    const insert = queryMock.mock.calls.find((c) =>
      String(c[0]).startsWith("INSERT IGNORE INTO cf_file_hashes")
    );
    expect(insert).toBeTruthy();
    expect(insert![1]).toEqual([6000002, BODY_SHA, BODY.length]);
  });

  it("downloadUrl 空 → fallback 重建 forgecdn URL，且帶 x-api-key", async () => {
    cacheMiss();
    (s3.headObjectExists as any).mockResolvedValue(false);

    await ensureCurseforgeFileInPool(
      { fileId: 3215435, fileName: "mod.jar", downloadUrl: null },
      "KEY123",
      createImportLimiter()
    );

    expect(streamMock).toHaveBeenCalledTimes(1);
    const [url, opts] = streamMock.mock.calls[0];
    expect(url).toBe("https://edge.forgecdn.net/files/3215/435/mod.jar");
    expect(opts.headers["x-api-key"]).toBe("KEY123");
  });

  it("fallback 亦失敗（下載 error）→ PoolResolveError", async () => {
    cacheMiss();
    (s3.headObjectExists as any).mockResolvedValue(false);
    streamMock.mockImplementation(() =>
      Readable.from(
        (async function* () {
          throw new Error("HTTP 401");
        })()
      )
    );

    await expect(
      ensureCurseforgeFileInPool(
        { fileId: 3272032, fileName: "x.jar", downloadUrl: null },
        "KEY",
        createImportLimiter()
      )
    ).rejects.toBeInstanceOf(PoolResolveError);
  });

  it("in-flight 去重：同 fileId 並發只下載一次", async () => {
    cacheMiss();
    (s3.headObjectExists as any).mockResolvedValue(false);

    const limiter = createImportLimiter();
    const [r1, r2] = await Promise.all([
      ensureCurseforgeFileInPool({ fileId: 7000001, fileName: "a.jar", downloadUrl: "https://x/a" }, "K", limiter),
      ensureCurseforgeFileInPool({ fileId: 7000001, fileName: "a.jar", downloadUrl: "https://x/a" }, "K", limiter),
    ]);

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(r1.sha256).toBe(r2.sha256);
  });
});
