#!/bin/bash
# vault-guard.sh — PreToolUse hook
#   掛載點:①.claude/settings.json(涵蓋主迴圈**與所有子代理**)②nr-implementer 的 frontmatter(冗餘防線)
#
# 擋什麼:**任何子代理**對 Obsidian Vault 路徑的存取(讀與寫皆擋)。
# 放行:**主迴圈**(agent_type 為空)——它是唯一有 vault 讀寫權的角色。
#
# ⚠️ 權責是這樣定的(架構師 2026-08-24 拍板,取代原「Claude Code 連讀都不碰」):
#    vault 的讀寫權收歸**主迴圈**;⛔ 子代理一律不可,含 nr-planner
#    (它原本的「收案後更新 vault」職責已收回主迴圈)。
#
# 為什麼子代理一律擋:實作側的隔離價值在於「任務包沒寫的規格就是缺失」——
# 包漏寫時會以「實作側卡住回報」的形式**當場現形**。子代理一旦能自己去 vault 補洞,
# 那個訊號就消失了,而它是這條驗證鏈上唯一會主動報錯的地方。
#
# ⚠️ 主迴圈放行不等於可以轉手:見 WORKFLOW「vault 讀寫權」條——
#    ⛔ vault 內容不得抄進交給子代理的 prompt(那等於繞過本閘門讓它讀到)。
#    ⚠️ 那一條**機器驗不了**,是紀律;本閘門只保證「誰直接存取得到」。
#
# ⚠️ 身分判定用 payload 的 `agent_type`(實測:子代理多出 agent_type / agent_id 兩欄;
#    session_id / transcript_path 主子完全相同 ⇒ 只有 agent_type 分得開。
#    同一次取樣證實 settings.json 的 hook 會下沉到子代理 ⇒ 白名單是唯一解)。
# ⚠️ **更正(2026-08-29)**:2026-08-24 這次取樣原本寫的是「主迴圈兩欄皆 null」——**那句是錯的**。
#    `jq -r '.agent_type // ""'` 對「缺 key」與「值為 null」回傳**相同**的空字串,當初分不出來。
#    2026-08-29 用 `jq -e 'has("agent_type")'` 才驗到:主迴圈是**整個 key 不存在**。
#    ⇒ 對本檔的判準**無影響**(`// "" ` + `-z` 對兩種情況同樣正確,這正是這個 idiom 的價值);
#    ⛔ 但別再引用「皆 null」那句去推論別的東西 —— review-write-guard 就是這樣被推歪的。
#    ⚠️ 若日後 harness 移除該欄,所有呼叫都會被當成主迴圈**放行** ——
#    這是本閘門唯一的不安全失效方向,因此 gate-selfcheck 以「子代理樣本必須被擋」
#    的斷言把它釘住,壞掉會在下一次 SessionStart 當場轉紅。

input=$(cat)

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)
# 把整個 tool_input 攤平成一行字串:file_path / path / command / pattern / glob / url 全都涵蓋
payload=$(printf '%s' "$input" | jq -c '.tool_input // {}' 2>/dev/null)
agent_type=$(printf '%s' "$input" | jq -r '.agent_type // ""' 2>/dev/null)

deny() {
  jq -nc --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# --- fail-closed:輸入解析不了就擋 ---
# ⚠️ 這不是防禦性冗餘:jq 解析失敗時,下方每一個 grep 都會拿到空字串 ⇒ 全部放行。
# 「壞掉 = 放行」正是本編排最不能有的失效方向(同 bridge/storage 的 fail-closed 紀律)。
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  deny "⛔ vault-guard: 無法解析 PreToolUse 輸入(非合法 JSON),依 fail-closed 一律阻擋。⚠️ 這代表閘門本身處於不可信狀態,請回報 Yu,⛔ 不要繞過。"
fi

# --- 主迴圈:唯一有 vault 讀寫權的角色 ---
[ -z "$agent_type" ] && exit 0

# --- 子代理:一律擋 ---
# 大小寫不敏感;涵蓋 raw、URL-encoded、以及 ~ 展開前的寫法
if printf '%s' "$payload" | grep -qiE 'Obsidian[ _]?(Vault|%20Vault)|/Users/quasi-pc/Documents/Obsidian'; then
  deny "⛔ vault-guard: 子代理(${agent_type})不得存取 Obsidian Vault(/Users/quasi-pc/Documents/Obsidian Vault/)——vault 讀寫權**專屬主迴圈**。工具 ${tool_name} 的參數命中 vault 路徑,已阻擋。⚠️ 任務包/派工訊息是你的唯一來源:裡面沒寫的規格就是**缺失**,請停手回報卡住,⛔ 不要去別處找。需要 vault 裡的東西 ⇒ 回報,由主迴圈判斷該不該抄給你。"
fi

exit 0
