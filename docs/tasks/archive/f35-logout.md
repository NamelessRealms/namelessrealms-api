# 任務包：F35 登出功能（含後端 refresh token 撤銷）

> 規劃側 Claude 產出，交 Claude Code 實作。自足、copy-paste-ready。
> **三 repo：`namelessrealms-api`（撤銷端點）＋ `allay_core`（keyring 清除修正）＋ `Nymless`（指令與 UI）**

## 追溯資訊
- **日期**：2026-08-06
- **前置依賴**：F32 的 f32-1 / 2a / 2b / 3a 均已收案（i18n 骨架與守門就位；新增字串一律走 i18n key，`noHardcodedCjk.test.ts` 會擋硬編碼）
- **緣由**：此缺口自 2026-08-03 登記，已**連續三包**擋掉錯誤訊息的真機驗證（f32-1 步驟 6、f32-2a、f32-3a 步驟 4）——`getErrorMessage` 的 10 個呼叫點全在登入／註冊／連結流，沒有登出就進不去。**本包完成後，那條 carryover 才可能結案。**
- **另有一顆死按鈕**：`SettingsGeneral.tsx:74` 的登出按鈕**沒有 `onClick`**，畫面上承諾了一個不存在的功能。
- **Yu 已裁決（2026-08-06）**：1丙（預設只登出平台帳號，確認框提供「同時移除已連結的 Minecraft 帳號」勾選）／2甲（兩處入口：死按鈕接活 ＋ 右上帳號選單）／3乙（清完 token 後整個 webview reload）／4乙（跨 repo，後端一併做撤銷）／5甲（撤銷清單，以 token 雜湊為鍵）

---

## 目標

讓使用者能真正登出：本機憑證清乾淨、後端 refresh token 失效、回到登入頁，且**這一台登出不影響其他裝置**。

**做完長什麼樣**：右上帳號選單或設定頁按登出 → 確認框（可勾選一併移除 MC 帳號）→ 回到登入頁 → 重開 app 仍是未登入 → 用舊的 refresh token 打後端會被拒。

---

## 範圍 A —— `namelessrealms-api`（撤銷機制）

### A1. 資料表（⚠️ 本 repo 無 migration 框架，沿既有慣例走 SQL 檔）

新增 `docs/sql/2026-08-06-revoked-refresh-tokens.sql`：

```sql
CREATE TABLE IF NOT EXISTS revoked_refresh_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  expires_at DATETIME NOT NULL,
  INDEX idx_expires_at (expires_at)
);
```

`token_hash` 為 refresh token 原字串的 SHA-256 十六進位小寫；`expires_at` 取自該 token 的 `exp`。

⚠️ **部署順序**：**必須先建表再部署程式**。表不存在會讓 refresh 流程整個 500（見 A3 的 fail-closed 規則）。這一點寫進驗證報告的部署說明。

### A2. `POST /auth/logout`

- 位置：`auth.routes.ts` 加路由、`auth.controller.ts` 加 handler、`auth.service.ts` 加 `revokeRefreshToken`
- 請求：`{ "refresh_token": "..." }`
- **⛔ 不掛 `authJwtVerify`**：持有 refresh token 本身就是憑證；且 access token 可能已過期，那正是要登出的情境之一
- 行為：
  1. `jwt.verify(refresh_token, config.jwt.refreshSecret)` → 失敗回 401 `Unauthorized`
  2. 算 SHA-256 → `INSERT ... ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`（重複登出不得報錯）
  3. 順手清理：`DELETE FROM revoked_refresh_tokens WHERE expires_at < NOW()`（⛔ 不加排程，登出時清就夠，表本身有上界）
  4. 成功回 204 或 `{ success: true }`（依本 repo 既有回應慣例，實作時對齊 `AppResponse`）
- 速率限制：沿用既有 `rateLimiters` 的模式，⚠️ 但**不得用 `loginLimiter`**（語意不同）；若既有無適用者，加一個寬鬆的即可，並在報告說明選擇。

### A3. `refreshAccessToken` 加撤銷檢查

在 `jwt.verify` 成功之後、查 `users` 之前，先查撤銷表；命中則丟 `AppError("...", 401, "Unauthorized")`。

⚠️ **fail-closed**：查詢本身出錯（表不存在、DB 異常）→ **視為無法驗證，回 401，⛔ 不得放行**。理由：同一個流程緊接著就要 `SELECT * FROM users`，DB 掛了本來就過不去，fail-open 只會製造一個「DB 異常時撤銷失效」的安全洞。

### A4. 測試

沿本 repo 既有測試慣例（`tests/`、vitest）：
- 撤銷後以同一 refresh token 換 access token → 401
- 未撤銷的 token → 正常換發
- 重複撤銷同一 token → 不報錯
- 過期列會被清掉
- ⚠️ 若既有測試對 DB 的處理方式不支援上述情境，**停手回報**，⛔ 不自行引入新的測試基礎設施

---

## 範圍 B —— `allay_core`（keyring 清除修正）

⚠️ **這是實查揭出的既有缺陷，不修就會讓「移除 MC 帳號」留下殘渣**：

`set_microsoft_access_token_for(uuid, "")` 目前只刪 `ms_at_{uuid}`（marker）與 `ms_at_{uuid}_cc`（分塊數），**⛔ 不會刪 `ms_at_{uuid}_p{i}` 那些分塊**。而且它先刪掉 `_cc`，之後就再也不知道有幾塊——**殘渣永久留在系統 keyring 裡**。Microsoft access token 經常超過 1000 bytes，所以這是常態不是邊角。

新增 `Profiles::clear_microsoft_tokens_for(&self, uuid: &str) -> crate::Result<()>`：
1. 讀 marker，若為 `CHUNKED` → 先讀 `_cc` 取得數量 → 逐一刪 `ms_at_{uuid}_p{i}`
2. 刪 `_cc`
3. 刪 marker
4. 刪 `ms_rt_{uuid}`
5. 任一步的 keyring「查無此項」視為成功（冪等），其餘錯誤照常回傳

⛔ **不改既有 setter 的行為**（那會牽動其他呼叫點）；新增方法即可。
⛔ 不做其他 allay_core 改動。

---

## 範圍 C —— `Nymless`（指令與 UI）

### C1. `src-tauri`：`logout` 指令

`nymless_api/auth.rs` 加 `logout(clear_minecraft_accounts: bool)`，`commands.rs` 加薄轉發，`lib.rs` 註冊。流程**嚴格照此順序**：

1. **先取 refresh token**（清除前要用）
2. **打後端 `POST /auth/logout`（best-effort）**：⛔ **無論成功、失敗、逾時、離線，都必須繼續往下清本機**。失敗只 `tracing::warn!` 記錄，⛔ 不得回傳錯誤中斷登出——離線也要能登出。
3. 清 Nymless 憑證：`set_nymless_access_token("")`、`set_nymless_refresh_token("")`
4. 清使用者資訊：`profiles.user.username = ""`、`profiles.user.id = ""`、`nymless_auth.expires_at = 0`
5. **若 `clear_minecraft_accounts == true`**：對 `players` 每一個 uuid 呼叫 `clear_microsoft_tokens_for(uuid)`，然後 `players.clear()`、`active_player_uuid = ""`
6. `profiles.sync(&app_path::get_profile_json_file_path())`
7. 回 `Ok(())`

⚠️ 鎖範圍：沿 `set_language` 的前例——寫入用 write guard，`sync` 之前先釋放，⛔ 不得巢狀持鎖。

### C2. 前端服務層

`services/auth.ts` 加 `logout(clearMinecraftAccounts: boolean)`，走 `safeInvoke`（⛔ 不得直接 `invoke`）。

### C3. 兩處入口（Yu 2甲）

1. **`SettingsGeneral.tsx:74` 的死按鈕接活**——它已經在那裡承諾了功能
2. **右上帳號選單**（`MainLayout` 的 `FriendsPanel` 左半，帳號區段）加登出項

兩處**共用同一個處理函式**，⛔ 不得各寫一份。

### C4. 確認框（Yu 1丙）

用既有的 `ConfirmModal`：
- 標題／內文說明登出的後果
- **一個勾選：「同時移除已連結的 Minecraft 帳號」，預設不勾**
- ⚠️ 勾選時內文要讓玩家知道這代表什麼（下次要重新用 Microsoft 登入）
- 確認鈕為危險樣式（沿既有 `danger` 慣例）

⚠️ `ConfirmModal` 目前沒有勾選框。**若加勾選需要改該元件，這是允許的**，但：⛔ 不得改變既有呼叫點的行為（新參數必須可選、不傳時完全維持現狀），且要跑一次 `yarn e2e:browser` 確認沒動到既有彈窗。

### C5. 登出後 reload（Yu 3乙）

清除成功後 **reload webview**，由 Splash 的既有流程重新判定未登入 → 導向登入頁。
⛔ 不要逐一清 in-memory state——那正是 3乙 要避免的殘留風險。
⚠️ reload 前確認 `sync` 已完成（await），否則會清了記憶體卻沒落盤。

### C6. 字串

新增字串一律走 i18n key，兩語言都要寫：
- 按鈕與選單項 → `common` 或 `settings`（依位置，先查既有 key 再建新的）
- 確認框內容 → `settings:logout.*`
- 失敗提示 → 走既有錯誤層

⛔ **不得硬編碼中文**（`noHardcodedCjk.test.ts` 會擋）。zh-TW 依 copy-guide §二、en 依 §三之二。⚠️ 這是 f32-3a 之後第一個新增文案的包，**寫的時候就要合規**，不是留給 f32-3b 改。

---

## 不做什麼（明確守界）

- ⛔ **不清本機已下載的模組、遊戲檔案、instances**——下次登入直接可用；要清有既有設定入口。
- ⛔ **不做「登出所有裝置」**（那是 token 版本號方案，Yu 已裁 5甲 走 per-device 撤銷）。
- ⛔ **不做 session 列表 / 裝置管理**。
- ⛔ 不動 `players` 以外的 Store 欄位、不動 `Settings`、不碰語言設定。
- ⛔ 不重構 `MainLayout` 的好友區段（那是 mock，撰碼規約 E 排除）。
- ⛔ 不改既有的 `set_microsoft_access_token_for` / `set_microsoft_refresh_token_for` 行為。
- ⛔ 不改 JWT payload、不動 `verify` / `registerUser` 的簽發邏輯。
- ⛔ 不修任何「待排小項」（特別是 `fix-dialog-family` 的三處 `alert()` 與三顆檔案對話框鈕——**即使你在 `SettingsGeneral` 裡會看到它們**）。
- ⛔ 不動 `.jscpd.json`、`e2e/**`、`tDeps.test.ts`、`noHardcodedCjk.test.ts` 的規則。

---

## 實作要點

- **建議順序**：範圍 A（api，可獨立驗）→ 範圍 B（allay_core）→ 範圍 C（Nymless）。C 依賴 B 的新方法。
- **A 與 C 的部署耦合**：C2 打的端點若不存在會 404 → 但因為 best-effort，本機仍會清乾淨。所以兩邊上線順序不致命，**但 api 先上比較乾淨**。
- **⛔ 後端失敗不得阻擋登出**這條是本包的核心紀律，寫進程式碼註解。
- keyring 的「查無此項」在各平台的錯誤型別不同，`clear_microsoft_tokens_for` 要對此**冪等**——⚠️ 若無法判斷是「查無」還是「真的失敗」，**停手回報**，⛔ 不要一律吞掉（那會讓真的清除失敗變靜默）。

---

## 驗收步驟

### 本機（實際執行，貼真實輸出）

**api**：`yarn build` 綠、既有測試綠 + 新增測試（列名稱與數量）、`npx jscpd@5.0.14` vs 門檻 3.7
**allay_core**：`cargo test` 綠、`cargo clippy` 無新警告、`npx jscpd@5.0.14` vs 門檻 3.0
**Nymless**：`yarn build` 綠、`yarn test` 綠（f32-3a 後基線 178）、`cargo test --lib` 綠、**`yarn e2e:browser` 14 條全綠**、`npx jscpd@5.0.14` vs 門檻 2.5
**allay_core 變更 → Nymless 側 `cargo build` 確認拉到新碼**

負向：
- 對已撤銷的 refresh token 換發 → 401（貼輸出）
- 撤銷表不存在時 refresh → 401 而非放行（fail-closed 驗證；⚠️ 若測試環境難以模擬，說明理由）
- 後端不可達時呼叫 `logout` → 本機仍完成清除（可用改 base url 或關 api 模擬）

### 真機 E2E（Yu 執行）

⚠️ Yu 說「開始真機 E2E」後**一次只給一步**；⛔ 不整份貼出。

| # | 操作 | 過線標準 |
|---|---|---|
| 1 | 設定頁按登出（不勾選） | 確認框正常、文案為當前語言；取消可返回 |
| 2 | 確認登出 | 回到登入頁；⛔ 無殘留上一個帳號的畫面或資料 |
| 3 | 重開 app | 仍是未登入狀態 |
| 4 | **🔴 錯誤訊息 NR 代碼（三包積欠的驗證）** | 在登入頁用錯誤密碼登入 → 訊息符合 copy-guide §四：白話＋可做什麼＋`（代碼 NR-2002）`；⛔ 無 URL／狀態碼／`os error`。**中英各驗一次** |
| 5 | 重新登入 → 檢查 MC 帳號 | 未勾選時**已連結的 MC 帳號仍在**，不需重新用 Microsoft 登入 |
| 6 | 右上帳號選單的登出入口 | 與設定頁行為一致（同一函式） |
| 7 | 勾選「同時移除 Minecraft 帳號」後登出 → 重新登入 | MC 帳號清單為空，需重新連結 |
| 8 | 離線登出：關掉網路後登出 | **仍能登出**、回到登入頁；⛔ 不得卡住或報錯中斷 |
| 9 | 撤銷生效：登出後重開 app | 不會用舊 refresh token 自動登入 |

### 守界聲明（報告中逐項回答）
1. 後端不可達時，本機清除是否仍完整執行？在哪一行保證的？
2. `clear_microsoft_tokens_for` 對分塊 token 的清除是否完整？如何驗證（keyring 實查）？
3. 是否改動既有 setter、JWT payload、或 `ConfirmModal` 既有呼叫點的行為？
4. 新增字串是否全部走 i18n key、兩語言齊備？`noHardcodedCjk.test.ts` 是否綠？
5. 是否碰了 `fix-dialog-family` 的任何一項？（應為「否」）

---

## 完成後

1. 先落 `docs/tasks/f35-logout-plan.md`（**寫在 `namelessrealms-api`，因為它是主 repo**）等規劃側審核（`f35-logout-plan-review.md`），放行後才動工。
2. 產出 `docs/tasks/f35-logout-verification.md`。
3. **文件更新**：三個 repo 的 `CLAUDE.md` 各補新增的指令／端點／方法；`Nymless/docs/ECOSYSTEM.md` **需補一筆**——本包新增了一條跨 repo 的認證流程（登出撤銷），與該檔既有的「認證雙軌」段落相關，請判斷後說明。
4. **commit / push 前回報，待 Yu 確認**。push 順序：**allay_core 綠 → Nymless；api 獨立**。三個 repo 的 run 連結都要附。
5. ⚠️ **部署說明**：報告中明確寫出「`revoked_refresh_tokens` 表必須先建立，再部署 api」，並附 SQL 檔路徑。
6. 順手把已收案的 `f32-3a-*.md` 移入 `Nymless/docs/tasks/archive/`。
