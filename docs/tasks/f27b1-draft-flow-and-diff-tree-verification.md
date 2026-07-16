# 驗收報告：F27b-1 伺服器檔案管理① — 自動草稿流 + 節點增刪改 + diff 樹（後端）

> 主要變更 repo：namelessrealms-api。本報告涵蓋後端資料模型與端點；橋接+前端另見 Nymless repo 同名報告。
> 完成 F 編號：F27b-1（後端部分）。同時收債 §12.7（禁止重 publish）、§12.8（addFile 同 path 替換）；併入 F30b 後端最小支援（policy 更新端點）。

## 變更檔案
- `src/database/server_modpack.sql` — `server_modpack_versions` 新增 `base_version_id VARCHAR(36) NULL` + FK `fk_smv_base ... ON DELETE SET NULL`；補 migration ALTER 片段。
- `src/api/controllers/server-modpack.controller.ts` — 新增 `deriveVersion`、`restoreFile`、`updateFilePolicy`；`publishVersion` 加重-publish guard；`addFile` 改同 dest_path 替換語意（保留 policy）；更新檔頭 @methods。
- `src/api/routes/server.routes.ts` — 掛載 `POST /:versionId/derive`、`POST /:versionId/files/restore`（置於 `/files/:fileId` 之前）、`PATCH /:versionId/files/:fileId`。
- `tests/modpool/f27b1-draft-flow.test.ts` — 新增 14 條契約測試。

## 設計重點
- **草稿衍生（copy-on-write）**：`deriveVersion` 從 published 版 fetch manifest，逐檔落地為 draft_files（policy 缺省補明確 `enforced`），`base_version_id` 指回基底；`version_label = body.label ?? {base_label}-draft`。單純 INSERT（不碰 modpack_file_refs，決定 15）。
- **錯誤風格**：此 controller 沿用 direct `res.status().json()`（非 AppError，配合既有風格）。需前端辨識的 409 一律帶 `code:"Conflict"`（bridge `parse_api_error`/`map_status_to_error` 皆映射到既有 `ErrorCode::Conflict`，**不動 allay_core**，符合 Yu 決定 1）。
- **§12.8 替換保留 policy**：同 dest_path 命中 → 替換 entry（沿用原 `id`）、`file_count` 不變；請求未明帶 policy 時**沿用原 entry policy**（不重置 enforced），僅明帶才覆寫。
- **§12.7 guard**：`publishVersion` 對 `status==='published'` 立即 409，manifest 不再被空 draft 覆寫。
- **restore 涵蓋還原修改與刪除**：同 path → 替換（沿用原 id、`file_count` 不變）；不存在 → 加回（`file_count + 1`）。
- **policy 定址用 fileId**（Yu 決定 2，與現行 delete 一致）。
- **publish policy value-based 確認**：現行 `f.policy && f.policy !== "enforced"` 已是 value 比對；衍生草稿雖將 policy 落地為明確 `enforced`，發布後 manifest entry 仍不含該欄位（補測試佐證），不違反 F30a。

## 測試結果
- 單元/契約測試：`yarn vitest run` → **10 檔 47 測試全通過**（新增 14 條 + 既有 33 條無回歸）。實際輸出：
  ```
  Test Files  10 passed (10)
       Tests  47 passed (47)
  ```
- `npx tsc --noEmit` → 乾淨（無輸出、exit 0）。
- 正向流程（實際執行，測試斷言）：
  - derive published → INSERT 帶 `base_version_id="v1"`、`version_label="v1.2-draft"`、`mc_version` 複製、draft_files 2 筆、缺 policy 的基底檔落地為 `enforced`、有 policy 的保 `default`；回 201。
  - addFile 同 path 二次上傳 → 持久化 1 筆、`id` 沿用 `f1`、`file_hash` 更新為新池 sha、`policy` 仍 `default`、UPDATE 不含 `file_count + 1`。
  - restore 還原修改 → 替換原 entry、沿用 id、hash 還原成基底、`file_count` 不變；還原刪除 → 加回、UPDATE 含 `file_count + 1`。
  - publish value-based → `mods/a.jar`（明確 enforced）manifest entry 無 policy 欄位；`config/b.txt`（default）保留。
- 負向流程（實際執行）：
  - derive on draft → 409；publish 重 publish → 409 且 `uploadToS3` 未呼叫；restore 基底無此 path → 404、無 base → 422、非 draft → 409；policy PATCH 非法值 → 400、published → 409。

## 審計確認
- 本任務無新增 audit log 面（modpack 端點沿用既有無 audit 慣例）；不涉敏感原值。

## 產物重建
- [x] 改過 TS 原始碼 → `npx tsc --noEmit` 通過（型別即產物；無 build 步驟）。
- [x] Vitest 全綠（見上）。
- **手動 ALTER 提醒**：migration 不自動套用。對既有資料庫需執行：
  ```sql
  ALTER TABLE server_modpack_versions
    ADD COLUMN base_version_id VARCHAR(36) NULL DEFAULT NULL,
    ADD CONSTRAINT fk_smv_base FOREIGN KEY (base_version_id)
      REFERENCES server_modpack_versions(id) ON DELETE SET NULL;
  ```
- **實測 entry 數（風險 §8）**：測試以 2 筆 manifest 驗證 derive 全量複製；draft_files 為 MEDIUMTEXT（16MB 上限），千檔級遠低於此，未觸及大 payload 限制。

## git 對帳
```
git log --oneline -1     → 9b42239 feat: F30a manifest per-file policy 契約（...）
git status               → M controller / M routes / M sql；?? tests/modpool/f27b1-draft-flow.test.ts（尚未 commit）
git rev-parse HEAD origin/main → 待 commit/push 後對帳
```

## CI
- 本地：`yarn vitest run` green、`npx tsc --noEmit` green。
- 狀態措辭：**local green, remote Actions 待人工確認**（push 後貼 run 連結）。

## 回歸守門
- 既有 `tests/modpool/policy.test.ts`、`publish-refs.test.ts` 全綠——publish guard 對既有測試（version 為 draft）不觸發、policy 透傳鏈未受 §12.8/§3.5 波及。
- `addFile` 對「不同 dest_path」維持追加 + `file_count + 1`（測試佐證）；`removeFile` 語意零變更。

## 守界聲明
- 僅依任務包實作後端 §2/§3；未動同步引擎、未改 manifest 契約本身、未碰 allay_core、未實作 F27b-2/3 面（分割編輯器 / 視圖切換）。
- carryover：F27b-2（檔案內容端點）、F29（mod metadata）、被替換舊池物件的回收沿用既有 `recycle_orphan_mods.ts`（決定 15）。