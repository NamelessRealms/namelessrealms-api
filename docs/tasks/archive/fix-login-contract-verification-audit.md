# 稽核:fix-login-contract 驗收報告(`fix-login-contract-verification.md`)

> 稽核側 Claude 產出。稽核對象:`docs/tasks/fix-login-contract-verification.md`(37,221 bytes)。
> **⛔ 不信報告自述**:本報告的每一條數字均由稽核側**自行重跑一次**取得,⛔ 未轉抄驗收報告、
> ⛔ 未轉抄主迴圈派工訊息。與報告不符者一律**以本人實測為準**並附原始輸出。
> **⛔ 稽核側對現場唯讀**:全程只跑 `git log/status/diff/show/ls-remote/check-ignore`、`grep`、
> `yarn build`、`npx vitest run`、`npx jscpd`、`cargo test`;⛔ 未 checkout / reset / add / commit / push,
> ⛔ 未改動任何程式碼或報告,⛔ 未跑任何寫入型 SQL。
> ⛔ 任何措辭不構成 commit/push 預授權。

- **日期**:2026-08-31
- **稽核基準**:api `980b871`(工作區含未 commit 變更)、Nymless `196d936`(工作區含未 commit 變更)

---

## 稽核結論

**🔴 不通過(僅報告文字級,⛔ 不涉程式碼)**

白話講:**程式碼、測試、建置、重複率、git 對帳這五塊我全部自己重跑過,和報告寫的一模一樣,沒有一項灌水。**
不通過的原因只有兩件事,而且都在**報告的文字裡**,不在程式裡:

1. 報告把證據份數寫成 **23 份 / 新增 6 份**,實際是 **24 份 / 新增 7 份**(`40`–`46` 是 7 個檔,不是 6 個)。
2. 報告 §18 說「那行 `ER_NO_SUCH_TABLE` 我重跑沒出現」——**我重跑就出現了**。
   而且我把原因查出來了:那是 F35 自己的測試**故意丟**的假錯誤,⛔ 不是真的連到資料庫,⛔ 沒有風險。

另外有一件事要**交回規劃側裁決**(⛔ 不是我能判的):報告 §4 那組「改碼前復現」的證據,
它自己承認請求 body 沒落檔——我查證後確認**它承認得對**,那三條替代佐證**每一條都真的成立,
但合起來仍不足以證明「同一個密碼」**。⛔ 這不影響「缺陷 A 的根因」這個結論本身(根因另有更硬的證據,見 §獨立抽查 #18),
只影響「復現」這兩個字的措辭強度。

---

## 獨立抽查(24 組,逐組記核對方式與實測結果)

### A. 建置 / 測試 / 重複率(全部由稽核側重跑)

| # | 核對對象 | 報告聲稱 | 稽核側實跑指令與實測 | 結果 |
|---|---|---|---|---|
| 1 | `yarn build` | `Done in 2.67s` / `BUILD_EXIT=0` | `yarn build` → `Done in 3.40s.` / `BUILD_EXIT=0` | ✓ 相符(綠燈與 exit code 一致;耗時本來就每次不同,報告已註明只引本人量值) |
| 2 | vitest 全庫檔數 | Test Files 20 passed (20) | `npx vitest run` → `Test Files  20 passed (20)` | ✓ 相符 |
| 3 | vitest 全庫測試數 | Tests 158 passed (158) | 同上 → `Tests  158 passed (158)` | ✓ 相符 |
| 4 | vitest exit code | `VITEST_EXIT=0` | `npx vitest run > /dev/null 2>&1; echo $?` → `VITEST_EXIT=0` | ✓ 相符 |
| 5 | 新測試檔單跑 | 1 passed (1) / 15 passed (15) | `npx vitest run tests/routes/auth.login-contract.test.ts` → `Test Files  1 passed (1)` / `Tests  15 passed (15)` | ✓ 相符 |
| 6 | 新測試檔條數與代號 | 15 條(A1–A5 / C1–C2 / D1–D3 / F1 / F2a–F2d) | `grep -nE "^\s*(it\|describe)\(" tests/routes/auth.login-contract.test.ts` → 5 個 describe + **15 個 it**,代號逐字為 A1–A5、C1、C2、D1–D3、F1、F2a–F2d | ✓ 相符 |
| 7 | 新測試檔行數 | 317 行 | `wc -l` → `317` | ✓ 相符 |
| 8 | jscpd 版本 pin | `npx jscpd@5.0.14` | 本人以 `npx jscpd@5.0.14 --reporters console` 重跑(⚠️ 只換 reporter 以避免寫檔動到現場,⛔ 未動 `format`/`path`/`minLines`/`minTokens`/`ignore`,不影響百分比) | ✓ 相符 |
| 9 | jscpd 各項數字 | 79 檔 / 9456 行 / 43735 tokens / 30 clones / **314 行 = 3.32%** | 實測逐字:`typescript │ 79 │ 9456 │ 43735 │ 30 │ 314 (3.32%) │ 2189 (5.01%)` | ✓ 相符 |
| 10 | jscpd exit code | `JSCPD_EXIT=0` | `npx jscpd@5.0.14 --reporters console > /dev/null 2>&1; echo $?` → `JSCPD_EXIT=0` | ✓ 相符 |
| 11 | 門檻 3.7 且 `.jscpd.json` 未動 | threshold 3.7,⛔ 未更動任何欄位 | `cat .jscpd.json` → `"minLines": 5, "minTokens": 50, "threshold": 3.7`;`git diff --stat .jscpd.json .github/ src/database/` → **無輸出** | ✓ 相符(3.32% < 3.7) |
| 12 | Nymless `cargo test --lib` | 39 passed; 0 failed; 0 ignored | `cd "../Nymless/src-tauri" && cargo test --lib` → `test result: ok. 39 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` | ✓ 相符 |
| 13 | `auth::wire_contract_tests` 改後 10 條 | 10 條 | 自輸出逐條數 `nymless_api::auth::wire_contract_tests::*`:`expires_in_is_absolute_epoch_millis` / `link_minecraft_request_keys` / `refresh_token_request_keys` / `logout_request_keys` / `register_request_keys` / `login_request_matches_oauth2_password_contract` / `register_added_fields_do_not_break_old_clients` / `login_response_tolerates_missing_optionals` / `login_response_deserializes_backend_payload` / `register_response_deserializes_as_login_response` = **10** | ✓ 相符 |
| 14 | 改前 7 條(+3) | plan-review 記錄改前 7 條 | 本人不靠 plan-review,直接 `git show origin/main:src-tauri/src/nymless_api/auth.rs \| awk '/mod wire_contract_tests/,0' \| grep -E "^\s*fn "` → **7 個** test fn;工作區同法 → 11 個(其中 `register_success_payload` 為 helper,非 `#[test]`)⇒ **7 → 10,+3** | ✓ 相符 |

### B. git 三步對帳(⚠️ 遠端一律 `git ls-remote origin`,⛔ 不看本機 `origin/*` 快照)

| # | 核對對象 | 報告聲稱 | 稽核側實測 | 結果 |
|---|---|---|---|---|
| 15 | api HEAD = 遠端 developers | `980b871` = `origin/developers` | `git ls-remote origin developers` → `980b87106f5bcfcf4a211a4c659f46d6f035ff0e	refs/heads/developers`;`git rev-parse HEAD` → `980b87106f5bcfcf4a211a4c659f46d6f035ff0e` | ✓ 相符 |
| 16 | Nymless ⛔ 無 `developers` 分支 | 只有 `main`,故改用 `origin/main` | `git ls-remote --heads origin`(Nymless)→ **只有一行** `196d9369c890820291a814e58d8a0107be86c106	refs/heads/main`;`git ls-remote origin developers` → **無輸出**;`git branch -a` → `* main` / `remotes/origin/main` | ✓ 相符(§18 #4 的自述屬實) |
| 17 | Nymless HEAD = 遠端 main | `196d936` = `origin/main` | `git rev-parse HEAD`(Nymless)→ `196d9369c890820291a814e58d8a0107be86c106`,與上列 ls-remote 一致 | ✓ 相符 |
| 18 | 兩 repo 皆未 commit | 變更全在工作區 | api `git status --short` 與報告 §15.1 貼出的清單**逐行相同**(另多一筆 `?? docs/tasks/fix-login-contract-verification.md`,即報告自己,報告已預告);Nymless `git status --short` → ` M src-tauri/src/nymless_api/auth.rs` + `?? .claude/commands/`;`git log --oneline origin/<分支>..HEAD` 兩 repo皆空 | ✓ 相符 |
| 19 | diff 規模 | api `7 files changed, 95 insertions(+), 17 deletions(-)`;Nymless `1 file changed, 82 insertions(+), 14 deletions(-)` | `git diff --stat origin/developers` → `7 files changed, 95 insertions(+), 17 deletions(-)`(`CLAUDE.md 5 ++`、`auth.controller.ts 11 ++-`、`auth.service.ts 96 ++++`、四筆 f35 為 rename 0 變更);Nymless `git diff --stat origin/main` → `1 file changed, 82 insertions(+), 14 deletions(-)` | ✓ 相符 |

> ⚠️ **方法上的一點差異(⛔ 非不符)**:報告 §15 與 `45-recheck-git.txt` 用的是 `git rev-parse HEAD origin/developers`,
> 那是**本機遠端追蹤快照**,理論上可能過期。本人改以 `git ls-remote origin` 直接問遠端,**結論相同**。
> ⇒ 報告的結論成立,但取證方法建議日後改用 `ls-remote`。

### C. 裁決一致性(⛔ 核對實際程式碼,不核對報告怎麼寫)

| # | 裁決條文 | 稽核側實測(讀 `git diff` 的實碼) | 結果 |
|---|---|---|---|
| 20 | **D1 甲**:兩段式查找、Email 優先 | `src/api/services/auth/auth.service.ts` 實碼:先 `"SELECT * FROM users WHERE email = ?"`,`let users = emailResults[0]` | ✓ 相符 |
| 21 | **D1 甲**:Email 段命中即定案、⛔ 不 fall through | 第二段查詢**整段包在** `if (users.length === 0) { … "SELECT * FROM users WHERE username = ?" … }` 內 ⇒ Email 段有列時**結構上不可能**發出第二段;密碼比對在其後,失敗即 throw。測試 A4 實碼斷言 `expect(findQuery("FROM users WHERE username = ?")).toBeUndefined()` | ✓ 相符 |
| 22 | **D1 甲**:⛔ **不**加註冊禁 `@` | `grep -rn "includes(\"@\")\|indexOf('@')\|includes('@')\|不得含\|/@/" src/ tests/` → **無任何命中** | ✓ 相符(丙案確實未做) |
| 23 | **D2 甲**:`expires_in` 維持絕對毫秒、⛔ 不做 OAuth2 正規化 | `auth.controller.ts` 三處皆為 `expires_in: new Date().getTime() + environment.jwt.increaseTime`,各配一條「⚠️ 絕對 epoch 毫秒,⛔ 不是 OAuth2 的『剩餘秒數』」註解(refresh 分支 / password 分支 / register);Nymless `persist_login_session()` 亦補同語意註解;⛔ 全 diff 無任何秒數換算 | ✓ 相符 |
| 24 | **D2 甲**:測試鎖住 | 後端 D2/D3 斷言絕對毫秒;Rust `expires_in_is_absolute_epoch_millis` 實碼存在且在 39 條中通過 | ✓ 相符 |

### D. 守界聲明(⛔ 自行 grep 查證,不看報告自述)

| # | record-only 項目 | 稽核側實測 | 結果 |
|---|---|---|---|
| 25 | `f32-4` NR 代碼制未改 | `grep -n "NR-1003\|NR-2002" ../Nymless/src/i18n/errorCodes.ts` → `26:  APIInteractingError: "NR-1003",` / `30:  InvalidCredentials: "NR-2002",`;Nymless `git status --short` 僅 `auth.rs` ⇒ `errorCodes.ts` **未動** | ✓ 未做,相符 |
| 26 | `accessControl` dead-code 未改 | `grep -rn "accessControl" src/` → **僅 2 命中**:`src/api/middlewares/authJwtVerify.ts:7`(檔頭 doc)、`:109`(定義處),**無路由掛載**;`git diff --stat src/api/middlewares/` → 無輸出 | ✓ 未做,相符 |
| 27 | `IUser.ts` 缺 `email` 未補 | `cat src/interface/auth/IUser.ts` → 僅 `id / unique / username / password / roles` 五欄,**無 `email`**;`git diff --stat src/interface/` → 無輸出 | ✓ 未做,相符 |
| 28 | register 缺 `Cache-Control` 未補 | `grep -n "Cache-Control" src/api/controllers/auth.controller.ts` → **僅 1 命中**(`101:` login 分支);`grep -ci "cache-control" .evidence/fix-login-contract/08-postfix-register.txt` → **0**(201 回應標頭確實不含) | ✓ 未做,相符 |
| 29 | `scope` 格式未改 | 實碼 `scope: verifyData.role` / `refreshData.role` / `verifyData.role`,`role` 經 `normalizeRoles()` 為**陣列**;`07`/`09` 落檔實測 `scope: ["user"]` | ✓ 未做,相符(仍為陣列,非 OAuth2 空白分隔字串) |
| 30 | `loginLimiter` 未改 | `grep -rn "loginLimiter" src/` → `rateLimiters.ts:5,12,36`、`auth.routes.ts:11,23`、`auth.service.ts:101`(僅註解提及);`git diff --stat src/api/routes/ src/api/middlewares/` → 無輸出 | ✓ 未做,相符 |
| 31 | `.jscpd.json` / `.github/workflows/*` / `src/database/*.sql` 未動 | `git diff --stat .jscpd.json .github/ src/database/` → **無輸出** | ✓ 未做,相符 |
| 32 | `CLAUDE.md` 只加一條、錨點編輯 | `git diff CLAUDE.md` → **純新增 5 行、0 刪除**,插在既有 logout 條目之後,新增內容為「登入識別採 Email 優先的兩段式查找」 | ✓ 相符 |

### E. 產物重建

| # | 核對對象 | 稽核側實測 | 結果 |
|---|---|---|---|
| 33 | TS 有原始碼變更 → 已 `yarn build` 重建 | 本人自跑 `yarn build`(`BUILD_EXIT=0`)後查產物:`dist/api/services/auth/auth.service.js` 時戳 `Aug 31 23:18`,`grep -c "FROM users WHERE email = ?"` → **1**、`grep -c "normalizeRoles"` → **3**;`dist/api/controllers/auth.controller.js` `grep -c "token_type"` → **4** ⇒ 產物確實含本包新碼 | ✓ 相符 |
| 34 | 無 schema / migration 變更 | `git diff --stat src/database/` → 無輸出;`git status --short` 無任何 `.sql` ⇒ **無建表、無 F35 那種順序地雷** | ✓ 相符 |

### F. 誠實條款 / 待人工的真實性

| # | 核對對象 | 稽核側實測 | 結果 |
|---|---|---|---|
| 35 | 碰撞查核跑的是 dev | `46-recheck-db-probe.txt` 逐字:`NODE_ENV=development` / `MYSQL_HOST=localhost` / `MYSQL_DATABASE=namelessrealms` / `server_version 5.7.44` / `total: 1` | ✓ 相符,DB 標註義務已盡 |
| 36 | Q1/Q2/Q3 數字 | 同檔逐字:Q1 `[]`、`cross_account_collisions: 0`、`same_account_username_equals_email: 1`、`total: 1` | ✓ 相符 |
| 37 | ⛔ 未以 dev 的 0 清掉此項 | 報告 §7.3 逐字寫「**dev 全庫只有 1 筆使用者,`Q2 = 0` 不具代表性**」「⛔ **不得**以 dev 的 0 判定『附帶影響的受害者為 0』」「production Q1–Q3 列為部署前置」;§12 第 1 項、§13.1 步驟 0、§19 carryover 1 三處重申 | ✓ 相符,⛔ 未清掉 |
| 38 | production SQL 可執行且附了 | §13.4 附 4 條完整 `mysql -h <HOST> -u <USER> -p <DB> -e "…"`,含「`-p` 後不接密碼」的說明與「Q2 > 0 即停」判讀 | ✓ 相符 |
| 39 | `users.roles` 型別 / collation | `46` 逐字:`roles` `Type: "json"`;mysql2 讀回 `js_type: "object"` / `is_array: true`;`username`/`email`/`unique` 皆 `utf8mb4_general_ci` | ✓ 相符 |
| 40 | fixture 淨零 | `04`:`BEFORE users COUNT(*) = 1` / `repro-prefixed rows = 0` → `AFTER-INSERT = 2` / `1`;`13`:`AFTER-CLEANUP: users=1` / `NOW repro-prefixed rows = 0`;本人 `46` 實測 `total: 1` ⇒ 起 1 迄 1,專用前綴列 0 | ✓ 相符(⚠️ 見下方「報告更正」#3 的小註) |
| 41 | 真機 E2E 完全未跑、⛔ 未以推理冒充 | `grep -rln "profiles.json" .evidence/` → **exit 1,零命中**;報告 §4 步驟 0-b 標「⛔ **未執行 → 待人工**」、§12 第 2 項標「**待人工**」並逐字寫「`.evidence/` 內**無任何 `profiles.json` 證據**」、§17 七步全欄「**待人工**」、§6.2 逐字聲明第二條是「舊形狀 struct 吃新 payload,**不是跑舊版 binary**」 | ✓ 相符,**誠實標記,⛔ 無冒充** |
| 42 | 證據耐久性(稽核鐵則 7) | §8 全部數字對 `.evidence/40`–`46` 落檔;§4/§5 對 `00`–`13` 落檔;伺服器 log 亦為落檔(`00`/`05`),⛔ **未見任何以 `docker logs`、執行中容器狀態為來源的證據** | ✓ 相符 |
| 43 | remote Actions | 兩 repo `git ls-remote` 皆無新 ref、`origin..HEAD` 皆空 ⇒ 確實未 push,**確實無 run 可附**;報告 §16 逐字寫「**local green,remote Actions 未跑**」「⛔ 不得把本地綠燈當成『CI 通過』」 | ✓ 相符(⚠️ 但收案標準未達,見下方「必改」#3) |
| 44 | `.evidence/` 是否被 gitignore | `git check-ignore -v .evidence` → **exit 1(未被忽略)** | ✓ 相符 |

---

## ⛔ 必改(收案前修正)

### 1. 證據份數寫錯:報告說 23 份 / 新增 6 份,實際 24 份 / 新增 7 份

報告開頭逐字:

> - **證據目錄**:`.evidence/fix-login-contract/`(共 **23** 份;`00`–`31` 為前一個 agent 落檔 17 份,
>   `40`–`46` 為本人複驗新增 6 份)

§18 第 2 列逐字:

> 目錄原有 **17** 份 ✅;加上本人複驗新增 6 份 ⇒ 現為 **23** 份

**稽核側實測原始輸出**:

```
=== total files ===
      24
=== 00-31 (previous agent) ===
      17
=== 40-46 (this agent) ===
40-recheck-yarn-build.txt
41-recheck-vitest.txt
42-recheck-vitest-login-contract.txt
43-recheck-jscpd.txt
44-recheck-cargo-test.txt
45-recheck-git.txt
46-recheck-db-probe.txt
7
```

`40`–`46` 是**閉區間 7 個檔**,不是 6 個。17 + 7 = **24**。
**修法**:上述兩處 `23` 改 `24`、`6` 改 `7`。⛔ 不涉程式碼。

### 2. §18 第 3 列的觀察與現場不符:`ER_NO_SUCH_TABLE` 那行,我重跑**有**出現

報告 §18 第 3 列逐字:

> **本人重跑未出現該行**;兩次皆 158 全過 … **差異已記錄,原因⛔ 未查證**

**稽核側實測原始輸出**(`npx vitest run`,2026-08-31 23:18):

```
 RUN  v4.1.8 /Users/quasi-pc/Desktop/Projects/Nameless Realms/namelessrealms-api

[2026-08-31 15:18:26] ERROR: Refresh token revocation check failed: Error: ER_NO_SUCH_TABLE: Table 'revoked_refresh_tokens' doesn't exist
[2026-08-31 15:18:26] INFO: User [someone] password has been migrated to Argon2.

 Test Files  20 passed (20)
      Tests  158 passed (158)
```

⇒ 報告把「這一次沒印出來」寫成了穩定觀察,**與現場不符**。

**且原因我已查證(⛔ 不需留到收案後)**——它**不是**真的連資料庫,是 F35 自己的測試**故意丟**的:

`tests/routes/auth.logout.test.ts:150-153` 實碼:

```ts
  it("撤銷表查詢失敗（如表不存在）時 fail-closed 回 401，⛔ 不放行", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM revoked_refresh_tokens")) {
        throw new Error("ER_NO_SUCH_TABLE: Table 'revoked_refresh_tokens' doesn't exist");
```

該字串經 `src/api/services/auth/auth.service.ts:435` 的 `logger.error(...)` 原樣印出。
**單跑該檔即穩定重現**(稽核側實跑 `npx vitest run tests/routes/auth.logout.test.ts`):

```
[2026-08-31 15:18:51] ERROR: Refresh token revocation check failed: Error: ER_NO_SUCH_TABLE: Table 'revoked_refresh_tokens' doesn't exist

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

⇒ **這是 mock 丟出的假錯誤,⛔ 沒有任何真實 DB 連線,⛔ 不構成風險,⛔ 不需收案前另查。**
全庫跑時忽有忽無,是 vitest console reporter 在多檔平行輸出下的呈現差異,⛔ 不是測試行為不穩定
(三次全庫執行皆 `158 passed`、`VITEST_EXIT=0`)。

**修法**:§18 第 3 列改為「原因已查證:來自 `tests/routes/auth.logout.test.ts:150-153` 的
`poolQuery.mockImplementation` 刻意 throw(F35 fail-closed 測試),經 `auth.service.ts:435` 的
`logger.error` 印出;⛔ 非真實 DB 連線,⛔ 無風險。全庫跑時的有無差異為 reporter 呈現層面」。
⛔ 不得再寫「原因未查證」。

### 3. 收案標準形式上未達:remote Actions 未跑(⚠️ 這一項是**事實登記**,非報告錯誤)

依 `CLAUDE.md`「驗收與產物重建紀律」:**收案 = local green + remote Actions 綠(附 run 連結)**。
稽核側實測:兩 repo `git ls-remote` 無新 ref、`git log --oneline origin/<分支>..HEAD` 皆空 ⇒ **確實未 push**。
報告 §16 已誠實標明並列入 carryover 3。

⇒ **⛔ 這不是報告的過失**(未 push 是等 Yu 裁決的結果),但**收案標準形式上尚未滿足**。
是否以「待 push 後補 run 連結」的條件收案,**是規劃側 / Yu 的裁決,⛔ 不是稽核側能判的**。

---

## 交回規劃側判讀(⛔ 稽核側只陳述事實,不判斷要不要緊)

### §4 復現證據:報告自承的弱點**屬實**,且其列出的三條替代佐證**個別成立、合起來仍不足**

報告 §4 逐字自承:

> ⚠️ **證據弱點(據實記錄)**:`01`/`02` 只 tee 了 **HTTP 回應**,**請求 body 未落檔**;
> 「同一密碼」這一點無法從落檔獨立佐證,標籤(`== A) login by EMAIL ==`)是執行腳本自產的。

**稽核側逐條查證它列的三條替代佐證**:

| 替代佐證 | 實測 | 是否成立 | 能證到哪裡 |
|---|---|---|---|
| 401 → 200 的狀態差 | `01` 首行 `HTTP/1.1 401 Unauthorized`、`02` 首行 `HTTP/1.1 200 OK` | ✓ 成立 | ⛔ **證不到**「A 送的是 Email」——改碼前後端對「查無此人」與「密碼不符」回**逐字相同**的 401 body(`Content-Length: 138`,兩者 ETag 亦同為 `W/"8a-wXPw1CZNBQwFGa5x2mDxQvXtOdU"`) |
| 回應 `sub` 指向 fixture | `02` 的 JWT 解出 `"sub":"repro-fix-login-contract-u1"`、`"username":"repro-fix-login-contract-name"`,與 `04` 的 fixture 一致 | ✓ 成立 | 只證得到 **B(200 那發)**的身分;⛔ **對 A(401 那發)零資訊** |
| 伺服器 log 逐秒吻合 | `00-server-start-prefix.log` 實測 `04:16:30 … "url": "/oauth2/token" … "status": 401` 與 `04:16:35 … "status": 200`,與 `01`/`02` 的 `Date` 標頭吻合 | ✓ 成立 | log **只記 method + url + status**,⛔ **不記 body** ⇒ 證不到送了什麼 |

**稽核側另外找到的、報告沒列的兩條佐證**(對報告有利,一併記錄):

1. `01` 的 `RateLimit: limit=10, remaining=9, reset=900` 與 `02` 的 `RateLimit: limit=10, remaining=8, reset=895`
   ⇒ 兩發是**同一 limiter 視窗、同一 client、相隔 5 秒的連續兩次**,確為一次腳本執行。
2. 改碼**後**的 `06` 段 A 與段 B 回傳**逐字相同的 access_token 與 refresh_token**(同一 `iat` = 1788150087),
   ⇒ 兩發打的確實是**同一個帳號**。

**結論(交規劃側)**:即使加上這兩條,**仍沒有任何耐久落檔能證明 A 那發送的是 Email、且密碼與 B 相同**。
⇒ 報告 §0 的措辭「**已在 dev 實跑復現(同一帳號同一密碼:Email 打 → 401、使用者名稱打 → 200)**」
其中「同一密碼」與「Email 打」兩點,**⛔ 只有腳本自產標籤為據,⛔ 無獨立佐證**。

⚠️ **但「缺陷 A 根因已成立」這個結論本身,⛔ 不依賴這組復現**——稽核側另查到更硬的機器可核事實:

```
=== pre-change verify() SQL (origin/developers) ===
    // 1. 先根據使用者名稱搜尋使用者 (不再直接在 SQL 比對密碼，為了實作 Lazy Migration)
    const results = await Mysql.getPool().query(
      "SELECT * FROM users WHERE username = ?",
=== grep email in pre-change service ===
53:      "SELECT * FROM users WHERE username = ?"
182:      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND expires_at > NOW()"
198:      "SELECT * FROM users WHERE username = ? OR email = ?"
249:      "DELETE FROM verification_codes WHERE email = ?"
282:      "SELECT * FROM users WHERE `unique` = ?"
```

改碼前的 `verify()`(`origin/developers` 版)**全函式只有一發 `WHERE username = ?`,⛔ 無任何 email 路徑**
(第 198 行的 `OR email` 在 `registerUser()` 的重複檢查,不在 `verify()`)。
配合 `04` 的 fixture(`username=repro-fix-login-contract-name`、`email=repro-fix-login-contract@example.test`,兩者**刻意不同**),
**「username ≠ email 的帳號用 Email 登入必然 0 列 ⇒ 必然 401」是程式碼結構上的必然,⛔ 不是機率推論。**
再加上契約測試 A1/A2 與改後 `06` 段 A 的 200,根因鏈完整。

⇒ **要規劃側裁決的只有一件事**:報告 §0 / §4 的「實跑復現(同一帳號同一密碼)」這個**措辭強度**是否需要下修
(例如改為「復現腳本已跑,狀態差已落檔;⚠️ 請求 body 未落檔,『同一密碼』僅有腳本標籤為據,
根因另由改碼前原始碼與契約測試 A1/A2 獨立成立」)。
**⛔ 現場已不可重建**(fixture 已刪、程式已修),⇒ **補證據這條路已封死,只剩改措辭或原樣接受兩個選項。**

---

## 報告更正(文字級,隨修正一併更新 verification)

1. 開頭「共 **23** 份 … 新增 **6** 份」→ **24 份 / 7 份**(實測見必改 #1)。
2. §18 第 2 列「⇒ 現為 **23** 份」→ **24 份**;該列「新增 6 份」→ **7 份**。
3. §4 引用 `13-fixture-cleanup.txt` 時以 `…` 略去了中間兩行,原始落檔逐字為
   `BEFORE-CLEANUP: users=3 …` / `deleted users=2 …`(3 = fixture + §5 註冊測試新建的那筆)。
   ⚠️ **淨零結論不受影響**(起 1 迄 1、專用前綴列 0,本人 `46` 實測 `total: 1` 佐證),
   但建議把被省略的 `users=3 / deleted=2` 補進去,免得日後複驗者對不上 `2 → 1` 的差額。
4. §18 第 3 列改寫(見必改 #2)。
5. §15 / §45 落檔的遠端對帳建議改用 `git ls-remote origin <分支>`(現用 `git rev-parse origin/<分支>` 為本機快照)。
   ⚠️ **本次結論經本人 ls-remote 複核為真**,此項僅為取證方法建議。

---

## 追認(實作偏離之處;均說明為何認可)

1. **`expires_in` 表達式在 controller 出現第三次而未抽 helper** —— 追認。
   稽核側實測 `npx jscpd@5.0.14` 為 **3.32% < 3.7**,且該處為單一運算式(`minLines: 5` 不觸發),
   語意由 D2/D3 + Rust `expires_in_is_absolute_epoch_millis` 三條測試鎖住 ⇒ 撰碼規約 C 的例外成立。
2. **Nymless 刪除 `RegisterResponse` 結構體、舊形狀相容性改由測試留證** —— 追認。
   實碼確認 `LegacyRegisterResponse` 只定義在 `mod wire_contract_tests` 內,⛔ 生產碼無孤兒型別,
   且 `cargo test --lib` 39 條全過含該條。
3. **Nymless 對帳基準改用 `origin/main`** —— 追認。
   `git ls-remote --heads origin` 實測該 repo **只有 `refs/heads/main` 一個分支**,⛔ 無 `developers` 可用。

---

## carryover 對號

- **C-1** production Q1–Q3 碰撞查核(部署前置,SQL 見 verification §13.4;⛔ Q2 > 0 即停)。
- **C-2** 真機 E2E 七步(verification §17),含缺陷 B 的 `profiles.json` 端到端證實
  (稽核側實測 `.evidence/` 內**零命中**,確為未跑)與 `NYMLESS_API_BASE_URL` 澄清。
  ⚠️ 稽核側複核 §11.1:`grep -rn "NYMLESS_API_BASE_URL"`(排除 node_modules/target)命中全落在文件、
  `src-tauri/src/nymless_api/mod.rs:71` 的 `option_env!` 定義與各 `format!` 使用處,
  **repo 內確無 build 設定注入此變數** ⇒ 報告標「待人工(僅 Yu 知悉)」**屬實,⛔ 未冒充實查**。
- **C-3** remote Actions 綠燈 + run 連結(push 後補;⚠️ 收案標準形式上依賴此項,見必改 #3)。
- **C-4** record-only 六項後續立案(稽核側逐項 grep 確認**一項未做**,見抽查 #25–#30)。
- **C-5**(稽核側新增)`.evidence/` 目前**未被 gitignore**(`git check-ignore` exit 1),
  是否納入版控尚未裁決 —— 一旦 commit 會把 23 KB 落檔帶進歷史,建議 Yu 明確裁一次。

---

## 修畢後的回報格式

- 貼:更正後的 verification 段落清單(預期為開頭證據份數、§4 引用補全、§18 第 2/3 列),
  以及規劃側對「§4 措辭強度」的裁決結論。
- ⛔ 本稽核**未改動任何程式碼、未改動 verification、未 `git add` / commit / push**;
  兩 repo 工作區狀態與稽核開始時一致。
- ⛔ **commit/push 仍待 Yu 確認。**

---
---

# 複稽(第二輪,2026-08-31)

> 觸發:實作側回報兩條必改已改正 + 主迴圈執行 Yu 的 `.evidence/` 裁決。
> ⛔ **本輪同樣全部自行實跑,⛔ 未採信協調者轉述的任何數字。**
> ⛔ 現場唯讀:除本檔外未動任何檔案,⛔ 未 `git add` / commit / push。

## 複稽結論

**✅ 通過(兩條必改確實改正;`.gitignore` 變更在範圍內且無夾帶)**

---

## 一、必改 #1(證據份數 23/6 → 24/7):✅ 已改正

| 核對點 | 稽核側實測指令與輸出 | 結果 |
|---|---|---|
| 全檔是否殘留 `23 份` / `6 份` | `grep -n "23 份\|新增 6\|6 份\|共 \*\*23" docs/tasks/fix-login-contract-verification.md` → **grep exit=1,零命中** | ✅ 無殘留 |
| 開頭已改 24 | 第 11 行逐字:``- **證據目錄**:`.evidence/fix-login-contract/`(共 **24** 份;`00`–`31` 為前一個 agent 落檔 17 份,`40`–`46` 為本人複驗新增 7 份)`` | ✅ 相符 |
| §18 第 2 列已改 | 第 559 行含「新增 **7** 份(`40`–`46` 為閉區間)⇒ 現為 **24** 份」,並註明「本報告初版誤寫 6 / 23…稽核抓出,已於 2026-08-31 更正」 | ✅ 相符,且**留下更正痕跡**(⛔ 未偷改) |
| 實際檔數 | `ls -1 .evidence/fix-login-contract \| wc -l` → **24** | ✅ 相符 |

⚠️ **與協調者轉述不符之處(以本人實測為準)**:協調者稱報告為「553 → 635 行」,
本人 `wc -l docs/tasks/fix-login-contract-verification.md` 實測為 **644 行**。
⇒ ⛔ 非缺陷,僅登記本人量到的數字。

## 二、必改 #2(§18-3 由「原因未查證」改為「已查證結案」):✅ 已改正

| 核對點 | 稽核側實測 | 結果 |
|---|---|---|
| §18 第 3 列措辭 | 已改為「**已查證、結案**」,並註明「本報告初版誤寫『本人重跑未出現該行 / 原因未查證』,與現場不符,已於 2026-08-31 更正」 | ✅ 相符 |
| 新增「§18-3 補述」 | 存在,含白話段 + 實測表 + 來源鏈 | ✅ 相符 |
| 來源鏈是否正確 | 本人**再次獨立讀碼**:`tests/routes/auth.logout.test.ts:150-153` 逐字為 `poolQuery.mockImplementation(...)` 內 `if (sql.includes("FROM revoked_refresh_tokens")) { throw new Error("ER_NO_SUCH_TABLE: Table 'revoked_refresh_tokens' doesn't exist"); }`;`src/api/services/auth/auth.service.ts:435` 為 `logger.error(\`Refresh token revocation check failed: ${error}\`)` | ✅ 報告所述來源鏈**屬實** |
| 「4 次全部出現」是否可信 | 本人**自跑 8 次完整 `npx vitest run`**,逐次 `grep -c`:`run 1..8: count = 1`(**8/8 皆出現**),另 `2>/dev/null` 與 `2>&1` 各一次亦皆 = 1 ⇒ 本人累計 **10/10 出現** | ✅ 比報告聲稱更強,**方向一致** |
| 單跑穩定重現 | `npx vitest run tests/routes/auth.logout.test.ts` → `Tests 8 passed (8)`,該行出現 | ✅ 相符 |

### 對「未查明」那一條的判斷:**可接受,⛔ 不影響任何結論**

報告據實登記:`41-recheck-vitest.txt` 的 `grep -c` = 0、`10-vitest-run.txt` = 1,那次落檔為何漏掉此行未查明。
本人實測確認這兩個數字屬實(`41` → `grep -c` **0**、exit 1;`10` → **1**)。

**本人進一步查了兩層,結果據實登記:**

1. **排除「stderr 未被捕捉」假說**(這是最直覺的解釋,本人先驗它):
   ```
   npx vitest run 2>/dev/null | grep -c "ER_NO_SUCH_TABLE"  → 1
   npx vitest run 2>&1        | grep -c "ER_NO_SUCH_TABLE"  → 1
   ```
   ⇒ 該行走 **stdout**,`> file` 與 `> file 2>&1` 都收得到 ⇒ **⛔ 不是重導向漏 stderr 造成的**。

2. **找到一個足以解釋的機制(⚠️ 但本人⛔ 未能重現該遺失)**:
   `src/api/utils/logger.ts` 實碼為 pino 且**設了 `transport`**(dev 走 `pino-pretty`):
   ```ts
   const logger = pino({
     level: config.isDevelopment ? "debug" : "info",
     transport: config.isDevelopment ? { target: "pino-pretty", … } : undefined,
   });
   ```
   pino 的 `transport` 會另開 **worker thread(thread-stream)**,寫入為**非同步且跨執行緒緩衝**;
   行程/worker 在緩衝 flush 完成前結束時,**已知會遺失尚未 flush 的行**。
   這足以解釋「同一次執行裡 `INFO` 那行留下、`ERROR` 那行不見」(兩行 flush 時機不同)。
   ⚠️ **但本人 10 次重跑皆未重現遺失** ⇒ 此為**機制假說,⛔ 未經實證**,本人⛔ 不將它寫成已查明。

**判斷**:**可接受,⛔ 不需擋收案。** 理由三條:

- **未查明的範圍極窄**:未解的只有「某一次落檔為何少捕捉到一行 log」,
  ⛔ 不是「測試行為為何不一致」——測試結果在本人 10 次 + 實作側 4 次 + 兩份落檔中**一律 158 全過**。
- **⛔ 沒有任何結論依賴那行的存在**:那行是 mock 故意丟的假錯誤,它出現與否不改變任何斷言;
  該測試斷言的是 401 與 fail-closed,而它每次都過。
- **可證偽性已具備**:單跑 `npx vitest run tests/routes/auth.logout.test.ts` 可穩定重現,
  且來源是**已入版控的源碼行**(測試 150–153、service 435)⇒ 日後複驗者不依賴那份落檔。

⇒ 這條「未查明」屬**誠實登記的殘留**,符合「⛔ 不以推理冒充已查」的紀律。⛔ 反而不該逼實作側寫成已查明。

## 三、弱點 1 的措辭下修:✅ **下修得夠**

這是我上一輪留給規劃側的判讀點,現在報告已自行下修。本人核對後認為**下修到位**,理由:

| 檢查點 | 報告現況(逐字) | 本人判定 |
|---|---|---|
| 有沒有承認「復現組本身」證據力不足 | 「判定**三條各自成立、但合起來仍不足以獨立證成『同一密碼』**」「⛔ **不能**單憑落檔證明兩發用的是同一個密碼」 | ✅ 承認到位,⛔ 未打折 |
| 有沒有處理「原措辭讀起來像已完整證成」 | 「原措辭若讀起來像『復現組已完整證成根因』,**以本段為準**」 | ✅ 明文覆蓋舊措辭,⛔ 未留兩套說法 |
| 根因是否另有獨立支撐 | 以 `git show origin/developers:…auth.service.ts` 量測改碼前 `verify()`,並說明 401 發生在密碼比對**之前** | ✅ 成立,見下方本人複量 |

**本人獨立複量(⛔ 未採信報告與協調者的數字)**:

```
git show origin/developers:src/api/services/auth/auth.service.ts | sed -n '39,144p' | grep -c "SELECT"   → 1
git show origin/developers:src/api/services/auth/auth.service.ts | sed -n '39,144p' | grep -ci "email"   → 0
```

**且本人另行查證了報告沒說的一點:那個行號視窗是否真的涵蓋整個 `verify()`**——
`git show origin/developers:… | grep -n "public async\|private async"` 實測方法起始行為
`39: public async verify(`、**下一個方法為 `146: public async hashPassword(`**
⇒ `verify()` 實際為 39–145 行,**取樣視窗 39–144 幾乎完整涵蓋且⛔ 未截斷函式主體**
(僅少最後的收尾行,不含任何 SQL)。⇒ **「全函式 email 命中 = 0」的量測成立。**

⇒ 結論不變且更穩:**根因 A 由「改碼前原始碼結構」獨立證成,⛔ 不依賴那組復現的密碼相同性。**
⚠️ 這是**下修證據力、保留結論**的正確處理方式,⛔ 不是把問題寫小。

## 四、`.gitignore` 新變更:✅ 在範圍內、⛔ 無夾帶

| 核對點 | 稽核側實測原始輸出 | 結果 |
|---|---|---|
| 只有 3 行、⛔ 無夾帶 | `git diff .gitignore` → `@@ -10,3 +10,6 @@`,新增 **3 行**(空行 + `# 任務取證落檔（一次性輸出，非專案產物；含測試帳號 token，⛔ 不入版控歷史）` + `.evidence/`),**0 刪除、⛔ 無其他 hunk** | ✅ 僅此 3 行 |
| 生效 | `git check-ignore -v .evidence/` → `.gitignore:15:.evidence/	.evidence/`,**exit=0** | ✅ 相符 |
| diff 規模 | `git diff --stat origin/developers` → **`8 files changed, 98 insertions(+), 17 deletions(-)`** | ✅ 與報告 §15.1 補述的 `8 files / 98+ / 17-` **逐字相符**(協調者稱曾誤寫 7 files,現況已正確) |
| 程式碼三檔未再變動 | `git diff --stat origin/developers -- src/ CLAUDE.md` → `3 files changed, **95 insertions(+), 17 deletions(-)**` ⇒ 與初稽完全相同 | ✅ ⛔ 未夾帶程式碼改動 |
| `git status` 已不見 `.evidence/` | `git status --short` → 已無 `?? .evidence/`,新增 ` M .gitignore` | ✅ 相符 |
| `.evidence/` 內容未被刪改 | `ls -la .evidence/fix-login-contract/` → **24 個檔,檔名、位元組大小、mtime 與本人初稽時的清單逐項相同**(例 `00` 12375 / `01` 1196 / `02` 1808 / `44` 14527 / `46` 2454) | ✅ **零刪改** |
| 舊引用是否被打斷 | 報告 §8 引用 `.gitignore:12 docs/dedup/`;本人 `sed -n '12p' .gitignore` → `docs/dedup/`(新增行落在 13–15)⇒ **舊行號引用仍正確** | ✅ ⛔ 未產生失效引用 |
| 初版 `git status` 快照已標時點 | §15.1 的引用區塊仍含 `?? .evidence/`,但其下明文「`git diff --stat` 實測(**報告初版時**)」+「⚠️ **報告初版後現場再變一次**」並給出新數字 | ✅ 可接受(⛔ 非誤導,已標時序) |
| 主迴圈執行、⛔ 非實作側漂移 | 報告 §19-5 逐字「Yu 2026-08-31 逐字裁『.evidence/ 甲:加進 .gitignore』,由主迴圈執行(⛔ 非實作側自行處置)」,並把該項由 carryover 改為**已結案** | ✅ 歸屬標示清楚 |

⚠️ **附帶登記(⛔ 非缺陷,交規劃側知悉)**:`.evidence/` 加入 `.gitignore` 後,
**這 24 份落檔將⛔ 不進版控歷史,只存在本機**。
⇒ 稽核鐵則「證據耐久性」的實質保障,從此改由「報告內逐字引用 + 可重跑指令 + 已入版控的源碼行」承擔。
本包的關鍵數字(build / vitest 158 / jscpd 3.32% / cargo 39 / git 對帳)**本人已全部獨立重跑過**,
⇒ 就本包而言⛔ 不構成問題。但這是 Yu 的裁決,⛔ 非稽核側可改;僅登記其後果。

## 五、初稽其餘 44 項是否仍成立:✅ 全部重驗通過(無漂移)

| 核對點 | 本輪實測 | 結果 |
|---|---|---|
| 遠端(⚠️ 仍用 `ls-remote`,⛔ 不看本機快照) | api `git ls-remote origin developers` → `980b87106f5bcfcf4a211a4c659f46d6f035ff0e`;`git rev-parse HEAD` 同值 | ✅ 未漂移 |
| Nymless | `git ls-remote origin main` → `196d9369c890820291a814e58d8a0107be86c106`;`git rev-parse HEAD` 同值;`git status --short` 仍為 ` M src-tauri/src/nymless_api/auth.rs` + `?? .claude/commands/`;`git diff --stat origin/main` → `1 file changed, 82 insertions(+), 14 deletions(-)` | ✅ 未漂移 |
| 兩 repo 仍未 commit | 兩 repo HEAD 皆等於遠端,無新 commit | ✅ 相符 |
| vitest | 本輪自跑 **8 次**完整套件,每次 `Test Files 20 passed (20)` / `Tests 158 passed (158)` | ✅ 相符 |

---

## 複稽後判定

### ✅ **收案**(就稽核側職權範圍而言)

- **必改 #1(證據份數)**:✅ 已改正,全檔零殘留,且留有更正痕跡。
- **必改 #2(§18-3)**:✅ 已改正,來源鏈經本人獨立讀碼確認屬實;
  「4 次全出現」本人以 **10/10** 複驗,方向一致且更強。
  其中「某次落檔為何漏行」的**未查明屬可接受**(理由見上,⛔ 不擋收案)。
- **弱點 1 措辭下修**:✅ **下修得夠**,且根因另有結構性支撐(本人複量並額外驗證了行號視窗涵蓋性)。
- **`.gitignore` 新變更**:✅ 在範圍內、⛔ 無夾帶、`.evidence/` 24 份零刪改。
- **報告更正 #3(§4 引用 `13-fixture-cleanup.txt` 省略 `users=3 / deleted=2`)**:
  ⚠️ 本輪複查該處仍為原樣。⛔ **不擋收案**——淨零結論(起 1 迄 1、前綴列 0)本人已用 `46` 實測 `total: 1` 獨立證實;
  此項降為**建議**,交規劃側決定要不要補。

### ⚠️ 唯一形式上未達標的一項:remote Actions(⛔ 這是 Yu 的裁決點,⛔ 我不替他決定)

**明講:形式上未達標。** `CLAUDE.md`「驗收與產物重建紀律」寫的收案條件是
**local green + remote Actions 綠(附 run 連結)**;本人實測兩 repo `git ls-remote` 無新 ref、
`git log --oneline origin/<分支>..HEAD` 皆空 ⇒ **確實未 push,⛔ 無 run 連結可附**。

**我的立場**:⛔ 我**不**以此擋收案。原因是「未 push」正是等 Yu 批准的結果,
⛔ 不是實作側的疏漏;報告 §16 也已誠實標「local green,remote Actions 未跑」並列入 carryover 3。
⇒ **要不要以「push 後補 run 連結」為條件收案,是 Yu 的裁決**,本稽核只負責把「形式上未達」講清楚。

### 稽核側守界聲明

⛔ 本輪未改動任何程式碼、未改動 verification / plan / `.gitignore` / `.evidence/`;
⛔ 未 `git add` / commit / push;⛔ 未跑任何寫入型 SQL。
本檔(`fix-login-contract-verification-audit.md`)是稽核側唯一寫過的檔案。
⛔ **commit/push 仍待 Yu 確認。**
