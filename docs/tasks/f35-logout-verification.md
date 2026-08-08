# 驗收報告：F35 登出功能（含後端 refresh token 撤銷）

> Claude Code 實作完成後自動產出。協作 Claude 依此審計。
> **不得用範本/預期值/設計推理冒充已執行。**

任務代號：`f35-logout`｜主要變更 repo：**namelessrealms-api**（跨三 repo）
對應文件：任務包 `docs/tasks/f35-logout.md`、計畫 `docs/tasks/f35-logout-plan.md`、審核 `docs/tasks/f35-logout-plan-review.md`
放行依據：plan-review §九（疑點 1 甲／2 甲／3、4 核可／6 核可但 en 改 `Sign out` 系列＋補第四個 prop／§3.3 核可＋前置斷言／§六 新增失敗處理規則）

---

## 一、變更檔案

### namelessrealms-api（主 repo）
**新增**
- `src/database/revoked_refresh_tokens.sql` — 撤銷清單表（`token_hash` CHAR(64) PK、`expires_at` DATETIME、`idx_expires_at`）。落點依疑點 1 甲改為 `src/database/`（任務包原指定的 `docs/sql/` 作廢）。
- `tests/routes/auth.logout.test.ts` — 8 條端點契約測試。

**修改**
- `src/api/middlewares/rateLimiters.ts` — 新增 `logoutLimiter`（15 分鐘 30 次）。
- `src/api/services/auth/auth.service.ts` — 新增 `revokeRefreshToken`（public）、`assertNotRevoked`（private, fail-closed）、`hashRefreshToken`（private static）；`refreshAccessToken` 於 `jwt.verify` 後、查 `users` 前插入撤銷檢查。
- `src/api/controllers/auth.controller.ts` — 新增 `logout` handler ＋ `@openapi` 註解。
- `src/api/routes/auth.routes.ts` — 新增 `POST /auth/logout`（`logoutLimiter` ＋ `asyncHandler`，⛔ 未掛 `_authJwtVerify`）。
- `CLAUDE.md` — 資料表清單＋地雷兩條（fail-closed 部署順序、logout 不掛守門）。

### allay_core
- `src/store/profiles.rs` — 新增 module-level `delete_ignoring_missing`、`Profiles::clear_microsoft_tokens_for`、`keyring_tests`（`#[ignore]`）。
- `CLAUDE.md` — Token 儲存段補分塊 key 形狀；地雷清單加兩條（清除順序、keyring 測試需真實金鑰串）。

### Nymless
- `src-tauri/src/nymless_api/auth.rs` — 新增 `LogoutRequest`、`logout(clear_minecraft_accounts)`、`revoke_refresh_token_best_effort`、`logout_request_keys` 契約測試。
- `src-tauri/src/nymless_api/mod.rs` — `pub use auth::{… logout …}`（逐項列名）。
- `src-tauri/src/commands.rs` — `logout` 薄轉發。
- `src-tauri/src/lib.rs` — `invoke_handler` 註冊 `commands::logout`。
- `src/services/auth.ts` — `logout(clearMinecraftAccounts)` 走 `safeInvoke`。
- `src/hooks/useLogout.ts`（新增）— 登出流程狀態機，兩處入口共用。
- `src/components/common/LogoutConfirmModal.tsx`（新增）— 把 `useLogout` 接到 `ConfirmModal`，兩處入口共用同一份 props。
- `src/components/common/ConfirmModal.tsx` — 新增四個 optional prop（`checkboxLabel` / `checked` / `onCheckedChange` / `checkboxHint`）。
- `src/pages/settings/SettingsGeneral.tsx` — 帳號區段最上方新增**真實的 Nymless 帳號列**＋登出鈕。
- `src/components/layout/MainLayout.tsx` — `FriendsPanel` 左欄 Nymless 帳號 pill 加登出鈕。
- `src/i18n/locales/{zh-TW,en}/{common,settings}.json` — 新增 12 條（兩語言各 6 + 1）。
- `CLAUDE.md`（hooks / commands.rs / auth.rs 說明 ＋ 地雷兩條）、`docs/ECOSYSTEM.md`（§三 新增「登出與撤銷」小節）。
- `docs/tasks/f32-3a-*.md`（5 支）→ `docs/tasks/archive/`。

---

## 二、設計重點

1. **fail-closed 的 `catch` 邊界**：`assertNotRevoked` 的 `try` 只包住 `SELECT`，`revoked.length > 0` 的判斷刻意留在 `try` 之外——包進去會讓命中時丟的 401 被自己的 `catch` 吞掉再重丟。
2. **撤銷命中的訊息與 `jwt.verify` 失敗一致**（皆為「Refresh Token 無效或已過期。」），⛔ 不對外洩漏「這個 token 曾被撤銷過」。
3. **`decoded.exp` 缺漏 → 401，不寫入**：無 `exp` 的列沒有清理上界，會讓撤銷表無上限成長。
4. **`logout` ⛔ 不走 `ensure_valid_access_token()`**：該函式在 token 過期時嘗試刷新、失敗回 `Unauthorized`，正好會擋住「token 已過期所以要登出」這個最需要登出的情境。
5. **best-effort 是型別層保證**：`revoke_refresh_token_best_effort` 回傳 `()`（非 `Result`），**編譯器層面就不可能把後端錯誤傳播到 `logout` 的 `Result`**。另設 5 秒逾時（本檔其餘請求沿 reqwest 預設），避免連不上的後端把使用者卡在「登出中…」。
6. **鎖範圍**：HTTP 在取寫鎖之前完成；寫入包在獨立區塊，離開後才 `sync`（沿 `settings::set_language` 前例，⛔ 不巢狀持鎖）。
7. **MC 帳號逐一清除的失敗處理（plan-review §六）**：單一 uuid 失敗只 `tracing::warn!`（含 uuid 與錯誤）並繼續清其餘，全部處理完照常 `players.clear()` / `sync` / 回 `Ok(())`。**取捨已知且刻意**：勾了移除仍可能留下該帳號的 keyring 殘留，代價由 log 承接；⛔ 不因單一 keyring 項目清不掉就讓使用者登不出去。
8. **分塊清除順序契約**：`clear_microsoft_tokens_for` 先刪 `_p{i}` 再刪 `_cc`——`_cc` 是唯一記錄塊數的地方，順序反了殘渣永久留存。既有 setter 正是踩了這個坑，⛔ 依裁決不改其行為。
9. **`delete_ignoring_missing` ⛔ 不用 `let _ = delete_password()`**：只對 `keyring::Error::NoEntry` 視為成功，其餘錯誤照常回傳——避免把真正的清除失敗靜默吞掉。
10. **`location.href = "/"` 而非 `location.reload()`**：app 走 `createBrowserRouter`，reload 會停在原路由（SPA fallback 回 `index.html`），完全繞過 Splash 的 `validateSession`。
11. **兩處入口共用**：處理函式共用 `useLogout`，彈窗 props 共用 `LogoutConfirmModal`——⛔ 沒有任何一份被複製兩次。
12. **`ConfirmModal` 四個新 prop 全為 optional**，渲染條件 `checkboxLabel != null`；`checkboxHint` 再加條件 `&& checked`。既有 2 處呼叫點（`SettingsLibrary.tsx` / `ServerSettingsMods.tsx`）**一個字未動**。

---

## 三、測試結果

### 3.1 單元／契約測試（實際輸出）

**namelessrealms-api** — 基線 135 → **143 passed**（+8）
```
 Test Files  19 passed (19)
      Tests  143 passed (143)
```
新增 8 條（`tests/routes/auth.logout.test.ts`）：
| # | 名稱 |
|---|---|
| 1 | 缺少 refresh_token 時回傳 400 InvalidRequest |
| 2 | refresh_token 無效時回傳 401 Unauthorized |
| 3 | 合法 refresh_token 以 SHA-256 為鍵寫入撤銷清單並回 200 |
| 4 | 重複登出同一 token 不報錯（兩次皆 200） |
| 5 | 登出時順手清掉已過期的撤銷列 |
| 6 | 未被撤銷的 token 可正常換發 |
| 7 | 已撤銷的 token 換發時回 401，且不查 users |
| 8 | 撤銷表查詢失敗（如表不存在）時 fail-closed 回 401，⛔ 不放行 |

**allay_core** — 基線 55 passed / 2 ignored → **55 passed / 3 ignored**
```
test result: ok. 55 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out
```
`#[ignore]` 的 keyring 測試以真實 macOS 金鑰串**單獨實跑**（含 plan-review §七 要求的前置斷言：先證明 marker=`CHUNKED`、`_cc`=3、`_p0..2` 皆存在，再清除、再斷言全 `NoEntry`、再驗冪等）：
```
$ cargo test --lib -- --ignored keyring_tests
running 1 test
test store::profiles::keyring_tests::clear_microsoft_tokens_for_removes_every_chunk ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 57 filtered out; finished in 0.27s
```

**Nymless**
```
$ yarn test        → Test Files  9 passed (9) / Tests  178 passed (178)
$ cargo test --lib → test result: ok. 36 passed; 0 failed  （基線 35，+1 logout_request_keys）
```
`yarn test` 含 i18n 三道守門全綠：`locales.test.ts`（33）、`tDeps.test.ts`（2）、`noHardcodedCjk.test.ts`（6）。

**e2e**
```
$ yarn e2e:browser
[chrome] 14 passing (14.6s)
[chrome] 1 skipped
Spec Files: 1 passed, 1 total (100% completed) in 00:00:21
```
14 條全綠，與基線一致——`ConfirmModal` 的四個新 prop 未影響既有彈窗。

### 3.2 正向流程（真實 dev DB ＋ 真實 api 進程，實跑輸出）

本機 MySQL（`namelessrealms` dev DB）建表後啟動 `yarn dev`，以 dev 的 `JWT_REFRESH_SECRET` 簽一個
**`sub` 指向不存在使用者**的 refresh token（故即使漏過撤銷檢查也只會走到「用戶不存在。」，
不觸及任何真實帳號——兩種 401 的 `message` 不同，足以分辨「擋在撤銷檢查」還是「漏過去了」）。

```
token sha256 = 2af4fdb07c86ba7232901d5f616f3418462f56d0276b10d01aaf57252d69c1fa

[1] 撤銷前換發
{"status":401,"body":{"success":false,"code":"Unauthorized","error":"用戶不存在。",...}}
    ↑ 走到了查 users，證明撤銷檢查此時未攔截

[2] POST /auth/logout
{"status":200,"body":{"success":true}}

[3] 重複登出同一 token
{"status":200,"body":{"success":true}}          ← ON DUPLICATE KEY，不報錯

[4] 撤銷後換發
{"status":401,"body":{"success":false,"code":"Unauthorized","error":"Refresh Token 無效或已過期。",...}}
    ↑ 訊息由「用戶不存在。」變為通用訊息 ＝ 撤銷生效且擋在查 users 之前
```

DB 實查（同一次執行後）：
```json
[ { "token_hash": "2af4fdb07c86ba7232901d5f616f3418462f56d0276b10d01aaf57252d69c1fa",
    "expires_at": "2026-08-14T04:28:46.000Z" } ]
```
只有 1 列（兩次登出未產生重複列），`expires_at` = 簽發時 +7d，證明 `exp × 1000` 的換算正確。
驗證後已刪除該測試列（`affectedRows = 1`，表內剩餘列數 = 0）。

### 3.3 負向流程

**(a) 缺參 / 亂碼 token（真實 api 進程）**
```
[5] 缺 refresh_token → {"status":400,...,"code":"InvalidRequest","error":"通訊協定錯誤，遺漏必要的參數。"}
[6] 亂碼 token       → {"status":401,...,"code":"Unauthorized","error":"Refresh Token 無效或已過期。"}
```

**(b) 撤銷表不存在 → fail-closed 回 401（真實 DB，表真的不在）**
以 `RENAME TABLE` 把撤銷表暫時移走（`finally` 保證還原），再打 refresh：
```
撤銷表已暫時改名（模擬「表不存在」）
refresh 結果：{"status":401,"body":{"success":false,"code":"Unauthorized","error":"Refresh Token 無效或已過期。",...}}
✅ fail-closed 成立：擋在撤銷檢查，未放行到查 users
撤銷表已還原：[{"Tables_in_namelessrealms (revoked_refresh_tokens)":"revoked_refresh_tokens"}]
```
判準說明：若是 fail-open，這個 token 會被放行到 `SELECT * FROM users` 並回「用戶不存在。」；
實際回的是通用訊息，證明**擋在撤銷檢查那一層**。api 側 log 同時有
`ERROR: Refresh token revocation check failed: Error: ER_NO_SUCH_TABLE …`。

**(c) 後端不可達時本機仍完成清除 —— ✅ 已由真機步驟 8 補齊行為層證據**

本機**無法**自動化驗證此條（理由：`logout` 的本機清除走 `allay_core::Store`，而 `Store::get()` 會惰性
初始化到**開發機真實的 `profile.json` 與系統 keyring**，寫測試去跑會破壞這台機器上的真實登入狀態；
以 UI 觸發又需先登入，在「api 關掉」的前提下形成循環）。故本包分兩層驗證：

**① 型別層（本機，編譯期）**：`revoke_refresh_token_best_effort` 的回傳型別是 `()` 而非 `Result`，
呼叫端無 `?`——**編譯器層面就不存在讓後端錯誤中斷 `logout` 的路徑**；三種失敗（連線失敗／非 2xx／逾時）
在 `nymless_api/auth.rs` 的 `match` 三個分支中各自只 `tracing::warn!`。

**② 行為層（真機步驟 8，已執行）**：見 §十一「步驟 8」的終端機 warn 全文與判定。
`Connection refused (os error 61)` 後仍完成本機清除並回到登入頁，且失敗有進 log 未靜默。
⛔ 本條不再是「待人工」。

---

## 四、審計確認

- 撤銷失敗（表不存在／DB 異常）走 `logger.error`，訊息不含 token 原值或雜湊。
- 後端撤銷失敗走 `tracing::warn!`，只記 HTTP 狀態碼或連線錯誤，**不記 refresh token**。
- MC keyring 清除失敗走 `tracing::warn!`，記 uuid 與錯誤，**不記 token 內容**。
- 撤銷表只存 SHA-256 雜湊，**不存 token 原文**。
- 對外錯誤一律 `AppError` 結構化；撤銷命中不對外揭露「曾被撤銷」。

---

## 五、產物重建

- [x] namelessrealms-api：`yarn build` → 綠（`Done in 2.60s.`）
- [x] allay_core：`cargo test` 綠；`cargo clippy --all-targets` **警告數 136 → 136（無新增）**；
      `src/store/profiles.rs` 上的 3 筆 clippy 警告（`:105` `Default` impl、`:120` needless_borrow、`:202` `div_ceil`）
      **全部位於既有程式碼行，非本次新增**（以 `git stash` 對照基線實測）。
- [x] Nymless：`yarn build` → 綠（`✓ built in 1.89s`）
- [x] **allay_core 變更 → Nymless 側 `cargo build` 已確認拉到新碼**：
      `allay_core` 為 path 依賴（`Cargo.toml:26`），輸出含
      `Compiling nymless v0.1.0 … Finished dev profile in 7.99s`，其上先重編了 `allay_core (lib)`。
- 未跑 `yarn tauri build`（本包無需真機安裝檔；真機 E2E 由 Yu 執行時再建）。

### 重複率（jscpd@5.0.14，版本 pin）

| Repo | 門檻 | 變更前 | 變更後 | 判定 |
|---|---|---|---|---|
| namelessrealms-api | 3.7 | 3.33% | **3.27%** | ✅ 下降 |
| allay_core | 3.0 | 2.65% | **2.62%** | ✅ 下降 |
| Nymless | 2.5 | 2.13% | **2.10%** | ✅ 下降（clones 30、duplicated lines 311，**與基線同數**，無新增重複） |

⛔ 三個 repo 的 `.jscpd.json` 皆未改動。

---

## 六、git 對帳

✅ **已 commit / push（2026-08-08，Yu 確認後執行）**。三 repo 皆 `本地 = 遠端`、工作區乾淨。

```
=== namelessrealms-api （branch: developers）===
git log --oneline -1   → 8849118 feat(f35): POST /auth/logout 撤銷 refresh token + refresh 撤銷檢查（fail-closed）
git rev-parse HEAD     → 884911814b79bd3925fb298012cac713c744778b
git rev-parse @{u}     → 884911814b79bd3925fb298012cac713c744778b   （本地 = 遠端 ✅）
git status --porcelain → （空，clean ✅）

=== allay_core （branch: main）===
git log --oneline -1   → e8b1fbe feat(f35): Profiles 新增 clear_microsoft_tokens_for（含分塊 token）
git rev-parse HEAD     → e8b1fbee7c45ba93f4821b759579a7be3bcfe967
git rev-parse @{u}     → e8b1fbee7c45ba93f4821b759579a7be3bcfe967   （本地 = 遠端 ✅）
git status --porcelain → （空，clean ✅）

=== Nymless （branch: main）===
git log --oneline -1   → e50e987 feat(f35): 登出功能（兩處入口、可選移除 MC 帳號、後端撤銷 best-effort）
git rev-parse HEAD     → e50e987dfada94372f19a9190060b55f9fbd6158
git rev-parse @{u}     → e50e987dfada94372f19a9190060b55f9fbd6158   （本地 = 遠端 ✅）
git status --porcelain → （空，clean ✅）
```

push 順序（沿 ECOSYSTEM §五）**已照此執行**：allay_core 先推並**等 CI 綠**後才推 Nymless；api 獨立（`developers`）。

⚠️ 上表為三個 **F35 實作 commit** 推送完成當下的狀態。**本報告的真機結果與 Actions 連結是事後回填**，
故 api repo 另有一支 `docs:` 後續 commit 只含本檔——實作內容與上表逐字相同，未再變動任何原始碼。

---

## 七、CI

- 本地逐字指令與結果：
  - `yarn test`（api）→ green，143 passed
  - `yarn build`（api）→ green
  - `cargo test`（allay_core）→ green，55 passed / 3 ignored
  - `cargo test --lib -- --ignored keyring_tests`（allay_core）→ green，1 passed
  - `cargo clippy --all-targets`（allay_core）→ 136 warnings（與基線同數，無新增）
  - `yarn test` / `yarn build` / `cargo test --lib` / `cargo build`（Nymless）→ 全 green
  - `yarn e2e:browser`（Nymless）→ 14 passing
  - `npx jscpd@5.0.14`（三 repo）→ 全數低於門檻且較基線下降

### Remote GitHub Actions（三 repo 全綠 ✅）

| Repo | 分支 | Commit | 結論 | Run |
|---|---|---|---|---|
| allay_core | `main` | `e8b1fbe` | **success** | https://github.com/NamelessRealms/allay_core/actions/runs/31243869471 |
| namelessrealms-api | `developers` | `8849118` | **success** | https://github.com/NamelessRealms/namelessrealms-api/actions/runs/31243937211 |
| Nymless | `main` | `e50e987` | **success** | https://github.com/yucheng918/Nymless/actions/runs/31244006905 |

- 狀態措辭：**local green ＋ remote Actions 三 repo 皆綠**。
- ⚠️ `push-docker-image.yaml` 只在 `master` 觸發，本次 api push 到 `developers`
  **未建置映像檔、程式尚未上線**——這正是 §八 所要求的安全狀態。

---

## 八、⚠️ 部署說明（必讀）

**`revoked_refresh_tokens` 表必須在「合併到 `master`」之前，建於正式環境。**

- SQL 檔：`namelessrealms-api/src/database/revoked_refresh_tokens.sql`
- 理由：撤銷檢查是 **fail-closed**——表不存在時 `refreshAccessToken` 一律回 401。
  若程式先上線而表還沒建，**線上所有已登入使用者會在 access token 過期後一起掉線**，直到表建好為止。
  順序顛倒不會造成資料損壞，但會造成全站可用性事故；這是本包唯一有此性質的操作。

**為什麼 push 到 `developers` 是安全的**：`push-docker-image.yaml` **只在 `master` 觸發**，
所以 push 到 `developers` 不會建置映像檔、不會有任何東西上線。**真正的分界線是合併到 `master` 那一刻**，
建表必須發生在那之前。

```
安全：  push → developers        （不建映像檔，程式不會上線）
        ↓
必做：  正式環境執行 revoked_refresh_tokens.sql
        ↓
之後：  merge → master           （push-docker-image.yaml 觸發，程式上線）
```

- 本機 dev DB 已建表並驗證（見 §3.2 / §11.3），**正式環境尚未執行**。

---

## 九、回歸守門

- api：既有 135 條測試全數未壞（含 `tests/routes/auth.routes.test.ts` 的 6 條 OAuth2/validate 契約）。
- allay_core：既有 55 條全綠；⛔ 未改 `set_microsoft_access_token_for` / `set_microsoft_refresh_token_for` / `remove_player` / `get_microsoft_access_token_for`。
- Nymless：178 條全綠（含 i18n 三道守門）；`yarn e2e:browser` 14 條全綠。
- `ConfirmModal` 既有 2 處呼叫點（`SettingsLibrary.tsx`、`ServerSettingsMods.tsx`）**未修改一字**；四個新 prop 皆 optional 且不傳時不渲染任何新節點。
- jscpd 三 repo 全數**下降**。

---

## 十、守界聲明（任務包 §守界聲明逐項回答）

**1. 後端不可達時，本機清除是否仍完整執行？在哪一行保證的？**
是。保證在 `Nymless/src-tauri/src/nymless_api/auth.rs` 的 `async fn revoke_refresh_token_best_effort(refresh_token: &str)`
——**回傳型別是 `()` 而非 `Result`**，呼叫端 `logout` 內該行為 `revoke_refresh_token_best_effort(&refresh_token).await;`（無 `?`），
編譯器層面就不存在讓後端錯誤中斷後續清除的路徑。三種失敗（連線失敗 / 非 2xx / 5 秒逾時）在該函式的
`match` 三個分支中各自只 `tracing::warn!`。⚠️ 行為面的真機驗證待 E2E 步驟 8（見 §3.3(c)，已誠實標記未實跑）。

**2. `clear_microsoft_tokens_for` 對分塊 token 的清除是否完整？如何驗證（keyring 實查）？**
完整。以真實 macOS 系統金鑰串實跑 `cargo test --lib -- --ignored keyring_tests` 通過（§3.1）。
該測試依 plan-review §七 的要求**先做前置斷言**（寫入 2500 bytes → marker=`CHUNKED`、`_cc`=3、`_p0`/`_p1`/`_p2` 皆存在、
`get_microsoft_access_token_for` 讀回值等於原 token），**再**清除，**再**斷言 6 把鑰匙全為 `NoEntry`，**再**呼叫一次驗冪等。
沒有前置斷言的話，一個從未寫成功的測試也會通過。

**3. 是否改動既有 setter、JWT payload、或 `ConfirmModal` 既有呼叫點的行為？**
否、否、否。
- `set_microsoft_access_token_for` / `set_microsoft_refresh_token_for` 逐字未動（新增獨立方法）。
- JWT payload 與 `verify` / `registerUser` / `refreshAccessToken` 的簽發邏輯逐字未動；`refreshAccessToken` 只**插入**一行撤銷檢查。
- `ConfirmModal` 四個新 prop 全為 optional，渲染條件 `checkboxLabel != null`；既有 2 處呼叫點檔案未被修改，
  且 `yarn e2e:browser` 14 條全綠。

**4. 新增字串是否全部走 i18n key、兩語言齊備？`noHardcodedCjk.test.ts` 是否綠？**
是、是、綠。新增 12 條（`common:actions.logout` ＋ `settings:logout.{title,description,clearMinecraft,clearMinecraftHint,confirm,working}`，
兩語言各 6+1）。en 依 plan-review §五 定稿為 `Sign out` 系列（⛔ 不用 `Log out`，避免在 f32-3a 剛統一的用字上開分岔）。
`locales.test.ts`（33）、`noHardcodedCjk.test.ts`（6）、`tDeps.test.ts`（2）全綠；
⛔ 未新增任何 `WHITELIST` / `KNOWN_RESIDUE` 條目，⛔ 未修改三個守門檔的規則。

**5. 是否碰了 `fix-dialog-family` 的任何一項？**
否。`SettingsGeneral.tsx` 內看得到的項目一律未動。

### 其餘守界
- ⛔ 未清本機模組 / 遊戲檔案 / instances；⛔ 未做「登出所有裝置」；⛔ 未做 session 列表 / 裝置管理。
- ⛔ 未動 `players` 以外的 Store 欄位、未動 `Settings`、未碰語言設定。
- ⛔ 未重構 `MainLayout` 的好友區段（mock，規約 E）；只在 Nymless 帳號 pill（真實區段）加了一顆鈕。
- ⛔ 未動 `.jscpd.json`、`e2e/**`、`tDeps.test.ts`、`noHardcodedCjk.test.ts`。
- ⛔ 未新增 NR 錯誤碼、未動 `docs/i18n/nr-codes.md`（`ERROR_NR` 已對 `ErrorCode` 全窮舉，登出失敗走既有錯誤層）。
- ⛔ 未修改 vault 的 `copy-guide.md`。

### carryover（本包未解，登記給後續）
1. **`SettingsGeneral.tsx` MOCK 帳號列上的「登出」死鈕**（原 `:74`，因新增真實帳號列位移至 `:109`）——它承諾的是「移除這一個 Minecraft 帳號」，
   與平台登出無關，依 plan-review §三 保持原封不動。**正解是等帳號管理頁接上真實資料時一併做**，
   ⛔ 不是現在補一個 onClick。規劃側已登記。
2. **勾選移除 MC 帳號時的 keyring 殘留**——單一 uuid 清除失敗只 warn 並繼續（plan-review §六 定案），
   殘留的偵測與清理未做，代價目前由 log 承接。
3. **§3.3(c) 離線登出的本機自動化驗證**——受限於 `Store` 會綁開發機真實狀態，本包未做；
   行為層已由真機步驟 8 補齊（§11.2）。若日後要機器化，需要的是「Store 可注入測試路徑」這類基礎設施，屬獨立提案。
4. **真機驗出的四條既有缺陷**（⛔ 皆非 F35 造成，本包不修）——明細見 §11.4：
   (a) `parse_api_error` 錯誤碼映射不全 → **f32-4 必辦**；
   (b) **登入契約不符（`type="email"` vs `WHERE username = ?`）→ 登入頁對任何人皆不可用**，建議後端改
   `WHERE username = ? OR email = ?`；
   (c) 連結 MC 帳號後右上 pill stale；
   (d) 零 MC 帳號時 pill 空圓圈（該狀態由本包的移除選項首次變為可達，但成因不在本包）。
5. **`KEYTAR_SERVICE = "com.nnymless"` 的拼字**（§11.5）——⛔ 絕對不得修改，需遷移方案，屬獨立提案。

---

## 十一、真機 E2E（Yu 已執行，2026-08-08）

**結果：9 步中 8 步通過（1 / 2 / 3 / 5 / 6 / 7 / 8 / 9）。步驟 4 未通過，但缺陷不屬 F35 —— 判定見下。**

| # | 操作 | 結果 | 佐證 |
|---|---|---|---|
| 1 | 設定頁按登出（不勾選） | ✅ | 確認框正常、文案為當前語言；取消可返回 |
| 2 | 確認登出 | ✅ | 回到登入頁，無殘留上一個帳號的畫面或資料 |
| 3 | 重開 app | ✅ | 仍是未登入狀態 |
| 4 | 錯誤訊息 NR 代碼（三包積欠） | ⚠️ **未通過，缺陷屬 f32-4** | 見 §11.1 |
| 5 | 重新登入 → 檢查 MC 帳號 | ✅ | 未勾選時已連結的 MC 帳號仍在，不需重新用 Microsoft 登入 |
| 6 | 右上帳號選單的登出入口 | ✅ | 與設定頁行為一致（同一 `useLogout`） |
| 7 | 勾選「同時移除 MC 帳號」後登出 → 重新登入 | ✅ | MC 帳號清單為空，需重新連結 |
| 8 | 離線登出（關網路） | ✅ | 見 §11.2 —— **本包的核心紀律，證據最完整的一步** |
| 9 | 撤銷生效：登出後重開 app | ✅ | 不會用舊 refresh token 自動登入；DB 實查見 §11.3 |

**步驟 7 補記**：登出當下 Console 與終端機**皆無** `清除 Minecraft 帳號 … 失敗` 的 warn，
即 `clear_microsoft_tokens_for` 對所有 uuid **全數成功**。plan-review §六 定案的「單一 uuid 失敗只 warn 並繼續」
是防禦路徑，本次未被觸發（也因此 §十.carryover 2 的殘留取捨這次沒有實際代價）。

### 11.1 步驟 4 判定：**F35 部分成立，失敗屬 f32-4**

**F35 的貢獻已成立**：這條路徑是「三包積欠」的 carryover——`getErrorMessage` 的呼叫點全在登入／註冊／連結流，
沒有登出就進不去，f32-1 步驟 6、f32-2a、f32-3a 步驟 4 連續三包被此擋掉。
**本包讓它首次可驗**，且驗出 `codeSuffix`（`（代碼 NR-xxxx）` / `(code NR-xxxx)`）**中英皆正確輸出**。

**未通過的原因不在 F35，在 `parse_api_error` 的錯誤碼映射不全**：
`Nymless/src-tauri/src/nymless_api/http.rs` 的 `match api_error.code.as_deref()` 只認四個 code
（`Conflict` / `InvalidVerificationCode` / `Unauthorized` / `NetworkError`），
而後端登入失敗回的是 `InvalidCredentials`（`auth.service.ts` 的 `verify`），落入 `Some(_) => ErrorKind::APIInteractingError(message)`。
連帶三個問題：

| # | 症狀 | 成因 |
|---|---|---|
| 1 | 代碼錯：顯示 `NR-1003`，應為 `NR-2002` | `APIInteractingError` → `NR-1003`；`InvalidCredentials` → `NR-2002`（`src/i18n/errorCodes.ts`） |
| 2 | 訊息洩漏內部術語：`ErrorKind::APIInteractingError` 的 Display 前綴含「API」，且「交互」為中國用語 | `allay_core/src/error.rs` 的 `#[error(...)]` 字面 |
| 3 | 英文介面顯示中文後端原文 | `InvalidCredentials` 不在 `CURATED_ERROR_CODES` 內時走 `fallbackMessage`（後端中文原句）而非語言檔 |

⛔ **本包不修**——這是錯誤碼映射與後端文案代碼化的問題，屬 **f32-4** 的範圍。已登記於 §11.4(a)。

### 11.2 步驟 8：離線登出（本包核心紀律的行為層證據）

關閉網路後於設定頁登出，終端機 warn **全文**：

```
2026-08-08T06:11:30.123228Z  WARN nymless_lib::nymless_api::auth: 無法連線後端撤銷 refresh token（error sending request for url (http://localhost:8030/auth/logout): error trying to connect: tcp connect error: Connection refused (os error 61)），仍繼續清除本機憑證
```

這一行同時佐證三件事，缺一不可：

1. **`revoke_refresh_token_best_effort` 確實被呼叫了** —— warn 的存在證明流程走到了發送請求那一步，
   **不是**因為 refresh token 為空而跳過了整個步驟（若是跳過，這行不會出現）。即撤銷確實嘗試過，只是連不上。
2. **`Connection refused` 之後仍完成本機清除並回到登入頁** —— 與 §3.3(c)① 的型別層保證吻合：
   後端失敗無法中斷 `logout`。這正是「離線也要能登出」的紀律。
3. **失敗未靜默** —— 錯誤有進 log 且指名 URL 與 os error，符合 F27b-2c 立下的「gate 失敗必留 blocked-reason log」紀律。

⚠️ 依 §11.3 的 DB 實查，此次離線登出**未進撤銷表**（沒連上後端當然寫不進去）——這是預期行為，
不是缺陷：該裝置的本機憑證已清空，而那個 refresh token 會在 7 天後自然過期。

### 11.3 步驟 9：撤銷生效（DB 實查）

`revoked_refresh_tokens` 共 **5 列**：

- **雜湊各不相同** —— 每次登入換發的是不同的 refresh token，撤銷以 token 雜湊為鍵，
  故**每一列對應一次獨立的登出**。這正面證實了 **per-device 撤銷**成立：撤銷一台不影響其他裝置，
  ⛔ 不是「登出所有裝置」（Yu 5甲）。
- `expires_at` **皆為簽發 +7d（2026-08-15）** —— `decoded.exp * 1000` 的換算在真機上與本機驗證一致（§3.2）。
- 步驟 8 的離線登出**未在表內**，符合 §11.2 的預期。

### 11.4 真機驗出的既有缺陷（⛔ 皆非 F35 造成，本包不修，供規劃側登記）

**(a) 錯誤代碼映射不全 → f32-4 必辦**
即 §11.1 的三個症狀。落點：`Nymless/src-tauri/src/nymless_api/http.rs` 的 `parse_api_error`
（`Some(_)` 這條萬用分支），以及 `allay_core/src/error.rs` 的 `APIInteractingError` Display 字面。
⚠️ 這條是 f32-4 的**必辦項**，不是選辦——它讓「錯誤訊息代碼化」這件事在最常見的登入失敗路徑上直接失效。

**(b) 登入契約不符 —— 登入頁對任何人皆不可用（嚴重）**
前端登入欄位為 `type="email"`（瀏覽器原生驗證會擋下非 email 的輸入），
後端 `AuthService.verify` 卻只查 `SELECT * FROM users WHERE username = ?`——**兩者對不上**。
使用者輸入 email 過得了前端驗證但後端查不到人；輸入 username 則過不了前端驗證。

⚠️ **為何一直沒被發現**：註冊流程（`registerUser`）**直接回傳 token，從不經過 `/oauth2/token`**，
所以新帳號註冊完就是登入狀態，登入頁在既有測試與日常使用中都沒有被真正走過。
**這也是本包（登出）第一次讓「重新登入」成為必經路徑，才把它逼了出來。**

建議修法（Yu 已判）：**後端**改為 `WHERE username = ? OR email = ?`（與 `registerUser` 的查重邏輯一致），
**前端不動**。⛔ 本包不修——它動的是 `verify` 的查詢，屬本包守界聲明明文排除的範圍
（「⛔ 不改 JWT payload、不動 `verify` / `registerUser` 的簽發邏輯」）。

**(c) 連結 MC 帳號後右上帳號 pill 不更新（stale state）**
連結成功後右上角 pill 仍是舊值，需重開 app 才正常——未訂閱 `players` 變更。
與 F35 無關（登出流程不經過該路徑）。

**(d) 零 MC 帳號時右上 pill 無內容可顯示（空圓圈）**
⚠️ **此狀態由 F35 的「同時移除 Minecraft 帳號」選項首次變為可達**——在此之前使用者沒有辦法把 MC 帳號清成零。
但**成因不是 F35**：pill 本來就只認 MC 帳號、沒有零帳號的 fallback。
期望行為：顯示 **Nymless 帳號**的頭像與名稱。⛔ 本包不修（那是帳號 pill 的顯示邏輯，非登出流程）。

### 11.5 順帶記錄：`KEYTAR_SERVICE` 的拼字

`allay_core/src/config.rs` 的 `KEYTAR_SERVICE = "com.nnymless"`（兩個 n，正常應為 `com.nymless`），疑為手誤。

⛔ **絕對不得修改。** 這個字串是所有 keyring 項目的 service 名：改掉之後**所有既有使用者的 keyring 項目
全部讀不到**，等同強制全員重新登入、且舊項目變成永遠清不掉的孤兒。
本包的 `clear_microsoft_tokens_for` 亦沿用此常數，⛔ 不得「順手修正」。
若日後真要更名，必須先做一次遷移（讀舊 service → 寫新 service → 刪舊），屬獨立提案。
