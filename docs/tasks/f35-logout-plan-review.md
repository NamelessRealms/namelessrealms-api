# F35 計畫審核（plan-review）

> 審核對象：`docs/tasks/f35-logout-plan.md`
> 審核者：規劃側 Claude　日期：2026-08-07
> **結論：放行。疑點 1 甲、疑點 2 甲、疑點 3 核可、疑點 4 核可、疑點 6 文案核可（⚠️ en 有一處必改）、§3.3 測試形式核可（附一條強化）。另補一條計畫未涵蓋的規則（§六）。不需再送審。**

---

## 一、總評

**任務包有兩處是我寫錯的，你都查出來了：**

1. **`docs/sql/` 是我憑空指定的路徑**——我當時看到 `docs/` 下只有 `dedup/` 與 `tasks/`，就自己編了一個位置，卻沒去看 `src/database/` 已經有 20 支 `.sql` 且 `CLAUDE.md` 明載它是 schema 單一真實來源。而且我自己在同一段寫了「沿既有慣例走 SQL 檔」——**指定路徑與自己的指示互相矛盾**。
2. **「死按鈕接活」的前提是錯的**——那顆鈕在 `MOCK_ACCOUNTS.map()` 裡，承諾的是「移除這一個 Minecraft 帳號」，不是平台登出。我從 f32-3a 的驗證報告讀到「`SettingsGeneral.tsx:74` 的 signOut 按鈕沒有 onClick」，就假設它是平台登出鈕，**沒去看它在哪個迴圈裡**。照字面接上去會做出比死按鈕更糟的東西。

另外三件值得記錄：
- **P1 / P2 推翻了任務包的兩處「停手回報」條件**，而且是拿實據推翻（`tests/modpool/f27b2a-content.test.ts:38` 的既有 mock 形式、`keyring-2.3.3/src/error.rs:38` 的 `NoEntry` 變體）。⛔ 停手條件不成立就該推翻，不是照著停。
- **§1 疑點 5 的 `location.reload()` 陷阱**：`createBrowserRouter` + SPA fallback 會讓 reload 留在原路由、完全繞過 Splash 的 `validateSession`。這是「按了登出、畫面停在一個沒有帳號的設定頁」——最難查的那種 bug，因為每一步看起來都成功了。
- **§4.1 ⛔ 不使用 `ensure_valid_access_token()`**：該函式在 token 過期時會嘗試刷新、失敗直接回 `Unauthorized`——**那正好會擋住「token 已過期所以要登出」這個最需要登出的情境**。這是把功能與其失效情境一起想過才看得到的。

---

## 二、疑點 1 —— **甲**，落 `src/database/revoked_refresh_tokens.sql`

以你的建議為準，任務包 §A1 的路徑指定作廢。DDL 沿既有風格（反引號、`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`、`KEY` 而非 inline `INDEX`）也照你寫的。

判準：**schema 的單一真實來源不得分岔**。這比「照任務包字面」重要。

---

## 三、疑點 2 —— **甲**，新增真實 Nymless 帳號列，MOCK 列原封不動

理由你引用得對：f32-2a 已立「規約 E 的排除單位是**區段**不是元件，真功能該做真」，新增的 Nymless 帳號列正是這個區段裡真的那一半。⛔ 乙案（順手刪 MOCK 死鈕）違反 Karpathy §3，且動到假資料原型。

**兩件附帶要求**：
1. 新列的形狀**鏡射 `MainLayout` 的 Nymless 帳號 pill**（你已寫），確保兩處入口在視覺上是同一個東西。
2. **MOCK 列上那顆死鈕要登記為 carryover**：「移除單一 Minecraft 帳號」未實作，設定頁有鈕但無行為。⚠️ 注意它與 `players` 的真實資料無關（MOCK_ACCOUNTS 是假的），所以**這條的正解是等帳號管理頁接上真實資料時一起做**，不是現在補一個 onClick。規劃側已登記。

---

## 四、疑點 3、4 —— 核可

- **疑點 3**：`200 { success: true }`。⛔ 不用 204——與 repo 內每一支端點不一致，一致性優先於 REST 語意潔癖。
- **疑點 4**：`logoutLimiter` = 15 分鐘 30 次，核可。你的威脅模型分析成立（寫入需先過 `jwt.verify`，攻擊者持有有效 token 時登出他自己無收益）。⛔ 不套 `loginLimiter`。

---

## 五、疑點 6 —— 文案核可，**但 en 有一處必改**

### ⛔ 必改：`Log out` → `Sign out`

copy-guide **§一之二（2026-08-06 新增，你取不到）** 定了稱呼與用字規則，其中一條是：

> 同一概念不得兩種寫法：`modpack`（⛔ 不寫 `mod pack`）、`sub-server`、**`sign in` / `sign out`（⛔ 不寫 `log in`）**

而 f32-3a 已把全 app 的 en 收斂到 `Sign in`，既有 key 也叫 `settings:general.signOut`。你的擬稿用 `Log out` / `Logging out…` / `login screen`，會**在 f32-3a 剛統一完的用字上開一個新的分岔**。

**改法**（其餘逐字照你的擬稿）：

| key | en（定稿） |
|---|---|
| `actions.logout` | Sign out |
| `logout.title` | Sign out of Nymless |
| `logout.description` | You'll return to the **sign-in screen**. Your downloaded game files and mods stay on this computer, ready for next time. |
| `logout.confirm` | Sign out |
| `logout.working` | Signing out… |

`logout.clearMinecraft` / `logout.clearMinecraftHint` **原文照收**——後者的 `sign in with Microsoft` 本來就對。

⚠️ key 名 `actions.logout` / `logout.*` **維持不動**（key 用英文語意命名、與顯示字串脫鉤，f32-2a 已定）。

### zh-TW 六條 —— 全數核可，一字不改

理由值得記下來：`logout.description` 那句「你已下載的遊戲檔案和模組都會保留，下次登入就能直接使用」正是 copy-guide §二 要的形狀——**說「會發生什麼」＋「你之後要做什麼」，不出現「憑證／token／撤銷／session」**。而 `clearMinecraftHint` 只在勾選時才出現、預設不嚇人，這個判斷也對。

### ⚠️ 但 hint 需要第四個 prop

你的 `ConfirmModal` 新 prop 只有三個（`checkboxLabel` / `checked` / `onCheckedChange`），**沒有地方放 `clearMinecraftHint`**。補第四個 optional：

```ts
/** 勾選後才顯示的補充說明；不傳則不渲染 */
checkboxHint?: string;
```

渲染條件 `checkboxHint != null && checked`。⛔ 仍是 optional，既有 2 處呼叫點一個字不動。

---

## 六、⚠️ 補一條計畫未涵蓋的規則 —— MC 帳號逐一清除的失敗處理

§4.1 步驟 5 寫「對 `players` 每個 uuid 呼叫 `clear_microsoft_tokens_for`」，但**沒說其中一個失敗時怎麼辦**。這在 keyring 場景是會發生的（權限、鑰匙圈鎖定）。

**定案**：
- 逐一清除，**單一 uuid 失敗只 `tracing::warn!`（含 uuid 與錯誤）並繼續清其餘**，⛔ 不得中止整個登出。
- 全部處理完後照常 `players.clear()`、`sync`、回 `Ok(())`。
- ⛔ **不得因為某個 keyring 項目清不掉，就讓使用者無法登出**——理由同「後端失敗不得阻擋登出」：登出是使用者要離開，不能被任何一個子系統綁架。
- ⚠️ 但**不得靜默**（沿 F27b-2c 紀律）：失敗的 uuid 必須進 log，且**驗證報告要寫明這個取捨**——即「勾了移除卻可能有殘留」是已知且刻意的行為，代價由 log 承接。

---

## 七、§3.3 的 `#[ignore]` keyring 測試 —— 核可為證據，附一條強化

核可以「本機 `cargo test -- --ignored` 實跑貼輸出」作為守界聲明第 2 題的實查證據。CI 無 keychain 故不跑，這與 `sync.rs` 的既有前例一致。

⛔ **但必須加一段前置斷言**：目前的設計是「寫入 → 清除 → 斷言皆 `NoEntry`」，**這樣一個從未寫成功的測試也會通過**。必須：

1. 寫入 2500 bytes 假 token 後，**先斷言 `ms_at_{u}` 為 `CHUNKED`、`_cc` == 3、`_p0`/`_p1`/`_p2` 皆存在**——證明分塊確實被寫進去了
2. 再 `clear_microsoft_tokens_for`
3. 再斷言全部 `NoEntry`
4. 再呼叫一次驗冪等

沒有第 1 步，這條測試證明不了任何事。這與 `noHardcodedCjk.test.ts` 的 `SOURCES.length` sanity check 是同一類防護：**先證明待測物存在，才有資格證明它被處理掉了**。

其餘（固定前綴避免污染、結尾不論成敗都清、keychain 權限被擋則停手回報）全數核可。

---

## 八、✅ 認可（不必改）

- **§2.3 的 `catch` 只包查詢本身、不包 `revoked.length > 0` 判斷**：正確，且理由（否則命中時丟的 401 會被自己吞掉再重丟）說得精準。
- **撤銷命中的錯誤訊息與 `jwt.verify` 失敗一致**：正確，⛔ 不對外洩漏「這個 token 被撤銷過」。
- **`decoded.exp` 缺漏 → 401，⛔ 不寫入無上界的列**：好判斷，那會讓清理機制失效、表無上界成長。
- **§4.1 步驟 2 的 HTTP 在取鎖之前完成**：正確，⛔ 不得持有 write guard 時 await 網路。
- **§4.2 的 `useLogout` hook 抽法**：符合任務包「⛔ 不得各寫一份」；規約 D 與地雷 A 的自我檢核也做對了。
- **§7 情境 2 用 mock 讓查詢 reject 精確模擬「表不存在」**：比真的砍表乾淨，且可重複。
- **§8 對 `ECOSYSTEM.md` 的判斷**：正確——該節目前只描述 token 怎麼進來、沒描述怎麼退場，而本包新增了跨 repo 流程**加一條部署順序耦合**。建議的補充內容（per-device、⛔ 不是登出所有裝置、best-effort）照寫。
- **`namelessrealms-api/CLAUDE.md` 地雷清單加「必須先建表再部署」**：這條非常必要——它是本包唯一會讓**線上所有使用者一起掉線**的操作順序。

---

## 九、放行

疑點 1 甲、疑點 2 甲、疑點 3 核可、疑點 4 核可、疑點 6 核可（en 五條改 `Sign out` 系列、補第四個 prop）、§3.3 核可（加前置斷言）、§六 為新增規則。**即可動工，A → B → C，不需再送審。**

commit / push 前回報等 Yu 確認。push 順序：**allay_core 綠 → Nymless；api 獨立**。三個 repo 的 run 連結都要附。⚠️ 報告須含部署說明（先建表再部署 api）。
