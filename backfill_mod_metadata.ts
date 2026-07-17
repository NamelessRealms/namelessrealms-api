/**
 * @file backfill_mod_metadata.ts
 * @description 手動回填：為全域池（mods/files/）中既有的 .jar 物件補解 mod metadata。
 *   dry-run 為預設（只列待處理清單與計數）；加 --confirm 才真的下載 + 解析落庫。
 * @notes 執行前需 .env；`ts-node backfill_mod_metadata.ts`（dry-run）或
 *        `ts-node backfill_mod_metadata.ts --confirm`（真跑）。手動觸發 only、不排程。
 *
 * 設計約束：
 *   - 只掃 `mods/files/` 前綴、只處理 `.jar`；跳過 mod_metadata 已有 row 者（含失敗記錄，不重試）。
 *   - 併發上限 4、單檔下載 60s timeout。
 *   - 「下載失敗」不落 row（下輪可重試）；「解析失敗」由 captureModMetadata 落全 NULL row。
 *   - 下載走池物件 public URL（假設 mods/files/ 前綴公開可讀；玩家端同步即走此 URL）。
 */
import "dotenv/config";
import path from "path";
import got from "got";
import Mysql from "./src/api/utils/mysql";
import ConfigService from "./src/config/config.service";
import { listObjectKeys, publicUrlForKey } from "./src/api/utils/s3/s3";
import { captureModMetadata } from "./src/api/services/mods/mod-metadata.service";

const POOL_PREFIX = "mods/files/";
const CONCURRENCY = 4;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** 由池 key 取出 sha256（去前綴、去副檔名） */
function sha256FromKey(key: string): string {
  return key.substring(POOL_PREFIX.length).split(".")[0];
}

/** 取 mod_metadata 中已存在的 sha256 集合（已嘗試過者不重跑） */
async function loadExistingSha256(): Promise<Set<string>> {
  const [rows]: any = await Mysql.getPool().query("SELECT sha256 FROM mod_metadata");
  return new Set(rows.map((r: any) => r.sha256));
}

/**
 * 盤出待處理的 .jar 池 key：屬 mods/files/ 前綴、副檔名 .jar、且 mod_metadata 尚無 row。
 */
async function listPending(existing: Set<string>): Promise<string[]> {
  const keys = await listObjectKeys(POOL_PREFIX);
  return keys.filter(
    (k) => path.extname(k).toLowerCase() === ".jar" && !existing.has(sha256FromKey(k))
  );
}

/**
 * 下載單一池物件並解析落庫。下載失敗只 log 不落 row（下輪可重試）；
 * 解析成敗一律由 captureModMetadata 決定（失敗落全 NULL row）。
 */
async function processKey(key: string): Promise<void> {
  const sha256 = sha256FromKey(key);
  let buffer: Buffer;
  try {
    buffer = await got(publicUrlForKey(key), {
      timeout: { request: DOWNLOAD_TIMEOUT_MS },
    }).buffer();
  } catch (err) {
    console.error(`  下載失敗（不落 row，可重試）：${key} — ${(err as Error).message}`);
    return;
  }
  await captureModMetadata(sha256, buffer, ".jar");
  console.log(`  已處理：${key}`);
}

/** 以固定併發上限逐批處理 keys */
async function runBatches(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processKey));
  }
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");

  ConfigService.getInstance();
  Mysql.connect();

  console.log(`掃描全域池前綴：${POOL_PREFIX}`);
  const existing = await loadExistingSha256();
  const pending = await listPending(existing);

  console.log(`\n待回填 .jar 物件數（尚無 metadata row）：${pending.length}`);
  for (const key of pending) console.log(`  ${key}`);

  if (!confirm) {
    console.log(`\n[dry-run] 未下載/解析任何物件。加 --confirm 才真跑。`);
    process.exit(0);
  }

  console.log(`\n--confirm 已指定，開始下載 + 解析（併發 ${CONCURRENCY}）…`);
  await runBatches(pending);
  console.log(`\n完成，共嘗試回填 ${pending.length} 個物件（下載失敗者未落 row）。`);
  process.exit(0);
}

// 僅在直接執行時跑 main；被 import（測試）時不執行。
if (require.main === module) {
  main().catch((err) => {
    console.error("回填失敗：", err);
    process.exit(1);
  });
}