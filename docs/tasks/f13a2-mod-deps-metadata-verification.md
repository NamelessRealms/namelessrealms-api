# 驗收報告：F13a-2 mod metadata 依賴擴充（F29b）

> Claude Code 實作完成後自動產出。協作 Claude 依此審計。
> **不得用範本/預期值/設計推理冒充已執行。**

任務代號：`f13a2-mod-deps-metadata`｜主要變更 repo：**namelessrealms-api（單一 repo，developers 分支）**
性質：F29（mod metadata 服務）增量擴充。依賴 F29 已收案。
完成 F 編號：**F13a-2 / F29b**（狀態 → done；local green + remote Actions green + dev 真機 backfill 完成）。前端「常駐依賴健檢」UI 屬 **F13a-4**、依賴解析為平台專案屬 **F13a-3**，本任務未做（守界）。

## 變更檔案
**修改**
- `src/api/utils/modJarParser.ts` — `ParsedMod` 加 `deps: string[]`；新增 `SYSTEM_DEP_IDS` 過濾集 + `normalizeDeps` helper；四格式各抽必要依賴（fabric `depends` keys、quilt `quilt_loader.depends` 濾 optional、TOML `[[dependencies.*]]` 濾 `mandatory`/`type=="required"`、legacy `requiredMods` 切 `@` 後綴）。
- `src/database/mod_metadata.sql` — 加 `deps JSON NULL` 欄，附 carryover ALTER 註解。
- `src/api/services/mods/mod-metadata.service.ts` — `ModMetadataView` 加 `deps`；`captureModMetadata` INSERT 末端加 `deps`（`parsed ? JSON.stringify(parsed.deps) : null`）；`lookupModMetadata` SELECT/view 帶 `deps`（`normalizeDepsColumn` 防禦性處理字串形）；新增 `backfillModDeps`（重解 jar 僅 UPDATE deps、帶 `WHERE deps IS NULL` guard）。
- `backfill_mod_metadata.ts` — 加 `--deps` 模式：挑 `mod_name` 非 NULL 且 `deps IS NULL` 者、重下載呼 `backfillModDeps`。既有無旗標模式（補全新 row）路徑零波及。
- `tests/mods/modJarParser.test.ts` — 新增 deps 抽取 describe（四格式 + optional 排除 + 系統 id 過濾 + fabric-api 不濾 + 去重/小寫 + legacy `@` 切除 + 空依賴 `[]`）。
- `tests/mods/mod-metadata.test.ts` — capture INSERT 帶 deps（有依賴/空 `[]`/解析失敗 NULL 三態）、lookup 回 deps（array + 字串防禦）、`backfillModDeps`（UPDATE guard / re-parse 失敗不覆蓋）。

**未納本 commit（無關本任務）**
- `.gitignore` 新增 `.claude/settings.local.json` 一行 —— 設定配套，非本任務變更（沿 F29 慣例不納）。

## 設計重點（含兩處已與 Yu 確認的決策）
1. **legacy `@` 版本後綴切除**：mcmod.info `requiredMods` 每項 `String(s).split("@")[0]` 取前段 id。切掉版本區間才能讓「只存 id」一致，且系統 id 過濾（`forge` 等）與前端健檢 id 比對得以生效。（用戶確認，選項 1。）
2. **backfill 觸發用 `--deps` 旗標**：兩段語意分離，既有無旗標模式零波及；dry-run 預設 + `--confirm` gate 沿用。（用戶確認，選項 1。）
3. **必要性判定**：fabric `depends` 全必要（recommends/suggests 不取）；quilt `optional !== true`；TOML 同時支援 forge `mandatory==true` 與 neoforge `type=="required"` 兩鍵；legacy `requiredMods` 全必要（`dependencies` 含 optional 無法區分，不取）。
4. **系統 id 過濾**：`minecraft/java/fabricloader/forge/neoforge/quilt_loader/quilt_base` 濾除；**`fabric`/`fabric-api` 不濾**（Fabric API 本體，真實可下載依賴）。抽出去重、全小寫正規化。
5. **`[]` vs NULL 語意**：有解析、無依賴存 `[]`；解析失敗（`parseModJar` 回 null）維持既有全 NULL row 語意（deps 亦 NULL）。`captureModMetadata` 的 `parsed ? JSON.stringify(parsed.deps) : null` 一行落實此區分。
6. **`backfillModDeps` 冪等**：`UPDATE ... WHERE sha256 = ? AND deps IS NULL`；re-parse 回 null（罕見：曾成功、重解失敗）則不覆蓋、留 NULL 可重試。best-effort 吞錯。
7. **mysql2 JSON 讀取防禦**：`normalizeDepsColumn` 對 array（mysql2 多半已 parse）直用、對字串 `JSON.parse`、其餘回 null。真機若回字串形亦不失準（待人工於真機核對實際回傳型別，見下）。

## 測試結果
- **單元 + 契約測試（`yarn test` → `vitest run`）：13 檔 96 測全綠**（既有 70 → 96，新增 26 測；既有 `tests/modpool/` 未壞）。
  ```
  Test Files  13 passed (13)
       Tests  96 passed (96)
  ```
  新增涵蓋：解析器 deps 四格式各 ≥1 例（neoforge `type=="required"` 與 forge `mandatory=true` 兩鍵各一）、optional 排除、系統 id 過濾、`fabric-api` 不被濾、去重 + 小寫、legacy `@` 切除、空依賴 `[]`；service INSERT deps 三態、lookup 帶 deps（array + 字串防禦）、`backfillModDeps` UPDATE guard 與 re-parse 失敗不覆蓋。
- **F29 既有測試迴歸**：解析器五格式、偵測優先序、佔位符、icon magic-bytes、captureModMetadata 吞錯/略過、lookup 契約（`mod_name IS NOT NULL`、上限 500、缺參 400）全綠。

## 產物重建
- [x] 純後端 TS（src-tauri 無涉）→ 已跑 `yarn build`（`outputVersion` + `build.js` + `tsc`），通過無型別錯誤。
- [x] backfill 腳本在 repo 根、不在 `tsconfig` `include`（`["src"]`）內 → 另跑 `npx tsc --noEmit`（同 CJS/es2015 旗標）單獨型別檢查，exit 0。
- 註：`yarn build` 的 `outputVersion` 步驟會覆寫 `src/version.ts` 剝除檔頭註解（**既有建置行為、非本任務改動**）；已 `git checkout src/version.ts` 還原，保持本次 diff 聚焦。

## carryover
1. **dev DB 手動 ALTER —— 已套用**（用戶確認執行）：
   ```sql
   ALTER TABLE `mod_metadata` ADD COLUMN `deps` JSON NULL AFTER `icon_url`;
   ```
2. **prod DB 手動 ALTER —— 仍待部署套用**（無 migration runner；`CREATE TABLE IF NOT EXISTS` 不會 ALTER 既有表）。同上 SQL。

## 真機 backfill 實跑（dev DB，deps 欄已套用）
- **`--deps` dry-run 掃描**（read-only）：
  ```
  掃描全域池前綴：mods/files/（模式：deps 補值）
  待補 deps 的 .jar 物件數（mod_name 非 NULL 且 deps IS NULL）：360
  [dry-run] 未下載/解析任何物件。加 --confirm 才真跑。
  ```
- **`--deps --confirm` 實跑**：
  ```
  待補 deps 的 .jar 物件數（mod_name 非 NULL 且 deps IS NULL）：360
  --confirm 已指定，開始下載 + 解析（併發 4）…
  完成，共嘗試處理 360 個物件（下載失敗者未落值）。
  ```
  實跑統計：**已處理 360 筆、真實下載失敗 0 筆**。
- **回填後覆蓋統計**（`mod_name` 非 NULL 者）：`{total: 360, with_deps: 360, null_deps: 0}` —— 全數落值、無殘留 NULL。
- **≥3 筆已知模組 deps 抽樣核對**（池內實際存在者；無 Sodium Extra，取 Sodium Options 系與 Chipped）：
  ```
  [neoforge] name="Sodium Options Mod Compat" id=sodiumoptionsmodcompat deps=["sodiumoptionsapi"]
  [neoforge] name="Sodium Options API"        id=sodiumoptionsapi       deps=["reeses_sodium_options"]
  [fabric]   name="Reintegrated Chipped"      id=reintegrated_chipped   deps=["chipped","fabric-api","lithostitched"]
  ```
  皆合理；Reintegrated Chipped 帶 `fabric-api` 佐證**系統 id 過濾未誤濾 fabric-api**（真實資料驗證）。
- **mysql2 對 `deps` JSON 欄回傳型別**：實測 `typeof=object, isArray=true`（`value=["puzzleslib","diagonalblocks"]`）—— mysql2 **已自動 parse 為 array**；`normalizeDepsColumn` 的 array 分支為 live 路徑，字串分支僅為防禦（真機未觸發，無害保留）。

## git 對帳
```
git log --oneline -3            → b6f2fab docs: F13a-2 CI run 連結、真機 backfill 實跑與覆蓋統計回填（Actions 綠、360/360）
                                  031dbf2 docs: F13a-2 驗收報告（local green，Actions 與真機回填待人工）
                                  a266563 feat: F13a-2 mod metadata 依賴擴充（deps 欄 + 解析 + lookup + backfill --deps）
git status                      → 乾淨（.gitignore 的 .claude/settings.local.json 一行屬設定配套，未納本任務 commit）
git rev-parse HEAD              → b6f2fabe74c069c6f53b6bec14ee0f1053b676ae
git rev-parse origin/developers → b6f2fabe74c069c6f53b6bec14ee0f1053b676ae（本地＝遠端）
```
（本 git 對帳於 b6f2fab push 後驗證；本區塊之回填為其後的 docs-only commit，不改任何程式碼。）

## CI
- 本地：`yarn test`（vitest run，96 綠）+ `yarn build`（tsc 綠）+ backfill `tsc --noEmit`（exit 0）→ **local green**。
- 遠端 Actions：**綠**（`CI` run，conclusion=success，`gh run view` 確認）。
  run：https://github.com/NamelessRealms/namelessrealms-api/actions/runs/29635786160 （commit `031dbf2`）
- 狀態措辭：**local green + remote Actions green**。

## 回歸守門
- 既有 13 檔測試全綠，`tests/modpool/` 與 F29 既有 `tests/mods/` 契約未破壞。
- deps 為新增末端欄/末端 INSERT param（既有 param 索引 0–5 不動），lookup 既有 view 欄位與 `mod_name IS NOT NULL` 過濾不變 → 前端既有欄位相容。
- 解析全程 best-effort 吞錯（`normalizeDeps` 純函式；`backfillModDeps` 外層 try-catch），不影響匯入/上傳主流程。
- 無新增依賴（沿用 `@iarna/toml`、`adm-zip`）→ CJS 建置不受影響（`yarn build` 綠佐證）。

## 守界聲明
- 僅實作 F13a-2 任務包範圍 + 兩處已確認決策（legacy `@` 切除；backfill `--deps` 旗標）。
- 不做 optional/recommended 依賴、不存版本區間、不解析為平台專案（F13a-3）、未動前端（F13a-4）。
- 未動 Nymless / allay_core。
- 未自行裁決設計疑義：legacy `@` 處理與 backfill 觸發方式皆先回報並取得確認後才落地。