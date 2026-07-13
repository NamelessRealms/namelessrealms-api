/**
 * @file recycle_orphan_mods.ts
 * @description 手動回收全域池（mods/files/）中無任何引用的孤兒物件。
 *   dry-run 為預設（只列不刪）；加 --confirm 才真刪，且刪前逐一再查一次引用仍為零。
 * @notes 執行前需 .env；直接以 `ts-node recycle_orphan_mods.ts`（dry-run）或
 *        `ts-node recycle_orphan_mods.ts --confirm`（真刪）執行，執行完畢自動退出。
 *
 * 設計約束（見任務包 §5）：
 *   - 只掃 `mods/files/` 前綴；不碰歷史舊 key（modpacks/{serverId}/files/... 含現役 overrides，
 *     無 refs 且無法與舊 mod 檔區分，掃了會誤刪）。舊物件由人工在重新 publish 前一次性清除。
 *   - 禁止「解除引用當下即時刪」；本 script 為獨立手動流程，與 publish 手動錯開執行以避開 race。
 */
import "dotenv/config";
import Mysql from "./src/api/utils/mysql";
import ConfigService from "./src/config/config.service";
import { listObjectKeys, deleteFromS3 } from "./src/api/utils/s3/s3";

export const POOL_PREFIX = "mods/files/";

/** 由池 key 取出 sha256（去前綴、去副檔名；sha256 為 hex 無點，取第一段即是） */
export function sha256FromKey(key: string): string {
  return key.substring(POOL_PREFIX.length).split(".")[0];
}

/** 查某 sha256 目前的引用數 */
export async function refCount(sha256: string): Promise<number> {
  const [rows]: any = await Mysql.getPool().query(
    "SELECT COUNT(*) AS n FROM modpack_file_refs WHERE sha256 = ?",
    [sha256]
  );
  return Number(rows[0].n);
}

/** 盤出池中無任何引用（refCount === 0）的孤兒 key */
export async function listOrphans(): Promise<string[]> {
  const keys = await listObjectKeys(POOL_PREFIX);
  const orphans: string[] = [];
  for (const key of keys) {
    if ((await refCount(sha256FromKey(key))) === 0) orphans.push(key);
  }
  return orphans;
}

/** 刪除孤兒；刪前逐一再查一次引用仍為零才刪。回傳實際刪除數 */
export async function deleteOrphans(orphans: string[]): Promise<number> {
  let deleted = 0;
  for (const key of orphans) {
    if ((await refCount(sha256FromKey(key))) !== 0) {
      console.log(`  跳過（引用已非零）：${key}`);
      continue;
    }
    await deleteFromS3(key);
    deleted++;
    console.log(`  已刪除：${key}`);
  }
  return deleted;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");

  ConfigService.getInstance();
  Mysql.connect();

  console.log(`掃描全域池前綴：${POOL_PREFIX}`);
  const orphans = await listOrphans();

  console.log(`\n孤兒物件數（無任何引用）：${orphans.length}`);
  for (const key of orphans) console.log(`  ${key}`);

  if (!confirm) {
    console.log(`\n[dry-run] 未刪除任何物件。加 --confirm 才真刪。`);
    process.exit(0);
  }

  console.log(`\n--confirm 已指定，開始刪除（刪前逐一再查引用仍為零）…`);
  const deleted = await deleteOrphans(orphans);
  console.log(`\n完成，共刪除 ${deleted} 個孤兒物件。`);
  process.exit(0);
}

// 僅在直接執行時跑 main；被 import（測試）時不執行。
if (require.main === module) {
  main().catch((err) => {
    console.error("回收失敗：", err);
    process.exit(1);
  });
}
