# 驗收報告：F13a-3 模組平台瀏覽 proxy + 單檔匯入端點

> Claude Code 實作完成後自動產出。協作 Claude 依此審計。
> **不得用範本/預期值/設計推理冒充已執行。**

任務代號：`f13a3-platform-browse-import`｜主要變更 repo：**namelessrealms-api（單一 repo，developers 分支）**
性質：CF/Modrinth 瀏覽 proxy（淨新增）+ 單檔匯入（複用 cf-hash-and-global-pool 既有管線）+ **Modrinth 進池 sha512 修正**（經核准擴界，見偏離記錄 (c)）。
完成 F 編號：**F13a-3**（狀態 → local green + remote Actions green + **CF 與 Modrinth 真機完整流均通過**；見「真機驗證」段）。前端/Tauri 橋接屬 **F13a-4**、整包匯入屬 **F15**、mod_id 反向解析屬 F13a-4，本任務未做（守界）。

## 變更檔案

**新增**
- `src/api/services/mods/platform.types.ts` — 跨平台正規化型別（`PlatformSearchItem` / `PlatformVersion` / `PlatformProject` / `PlatformVersionFile` / `PlatformDepType` / `LoaderName`）。
- `src/api/services/mods/platform-curseforge.service.ts` — CF got 客戶端（`x-api-key` 注入）：`search` / `listVersions` / `getProjects` / `getVersionFile`，各自輸出正規化形狀。含 `mapCfRelation`（3→required、2→optional）、`splitCfGameVersions`（從 CF 混合 `gameVersions` 拆 MC 版本與 loader 名）、`CF_LOADER_TYPE`（Forge=1/Fabric=4/Quilt=5/NeoForge=6）。
- `src/api/services/mods/platform-modrinth.service.ts` — Modrinth got 客戶端（免 key）：同四方法。含 `mapMrDep`（required/optional 保留）、`primaryFile`（primary 缺則第一個）、`MR_LOADER` facet 對映。`getVersionFile` 回傳 **sha512**（Modrinth 不提供 sha256，見偏離記錄 (c)）。
- `src/api/controllers/platform.controller.ts` — 三瀏覽端點薄層 handler：`search`（source=all 並發合併 / gating）、`listVersions`、`getProjects`。含 `clampLimit`（[1,50]，缺省 20）、`parseLoader`（非法值 400）、`_cfWithKey`（CF key gate → 503）、`_toGatewayError`（上游錯 → 502）。
- 測試：`tests/mods/platform-search.test.ts`、`platform-versions.test.ts`、`platform-projects.test.ts`、`tests/modpool/from-platform.test.ts`。

**修改**
- `src/api/utils/modpool/pool.ts` — **`ensureModrinthFileInPool` 重構**：Modrinth 無 sha256 → 一律串流下載、親算 sha256 當池 key、以 API 的 **sha512** 做完整性核對（不符報錯）；in-flight 去重改以 sha512 為鍵；放棄 sha256-headObject-免下載（前提不成立）。`downloadAndHashToTemp` 加 `opts.sha512` 可選同時算 sha512（CF 路徑不受影響）。詳見偏離記錄 (c)。
- `src/api/services/mods/platform.types.ts` — `PlatformVersionFile.sha256` 改為 `sha512`。
- `src/api/routes/mods.routes.ts` — 掛三瀏覽路由（`verifyToken` only，比照 `/metadata/lookup`），註冊於 `/:projectId/file/:fileId` 之前。
- `src/api/routes/server.routes.ts` — 掛 `POST /:versionId/files/from-platform`（`verifyToken` + `requirePermission(MANAGE_SERVER)`，無 multer），**註冊於 `/:versionId/files/:fileId` 之前**（避免 "from-platform" 被誤解析成 fileId；比照現有 `files/restore` 排序守則）。
- `src/api/controllers/server-modpack.controller.ts` — 新增 `addFileFromPlatform`；Modrinth 分支組 `hashes.sha512` 交進池；imports 加兩平台 service 與模組級實例。
- `tests/modpool/pool.download.test.ts` — `ensureModrinthFileInPool` 測試改為 sha512 契約（缺 sha512 拒收 / 下載親算 sha256 + sha512 核對相符上傳 / sha512 不符拒收 / 池 key headObject 命中免上傳）。

**未納本任務（無關）**
- `.gitignore` 新增 `.claude/settings.local.json` 一行 —— 進 working tree 前即存在的設定配套，非本任務改動（沿 F13a-2 慣例不納）。

## 設計重點與已確認決策

1. **進池複用既有管線**：`addFileFromPlatform` 取得平台檔案資訊後，CF 走 `ensureCurseforgeFileInPool`、Modrinth 走 `ensureModrinthFileInPool`（皆 `utils/modpool/pool`）。cf_file_hashes 快取（CF）、x-api-key、全域併發 16、重試退避、**順路 metadata 解析**均由 pool 內建，controller 不複製。CF 的 headObject-免下載沿用；Modrinth 因 API 無 sha256 無法先 headObject（見 (c)），一律下載。pool 的 Modrinth 分支經核准重構（守界 §7 擴界）。
7. **Modrinth sha512 進池**：Modrinth API 只給 sha512/sha1，池以 sha256 內容定址，故 `ensureModrinthFileInPool` 改為「串流下載 → 親算 sha256 當池 key、以 API sha512 完整性核對」。此修正順帶讓**既有 `importVersion` 的 Modrinth（.mrpack）匯入**得以正確運作（先前硬求 sha256，對真實 mrpack 會全數 422 —— 屬先前未被真機測到的潛在缺陷）。importVersion 程式碼無需改動（它本就把 mrpack index `f`（含 `hashes.sha512`）直傳進池）。
2. **metadata 委派、不雙呼叫**：比照 `importVersion`，from-platform **不**另呼 `captureModMetadata`（該呼叫是 `addFile` 走 `ensureBufferInPool` 手動路徑才需要）。metadata 於 pool 下載分支順路解析；快取命中無位元組即不解析（照既有規則）。測試佐證 `captureModMetadata` 未被 from-platform 呼叫。
3. **CF downloadUrl null 佐證**：`getVersionFile` 回傳的 `downloadUrl` 為 null 時**原樣傳入** `ensureCurseforgeFileInPool`（不預補 URL），使 pool 走 `flxCurseforgeDownloadUrlNullIssues` 重建路徑而非直接 502。測試斷言傳入池的 `file.downloadUrl === null`（見測試段）。
4. **§12.8 替換語意沿用**：`dest_path = "mods/" + fileName`；同 dest_path 替換沿用原 id、body 不帶 policy/disabled → 沿用原 entry（無則缺省 enforced / 未停用）、append 才 `file_count + 1`。回傳補上明確 `policy` / `disabled`（§3.4-5）。
5. **source=all 合併**：`Promise.allSettled` 並發兩平台各取 limit，不跨平台去重（同名兩平台各一筆為正確呈現）；明指單一來源失敗 → 502；all 模式失敗來源靜默略過。
6. **CF key 缺席行為**：明指 curseforge（search/versions/projects/from-platform）→ **503** `ServiceUnavailable`；`source=all` 搜尋靜默跳過 CF 段（只回 Modrinth），不整體失敗。

### 偏離記錄
- **(a) CF key 缺席狀態碼**：新端點回 **503**（規格 §3.5），既有 `importVersion`（`server-modpack.controller.ts:137`）回 **400**。已與用戶確認：新端點依規格 503，既有 400 守界不動，留待後續 F15 對齊。`src` 先前無 503 前例，本任務首用（inline `res.status(503)`）。
- **(b) published guard 狀態碼**：新 `addFileFromPlatform` 回 **409**（比照 `restoreFile`/`updateFilePolicy`），既有 `addFile` 回 **400**。本任務不動 `addFile`，留待後續對齊。
- **(c) Modrinth sha256 假設錯誤（需求方規格錯誤）＋既有管線潛在缺陷修復（經核准擴界）**：任務包 §3.4 稱「Modrinth 有 sha256」，**經真機跨 Fabric API / JEI / Sodium 實測，Modrinth API 的 `hashes` 只提供 `sha512` + `sha1`，從不含 `sha256`** —— 此為需求方規格的事實錯誤。連帶發現**既有 `ensureModrinthFileInPool` 硬性要求 `hashes.sha256`**，對任何真實 Modrinth 檔案都會 `PoolResolveError`（既有 `importVersion` 的 Modrinth 匯入實質不可用，屬先前潛在缺陷）。因修正必動共享 `pool.ts`（守界 §7），**已先回報並取得用戶核准擴界**後才動：改為「下載後親算 sha256 當池 key、以 API sha512 核對」（Q1 選項 1；mr 快取表 versionId→sha256 記 backlog 不做）。此修正同時修好 from-platform 與既有 importVersion 兩條 Modrinth 路徑。

## 端點形狀樣本（取自測試實際斷言）

- **search item**：`{ source:"curseforge", projectId:"238222", slug:"jei", name:"Just Enough Items", author:"mezz", description:"item viewer", iconUrl:"https://cf/icon.png", downloads:12345 }`
- **version（CF）**：`{ versionId:"5001", name:"JEI 1.21.4", fileName:"jei-1.21.4.jar", size:4096, date:"2026-01-02T00:00:00Z", mcVersions:["1.21.4"], loaders:["Fabric"], dependencies:[{projectId:"111",type:"required"},{projectId:"222",type:"optional"}] }`（relationType 1 之 modId 333 已丟棄）
- **version（Modrinth）**：`dependencies:[{projectId:"aaa",type:"required"},{projectId:"bbb",type:"optional"}]`（incompatible 與無 project_id 者丟棄）
- **project**：`{ projectId:"111", name:"Dep A", slug:"dep-a", iconUrl:"https://cf/a.png" }`
- **from-platform 回傳 entry**：`{ id, version_id, file_name:"mod.jar", dest_path:"mods/mod.jar", file_url, file_hash, file_size_bytes, policy:"enforced", disabled:false }`（policy/disabled 補值）

## 測試結果（`yarn test` → `vitest run`，實際輸出）

```
Test Files  17 passed (17)
     Tests  120 passed (120)
```
- 新增 4 檔 23 測 + 既有 `pool.download.test.ts` Modrinth 段改寫（3→4 測，含 sha512 不符拒收）= **120 全綠**（既有 96 → 120）。既有 `tests/modpool/` 與 `tests/mods/` 其餘契約未破壞。
- （全套輸出中 `error.middleware.test.ts` 印出一行 `[ERROR] 非預期` 為該測試**刻意**觸發的錯誤處理案例，非失敗。）

新增涵蓋對照任務包 §5：
1. **search**：兩平台正規化各一例、source=all 合併、CF key 缺席（all 靜默跳過 CF / 明指 CF → 503）、limit 上限夾制（999→50，斷言傳入上游 searchParams）、未帶 q → 400、缺 token → 401。
2. **versions**：CF relationType（3→required/2→optional/1 丟棄）與 Modrinth dependency_type（required/optional 保留、incompatible 與無 project_id 丟棄）各一例；過濾參數透傳（CF `gameVersion`+`modLoaderType=4`、Modrinth `loaders`/`game_versions` JSON）；CF key 缺席 → 503；非法 source → 400。
3. **projects**：CF/Modrinth 批次回傳、查不到靜默略過（上游只回有值者）、上限 51 → 400、CF key 缺席 → 503。
4. **from-platform**：published → 409、無 MANAGE_SERVER → 403（真實 `verifyToken`+`requirePermission` 鏈，mock server/member service）、**CF downloadUrl null 原樣傳入池佐證**、Modrinth f 形狀正確交進池、同 dest_path 替換沿用 id/disabled/policy、上游取檔失敗 → 502 且 draft_files UPDATE 未呼叫、進池 PoolResolveError → 502 且 draft_files 不變、metadata 委派（`captureModMetadata` 未被 controller 呼叫）、非法 source → 400、CF key 缺席 → 503。

5. **pool 層 Modrinth 新路徑**（`pool.download.test.ts`，真實本機 http server）：缺 sha512 拒收（不下載）、下載親算 sha256 當池 key + API sha512 核對相符則上傳、**sha512 不符拒收不上傳**、池 key headObject 命中則免上傳（仍下載算 sha256）。

**測試覆蓋映射說明（誠實標註）**：`cf_file_hashes 命中零下載` 由既有 `tests/modpool/pool.curseforge.test.ts` 覆蓋；Modrinth 進池路徑由改寫後的 `pool.download.test.ts` 覆蓋（含 sha512 核對）。from-platform 測試以 mock 攔截 pool 呼叫、斷言委派 + 正確入參（CF `file.downloadUrl===null`、Modrinth `hashes.sha512`），不重測 pool 內部。上述 pool 內部行為另於真機段以實際下載佐證（見下）。

## 產物重建

- [x] 純後端 TS（src-tauri 無涉）→ 已跑 `yarn build`（`outputVersion` + `build.js` + `tsc`），通過無型別錯誤。
  - 建置中一處型別修正：`platform.controller.ts` 的 `req.params.source/projectId` 依本 repo Express 型別為 `string | string[]`，比照 `mods.controller.ts` 既有慣例加 `as string`。
- 註：`yarn build` 的 `outputVersion` 步驟覆寫 `src/version.ts` 剝除檔頭註解（**既有建置行為、非本任務改動**）；已 `git checkout src/version.ts` 還原，保持本次 diff 聚焦。

## CI

- 本地：`yarn test`（vitest run，120 綠）+ `yarn build`（tsc 綠）→ **local green**。
- 遠端 Actions：**綠**（conclusion=success，`gh run view` 確認）。
  - platform 端點輪：https://github.com/NamelessRealms/namelessrealms-api/actions/runs/29639262003 （headSha `474d9f9`）
  - Modrinth sha512 修正輪：https://github.com/NamelessRealms/namelessrealms-api/actions/runs/29640432908 （headSha `661b922`）
- 狀態措辭：**local green + remote Actions green**。

## 真機驗證（已執行；dev DB + 真實 CF key + Modrinth）

以 F13a-2 backfill 留存的 `.env`（含 `CURSEFORGE_KEY`、dev MySQL、MinIO）驅動**真實服務 + 真實 `addFileFromPlatform`**（require 自 `dist/`），對 dev 某 draft（`27adaa7c…`，server `c61df810…`）加檔；每檔驗證後**還原 draft_files 至原快照**（池物件 / cf_file_hashes / mod_metadata 為共享快取，保留）。連線先探測：Modrinth ✓、CurseForge（key 有效）✓、dev MySQL ✓、MinIO ✓。

### CurseForge 完整流 ✅
- **搜尋**「jei」→ `{source:"curseforge", projectId:"1578679", name:"Recipegraph", downloads:22, iconUrl:"https://media.forgecdn.net/…"}`。
- **版本清單（含依賴欄）**：`recipegraph-1.0.0.jar` → `dependencies:[{projectId:"238222",type:"required"}]`、`mcVersions:["1.21.1"]`、`loaders:["Fabric"]`。
- **from-platform #1（全新下載）**：`cf_file_hashes[8266592]` 事前 ABSENT → 回 201，pool 物件 `mods/files/1d0db592…65bf.jar` **EXISTS**，`cf_file_hashes` 寫入 `{sha256:1d0db592…65bf, file_size:33736}`，`mod_metadata` = `{mod_id:"recipegraph", mod_name:"RecipeGraph", loader_hint:"fabric", deps:["fabric-api","jei"]}`。
- **from-platform #2（同 fileId，cf_file_hashes 命中）**：事前 `cf_file_hashes` PRESENT → 回 201，**沿用原 entry id**（`aa348d42…`）、file_hash 一致、零下載。

### Modrinth 完整流 ✅
- **搜尋**「sodium」→ `{source:"modrinth", projectId:"AANobbMI", name:"Sodium", downloads:187813678, iconUrl:"https://cdn.modrinth.com/…"}`。
- **版本清單**：`sodium-fabric-0.9.1+mc26.1.2.jar`（`mcVersions:["26.1.2"]`、`loaders:["fabric"]`）；`getVersionFile` 取得 **sha512（128 hex）**、size 1889595、下載連結。
- **from-platform #1（全新下載，親算 sha256 + sha512 核對）**：回 201，pool 物件 `mods/files/56d2eb7e…1b1d.jar` **EXISTS**，`mod_metadata` = `{mod_id:"sodium", mod_name:"Sodium", loader_hint:"fabric", deps:["fabric-block-getter-api-v2","fabric-rendering-fluids-v1","fabric-resource-loader-v0"]}`（deps 落值）。sha512 核對通過（不符會 502，未發生）。
- **from-platform #2（同 versionId，二次匯入）**：回 201，**沿用原 entry id**（`3214677c…`）、file_hash 一致。（Modrinth 無持久快取表 → 會重新下載，但池 key（親算 sha256）headObject 命中 → 免重複上傳；draft entry 走替換語意沿用 id。）
- draft entry 形狀正確（`dest_path:"mods/sodium-fabric-0.9.1+mc26.1.2.jar"`、`file_size_bytes:1889595`、`policy:"enforced"`、`disabled:false`）；驗證後 draft_files 已還原（file_count 4→4）。

兩平台共 ≥2 檔、涵蓋全新下載與快取/命中兩路徑；池物件、draft entry、mod_metadata（含 deps）均核對無誤。

## 回歸守門

- 既有 17 檔測試全綠，`tests/modpool/`、`tests/mods/`、`tests/routes/` 契約未破壞（`pool.download.test.ts` Modrinth 段依新 sha512 契約改寫並保綠）。
- 瀏覽端點為淨新增路由；from-platform 為新增 handler，不改 `addFile`/`publishVersion` 等既有函式；`mods.service.ts` 未動。
- **`pool.ts` 的 `ensureModrinthFileInPool` 經核准重構**（見偏離 (c)）：`downloadAndHashToTemp` 新增選項為 CJS 相容且 CF 路徑零波及（CF 不傳 `sha512` 旗標、`sha512` 回 undefined）；`ensureBufferInPool`、`ensureCurseforgeFileInPool` 未動。既有 `importVersion` 程式碼未改，其 Modrinth 路徑經此修正由「實質不可用」轉為可用。
- 無新增 HTTP client 依賴（沿用 `got` v11，CJS 安全）；`yarn build` 綠佐證未破壞 CJS 建置。

## 守界聲明

- 實作 F13a-3 任務包範圍 + 三處已確認決策（CF key 缺席 503；published guard 409；**Modrinth 進池 sha512 重構——擴界，已核准**）。
- 不動前端/Tauri（F13a-4）、不做整包匯入（F15）、不做 mod_id 反向解析、不加 proxy 快取層（含 mr 快取表，記 backlog）、不改 `mods.service.ts`、不動 `importVersion` 的 400。
- **唯一動到共享既有管線之處為 `ensureModrinthFileInPool`（+`downloadAndHashToTemp` 選項）**：發現既有 sha256 假設不成立、非重構無法複用，依守界 §7 **先回報並取得核准**後才動；CF 進池路徑與 `ensureBufferInPool` 未動。
- 未動 Nymless / allay_core。
- 未自行裁決設計疑義：CF key 狀態碼、service 佈局、Modrinth sha512 重構與擴界歸屬皆先以 AskUserQuestion 取得確認後才落地；三點補充（downloadUrl null 佐證、偏離雙記、全域併發 16 確認）亦已納實作與本報告。

## 附：全域併發 16 確認

全域「下載+雜湊」併發上限 16 由 pool 層模組級單例 `globalSemaphore = new Semaphore(GLOBAL_CONCURRENCY=16)` 內建，罩住所有匯入。from-platform 每次呼叫建的 `createImportLimiter()`（`PER_IMPORT_CONCURRENCY=8`）僅為該次匯入的內層限流，其受限工作最終仍經 `globalSemaphore.run(...)`（見 `pool.ts` `ensureCurseforgeFileInPool`/`ensureModrinthFileInPool` 內 `limiter(() => globalSemaphore.run(...))`），故 per-request limiter **不會使全域 16 上限失效**。

## git 對帳

```
git log --oneline -4            → 661b922 docs: F13a-3 Modrinth sha512 修正 + CF/Modrinth 真機完整流回填
                                  95a9e6a fix: F13a-3 Modrinth 進池改用 sha512 完整性核對（…順帶修既有 importVersion Modrinth 路徑）
                                  99ac922 docs: F13a-3 CI run 連結與 git 對帳回填
                                  474d9f9 docs: F13a-3 驗收報告
git status                      → 乾淨（.gitignore 的 .claude/settings.local.json 一行屬設定配套，未納本任務 commit）
git rev-parse HEAD              → 661b922af79d84528f9842b2a8d6c61237ff41c1
git rev-parse origin/developers → 661b922af79d84528f9842b2a8d6c61237ff41c1（本地＝遠端）
```
（本 git 對帳於 `661b922` push 後驗證；本區塊之最終回填為其後的 docs-only commit，不改任何程式碼。）