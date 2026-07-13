/**
 * @file s3.ts
 * @description MinIO / S3 相容儲存的上傳工具，回傳 path-style 公開 URL
 * @methods
 *   - uploadToS3: 上傳 Buffer 至指定 key 並回傳可存取的 URL
 *   - getExtFromMime: 依 MIME type 回傳對應副檔名
 * @dependencies @aws-sdk/client-s3
 * @notes 使用 forcePathStyle = true 以相容 MinIO；endpoint 與認證由環境變數提供；
 *        MINIO_PUBLIC_ENDPOINT 用於組成外網可存取的 URL
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

const endpoint = process.env.MINIO_ENDPOINT!;
const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT;
const bucket = process.env.MINIO_BUCKET!;

const s3 = new S3Client({
  endpoint,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
  forcePathStyle: true,
});

/**
 * 由 key 組出可存取的公開 URL（帶 `?v=` cache-buster）。
 *
 * 供 headObject 命中、跳過上傳但仍需 URL 的情境（全域池去重）使用。
 *
 * @param key - S3 物件 key
 */
export function publicUrlForKey(key: string): string {
  return `${publicEndpoint}/${bucket}/${key}?v=${Date.now()}`;
}

export async function uploadToS3(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "no-cache",
    })
  );
  return `${publicEndpoint}/${bucket}/${key}?v=${Date.now()}`;
}

/**
 * 以串流方式將本機檔案上傳至指定 key，回傳可存取的公開 URL。
 *
 * 用於全域共用池：mod 檔先落暫存算 sha256，再以 sha256 為 key 上傳，
 * 全程不將整檔讀進記憶體（Body 走 fs.ReadStream，並帶 ContentLength）。
 *
 * @param key - S3 物件 key（例如 `mods/files/{sha256}.jar`）
 * @param filePath - 本機暫存檔路徑
 * @param contentType - 內容型別
 * @returns 可存取的公開 URL（同 uploadToS3 格式）
 */
export async function uploadFileToS3(
  key: string,
  filePath: string,
  contentType: string
): Promise<string> {
  const { size } = await fs.promises.stat(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
      CacheControl: "no-cache",
    })
  );
  return publicUrlForKey(key);
}

/**
 * 查詢指定 key 的物件是否已存在（內容定址池的去重判斷）。
 *
 * @param key - 要查詢的物件 key
 * @returns 存在回傳 true；不存在（404 / NotFound）回傳 false
 */
export async function headObjectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
      return false;
    }
    throw err;
  }
}

/**
 * 刪除 S3/MinIO 上的指定物件
 *
 * @param key - 要刪除的物件 key（例如 `servers/{id}/icon.jpg`）
 */
export async function deleteFromS3(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

/**
 * 從公開 URL 反推 S3 物件 key；無法解析時回傳 null
 *
 * @param url - 由 uploadToS3 回傳的公開 URL
 */
export function keyFromUrl(url: string): string | null {
  if (!publicEndpoint) return null;
  const prefix = `${publicEndpoint}/${bucket}/`;
  const clean = url.split("?")[0];
  if (!clean.startsWith(prefix)) return null;
  return clean.slice(prefix.length);
}

/**
 * 列出指定前綴下所有物件的 key（自動分頁）。
 *
 * @param prefix - key 前綴（例如 `mods/files/`）
 * @returns 所有符合前綴的物件 key
 */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

export function getExtFromMime(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[contentType] ?? path.extname(contentType).replace(".", "") ?? "bin";
}