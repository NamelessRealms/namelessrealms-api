/**
 * @file pool.ts
 * @description mod 檔全域共用池：三來源（CF / Modrinth / 手動）收斂同一條路——
 *   取得 sha256 → headObject 查 `mods/files/{sha256}{ext}` → 未命中才下載/上傳 →
 *   回傳 sha256 + 池 url。含吞吐強化：全域併發上限、in-flight 去重、重試退避、CF 快取表。
 * @notes 位元組以串流計算 sha256、落暫存後再上傳，全程不將整檔讀進記憶體。
 * @dependencies got, @aws-sdk（透過 s3 util）, mysql2（透過 Mysql）
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import got from "got";
import Mysql from "../mysql";
import {
  headObjectExists,
  publicUrlForKey,
  uploadFileToS3,
  uploadToS3,
} from "../s3/s3";
import { flxCurseforgeDownloadUrlNullIssues } from "./curseforge-url";
import { captureModMetadataFromFile } from "../../services/mods/mod-metadata.service";

/** 整個 process 同時進行的「下載+雜湊」總數上限（罩住所有匯入） */
const GLOBAL_CONCURRENCY = 16;
/** 單一匯入內的併發上限 */
const PER_IMPORT_CONCURRENCY = 8;
/** 逐檔下載 timeout（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** 單檔下載重試次數（不含首次） */
const RETRY_LIMIT = 2;
/** 重試指數退避的基底延遲（毫秒） */
const RETRY_BASE_DELAY_MS = 500;

/** 已進池的檔案：內容雜湊、池 url、位元組數 */
export interface PoolFile {
  sha256: string;
  url: string;
  size: number;
}

/** CurseForge 檔案的最小輸入（由 CF API 回應萃取） */
export interface CurseforgeFileInput {
  fileId: number;
  fileName: string;
  downloadUrl?: string | null;
}

/** 併發限流器：以 fn 包住受限工作 */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * 檔案無法進池（下載失敗、雜湊不符、URL 重建失敗等）；帶檔名供 422 failures 清單使用。
 */
export class PoolResolveError extends Error {
  constructor(
    public readonly fileName: string,
    message: string
  ) {
    super(message);
    this.name = "PoolResolveError";
  }
}

/** 計數信號量：限制同時執行的非同步工作數 */
class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

/** 全域「下載+雜湊」信號量（跨所有匯入） */
const globalSemaphore = new Semaphore(GLOBAL_CONCURRENCY);

/**
 * 建立單一匯入用的限流器（併發上限 PER_IMPORT_CONCURRENCY）。
 * 每次匯入呼叫一次，將回傳的 limiter 傳給該匯入的各檔案解析。
 */
export function createImportLimiter(): Limiter {
  const semaphore = new Semaphore(PER_IMPORT_CONCURRENCY);
  return (fn) => semaphore.run(fn);
}

/** in-flight 去重：同鍵（CF fileId / Modrinth sha256）並發時只實際下載一次 */
const inFlight = new Map<string, Promise<PoolFile>>();

/**
 * 以 key 對進行中的解析去重：第二個同鍵呼叫者等第一個的結果，不重複下載。
 * 完成（成功或失敗）即從集合移除，讓後續匯入可重新嘗試。
 */
function dedup(key: string, fn: () => Promise<PoolFile>): Promise<PoolFile> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** 睡眠指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 以指數退避重試非同步工作，最多重試 RETRY_LIMIT 次。
 *
 * @param fn 要執行的工作
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_LIMIT) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

/** 由檔名/路徑取副檔名（含點，如 `.jar`；無副檔名則空字串） */
function extFromName(name: string): string {
  return path.extname(name);
}

/** 全域池 key：`mods/files/{sha256}{ext}`（無 serverId，內容定址） */
function poolKey(sha256: string, ext: string): string {
  return `mods/files/${sha256}${ext}`;
}

/**
 * 串流下載至暫存檔並邊下載邊算 sha256（不整檔進記憶體）。
 *
 * @param url 下載 URL
 * @param headers 額外 header（forgecdn 需帶 `x-api-key`）
 * @returns sha256、位元組數與暫存檔路徑（呼叫端負責刪除）
 */
async function downloadAndHashToTemp(
  url: string,
  headers: Record<string, string>
): Promise<{ sha256: string; size: number; tmpPath: string }> {
  const tmpPath = path.join(os.tmpdir(), `modpool-${crypto.randomUUID()}.tmp`);
  const hash = crypto.createHash("sha256");
  const hasher = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  const source = got.stream(url, {
    headers,
    timeout: { request: DOWNLOAD_TIMEOUT_MS },
    retry: 0,
  });

  try {
    await pipeline(source, hasher, fs.createWriteStream(tmpPath));
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true });
    throw err;
  }

  const { size } = await fs.promises.stat(tmpPath);
  return { sha256: hash.digest("hex"), size, tmpPath };
}

/** 查 CF 快取表（後端親算值） */
async function getCfCache(
  fileId: number
): Promise<{ sha256: string; file_size: number } | null> {
  const [rows]: any = await Mysql.getPool().query(
    "SELECT sha256, file_size FROM cf_file_hashes WHERE cf_file_id = ?",
    [fileId]
  );
  if (!rows.length) return null;
  return { sha256: rows[0].sha256, file_size: Number(rows[0].file_size) };
}

/** 寫入 CF 快取表（只寫後端親算值，撞鍵忽略） */
async function putCfCache(
  fileId: number,
  sha256: string,
  size: number
): Promise<void> {
  await Mysql.getPool().query(
    "INSERT IGNORE INTO cf_file_hashes (cf_file_id, sha256, file_size) VALUES (?, ?, ?)",
    [fileId, sha256, size]
  );
}

/**
 * 確保 CurseForge 檔案已進全域池，回傳 sha256 + 池 url。
 *
 * 流程：查 cf_file_hashes 快取（命中 → headObject → 零下載）；未命中則取 downloadUrl
 * （空時以 forgecdn 慣例 fallback 重建），帶 `x-api-key` 串流下載、算 sha256、上傳池、寫快取。
 *
 * @param file CF 檔案輸入（fileId / fileName / downloadUrl）
 * @param curseforgeKey forgecdn 下載必帶的 API key
 * @param limiter 單一匯入的併發限流器
 * @throws {PoolResolveError} URL 重建失敗、下載失敗（含 fallback 亦 404/401）
 */
export async function ensureCurseforgeFileInPool(
  file: CurseforgeFileInput,
  curseforgeKey: string,
  limiter: Limiter
): Promise<PoolFile> {
  const { fileId, fileName } = file;
  const ext = extFromName(fileName);

  return dedup(`cf:${fileId}`, async () => {
    // 1. 快取命中 → headObject（幾乎必命中）→ 零下載
    const cached = await getCfCache(fileId);
    if (cached) {
      const key = poolKey(cached.sha256, ext);
      if (await headObjectExists(key)) {
        return { sha256: cached.sha256, url: publicUrlForKey(key), size: cached.file_size };
      }
      // 快取有但池物件不在（罕見）→ 落到下載重新補池
    }

    // 2. 下載 URL：優先 API 給的，空則 fallback 重建
    let url = file.downloadUrl ?? undefined;
    if (!url) {
      try {
        url = flxCurseforgeDownloadUrlNullIssues(fileId, fileName);
      } catch (err) {
        throw new PoolResolveError(fileName, `URL 重建失敗：${(err as Error).message}`);
      }
    }

    // 3. 併發限流 + 重試下 串流下載（forgecdn 一律帶 x-api-key）
    let dl: { sha256: string; size: number; tmpPath: string };
    try {
      dl = await limiter(() =>
        globalSemaphore.run(() =>
          withRetry(() => downloadAndHashToTemp(url!, { "x-api-key": curseforgeKey }))
        )
      );
    } catch (err) {
      throw new PoolResolveError(fileName, `下載失敗：${(err as Error).message}`);
    }

    try {
      const key = poolKey(dl.sha256, ext);
      if (!(await headObjectExists(key))) {
        await uploadFileToS3(key, dl.tmpPath, "application/octet-stream");
      }
      await putCfCache(fileId, dl.sha256, dl.size);
      // 位元組在手（暫存檔）→ 順路解 metadata 落庫（best-effort，須在 finally 清檔前）。
      await captureModMetadataFromFile(dl.sha256, dl.tmpPath, ext);
      return { sha256: dl.sha256, url: publicUrlForKey(key), size: dl.size };
    } finally {
      await fs.promises.rm(dl.tmpPath, { force: true });
    }
  });
}

/**
 * 確保 Modrinth 檔案已進全域池，回傳 sha256 + 池 url。
 *
 * Modrinth API 直接給 sha256 → 先 headObject（命中連下載都免）；未命中才下載，
 * 並親算 sha256 與 API 值核對（不符報錯）後上傳池。
 *
 * @param f Modrinth index 的檔案項（path / hashes.sha256 / downloads / fileSize）
 * @param limiter 單一匯入的併發限流器
 * @throws {PoolResolveError} 缺 sha256/下載連結、下載失敗、親算與 API 值不符
 */
export async function ensureModrinthFileInPool(
  f: any,
  limiter: Limiter
): Promise<PoolFile> {
  const fileName = path.basename(f.path ?? "");
  const apiSha256 = String(f.hashes?.sha256 ?? "").toLowerCase();
  const ext = extFromName(f.path ?? "");

  if (!/^[0-9a-f]{64}$/.test(apiSha256)) {
    throw new PoolResolveError(fileName, "Modrinth 檔案缺少有效 sha256");
  }

  return dedup(`mr:${apiSha256}`, async () => {
    const key = poolKey(apiSha256, ext);
    // headObject 命中 → 連下載都免
    if (await headObjectExists(key)) {
      return { sha256: apiSha256, url: publicUrlForKey(key), size: Number(f.fileSize ?? 0) };
    }

    const downloadUrl = f.downloads?.[0];
    if (!downloadUrl) {
      throw new PoolResolveError(fileName, "Modrinth 檔案缺少下載連結");
    }

    let dl: { sha256: string; size: number; tmpPath: string };
    try {
      dl = await limiter(() =>
        globalSemaphore.run(() => withRetry(() => downloadAndHashToTemp(downloadUrl, {})))
      );
    } catch (err) {
      throw new PoolResolveError(fileName, `下載失敗：${(err as Error).message}`);
    }

    try {
      if (dl.sha256 !== apiSha256) {
        throw new PoolResolveError(
          fileName,
          `sha256 不符：API=${apiSha256} 親算=${dl.sha256}`
        );
      }
      if (!(await headObjectExists(key))) {
        await uploadFileToS3(key, dl.tmpPath, "application/octet-stream");
      }
      // 位元組在手（暫存檔）→ 順路解 metadata 落庫（best-effort，須在 finally 清檔前）。
      await captureModMetadataFromFile(apiSha256, dl.tmpPath, ext);
      return { sha256: apiSha256, url: publicUrlForKey(key), size: dl.size };
    } finally {
      await fs.promises.rm(dl.tmpPath, { force: true });
    }
  });
}

/**
 * 確保手上位元組已進全域池（手動上傳；位元組已在記憶體，直接算 sha256）。
 *
 * @param buffer 檔案位元組
 * @param fileName 原始檔名（取副檔名用）
 * @param contentType 內容型別
 */
export async function ensureBufferInPool(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<PoolFile> {
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const key = poolKey(sha256, extFromName(fileName));
  if (!(await headObjectExists(key))) {
    await uploadToS3(key, buffer, contentType);
  }
  return { sha256, url: publicUrlForKey(key), size: buffer.length };
}
