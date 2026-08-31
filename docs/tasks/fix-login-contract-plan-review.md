# Plan 審核:fix-login-contract 登入/註冊契約缺陷修復

> 審核對象:`docs/tasks/fix-login-contract-plan.md`(2026-08-31 版,680 行)
> 審核者:規劃側 Claude 日期:2026-08-31
> **阻斷點一律以 ⛔ 明標**;沒有 ⛔ 的條目是建議(可採納可說明不採)。

## 審核結論

**✅ 放行(附 1 條 ⛔ 必改——照改寫入 plan 即可動工,不需重審)**。
plan 的全部檔案/行號錨點經本審**逐條獨立複驗**屬實;P1(不 fall through)與部署順序推論成立;
復現三階梯足以防「復現不出來就改碼假裝驗過」;界外五項無一夾帶。唯一必改在 §6 碰撞查核的
誠實條款(見阻斷點 1)。

---

## 逐項審核

### 裁定(plan §16 交審的五項)

1. **CLAUDE.md 地雷清單加一條 —— 准做**。「Email 優先兩段式、⛔ 不得改回 `OR` 單查、
   Email 段命中即定案不 fall through」是安全承載行為,改回去會重引入背景 A-4 的列序混淆
   與 P1 列的三個問題,完全符合地雷清單的性質。措辭照 plan §4.1 末;**僅加這一條、
   錨點編輯,⛔ 不整份重寫 CLAUDE.md**。
2. **P1(Email 命中但密碼錯 ⇒ 不 fall through)—— 核准**。逐條判:
   - 理由 1(語意確定性)、2(暴力破解面翻倍)、4(可測性)**各自獨立成立**——
     尤其理由 1:fall through 會讓最終身分由「哪個帳號的密碼恰好對上」決定,
     正是 A-4 要排除的「依巧合而非語意」,只是把 `OR` 的病換個位置重現。
   - ⚠️ 理由 3(時序側信道)是四條中最弱的:「帳號存在與否」的時序洩漏**現況就有**
     (查到列才跑 argon2),fall through 只是**加劇**(多一次 argon2)而非引入。
     verification 引用時請以 1/2/4 為主、理由 3 降級措辭為「加劇既有洩漏」。
   - 代價已被 §6 兜住:Q1/Q2 的 `` a.`unique` <> b.`unique` `` 正確區分**跨帳號碰撞**與
     **同帳號自等**(Q3 另計,避免把 0 誤讀成「沒人用 Email 當 username」);
     保留字 `unique` 的反引號處理正確;Q2 > 0 停手交 Yu 裁決正確。
     附帶影響的描述與任務包「裁決結果」記載一致,且 plan 補上「自己的 username == 自己的
     email 不受影響」這個正確的細化。
3. **`expires_in` 表達式第三次出現而不抽 helper —— 接受**。單一運算式、jscpd
   `minLines: 5` 不觸發;語意實際上由 D2/D3 測試鎖住而非靠 helper;三處未來因**同一個**
   理由(OAuth2 正規化包)一起消失,屆時 helper 也是死的。規約 C 的「第三次必須抽」在此
   讓位於「錯的抽象比重複更貴」。verification 記一句此判斷與出處即可。
4. **§13 六條不一致**:
   - 第 1/2/3 條(丙案殘留)——**已由主迴圈修訂任務包消解**。本審以現況複查:
     「要建的模組」表第 1 列、負向驗收 A 條、「不做什麼」節皆已無「禁 `@`」字樣。
     ⛔ 實作側不得再照 §13 舊描述執行任何禁 `@` 相關動作(含測試)。
   - 第 4 條(`IUser.ts` 缺 `email`)——**record-only 准**。本審複驗屬實(`IUser` 僅
     `id/unique/username/password/roles` 五欄);`verify()` 改後不讀 `user.email`,
     不影響編譯與行為;補欄位屬漂移治理,另包。
   - 第 5 條(任務包步驟 0-a 未載「兩種失敗同回 401」陷阱)——**遺漏屬實**,見下方
     「對任務包的回饋」;plan §5.1 的補強正確,以 plan 為準。
   - 第 6 條(`NYMLESS_API_BASE_URL` 補強)——收下,§7.1 的「實查結論 ≠ 發行版當時的值」
     邊界劃得對。
5. **register 補 `Cache-Control: no-store` —— 維持界外,准 plan 定性**。本審核對:
   `auth.controller.ts:101-102` login 有設、`:351-356` register 沒設而回應同樣含 token,
   缺口是真的;但不在任務包範圍,record-only + 另立小包。⛔ 不得順手加進本包。

### ⛔ 阻斷點(必改,照改即可動工、不需重審)

1. **§6 碰撞查核缺「查的是哪個 DB」的誠實條款**。plan §6 寫「對**目標環境**的 DB 執行」,
   但沒寫 production 連不到時怎麼辦——§7.2 對 `roles` 欄位型別有同款「查不到怎麼辦」條款,
   §6 這個**更要命的查核**反而沒有。若實作側只連得到 dev,「Q2 = 0(dev)」很容易被
   靜默當成「已清」。**必改**:§6 判讀段補一條——
   - verification 必須明寫 Q1–Q3 是對哪個 DB 跑的(附 `MYSQL_DATABASE` 實際值);
   - 只查得到 dev 時,⛔ **不得以 dev 的 0 清掉此項**,須明標「production 未查」,
     並把「部署前由 Yu(或有權限者)對 production 跑 Q1–Q3、Q2 > 0 即停」列為
     **部署前置步驟**寫進 verification 的部署說明。
   理由:D1=甲 的附帶影響是以「上線前查過**現有資料**」為條件被接受的
   (任務包裁決結果原文:「⛔ 不得預設『不存在』」)——dev 的 0 不能代位 production。

### ⚠️ 建議(不阻斷)

- **復現階梯 a 依賴 Yu 提供帳密**——若要等,直接走階梯 b(自建再刪的測試列):
  b 才是「fixture 由我方備好、⛔ 不叫架構師自備」的形狀。a/b 先後可互換,取先跑得動者。
- **凡由 Yu 代跑或上真機的環節**(階梯 a 由 Yu 代跑、步驟 0-b、§11.2 舊 binary 實測)
  一律**一次一步**:給一步、等回報結果、再給下一步,⛔ 不一次貼整份步驟表。
- **R1 鏡像 payload 以後端實際回應為準**:既有 wire test
  `login_response_deserializes_backend_payload`(auth.rs:546-561)的 `"scope": "user"` 是
  **字串**,後端實際回**陣列**——serde 忽略此欄故不紅,但 R1 既自稱「鏡像後端新 payload」,
  `scope` 請放陣列。舊測試那處 ⛔ 不順手改(界外,記錄即可)。
- 主表步驟 0 的 `yarn dev … | tee` 會佔住前景終端,實跑時背景化或開雙終端,證據照落檔。

### ✅ 確認事項(本審獨立複驗留痕)

- **錨點全數複驗一致**(⛔ 非轉抄,本審以 Read/Grep 逐條核過):
  api 側 `auth.service.ts` :53(單段 username 查詢)/:121/:138/:198/:215/:232/:238(`"15m"`)
  /:296/:313;`auth.controller.ts` :112/:127(`expires_in` 絕對毫秒)/:351-356(register 回
  **201**、無 `token_type`/`expires_in`/`scope`/`info`);`users.sql` 第 7 行 `roles JSON
  DEFAULT NULL`、`unique`/`username`/`email` 三個 UNIQUE;`environment.common.ts`
  `increaseTime: 600000`;`.jscpd.json` threshold 3.7 / minLines 5 / minTokens 50;
  `accessControl` 全 repo 僅 `authJwtVerify.ts` :7/:109 兩命中、無路由掛載;
  `.gitignore` 無 `evidence` 條目。
  Nymless 側 `auth.rs` :43/:48(`LoginResponse`,`refresh_token`/`expires_in` 有
  `#[serde(default)]` 而 **`info` 沒有**)/:58(`RegisterResponse`)/:112(register 無 `///`)
  /:135(裸 `?`)/:157/:191(`persist_login_session` 設 username 與 expires_at)/:380
  (`is_token_expired`,0 → 未過期)/:483(wire tests **恰 7 條**,`use super::*` 慣例屬實);
  `commands.rs:233-240` `register_account` 回 `Result<(), Error>`;`mod.rs:71-74`
  fallback `http://localhost:8030`;`Login.tsx` :56/:60 `type="email"` + `required`;
  `CreateAccount.tsx:161` 註冊成功即導向 `/auth/link-minecraft`(缺陷 B 發作點屬實)。
- **部署順序推論查證成立**(審核重點 3):`LoginResponse.info` 非 `Option` ⇒ 舊後端
  register 回應無 `info` → 新 app 反序列化必敗;後端在回應**之前**已 `INSERT`
  (service :226)⇒「app 顯示註冊失敗但帳號已建立」成立;重試撞 :198 的
  `username = ? OR email = ?` 查重 → 409。後端先上無建表/無 migration 屬實(§9 檔案清單
  無任何 `.sql`/DDL)。§4.5 拒用 `#[serde(default)]` 繞開的理由核可(那會讓 `login()` 的
  `username` 契約一起鬆掉);§11.3/§11.4 的順序與回滾約束(後端回滾前先確認 app 未發版)
  皆正確。**防呆已寫足**。
- **復現三階梯足以防假驗**(審核重點 2):§5.1 的陷阱描述屬實——本審核對 `verify()`
  兩處失敗(:58-64 查無、:89-95 密碼錯)訊息與 code **逐字相同**,單看 401 確實證不了
  根因,對照組(同帳密 username 打 → 200)是必要的。三階各產生可否證的落檔證據;
  階梯 b 的 dev 前置檢查與 COUNT 淨零核對正確,且不違反「不改既有使用者資料」;
  階梯 c 誠實標示「查找層 mock、非端到端」。§5.3(全不通停手)與 §5.4(復現不出來
  = 根因判斷有誤,停手 ⛔ 不硬改)把兩條造假路都堵死。**足夠**。
- **界外守得住**(審核重點 5):f32-4 / `accessControl` / `scope` 格式 / `loginLimiter` /
  `Cache-Control` 五項在 §12 全數 record-only;§8 測試清單與 §9 檔案清單逐條掃過,
  **無任何一項偷做進去**;§0 守界與 D1=甲 / D2=甲 收斂一致,無丙案回潛
  (plan 全文無「禁 `@`」的任何實作或測試)。
- **步驟 0' 的依據成立**:`config.service.ts` :51-53 constructor 內呼叫
  `_validateConfig()`、:144 `export const config = ConfigService.getInstance()` 模組載入即
  執行、:105 缺 `JWT_REFRESH_SECRET` 進 missingFields → :109 throw ⇒ `yarn dev` 起得來
  即證該變數已設。**埠 8030 已核**(`environment.dev.ts` / `environment.prod.ts` 第 6 行
  皆 `port: 8030`),§5.2 curl 指令的埠正確——M1-7 那型「plan 裡就錯的埠」此次不存在。
  路由 `POST /oauth2/token` / `POST /register` 皆與 `auth.routes.ts` 對上。
- **測試設計核**(審核重點 4):每一步都有可實跑的指令與判準,Nymless 側明標
  `cargo test --lib` 於 `Nymless/src-tauri`(含空格引號提醒)。A4 斷言在該情境成立
  (登入流程唯一含 `username = ?` 片段的是第二段查找;Lazy Migration 的 UPDATE 不含);
  R3 三斷言算術核過(`600` ms < now → true;`now_ms + 600_000` → false;`0` → false,
  與 :380-383 現行為一致);C1 的 `exp - iat === 600` 與 `increaseTime 600000 / 1000` 相符;
  另立新測試檔的理由屬實(`auth.routes.test.ts` @notes 明寫「免 DB 骨架」,
  `vi.mock` hoisting 會波及既有三個 describe);`auth.logout.test.ts` 的 mock 慣例
  (poolQuery 依 SQL 片段分流)確如 plan 所述。
- **P2–P6 全數核可**:normalizeRoles 三態表含空字串不產 `[""]`;`scope` 由 `null` 變 `[]`
  的附帶效果已明說且不違反「不動 scope 格式」;private static 不抽 utils 合規約;
  P3 以 R2 實測留舊形狀相容證據而不在生產碼留孤兒,是好設計;P4 的單一真實來源理由成立;
  P5 不加 `LIMIT 1` 正確(兩欄皆 UNIQUE);步驟 9 的 dead_code 反向驗證是合理的順手檢查。

### ⛔ 未實查,實作側必查(鐵則 7 留痕)

本審只到檔案層(無 Bash)。下列需執行才驗得到,plan 已全數排入對應步驟,⛔ 不得省略、
⛔ 本審未核可其結果:
- 缺陷 A 的實跑復現(步驟 0)——根因鏈檔案層閉合但**未實跑**。
- mysql2 對 JSON 欄位的實際回傳形狀、線上 `users.roles` 實際型別(§7.2 `SHOW COLUMNS`)。
- `email` / `username` collation(`SHOW FULL COLUMNS`)。
- Q1–Q3 實際計數(⛔ 含阻斷點 1 的 DB 標註義務)。
- `npx vitest run` / `yarn build` / `npx jscpd@5.0.14` / `cargo test --lib` 實跑輸出、
  兩 repo remote Actions。
- 發行 build 的 `NYMLESS_API_BASE_URL` 實際值(§7.1 三法)。

## 對任務包的回饋

- 丙案殘留三處已由主迴圈修訂消解,本審以現況複查乾淨,任務包**不需再動**。
- plan §13.5 屬實:任務包驗收步驟 0-a 未載「查無此人與密碼錯誤回同一個 401」的陷阱,
  單看 401 證不了根因。plan §5.1 已補足(對照組要求),**任務包不需重發**,
  verification 以 plan §5.1 為準執行並引用。
- plan §13.6 的補強(Nymless repo 內無任何 build 設定注入 `NYMLESS_API_BASE_URL`)
  收錄為新事實,不改任務包。

## 放行條件

- 照 **⛔ 阻斷點 1** 把誠實條款修入 plan §6 後**即可動工,不需重審**。
- `CLAUDE.md` 只准加「登入識別 Email 優先兩段式」那一條地雷(錨點編輯);
  其餘檔案以 plan §9 清單為界,⛔ 不夾帶。
- 實作完成產 `fix-login-contract-verification.md`(含部署說明:後端先上、app 後發、
  production 碰撞查核為部署前置);record-only 五項寫入「已知未修」節。
- **⛔ commit / push 前回報,待架構師確認**——本 review 的放行是「可動工」,
  ⛔ 不構成任何 push 預授權。
