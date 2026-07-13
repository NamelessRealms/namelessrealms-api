# 驗收報告：cf-hash-and-global-pool — CF 雜湊正規化 + Mod 檔全域共用池

> Claude Code 實作完成後自動產出。協作 Claude 依此審計。
> **不得用範本/預期值/設計推理冒充已執行。** 本報告的測試/E2E 輸出皆為實際執行貼出。
> 主變更 repo：namelessrealms-api（後端）。allay_core 僅補測試（未改驗證邏輯）。

## 變更檔案

### namelessrealms-api（主）
- `src/database/modpack_file_refs.sql` — 新增。池引用計數事實表（sha256, version_id）＋ FK CASCADE→server_modpack_versions。
- `src/database/cf_file_hashes.sql` — 新增。CF fileId → 後端親算 sha256 快取表。
- `src/database/schema.sql` — 於 server_modpack.sql 後加入兩張新表的 SOURCE。
- `src/api/utils/modpool/curseforge-url.ts` — 新增。`flxCurseforgeDownloadUrlNullIssues` 純函式（附錄 A 版本，repo 原本無此函式，屬新建）。
- `src/api/utils/modpool/pool.ts` — 新增。三來源收斂進池：串流下載算 sha256、headObject 去重、全域併發上限(16)/單匯入(8)、in-flight 去重、重試退避(2)、cf_file_hashes 讀寫。
- `src/api/utils/s3/s3.ts` — 新增 `headObjectExists`、`uploadFileToS3`（串流）、`listObjectKeys`、`publicUrlForKey`。
- `src/api/controllers/server-modpack.controller.ts` — importVersion 的 CF/Modrinth 分支改走池、移除 Murmur2、失敗回 422；addFile 改池 key；publishVersion 於 transaction 內維護 refs（只算 mods/files/ 池條目）。
- `recycle_orphan_mods.ts` — 新增。孤兒回收 script（dry-run 預設，刪前二查，只掃 mods/files/）。
- `audit_bad_hashes.ts` — 新增。壞雜湊唯讀盤點 script。
- `tests/modpool/*.test.ts`、`tests/helpers/httpServer.ts` — 新增 5 個測試檔 + 本機 http server 測試工具。
- `src/version.ts` — `yarn build` 的 outputVersion 產物（非手改）。

### allay_core（僅測試）
- `src/util/download.rs` — 新增 1 個單元測試（正規化 pass / 非 sha256 fail）；驗證邏輯未動。
- `src/process/sync.rs` — 新增 1 個 hermetic 測試（非標準寫法 sha256 仍略過下載）；同步邏輯未動。

> 無關變更提醒（未由本任務處理）：兩 repo 的 `CLAUDE.md` 在開工前即為已修改狀態，非本次改動，未觸碰。

## 設計重點
- **引擎維持 sha256-only**：不在 allay_core 加 Murmur2。正規化在匯入層完成——三來源一律取得位元組算/取 sha256 進池。
- **串流不進記憶體**：`downloadAndHashToTemp` 以 `stream/promises` pipeline（got.stream → Transform 邊算 sha256 → 落暫存檔），算完以 sha256 為 key 用 `uploadFileToS3`（fs.ReadStream + ContentLength，零新依賴）上傳，最後刪暫存。取捨：key 需 sha256、sha256 需下載完 → 落暫存解先後依賴。
- **全有或全無**：任一 CF/Modrinth 檔進池失敗 → `PoolResolveError`（含檔名）→ 匯入回 422 + failures 清單，不建半殘包、不塞假雜湊。CF API 未回傳的 fileId 亦計入 failures。
- **信任鏈**：`cf_file_hashes` 只寫後端親算值；Modrinth 下載後親算與 API 值核對，不符報錯。
- **回收與業務解耦**：任何業務路徑都不刪池物件；真刪只由手動 script（dry-run 預設、刪前二查）。
- **ToS 註記**（使用者已知並承擔）：`downloadUrl` 為空通常代表作者關閉第三方散布，fallback 重建 forgecdn URL 屬繞過該 opt-out 的灰區行為。

---

## ① CF 雜湊正規化

**變更**：`importVersion` CF 分支不再寫 `String(cfFile.fileFingerprint)`（Murmur2），改為每檔經 `ensureCurseforgeFileInPool`：查 cf_file_hashes 快取 → 未命中則取 downloadUrl（空時 `flxCurseforgeDownloadUrlNullIssues` fallback）→ 帶 `x-api-key` 串流下載算 sha256 → 上傳池 → 寫快取。靜默 `catch {}` 改為 422。

**單元測試（實際輸出）**：
- fallback URL 純函式 5 條（curseforge-url.test.ts）：一般(3215435→/files/3215/435/)、前導零(2926027→/files/2926/27/)、空白/括號檔名 encode、全零 guard(3000000→/files/3000/0/)、無效輸入 throw。
- CF 進池 5 條（pool.curseforge.test.ts）：cf_file_hashes 命中→不下載；親算後 INSERT IGNORE cf_file_hashes（斷言 args `[6000002, <sha>, <size>]`）；downloadUrl 空→fallback 重建 URL 且帶 `x-api-key: KEY123`；fallback 失敗→PoolResolveError；in-flight 去重同 fileId 並發只下載一次。

**真機（E2E，詳見文末）**：CF 檔 fileID=3933351 downloadUrl 存在，帶 x-api-key 自 forgecdn 下載，manifest hash = `936deec1…b967b7`（64-hex sha256，非 Murmur2）。

---

## ② 全域池與 key 正規化

**變更**：mod 上傳統一 `mods/files/{sha256}{ext}`（無 serverId）——CF/Modrinth 新下載路徑、手動 `addFile`（原 `modpacks/{serverId}/files/`）皆改。manifest key（`modpacks/{serverId}/{versionId}/manifest.json`）不動。Modrinth 先 headObject 命中則免下載，未命中下載後親算核對。

**單元測試（實際輸出，pool.download.test.ts，本機 http server 餵已知位元組）**：
- `ensureBufferInPool` key = `mods/files/{sha256}.jar`（斷言無 serverId）、headObject 命中→跳過上傳。
- Modrinth sha256 已知 + headObject 命中→server 請求數 0（連下載都免）。
- Modrinth 未命中→真實串流下載算 sha256 與 API 值相符→上傳；不符→PoolResolveError 且不上傳。

**真機**：manifest `files[].url` = `…/mods/files/936deec1….jar`（指池）。

---

## ③ overrides / 自訂 zip 未受波及之確認

**無程式改動**。三處 override/zip 上傳 key 維持 `modpacks/${serverId}/files/${hash}${ext}` / `…/${hash}.zip`：
- `server-modpack.controller.ts` CF overrides（`entry.entryName.startsWith("overrides/")` 迴圈）、Modrinth overrides 迴圈、純自訂 zip 分支——三處 key 字串未變、`crypto.createHash("sha256")` 未變、不進池、不記引用。
- `removeFile` 維持不刪 S3。
- **引用計數過濾佐證**（publish-refs.test.ts）：manifest 同時含池條目（url 含 `/mods/files/`）與 override 條目（url 含 `/modpacks/srv1/files/`）時，refs 只插入池條目 sha256，**斷言 `insertedShas` 不含 override 的 sha256**。

---

## ④ 引用計數

**變更**：`publishVersion` 上傳 manifest 後，於 `getConnection()` transaction 內：UPDATE 版本為 published → `DELETE FROM modpack_file_refs WHERE version_id=?`（涵蓋重 publish）→ 對 url 指向 `mods/files/` 的每個 sha256 `INSERT IGNORE`。draft 路徑（importVersion/addFile/removeFile）不動 refs。刪版本靠 FK `ON DELETE CASCADE`。

**單元測試（publish-refs.test.ts）**：只插入池條目 sha256、overrides 跳過；DELETE 舊列先於 INSERT；beginTransaction/commit/release 皆呼叫、rollback 未呼叫。

**真機**：publish 後 `modpack_file_refs` 該 version 1 列（=manifest 檔數）；`DELETE FROM server_modpack_versions` 後 refs 列數 0（**CASCADE OK**）。

---

## ⑤ 清理 script

**recycle_orphan_mods.ts**：`--dry-run` 為預設（只列不刪），`--confirm` 才真刪；只掃 `mods/files/` 前綴（不碰歷史 `modpacks/{serverId}/files/`，該前綴含現役 overrides 無法區分，掃了會誤刪——由人工在重新 publish 前一次性清）；刪前逐一再查引用仍為零。`main()` 以 `require.main === module` 守衛，可被測試 import。

**單元測試（recycle.test.ts）**：有 refs 的不列孤兒、無 refs 的列孤兒；dry-run（只呼叫 listOrphans）不呼叫 deleteFromS3；deleteOrphans 刪前再查=0 才刪、發現非零則跳過。

**audit_bad_hashes.ts**：唯讀盤點（draft 掃 draft_files、published fetch manifest，標非 `^[0-9a-fA-F]{64}$`），只 SELECT/fetch、不寫入、附修復選項。**未對真機執行寫入**。

---

## ⑥ 吞吐強化

於 `pool.ts`（實際碼）：
1. **全域併發上限 16**（`globalSemaphore = new Semaphore(16)`）罩住所有匯入的「下載+雜湊」；**單匯入 8**（`createImportLimiter`）。
2. **in-flight 去重**：module 級 `Map`，key=`cf:{fileId}` / `mr:{sha256}`，第二個同鍵者 await 第一個 promise，完成即移除。（pool.curseforge.test.ts 斷言同 fileId 並發只下載一次。）
3. **重試退避**：`withRetry` 重試上限 2 + 指數退避（500ms·2^n）；逐檔 timeout 60s（got `timeout.request`）。
4. **cf_file_hashes 快取表**：後端親算成功即 INSERT IGNORE；命中直達 sha256 零下載。只寫後端親算值。

---

## 測試結果

- **allay_core**：`cargo test process::sync` → `7 passed; 0 failed; 1 ignored`（新增 `accepts_non_standard_sha256_without_download` 通過）。`cargo test util::download::tests` → `2 passed; 0 failed`（新增 `sha256_exists_normalizes_and_rejects_non_sha256` 通過）。
- **namelessrealms-api**：`yarn test` → **Test Files 8 passed (8) / Tests 30 passed (30)**。
- 正向/負向流程實際輸出見上方各節與文末 E2E。

## 產物重建
- [x] 改過原始碼 → 已跑 `yarn build`（tsc）→ 綠（`Done in 2.27s`）。allay_core 為測試變更，`cargo test` 綠。
- 未改 allay_core 產物邏輯（僅測試），無需 `cargo build` 產物更新。

## git 對帳
```
# namelessrealms-api
git log --oneline -1  → 25dcaf1 feat: 補齊缺 schema 的 8 張舊表…（尚未 commit 本任務）
git status            → 本任務檔案為 M/??（未 commit，待你確認 commit 計畫後再 push）
# allay_core
git log --oneline -1  → 0af6a6c refactor: 移除 F9 後已無人建構的 LauncherAssetsError…
git status            → src/process/sync.rs、src/util/download.rs 為 M（未 commit）
```
> 依既有工作流程：修完先給你看 commit 計畫，確認後才 push；本報告產出時尚未 commit。

## CI
- 本地：`cargo test process::sync` / `cargo test util::download::tests` / `yarn test` / `yarn build` → 全 green。
- 狀態措辭：**local green, remote Actions 待人工確認**。

## 回歸守門
- allay_core 既有 6 個 sync 測試 + 既有 sha256_exists 測試全數續綠（未改驗證邏輯）。
- 後端既有測試（auth/index/error middleware）不受影響；`yarn build` 全綠代表無型別回歸。
- overrides/自訂 zip 上傳路徑三處字串未動（§③）。

## 端到端（真機 E2E — 實際執行輸出）
環境：本地 MySQL 5.7.44、MinIO（s3.namelessrealms.com / nymless-media）、有效 CURSEFORGE_KEY。今日 2026-07-14（早於 forgecdn 7/16 強制 key，仍一律帶 x-api-key）。

流程：真實 CF 檔 `player-animation-lib-fabric-0.1.0-dev.jar`（fileID=3933351, 2915 bytes）組小型 manifest → `importVersion` → `publishVersion`。實際結果：
```
importVersion → 201   publishVersion → 200
manifest files（1）：
  ✓ sha256=936deec15f4b2ea0f587d593ebbb4997ed7c5dd256388206f1b2ee3a00b967b7
  ✓池 url=…/mods/files/936deec1…b967b7.jar
refs 列數=1（期望=1）
cf_file_hashes 命中：{ cf_file_id: 3933351, sha256: '936deec1…', file_size: 2915 }
刪版本後 refs 列數=0（CASCADE OK）
結果：hash 全 sha256=true / url 全指池=true / refs 寫入=true / cache 親算=true / CASCADE=true → E2E PASS ✅
```
E2E 產生的資料已完整清理（刪池物件、刪版本、刪 cache 列、刪 manifest 物件），真機狀態還原；兩張新表保留（本功能 schema）。

## 守界聲明
- 只做任務包 §1–§7 範圍：未改 allay_core 驗證演算法（sha256-only）；未做 F15、未做匯入非同步任務化、未做回收排程化。
- 未接受任何客戶端自報 hash 進池（cf_file_hashes 只寫後端親算值）。
- FINDINGS §4 其他技術債（published `id=hash` 撞 key、`getFiles` 無 auth、`draft_files` MEDIUMTEXT、僅 Forge/Fabric）只記錄不修。**carryover 提醒**：`publishVersion` 對已 published 版本重跑時，因首次 publish 已清空 `draft_files`，naive 重 publish 會寫空 manifest（既有行為，非本任務引入）；本任務的 refs transaction 在「有實際檔案清單」前提下正確 DELETE+INSERT，該空 manifest 邊界屬既有技術債，未於本任務修正。
