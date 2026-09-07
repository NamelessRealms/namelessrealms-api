# 任務包:fix-login-contract 登入/註冊契約缺陷修復

> 協作 Claude 產出、直接寫入 repo `docs/tasks/fix-login-contract.md`。
> ⛔ **必須自我完備**:不得引用任何知識庫路徑或要求 Claude Code 去讀知識庫檔——
> 規劃文件的內容需要被知道時,直接抄進本包。違反此條責任在撰寫者。

## 追溯資訊
- **日期**:2026-08-31
- **動哪些 repo**:namelessrealms-api(主)+ Nymless(Rust 側 `src-tauri/src/nymless_api/auth.rs` 等;群內三 repo 契約變更走本專案流程,不算跨專案)
- **前置依賴**:F35(logout / refresh 撤銷)已驗收;本包不動撤銷邏輯
- **引用 spec 章節**:無 spec 切片;背景全部來自規劃側 2026-08-31 對兩 repo 的逐檔實查(檔案與行號錨點見下方「背景」)

## 目標

修復啟動器登入/註冊契約的一組缺陷,做完之後:
1. 使用者在登入頁輸入的身分識別,後端查得到(修復「登入頁對任何人皆不可用」的根因);
2. 註冊後的 session 與登入後的 session 行為一致(不再出現「註冊當下沒事、15 分鐘後 / 隔天全部 401」);
3. 註冊與登入兩條路徑簽發的 token 效期同源、回應結構對稱、JWT payload 的 `role` 型別一致;
4. 上述契約以測試鎖住(後端 vitest + Nymless wire contract tests),日後任一端漂移立即紅燈。

---

## 裁決點(⛔ 實作前必須有 Yu 批覆;批覆後回填下方「裁決結果」)

> 以下兩題規劃側**不自選**。白話版是主體,技術細節在「背景」一節。

### D1:登入要認什麼當帳號?

**白話**:現在登入畫面要你輸入 Email(輸入框也只給輸入 Email 格式),但後端收到後只拿去比對「使用者名稱」欄位——Email 永遠對不上使用者名稱,所以**每個人都會得到「帳號或密碼錯誤」**。要修哪一邊?

- **甲**:後端也認 Email——先用 Email 精確比對,查不到再用使用者名稱比對。前端不動,後端一上線舊版 app 立刻能登入。
  - 風險:有人可以把**使用者名稱**取成別人的 Email 字串,製造混淆(見背景 A-4)。
- **乙**:前端登入頁改成輸入「使用者名稱」。後端不動,但要出新版 app,舊版 app 依然全員登不進去。
- **丙**:甲 + 註冊時禁止使用者名稱含 `@`(把甲的混淆風險關掉)。已存在的舊帳號若使用者名稱含 `@` 不受影響(仍可用使用者名稱路徑登入)。

**建議:丙**。理由:甲的即效性(舊版 app 直接復活)+ 一行註冊驗證關掉混淆面;乙把修復綁在 app 發版上,且使用者心智模型(登入用 Email)是業界慣例,不值得逆著改。

### D2:`expires_in` 要不要改成 OAuth2 標準語意?

**白話**:登入回應裡「token 多久過期」這個欄位,標準規定要傳「還剩幾秒」,我們現在傳的是「到期的那個時間點」(毫秒時間戳)。前後端目前是**一致地不合標準**——配合得起來,只是違規。

- **甲**:本包**不改語意**。維持「絕對毫秒時間戳」,把這個內部契約寫進兩端註解、用測試鎖住;順手把註冊路徑也補上同語意的欄位(缺陷 D 本來就要補)。零相容風險。OAuth2 正規化留作日後獨立包。
- **乙**:兩端一起改成標準「剩餘秒數」。部署順序必須**後端先上**(新後端+舊 app 只是每次呼叫多一輪 refresh,軟性劣化;反過來舊後端+新 app 會算出永不過期,回到現在的病)。
- **丙**:另開新欄位(如 `expires_at_ms`)過渡,`expires_in` 標示棄用。

**建議:甲**。理由:本包是缺陷修復,目標是「讓人登得進來」;兩端現況一致,改語意徒增混版風險與部署順序約束。違規事實記錄在案,正規化另立包做(見「不做什麼」)。

### 裁決結果(主迴圈回填)
- **D1:甲**(2026-08-31,Yu 於主迴圈對話逐字批「1. 甲」)
  ⇒ 後端 `verify()` 改**兩段式查找:Email 精確比對優先,查無再比使用者名稱**;⛔ **不**加註冊禁 `@` 驗證(丙的那半未獲批)。
  ⚠️ 附帶影響(規劃側已知、Yu 選甲時一併承受):既有帳號若 `username` 恰好等於**他人**的 `email` 字串,
  該字串會被 Email 段先攔下,那個帳號將無法再用「使用者名稱」登入。⚠️ 上線前應查一次現有資料是否存在此碰撞,
  結果寫進 verification;⛔ 不得預設「不存在」。
- **D2:甲**(2026-08-31,Yu 於主迴圈對話逐字批「2. 甲」)
  ⇒ `expires_in` **維持絕對毫秒時間戳語意**,兩端加註解 + 測試鎖住;⛔ 本包不做 OAuth2 正規化。

---

## 範圍(只做這些)

⚠️ **Yu 已批 D1=甲 / D2=甲**(2026-08-31,見上「裁決結果」)。下列已依批覆收斂,⛔ plan 不得再擴回丙案:

1. **缺陷 A(根因)**:後端 `verify()` 身分查找改為「Email 精確比對優先,查無再比使用者名稱」(⛔ 兩段式,不用 `OR` 一把撈——理由見背景 A-4)。
   ⛔ **不**新增「使用者名稱不得含 `@`」驗證——D1 批甲不批丙,混淆面屬**已知並接受**的殘留風險,記錄於背景 A-4 與裁決結果。
2. **缺陷 B**:Nymless `auth.rs::register()` 改為與登入同路徑持久化——沿用 `persist_login_session()`(寫入 `expires_at`、`user.username`),不再只存兩個 token。
3. **缺陷 C**:後端 `registerUser()` 的 access token 效期改用 `environment.jwt.increaseTime`(與 `verify()` / `refreshAccessToken()` 同源),移除硬寫的 `"15m"`。
4. **缺陷 D**:後端 `register()` 回應補齊與 `login()` 對稱的欄位:`token_type` / `expires_in`(語意依 D2)/ `scope` / `info.username`(既有 `success` / `message` 欄位保留,舊客戶端不受影響)。
5. **缺陷 F**:統一 JWT payload 的 `role` 型別為字串陣列:`registerUser()` 改簽 `["user"]`(陣列,⛔ 不是 `JSON.stringify` 後的字串);`verify()` / `refreshAccessToken()` 加一層正規化(DB 值為字串則 parse、為 `NULL` 則 `[]`)。
6. **契約鎖**:
   - 後端:上述各條的 vitest 測試(成功路徑沿 `tests/routes/auth.logout.test.ts` 的 `vi.mock` Mysql 慣例,不連真 DB)。
   - Nymless:`auth.rs` 的 `wire_contract_tests` 補/改:register 回應新形狀、register 持久化行為所依賴的欄位、`expires_in` 語意鎖(依 D2)。
7. **實跑復現與復驗**:實作側開工第一步先實跑復現缺陷 A(見驗收步驟 0),修完後同路徑復驗。

## 不做什麼(明確守界)

- ⛔ **不動錯誤代碼制(f32-4 另包)**:即使驗證中看到錯誤代碼對不上(已知:登入失敗顯示 NR-1003、應為 NR-2002),**只記錄在 verification 報告、不修**。
- ⛔ **不做 OAuth2 `expires_in` 正規化**(D2=甲時;若 Yu 批乙/丙則納入)。同理**不動** `scope` 欄位格式(現回陣列,OAuth2 規定空白分隔字串;Rust 端整個忽略此欄,無實害,記錄即可)。
- ⛔ **不動 `accessControl`**:它目前**未掛在任何路由上**(全 repo grep 僅定義處)。已知潛在問題:`switch (request.user.role)` 對陣列值匹配不到任何 case 會直接放行——若日後掛載,持陣列 role 的一般使用者會**穿過 admin 守門**。本包把 payload 統一成陣列後此隱患仍在,屬 dead code,⛔ 不順手修,於 verification 報告記錄提醒。
- ⛔ 不動 `loginLimiter`(15 分鐘 10 次)。它會放大缺陷 A 的體感(登不進去→重試→429),但不是根因;修好 A 後正常使用不會撞到。
- ⛔ 不動 F35 的 logout / 撤銷 / fail-closed 邏輯。
- ⛔ 不動 Splash / `validate_session` 的啟動導向流程(自癒路徑是好的,留著)。
- ⛔ 不改既有使用者資料(不 backfill、不動 DB 既有列)。
- ⛔ 不動密碼 Lazy Migration 路徑(MD5→Argon2);缺陷 A 的修改在它**之前**的查找層,改完必須回歸確認該路徑仍走得到。

## 背景(規劃側 2026-08-31 實查,含檔案/行號錨點)

> 行號為 2026-08-31 當日快照,實作時以錨點文字為準。
> ⚠️ 下列全部為**檔案層**實查(Read/Grep);規劃側無 Bash,凡標「未實跑」者實作側必須實跑確認。

### A. 「登入頁對任何人皆不可用」——根因鏈(檔案層已閉合,未實跑)

1. **前端登入頁只收 Email**:`Nymless/src/pages/auth/Login.tsx` 55-62 行,帳號輸入框為
   `<input type="email" ... required>`,label 為 `t("auth:login.email")`;
   `Nymless/src/i18n/locales/zh-TW/auth.json` 的 `login.email` = 「電子信箱」。
   `type="email"` + `required` 使瀏覽器**擋掉非 Email 格式的送出**——想輸入使用者名稱也送不出去。
2. **呼叫鏈原樣透傳**:`Login.tsx handleLogin` → `src/services/auth.ts login()`(safeInvoke "login")→
   `src-tauri/src/commands.rs:222 login()` → `src-tauri/src/nymless_api/auth.rs:157 login()`,
   送出 body `{grant_type:"password", username:<使用者輸入的 Email>, password}`。中途**沒有任何 Email→使用者名稱的映射**。
3. **後端只比對使用者名稱**:`src/api/services/auth/auth.service.ts` `verify()` 52-55 行:
   ```ts
   const results = await Mysql.getPool().query(
     "SELECT * FROM users WHERE username = ?",
     [verifyData.username],
   );
   ```
   Email 對不上 `username` → 0 列 → 401「帳號或密碼錯誤。」(`InvalidCredentials`)。
   ⇒ **凡使用者名稱 ≠ Email 的帳號,登入必失敗**;而註冊頁(`createAccount`)是分開收使用者名稱與 Email 的,兩者相同者僅屬巧合。
4. **甲案的混淆風險(D1 用)**:`users` 表 `username` 與 `email` 各自 UNIQUE(`src/database/users.sql`),
   但**跨欄位不互斥**——攻擊者可把自己的 `username` 註冊成受害者的 Email 字串。
   若用單一 `OR` 查詢取第一列,查找結果依列序而非語意。因此甲/丙的實作要求:**兩段式查找,Email 精確比對優先**,⛔ 不用 `OR` 一把撈。
5. **已排除的方向**(主迴圈指定必查):
   - `NYMLESS_API_BASE_URL`:編譯期常數(`src-tauri/src/nymless_api/mod.rs` 71-74 行),未設環境變數時 fallback `http://localhost:8030`。程式面無誤;**實際發行 build 當時的環境變數值檔案層查不到**,⛔ 未實查——實作側復現時順帶確認(app 打得到後端即排除)。
   - `parse_api_error`(`src-tauri/src/nymless_api/http.rs`):401 正確映射為 `Unauthorized`,無吞錯。
   - `config.jwt.refreshSecret`:`src/config/config.service.ts` `_validateConfig()` 在啟動時缺 `JWT_REFRESH_SECRET` 直接 throw——伺服器根本起不來,不會是「登入 500」的成因;**部署環境是否真有設**檔案層查不到,實跑復現可一併排除。
   - `loginLimiter`(`src/api/middlewares/rateLimiters.ts`):15 分鐘 10 次,不會擋第一次登入;是放大器不是根因。

### B. 註冊後 session 半殘(檔案層確認;⚠️ 規劃側對主迴圈線索 2 的修正)

`Nymless/src-tauri/src/nymless_api/auth.rs` `register()`(112-148 行)成功時**只**呼叫
`set_nymless_access_token` / `set_nymless_refresh_token`,⛔ 沒設 `profiles.nymless_auth.expires_at`、⛔ 沒設 `profiles.user.username`(登入路徑的 `persist_login_session()`(191-216 行)兩者都設)。後果:

- `expires_at` 留 0 → `is_token_expired()`(380-389 行)視 0 為未過期 → `ensure_valid_access_token()` **在 app 存活期間永不刷新** → 註冊 15 分鐘後(access token 到期),所有需認證的 API 呼叫一路 401 直到重開 app。
- `user.username` 留空 → `get_nymless_username` 回 `None`,設定頁 / MainLayout 顯示不出使用者。

⚠️ **修正主迴圈的推斷**:「隔天開 app 就進不來」**不能**單由本缺陷解釋。檔案層追蹤:隔天開 app → `Splash.tsx` 呼叫 `validate_session()` → `/auth/validate` 401 → `refresh_nymless_token()` 以尚在效期(7 天)的 refresh token 換發成功 → `persist_login_session()` **把 `expires_at` 與 `username` 補寫回來** → 導向主畫面。即:**啟動時有自癒路徑**。完整解釋是複合的:
- 註冊後 **7 天內**:當日 15 分鐘後 session 內半殘(本缺陷),但隔天啟動應自癒;
- 註冊後 **7 天以上**(refresh token 過期)或自癒路徑任何一環實際失敗:被導回登入頁 → 撞上缺陷 A → **永久鎖死**。
⚠️ 以上為檔案層推導、未實跑;實作側復現時請驗證自癒路徑實際行為(驗收步驟 0-b)。

### C. 兩路徑 token 效期不同源(已確認)

- `auth.service.ts` `registerUser()` 236-239 行:`expiresIn: "15m"`(硬寫)。
- `verify()` 124-127 行與 `refreshAccessToken()` 299-302 行:`` expiresIn: `${environment.jwt.increaseTime}ms` ``。
- `src/environment/environment.common.ts`:`increaseTime: 600000`(= 10 分鐘)。
⇒ 註冊發的 token 活 15 分鐘、登入發的活 10 分鐘,且改 `increaseTime` 動不到註冊路徑。

### D. 註冊回應與登入回應不對稱(已確認)

- `auth.controller.ts` `register()` 351-356 行回 `{success, message, access_token, refresh_token}`——
  ⛔ 無 `token_type` / `expires_in` / `scope` / `info.username`。
- `login()`(password 與 refresh_token 兩分支,124-131 / 109-116 行)回
  `{access_token, token_type:"bearer", expires_in, scope, refresh_token, info:{username}}`。
- Nymless 端 `RegisterResponse`(auth.rs 57-61 行)目前只解 `access_token` / `refresh_token`;
  `LoginResponse`(47-55 行)的 `refresh_token` / `expires_in` 皆 `#[serde(default)]`,**後端加欄位對舊客戶端無破壞**(serde 忽略未知欄位)。
⇒ 補齊 D 之後,Nymless 的 `register()` 可直接以 `LoginResponse` 解析並復用 `persist_login_session()`(即缺陷 B 的修法),⛔ 不另寫一套持久化。

### E. `expires_in` 語意(已確認,兩端一致地違反 OAuth2;D2 裁決)

- `auth.controller.ts` 112 與 127 行:`expires_in: new Date().getTime() + environment.jwt.increaseTime` ——**絕對 epoch 毫秒**,非 OAuth2 的「剩餘秒數」。
- Nymless `persist_login_session()` 200 行直接存進 `nymless_auth.expires_at`;`is_token_expired()` 也以絕對毫秒解讀。
⇒ 兩端自洽。混版風險分析(D2 用):後端改「剩餘秒數」+舊 app ⇒ 舊 app 把 600 當 epoch 毫秒 → 永遠判過期 → 每次呼叫先走一輪 refresh(可用、變吵);舊後端+新 app ⇒ 新 app 把巨大時間戳當秒數 → 永不過期 → 重現缺陷 B 症狀。故若 D2=乙,**部署順序必須後端先上**。

### F. JWT payload `role` 型別漂移(已確認;現況為潛在、非現行事故)

- `registerUser()` 215 行 `const roles = JSON.stringify(["user"])`,228-233 行簽進 payload `role: roles` ——**字串** `'["user"]'`。
- `verify()` / `refreshAccessToken()` 簽 `role: user.roles` ——`users.roles` 欄位為 **JSON 型別**(`src/database/users.sql` 第 7 行,`DEFAULT NULL`),mysql2 對 JSON 欄位自動 parse 成 JS 陣列 ⇒ **陣列**;舊列可能為 `NULL`。
- 影響面:全 repo 只有 `authJwtVerify.accessControl`(119-124 行 `switch (request.user.role)`,比對 `"user"` / `"guest"` 字面)讀 `role`,且它**未掛載於任何路由**——現況無現行事故,但屬契約漂移,本包統一為字串陣列並加 `NULL→[]` 正規化。
- ⚠️ 檔案層查不到**線上 DB 的實際欄位型別**是否與 `users.sql` 一致(歷史遷移可能是 varchar)——實作側以 `SHOW COLUMNS FROM users` 實查一次,正規化層要同時容納「已是陣列 / JSON 字串 / NULL」三態。

### 附:相關既有慣例(抄錄,免翻找)

- 錯誤一律 `AppError(message, httpStatus, errorCode)`,由 `error.middleware.ts` 回 `{success:false, code, error, message}`;新路由/新驗證沿用,⛔ 不回框架純文字。
- 所有路由 handler 必包 `asyncHandler()`。
- 後端成功路徑測試慣例:`tests/routes/auth.logout.test.ts` 以 `vi.mock("../../src/api/utils/mysql", ...)` 攔連線池、依 SQL 片段分流回假資料,⛔ 不連真 DB。
- Nymless wire contract 測試:`auth.rs` 底部 `mod wire_contract_tests`,鎖請求 JSON 鍵名與回應反序列化形狀;本包改動 register 契約時**必須同步更新**,否則紅燈。

## 要建的模組 / 資源

無新模組。變更集中於:

| repo | 檔案 | 動什麼 |
|------|------|--------|
| api | `src/api/services/auth/auth.service.ts` | A(兩段式查找)、C(效期同源)、F(role 正規化 + 註冊簽陣列) |
| api | `src/api/controllers/auth.controller.ts` | D(register 回應補欄位;`expires_in` 語意依 D2) |
| api | `tests/routes/auth.routes.test.ts`(擴充)或新增測試檔 | 契約鎖 |
| Nymless | `src-tauri/src/nymless_api/auth.rs` | B(register 走 `persist_login_session`)、wire tests 更新 |
| Nymless | (僅 D1=乙/丙且需前端配合時)`src/pages/auth/Login.tsx` 等 | 依裁決 |

## 實作要點

- **A 的查找**:兩段式——先 `WHERE email = ?` 精確比對,無列再 `WHERE username = ?`。⛔ 不用 `OR` 單查(背景 A-4 的列序混淆)。查到後**原封走既有密碼驗證與 Lazy Migration 流程**,⛔ 不重寫該段。
- **B 的持久化**:讓 Nymless `register()` 把成功回應以 `LoginResponse` 解析、復用 `persist_login_session()`;`RegisterResponse` 結構體處置(刪除或保留)由 plan 決定,孤兒型別要清(只清自己造成的)。
- **F 的正規化**:單一 helper(如 `normalizeRoles(dbValue): string[]`)供 `verify()` / `refreshAccessToken()` 共用;三態容納見背景 F。
- **D2=甲時**:`expires_in` 的「絕對毫秒」語意在兩端各加一句註解言明,並在兩端測試各鎖一次(後端斷言值 > 當下 epoch;Nymless wire test 註明語意)。
- 新增/修改的後端驗證失敗一律 `AppError` 400/401,錯誤訊息風格沿既有中文文案。
- 非結構性變更,不需更新 CLAUDE.md 程式碼地圖;但 `verify()` 身分查找語意變更後,若 CLAUDE.md「地雷清單」需補一條(登入識別採 Email 優先),在 plan 中提出。
- 所有 exported/public 函數依規約補 JSDoc / `///`。

## 驗收步驟(正向 + 負向都要)

> 後端本地驗證需可連 MySQL 的 `.env`(dev 環境);純契約測試不連 DB。
> Nymless 側驗證在 `Nymless/src-tauri/` 跑 `cargo test --lib`(⚠️ 路徑含空格,cd 時加引號)。

0. **實跑復現(改碼前,必做)**:
   - a. 起後端(`yarn dev`),對既有帳號以 **Email** 打 `POST /oauth2/token`(`grant_type=password, username=<email>`),確認 401 `InvalidCredentials`;改用 **username** 打,確認 200。⇒ 證實根因 A。
   - b. (可做則做,做不到誠實標「待人工」)以真機 app 復現註冊→15 分鐘後 401、與隔天啟動自癒路徑,回填背景 B 的推導是否成立。
- 正向:
  - A:修後同一帳號以 Email 打 `POST /oauth2/token` → 200,回應含完整六欄位;以 username 打 → 仍 200(回歸)。
  - B+D:註冊新帳號 → 201 回應含 `token_type`/`expires_in`/`scope`/`info.username`;Nymless `cargo test --lib` 綠(wire tests 鎖新形狀);真機註冊後 `profiles.json` 的 `nymless_auth.expires_at` 非 0、`user.username` 非空。
  - C:解碼註冊路徑簽發的 access token(如 jwt.io 或測試內 `jwt.decode`),`exp - iat` = `increaseTime/1000` 秒(=600),與登入路徑一致。
  - F:三條簽發路徑(register/verify/refresh)的 token payload `role` 皆為 `["user"]` 型陣列(測試斷言 `Array.isArray`)。
- 負向:
  - A:Email 與 username 都查無 → 401 `InvalidCredentials`(結構化,非純文字)。
  - D2=甲:`expires_in` 斷言為「大於當下 epoch 毫秒」而非小整數(防止有人好心改成秒數、單邊破壞契約)。
  - 負向測試的還原一律用**備份檔**,⛔ 不用 `git checkout`(會清掉未 commit 的正式改動)。
- 審計:vitest 全綠(`npx vitest run`)、`yarn build` 過、`Nymless` `cargo test --lib` 綠;jscpd 門檻(3.7)未升。
- 回歸:
  - 既有 `tests/routes/auth.routes.test.ts` / `auth.logout.test.ts` 全綠(F35 撤銷行為未被波及)。
  - Lazy Migration:以 mock 驗證舊 MD5 帳號經 Email 查找路徑登入仍觸發升級寫回。
  - `POST /oauth2/token` `grant_type=refresh_token` 換發流程 200,回應形狀不變。
- git 對帳基準:**`origin/developers`**(⛔ 不是 main / master)。

## 流程提醒

1. 先落檔 `fix-login-contract-plan.md`,**等 `fix-login-contract-plan-review.md` 放行才實作**。⛔ D1 / D2 未有 Yu 批覆前,plan 不得對該兩題自行定案。
2. 實作完成產 `fix-login-contract-verification.md`(見 `verification_template.md`),不必等人要求;報告放本 repo(主 repo)`docs/tasks/`。record-only 事項(NR 代碼對不上、`accessControl` 陣列放行隱患、`scope` 格式)寫入報告「已知未修」節。
3. ⛔ **commit/push 前回報,待架構師確認**。本包任何措辭均不構成 push 預授權。
4. CI 措辭精確:local green + remote Actions 綠(附 run 連結)才算完成;真機做不到的步驟誠實標「待人工」,⛔ 不得以範本/預期值冒充已執行。
