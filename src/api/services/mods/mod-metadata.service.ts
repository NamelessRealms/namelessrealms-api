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
  /** 必要依賴 mod id 清單；[]=有解析無依賴、null=解析失敗（未落值） */
  deps: string[] | null;
}

/**
 * 將 DB 讀出的 deps 欄正規化為 `string[] | null`。
 * mysql2 對 JSON 欄多半已 parse 為 array，但保守處理字串形（真機若回字串亦不失準）。
 *
 * @param raw - DB 讀出的 deps 欄值
 */
function normalizeDepsColumn(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
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
      "INSERT IGNORE INTO mod_metadata (sha256, mod_id, mod_name, mod_version, loader_hint, icon_url, deps) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        sha256,
        parsed?.mod_id ?? null,
        parsed?.mod_name ?? null,
        parsed?.mod_version ?? null,
        parsed?.loader_hint ?? null,
        iconUrl,
        parsed ? JSON.stringify(parsed.deps) : null,
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
    "SELECT sha256, mod_id, mod_name, mod_version, loader_hint, icon_url, deps FROM mod_metadata WHERE sha256 IN (?) AND mod_name IS NOT NULL",
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
      deps: normalizeDepsColumn(r.deps),
    };
  }
  return out;
}

/**
 * 對既有 row 補解依賴：重解 jar 後僅更新 deps 欄（不動其他欄位）。供 backfill deps 模式用。
 *
 * `WHERE deps IS NULL` guard 使其冪等可重跑；parseModJar 回 null（罕見：曾成功、re-parse 失敗）
 * 則不覆蓋、留 NULL 可重試。best-effort try-catch 吞錯（與服務其餘一致）。
 *
 * @param sha256 - 池物件內容雜湊（須已存在對應 row）
 * @param buffer - 重新下載的 jar 位元組
 */
export async function backfillModDeps(sha256: string, buffer: Buffer): Promise<void> {
  try {
    const parsed = parseModJar(buffer);
    if (!parsed) return;
    await Mysql.getPool().query(
      "UPDATE mod_metadata SET deps = ? WHERE sha256 = ? AND deps IS NULL",
      [JSON.stringify(parsed.deps), sha256]
    );
  } catch (err) {
    console.error(`[mod-metadata] deps 回填失敗（best-effort，已吞）sha256=${sha256}:`, err);
  }
}