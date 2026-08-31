# 實作計畫:fix-login-contract 登入/註冊契約缺陷修復

> 對應任務包:`docs/tasks/fix-login-contract.md`(同目錄)。
> 產出者:實作側(Claude Code)。日期:2026-08-31。
> ⛔ **本檔為 plan,尚未實作**。等 `docs/tasks/fix-login-contract-plan-review.md` 放行才動碼。
> ⛔ 本檔自我完備:不引用任何知識庫 / vault 路徑。

---

## 0. 守界聲明(先講清楚不做什麼)

依任務包「裁決結果」(Yu 2026-08-31,**D1=甲**、**D2=甲**),本 plan 已收斂:

- **D1=甲**:後端 `verify()` 改兩段式查找(Email 精確比對優先,查無再比使用者名稱)。
  ⛔ **不**新增「使用者名稱不得含 `@`」的註冊驗證(丙案那一半未獲批)。
  ⛔ **不動** Nymless 登入頁(`src/pages/auth/Login.tsx` 維持 `type="email"`)。
- **D2=甲**:`expires_in` 維持**絕對 epoch 毫秒**語意,兩端加註解 + 測試鎖住。
  ⛔ 不做 OAuth2 正規化,⛔ 不動 `scope` 欄位格式(維持陣列)。
- ⛔ 不動 `f32-4` NR 錯誤代碼制、⛔ 不動 `accessControl`、⛔ 不動 `loginLimiter`、
  ⛔ 不動 F35 logout / 撤銷 / fail-closed、⛔ 不動 Splash / `validate_session` 自癒流程、
  ⛔ 不 backfill 既有使用者資料、⛔ 不動密碼 Lazy Migration 本體。
- ⛔ commit / push 一律回報 Yu 後再做。本 plan 與任務包的任何措辭均不構成 push 預授權。
- git 對帳基準:**`origin/developers`**(⛔ 不是 main / master)。

---

## 1. 現況複驗(本人親自量測的錨點)

> ⚠️ 依「署名即重量」紀律:下列行號與數值**全部由本人以 `grep -n` / `sed -n` 於 2026-08-31 當日實測**,
> ⛔ 不是自任務包轉抄。任務包所列錨點經逐條比對後**一致**(見 §15)。

### 1.1 namelessrealms-api

| 事實 | 位置(本人實測) |
|------|------------------|
| `verify()` 只查 username | `src/api/services/auth/auth.service.ts:53` — `"SELECT * FROM users WHERE username = ?"` |
| `verify()` payload 的 role | `auth.service.ts:121` — `role: user.roles` |
| `verify()` 回傳的 role | `auth.service.ts:138` — `role: user.roles as unknown as string[]` |
| 註冊角色來源 | `auth.service.ts:215` — `const roles = JSON.stringify(["user"]); // 預設權限` |
| 註冊 payload 的 role | `auth.service.ts:232` — `role: roles`(字串,非陣列) |
| 註冊 access token 硬寫效期 | `auth.service.ts:238` — `expiresIn: "15m",` |
| 註冊查重 SQL | `auth.service.ts:198` — `"SELECT * FROM users WHERE username = ? OR email = ?"` |
| `refreshAccessToken()` payload role | `auth.service.ts:296` — `role: user.roles,` |
| `refreshAccessToken()` 回傳 role | `auth.service.ts:313` — `role: user.roles as unknown as string[],` |
| `login()` refresh 分支 `expires_in` | `src/api/controllers/auth.controller.ts:112` |
| `login()` password 分支 `expires_in` | `auth.controller.ts:127` |
| `register()` 回應起點 | `auth.controller.ts:354` — `access_token: verifyData.accessToken,` |
| `increaseTime` 值 | `src/environment/environment.common.ts` — `increaseTime: 600000`(= 600 秒 = 10 分鐘) |
| `users.roles` schema 宣告 | `src/database/users.sql` 第 7 行 — `` `roles` JSON DEFAULT NULL `` |
| `users` UNIQUE 鍵 | `users.sql` — `unique` / `username` / `email` 各自 UNIQUE(⚠️ 跨欄位不互斥) |
| jscpd 門檻 | `.jscpd.json` — `"threshold": 3.7` |
| CI 步驟 | `.github/workflows/ci.yml` — `Verify generated version.ts` / `Duplication check (jscpd)`(`npx jscpd@5.0.14 --reporters console`)/ `Test`(`yarn test`)/ `Build`(`yarn build`) |

⚠️ 額外實測發現(任務包未列):`src/interface/auth/IUser.ts` **沒有 `email` 欄位**,
但 `users.sql` 有。兩段式查找用 `SELECT *` 不會因此編譯失敗,但介面與 schema 已漂移 → 見 §14。

### 1.2 Nymless(Rust 側)

| 事實 | 位置(本人實測) |
|------|------------------|
| `LoginResponseInfo` struct | `src-tauri/src/nymless_api/auth.rs:43` |
| `LoginResponse` struct | `auth.rs:48`(`refresh_token` / `expires_in` 皆 `#[serde(default)] Option<…>`) |
| `RegisterResponse` struct | `auth.rs:58`(只有 `access_token` / `refresh_token`) |
| `register()` | `auth.rs:112`(⚠️ **無 `///` doc 註解**) |
| `register()` 只存兩個 token | `auth.rs:135` — `let user_register: RegisterResponse = resp.json().await?;` 之後只呼叫 `set_nymless_access_token` / `set_nymless_refresh_token` / `sync` |
| `login()` | `auth.rs:157` |
| `persist_login_session()` | `auth.rs:191`(設 `user.username`、`nymless_auth.expires_at`、兩個 token) |
| `is_token_expired()` | `auth.rs:380`(`expires_at == 0` → 視為未過期) |
| `RegisterResponse` 全 repo 使用處 | 僅 `auth.rs:58`(定義)與 `auth.rs:135`(使用)——**共 2 處**,改完即為孤兒 |
| `register` 唯一呼叫端 | `src-tauri/src/commands.rs:239` — `crate::nymless_api::register(&username, &email, &password, &code).await`(回傳 `Result<(), Error>`) |
| 前端註冊成功後導向 | `src/pages/auth/CreateAccount.tsx` — `navigate("/auth/link-minecraft")`(⚠️ 下一頁即需認證 API,缺陷 B 在此發作) |
| 登入頁輸入框 | `src/pages/auth/Login.tsx` — `type="email"` + `required` |
| `NYMLESS_API_BASE_URL` | `src-tauri/src/nymless_api/mod.rs:71` — `option_env!("NYMLESS_API_BASE_URL")`,fallback `"http://localhost:8030"` |
| wire tests | `auth.rs:483` — `mod wire_contract_tests`(現有 7 條測試) |

⚠️ **本人新查得、任務包未載的事實**:對 Nymless repo 全檔 grep `NYMLESS_API_BASE_URL`
(排除 `node_modules` 與 `src-tauri/target`)共 **79 個命中**,其中 **沒有任何一處是 build 設定注入**
——`.github/workflows/ci.yml` 未設、`tauri.conf.json` / `package.json` / 任何 `.sh` 均未設。
⇒ 若發行 build 是用 repo 既有指令做的且 builder 未在 shell 手動帶入該變數,
發行版指向的就是 `http://localhost:8030`。**這仍不是實查結論**(不知 builder 當時打了什麼)→ 見 §11.1。

---

## 2. plan 層定案(⚠️ 這些不是裁決,是實作細節;有異議請於 plan-review 駁回)

### P1:Email 段命中但密碼錯 —— **⛔ 不 fall through 到 username 段**(定案)

**行為**:`WHERE email = ?` 查到 1 列後,該列即為本次登入的身分;密碼不符直接
`401 InvalidCredentials`,**不再**執行第二段 `WHERE username = ?`。

**理由**(四條,任一條獨立成立):

1. **語意確定性**:D1=甲 的核心字面是「Email 精確比對**優先**」。若 fall through,
   最終身分變成「由哪一個帳號的密碼恰好對得上」決定——那正是任務包背景 A-4 要避免的
   「依列序/巧合而非語意」的混淆,只是把 `OR` 的問題換了個位置重現。
2. **暴力破解面翻倍**:fall through 等於一次請求對兩個不同帳號各做一次密碼比對。
   `loginLimiter`(15 分鐘 10 次)的實際保護強度被砍半。
3. **帳號枚舉側信道**:fall through 會讓「Email 段有沒有命中」以回應時間洩漏
   (兩次 argon2 verify vs 一次;argon2 是刻意慢的)。
4. **可測性**:「不 fall through」是能用一條測試釘死的行為(§9 測試 A4);
   「fall through」則需要窮舉組合,契約鎖不牢。

**代價(明確承受,⛔ 不迴避)**:任務包裁決結果所記的那條附帶影響**因本定案而成立**——
既有帳號若 `username` 恰好等於**他人**的 `email` 字串,該字串會被 Email 段先攔下,
那個帳號將**無法再用使用者名稱登入**。
⚠️ 自己的 `username == 自己的 email` 的帳號**不受影響**(Email 段命中的就是同一列)。
⇒ 故上線前必須跑 §10 的碰撞查核 SQL,且該 SQL 必須能區分「跨帳號碰撞」與「同帳號自等」。

### P2:`normalizeRoles()` 三態規則(定案)

在 `AuthService` 內新增 **private static** helper(⛔ 不抽到 `utils/`——目前只有本檔兩處使用,
依撰碼規約「單次使用不做抽象 / 不過早抽象」):

| 輸入(DB `users.roles` 值) | 輸出 | 理由 |
|---|---|---|
| `["user"]`(mysql2 對 JSON 欄位自動 parse 的陣列) | 原陣列 | 現行主路徑 |
| `'["user","admin"]'`(歷史 varchar 存 JSON 字串) | `["user","admin"]` | `JSON.parse` 成功且為陣列 |
| `'user'`(歷史 varchar 存裸字串) | `["user"]` | `JSON.parse` 失敗 → 非空字串包成單元素陣列 |
| `''`(空字串) | `[]` | ⛔ 不得產生 `[""]` 這種假角色 |
| `null` / `undefined` | `[]` | 任務包背景 F 指定的 NULL 態 |
| 其他型別(number / object) | `[]` | 安全預設:寧可無角色也不要偽角色 |

**使用點**(共 4 處):
- `verify()` 的 payload `role`(現 `auth.service.ts:121`)
- `verify()` 的回傳 `role`(現 `:138`,同時移除 `as unknown as string[]` 這個謊言型轉換)
- `refreshAccessToken()` 的 payload `role`(現 `:296`)
- `refreshAccessToken()` 的回傳 `role`(現 `:313`,同上移除轉型)

⚠️ **附帶效果(明說)**:controller 的 `scope` 欄位取自這個回傳值,
所以 `roles` 為 `NULL` 的舊帳號,`scope` 會從 `null` 變成 `[]`。
這是 F 正規化的**必然結果**,型別仍是陣列 → 未違反「⛔ 不動 `scope` 格式」(那條指的是
不改成 OAuth2 的空白分隔字串)。

⚠️ `registerUser()` **不**用這個 helper:它直接簽字面陣列 `["user"]`(見 P4)。

### P3:`RegisterResponse` 刪除 + 舊形狀相容性以測試留證(定案)

- Rust `register()` 改用 `LoginResponse` 解析後,`RegisterResponse`(`auth.rs:58`)
  成為孤兒型別(本人實測全 repo 僅 2 處引用,皆在本次改動範圍內)→ **刪除**。
  這是「只清理自己的修改所造成的孤兒」,合規。
- 但「後端加欄位對舊客戶端無破壞」這件事不能只靠推理。作法:
  在 `wire_contract_tests` 內**本地定義**一個舊形狀 struct(只有兩個欄位、不加
  `#[serde(deny_unknown_fields)]`),用它反序列化**新的** register payload,斷言成功。
  ⇒ 相容性有實跑證據,生產碼裡卻不留孤兒。

### P4:`registerUser()` 回傳值擴充(定案)

`registerUser()` 現回 `{accessToken, refreshToken}`。改為回
`{accessToken, refreshToken, username, role}`,其中 `role: string[]` 為 `["user"]`。

**理由**:controller 的 `scope` 需要角色值。若讓 controller 自己寫死 `["user"]`,
「新帳號預設角色」這一份資料就有了兩個真實來源(service 寫 DB 一次、controller 回應一次),
違反撰碼規約 C(同一份資料的不同視角必須共用資料層)。`username` 同理由 service 回傳,
與 `verify()` / `refreshAccessToken()` 的回傳形狀對稱。

### P5:兩段式查找**不加 `LIMIT 1`**(定案)

`email` 與 `username` 皆為 UNIQUE 鍵,`LIMIT 1` 不改變結果集,只會製造與既有查詢風格的差異。
⇒ 維持既有寫法。

### P6:測試落在**新檔**,⛔ 不擴充 `auth.routes.test.ts`(定案)

`tests/routes/auth.routes.test.ts` 的既有性質是「免 DB 的參數驗證/守衛測試」
(其檔頭 `@notes` 明寫「登入成功路徑依賴 AuthService 與 DB,不在骨架範圍內」)。
在裡面塞 `vi.mock` Mysql 會改變該檔性質、且 `vi.mock` 是檔案層 hoisting,會波及既有三個 describe。
⇒ 新增 `tests/routes/auth.login-contract.test.ts`,沿 `auth.logout.test.ts` 的
`vi.mock("../../src/api/utils/mysql", …)` + 「依 SQL 片段分流」慣例。檔名取自任務代號
`fix-login-contract`,涵蓋本包 A/C/D/F 四缺陷的後端契約(不只 login)。

---

## 3. 主表:步驟 → 驗證方式

> ⚠️ 每一列的「驗證」都是**可實跑的一條命令或一條斷言**。
> ⛔ 不接受「應該會過」「依源碼推理成立」作為驗收。

| # | 步驟 | 動的檔案 | 驗證方式(實跑) | 通過判準 |
|---|------|----------|------------------|----------|
| **0** | 實跑復現缺陷 A(改碼前) | ⛔ 無(唯讀) | §5 的階梯 a/b/c,擇最高可行者;輸出落 `.evidence/` | 拿到「同一帳號:Email 打 → 401 / username 打 → 200」的一組實跑輸出(或階梯 c 的紅燈測試輸出) |
| **0'** | 順帶清掉 A-5 兩個排除項 | ⛔ 無 | 步驟 0 起 `yarn dev` 成功即證 `JWT_REFRESH_SECRET` 已設(`config._validateConfig()` 缺它會 throw、伺服器起不來) | 伺服器監聽 8030 的啟動輸出落檔 |
| **1** | A:`verify()` 兩段式查找 | `src/api/services/auth/auth.service.ts` | `npx vitest run tests/routes/auth.login-contract.test.ts` 的 A1–A5 | 5 條全綠 |
| **2** | C:註冊效期改用 `increaseTime` | `auth.service.ts` | 同上的 C1 / C2 | `exp - iat === 600` 於註冊與登入兩路徑皆成立 |
| **3** | F:role 型別統一 + `normalizeRoles` | `auth.service.ts` | 同上的 F1 / F2 | 三簽發路徑 `Array.isArray(role) === true`;三態各一條綠 |
| **4** | D:`register()` 回應補欄位 | `src/api/controllers/auth.controller.ts` | 同上的 D1 / D2 | 201 body 六欄位齊全 + `expires_in > Date.now()` |
| **5** | 後端整體回歸 | — | `npx vitest run` | 全綠(含既有 `auth.routes.test.ts` / `auth.logout.test.ts`) |
| **6** | 後端型別/建置 | — | `yarn build` | 退出碼 0 |
| **7** | 重複率守門 | — | `npx jscpd@5.0.14 --reporters console` | 實測 % 未使門檻 3.7 被突破;⛔ 不得調升 `.jscpd.json` |
| **8** | B:Rust `register()` 走 `persist_login_session` | `../Nymless/src-tauri/src/nymless_api/auth.rs` | `cargo test --lib`(於 `Nymless/src-tauri`) | 全綠,含新增 R1–R3 |
| **9** | Rust 建置健全性 | 同上 | `cargo test --lib` 已含編譯;另跑 `cargo clippy --all-targets -- -D warnings`(若該 repo 既有此慣例則跑,無則跳過並註明) | 無錯誤;⚠️ 孤兒 `RegisterResponse` 若未刪會出現 `dead_code` 警告 → 反向驗證刪乾淨了 |
| **10** | 改碼後復驗缺陷 A | — | 重複步驟 0 的**同一條**指令(同帳號、同 Email) | 由 401 轉為 200,且回應含 `access_token` / `token_type` / `expires_in` / `scope` / `refresh_token` / `info.username` |
| **11** | 上線前資料碰撞查核 | ⛔ 無(唯讀 SQL) | §10 三條 SQL | 三條的實際列數/計數寫進 verification;⛔ 不得預設「0」 |
| **12** | 現場查核兩項 | ⛔ 無 | §11 | 查得到就寫實測值;查不到寫「仍未查證」+ 原因,⛔ 不靜默略過 |
| **13** | git 三步對帳 | — | `git status --short` / `git diff --stat origin/developers` / `git log --oneline origin/developers..HEAD` | 變更檔案清單與 §12 一致,無夾帶 |
| **14** | 遠端 CI | — | push 後取 Actions run 連結(⛔ **push 前先回報 Yu**) | 兩 repo Actions 綠;⚠️ 紅則任務不算完成 |

---

## 4. 實作步驟細節

### 4.1 缺陷 A —— 兩段式查找(`auth.service.ts` `verify()`)

**改動位置**:現 `auth.service.ts:52-55` 的單段查詢區塊(錨點文字 `SELECT * FROM users WHERE username = ?`)。

**改後的查找順序(明確定案)**:

```
輸入 identifier = verifyData.username   （欄位名維持不變 —— 這是 OAuth2 password grant 的既定欄位名，
                                          ⛔ 不改，改了會破壞既有請求契約與 Rust 側 LoginRequest）

第 1 段：SELECT * FROM users WHERE email = ?      [identifier]
  ├─ 有 1 列 → 該列即為身分，直接進入密碼驗證段（⛔ 不論密碼對錯，都不再查第 2 段 —— P1）
  └─ 0 列   → 進入第 2 段

第 2 段：SELECT * FROM users WHERE username = ?   [identifier]
  ├─ 有 1 列 → 該列即為身分，進入密碼驗證段
  └─ 0 列   → throw AppError("帳號或密碼錯誤。", 401, "InvalidCredentials")
```

**⛔ 明確不做**:
- ⛔ 不用 `WHERE email = ? OR username = ?` 單查(任務包背景 A-4:結果依列序而非語意)。
- ⛔ 不在 SQL 層做 `LOWER()` / `TRIM()` 正規化(那是行為改變,超出範圍;現況見下方 collation 註記)。
- ⛔ 不改動密碼驗證段、Lazy Migration 段、token 簽發段的既有邏輯——這三段**原封不動**,
  只是它們拿到的 `user` 現在可能來自 Email 段。

**⚠️ collation 註記(必須寫進 verification,⛔ 不在本包改)**:
MySQL 的 `WHERE email = ?` 是否大小寫敏感由欄位 collation 決定
(utf8mb4 的常見預設 `utf8mb4_general_ci` / `utf8mb4_0900_ai_ci` 皆**不敏感**)。
既有的 `WHERE username = ?` 一直是同樣行為,故這**不是本次引入的**。
實作側以 `SHOW FULL COLUMNS FROM users` 實測 `email` / `username` 的 collation 並記錄;
⛔ 不因此改碼。

**JSDoc**:`verify()` 的既有 doc 需更新 `@param` 說明——`verifyData.username`
現在的語意是「Email 或使用者名稱(Email 優先)」。依規約補。

**CLAUDE.md 地雷清單**:本 plan **提議**在 `CLAUDE.md`「地雷清單」新增一條
(內容:登入識別採 Email 優先兩段式查找、⛔ 不得改回 `OR` 單查、Email 段命中即定案不 fall through)。
⚠️ 任務包說「在 plan 中提出」——**本 plan 提出,由 plan-review 裁定要不要做**。
未獲放行前 ⛔ 不動 `CLAUDE.md`。

### 4.2 缺陷 C —— 註冊效期同源

`auth.service.ts:238` 的 `expiresIn: "15m",` 改為 `` expiresIn: `${environment.jwt.increaseTime}ms`, ``
(與 `verify()` / `refreshAccessToken()` 逐字同形)。`environment` 已在檔頭 import,無新 import。

⚠️ 這是**縮短**效期(15 分鐘 → 10 分鐘)。對舊版 app 的影響:註冊後 access token 早 5 分鐘到期。
在缺陷 B 未修的舊 app 上,原本就「永不刷新」,所以只是把 401 提早 5 分鐘出現——
⛔ 不是新缺陷,且 B 修好後此差異消失。此點寫進 verification。

### 4.3 缺陷 F —— role 型別統一

1. `auth.service.ts:215` 的 `const roles = JSON.stringify(["user"]);` 拆成兩個值:
   - 寫進 DB 的值:維持 `JSON.stringify(["user"])`(⛔ 不動 DB 寫入格式,那會改變既有資料形狀)。
     ⚠️ 實作側須確認 mysql2 對 JSON 欄位寫入字串的既有行為未變——以步驟 10 復驗時新註冊的那筆
     實際 `SELECT roles FROM users WHERE …` 取值形狀為準,寫進 verification。
   - 簽進 JWT payload 的值(`:232` `role: roles`):改為字面陣列 `["user"]`。
2. 新增 `private static normalizeRoles(dbValue: unknown): string[]`,規則見 §P2,附 JSDoc。
3. 四個使用點替換(見 §P2),並移除兩處 `as unknown as string[]`。

### 4.4 缺陷 D —— register 回應對稱

`auth.controller.ts:351-356` 的回應物件改為:

```
{
  success: true,                                    // 既有，保留（舊客戶端相容）
  message: "註冊成功！",                             // 既有，保留
  access_token,
  token_type: "bearer",
  expires_in: new Date().getTime() + environment.jwt.increaseTime,   // ⚠️ 絕對 epoch 毫秒（D2=甲）
  scope: <service 回傳的 role>,
  refresh_token,
  info: { username },
}
```

- `expires_in` 那一行**逐字沿用** `login()`(`:112` / `:127`)的既有表達式 → 語意同源。
- ⚠️ 這使同一個表達式在本檔出現**三次**。撰碼規約 C 說「重複兩次可以忍,第三次必須抽」。
  **本 plan 定案:不抽**,理由——(a) jscpd `minLines: 5` / `minTokens: 50`,單行不觸發門檻;
  (b) 抽成 helper 會讓「這是 OAuth2 回應欄位」的可讀性下降,而 D2 的意圖正是**把語意留在眼前**;
  (c) 三處未來會因**同一個**理由改動(OAuth2 正規化那一包),屆時一起改。
  ⚠️ 若 plan-review 認為此判斷不成立,請駁回,實作側改抽 helper。
- 在 `expires_in` 上方加**一句**註解言明「絕對 epoch 毫秒,非 OAuth2 的剩餘秒數;
  與 Nymless `is_token_expired()` 的解讀對齊,⛔ 不得單邊改成秒數」。
  同樣一句加在 `login()` 的兩處(那是 D2「兩端加註解」的後端半)。

### 4.5 缺陷 B —— Nymless `register()` 走 `persist_login_session()`

檔案:`../Nymless/src-tauri/src/nymless_api/auth.rs`(⚠️ 路徑含空格,`cd` 時加引號)。

1. `register()`(`auth.rs:112`)成功分支改為:
   - 以 `LoginResponse` 反序列化(錯誤映射沿**同檔 `login()` 的既有風格**:
     `.map_err(|e| ErrorKind::APIInteractingError(e.to_string()).as_error())?`,
     ⛔ 不用現行的裸 `?`——那是新寫的那一行,採同檔既有風格合規)。
   - 呼叫 `persist_login_session(&login_response).await?`。
   - 回傳型別**維持** `Result<(), Error>`(唯一呼叫端 `commands.rs:239` 不需改)。
2. 刪除 `RegisterResponse` struct(`auth.rs:58`)。
3. 補 `register()` 的 `///` doc(現況無 doc,違反規約;本次動到它,依規約補)。
4. `persist_login_session()` 內 `profiles.nymless_auth.expires_at = …` 那一行上方加**一句**註解:
   後端 `expires_in` 是**絕對 epoch 毫秒**、不是 OAuth2 的剩餘秒數(D2「兩端加註解」的前端半)。

⚠️ **失敗模式(必須寫進 verification 與部署說明)**:改後的 `register()` 要求回應含 `info.username`
(`LoginResponse.info` **不是** `Option`)。若新 app 打到**尚未部署缺陷 D 修復**的舊後端,
反序列化失敗 → 註冊回 `APIInteractingError`,**但帳號其實已在後端建立**,
使用者重試會撞 `409 Conflict`。⇒ 部署順序約束見 §13。
⛔ **不**用「給 `info` 加 `#[serde(default)]`」來繞開:那會同時鬆掉 `login()` 的契約
(允許 `username` 靜默為空字串),用契約強度換一個部署順序就能解決的問題,不划算。

---

## 5. 步驟 0:實跑復現缺陷 A(改碼前必做)

⚠️ 任務包標記缺陷 A 的根因鏈為「**檔案層閉合、未實跑**」。⛔ 不得跳過本節直接改碼。

### 5.1 純黑箱有一個陷阱(先講清楚)

後端對「查無此人」與「密碼不符」**回傳完全相同的錯誤**
(皆為 `AppError("帳號或密碼錯誤。", 401, "InvalidCredentials")`,見 `auth.service.ts` `verify()` 兩處)。
⇒ 只拿「Email 打 → 401」**證明不了**根因,因為密碼打錯也是 401。
**必須拿到對照組**:同一帳號、同一密碼,改用 username 打 → **200**。
⇒ 這要求一組**真實可用的帳密**。以下階梯即為此而設。

### 5.2 階梯(由高到低,擇最高可行者;⛔ 不得跳級到「不做」)

**階梯 a(首選)—— 現成帳密**
向 Yu 索取一組 dev 環境可用的測試帳號(username / email / 明文密碼),或由 Yu 代跑。
指令(⚠️ `<…>` 由實際值替換):

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api" && mkdir -p .evidence/fix-login-contract && yarn dev 2>&1 | tee .evidence/fix-login-contract/00-server-start.log
```

```bash
curl -sS -i -X POST http://localhost:8030/oauth2/token -H 'Content-Type: application/json' -d '{"grant_type":"password","username":"<EMAIL>","password":"<PASSWORD>"}' | tee "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api/.evidence/fix-login-contract/01-repro-by-email.txt"
```

```bash
curl -sS -i -X POST http://localhost:8030/oauth2/token -H 'Content-Type: application/json' -d '{"grant_type":"password","username":"<USERNAME>","password":"<PASSWORD>"}' | tee "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api/.evidence/fix-login-contract/02-repro-by-username.txt"
```

**預期看到**:第一發 `HTTP/1.1 401` + body `{"success":false,"code":"InvalidCredentials",…}`;
第二發 `HTTP/1.1 200` + body 含 `access_token` / `info`。
⚠️ 兩發之間注意 `loginLimiter`(15 分鐘 10 次)——復現只需 2 發,不會撞到;
若復現過程反覆試導致 429,**等窗口過去**,⛔ 不得改 `loginLimiter` 繞開。

**階梯 b —— 自建再刪除的測試列(dev DB)**
若無現成帳密:以 argon2 產一個雜湊,`INSERT` 一列專用測試帳號(username 與 email 刻意不同),
跑階梯 a 的兩發,然後 `DELETE` 該列。
⚠️ 前置條件(缺一不可,否則降階梯 c):
- `.env` 的 `NODE_ENV` 與 `MYSQL_DATABASE` 確認指向 **dev**,⛔ 不是 production;
- 該列的 `unique` 用明顯可辨識的前綴(如 `repro-fix-login-contract-`),便於事後確認刪乾淨;
- `INSERT` 前後各跑一次 `SELECT COUNT(*) FROM users`,兩數字寫進 verification 證明淨零。
⚠️ 這**不違反**「⛔ 不改既有使用者資料」——新增自己的列再刪掉,不碰任何既有列。

**階梯 c(保底)—— mock 層紅燈復現**
若 DB 完全不可用:在**改碼前**寫一條會紅的測試(先落 `.evidence/`,再納入正式測試檔):
以 `vi.mock` 攔 Mysql,送 `{grant_type:"password", username:"<email 字串>", password:"x"}`,
斷言「service 送出的第一段 SQL 含 `email = ?`」→ **改碼前必紅**(現況只發 `username = ?`)。
把紅燈輸出落 `.evidence/fix-login-contract/01c-repro-mock-red.txt`。
⚠️ 誠實標註:**這是查找層的 mock 復現,不是真 DB 端到端**。

### 5.3 若三個階梯都走不通

⛔ **停手,回報 Yu**,⛔ 不得改碼、⛔ 不得在 verification 寫「已復現」。
回報內容:走到哪一階、卡在什麼(如 DB 連不上的實際錯誤字串)、需要 Yu 提供什麼。

### 5.4 若復現「不出來」(即 Email 打也 200,或 username 打也 401)

這代表**任務包的根因判斷有誤**。⛔ 不得繼續照 plan 改碼。
動作:把實際輸出落檔 → 在 verification(或另立回報檔)寫明實測與任務包背景 A 的差異 → **停手回報**。
⛔ 不得「反正改了也不會壞」就照做。

### 5.5 步驟 0-b:真機復現(缺陷 B / 自癒路徑)

任務包標「可做則做,做不到誠實標『待人工』」。本 plan 的立場:
- 「註冊 → 15 分鐘後 401」需要真機 + 等 15 分鐘;「隔天啟動自癒」需要跨日。
  ⇒ 這兩項**預設標「待人工 / 待 Yu 排期」**,⛔ 不以推理冒充。
- **可立即實跑的替代證據**(要做):註冊後直接讀 `profiles.json`,
  斷言 `nymless_auth.expires_at` 為 `0`(改前)/ 非 `0`(改後)、`user.username` 為空(改前)/ 非空(改後)。
  這把缺陷 B 的**因**釘死;15 分鐘後的 401 是該因的**果**,由 `is_token_expired(0) == false` 的
  單元測試(§9 R3)補上。⇒ 因 + 機制皆有實跑證據,只有端到端計時待人工。

---

## 6. 資料碰撞查核(上線前必跑,⛔ 不得預設「不存在」)

⚠️ 這一節直接對應 §P1 承受的代價。**在後端上線前**對**目標環境的 DB** 執行:

**Q1 —— 跨帳號碰撞明細(有實害的那種)**

```sql
SELECT a.`unique` AS username_owner, a.username AS colliding_string,
       b.`unique` AS email_owner,    b.email    AS email_owner_email
FROM users a
JOIN users b ON a.username = b.email
WHERE a.`unique` <> b.`unique`;
```

**Q2 —— 同一筆的計數**

```sql
SELECT COUNT(*) AS cross_account_collisions
FROM users a JOIN users b ON a.username = b.email
WHERE a.`unique` <> b.`unique`;
```

**Q3 —— 同帳號自等(無實害,但要一併量出來以免把 Q1/Q2 的 0 誤讀成「沒人用 Email 當帳號」)**

```sql
SELECT COUNT(*) AS same_account_username_equals_email FROM users WHERE username = email;
```

**判讀與動作**:
- Q2 = 0 → 附帶影響的實際受害者為 0,可上線。三個數字仍全部寫進 verification。
- Q2 > 0 → ⛔ **停手,回報 Yu**。那表示上線會讓 Q1 列出的那些帳號掉登入(他們仍可改用自己的 Email 登入,
  但若他們的 Email 也被別人佔為 username 就會連鎖)。是否照上線、要不要先改資料,**是 Yu 的裁決**,
  ⛔ 不由實作側決定。
- ⚠️ Q1/Q2 的 `JOIN … ON a.username = b.email` 受 collation 影響。若 collation 為 `_ci`(不區分大小寫),
  這個查核會**偏保守**(多抓到),那是好的方向。實測到的 collation 一併記錄。

**⛔ 誠實條款:查的是哪一個 DB(plan-review 阻斷點 1,2026-08-31 修入)**

- verification **必須明寫 Q1–Q3 是對哪一個 DB 跑的**,附 `MYSQL_DATABASE` 的**實際值**與 `MYSQL_HOST`;
  ⛔ 不得只寫「已查、結果為 0」而不交代查的是哪個環境。
- **只查得到 dev 時**:⛔ **不得以 dev 的 0 清掉此項**。verification 須明標
  「**production 未查**」+ 原因(無連線 / 無權限 / 實際錯誤字串)。
- 並把下列列為**部署前置步驟**寫進 verification 的部署說明:
  **上線前由 Yu(或有 production 權限者)對 production 跑一次 Q1–Q3;Q2 > 0 即停,不得部署,交 Yu 裁決。**
- 理由:D1=甲 的附帶影響是以「上線前查過**現有資料**」為條件才被接受的
  (任務包裁決結果原文:「⛔ 不得預設『不存在』」)——**dev 的 0 不能代位 production**。

---

## 7. 兩項「檔案層查不到、必須現場查」的項目

### 7.1 發行 build 的 `NYMLESS_API_BASE_URL` 實際值

**何時查**:步驟 0-b 真機環節,或更早(不阻塞後端改動)。

**查法(由強到弱)**:
1. 問 Yu:做那個發行版時 build 指令前面有沒有帶 `NYMLESS_API_BASE_URL=…`。(最直接,且只有他知道)
2. 對已安裝的發行版二進位撈字串:
   ```bash
   strings -a "/Applications/Nymless.app/Contents/MacOS/Nymless" 2>/dev/null | grep -iE 'https?://[^ ]*' | sort -u | head -40
   ```
   ⚠️ 路徑依實際安裝位置調整;撈不到不代表沒有(可能被壓縮/最佳化)。
3. **等價判準(最實用)**:真機 app 打登入時若收到後端的 **401 結構化錯誤**(而非網路層錯誤),
   即證明 base URL 指得到後端。⇒ 步驟 0-b 一旦跑過,這項自動清掉。

**查不到怎麼辦**:在 verification 寫「**仍未查證**」+ 已試過的方法 + 為何不阻塞
(理由:本包的後端改動不依賴此值;它只影響「app 打不打得到後端」這個**已排除方向**的排除強度)。
⛔ 不得靜默略過、⛔ 不得寫「應為 fallback」冒充實查。

⚠️ 本人已實查得到的部分(可直接寫進 verification):Nymless repo 內
**沒有任何 build 設定注入該變數**(全檔 grep,排除 `node_modules` 與 `src-tauri/target`)。
⇒ 若 builder 未手動帶入,值就是 `http://localhost:8030`。這**是**一條實查結論,
但**不等於**「發行版當時的值」——後者仍需上述 1/2/3 之一。

### 7.2 線上 DB `users.roles` 的實際欄位型別

**何時查**:步驟 0 起服務、DB 連得上時立刻查(與 §6 的碰撞 SQL 同一次連線)。

```sql
SHOW COLUMNS FROM users LIKE 'roles';
```

```sql
SHOW FULL COLUMNS FROM users;
```

(第二條同時取得 §4.1 需要的 `email` / `username` collation。)

**判讀**:
- `json` → 與 `users.sql` 一致,`normalizeRoles` 走「已是陣列」態。
- `varchar` / `text` → 歷史遷移未同步,`normalizeRoles` 走「JSON 字串」或「裸字串」態。
  ⚠️ 這不阻塞——三態容納正是為此而設。記錄即可。
- 其他型別(如 `int`)→ ⛔ **停手回報**:`normalizeRoles` 會回 `[]`,等於所有人失去角色,
  這超出本包預期,需 Yu 裁決。

**查不到怎麼辦**(例:只連得到 dev、production 無權限):
verification 明寫「查的是 **dev**(`MYSQL_DATABASE=<實際值>`),**production 未查證**」+ 原因,
並說明 `normalizeRoles` 的三態設計使此項不成為上線阻塞。⛔ 不得寫成「已確認為 JSON」。

---

## 8. 契約鎖:測試逐條清單

### 8.1 後端(新檔 `tests/routes/auth.login-contract.test.ts`)

沿 `auth.logout.test.ts` 慣例:`vi.mock` Mysql 連線池、依 SQL 片段分流、⛔ 不連真 DB。

| 代號 | 測什麼 | 斷言 |
|------|--------|------|
| A1 | Email 登入成功 | 第 1 發 SQL 含 `email = ?` 且參數為輸入字串;回應 200;body 六欄位齊全 |
| A2 | Email 查無 → 退回 username | 第 1 發 `email = ?` 回 0 列 → 第 2 發 SQL 含 `username = ?` → 200(**username 登入回歸**) |
| A3 | 兩段皆查無 | 401 + `{success:false, code:"InvalidCredentials"}`(結構化,⛔ 非純文字) |
| **A4** | **Email 命中但密碼錯 ⇒ 不 fall through** | 401,且 `poolQuery` 的呼叫中**不存在**含 `username = ?` 的查詢 ← **P1 的鎖** |
| A5 | Lazy Migration 經 Email 路徑仍觸發 | DB 回 MD5 雜湊列 + 正確明文 → 200,且發出含 `UPDATE users SET password = ?` 的查詢 |
| C1 | 註冊 token 效期 | `jwt.decode(access_token, {complete:true})` 的 `exp - iat === environment.jwt.increaseTime / 1000` |
| C2 | 登入 token 效期同源 | 同上,兩者相等 |
| D1 | register 回應對稱 | 201;body 含 `token_type:"bearer"`、`expires_in`、`scope`、`refresh_token`、`info.username`;**且既有 `success` / `message` 仍在** |
| D2 | `expires_in` 絕對毫秒語意鎖(register) | `expires_in > Date.now()`(⚠️ 若有人改成秒數,值會是 600 → 立刻紅) |
| D3 | 同上(login,password 分支) | 同上 |
| F1 | 三路徑 role 皆陣列 | register / password / refresh_token 三種簽發的 payload,`Array.isArray(decoded.role) === true`;register 為 `["user"]` |
| F2a | 正規化:DB 為陣列 | `scope` 與 payload `role` 皆為原陣列 |
| F2b | 正規化:DB 為 JSON 字串 | `'["user","admin"]'` → `["user","admin"]` |
| F2c | 正規化:DB 為 `null` | → `[]`(⛔ 不是 `null`、⛔ 不是 `[""]`) |

⚠️ F2 透過 `/oauth2/token` 的回應與 token payload 斷言,⛔ 不直接測 private method
(測私有方法會把實作細節焊進測試)。

### 8.2 Nymless(`auth.rs` `mod wire_contract_tests`)

現有 7 條測試**全部保留**(`RegisterRequest` 未改 → `register_request_keys` 不動)。新增:

| 代號 | 測什麼 | 斷言 |
|------|--------|------|
| R1 | 新 register 回應可用 `LoginResponse` 解 | 鏡像後端新 payload(含 `success`/`message`/六欄位)→ `LoginResponse` 反序列化成功,`info.username` / `expires_in` / `refresh_token` 值正確 |
| R2 | 舊客戶端相容性(P3) | 測試模組內本地定義的舊形狀 struct(僅 `access_token`/`refresh_token`)吃**新** payload → 成功 ⇒ 證「後端加欄位不破壞舊 app」 |
| R3 | `expires_in` 絕對毫秒語意鎖(D2 的 Rust 半) | `is_token_expired(0) == false`(既有語意);`is_token_expired(now_ms + 600_000) == false`;**`is_token_expired(600) == true`** ← 若哪天後端改回「剩餘秒數」,小整數會被當成 1970 年的時間戳而永遠判過期,這條測試把該退化的可觀測後果釘在案 |

⚠️ `is_token_expired` 是私有 fn,但 `wire_contract_tests` 以 `use super::*;` 在同檔內,可直接呼叫(既有慣例)。

---

## 9. 檔案清單

### 9.1 namelessrealms-api(主 repo)

| 檔案 | 動什麼 |
|------|--------|
| `src/api/services/auth/auth.service.ts` | A(兩段式查找)、C(效期同源)、F(`normalizeRoles` + 註冊簽陣列)、P4(回傳擴充)、JSDoc |
| `src/api/controllers/auth.controller.ts` | D(register 回應補欄位)、D2 語意註解 ×3 |
| `tests/routes/auth.login-contract.test.ts` | **新增**,§8.1 全部 |
| `docs/tasks/fix-login-contract-plan.md` | 本檔(已產出) |
| `docs/tasks/fix-login-contract-verification.md` | 實作後產出 |
| `CLAUDE.md` | ⚠️ **提議**加一條地雷(§4.1 末);⛔ 未獲 plan-review 放行不動 |

⛔ **不動**:`src/database/users.sql`(無 schema 變更)、`src/interface/auth/IUser.ts`(見 §14)、
`src/api/routes/auth.routes.ts`、`src/api/middlewares/*`、`.jscpd.json`、`.github/workflows/*`。

### 9.2 Nymless

| 檔案 | 動什麼 |
|------|--------|
| `src-tauri/src/nymless_api/auth.rs` | B(`register()` 走 `persist_login_session`)、刪 `RegisterResponse`、補 `register()` doc、`expires_at` 語意註解、wire tests R1–R3 |

⛔ **不動**:`src/pages/auth/Login.tsx`、`src/pages/auth/CreateAccount.tsx`、
`src-tauri/src/commands.rs`(register 簽章不變)、`src-tauri/src/nymless_api/mod.rs`。

---

## 10. 驗證指令總表(可直接複製貼上)

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api" && npx vitest run
```

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api" && yarn build
```

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api" && npx jscpd@5.0.14 --reporters console
```

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/Nymless/src-tauri" && cargo test --lib
```

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api" && git status --short && echo "--- diff vs origin/developers ---" && git diff --stat origin/developers && echo "--- commits ahead ---" && git log --oneline origin/developers..HEAD
```

```bash
cd "/Users/quasi-pc/Desktop/Projects/Nameless Realms/Nymless" && git status --short && echo "--- diff vs origin/developers ---" && git diff --stat origin/developers && echo "--- commits ahead ---" && git log --oneline origin/developers..HEAD
```

⚠️ 上述每一條的**實際輸出**(不是「應該會過」)落 `.evidence/fix-login-contract/`,
verification 引用落檔路徑。⛔ 不得引用會消失的來源(執行中終端、未落檔的輸出)。

---

## 11. 部署順序與混版行為

### 11.1 順序(有先後約束)

| 步 | 動作 | 約束 |
|----|------|------|
| 1 | **後端先上**(A/C/D/F) | 無 DB migration、無新表 ⇒ ⛔ **沒有** F35 那種「先建表再部署」的順序地雷 |
| 2 | **Nymless 後發**(B) | ⛔ 不得早於步驟 1 —— 理由見 §4.5 失敗模式 |

### 11.2 舊版 app + 新後端(D1=甲 的賣點,**必須驗證,⛔ 不得只推理**)

**推論**:舊版 app 不改一行,後端上線後登入立刻復活。

**推論成立的三個前提,逐條給驗證方式**:

| 前提 | 為何成立(檔案層) | **實跑驗證方式** |
|------|-------------------|------------------|
| 請求格式沒變 | 舊 app 送 `{grant_type,username,password}`;後端 `_verifyRequest` 必要欄位未改 | 用 `curl` 送出**與舊 app 逐字相同**的 body(§5.1 的指令即是),得 200 |
| 登入回應形狀沒變 | `LoginResponse` 需要的 `access_token` / `info.username` 仍在,`refresh_token` / `expires_in` 仍在 | 步驟 10 復驗的 200 回應 body 逐欄比對 |
| register 加欄位不破壞舊 app | serde 忽略未知欄位 | **測試 R2**(§8.2)——用舊形狀 struct 吃新 payload |

⚠️ **誠實界線**:上表第一、二列是「等價於舊 app 的 HTTP 請求」,**不是真的跑舊 binary**。
若能取得舊版發行 app 實跑一次登入,那是更強的證據 → 做得到就做、做不到在 verification
標「以等價請求驗證,未跑舊 binary」。⛔ 不得寫成「舊版 app 已實測復活」。

### 11.3 新 app + 舊後端(⛔ 必須避免的反向)

register 回應無 `info` → `LoginResponse` 反序列化失敗 → 註冊顯示失敗但**帳號已建立** →
使用者重試撞 409 `Conflict`。⇒ 這就是 §11.1 順序約束的成因。寫進 verification 的部署說明。

### 11.4 回滾

後端可單獨 revert(無 DB 變更、無資料遷移),回滾後即回到「登入頁全員不可用」的現況。
Nymless 側若已發版而後端回滾 → 落入 §11.3 的情境 ⇒ **後端回滾前必須先確認 app 未發版**。

---

## 12. 界外事項(⛔ 只記錄不修,寫入 verification「已知未修」節)

1. **`f32-4` NR 錯誤代碼制**:已知登入失敗顯示 `NR-1003`、應為 `NR-2002`。⛔ 本包不碰。
2. **`accessControl` dead code**:`src/api/middlewares/authJwtVerify.ts:109`,
   本人實測**全 repo 僅檔頭 doc(`:7`)與定義處(`:109`)兩個命中,無任何路由掛載**。
   其 `switch (request.user.role)` 對陣列值匹配不到 case 會直接放行 ⇒ 若日後掛載,
   持陣列 role 的一般使用者會穿過 admin 守門。本包把 payload 統一成陣列後**此隱患仍在**。⛔ 不順手修。
3. **`scope` 欄位格式**:現回陣列,OAuth2 規定空白分隔字串。Rust 端整個忽略此欄,無實害。⛔ 不改。
4. **`loginLimiter`**:15 分鐘 10 次,是缺陷 A 的體感放大器,不是根因。⛔ 不改。
5. **register 回應未設 `Cache-Control: no-store`**:`login()` 有設(`auth.controller.ts` 內),
   `register()` 沒設,但回應同樣含 token。⚠️ **本包不做**(超出任務包範圍,依「只做被要求的功能」)。
   → 建議另立小包。列此供 plan-review 判斷是否要納入。

---

## 13. 與任務包不一致之處(交 plan-review 裁斷,⛔ 本 plan 不自行改任務包)

> ⚠️ 逐條寫明,⛔ 不默默改掉。任務包不是我的產出,我不動它。

| # | 位置 | 不一致內容 | 本 plan 的處置 |
|---|------|------------|----------------|
| 1 | 任務包「要建的模組 / 資源」表格第 1 列 | 動什麼欄仍寫著「…、**A(註冊禁 `@`)**」——這是**丙案**的產物,與已回填的裁決結果 **D1=甲**(明文「⛔ **不**加註冊禁 `@` 驗證」)矛盾 | 依裁決結果與「範圍」第 1 條:⛔ **不做**禁 `@`。判定為丙案殘留未清 |
| 2 | 任務包「驗收步驟 → 負向 → A」 | 「註冊 username 含 `@` → 400 `InvalidRequest`」——同一處丙案殘留 | ⛔ **不做**這條負向測試(D1=甲 下該行為不存在,寫了會是假測試) |
| 3 | 任務包「不做什麼」第 6 條末 | 「『禁止 `@`』只擋新註冊」——前提在 D1=甲 下不存在 | 該句連同前提一併失效;「⛔ 不改既有使用者資料」的主張本身**仍照做** |
| 4 | 任務包背景 F / 實作要點 | 未提及 `src/interface/auth/IUser.ts` **缺 `email` 欄位**(本人實測),而 `users.sql` 有 | 兩段式查找用 `SELECT *` 不會編譯失敗 ⇒ ⛔ **本包不補**(超出範圍)。列此供 review 判斷是否納入 |
| 5 | 任務包驗收步驟 0-a | 「以 Email 打確認 401、改用 username 打確認 200」——**未載**「查無此人與密碼錯誤回傳完全相同」這個陷阱,單看 401 證明不了根因 | 本 plan §5.1 已補上陷阱說明與對照組要求。判定為任務包**遺漏**而非錯誤 |
| 6 | 任務包背景 A-5 第 1 點 | 稱發行 build 的 `NYMLESS_API_BASE_URL` 值「檔案層查不到」 | 本人實測補強:**Nymless repo 內無任何 build 設定注入該變數**(全檔 grep)。這使「若未手動帶入即為 fallback」成為實查結論,但**發行版當時的值**仍未知 ⇒ §7.1 |

⚠️ 除上述外,任務包所列的**全部檔案/行號錨點,本人逐條複驗後與 2026-08-31 現況一致**
(對照見 §1 的實測表)。

---

## 14. 風險與停手條件

| 觸發 | 動作 |
|------|------|
| 步驟 0 的三個階梯全走不通 | ⛔ 停手回報 Yu,⛔ 不改碼 |
| 步驟 0 復現「不出來」(與任務包背景 A 不符) | ⛔ 停手回報,落檔實際輸出,⛔ 不照 plan 硬改 |
| §6 的 Q2(跨帳號碰撞)> 0 | ⛔ 停手回報 Yu 裁決,⛔ 不自行決定是否照上線 |
| §7.2 的 `roles` 欄位型別非 `json` 也非字串型 | ⛔ 停手回報 |
| `npx vitest run` 有既有測試轉紅 | ⛔ 停手查清,⛔ 不改既有測試來配合(那是把回歸守門拆掉) |
| jscpd 實測 % 超過 3.7 | 先**重構降重複**;⛔ 不得調升 `.jscpd.json` 門檻(規約 G:調升要理由並過 Yu) |
| `docs/tasks/fix-login-contract-plan-review.md` 尚未存在 | ⛔ 不動任何程式碼。⚠️ 正確動作是**等待**,⛔ 不是自己補一份 review |

---

## 15. 證據與紀律

- 所有實跑輸出落 `.evidence/fix-login-contract/`(本 repo 根目錄;⚠️ 本人實測 `.gitignore`
  **無** `evidence` 條目 ⇒ 這些檔會被 git 看見。**是否納入版控由 Yu 決定**,
  ⛔ 實作側不自行 commit)。verification 一律引用落檔路徑,⛔ 不引用執行中終端或 `docker logs`。
- 負向測試若需暫時改碼,還原一律用**備份檔**(如 `cp x.ts x.ts.bak` → 測完 `mv` 回來),
  ⛔ 不用 `git checkout`(會清掉未 commit 的正式改動)。
  ⚠️ 依 §8 的設計,本包所有負向情境都能用 `vi.mock` 完成,**預期不需要改碼做負向測試**。
- **分段回報**:步驟 0 完成回報一次 → 後端 A/C/F/D 完成回報一次 → Nymless B 完成回報一次 →
  §6/§7 現場查核完成回報一次。⛔ 不累積到最後才一次講完。
- verification 只寫**實跑過的事實**;未實跑者明寫「未驗 / 待人工」,
  ⛔ 不得以源碼推理代替(尤其 §11.2 的「舊版 app 復活」與 §5.5 的真機計時)。
- ⛔ commit / push 前回報 Yu 等確認。CI 措辭:local green + remote Actions 綠(附 run 連結)才算完成。
- ⛔ 本人不寫、不改 `fix-login-contract-plan-review.md` 與 `fix-login-contract-verification-audit.md`,
  ⛔ 不代填任何架構師批覆或裁決結論。

---

## 16. 待 plan-review 裁定的項目(彙整)

1. §4.1 末:是否在 `CLAUDE.md`「地雷清單」新增「登入識別 Email 優先兩段式查找」一條。
2. §P1:「Email 段命中即定案、⛔ 不 fall through」——連同其代價(§6 的附帶影響)。
3. §4.4:`expires_in` 表達式在 `auth.controller.ts` 出現第三次而**不抽 helper** 的判斷。
4. §13 的 6 條不一致,尤其第 1/2/3 條(丙案殘留)與第 4 條(`IUser` 缺 `email`)。
5. §12 第 5 點:register 回應是否要補 `Cache-Control: no-store`(本 plan 定為界外)。
