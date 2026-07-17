/**
 * @file mod-metadata.service.ts
 * @description 池物件（sha256）的 mod metadata 落庫與查詢服務。
 *   匯入/上傳時順路解 jar 落庫（best-effort，絕不影響主流程）；批次查詢供前端顯示名稱/icon。
 * @dependencies modJarParser（純解析）, Mysql, s3
 */
import fs from "fs";
import Mysql from "../../utils/mysql";
import { headObjectExists, uploadToS3, publicUrlForKey } from "../../utils/s3/s3";
import { parseModJar } from "../../utils/modJarParser";

/** lookup 回傳的單筆 metadata 視圖 */
export interface ModMetadataView {
  mod_id: string | null;
  mod_name: string | null;
  mod_version: string | null;
  loader_hint: string | null;
  icon_url: string | null;
}

/**
 * 解析 jar 位元組並以 sha256 為鍵落庫（含 icon 上傳）。best-effort：
 * 全程外層 try-catch，任何錯誤只 log 不 throw——metadata 是附屬品，絕不使匯入/上傳失敗。
 *
 * 語意：解析失敗也落一列（全 NULL），代表「已嘗試、不可解析」，避免掛鉤/backfill 重複嘗試。
 *
 * @param sha256 - 池物件內容雜湊
 * @param buffer - jar 檔位元組
 * @param ext - 副檔名（含點，如 `.jar`）；非 `.jar` 直接略過
 */
export async function captureModMetadata(sha256: string, buffer: Buffer, ext: string): Promise<void> {
  try {
    if (ext.toLowerCase() !== ".jar") return;

    const [rows]: any = await Mysql.getPool().query(
      "SELECT 1 FROM mod_metadata WHERE sha256 = ?",
      [sha256]
    );
    if (rows.length) return; // 已嘗試過（含失敗記錄）→ 不重試

    const parsed = parseModJar(buffer);

    let iconUrl: string | null = null;
    if (parsed?.iconBytes) {
      const key = `mods/icons/${sha256}.png`;
      if (!(await headObjectExists(key))) {
        await uploadToS3(key, parsed.iconBytes, "image/png");
      }
      iconUrl = publicUrlForKey(key);
    }

    await Mysql.getPool().query(
      "INSERT IGNORE INTO mod_metadata (sha256, mod_id, mod_name, mod_version, loader_hint, icon_url) VALUES (?, ?, ?, ?, ?, ?)",
      [
        sha256,
        parsed?.mod_id ?? null,
        parsed?.mod_name ?? null,
        parsed?.mod_version ?? null,
        parsed?.loader_hint ?? null,
        iconUrl,
      ]
    );
  } catch (err) {
    console.error(`[mod-metadata] capture 失敗（best-effort，已吞）sha256=${sha256}:`, err);
  }
}

/**
 * 供 CF/Modrinth 匯入路徑使用：位元組在磁碟暫存檔（非記憶體），先讀回 Buffer 再委派 capture。
 * 本地讀檔零網路成本，符合「不另起下載」精神；讀檔失敗同樣吞錯不影響主流程。
 *
 * @param sha256 - 池物件內容雜湊
 * @param filePath - 下載後的本機暫存檔路徑（呼叫點須在暫存檔清理前）
 * @param ext - 副檔名（含點）
 */
export async function captureModMetadataFromFile(
  sha256: string,
  filePath: string,
  ext: string
): Promise<void> {
  try {
    if (ext.toLowerCase() !== ".jar") return;
    const buffer = await fs.promises.readFile(filePath);
    await captureModMetadata(sha256, buffer, ext);
  } catch (err) {
    console.error(`[mod-metadata] 讀檔失敗（best-effort，已吞）sha256=${sha256}:`, err);
  }
}

/**
 * 批次查詢 metadata：只回有 row 且 mod_name 非 NULL 的項（失敗記錄對前端等同不存在，fallback 檔名）。
 *
 * 使用 `query`（非 `execute`）以讓 mysql2 對陣列參數展開成 `IN (?, ?, ...)`。
 *
 * @param hashes - sha256 陣列（呼叫端須先做上限/去重把關）
 * @returns `{ [sha256]: ModMetadataView }`
 */
export async function lookupModMetadata(hashes: string[]): Promise<Record<string, ModMetadataView>> {
  if (!hashes.length) return {};

  const [rows]: any = await Mysql.getPool().query(
    "SELECT sha256, mod_id, mod_name, mod_version, loader_hint, icon_url FROM mod_metadata WHERE sha256 IN (?) AND mod_name IS NOT NULL",
    [hashes]
  );

  const out: Record<string, ModMetadataView> = {};
  for (const r of rows) {
    out[r.sha256] = {
      mod_id: r.mod_id,
      mod_name: r.mod_name,
      mod_version: r.mod_version,
      loader_hint: r.loader_hint,
      icon_url: r.icon_url,
    };
  }
  return out;
}