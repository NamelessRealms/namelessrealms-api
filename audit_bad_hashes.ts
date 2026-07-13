/**
 * @file audit_bad_hashes.ts
 * @description 唯讀盤點：找出 file_hash 不是合法 sha256（^[0-9a-fA-F]{64}$）的檔案。
 *   draft 版本掃 draft_files JSON；published 版本逐一 fetch manifest_url。
 *   只 SELECT / fetch，不寫入、不 migration。修復方式為重新匯入 / publish（見任務包 §7）。
 * @notes 執行前需 .env；直接以 `ts-node audit_bad_hashes.ts` 執行，執行完畢自動退出。
 */
import "dotenv/config";
import Mysql from "./src/api/utils/mysql";
import ConfigService from "./src/config/config.service";

const SHA256_RE = /^[0-9a-fA-F]{64}$/;

interface BadEntry {
  version_id: string;
  status: string;
  file_name: string;
  file_hash: string;
  source: "draft_files" | "manifest";
}

async function main(): Promise<void> {
  ConfigService.getInstance();
  Mysql.connect();

  const [versions]: any = await Mysql.getPool().query(
    "SELECT id, status, manifest_url, draft_files FROM server_modpack_versions"
  );

  const bad: BadEntry[] = [];
  let draftScanned = 0;
  let publishedScanned = 0;

  for (const v of versions as any[]) {
    if (v.status === "published" && v.manifest_url) {
      publishedScanned++;
      try {
        const resp = await fetch(v.manifest_url);
        const manifest: any = await resp.json();
        for (const f of (manifest.files as any[]) ?? []) {
          if (!SHA256_RE.test(String(f.hash ?? ""))) {
            bad.push({
              version_id: v.id,
              status: v.status,
              file_name: String(f.path ?? "").split("/").pop() ?? "",
              file_hash: String(f.hash ?? ""),
              source: "manifest",
            });
          }
        }
      } catch (err) {
        console.warn(`  無法讀取 manifest（version ${v.id}）：${(err as Error).message}`);
      }
    } else {
      draftScanned++;
      const files: any[] = JSON.parse(v.draft_files || "[]");
      for (const f of files) {
        if (!SHA256_RE.test(String(f.file_hash ?? ""))) {
          bad.push({
            version_id: v.id,
            status: v.status,
            file_name: String(f.file_name ?? ""),
            file_hash: String(f.file_hash ?? ""),
            source: "draft_files",
          });
        }
      }
    }
  }

  console.log(`\n=== 壞雜湊盤點結果（唯讀） ===`);
  console.log(`版本總數：${(versions as any[]).length}（draft ${draftScanned} / published ${publishedScanned}）`);
  console.log(`壞雜湊筆數：${bad.length}\n`);
  for (const e of bad) {
    console.log(
      `  [${e.status}/${e.source}] version=${e.version_id} file=${e.file_name} hash=${e.file_hash}`
    );
  }

  console.log(`\n選項（不自動執行）：`);
  console.log(`  1. 對受影響版本重新匯入（importVersion）→ 走新流程算 sha256 進池。`);
  console.log(`  2. 對受影響 published 版本重新 publish（需先重建 draft_files）。`);
  console.log(`  3. 若為測試資料，直接作廢（§0 決策 7：既有資料不遷移）。`);
  process.exit(0);
}

main().catch((err) => {
  console.error("盤點失敗：", err);
  process.exit(1);
});
