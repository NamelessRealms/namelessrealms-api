# F27b-2a 驗收報告 — 檔案內容讀寫端點（後端）

- 元件：namelessrealms-api（平台後端）
- 分支：`developers`
- 系列：F27b-2 伺服器檔案管理②（本包 = 2a 後端）
- 完成 F 編號：**F27b-2a**（後端內容讀寫端點 + 測試）

---

## 1. 變更檔案

| 檔案 | 變更 |
|---|---|
| `src/api/utils/s3/s3.ts` | 新增 `getObjectBuffer(key)` 讀取 helper（GetObjectCommand）；import 補 `GetObjectCommand` |
| `src/api/controllers/server-modpack.controller.ts` | 新增 `getFileContent` / `updateFileContent` 兩 handler + 常數 `MAX_EDITABLE_BYTES`；import 補 `getObjectBuffer/headObjectExists/keyFromUrl/publicUrlForKey` |
| `src/api/routes/server.routes.ts` | 新增 `GET`/`PUT /:serverId/modpack-versions/:versionId/files/:fileId/content`（掛於 `:fileId` block 之前，皆帶 JWT + `requirePermission(MANAGE_SERVER)`） |
| `tests/modpool/f27b2a-content.test.ts` | 新增 15 項測試（涵蓋任務包 §4 全 12 要求） |

---

## 2. 設計重點（對齊已裁決規格 §2）

- **S3 落點 = server 隔離路徑** `modpacks/{serverId}/files/{sha256}{ext}`，不進全域池 `mods/files/`；副檔名取自 `dest_path`（`path.extname`）。
- **refs 不碰**：端點只讀寫 `draft_files`，全程無任何 `modpack_file_refs` SQL；publishVersion 既有的 `/mods/files/` 前綴過濾天然排除隔離路徑（測試 §4-12 鎖定）。
- **可編輯上限 256 KB**（`MAX_EDITABLE_BYTES = 256*1024`，UTF-8 位元組計）；GET 以 `entry.file_size_bytes` 先查後讀、PUT 以 `Buffer.byteLength(content,'utf8')` 守門。
- **樂觀鎖**：PUT `baseSha256` ≠ entry 現值 hash → 409 `Conflict`。
- **published 唯讀**：GET 可讀（draft_files 全量路徑）；PUT → 409 `Conflict`。
- **就地替換沿用 `updateFilePolicy` 模式**：`SELECT status, draft_files WHERE id=? AND server_id=?` → 全量解析 → `findIndex(id)` → 就地改 `file_url/file_hash/file_size_bytes`（`id/policy/disabled/dest_path/file_name/version_id` 原樣保留）→ 單一 `UPDATE ... SET draft_files=? WHERE id=?`（`file_count` 不變，無 transaction）。
- **冪等 no-op**：新內容 sha256 == entry 現值 → 不上傳、entry 不動、回 200 原值。
- **上傳去重**：`headObjectExists(key)` 命中則跳過 `uploadToS3`，URL 取 `publicUrlForKey(key)`。
- **停用檔可編輯**：`disabled:true` 不特別攔。

### PUT 守門順序（§3.2）
1. body 型別（content/baseSha256 非 string）→ 400（content 允許空字串，故用型別判定非 falsy）
2. 版本不存在 → 404
3. published → 409 `Conflict`
4. entry 不存在 → 404
5. `byteLength > 256KB` → 422
6. content 含 `\0`（null byte）→ 422
7. `baseSha256` ≠ hash → 409 `Conflict`

---

## 3. 測試結果（實際執行輸出）

### 3.1 型別檢查 `npx tsc --noEmit`
```
（無輸出，exit 0 — src 型別通過）
```

### 3.2 CI 等價建置 `yarn build`（= outputVersion + buildDir + tsc）
```
$ node build.js
Done in 2.75s.
```

### 3.3 新增測試 `npx vitest run tests/modpool/f27b2a-content.test.ts`
```
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  196ms
```

### 3.4 全量迴歸 `npx vitest run`
```
 Test Files  18 passed (18)
      Tests  135 passed (135)
   Duration  1.79s
```
> 註：輸出中 `[ERROR] [Unhandled Error] Error: 非預期` 一行為 `tests/middlewares/error.middleware.test.ts` 內**刻意拋出**以驗證 error middleware 的案例（該測試通過），非失敗。

### 3.5 §4 測試對照
| §4 要求 | 對應測試 | 結果 |
|---|---|---|
| 1 GET draft 成功 | `getFileContent › draft 讀取成功` | ✅ |
| 2 GET published（draft_files 全量） | `getFileContent › published 版讀取成功` | ✅ |
| 3 GET 空/NULL 舊 published → 404 | `getFileContent › draft_files 空/NULL 舊 published 版 → 404` | ✅ |
| 4 GET size 超限 → 422（getObject 未呼叫） | `getFileContent › entry.size 超限 → 422` + `not.toHaveBeenCalled` | ✅ |
| 5 GET null byte → 422 | `getFileContent › 內容含 null byte → 422` | ✅ |
| 6 PUT published → 409 Conflict | `updateFileContent › published → 409 Conflict` | ✅ |
| 7 PUT baseSha256 不符 → 409 Conflict | `updateFileContent › baseSha256 不符 → 409 Conflict` | ✅ |
| 8 PUT 成功替換（id/policy/disabled/count/url/hash/size） | `updateFileContent › 成功替換` | ✅ |
| 9 PUT 上傳 key = 隔離路徑非 mods/files/ | `updateFileContent › 上傳 key 為 modpacks/{serverId}/...` | ✅ |
| 10 PUT no-op → 不上傳、不變、200 | `updateFileContent › no-op` | ✅ |
| 11 PUT 超限/null byte/缺 body → 422/422/400 | 三則獨立測試 | ✅ |
| 12 refs 不被寫入 | `updateFileContent › refs 不被寫入` | ✅ |

> 額外第 15 項：`headObject 命中 → 跳過上傳、URL 沿用該 key`（去重路徑補強）。

**測試 8 強化**：內容刻意用含空格的真實 properties 格式 `key = value\nother = 1`——若守門誤實作成「空格」判定而非 null byte，此案會當場翻紅（既有 null byte 案例抓不到此誤植）。

---

## 4. Remote CI（Actions）

- 觸發：push `developers` → workflow `CI`（`yarn test` + `yarn build`）。
- Run 連結：**（待 push 後回填）**
- 狀態：**（待回填）** — Actions 紅則本任務不算完成。

---

## 5. Git 三步對帳（待 push 後回填）

- `git add`：`src/api/utils/s3/s3.ts`、`src/api/controllers/server-modpack.controller.ts`、`src/api/routes/server.routes.ts`、`tests/modpool/f27b2a-content.test.ts`、`docs/tasks/f27b2a-content-endpoints-verification.md`
- commit hash：（待回填）
- push / remote SHA：（待回填）

---

## 6. 產物重建確認

- 後端無需前端 build 產物；`yarn build`（tsc + build.js）本地通過（§3.2）。
- `src/version.ts` 為 build 生成物（`yarn outputVersion` 覆寫），本次 build 產生的註解剝除屬生成器副作用、非本任務原始碼變更，已 `git checkout` 還原，不納入提交。

---

## 7. 回歸守門

- 全量 `npx vitest run`：18 files / 135 tests 全綠（含既有 modpool 迴歸）。
- 未改動任何既有 handler / 路由 / 測試邏輯；僅新增。

---

## 8. 偏離記錄

1. **新增 `getObjectBuffer`（s3.ts）**：§3.1 明訂「以 getObject 讀取，不走公開 HTTP 下載，不依賴 public ACL」，但 repo 原無此 helper（既有讀取走 `got`/`fetch` 公開 URL）。屬 spec 要求的**必要新增**，非規格偏離。CI 中 S3 全 mock，此 helper 未對真機 MinIO 驗證（真機讀寫留待 2b 橋接後端到端）。
2. **無 transaction**：沿用 `updateFilePolicy` 既有單一 `UPDATE` 模式；並發 race 屬既有債，本包不加碼處理。
3. **無關變更排除**：working tree 既有的 `.gitignore` 改動（新增 `.claude/settings.local.json` 條目）非本任務所為，**不納入**本次提交。

---

## 9. 守界聲明

- 僅動 namelessrealms-api 後端 `src` + `tests` + 本報告；未碰 Tauri bridge、前端、表單引擎（皆屬 2b/2c）。
- 未更新 TECHNICAL_SPEC / 計劃文件（收案後由規劃側處理）。
- 舊 published 版（draft_files 空）GET → 404 為**已知限制**（manifest fallback 無 fileId 可定址，已裁不做）。