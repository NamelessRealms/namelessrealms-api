# 驗收報告：F13a-1 模組停用（entry `disabled` 旗標，C 案）

> 主要變更 repo：namelessrealms-api（`developers` 分支）。純後端；DB schema、allay_core / manifest 契約**零變更**。
> 完成 F 編號：F13a-1（後端部分）。前端 / Tauri 橋接為 F13a-4 範圍，本任務未動。
> 依賴：F27b-1（derive/restore/policy PATCH 已落地）。

## 背景與目標

服主需要「停用模組」的一級概念：停用檔案**不發給玩家**（不進 manifest → 玩家不下載、strict 模式自動清本地舊檔），但狀態**跨版本持久**（發布後留存、衍生草稿帶回、可隨時再啟用）。C 案：`draft_files` 每個 entry 加選填 `disabled` 旗標；publish 時只有啟用中的 entry 寫進 manifest，停用項留存於版本層的 `draft_files`。

## 變更檔案

- `src/api/controllers/server-modpack.controller.ts`（唯一產品碼）
  - 檔頭 docblock：更新儲存架構描述（published 版保留全量 `draft_files` 含停用項；manifest 僅含 enabled）。
  - `publishVersion`：manifest `files` 過濾 `disabled !== true`；UPDATE 移除 `draft_files = '[]'`（發布後保留全量）；refs 計算註解補「全量含停用項」語意。
  - `deriveVersion`：複製來源改為基底 `draft_files`（含 `disabled` 原樣帶回）；空/NULL → fallback manifest（全 enabled）。
  - `getFiles`：改「優先讀 `draft_files`」；published 舊版本 `draft_files` 空才 fallback manifest；每筆回明確 `disabled` boolean。
  - `updateFilePolicy`（PATCH `/:versionId/files/:fileId`）：body 收 `policy`、`disabled` 其一或皆有，至少一項否則 400；`disabled` 非 boolean → 400；`disabled=false` 採「移除欄位」齊一風格。
  - `addFile`：收選填 `disabled`（非 boolean → 400）；同 dest_path 替換未明帶則沿用原 entry；新增缺省不寫欄位。
  - `restoreFile`：基底查詢改 `SELECT manifest_url, draft_files`；還原來源優先讀基底 `draft_files`（空 → fallback manifest），連同 `disabled` 抄回。
- `tests/modpool/f13a1-disabled.test.ts`（新增，13 條契約測試）。
- `tests/modpool/f27b1-draft-flow.test.ts`（restore 測試群基底查詢 mock SQL 前綴同步為 `SELECT manifest_url, draft_files`；14 條行為斷言不減）。

## 設計重點

- **停用分流（publish）**：manifest 只含 enabled；`draft_files` 不清空，published 版即為含停用項的 authoring record，供 derive/getFiles/restore 讀取。
- **refs 語意更新為「引用該池物件（含停用項）」**：`poolSha256s` 本就以全量 `files`（= parsed `draft_files`）計算，停用池條目的 sha256 仍寫 refs，位元組不被 `recycle_orphan_mods.ts` 回收（再啟用不 404）。此為語意變更、非邏輯改動——見下方「refs 無需改碼佐證」。
- **讀取端一律缺省補值**：`disabled` 補 `false`（比照既有 `policy ?? "enforced"` 慣例），回傳為明確 boolean。
- **restore 改讀基底 `draft_files`（需求方裁決）**：因停用項不進 manifest，唯有改讀基底保留的全量 `draft_files` 才能讓「restore 連同 disabled 抄回」成立（見「偏離/裁決記錄」）。
- **落地形狀**：`derive`/`restore` 寫明確 `disabled` boolean（與其寫明確 `policy` 同風格）；`addFile`/PATCH 採「false 省略欄位」（與 policy 省略同風格）。跨函數形狀差異與既有 policy 處理完全對齊，讀取端補值後對外一致。

## 需求方三點補充

**(1) refs「無需改碼」佐證**（非敘述，引實際程式碼行）：
`publishVersion` 的 refs 計算在 `src/api/controllers/server-modpack.controller.ts:432-438`，以全量 `files` 計：
```ts
const poolSha256s = Array.from(
  new Set(
    files                                                          // = JSON.parse(draft_files)，全量含停用項
      .filter((f) => typeof f.file_url === "string" && f.file_url.includes("/mods/files/"))
      .map((f) => f.file_hash as string)
  )
);
```
`files` 於 `:405` 由 `JSON.parse(version.draft_files || "[]")` 取得（未過濾 `disabled`）；manifest 的 `disabled` 過濾僅在 `:414` 的 `files.filter(...).map(...)`，**不影響** refs 來源。故停用池條目 sha256 自然入 refs，程式碼零改動；測試「refs 全量計」佐證停用項 sha 有 `INSERT IGNORE`。

**(2) `file_count` 語意**：`file_count` 為**全量含停用項**（`publishVersion`/`getFiles`/`deriveVersion` 皆以全量計）；前端「啟用中 N 個」由後續任務（F13a-4）自 `disabled` 旗標另行計算，本任務不在後端拆分 enabled/disabled 計數。

**(3) PATCH `disabled=false` 齊一風格**：已採 `delete files[idx].disabled` 移除欄位，與 `addFile`「false 省略欄位」一致；測試「disabled=false：移除欄位」佐證持久化後 entry 不含 `disabled` key。

## 測試結果

- 全套件：`yarn test`（`vitest run`）→ **13 檔 85 測試全通過**：
  ```
  Test Files  13 passed (13)
       Tests  85 passed (85)
  ```
- 型別關卡：`yarn build`（末步 `tsc`）→ 乾淨（exit 0；此 repo 無獨立 `tsc --noEmit`，型別檢查併於 build）。
- 相關 modpool 契約（verbose，33 條全綠，節錄）：
  ```
  ✓ f13a1-disabled.test.ts > updateFilePolicy 擴充 disabled > disabled=true 更新成功並持久化
  ✓ f13a1-disabled.test.ts > updateFilePolicy 擴充 disabled > 非法 disabled（非 boolean）→ 400
  ✓ f13a1-disabled.test.ts > updateFilePolicy 擴充 disabled > 兩者皆缺 → 400
  ✓ f13a1-disabled.test.ts > updateFilePolicy 擴充 disabled > published → 409
  ✓ f13a1-disabled.test.ts > updateFilePolicy 擴充 disabled > policy + disabled 併帶：兩欄同時更新
  ✓ f13a1-disabled.test.ts > updateFilePolicy 擴充 disabled > disabled=false：移除欄位（齊一 addFile 省略風格）
  ✓ f13a1-disabled.test.ts > publishVersion 停用分流 > 停用項不入 manifest、enabled 正常帶出；發布後 draft_files 不清空
  ✓ f13a1-disabled.test.ts > publishVersion 停用分流 > refs 全量計：停用池條目的 sha256 仍寫 refs
  ✓ f13a1-disabled.test.ts > deriveVersion 帶回 disabled > 基底 draft_files 有停用項 → 新草稿原樣帶回
  ✓ f13a1-disabled.test.ts > deriveVersion 帶回 disabled > 基底 draft_files 空 → fallback manifest（全 enabled）
  ✓ f13a1-disabled.test.ts > getFiles disabled 補值 > published 優先回 draft_files 全量（含停用項、明確 boolean）
  ✓ f13a1-disabled.test.ts > getFiles disabled 補值 > published 舊版本 draft_files 空 → fallback manifest（全 enabled）
  ✓ f13a1-disabled.test.ts > addFile 替換沿用 disabled > 同 dest_path 替換：未帶 disabled → 沿用原 entry 的 disabled:true
  ✓ f13a1-disabled.test.ts > addFile 替換沿用 disabled > 新增 entry：缺省不寫 disabled 欄位
  ✓ f13a1-disabled.test.ts > restoreFile 抄回 disabled > 還原一個停用中的檔案 → disabled 正確抄回
  ```

### 正向流程（實際執行斷言）
- PATCH `disabled=true` → 持久化 `disabled:true`；`policy`+`disabled` 併帶 → 兩欄同時更新；`disabled=false` → entry 移除 `disabled` key。
- publish（含 1 停用項）→ manifest `files` 僅 `["mods/a.jar"]`（停用 `mods/b.jar` 不出現）；UPDATE 語句不含 `draft_files`（發布後保留全量）；停用池條目 sha 仍寫 refs。
- derive（基底含停用項）→ 新草稿 `mods/b.jar` `disabled=true` 原樣帶回、`mods/a.jar` `disabled=false`，回 201；基底 `draft_files` 空 → fallback manifest 全 `disabled=false`。
- getFiles（published 含停用項）→ 回全量、每筆明確 boolean（`b.jar` true / `a.jar` false）；舊版本空 draft_files → fallback manifest 全 false。
- addFile 同 path 替換未帶 disabled → 沿用 `disabled:true`、id 沿用、hash 更新；restore 停用檔 → 沿用原 id、hash 還原成基底、`disabled=true` 抄回。

### 負向流程（實際執行斷言）
- PATCH：`disabled:"yes"`（非 boolean）→ 400；body `{}`（兩者皆缺）→ 400；published → 409。

## refs 語意變更的測試證據

`tests/modpool/f13a1-disabled.test.ts > publishVersion 停用分流 > refs 全量計`：draft 含一啟用池條目（sha=a…）與一**停用**池條目（sha=c…，`disabled:true`，url 指向 `mods/files/`）；publish 後 `INSERT IGNORE INTO modpack_file_refs` 的 sha 同時包含 `POOL_SHA_ENABLED` 與 `POOL_SHA_DISABLED`——證實停用項計入 refs。既有 `publish-refs.test.ts`（overrides 條目跳過）不受影響、仍綠。

## 產物重建

- [x] 改 TS 原始碼 → `yarn build`（`tsc`）通過（型別即產物）。
- [x] Vitest 全綠（85）。
- `src/version.ts` 為 `yarn outputVersion` 建置副產物（值 1.6.2 未變、僅去掉文件註解），已 `git checkout` 還原，不入本次變更。

## git 對帳

```
git rev-parse --abbrev-ref HEAD → developers
git status --short →
  M src/api/controllers/server-modpack.controller.ts
  M tests/modpool/f27b1-draft-flow.test.ts
  ?? tests/modpool/f13a1-disabled.test.ts
  ?? docs/tasks/f13a1-disabled-mod-entries-verification.md（本報告）
```
> 尚未 commit / push（依 push 確認流程，先呈 commit 計畫待確認）。commit 後回填：`git log --oneline -1`、`git rev-parse HEAD` = `origin/developers`。
> 工作區另有 `.gitignore`（harness 追加 `.claude/settings.local.json`）為非本任務改動，不納入本次 commit。

## CI

- 本地：`yarn test` green（85）、`yarn build`（`tsc`）green。
- 遠端：**待推送後回填 Actions run 連結**。依任務驗收條件，remote Actions 綠前任務不算完成；push 後於此補 run 連結與人工確認綠。

## 回歸守門

- 既有 `f27b1-draft-flow.test.ts`（14 條）、`publish-refs.test.ts`、`policy.test.ts` 全綠。
- restore 測試群因基底查詢改 `SELECT manifest_url, draft_files` 僅更新該 mock 的 SQL 前綴比對字串（並補 `draft_files:"[]"` → 走 fallback manifest 路徑），14 條行為斷言不減、行為不變。
- `deriveVersion` 既有測試 baseRow 無 `draft_files`（→ `"[]"` → fallback manifest），policy 缺省補值鏈不變、綠。
- `removeFile` 語意零變更；manifest value-based policy 帶出規則不變（不帶 id/disabled）。

## 偏離/裁決記錄

- **restore 還原來源改讀基底 `draft_files`（需求方裁決，本任務唯一設計偏離任務包字面）**：任務包 §3.6 僅要求「restore 連同 disabled 抄回」，未明指來源。因 §3.3 使停用項不進 manifest，若 restore 仍讀 manifest 則停用檔不可還原、`disabled` 恆為 false，與「抄回」矛盾。經確認採「改讀基底 `draft_files`（NULL/空 → fallback manifest）」，並補測「還原一個停用中的檔案 → disabled 正確抄回」。代價：`f27b1` restore 測試群基底查詢 mock 前綴同步更新（14 條斷言全保留）。

## 守界聲明

- 僅依任務包實作後端 §2/§3；未動 DB schema（`draft_files` JSON 加欄免 ALTER）、未改 manifest 契約、未碰 allay_core、未碰前端/Tauri（F13a-4）、未碰 F19 反作弊（manifest 天然不含停用項，該軌無需動作）。
- 僅改一個 controller 檔 + 加/調測試，未順手重構周邊碼。