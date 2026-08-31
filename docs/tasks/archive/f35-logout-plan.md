# F35 登出功能 實作計畫（待規劃側審核）

> 對應任務包：`docs/tasks/f35-logout.md`
> 撰寫：Claude Code　日期：2026-08-07　主 repo：**namelessrealms-api**（跨三 repo）
> **狀態：未動工。** 本文件產出過程**未修改任何 repo 的原始碼**——只跑唯讀基線指令（`yarn test` / `yarn build` /
> `cargo test` / `npx jscpd`）。三 repo 動工前 `git status --porcelain` 見 §0.1。
> ⛔ **§1 有 6 條需裁決事項**（2 條阻塞、2 條屬慣例對齊、1 條屬文案定案、1 條屬測試可行性），
> 其餘全部沿既定慣例，不再議。

---

## 0. 動工前的前置探針（已實跑，結論可引用）

### 0.1 三 repo 基線（實跑輸出）

| Repo | 分支 | 測試 | 建置 | jscpd（門檻） | `git status --porcelain` |
|---|---|---|---|---|---|
| namelessrealms-api | `developers` | `18 files / **135 passed**` | `yarn build` ✅ | **3.33%**（29 clones，79 檔）／門檻 **3.7** | 僅 `?? docs/tasks/f35-logout.md` |
| allay_core | `main` | `cargo test`：**55 passed, 0 failed, 2 ignored** | —— | **2.65%**（27 clones，50 檔）／門檻 **3.0** | 乾淨 |
| Nymless | `main` | `yarn test`：`9 files / **178 passed**`；`cargo test --lib`：**35 passed** | `yarn build` ✅（`✓ built in 2.21s`） | **2.13%**（30 clones）／門檻 **2.5** | 乾淨 |

`e2e:browser` 未在計畫階段實跑（需起 dev server），於驗收階段實跑並貼輸出。
現有 spec 兩支（`smoke.e2e.js` 1 條、`config-form-layout.e2e.js` 15 條），**皆不觸及設定頁與登出流**——
§C4 改 `ConfirmModal` 對 e2e 的風險面很小，但仍照任務包要求實跑一次。

### 0.2 關鍵可行性探針（結論已改變實作設計）

| # | 探針 | 結論 |
|---|---|---|
| P1 | api 測試能否在不引入新基礎設施下覆蓋撤銷情境 | ✅ **可以**。既有 10 支測試已用 `vi.mock("../../src/api/utils/mysql", () => ({ default: { getPool: () => ({ query: poolQuery }) } }))` 的形式攔截連線池（見 `tests/modpool/f27b2a-content.test.ts:38`）。⛔ 不需新增測試基礎設施，任務包 §A4 的「停手回報」條件**不成立** |
| P2 | `keyring 2.3.3` 能否分辨「查無此項」與「真的失敗」 | ✅ **可以**。`keyring::Error::NoEntry` 為獨立列舉變體（`keyring-2.3.3/src/error.rs:38`）。⛔ 不需一律吞錯，任務包 §實作要點的「停手回報」條件**不成立** |
| P3 | `window.location.reload()` 能否達成 §C5 | ❌ **不能**，見 §1 疑點 5——必須改用 `location.href = "/"` |
| P4 | 本 repo 是否存在 `AppResponse` | ❌ **不存在**，見 §1 疑點 3 |
| P5 | 本 repo `.sql` 的實際落點 | `src/database/`（20 支），`docs/` 下只有 `dedup/` 與 `tasks/`。見 §1 疑點 1 |
| P6 | `ConfirmModal` 的既有呼叫點數量 | **2 處**（`SettingsLibrary.tsx`、`ServerSettingsMods.tsx`）——新增 optional prop 的衝擊面可完全列舉 |

---

## 1. 動工前需裁決的六件事

### ⛔ 疑點 1（阻塞 §A1）—— SQL 檔落點與任務包指定不符

任務包 §A1 指定 `docs/sql/2026-08-06-revoked-refresh-tokens.sql`，但**本 repo 沒有 `docs/sql/`**，
且 `CLAUDE.md` 程式碼地圖明載：

> `database/` 各資料表 .sql（**schema 單一真實來源**，新表先落 .sql）

實查 `src/database/` 有 20 支 `.sql`（`users.sql` / `verification_codes.sql` / `api_keys.sql` …），
命名一律 `{table_name}.sql`、**無日期前綴**。任務包自己也寫「⚠️ 本 repo 無 migration 框架，**沿既有慣例走 SQL 檔**」——
慣例與指定路徑互相矛盾。

**建議（甲）**：落 `src/database/revoked_refresh_tokens.sql`，DDL 沿既有風格（反引號識別字、
`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`、`KEY` 而非 inline `INDEX`）：

```sql
CREATE TABLE IF NOT EXISTS `revoked_refresh_tokens` (
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

（乙）照任務包字面新開 `docs/sql/`——**不建議**：schema 的單一真實來源會就此分岔成兩處。

---

### ⛔ 疑點 2（阻塞 §C3-1）—— `SettingsGeneral.tsx:74` 的死按鈕在假資料迴圈裡

任務包說「死按鈕接活」。實查該按鈕位於 `MOCK_ACCOUNTS.map()` 之內，**每個假的 Minecraft 帳號一顆**：

```tsx
{MOCK_ACCOUNTS.map((acc) => (            // ← MOCK_ACCOUNTS 是 Minecraft 帳號（name + uuid + 頭像）
  <SettingsRow key={acc.id} label={acc.name} description={`UUID: ${acc.uuid}`} …>
    <button className="…text-red-400…">{t("settings:general.signOut")}</button>   // ← :74，無 onClick
  </SettingsRow>
))}
```

它承諾的是「**移除這一個 Minecraft 帳號**」，不是「登出 Nymless 平台帳號」。
直接把平台登出掛上去，會變成「按任何一列 MC 帳號的登出 → 整個平台帳號登出」，語意錯得比死按鈕更糟。

三個選項：

| | 做法 | 代價 |
|---|---|---|
| **甲（建議）** | 在「帳號管理」區段**最上方新增一列真實的 Nymless 帳號**（username 走既有 `getNymlessUsername()`，形狀鏡射 `MainLayout` 的 Nymless 帳號 pill），登出鈕掛在該列。MOCK 的 MC 帳號列**原封不動** | 設定頁仍留著 MOCK 列上的死鈕（屬未實作的「移除單一 MC 帳號」，非本包範圍）；需在報告中登記為既有缺陷 |
| 乙 | 甲 ＋ **移除** MOCK 列上的死鈕 | 動到假資料原型（規約 E），且違反 Karpathy §3「注意到無關的 dead code，用文字提醒，不自行刪除」 |
| 丙 | 照字面把平台登出接到 MOCK 列的鈕上 | 語意錯誤；且一個畫面出現 2 顆行為相同的登出鈕 |

**建議甲**——依 f32-2a 已立的裁決「規約 E 的排除單位是**區段**不是元件，真功能該做真」，
新增的真實 Nymless 帳號列正是該區段裡「真的那一半」。

---

### ⛔ 疑點 3（慣例對齊）—— 任務包 §A2-4 提到的 `AppResponse` 不存在

`src/api/utils/response/` 只有 `AppError.ts` 與 `replyError.ts`，**沒有 `AppResponse`**。
本 repo 的成功回應慣例是 controller 內直接 `response.status(200).json({ success: true, … })`
（`sendCode` / `validateSession` / `register` 皆然），沒有 204 的前例。

**建議**：`POST /auth/logout` 成功回 **`200 { "success": true }`**（⛔ 不用 204——與 repo 內每一支端點不一致）。

---

### ⛔ 疑點 4（需核可數值）—— 速率限制器

`rateLimiters.ts` 目前只有 `loginLimiter`（15 分鐘 10 次）與 `sendCodeLimiter`（10 分鐘 3 次），
**無適用者**：登出是使用者主動且低頻的動作，套 `loginLimiter` 會讓「登出→重登→再登出」在 15 分鐘內撞牆。

**建議**：新增 `logoutLimiter` = **15 分鐘 30 次**，訊息沿 `loginLimiter` 的 `TooManyRequests` 形狀。
理由：撤銷端點的濫用面是「拿別人的 refresh token 洗表」，但寫入需通過 `jwt.verify`，
攻擊者已持有有效 token 時登出他自己並無收益；30 次足以吸收正常重試，又不至於變成無上限寫入口。

---

### ⛔ 疑點 5（實作要點，非選項）—— §C5 的 reload 不能用 `location.reload()`

Nymless 走 `createBrowserRouter`（`src/App.tsx:38`），Splash 掛在 `path: "/"`。
登出的兩處入口分別發生在 `/settings/general` 與任意主畫面路由。
`window.location.reload()` 會**留在原路由**——Vite dev server 與 Tauri asset protocol 對未知路徑都回 `index.html`，
於是 router 直接渲染設定頁，**完全繞過 Splash 的 `validateSession` 判定**，畫面停在一個沒有帳號的設定頁。

**做法**：`window.location.href = "/"`（整頁導向根路徑並重載）→ Splash → `validateSession()` 回 false → `/auth/login`。
此點寫進程式碼註解。

---

### ⛔ 疑點 6（文案定案）—— `copy-guide.md` 不在 repo（f32-3a 疑點 3 的重演）

本包新增約 10 條文案（兩語言共 ~20 條），任務包 §C6 要求「zh-TW 依 copy-guide §二、en 依 §三之二」，
但該檔在 vault，repo 內取不到（f32-3a 已記錄此事）。

**建議**：我依 f32-3a 已定案的 en 措辭與既有 `errors` ns 的形狀**擬稿**，兩語言全文逐條列於本文件 §5，
**⛔ 不自行定案**——請規劃側於 `f35-logout-plan-review.md` 逐條核可或改寫後我才寫入語言檔。
（本包不新增錯誤碼：`ERROR_NR` 已對 `ErrorCode` 全窮舉，登出失敗走既有錯誤層即可，⛔ 不動 `docs/i18n/nr-codes.md`。）

---

## 2. 範圍 A —— namelessrealms-api

### 2.1 變更檔案

| 檔案 | 動作 |
|---|---|
| `src/database/revoked_refresh_tokens.sql` | 新增（依疑點 1 裁決） |
| `src/api/services/auth/auth.service.ts` | 新增 `revokeRefreshToken`；`refreshAccessToken` 插入撤銷檢查 |
| `src/api/controllers/auth.controller.ts` | 新增 `logout` handler ＋ `@openapi` 註解 |
| `src/api/routes/auth.routes.ts` | 新增 `POST /auth/logout`（`logoutLimiter` ＋ `asyncHandler`，⛔ 不掛 `_authJwtVerify`） |
| `src/api/middlewares/rateLimiters.ts` | 新增 `logoutLimiter`（依疑點 4 裁決） |
| `tests/routes/auth.logout.test.ts` | 新增 |

### 2.2 `revokeRefreshToken(refreshToken: string)`

```
1. jwt.verify(refreshToken, config.jwt.refreshSecret)  → catch → AppError(…, 401, "Unauthorized")
2. tokenHash = sha256(refreshToken).hex().toLowerCase()
3. expiresAt = new Date(decoded.exp * 1000)            // exp 為秒級 Unix；表為 DATETIME
   ⤷ decoded.exp 缺漏（理論上不會，簽發一律帶 expiresIn）→ AppError 401，⛔ 不寫入無上界的列
4. INSERT INTO revoked_refresh_tokens (token_hash, expires_at) VALUES (?, ?)
   ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)     // 重複登出不報錯
5. DELETE FROM revoked_refresh_tokens WHERE expires_at < NOW() // 順手清理，⛔ 不加排程
```

### 2.3 `refreshAccessToken` 的撤銷檢查（fail-closed）

插入位置：`jwt.verify` 成功之後、`SELECT * FROM users` 之前。

```ts
let revoked: any[];
try {
  const r = await Mysql.getPool().query(
    "SELECT token_hash FROM revoked_refresh_tokens WHERE token_hash = ?", [tokenHash]);
  revoked = r[0] as any[];
} catch {
  // fail-closed：查不到撤銷表就無法確認此 token 未被撤銷，一律拒絕。
  // ⛔ 不得 fail-open——那會製造「DB 異常時撤銷失效」的安全洞。
  throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
}
if (revoked.length > 0) throw new AppError("Refresh Token 無效或已過期。", 401, "Unauthorized");
```

⚠️ `catch` 只包住查詢本身，⛔ 不得包住 `revoked.length > 0` 的判斷（否則命中時丟出的 401 會被自己吞掉再重丟，
雖然結果相同但語意混淆）。訊息刻意與既有的 `jwt.verify` 失敗一致——⛔ 不對外洩漏「這個 token 被撤銷過」。

### 2.4 測試（`tests/routes/auth.logout.test.ts`，走 P1 已驗證的 mock 形式）

| # | 案例 | 斷言 |
|---|---|---|
| 1 | `POST /auth/logout` 缺 `refresh_token` | 400 `InvalidRequest` |
| 2 | `POST /auth/logout` 帶亂碼 token | 401 `Unauthorized` |
| 3 | `POST /auth/logout` 帶合法 refresh token | 200 `{success:true}`；`INSERT … ON DUPLICATE KEY` 有被送出、`token_hash` 等於實算 sha256 |
| 4 | 同一 token 連打兩次登出 | 兩次皆 200（重複撤銷不報錯） |
| 5 | 登出後以同一 token 換發（撤銷表回 1 列） | 401 `Unauthorized` |
| 6 | 未撤銷 token 換發（撤銷表回 0 列） | 200，回新的 access/refresh token |
| 7 | 撤銷表查詢 reject（模擬表不存在） | 401 —— **fail-closed 的機器驗證**（⛔ 不放行） |
| 8 | 登出成功時有送出 `DELETE … WHERE expires_at < NOW()` | 過期列清理成立 |

案 7 即任務包負向驗收「撤銷表不存在時 refresh → 401」，**以 mock 讓查詢 reject 即可精確模擬**，
⛔ 不需真的去砍測試環境的表。

---

## 3. 範圍 B —— allay_core

### 3.1 `Profiles::clear_microsoft_tokens_for(&self, uuid: &str) -> crate::Result<()>`

落點：`src/store/profiles.rs`，緊接在 `set_microsoft_refresh_token_for` 之後（同一 UUID-scoped 區塊）。

```
1. 讀 marker `ms_at_{uuid}`
   ├─ Ok("CHUNKED") → 讀 `ms_at_{uuid}_cc` 取 count → for i in 0..count 刪 `ms_at_{uuid}_p{i}`
   ├─ Ok(其他)      → 無分塊，跳過
   └─ Err(NoEntry)  → 無此帳號的 token，跳過（冪等）
2. 刪 `ms_at_{uuid}_cc`
3. 刪 marker `ms_at_{uuid}`
4. 刪 `ms_rt_{uuid}`
5. 每一步：Err(keyring::Error::NoEntry) 視為成功；其餘 keyring 錯誤照常 `?` 回傳
```

**順序契約（寫進 `///` 註解）**：⛔ `_cc` 必須**在分塊刪完之後**才刪——先刪 `_cc` 就再也不知道有幾塊，
殘渣永久留在系統 keyring。這正是既有 `set_microsoft_access_token_for(uuid, "")` 的缺陷
（`profiles.rs:188-189` 先刪 marker 再刪 `_cc`，**從不刪 `_p{i}`**）。

⛔ **不改既有 setter**（任務包明令；且其他呼叫點依賴現行行為）。
⛔ 不改 `get_microsoft_access_token_for` / `remove_player`。

### 3.2 `NoEntry` 的判別（P2 已驗證）

```rust
/// keyring 的「查無此項」視為已清除（冪等）；其餘錯誤照常回傳。
fn ignore_missing(r: Result<(), keyring::Error>) -> Result<(), keyring::Error> {
    match r { Err(keyring::Error::NoEntry) => Ok(()), other => other }
}
```

⛔ 不用 `let _ = entry.delete_password();`（既有 setter 的寫法）——那會把「真的清除失敗」也靜默吞掉，
正是任務包 §實作要點警告的情形。

### 3.3 測試

`cargo test` 目前 55 passed / **2 ignored**，`sync.rs` 已有 `#[ignore = "走真實網路…"]` 的前例。
分塊清除**必須有真實系統 keyring 才能驗**（CI 無 keychain），故：

- 新增 `#[test] #[ignore = "需真實系統 keyring；單獨以 --ignored 執行"]`：
  寫入 2500 bytes 的假 token（→ 3 塊）→ `clear_microsoft_tokens_for` → 逐一斷言
  `ms_at_{u}` / `_cc` / `_p0..2` / `ms_rt_{u}` 皆為 `NoEntry`；再呼叫一次驗冪等。
  測試用 uuid 帶固定前綴避免污染真實項目，結尾不論成敗都清乾淨。
- 本機以 `cargo test -- --ignored` **實跑並貼輸出**（macOS 有 keychain），CI 仍走預設不跑此條。
- 這同時是守界聲明第 2 題（keyring 實查）的證據。

⚠️ 若該測試在本機真的無法建立 keyring 項目（keychain 權限被擋），我會**停手回報**，⛔ 不用推理充當實查。

---

## 4. 範圍 C —— Nymless

### 4.1 `src-tauri`

| 檔案 | 動作 |
|---|---|
| `nymless_api/auth.rs` | 新增 `pub async fn logout(clear_minecraft_accounts: bool) -> Result<(), Error>` ＋ `LogoutRequest` 的 wire contract 測試 |
| `nymless_api/mod.rs` | `pub use auth::{…, logout, …}`（⛔ 逐項列名，不用 glob） |
| `commands.rs` | 薄轉發 `logout` ＋ 檔頭 `# Methods` 補一行 |
| `lib.rs` | `invoke_handler` 加 `commands::logout` |

**`logout` 的順序（嚴格照任務包 §C1，寫進註解）**：

```
1. 取 refresh token（清除前先拿；讀鎖，取完即釋放）
2. POST {BASE}/auth/logout {"refresh_token": …}  ← best-effort
   ⛔ 無論成功 / 失敗 / 逾時 / 離線，一律繼續往下清本機。失敗只 tracing::warn!，
      ⛔ 不得 return Err 中斷登出——離線也要能登出。
   refresh token 為空 → 直接跳過這一步（沒東西可撤銷）
3~5. { write guard 區塊：
        set_nymless_access_token("") / set_nymless_refresh_token("")
        user.username = "" / user.id = "" / nymless_auth.expires_at = 0
        clear_minecraft_accounts == true → 對 players 每個 uuid 呼叫 clear_microsoft_tokens_for，
                                            然後 players.clear() / active_player_uuid = ""
     }  ← 離開區塊釋放 write guard
6. profiles.sync(&app_path::get_profile_json_file_path()).await
7. Ok(())
```

⚠️ **鎖範圍沿 `settings::set_language` 的前例**（`allay_core/src/api/settings.rs:109`：寫入包在獨立區塊、
離開後才 sync）。⛔ 不巢狀持鎖。
⚠️ 步驟 2 的 HTTP 請求**在取鎖之前**完成——⛔ 不得在持有 write guard 時 await 網路。

⚠️ **不使用 `ensure_valid_access_token()`**：登出不需要 access token，而該函式在過期時會嘗試刷新，
刷新失敗直接回 `Unauthorized`——那正好會擋住「token 已過期所以要登出」這個最需要登出的情境。

### 4.2 前端

| 檔案 | 動作 |
|---|---|
| `src/services/auth.ts` | `export async function logout(clearMinecraftAccounts: boolean): Promise<void>`（走 `safeInvoke`） |
| `src/hooks/useLogout.ts` | **新增**——兩處入口共用的處理函式（見下） |
| `src/components/common/ConfirmModal.tsx` | 新增 3 個 **optional** prop 支援勾選框 |
| `src/pages/settings/SettingsGeneral.tsx` | 依疑點 2 裁決接入 |
| `src/components/layout/MainLayout.tsx` | `FriendsPanel` 左欄 Nymless 帳號區塊加登出項 |
| `src/i18n/locales/{zh-TW,en}/{common,settings}.json` | 新增文案（§5） |

**共用處理函式（任務包 §C3「⛔ 不得各寫一份」）**：抽 `src/hooks/useLogout.ts`，回傳
`{ open, working, error, clearMc, setClearMc, requestLogout, confirmLogout, cancelLogout }`，
兩處入口各自渲染 `<ConfirmModal>` 但邏輯只有一份。

⚠️ **規約 D 檢核**：此 hook **無計時器、無 ref 時序、無 render body 直接賦值**——
只是 `useState` ＋ 兩個 async handler，不屬防護欄封死的類型（那條專指 `ServerSettingsFiles` 的編輯器狀態層）。
⚠️ **§H 地雷 A 檢核**：本 hook 內⛔ 不用 `useMemo` 包 `t(...)`；文案全部在各自元件 render 時取，
`tDeps.test.ts` 不會有新掃描面。

**`ConfirmModal` 的新 prop（⛔ 全部 optional，不傳時逐字維持現狀）**：

```ts
/** 勾選框標籤；不傳則不渲染勾選框（既有 2 處呼叫點行為不變） */
checkboxLabel?: string;
checked?: boolean;
onCheckedChange?: (v: boolean) => void;
```

渲染條件 `checkboxLabel != null`，位置在 `description` 與 `error` 之間；`working` 時 disabled。
既有 2 處呼叫點（`SettingsLibrary.tsx` / `ServerSettingsMods.tsx`）**一個字都不動**。

### 4.3 §C5 reload

`confirmLogout` 內：`await logout(clearMc)` → 成功後 `window.location.href = "/"`。
⚠️ `await` 保證 `sync` 已落盤才重載（任務包 §C5）。失敗則不重載，把訊息塞進 `ConfirmModal` 的 `error`
（走 `getErrorMessage`，⛔ 不 `alert()`——`fix-dialog-family` 是另一包）。

---

## 5. 新增文案擬稿（⛔ 待規劃側逐條核可，見疑點 6）

### `common.json`

| key | zh-TW | en |
|---|---|---|
| `actions.logout` | 登出 | Log out |

（`settings:general.signOut` = 「登出」已存在，但只服務 MOCK 的 MC 帳號列；
兩處入口共用的動作詞依 §H 收在 `common:actions.*`。⛔ 不動既有 key。）

### `settings.json` → `logout.*`

| key | zh-TW | en |
|---|---|---|
| `logout.title` | 登出 Nymless 帳號 | Log out of Nymless |
| `logout.description` | 登出後會回到登入頁，你已下載的遊戲檔案和模組都會保留，下次登入就能直接使用。 | You'll return to the login screen. Your downloaded game files and mods stay on this computer, ready for next time. |
| `logout.clearMinecraft` | 同時移除已連結的 Minecraft 帳號 | Also remove linked Minecraft accounts |
| `logout.clearMinecraftHint` | 移除後，下次要玩遊戲得重新用 Microsoft 登入一次。 | If you do, you'll need to sign in with Microsoft again before you can play. |
| `logout.confirm` | 登出 | Log out |
| `logout.working` | 登出中… | Logging out… |

擬稿原則（供審）：**不出現「憑證／token／撤銷／session」等術語**；說「會發生什麼」＋「你之後要做什麼」；
勾選提示只在勾選時顯示，避免預設狀態就嚇人。

---

## 6. 步驟計畫（步驟 → 驗證方式）

| # | 步驟 | 驗證 |
|---|---|---|
| 1 | 【A】SQL 檔 ＋ `logoutLimiter` ＋ `revokeRefreshToken` ＋ 路由/handler ＋ 撤銷檢查 | `yarn build` 綠 |
| 2 | 【A】8 條測試 | `yarn test` = 135 + 8 = **143 passed**；jscpd ≤ 3.7 |
| 3 | 【B】`clear_microsoft_tokens_for` ＋ `#[ignore]` keyring 測試 | `cargo test` 綠（55 passed / 3 ignored）；`cargo test -- --ignored` 實跑貼輸出；`cargo clippy` 無新警告；jscpd ≤ 3.0 |
| 4 | 【C】`nymless_api/auth.rs` `logout` ＋ mod/commands/lib 轉發 ＋ wire contract 測試 | `cargo test --lib`（35 → 36）；`cargo build` 確認拉到 B 的新碼 |
| 5 | 【C】`services/auth.ts` ＋ `useLogout` ＋ `ConfirmModal` 勾選 ＋ 兩處入口 | `yarn build` 綠 |
| 6 | 【C】語言檔兩語言（**待疑點 6 核可**） | `yarn test`（`locales.test.ts` 差集/複數/非空/en 無 CJK ＋ `noHardcodedCjk.test.ts` ＋ `tDeps.test.ts` 全綠）；jscpd ≤ 2.5 |
| 7 | 負向實跑三條 | 見 §7 |
| 8 | `yarn e2e:browser` | 14 條全綠 |
| 9 | 文件：三 repo `CLAUDE.md` ＋ `Nymless/docs/ECOSYSTEM.md` ＋ 驗收報告 ＋ 歸檔 f32-3a-* | 見 §8 |

---

## 7. 負向驗證做法（本機，實跑貼輸出）

| # | 情境 | 做法 |
|---|---|---|
| 1 | 已撤銷 token 換發 → 401 | vitest 案 5（mock 撤銷表回 1 列）＋ 真機 E2E 步驟 9 |
| 2 | 撤銷表不存在 → 401 而非放行 | vitest 案 7（mock 查詢 reject）——**精確模擬，不需砍表** |
| 3 | 後端不可達仍能清乾淨 | 本機起 Nymless、把 `NYMLESS_API_BASE_URL` 指向不存在的 port（或關掉 api）後登出 → 觀察 `tracing::warn!` 有記錄失敗、`profile.json` 的 `user.username` / `players` 已清空、keyring 中 `nymless_accesstoken` 為 `NoEntry` |

---

## 8. 文件更新（任務包 §完成後 3）

- **`namelessrealms-api/CLAUDE.md`**：資料表清單加 `revoked_refresh_tokens`；地雷清單加一條
  「**撤銷檢查 fail-closed**：`revoked_refresh_tokens` 未建表即部署 → 所有 refresh 一律 401，**必須先建表再部署**」。
- **`allay_core/CLAUDE.md`**：`Profiles` 方法清單加 `clear_microsoft_tokens_for`，並記錄
  「⛔ 分塊 token 必須先刪 `_p{i}` 再刪 `_cc`」的順序契約。
- **`Nymless/CLAUDE.md`**：`commands.rs` 說明加 `logout`；目錄結構 `hooks/` 一行加 `useLogout`。
- **`Nymless/docs/ECOSYSTEM.md` §三「認證雙軌」**：**需補**——該節目前只描述「誰用什麼機制進來」，
  沒有描述 token 的**退場**。本包新增了一條跨 repo 流程（Nymless 打 `POST /auth/logout` → api 寫撤銷表 →
  下次 refresh 被擋），且帶一條**部署順序耦合**（先建表再部署）。
  建議在 §三 表格下方補一小段「**登出與撤銷（F35）**」：撤銷以 token 雜湊為鍵、per-device、
  ⛔ 不是「登出所有裝置」；前端 best-effort，後端不可達不阻擋本機登出。
- 順手把 `Nymless/docs/tasks/f32-3a-*.md`（4 支）移入 `archive/`。

---

## 9. 守界聲明（本包⛔不碰清單）

- ⛔ 不清本機模組 / 遊戲檔案 / instances。
- ⛔ 不做「登出所有裝置」、不做 session 列表 / 裝置管理。
- ⛔ 不動 `players` 以外的 Store 欄位、不動 `Settings`、不碰語言設定。
- ⛔ 不重構 `MainLayout` 的好友區段（mock，規約 E）。
- ⛔ 不改 `set_microsoft_access_token_for` / `set_microsoft_refresh_token_for` 既有行為。
- ⛔ 不改 JWT payload、不動 `verify` / `registerUser` 的簽發邏輯。
- ⛔ 不碰 `fix-dialog-family` 的三處 `alert()` 與三顆檔案對話框鈕（`SettingsGeneral` 內看得到也不動）。
- ⛔ 不動 `.jscpd.json`、`e2e/**`、`tDeps.test.ts`、`noHardcodedCjk.test.ts` 的規則。
- ⛔ 不動 `docs/i18n/nr-codes.md`（本包不新增錯誤碼）。
- ⛔ 不修改 vault 的 `copy-guide.md`。

---

## 10. 需要放行的六件事（回覆即可動工）

1. **疑點 1**：SQL 落 `src/database/revoked_refresh_tokens.sql`（甲）？
2. **疑點 2**：`SettingsGeneral` 走甲案（新增真實 Nymless 帳號列，MOCK 列不動）？
3. **疑點 3**：登出成功回 `200 {success:true}`（非 204）？
4. **疑點 4**：`logoutLimiter` = 15 分鐘 30 次？
5. **疑點 6**：§5 的 12 條文案擬稿逐條核可 / 改寫。
6. §3.3 的 `#[ignore]` keyring 測試形式是否認可為「keyring 實查」的證據。
