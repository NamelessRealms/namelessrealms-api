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