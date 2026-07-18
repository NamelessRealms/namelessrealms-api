/**
 * @file backfill_mod_metadata.ts
 * @description 手動回填：為全域池（mods/files/）中既有的 .jar 物件補解 mod metadata。
 *   預設模式補「尚無 row」者；--deps 模式對「有 row、mod_name 非 NULL 但 deps IS NULL」者僅補 deps。
 *   兩模式皆 dry-run 為預設（只列待處理清單與計數）；加 --confirm 才真的下載 + 解析。
 * @notes 執行前需 .env。手動觸發 only、不排程。
 *   - `ts-node backfill_mod_metadata.ts`（dry-run）/ `--confirm`（真跑）：補全新 row。
 *   - `ts-node backfill_mod_metadata.ts --deps`（dry-run）/ `--deps --confirm`（真跑）：補 deps。
 *
 * 設計約束：
 *   - 只掃 `mods/files/` 前綴、只處理 `.jar`。
 *   - 預設模式：跳過 mod_metadata 已有 row 者（含失敗記錄，不重試）。
 *   - --deps 模式：只挑 mod_name 非 NULL 且 deps IS NULL 者；backfillModDeps 帶 WHERE deps IS NULL guard，冪等可重跑。
 *   - 併發上限 4、單檔下載 60s timeout。
 *   - 「下載失敗」不落值（下輪可重試）。
 *   - 下載走池物件 public URL（假設 mods/files/ 前綴公開可讀；玩家端同步即走此 URL）。
 */
import "dotenv/config";
import path from "path";
import got from "got";
import Mysql from "./src/api/utils/mysql";
import ConfigService from "./src/config/config.service";
import { listObjectKeys, publicUrlForKey } from "./src/api/utils/s3/s3";
import { captureModMetadata, backfillModDeps } from "./src/api/services/mods/mod-metadata.service";

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

/** 取「mod_name 非 NULL 但 deps IS NULL」的 sha256 集合（deps 待補者） */
async function loadDepsPending(): Promise<Set<string>> {
  const [rows]: any = await Mysql.getPool().query(
    "SELECT sha256 FROM mod_metadata WHERE mod_name IS NOT NULL AND deps IS NULL"
  );
  return new Set(rows.map((r: any) => r.sha256));
}

/**
 * 盤出待處理的 .jar 池 key。
 * 預設模式：mod_metadata 尚無 row 者（`inSet(sha) === false`）。
 * --deps 模式：sha256 落在 deps 待補集合者（`inSet(sha) === true`）。
 *
 * @param inSet - 判定某 sha256 是否屬目標集合
 * @param want - 想要 inSet 回傳的值（預設模式 false、deps 模式 true）
 */
async function listPending(inSet: (sha: string) => boolean, want: boolean): Promise<string[]> {
  const keys = await listObjectKeys(POOL_PREFIX);
  return keys.filter(
    (k) => path.extname(k).toLowerCase() === ".jar" && inSet(sha256FromKey(k)) === want
  );
}

/**
 * 下載單一池物件並交給 handler 落庫。下載失敗只 log 不落值（下輪可重試）。
 *
 * @param key - 池物件 key
 * @param handle - 拿到 buffer 後的落庫動作（capture 或 deps 回填）
 */
async function processKey(
  key: string,
  handle: (sha256: string, buffer: Buffer) => Promise<void>
): Promise<void> {
  const sha256 = sha256FromKey(key);
  let buffer: Buffer;
  try {
    buffer = await got(publicUrlForKey(key), {
      timeout: { request: DOWNLOAD_TIMEOUT_MS },
    }).buffer();
  } catch (err) {
    console.error(`  下載失敗（不落值，可重試）：${key} — ${(err as Error).message}`);
    return;
  }
  await handle(sha256, buffer);
  console.log(`  已處理：${key}`);
}

/** 以固定併發上限逐批處理 keys */
async function runBatches(
  keys: string[],
  handle: (sha256: string, buffer: Buffer) => Promise<void>
): Promise<void> {
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((k) => processKey(k, handle)));
  }
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const depsMode = process.argv.includes("--deps");

  ConfigService.getInstance();
  Mysql.connect();

  console.log(`掃描全域池前綴：${POOL_PREFIX}（模式：${depsMode ? "deps 補值" : "補全新 row"}）`);

  let pending: string[];
  let handle: (sha256: string, buffer: Buffer) => Promise<void>;
  if (depsMode) {
    const depsPending = await loadDepsPending();
    pending = await listPending((sha) => depsPending.has(sha), true);
    handle = (sha256, buffer) => backfillModDeps(sha256, buffer);
    console.log(`\n待補 deps 的 .jar 物件數（mod_name 非 NULL 且 deps IS NULL）：${pending.length}`);
  } else {
    const existing = await loadExistingSha256();
    pending = await listPending((sha) => existing.has(sha), false);
    handle = (sha256, buffer) => captureModMetadata(sha256, buffer, ".jar");
    console.log(`\n待回填 .jar 物件數（尚無 metadata row）：${pending.length}`);
  }
  for (const key of pending) console.log(`  ${key}`);

  if (!confirm) {
    console.log(`\n[dry-run] 未下載/解析任何物件。加 --confirm 才真跑。`);
    process.exit(0);
  }

  console.log(`\n--confirm 已指定，開始下載 + 解析（併發 ${CONCURRENCY}）…`);
  await runBatches(pending, handle);
  console.log(`\n完成，共嘗試處理 ${pending.length} 個物件（下載失敗者未落值）。`);
  process.exit(0);
}

// 僅在直接執行時跑 main；被 import（測試）時不執行。
if (require.main === module) {
  main().catch((err) => {
    console.error("回填失敗：", err);
    process.exit(1);
  });
}