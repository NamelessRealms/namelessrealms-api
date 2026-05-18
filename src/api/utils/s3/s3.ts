/**
 * @file s3.ts
 * @description MinIO / S3 相容儲存的上傳工具，回傳 path-style 公開 URL
 * @methods
 *   - uploadToS3: 上傳 Buffer 至指定 key 並回傳可存取的 URL
 *   - getExtFromMime: 依 MIME type 回傳對應副檔名
 * @dependencies @aws-sdk/client-s3
 * @notes 使用 forcePathStyle = true 以相容 MinIO；endpoint 與認證由環境變數提供
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";

const endpoint = process.env.MINIO_ENDPOINT!;
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
    })
  );
  // MinIO path-style URL: http(s)://host:port/bucket/key
  return `${endpoint}/${bucket}/${key}`;
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