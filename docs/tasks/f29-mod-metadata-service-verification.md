# 驗收報告：F29 mod metadata 服務（匯入管線順路解 jar，sha256 為鍵）

> Claude Code 實作完成後自動產出。協作 Claude 依此審計。
> **不得用範本/預期值/設計推理冒充已執行。**

任務代號：`f29-mod-metadata-service`｜主要變更 repo：**namelessrealms-api（單一 repo）**
對應決定：PROJECT_PLAN 決定 21（匯入管線順路解 jar 落庫，不另起下載）。
完成 F 編號：**F29**（狀態 → done）。前端 UI / Tauri 橋接 `lookup_mod_metadata` command 屬 **F13**，本任務未做（守界）。

## 變更檔案
**新增**
- `src/database/mod_metadata.sql` — 新表（sha256 為 PK，無 FK；解析失敗也落全 NULL row 防重試）。
- `src/api/utils/modJarParser.ts` — 純函式 jar 解析器（Fabric/Quilt/NeoForge/Forge/legacy 五格式 + icon magic-bytes 抽取），不碰 DB/S3。
- `src/api/services/mods/mod-metadata.service.ts` — `captureModMetadata` / `captureModMetadataFromFile` / `lookupModMetadata`。
- `backfill_mod_metadata.ts`（repo 根，照 `recycle_orphan_mods.ts` 慣例）— dry-run 預設、`--confirm` 才真跑。
- `tests/mods/modJarParser.test.ts`、`tests/mods/mod-metadata.test.ts` — 解析器單元 + 服務/端點 + 掛鉤吞錯。

**修改**
- `src/database/schema.sql` — 在「獨立表（無外鍵）」群註冊 `SOURCE mod_metadata.sql;`。
- `src/api/utils/modpool/pool.ts` — CF/Modrinth 進池成功後、暫存檔 `finally` 清理前，`await captureModMetadataFromFile(sha256, dl.tmpPath, ext)`（best-effort）。
- `src/api/controllers/server-modpack.controller.ts` — `addFile` 於 `ensureBufferInPool` 後 `await captureModMetadata(pool.sha256, buffer, ext)`。
- `src/api/controllers/mods.controller.ts` — 新增 `lookupModMetadata`（hashes 上限 500、缺參/超限 400）。
- `src/api/routes/mods.routes.ts` — 新增 `POST /mods/metadata/lookup`（僅 JWT，不掛 server 權限）。
- `package.json` / `yarn.lock` — 新依賴 `@iarna/toml@2.2.5`。

## 設計重點（含對任務包的兩處已確認修訂）
1. **TOML 解析器用 `@iarna/toml` 取代任務包建議的 `smol-toml`**：本 repo 是 CommonJS 建置（tsconfig `module=commonjs`, `target=es2015`），smol-toml 近版為純 ESM，`require()` 到 build 產物會執行期爆掉。`@iarna/toml` CJS 相容、`[[mods]]` 陣列表支援成熟。**zip 不需新增依賴** — `adm-zip ^0.5.17` 已在依賴內且 controller 已在用。故本任務唯一新依賴 = `@iarna/toml`。（`yarn build` 綠，證實 CJS 產物可 `require`。）
2. **CF/Modrinth 手上是磁碟暫存檔（`dl.tmpPath`）而非 Buffer**：三處掛鉤全掛。CF/Modrinth 用 `captureModMetadataFromFile` 在清檔前 `fs.readFile(tmpPath)` 讀回 Buffer（本地讀檔零網路成本，符合「不另起下載」精神）；addFile 直接用記憶體 Buffer。讀檔/解析失敗全程吞錯，不影響匯入/上傳主流程。
3. 解析失敗也落全 NULL row（語意＝已嘗試、不可解析），避免掛鉤/backfill 重複嘗試；`lookup` 只回 `mod_name` 非 NULL 者，失敗記錄對前端等同不存在（fallback 檔名）。
4. icon：僅接受 PNG（**magic bytes 判定、非路徑副檔名**）、上限 256 KB，固定存 `mods/icons/{sha256}.png`；池「只增不刪」不納回收（icon 極小，孤兒成本可忽略）。
5. `lookup` 用 `pool.query`（非 `execute`）以讓 mysql2 對陣列參數展開成 `IN (?, ?, ...)`。

## 測試結果
- **單元 + 契約測試（`yarn test` → `vitest run`）：12 檔 70 測全綠**（含新增 2 檔，且既有 `tests/modpool/` 全數未壞）。
  ```
  Test Files  12 passed (12)
       Tests  70 passed (70)
  ```
- **正向流程（真機、真實池資料，read-only 不落庫）** — 取池中前 12 個真 jar 跑 `parseModJar`：
  ```
  forge  name=Moonlight Library      ver=1.20-2.16.34   icon=10418B
  forge  name=Diagonal Fences        ver=8.1.5          icon=21209B
  forge  name=Moog's Glow Up         ver=1.2.1-1.20-1.2 icon=140886B
  forge  name=FancyMenu              ver=3.9.3          icon=28428B
  forge  name=Mowzie's Cataclysm     ver=1.2.1          icon=-
  forge  name=Goblin Traders         ver=1.11.5         icon=28025B
  forge  name=YUNG's Better Strongholds ver=1.20-Forge-4.0 icon=28112B
  forge  name=YUNG's Better End Island  ver=1.20-Forge-2.0 icon=31015B
  forge  name=Audio Improvements     ver=1.3.1          icon=5259B
  forge  name=Patchouli              ver=null           icon=-      ← ${...} 佔位符正確 → null
  forge  name=NetherPortalFix        ver=13.0.1         icon=100319B
  forge  name=Vein Mining            ver=1.5.0+1.20.1   icon=-
  summary: parsed_with_name=12 icons=9 unparsable(null)=0 loaders={"forge":12}
  ```
- **backfill dry-run（真機，read-only）**：
  ```
  掃描全域池前綴：mods/files/
  待回填 .jar 物件數（尚無 metadata row）：365
    mods/files/007c05ae799417ca7aa26669c5d97be9dface5b6fc27aca4ca8031cafe4ddd6e.jar
    ...（365 筆全列）
  [dry-run] 未下載/解析任何物件。加 --confirm 才真跑。
  ```
  現有池共 365 個 .jar 待回填；dry-run 未寫入任何 row、未上傳任何 icon。
- **池物件 public 讀取前提已驗證**：`GET publicUrlForKey(<某 .jar>)` → `status: 200 bytes: 1419416`。故 backfill 採 `got(publicUrlForKey)` 下載路徑成立，**無需 SDK GetObject fallback**。
- **負向 / 掛鉤吞錯（`tests/mods/mod-metadata.test.ts`）**：`captureModMetadata` 對「解析器 throw」`resolves`（不 throw、未 INSERT）；非 `.jar` 直接 return 不碰 DB；已有 row 跳過。端點：無 token→401、缺 `hashes`→400、`>500`→400（不查 DB）、空陣列→200 `{}`（不查 DB）、多 hash→回多筆且查詢帶 `mod_name IS NOT NULL` + 陣列整包綁定。

## 審計確認
- 本任務無新增業務 audit log；metadata 落庫失敗僅以 `console.error` 記錄（best-effort 語意），不含敏感原值（只記 sha256 與錯誤訊息）。掛鉤採吞錯設計，不影響既有匯入/上傳的既有 log 行為。

## 產物重建
- [x] 改過原始碼（src-tauri 無涉；純後端 TS）→ 已跑 `yarn build`（`outputVersion` + `build.js` + `tsc`），通過無型別錯誤，證實 `@iarna/toml` 在 CJS 產物可 `require`。
- 註：`yarn build` 的 `outputVersion` 步驟會覆寫 `src/version.ts` 並剝除其檔頭註解（**既有建置行為、非本任務改動**）；已 `git checkout src/version.ts` 還原，保持本次 diff 聚焦。
- **手動 CREATE TABLE 提醒**：無 migration runner。部署需在 `src/database` 下手動套用 `mysql -u <user> -p <db> < schema.sql`（或單獨 `< mod_metadata.sql`）。**本地 dev DB 已於驗收時建表**（`DESCRIBE mod_metadata` 欄位符合 schema）；**production 仍待人工套用**。

## git 對帳
```
git log --oneline -1            → a1a1bfe docs: F27b-1 CI 連結與 git 對帳回填（尚未提交本任務）
git status                      → 本任務變更未提交（M×7 + 新增 5 路徑，見上「變更檔案」）
git rev-parse --abbrev-ref HEAD → developers
```
> 依「push 前先給 commit 計畫確認」慣例，**尚未 commit / push**；待 Yu 確認後提交。commit 後回填本區與 CI run 連結。

## CI
- 本地：`yarn test`（vitest run，70 綠）+ `yarn build`（tsc 綠）→ **local green**。
- 狀態措辭：**local green，remote Actions 待推送後人工確認**（`ci.yml`：Node 22 → `yarn test` + `yarn build`）。**未推送前不得當 CI 通過。**

## 回歸守門
- 既有 `tests/modpool/`（pool.download / pool.curseforge / recycle / publish-refs / policy / f27b1-draft-flow / curseforge-url）全綠 —— 掛鉤未破壞 F27b-1 / policy / publish-refs 行為。
- 掛鉤全採 best-effort 吞錯：即使解析器/讀檔 throw，CF/Modrinth 匯入與 addFile 主流程照常回傳（服務層測試斷言不 throw）。
- 唯一新依賴 `@iarna/toml`；`yarn build` 綠證明未破壞 CJS 建置。

## 守界聲明
- 僅實作 F29 任務包範圍 + 兩處已與 Yu 確認的修訂（TOML 改 @iarna/toml；三處掛鉤用 from-file 變體）。未動 Nymless / allay_core（`lookup_mod_metadata` 橋接 command 隨 F13）。
- 未對外部 API（CF/Modrinth）抓名稱/icon 作 fallback（排除項）；overrides / 非 `.jar` 不解析。
- 未自行裁決設計疑義：TOML 依賴、掛鉤範圍、backfill 下載認證、`IN (?)` 綁定、icon magic-bytes 皆已回報並取得確認後才落地。
- carryover：① production DB 手動套用 `mod_metadata` schema；② `backfill_mod_metadata.ts --confirm` 對現有 365 筆的實跑回填屬部署動作，未在本驗收執行（僅 dry-run）；③ F13 前端 + 橋接 command。