# namelessrealms-api

Nameless Realms 的後端 API 伺服器，提供 Nymless 桌面前端應用程式、Discord BOT、官方網站、帳號系統、驗證碼、資源配置等功能。

## 技術棧

- **語言**：TypeScript (Node.js)
- **框架**：Express 5
- **資料庫**：MySQL 2（連線池，上限 10）
- **認證**：JWT HS256（jsonwebtoken）
- **密碼雜湊**：Argon2（新）/ MD5 + Salt（舊格式，登入時自動 Lazy Migration）
- **郵件**：Nodemailer（發送 OTP 驗證碼）
- **即時通訊**：Socket.IO 4
- **API 文件**：Swagger UI（`/api-docs`）
- **預設 Port**：8030

## 常用指令

```bash
# 開發模式（熱重載）
yarn dev

# 構建正式版本
yarn build

# 啟動正式版本
yarn start
```

## 環境變數

參考 `.env` 檔案，必要設定包含：
- `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`
- `JWT_SECRET` — JWT 簽名密鑰
- `JWT_SALT` — 舊版 MD5 密碼的 salt
- `NODE_ENV` — `development` 或 `production`

## 資料庫資料表

- `users` — 帳號（`unique`, `username`, `email`, `password`, `roles`）
- `verification_codes` — OTP 驗證碼（`email` PK, `code`, `expires_at`）
- `servers` — 伺服器資料（見 `src/database/servers.sql`）
- `minecraft_accounts` — 玩家 Minecraft 帳號連結（見 `src/database/minecraft_accounts.sql`）
- `api_keys` — API Key 管理（見 `src/database/api_keys.sql`）

## 重要注意事項

- **密碼 Lazy Migration**：舊帳號密碼格式為 MD5 + salt，登入成功後自動升級為 Argon2，不影響本次登入
- **錯誤格式**：統一使用 `AppError(message, httpStatus, errorCode)`，由 `errorMiddleware` 統一處理回傳
- **非同步路由**：所有路由 handler 必須用 `asyncHandler()` 包裝，否則非同步錯誤不會傳遞給 errorMiddleware
- **`InteractionsRouter` 目前被註解**：Socket 互動功能尚未完整啟用
- **環境設定**：`src/environment/environment.ts` 根據 `NODE_ENV` 動態匯出 dev/prod 設定，不使用 `config.service.ts` 的環境變數直接存取
- **路由基底類別**：`IRoutes.ts` 提供 `_routers`、`_authJwtVerify` 等共用屬性，所有路由類別皆繼承它

# 程式碼地圖

> 跨 repo 關係見 `../Nymless/docs/ECOSYSTEM.md`(同上層資料夾,路徑含空格需引號)。本 repo 與 Nymless/allay_core 無編譯期耦合,契約靠 HTTP API(F25 將 OpenAPI 化)。

## 分層與目錄結構

請求流:`routes → middlewares → controllers → services → utils/mysql · s3`。業務邏輯放 services,controller 只做參數驗證與組裝回應。

```
src/
├─ index.ts / app.ts     進入點與 Express 組裝
├─ api/
│  ├─ routes/            路由層,皆繼承 IRoutes(_routers、_authJwtVerify 共用)
│  ├─ middlewares/       authJwtVerify(啟動器 JWT)、verifyApiKey(Bot)、
│  │                     requirePermission(伺服器內權限)、rateLimiters、
│  │                     asyncHandler(必包)、error.middleware
│  ├─ controllers/       auth / user / server / server-member / server-role /
│  │                     server-sub-server / server-modpack / mods / platform /
│  │                     sponsor / violation / whitelist / interactions(未啟用)
│  ├─ services/          業務邏輯,依領域分子資料夾:
│  │  ├─ mods/           mods.service、mod-metadata.service、
│  │  │                  platform-curseforge / platform-modrinth(外部平台介接)
│  │  ├─ server/         server、member、role、sub-server、sub-server-status
│  │  └─ auth / user / sponsor / violation / whitelist / mail
│  └─ utils/             mysql(連線池)、s3、modpool(全域池 + curseforge-url)、
│                        modJarParser、permissions、response(AppError)、verify
├─ database/             各資料表 .sql(schema 單一真實來源,新表先落 .sql)
├─ environment/          dev/prod 動態匯出(經 environment.ts,非 config.service)
├─ socket/               Socket.IO 事件(Discord 社群互動,部分未啟用)
└─ interface/            DTO / 介面定義

tests/                    vitest;docs/tasks/ 任務交接件
根目錄 *.ts 腳本          一次性維運(backfill / audit / recycle / create_api_key)
```

## 認證雙軌

| 客戶端 | 機制 | 守門 |
|--------|------|------|
| Nymless 啟動器 | JWT HS256 | `authJwtVerify` |
| Discord Bot | `api_keys` 資料表 | `verifyApiKey` |

新路由選錯守門會造成跨客戶端洩漏,任務包未明註時先問。

## S3 儲存策略(不可混用)

- 全域模組池:`mods/files/{sha256}{ext}`——跨伺服器去重,上傳前 `headObject` 預檢。
- 伺服器編輯檔:`modpacks/{serverId}/files/{sha256}{ext}`——隔離路徑,**不進全域池**。

## 地雷清單

- **雜湊一律 SHA-256(入庫層正規化)**:Modrinth API 只給 sha1/sha512,需下載後親算;CurseForge 雜湊需正規化。
- **CurseForge `downloadUrl` 可為 null**;forgecdn 下載強制 `x-api-key`(2026-07-16 起)。
- **asyncHandler 必包**:漏包時非同步錯誤不進 errorMiddleware,直接掃每條新路由。
- **對外回應錯誤一律 AppError 結構化**,不回框架預設純文字(上游會 5xx)。
- **密碼 Lazy Migration**:舊 MD5+salt 登入成功後自動升 Argon2,動 auth 流程勿破壞此路徑。

# 撰碼規約

> 規則來源為知識庫 `WORKFLOW.md`「撰碼規約」節（2026-08-01）；本節是 namelessrealms-api 取用的對應段落（A / C / F / G），兩者不一致時以來源為準。
> React（B）、假資料原型（E）不適用本 repo。

## A. 檔案體積
- TS 單檔超過 20 KB 即須停下評估是否分檔；超過 40 KB 視為必須處理。

## C. 去重
- 同一份資料的不同視角必須共用資料層，不得各寫一遍。
- ⚠️ **但不得過早抽象**：相似度高但屬**不同領域**的流程不合併。判準：「這兩處未來會不會因為**不同的理由**而改動？」會，就不合併。
- 重複兩次可以忍，第三次必須抽。錯的抽象比重複更貴。

## F. 後端分檔
- 單一 controller 超過約 25 KB 依領域分檔（例：版本 CRUD / 檔案操作 / 發布衍生）。

## G. 重複率門檻
- jscpd 基線建立後進 CI，threshold **只准降不准升**。任務若預期提高重複率，須於任務包中說明理由並過 Yu。

# 編碼行為準則（Karpathy Guidelines）

## 1. 先思考再動手
- 明確說出假設，不確定就問
- 有多種解讀時，列出來讓用戶決定，不自行選擇
- 有更簡單的做法就說，該推回就推回
- 有不清楚的地方，停下來，說明疑點，提問

## 2. 最小實作
- 只做被要求的功能，不加未被要求的彈性或擴展性
- 單次使用的程式碼不做抽象
- 不替不可能發生的情境加 error handling
- 200 行能寫成 50 行就重寫

## 3. 精準修改
- 只改任務要求的地方，不「順便」改周邊程式碼
- 配合既有風格，即使你有不同偏好
- 注意到無關的 dead code，用文字提醒，不自行刪除
- 只清理自己的修改所造成的孤兒（unused import/var/func）

## 4. 目標導向執行
- 把任務轉成可驗證的成功標準再動手
- 多步驟任務先列簡短計畫：`步驟 → 驗證方式`
- 完成後確認是否達成標準，未達標則繼續修正

# 程式碼註解規範
- 所有 exported / public 函數必須有文件註解
- 超過 10 行的 private 函數也要加
- TS/JS 用 JSDoc，Rust 用 ///
- 格式參考 ~/.claude/commands/add-file-comments.md

# 驗收與產物重建紀律

## 任務完成後產出
- 實作完成後必須產出驗收報告：每個任務實作完成後主動產出 `docs/tasks/{任務代號}-verification.md`（例 `F4-F5-verification.md`，格式沿用 `docs/tasks/verification_template.md`），不需等我要求。內容含：變更檔案、設計重點、測試結果、正向/負向流程的實際執行輸出、git 三步對帳、產物重建確認、回歸守門、守界聲明。跨 repo 任務時，報告放本次「主要變更 repo」的 `docs/tasks/`；任務包會註明主 repo。
- CI 措辭精確：任務完成需 local green + remote Actions 綠（附 run 連結）；Actions 紅則任務不算完成。仍不可把本地綠燈當「CI 通過」。
- 驗收報告不得用範本／預期值／設計推理冒充已執行；真機做不到就誠實標「待人工」。

## 產物重建
- 改 API 原始碼 → 重啟服務（TS 則先重 build）。無原始碼變更標「沿用現有產物」。
- 對外 API 缺欄／錯誤 → 回乾淨的結構化錯誤，不回框架預設純文字錯誤導致上游 5xx。