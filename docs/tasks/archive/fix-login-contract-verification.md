# 驗收報告:fix-login-contract 登入/註冊契約缺陷修復

> 產出者:實作側 Claude Code(**接手撰寫**——前一個實作 agent 在寫本報告前被 watchdog 判定 stalled,
> 程式碼實作已完成並留有 `.evidence/` 落檔;本報告的所有**量測值由本人重跑一次**,
> 不可重跑者(改碼前的復現現場)明確標示為「引用前一個 agent 的落檔、本人未重跑」)。
> **不得用範本/預期值/設計推理冒充已執行。** 真機做不到就誠實標「待人工」。

- **日期**:2026-08-31
- **主 repo**:`namelessrealms-api`(本報告所在)
- **副 repo**:`Nymless`(`src-tauri/src/nymless_api/auth.rs`)
- **證據目錄**:`.evidence/fix-login-contract/`(共 **24** 份;`00`–`31` 為前一個 agent 落檔 17 份,
  `40`–`46` 為本人複驗新增 **7** 份——`40`–`46` 為**閉區間 7 個檔**,17 + 7 = 24)

---

## 0. 白話摘要

- **問題**:登入畫面只收 Email,後端卻只拿去比對「使用者名稱」欄位 ⇒ 只要使用者名稱不等於 Email,
  **每個人都會被回「帳號或密碼錯誤」**。已在 dev 實跑復現(同一帳號同一密碼:Email 打 → 401、
  使用者名稱打 → 200)。
- **修了什麼**:後端改成「先比 Email、查無再比使用者名稱」;順帶把註冊路徑的 token 效期改成
  與登入同源(原本硬寫 15 分鐘)、註冊回應補齊與登入對稱的欄位、JWT 裡的角色型別統一成陣列;
  Nymless 的註冊成功後改走與登入相同的 session 持久化(原本沒寫入到期時間與使用者名稱)。
- **驗到什麼**:後端本地 `yarn build` 綠、`npx vitest run` **158 測試全過**、
  Nymless `cargo test --lib` **39 全過**、jscpd **3.32%** 未超門檻 3.7。
- **還沒驗到什麼**(⚠️ 重點):**production 的資料碰撞查核未做**(只查得到 dev,且 dev 只有 1 筆使用者,
  那個 0 不具代表性)、**發行版 `NYMLESS_API_BASE_URL` 實際值查不到**。
  ⚠️ **真機 app 端到端已於 2026-08-31 在 dev 補跑**(§17):缺陷 A / B 真機驗畢、C 側證;
  ⛔ 但 dev 綠不等於 production 綠,且「舊版發行 binary」「逾效期 / 跨日」仍為待人工。
  詳見 §11「未驗 / 待人工」。
- **狀態**:⛔ **尚未 commit / push**,兩 repo HEAD 皆未動,等 Yu 確認。

---

## 1. 裁決出處與範圍收斂

| 裁決點 | 結果 | 出處 |
|--------|------|------|
| **D1**(登入要認什麼當帳號) | **甲** —— 後端兩段式查找,Email 精確比對優先,查無再比使用者名稱 | Yu 2026-08-31 於主迴圈對話**逐字批「1. 甲」**,回填於 `docs/tasks/fix-login-contract.md`「裁決結果」節 |
| **D2**(`expires_in` 是否改 OAuth2 語意) | **甲** —— 維持絕對毫秒時間戳,兩端加註解 + 測試鎖住,⛔ 本包不做 OAuth2 正規化 | Yu 2026-08-31 於主迴圈對話**逐字批「2. 甲」**,同上 |

⚠️ **D1 選甲的已知並接受之殘留風險**(任務包「裁決結果」節已載明,本報告據實重述,⛔ 不淡化):

> 既有帳號若 `username` 恰好等於**他人**的 `email` 字串,該字串會被 Email 段先攔下,
> **那個帳號將無法再用「使用者名稱」登入**。

成因是本包定案的 **P1:Email 段命中即定案、⛔ 不 fall through 到 username 段(即使密碼不符)**。
受害者規模的量測見 §7(dev 已查、production 待人工)。

⛔ **未做丙案**:D1 批甲不批丙 ⇒ **未新增**「使用者名稱不得含 `@`」的註冊驗證,
全 repo 無任何禁 `@` 的實作或測試(`git diff` 可核)。

---

## 2. 變更檔案

### 2.1 namelessrealms-api(主 repo)

| 檔案 | 改了什麼 |
|------|----------|
| `src/api/services/auth/auth.service.ts` | **A**:`verify()` 身分查找改兩段式(先 `WHERE email = ?`,查無再 `WHERE username = ?`);**C**:`registerUser()` 的 access token 效期由硬寫 `"15m"` 改為 `` `${environment.jwt.increaseTime}ms` ``;**F**:新增 `private static normalizeRoles()`(三態:陣列 / JSON 字串 / 裸字串,NULL→`[]`),`verify()` 與 `refreshAccessToken()` 共用,`registerUser()` 改簽字串陣列;**P4**:`registerUser()` 回傳值擴充 `username` / `role`;補 JSDoc |
| `src/api/controllers/auth.controller.ts` | **D**:`register()` 201 回應補 `token_type` / `expires_in` / `scope` / `info.username`(既有 `success` / `message` 保留);`expires_in` 絕對毫秒語意註解 ×3(refresh 分支、password 分支、register) |
| `tests/routes/auth.login-contract.test.ts` | **新增**,317 行,15 條契約測試(A1–A5 / C1–C2 / D1–D3 / F1 / F2a–F2d) |
| `CLAUDE.md` | 地雷清單**加一條**(登入識別採 Email 優先兩段式、⛔ 不得改回 `OR` 單查、⛔ Email 段命中不 fall through)。錨點編輯,⛔ 未整份重寫;`git diff --stat` 顯示 `CLAUDE.md 5 ++`(純新增 5 行、0 刪除) |
| `docs/tasks/fix-login-contract-verification.md` | 本檔 |

⛔ **未動**(plan §9.1 的守界清單,`git status` 可核):`src/database/users.sql`、
`src/interface/auth/IUser.ts`、`src/api/routes/auth.routes.ts`、`src/api/middlewares/*`、
`.jscpd.json`、`.github/workflows/*`。

### 2.2 Nymless(副 repo)

| 檔案 | 改了什麼 |
|------|----------|
| `src-tauri/src/nymless_api/auth.rs` | **B**:`register()` 成功後改以 `LoginResponse` 解析並復用 `persist_login_session()`(原本只存兩個 token);刪除 `RegisterResponse` 結構體(**P3**:舊形狀相容性改由測試留證,⛔ 生產碼不留孤兒型別);補 `register()` 的 `///` 文件註解;`persist_login_session()` 內 `expires_at` 加絕對毫秒語意註解;wire tests 新增 3 條 |

⛔ **未動**:`src/pages/auth/Login.tsx`、`src/pages/auth/CreateAccount.tsx`、
`src-tauri/src/commands.rs`、`src-tauri/src/nymless_api/mod.rs`(`git status` 僅 `auth.rs` 一檔)。

---

## 3. 設計重點

1. **兩段式查找,⛔ 不用 `OR` 一把撈**:`username` 與 `email` 各自 UNIQUE 但**跨欄位不互斥**,
   `WHERE email = ? OR username = ?` 的身分會依**列序**而非語意決定。已把此條寫進 `CLAUDE.md` 地雷清單。
2. **P1:Email 段命中即定案、⛔ 不 fall through**。採納理由(依 plan-review 的權重排序):
   - **語意確定性**:fall through 會讓最終身分由「哪個帳號的密碼恰好對得上」決定 ——
     正是 `OR` 單查要排除的「依巧合而非語意決定身分」,只是換個位置重現。
   - **暴力破解面**:fall through 會使單次請求的 argon2 比對次數加倍,`loginLimiter`(15 分鐘 10 次)
     的實際保護強度減半。
   - **可測性**:測試 A4 可直接斷言「第二段 SQL 未被發出」。
   - ⚠️ **時序側信道(措辭已依 plan-review 降級)**:「帳號存在與否」的時序洩漏**現況本來就有**
     (查得到列才跑 argon2)。fall through 只是**加劇**既有洩漏。
     ⛔ 本包**未消除**時序側信道,⛔ 不得寫成「已消除」。
3. **`normalizeRoles()` 三態**:dev 實測 `users.roles` 為 `json`、mysql2 回傳已是 JS 陣列
   (§7 證據),但正規化仍容納「JSON 字串 / 裸字串 / NULL」——線上型別未查證(見 §11),
   三態設計使此項不成為上線阻塞。空字串回 `[]`,⛔ 不產生 `[""]` 這種假角色。
4. **`registerUser()` 對 DB 仍寫 JSON 字串**(`JSON.stringify(["user"])`),⛔ 不改既有資料形狀;
   只有 **JWT payload 與 API 回應**統一為字串陣列。
5. **register 復用 `LoginResponse`**:後端回應補對稱欄位後,Nymless 可直接以 `LoginResponse` 解析、
   走 `persist_login_session()`,⛔ 不另寫一套持久化。⛔ 未用 `#[serde(default)]` 繞開缺欄位
   ——那會讓 `login()` 的 `username` 契約一起鬆掉。
6. **`expires_in` 表達式在 controller 出現第三次而不抽 helper**:plan-review 已核可
   (單一運算式、jscpd `minLines: 5` 不觸發、語意由 D2/D3 測試鎖住、三處未來會因**同一個**理由
   (OAuth2 正規化包)一起消失)。撰碼規約 C 的「第三次必須抽」在此讓位於「錯的抽象比重複更貴」。

---

## 4. 步驟 0:改碼前實跑復現(缺陷 A)

> ⚠️ **本節證據為前一個實作 agent 於 2026-08-31 04:15–04:16 UTC 落檔,本人未重跑**——
> fixture 已於 `13-fixture-cleanup.txt` 刪除、程式碼已修復,**改碼前的 401 現場不可重建**。
> 本人做的是:讀完全部落檔、核對伺服器端 log 的時間戳與狀態碼是否自洽(見下方「本人複核」)。

**採用階梯**:plan §5.2 的**階梯 b(自建再刪除的測試列)**——未向 Yu 索取現成帳密,
自建一列 `username` 與 `email` 刻意不同的測試帳號,跑完即刪。

**前置與淨零核對**(`04-fixture-insert.txt` / `13-fixture-cleanup.txt`):

```
NODE_ENV=development  MYSQL_HOST=localhost  MYSQL_DATABASE=namelessrealms
BEFORE users COUNT(*) = 1        BEFORE repro-prefixed rows = 0
inserted: username=repro-fix-login-contract-name  email=repro-fix-login-contract@example.test
AFTER-INSERT users COUNT(*) = 2  AFTER-INSERT repro-prefixed rows = 1
…
AFTER-CLEANUP: users=1           NOW repro-prefixed rows = 0
```

⇒ **淨零**:起始 1 筆、結束 1 筆、專用前綴列 0。⛔ 未碰任何既有列。
**本人複核**:`46-recheck-db-probe.txt`(我 2026-08-31 15:11 UTC 自跑)實測 `total users = 1`,
與清除後數字一致 ⇒ 清除確實乾淨。

**復現(缺陷 A 的核心證據)**:

| # | 動作 | 實際結果 | 落檔 |
|---|------|----------|------|
| A | 以 **Email** 打 `POST /oauth2/token`(`grant_type=password`) | **HTTP/1.1 401** + `{"success":false,"code":"InvalidCredentials","error":"帳號或密碼錯誤。",…}` | `01-repro-by-email.txt` |
| B | **對照組**:同一帳號、同一密碼,改以 **username** 打 | **HTTP/1.1 200** + `access_token` / `refresh_token` / `info.username":"repro-fix-login-contract-name"`,JWT `sub` = `repro-fix-login-contract-u1` | `02-repro-by-username.txt` |

⇒ 證實根因 A:**Email 對不上 `username` 欄位 ⇒ 0 列 ⇒ 401**。
(對照組是必要的:後端對「查無此人」與「密碼不符」回**逐字相同**的 401,單看 A 證不了根因。)

**伺服器端獨立佐證**(`00-server-start-prefix.log`,前一個 agent 落檔):
`04:16:30` 一筆 `POST /oauth2/token → 401`、`04:16:35` 一筆 `→ 200`,與 A/B 兩發的
`Date` 標頭(`04:16:30 GMT` / `04:16:35 GMT`)逐秒吻合。

⚠️ **證據弱點(據實記錄)**:`01`/`02` 只 tee 了 **HTTP 回應**,**請求 body 未落檔**;
「同一密碼」這一點無法從落檔獨立佐證,標籤(`== A) login by EMAIL ==`)是執行腳本自產的。
可從落檔獨立確認的是:狀態碼 401→200 的差異、B 的回應 `sub`/`info.username` 確實指向該 fixture 帳號,
以及 fixture 的 `username` 與 `email` 刻意不同(`04-fixture-insert.txt`)。

⚠️ **證據力據實下修(2026-08-31 稽核後補正)**:稽核側逐條驗過上列三條替代佐證,
判定**三條各自成立、但合起來仍不足以獨立證成「同一密碼」**。
⇒ 本報告據此**下修「復現組(A/B 兩發)本身」的證據力**:
它能證明的是「同一 fixture 帳號、Email 打 401 / username 打 200」,
⛔ **不能**單憑落檔證明兩發用的是同一個密碼。原措辭若讀起來像「復現組已完整證成根因」,以本段為準。

**但根因結論⛔ 不靠那組復現**(以下為本人親自重跑 / 讀碼確認,⛔ 非轉抄):

```bash
git show origin/developers:src/api/services/auth/auth.service.ts
```

改碼前 `origin/developers` 的 `verify()`(該檔第 **39–144** 行)實測:

| 量測 | 指令 | 實測值 |
|------|------|--------|
| 函式內 `SELECT` 發數 | `sed -n '39,144p' … \| grep -c 'SELECT'` | **1** |
| 函式內出現 `email`(不分大小寫)次數 | `sed -n '39,144p' … \| grep -ci email` | **0** |

該唯一一發是 `"SELECT * FROM users WHERE username = ?"`,綁 `[verifyData.username]`;
函式內另一條 SQL 是 Lazy Migration 的 ``UPDATE users SET password = ? WHERE `unique` = ?``,
與身分查找無關。**全函式⛔ 無任何 email 路徑。**

⇒ 配合 fixture 的 `username`(`repro-fix-login-contract-name`)**≠** `email`
(`repro-fix-login-contract@example.test`,`04-fixture-insert.txt` 落檔),
把 Email 字串送進只比 `username` 的查詢**必然 0 列**,程式在 `users.length === 0` 直接丟
`AppError("帳號或密碼錯誤。", 401, "InvalidCredentials")`——
**且此路徑在密碼比對之前**,⇒ **401 是結構上的必然,⛔ 與密碼是否相同無關,⛔ 不是巧合。**
換言之:即使「同一密碼」這點無法從落檔獨立佐證,**根因 A 仍然成立**。

**步驟 0-b(真機復現缺陷 B / 自癒路徑)**:⛔ **未執行 → 待人工**。詳見 §11 與 §14。

---

## 5. 修復後驗證(正向 / 負向)

> 證據為前一個 agent 於 2026-08-31 04:21–04:22 UTC 落檔(`05`–`09`),本人未重跑真機 HTTP
> (fixture 已刪、伺服器已停;現行證據耐久落檔可查)。本人重跑的是測試與建置(§8)。

### 正向

| 情境 | 實際結果 | 落檔 |
|------|----------|------|
| **A**:同一帳號以 **Email** 登入(修前 401) | **200**,回應六欄位齊全:`access_token` / `token_type:"bearer"` / `expires_in` / `scope:["user"]` / `refresh_token` / `info.username` | `06-postfix-verify.txt` 段 A |
| **A 回歸**:以 **username** 登入 | **200**,形狀同上 | `06` 段 B |
| **D**:`POST /register` | **201**,回應含 `success:true` / `message:"註冊成功！"` / `access_token` / `token_type:"bearer"` / `expires_in` / `scope:["user"]` / `refresh_token` / `info.username:"repro-fix-login-contract-reg"` | `08-postfix-register.txt` |
| **C**:註冊路徑 token 效期 | 解碼實測 **`exp - iat = 600` 秒**(= `increaseTime 600000 / 1000`),與登入路徑一致(修前為 900) | `09-postfix-register-decode.txt` / `07-postfix-token-decode.txt` |
| **F**:JWT `role` 型別 | 登入路徑 `payload.role: ["user"]`、`Array.isArray: true`;註冊路徑同 | `07` / `09` |
| **D2 語意鎖** | `expires_in: 1788150687404`、`now: 1788150095155` ⇒ `is_absolute_epoch_ms: true` | `07` / `09` |
| **DB 寫入形狀** | 註冊列 `roles` 讀回 `js_type=object is_array=true` | `08` 末段 |

伺服器端佐證(`05-server-start-postfix.log`):`04:21:27` 連續 `200` / `200` / `401`
與 `04:21:58` 的 `/register → 201`,與 `06` / `08` 的四發逐筆對上。

### 負向

| 情境 | 實際結果 | 落檔 |
|------|----------|------|
| Email 與 username 皆查無 | **401** + **結構化** `{"success":false,"code":"InvalidCredentials","error":"帳號或密碼錯誤。","message":…,"isOperational":true}`(⛔ 非框架純文字) | `06` 段 C |
| Email 段命中但密碼錯 ⇒ ⛔ 不 fall through | 測試 **A4** 斷言「第二段 `username = ?` 查詢未被發出」→ 綠 | `42-recheck-vitest-login-contract.txt` |
| `expires_in` 被誤改成秒數 | 測試 **D2/D3**(後端斷言 > 當下 epoch 毫秒)+ Rust **`expires_in_is_absolute_epoch_millis`**(`is_token_expired(600)` 為 true)鎖住 | `42` / `44-recheck-cargo-test.txt` |

**還原方式**:⛔ 本包**不需要**為負向測試改任何生產碼(全部以 `vi.mock` 完成),
故無備份檔需還原;⛔ 全程未使用 `git checkout`。

---

## 6. 契約鎖:測試清單與實跑結果

### 6.1 後端(新檔 `tests/routes/auth.login-contract.test.ts`,15 條,本人實跑全綠)

| 代號 | 鎖什麼 |
|------|--------|
| A1 | 以 Email 登入成功,**第一發查詢即為 `email = ?` 精確比對**,回應六欄位齊全 |
| A2 | Email 查無 → 退回 username 段,使用者名稱登入仍可用(回歸) |
| A3 | 兩段皆查無 → 401 `InvalidCredentials`(結構化) |
| A4 | Email 段命中但密碼錯 ⇒ ⛔ 不 fall through |
| A5 | **Lazy Migration** 經 Email 路徑仍觸發升級寫回 |
| C1 / C2 | 註冊路徑 `exp - iat = increaseTime/1000`;登入路徑與其相等 |
| D1 / D2 / D3 | register 201 回應對稱且既有欄位保留;register / login 的 `expires_in` 為絕對 epoch 毫秒 |
| F1 | register / password / refresh_token **三條簽發路徑**的 `role` 皆為陣列 |
| F2a–F2d | `normalizeRoles` 四態:陣列原樣 / JSON 字串 parse / `null`→`[]`(⛔ 不是 `null`、⛔ 不是 `[""]`)/ 裸字串包成單元素 |

沿 `tests/routes/auth.logout.test.ts` 慣例以 `vi.mock` 攔 Mysql 連線池,**⛔ 不連真實 DB**。

### 6.2 Nymless(`auth.rs` `mod wire_contract_tests`,本人實跑全綠)

本人實測該模組現有 **10 條**(plan-review 記錄改動前為 7 條 ⇒ 新增 3 條):

- `register_response_deserializes_as_login_response` —— register 回應必須解得成 `LoginResponse`
  (否則走不了同一條持久化路徑);payload 的 `scope` 用**陣列**(後端實際形狀)。
- `register_added_fields_do_not_break_old_clients` —— 以**測試模組內**定義的舊形狀 struct
  吃新 payload,證明 serde 忽略未知欄位 ⇒ 後端加欄位不破壞舊版 app(⛔ 生產碼不留孤兒型別)。
- `expires_in_is_absolute_epoch_millis` —— `is_token_expired(0) == false`(0 = 未知,刻意視為未過期)、
  `is_token_expired(now+600_000) == false`、`is_token_expired(600) == true`。

⚠️ 第二條是「**舊形狀 struct 吃新 payload**」,**不是跑舊版 binary**(見 §11 與 §13.2)。

---

## 7. 資料碰撞查核(Q1–Q3)與 ⛔ 誠實條款

> 本節對應 plan §6(含 plan-review **阻斷點 1** 修入的誠實條款)。
> **本人於 2026-08-31 15:11 UTC 自跑一次唯讀 SELECT**(`46-recheck-db-probe.txt`),
> 數字與前一個 agent 的 `03-db-probe.txt` 一致。

### 7.1 查的是哪一個 DB(⛔ 必寫)

```
NODE_ENV        = development
MYSQL_HOST      = localhost
MYSQL_DATABASE  = namelessrealms
MySQL VERSION() = 5.7.44
total users     = 1
```

⇒ **查的是 dev**,⛔ **不是 production**。

### 7.2 三個數字(dev 實測)

| 查詢 | 結果 |
|------|------|
| **Q1** 跨帳號碰撞明細(`a.username = b.email` 且 `a.unique <> b.unique`) | `[]`(空) |
| **Q2** `cross_account_collisions` | **0** |
| **Q3** `same_account_username_equals_email`(同帳號自等,無實害) | **1** |

附帶實測(同一次連線):`users.roles` 型別 = **`json`**;mysql2 讀回 `js_type=object`、`is_array=true`;
`username` / `email` / `unique` collation 皆 **`utf8mb4_general_ci`**(不分大小寫 ⇒ Q1/Q2 的 JOIN 偏保守,
會多抓不會少抓,方向是好的)。

### 7.3 ⛔ 誠實條款:dev 的 0 **不清掉此項**

⚠️ **dev 全庫只有 1 筆使用者**,`Q2 = 0` **不具代表性**;`Q3 = 1` 也只是那唯一一筆自等。
依 plan §6 誠實條款與任務包裁決結果原文「**⛔ 不得預設『不存在』**」:

- **production 的 Q1–Q3:未查證** ——
  **原因**:本次實作全程只連得到本機 dev(`MYSQL_HOST=localhost`);
  ⛔ 未取得任何 production 連線資訊,⛔ 未嘗試連線(避免誤連正式庫)。
- ⛔ **不得**以 dev 的 0 判定「附帶影響的受害者為 0」。
- **production Q1–Q3 列為部署前置步驟**,由 Yu(或有 production 權限者)執行 ——
  可直接複製貼上的指令見 §13.4。**Q2 > 0 即停,⛔ 不得部署,交 Yu 裁決。**

---

## 8. 測試結果(本人 2026-08-31 15:08–15:09 UTC 全部重跑)

| 項目 | 指令 | 結果 | 落檔 |
|------|------|------|------|
| 建置 | `yarn build` | `Done in 2.67s` / `BUILD_EXIT=0` | `40-recheck-yarn-build.txt` |
| 後端全測 | `npx vitest run` | **Test Files 20 passed (20)** / **Tests 158 passed (158)** / `VITEST_EXIT=0` | `41-recheck-vitest.txt` |
| 本包新測試 | `npx vitest run tests/routes/auth.login-contract.test.ts` | **1 passed (1)** / **15 passed (15)** | `42-recheck-vitest-login-contract.txt` |
| 重複率 | `npx jscpd@5.0.14` | 79 檔 / 9456 行 / 43735 tokens / 30 clones / **重複 314 行 = 3.32%** / `JSCPD_EXIT=0` | `43-recheck-jscpd.txt` |
| Nymless | `cargo test --lib`(於 `Nymless/src-tauri`) | **39 passed; 0 failed; 0 ignored** / `CARGO_EXIT=0`;其中 `nymless_api::auth::wire_contract_tests` **10 條**全過 | `44-recheck-cargo-test.txt` |

⚠️ **jscpd 門檻**:`.jscpd.json` 的 `threshold` 為 **3.7**,實測 **3.32% < 3.7** ⇒ 未超標。
⛔ 未更動 `.jscpd.json` 的任何欄位(`threshold` / `minLines: 5` / `minTokens: 50` / `ignore` / `path` / `format`)。
⚠️ jscpd 產出的 `docs/dedup/jscpd-report.{json,html}` 落在 `.gitignore:12 docs/dedup/` 內,
不影響 `git status`(本人以 `git check-ignore -v` 實測確認)。

---

## 9. 回歸守門

- **既有測試未被波及**:`npx vitest run` 全庫 20 檔 158 測試全過,含 F35 的
  `tests/routes/auth.logout.test.ts` 與既有 `tests/routes/auth.routes.test.ts`
  ⇒ logout / refresh 撤銷(fail-closed)行為未被本包影響。⛔ 未修改任何既有測試來配合新程式。
- **Lazy Migration 路徑**:測試 **A5** 斷言舊 MD5 帳號經 **Email 查找路徑**登入仍觸發 Argon2 升級寫回;
  `41-recheck-vitest.txt` 中亦可見執行期日誌 `User [someone] password has been migrated to Argon2.`。
- **refresh_token 換發**:測試 **F1** 覆蓋 `refresh_token` 分支簽發,回應形狀未變(`06` 段 A/B 亦同形)。
- **Nymless 既有 wire tests**:39 條全過,含 `login_request_matches_oauth2_password_contract`、
  `login_response_deserializes_backend_payload`、`login_response_tolerates_missing_optionals` 等既有條目。

---

## 10. 產物重建

- [x] **改過原始碼 → 已跑 `yarn build`**:本人實跑 `BUILD_EXIT=0`、`Done in 2.67s`
      (`40-recheck-yarn-build.txt`)。TypeScript 產物已重建。
- [x] **無 schema / migration 變更**:本包**未新增或修改任何 `.sql`**,無建表、無資料遷移
      ⇒ ⛔ **沒有** F35 那種「先建表再部署」的順序地雷(部署順序另有約束,見 §13)。
- ⚠️ **服務重啟**:dev 伺服器在改碼期間由 `ts-node-dev` 熱重載(`00`/`05` log 可見多次 `Restarting`),
      修後驗證(`06`–`09`)跑在重載後的程式上。正式環境的重啟屬部署動作,尚未執行。

---

## 11. plan-review「⛔ 未實查,實作側必查」逐條結案

> plan-review 只到檔案層(無 Bash),列了 6 條要求實作側實查。⛔ 不得靜默略過,逐條交代:

| # | 項目 | 結果 |
|---|------|------|
| 1 | 缺陷 A 的**實跑復現**(步驟 0) | ✅ **已查**:dev 實跑,Email → 401、對照組 username → 200(`01`/`02`,伺服器 log `00` 佐證)。⚠️ 本人未重跑(現場不可重建),證據弱點見 §4 |
| 2 | mysql2 對 JSON 欄位的回傳形狀、`users.roles` 實際型別 | ✅ **dev 已查**(本人自跑 `46`):型別 `json`,mysql2 回傳 `is_array=true`。⛔ **production 未查證**(無連線);`normalizeRoles` 三態設計使此項不成為上線阻塞 |
| 3 | `email` / `username` 的 collation | ✅ **dev 已查**(本人自跑 `46`):皆 `utf8mb4_general_ci` |
| 4 | **Q1–Q3 實際計數**(含 DB 標註義務) | ⚠️ **dev 已查(Q2=0 / Q3=1 / total=1)、⛔ production 未查證** —— 見 §7,已列為部署前置 |
| 5 | `npx vitest run` / `yarn build` / `npx jscpd@5.0.14` / `cargo test --lib` 實跑輸出 | ✅ **本人全部重跑**,見 §8。⛔ **remote Actions 未跑**(尚未 push,見 §15) |
| 6 | 發行 build 的 `NYMLESS_API_BASE_URL` 實際值 | ⛔ **仍未查證** —— 見下 |

### 11.1 `NYMLESS_API_BASE_URL`:仍未查證

- ✅ **本人實查得到的部分**:對 Nymless repo 全檔 `grep -rn "NYMLESS_API_BASE_URL"`
  (排除 `node_modules` / `target` / `.git`)——命中全部落在**文件**(`CLAUDE.md`、`專案內容.md`、
  `docs/tasks/archive/*`)、**常數定義**(`src-tauri/src/nymless_api/mod.rs:71`)與**使用處**
  (各 `nymless_api/*.rs` 的 `format!`)。⇒ **repo 內無任何 build 設定注入此變數**。
  `mod.rs:71-73` 為 `option_env!("NYMLESS_API_BASE_URL")`,未設定時 fallback `"http://localhost:8030"`。
- ⛔ **查不到的部分**:**發行 build 當時 builder 有沒有在指令前帶值**——這在**檔案層查不到**。
  已試過的方法:全 repo grep(如上,結論是 repo 內無注入)。**未試**:對已安裝發行版二進位撈字串
  (本機無該發行版可撈)、真機 app 打登入的等價判準(步驟 0-b 未執行)。
- ⇒ **標「待人工(僅 Yu 知悉)」**。⛔ 不得寫成「應為 fallback」冒充實查。
- **不阻塞的理由**:本包的後端改動不依賴此值;它只影響「app 打不打得到後端」這個**已排除方向**的排除強度。

---

## 12. 未驗 / 待人工 清單(⛔ 不以推理冒充)

| # | 項目 | 狀態 | 原因 |
|---|------|------|------|
| 1 | **production 的 Q1–Q3 碰撞查核** | **待人工(由 Yu 於正式環境執行)** | 只連得到 dev;dev 僅 1 筆使用者,其 0 不具代表性。⇒ **部署前置**,指令見 §13.4 |
| 2 | **真機 app 註冊 → 讀 `profile.json`**(`nymless_auth.expires_at` 非 0、`user.username` 非空) | ✅ **已驗(dev)** | 2026-08-31 主迴圈實跑,見 **§17.1 步驟 1–3**、落檔 `52-e2e-profile-json.txt`。`expires_at=1788191951390`、`username='nr-e2e-user'` ⇒ 缺陷 B 真機驗畢。⚠️ 環境為 **dev**,⛔ 非 production |
| 3 | **註冊後逾效期 401**、**隔天啟動自癒路徑** | **待人工 / 待排期** | 需等待逾 10 分鐘閒置 / 跨日,§17 實跑未涵蓋。任務包背景 B 的推導**仍為檔案層推導**。⚠️ 但 `expires_at` 已證非 0(§17.1),該推導的前提已成立 |
| 4 | **舊版 app + 新後端「登入復活」** | **以等價 HTTP 請求驗證,⛔ 未跑舊 binary** | `curl` 送出與舊 app 逐字相同的 body 得 200(`06` 段 A/B);舊版 register 相容性由 Rust 測試 `register_added_fields_do_not_break_old_clients`(舊形狀 struct 吃新 payload)佐證。⛔ 不得寫成「舊版 app 已實測復活」 |
| 5 | **發行版 `NYMLESS_API_BASE_URL` 實際值** | **待人工(僅 Yu 知悉)** | 見 §11.1 |
| 6 | **production `users.roles` 欄位型別** | **未查證** | 無 production 連線;三態正規化使其不阻塞 |
| 7 | **remote GitHub Actions** | **未跑** | 尚未 commit / push(見 §15) |
| 9 | **兩段式的 username 段在真機 UI 上驗證** | ⚠️ **UI 層不可達** | 登入欄位為 `type="email"`,瀏覽器擋下非 Email 輸入(§17.2 實測)。覆蓋僅來自單元測試 15 條。⛔ 非缺陷,⛔ 不改(超出 D1=甲 範圍)|
| 8 | **`config.jwt.refreshSecret` 於部署環境是否已設** | **dev 已間接證實、production 未查** | dev 的 `yarn dev` 起得來(`00`/`05` log 見 `listening on PORT 8030`)⇒ dev 有設(缺該值 `config.service` 會 throw)。production 未查 |

---

## 13. 部署順序與混版行為

### 13.1 順序

| 步 | 動作 | 約束 |
|----|------|------|
| **0** | **對 production 跑 Q1–Q3**(§13.4) | ⛔ **Q2 > 0 即停**,不得部署,交 Yu 裁決 |
| 1 | **後端先上**(A/C/D/F) | ⛔ **無建表、無 migration** ⇒ 沒有 F35 那種順序地雷。上線後**舊版 app 不改一行即可登入**(⚠️ 此推論的證據強度見 §12 第 4 項) |
| 2 | **Nymless 後發**(B) | ⛔ **不得早於步驟 1** |

### 13.2 為什麼新 app ⛔ 不能先發(⚠️ 這是本包唯一的混版地雷)

舊後端的 `register` 回應**沒有 `info` 欄位**,而 Nymless 的 `LoginResponse.info` **不是 `Option`**
(⛔ 本包刻意未用 `#[serde(default)]` 繞開——那會讓 `login()` 的 `username` 契約一起鬆掉)
⇒ 新 app 打舊後端註冊時**反序列化必敗**。而後端是在**回應之前**就已 `INSERT`
⇒ **app 顯示「註冊失敗」但帳號其實已經建立**,使用者重試會撞 `409 Conflict`。

### 13.3 回滾

後端可單獨 revert(無 DB 變更、無資料遷移),回滾後即回到「登入頁全員不可用」的現況。
⚠️ Nymless 若已發版而後端回滾 → 落入 §13.2 的情境 ⇒ **後端回滾前必須先確認 app 未發版**。

### 13.4 部署前置:對 production 跑碰撞查核(⛔ Q2 > 0 即停)

⚠️ 下列指令請對 **production** 資料庫執行(`<HOST>` / `<USER>` / `<DB>` 換成正式環境的值;
`-p` 後不接密碼,執行後會互動式詢問,密碼不會留在 shell 歷史):

```bash
mysql -h <HOST> -u <USER> -p <DB> -e "SELECT a.\`unique\` AS username_owner, a.username AS colliding_string, b.\`unique\` AS email_owner, b.email AS email_owner_email FROM users a JOIN users b ON a.username = b.email WHERE a.\`unique\` <> b.\`unique\`;"
```

```bash
mysql -h <HOST> -u <USER> -p <DB> -e "SELECT COUNT(*) AS cross_account_collisions FROM users a JOIN users b ON a.username = b.email WHERE a.\`unique\` <> b.\`unique\`;"
```

```bash
mysql -h <HOST> -u <USER> -p <DB> -e "SELECT COUNT(*) AS same_account_username_equals_email FROM users WHERE username = email;"
```

```bash
mysql -h <HOST> -u <USER> -p <DB> -e "SHOW COLUMNS FROM users LIKE 'roles';"
```

**判讀**:
- `cross_account_collisions = 0` → 附帶影響的實際受害者為 0,可照 §13.1 部署。三個數字仍請回填本報告。
- `cross_account_collisions > 0` → ⛔ **停手**。第一條列出的那些帳號上線後會**掉登入**
  (他們仍可改用自己的 Email 登入)。是否照上線、要不要先改資料,**是 Yu 的裁決**。
- 第四條若 `roles` 型別**既非 `json` 也非字串型**(例如 `int`)→ ⛔ **停手回報**:
  `normalizeRoles` 會回 `[]`,等於所有人失去角色。

---

## 14. 已知未修(record-only,⛔ 一項未做)

> 逐條聲明。以下全部**只記錄、⛔ 未改動任何一行**。

1. **`f32-4` NR 錯誤代碼制**:登入失敗在 app 端顯示 `NR-1003`(`APIInteractingError`),
   語意上應為 `NR-2002`(`InvalidCredentials`)。⚠️ 本人實查 `Nymless/src/i18n/errorCodes.ts:26,30`
   確認兩個代碼**都存在且對應如上**;⛔ **未實查**「登入失敗實際走到哪一個代碼」的執行期行為
   (需真機)。⛔ 本包不碰,屬 f32-4。
2. **`accessControl` dead code**:本人實查全 repo `grep -rn "accessControl" src/` **僅 2 個命中**
   (`src/api/middlewares/authJwtVerify.ts:7` 檔頭 doc、`:109` 定義處),**無任何路由掛載**。
   其 `switch (request.user.role)` 對陣列值匹配不到 case 會直接放行 ⇒ 若日後掛載,
   持陣列 role 的一般使用者會**穿過 admin 守門**。⚠️ 本包把 payload 統一成陣列後**此隱患仍在**。⛔ 未修。
3. **`IUser.ts` 缺 `email` 欄位(型別漂移)**:本人實查 `src/interface/auth/IUser.ts` 僅
   `id / unique / username / password / roles` 五欄,而 `users` 表有 `email`。
   兩段式查找用 `SELECT *` 且改後不讀 `user.email` ⇒ 不影響編譯與行為。⛔ 未補,屬漂移治理另包。
4. **register 回應未設 `Cache-Control: no-store`**:本人實查 `auth.controller.ts` 全檔
   `Cache-Control` **僅 1 個命中(第 101 行,login 分支)**;`08-postfix-register.txt` 的 201 回應標頭
   **確實不含 `Cache-Control`**(本人 `grep -c` 實測 = 0),而該回應**同樣含 token**。
   ⛔ 本包不做(超出任務包範圍),建議另立小包。
5. **`scope` 欄位格式**:現回**陣列**,OAuth2 規定為空白分隔字串。Rust 端整個忽略此欄,無實害。⛔ 未改。
   ⚠️ 附帶效果據實記錄:`normalizeRoles` 使 `roles` 為 `NULL` 的舊列其 `scope` 由 `null` 變成 `[]`。
6. **`loginLimiter`**(15 分鐘 10 次):是缺陷 A 的體感放大器,不是根因。⛔ 未改;
   復現過程亦未為了繞開它而改動(`01`/`02`/`06` 的 `RateLimit` 標頭可見計數正常遞減)。

---

## 15. git 對帳(本人 2026-08-31 15:09 UTC 實跑,落檔 `45-recheck-git.txt`)

### 15.1 namelessrealms-api(基準 **`origin/developers`**,⛔ 不是 main / master)

```
git log --oneline -1                 → 980b871 chore(claude): 新增開場簡報 hook; push-gate 補 gh 對外動作(...)
git status                           → ⛔ 非 clean(本包變更全部未 commit,清單見下)
git rev-parse HEAD origin/developers → 980b87106f5bcfcf4a211a4c659f46d6f035ff0e
                                       980b87106f5bcfcf4a211a4c659f46d6f035ff0e   ⇒ 本地 = 遠端
git log --oneline origin/developers..HEAD → (空) ⇒ 無本地未推 commit
```

`git status --short` 實測:

```
 M CLAUDE.md
R  docs/tasks/f35-logout-plan-review.md -> docs/tasks/archive/f35-logout-plan-review.md
R  docs/tasks/f35-logout-plan.md -> docs/tasks/archive/f35-logout-plan.md
R  docs/tasks/f35-logout-verification.md -> docs/tasks/archive/f35-logout-verification.md
R  docs/tasks/f35-logout.md -> docs/tasks/archive/f35-logout.md
 M src/api/controllers/auth.controller.ts
 M src/api/services/auth/auth.service.ts
?? .claude/commands/
?? .evidence/
?? docs/tasks/fix-login-contract-plan-review.md
?? docs/tasks/fix-login-contract-plan.md
?? docs/tasks/fix-login-contract.md
?? tests/routes/auth.login-contract.test.ts
```

`git diff --stat origin/developers` 實測(**報告初版時**):`7 files changed, 95 insertions(+), 17 deletions(-)`
(`CLAUDE.md` +5、`auth.controller.ts` 11 ±、`auth.service.ts` 96 ±,另四筆 f35 文件為 **rename**、內容 0 變更)。

⚠️ **報告初版後現場再變一次**:Yu 裁決 `.evidence/` 加入 `.gitignore` 後,主迴圈於 2026-08-31 執行該變更。
**主迴圈複驗的最新實測**:`8 files changed, 98 insertions(+), 17 deletions(-)`——
即上列七筆 **+ `.gitignore` +3**。⛔ 程式碼三檔的 95/17 未再變動。

⚠️ **本報告產出後**,`docs/tasks/fix-login-contract-verification.md` 會多出一筆 `??`(未追蹤),屬預期。
✅ `.evidence/` **已加入 `.gitignore`**(Yu 2026-08-31 裁甲,主迴圈執行)⇒ git 不再看見,⛔ 不入版控歷史。
⚠️ 因此 `.gitignore` 本身成為本包的第 4 筆**追蹤中變更**,`git diff --stat` 由 7 files / 95+ 變為 **8 files / 98+**(見 §15.1 補述)。
⚠️ f35 文件的 archive 搬移與 `.claude/commands/` **不是本包產生的**(進場時即已在工作區,
見任務起始的 git 狀態快照);⛔ 本人未動它們。

### 15.2 Nymless

⚠️ **本 repo 只有 `main`,沒有 `developers` 分支**(本人實跑 `git branch -a` 確認:
`* main` / `remotes/origin/main`)⇒ 對帳基準用 **`origin/main`**。
任務包指定的 `origin/developers` 是**本 repo(api)**的基準。

```
git log --oneline -1            → 196d936 chore(claude): 新增開場簡報 hook; push-gate 補 gh 對外動作(...)
git status --short              →  M src-tauri/src/nymless_api/auth.rs
                                   ?? .claude/commands/
git rev-parse HEAD origin/main  → 196d9369c890820291a814e58d8a0107be86c106
                                  196d9369c890820291a814e58d8a0107be86c106   ⇒ 本地 = 遠端
git log --oneline origin/main..HEAD → (空) ⇒ 無本地未推 commit
git diff --stat origin/main     → 1 file changed, 82 insertions(+), 14 deletions(-)
```

⇒ **兩 repo HEAD 皆未動,本包所有變更均在工作區、⛔ 尚未 commit。**

---

## 16. CI

- **本地**:`yarn build` ✅ + `npx vitest run`(158 全過)✅ + `npx jscpd@5.0.14`(3.32% < 3.7)✅
  + Nymless `cargo test --lib`(39 全過)✅ ⇒ **local green**。
- **狀態措辭**:**local green,remote Actions 未跑**。
  ⛔ 尚未 commit / push ⇒ **兩 repo 皆無本次的 Actions run**,⛔ 無 run 連結可附。
- **收案標準** = local green + remote Actions 綠(**附 run 連結**),push 獲批准後補。
  ⛔ 不得把本地綠燈當成「CI 通過」。
- ⚠️ **據實登記:收案標準形式上未達。** 兩 repo 皆未 push ⇒ 本次無任何 Actions run,
  ⛔ 無 run 連結可附 ⇒ 「remote Actions 綠」這一半**尚未成立**。
  ⛔ **不得**把本報告寫成已達收案標準。
  成因是流程性的(⛔ 尚未 commit / push,正在等 Yu 對 commit / push 的裁決),
  ⛔ 不是驗證缺漏;待 push 獲批准後補 run 連結,屆時方可宣告達標。

---

## 17. 真機 E2E

> ⚠️ **本節於 2026-08-31 由主迴圈實跑後回填**(⛔ 非實作側轉寫)。
> 環境為 **dev**:後端 `yarn dev`(`NODE_ENV=development`、`localhost:8030`、db `namelessrealms`),
> 前端 `yarn tauri dev`(⇒ `NYMLESS_API_BASE_URL` 走 fallback `http://localhost:8030`)。
> ⛔ **不是**正式環境、⛔ 不是發行版 binary——涉及「舊版發行 app」的步驟因此仍為待人工。
> 操作由 Yu 本人執行(一次一步),DB / log / `profile.json` 的查核由主迴圈執行。
> 落檔:`.evidence/fix-login-contract/50-e2e-summary.txt`、`51-e2e-server-log.txt`、`52-e2e-profile-json.txt`。

### 17.1 實跑結果(dev)

**素材**:於 app 內走完整註冊流程新建帳號 —— `username=nr-e2e-user`、`email=fqwert58+e2e1@gmail.com`
(⚠️ 刻意令 **username ≠ email**,否則驗不到缺陷 A;Email 用 Gmail `+` 別名以避開既有帳號的 409)。
⛔ 密碼由 Yu 自行設定,⛔ 主迴圈未持有。

| # | 步驟 | 過線標準 | 結果 |
|---|------|----------|------|
| 1 | app 內註冊(username ≠ email) | DB 新增一列、`roles` 為陣列、密碼 argon2 | ✅ **通過**——`nr-e2e-user` / `fqwert58+e2e1@gmail.com` / `['user']` / `$argon2` |
| 2 | 註冊後立即讀 `profile.json` | `nymless_auth.expires_at` **非 0**、`user.username` **非空** | ✅ **通過**——`expires_at=1788191951390`(15:59:11Z)、`username='nr-e2e-user'` ⇒ **缺陷 B 真機驗畢** |
| 3 | 由 2 的 `expires_at` 反推註冊 token 效期 | 應為 `environment.jwt.increaseTime`,⛔ 非舊的硬寫 `15m` | ✅ **通過**——註冊時刻 ≈15:49,到期 15:59 ⇒ **10 分鐘** ⇒ **缺陷 C 側證** |
| 4 | 登出 → 以 **Email** 登入 | 200 且進得了主畫面 | ✅ **通過**——`POST /oauth2/token` **200** ⇒ **缺陷 A 真機驗畢** |
| 5 | 登入後打需認證端點 | ⛔ 不得 401 | ✅ **通過**——`GET /servers` **200**(⇒ Email 登入拿到的 token 真的可用) |
| 6 | 登入後 `profile.json` 再確認 | `expires_at` 隨登入前推 | ✅ **通過**——16:01:15Z(登入時刻 15:51 + 10 分) |
| 7 | 改以**使用者名稱**登入(兩段式的 username 段) | 仍進得去 | ⚠️ **UI 層不可達**——見 §17.2 |

**後端 log 實測序列**(`51-e2e-server-log.txt`):
`POST /auth/logout → 200`、`POST /oauth2/token → 200`、`GET /servers → 200`。

⚠️ **步驟 4 的證據力說明**:該帳號 `username='nr-e2e-user'`,而輸入的是 Email 字串。
稽核側已查證改碼前 `verify()` **全函式只有一發 `WHERE username = ?`、⛔ 零 email 路徑**(§4),
⇒ 同一輸入在舊碼上**結構上必為 401**。故這一發 200 直接證成 Email 段生效,⛔ 非巧合。

### 17.2 ⚠️ 真機發現:兩段式的 **username 段從 UI 不可達**

登入頁欄位為 `type="email"`(`Nymless/src/pages/auth/Login.tsx:56`,標籤即「電子信箱」),
瀏覽器原生驗證會擋下不含 `@` 的輸入 —— Yu 實測填入 `nr-e2e-user` 時出現
`Enter an email address` 提示,**送不出去**。

⇒ **後端的 username 段在啟動器 UI 上走不到**,其覆蓋僅來自單元測試
(`tests/routes/auth.login-contract.test.ts`,15 條全綠)。

⚠️ **這不是缺陷,也⛔ 不改**:
- 該段的存在價值在於**回歸保護**(既有以使用者名稱登入的非啟動器呼叫端不被打斷),⛔ 不在 UI 流程;
- D1=甲 明文「後端也認 Email,**前端不動**」——動這個 `type` 屬**超出裁決範圍**;
- 若日後要讓 UI 也能用使用者名稱登入,須改 `type` 並重新過 Yu ⇒ **列入 carryover**。

### 17.3 仍為待人工(dev 環境做不到)

| # | 步驟 | 為何 dev 做不到 | 狀態 |
|---|------|----------------|------|
| 1 | **舊版發行 app** 以 Email 登入(⇒ 驗「舊版不改一行即復活」) | 需發行版 binary,dev 為原始碼熱重載 | **待人工** |
| 2 | 註冊後**閒置逾效期**再操作需認證功能 | 需等待 10 分鐘以上的真實閒置 | **待人工** |
| 3 | 註冊後**隔天**開 app(自癒路徑) | 需跨日 | **待人工** |
| 4 | 失敗時的 NR 代碼實際值(record-only) | 本輪未觸發失敗路徑 | **待人工** |
| 5 | 發行版 build 當時是否帶 `NYMLESS_API_BASE_URL` | 僅 Yu 知悉,見 §11.1 | **待人工** |

⚠️ **dev 綠 ⛔ 不等於 production 綠**:本節結論僅覆蓋 dev。

### 17.4 原始步驟表(⚠️ 回填前的版本,保留供追溯)

> ⚠️ 下表為實跑**之前**的規劃版本,其「全部待人工」已被 §17.1 取代;保留以供對照。
> 完整步驟表寫在這供日後複驗。⚠️ 實跑時**一次一步**、等回報結果才給下一步,⛔ 不一次貼整份。
> 前置素材由實作側備妥:後端需已部署新版;Nymless 需以 `NYMLESS_API_BASE_URL=<後端位址>` build。

| # | 步驟 | 過線標準 | 結果 |
|---|------|----------|------|
| 1 | 用**舊版**發行 app,以既有帳號的 **Email** 登入 | 進得了主畫面(⇒ 舊版 app 不改一行即復活) | **待人工** |
| 2 | 同上,改以**使用者名稱**登入 | 仍進得去(回歸) | **待人工** |
| 3 | **新版** app 註冊新帳號 → 立即讀 `profiles.json` | `nymless_auth.expires_at` **非 0**、`user.username` **非空** | **待人工** |
| 4 | 步驟 3 之後**閒置 15 分鐘**,再操作任一需認證功能 | ⛔ 不出現 401(⇒ 缺陷 B 已修) | **待人工** |
| 5 | 步驟 3 之後**隔天**開 app | 自癒路徑正常導向主畫面(回填任務包背景 B 的推導是否成立) | **待人工** |
| 6 | 步驟 1 執行時觀察 app 顯示的錯誤代碼(若失敗) | 記錄實際 NR 代碼(record-only,⛔ 不修) | **待人工** |
| 7 | 詢問 Yu:發行版 build 當時是否帶了 `NYMLESS_API_BASE_URL` | 得到明確回答(⇒ 清掉 §11.1) | **待人工** |

---

## 18. 與交辦描述不一致之處(據實記錄)

> ⚠️ 交辦訊息稱這些數字為主迴圈複驗結果。本人重跑後**逐項核對**,列出差異:

| # | 項目 | 交辦訊息所述 | 本人實測 | 判定 |
|---|------|--------------|----------|------|
| 1 | `yarn build` 耗時 | `Done in 2.76s` | `Done in 2.67s`(前一個 agent 落檔為 `2.35s`) | **非不符**:建置耗時本來就每次不同。⚠️ 本報告只引用**本人量到的** 2.67s |
| 2 | 證據份數 | 「17 份」 | 目錄原有 **17** 份 ✅;加上本人複驗新增 **7** 份(`40`–`46` 為閉區間)⇒ 現為 **24** 份(`ls .evidence/fix-login-contract/ \| wc -l` = 24,本人重數) | **相符**(差額為本人新增)。⚠️ 本報告初版誤寫 6 / 23(把 `40`–`46` 當成 6 個檔),稽核抓出,已於 2026-08-31 更正 |
| 3 | vitest 執行日誌 | —— | 該行為 `ERROR: Refresh token revocation check failed: Error: ER_NO_SUCH_TABLE: Table 'revoked_refresh_tokens' doesn't exist`。**本人 2026-08-31 15:28 UTC 重跑完整 `npx vitest run` 共 4 次,4 次皆出現該行且 158 全過**;單跑 `npx vitest run tests/routes/auth.logout.test.ts` 亦穩定重現(8 過) | **已查證、結案**(詳見下方「§18-3 補述」)。⚠️ 本報告初版誤寫「本人重跑未出現該行 / 原因未查證」,與現場不符,已於 2026-08-31 更正 |
| 4 | Nymless 對帳基準 | 交辦要求「基準 `origin/developers`」 | Nymless **無 `developers` 分支**,只有 `main` | 已按 `31-git-nymless.txt` 的既有作法用 `origin/main`;api 側維持 `origin/developers`。見 §15.2 |
| 5 | Nymless wire tests 條數 | —— | plan-review 記錄改動前 `auth.rs` 為 **7 條**;本人實測現為 **10 條**(+3) | 與 plan §8.2 要求的「新增 R1–R3」一致 |

### §18-3 補述:`ER_NO_SUCH_TABLE` 那一行的來源(已查明,⛔ 非缺陷)

**白話**:那行紅字是**測試自己故意製造的**,不是真的連到資料庫發現少一張表。
它來自 F35「撤銷表查詢失敗時必須回 401、⛔ 不放行」這條**負向測試**——測試把資料庫查詢
換成一個「一定會丟錯」的假的,程式照設計把錯誤記進 log 再回 401,**測試因此通過**。
⇒ **無風險、⛔ 不需收案前另查。**

**本人實測(2026-08-31 15:28 UTC)**:

| 指令 | 結果 | 該行是否出現 |
|------|------|--------------|
| `npx vitest run tests/routes/auth.logout.test.ts` | `Test Files 1 passed (1)` / `Tests 8 passed (8)`,exit 0 | **出現**(輸出第 4 行) |
| `npx vitest run`(完整套件)× 4 次 | 每次皆 `Test Files 20 passed (20)` / `Tests 158 passed (158)` | **4 次全部出現**(`grep -c` 每次皆 = 1) |

**來源鏈(本人親自讀碼確認)**:

- `tests/routes/auth.logout.test.ts:149`—`165` 這條測試名為
  「撤銷表查詢失敗(如表不存在)時 fail-closed 回 401,⛔ 不放行」;
  其 mock 在 **150–153 行**對含 `FROM revoked_refresh_tokens` 的 SQL **故意 `throw new Error("ER_NO_SUCH_TABLE: …")`**。
- `src/api/services/auth/auth.service.ts:435` 的 `logger.error("Refresh token revocation check failed: " + error)`
  (原始碼為樣板字串)在 `assertNotRevoked()` 的 `catch` 內把它印出,隨後丟 401(fail-closed)。

⇒ **⛔ 不是真的連 DB、⛔ 不是真的缺表、⛔ 與本包(fix-login-contract)的變更無關**;
該行是 F35 安全行為**正在被測到**的證明,測試斷言 401 且通過。

⚠️ **附帶登記(據實,未查明)**:本人複驗落檔 `41-recheck-vitest.txt` 內 `grep -c` = **0**,
即該次落檔沒有這一行,與本人上述 4 次重跑不一致;
`10-vitest-run.txt` 則 `grep -c` = **1**。⛔ 該次落檔為何漏掉此行,**本人未查明**——
但不影響結論(兩份落檔與 4 次重跑的**測試結果一致:158 全過**),
且此差異純屬 log 擷取,⛔ 不涉程式行為。

⚠️ 本補述的複跑輸出**未落 `.evidence/`**:稽核指示⛔ 不得改動 `.evidence/` 內容(改了會與上表已定案的 24 份對不上)。
替代的耐久性來自**單一指令可穩定重現**(`npx vitest run tests/routes/auth.logout.test.ts`)
與**已入版控的源碼行**(測試 150–153、service 435)。

⚠️ 其餘各條(已變更檔案清單、兩 repo HEAD 未動、vitest 158、cargo 39、
`03-db-probe.txt` 的 `MYSQL_HOST` / `MYSQL_DATABASE` / `total=1` / `Q2=0` / `Q3=1`)
**本人重跑或重讀後與交辦描述相符**。

---

## 19. 守界聲明

- ✅ **只做了任務包「範圍」列的 6 項**(A / B / C / D / F / 契約鎖)+ 步驟 0 復現。
  ⛔ 未做丙案的「註冊禁 `@`」(D1 批甲不批丙),全 repo 無此實作與測試。
- ✅ **`CLAUDE.md` 只加了一條地雷**(登入識別 Email 優先兩段式),**錨點編輯、純新增 5 行、0 刪除**
  ⇒ ⛔ 未整份重寫。這一條是 plan-review 明文准做的。
- ✅ **界外六項全部 record-only、⛔ 一項未做**:f32-4 NR 代碼制、`accessControl` dead-code 隱患、
  `IUser.ts` 缺 `email` 欄位漂移、register 缺 `Cache-Control: no-store`、`scope` 欄位格式、
  `loginLimiter`(逐條見 §14)。
- ✅ ⛔ 未動 F35 的 logout / 撤銷 / fail-closed 邏輯;⛔ 未動 Splash / `validate_session` 導向流程;
  ⛔ 未改任何既有使用者資料(fixture 為自建自刪,淨零已核);⛔ 未動密碼 Lazy Migration 路徑
  (且以測試 A5 證明其仍走得到)。
- ✅ ⛔ 未更動 `.jscpd.json`、`.github/workflows/*`、`src/database/*.sql`。
- ✅ **本報告的量測值均為本人親自重跑**(§8 / §7 / §15 / §11.1 的 grep);
  改碼前的復現現場不可重建者,已明確標示為「引用落檔、本人未重跑」並附證據弱點(§4)。
- ✅ ⛔ 本人未寫、未改 `fix-login-contract-plan-review.md`,
  ⛔ 未建立或代填 `fix-login-contract-verification-audit.md`,⛔ 未代填任何架構師批覆或裁決結論。
- **carryover(留給後續)**:
  1. **production Q1–Q3 碰撞查核**(部署前置,§13.4);
  2. **真機 E2E 七步**(§17),含缺陷 B 的端到端證實與 `NYMLESS_API_BASE_URL` 澄清;
  3. **remote Actions 綠燈 + run 連結**(push 後補,§16);
  4. record-only 六項的後續立案(尤以 register 的 `Cache-Control: no-store` 與
     `accessControl` 隱患兩項建議優先);
  5. ✅ **`.evidence/` 已裁決並執行完畢**——⛔ 此項已結案,⛔ 非 carryover(保留紀錄供追溯)。
     **Yu 2026-08-31 逐字裁「.evidence/ 甲:加進 .gitignore」**,由主迴圈執行(⛔ 非實作側自行處置)。
     **主迴圈複驗**:`git check-ignore -v .evidence/` → `.gitignore:15:.evidence/`、exit 0 ⇒ 已被忽略;
     `git status --porcelain` 中 `.evidence/` 已消失。落檔仍留本機,本報告引用不受影響。
     ⚠️ 下方原始記錄為**裁決前**的現場,保留供追溯:
     **白話**:證據落檔資料夾現在是「會被 git 看見」的狀態,一旦 commit 就會**連同落檔一起進版控歷史**,
     之後要拿掉得改寫歷史。**本人實測**:
     ```bash
     git check-ignore -v .evidence/            # 無輸出,exit code = 1 ⇒ 未被忽略
     git status --porcelain | grep -i evidence # ?? .evidence/
     ```
     ⇒ 確認**未被忽略**且以未追蹤狀態存在。
     ⛔ **實作側未自行處置**——這是倉庫政策問題,已由 Yu 裁決。
     當時列出的三個方向:(a) 加進 `.gitignore` 只留本地;(b) 納入版控當可追溯證據;
     (c) 移到版控外的路徑。⇒ **Yu 選 (a)**,理由:落檔屬一次性取證輸出而非專案產物,
     且內含測試帳號 token,一旦進版控歷史即無法清除。
- ⛔ **尚未 commit / push,等待架構師確認。** 兩 repo HEAD 未動,變更全在工作區(§15)。
