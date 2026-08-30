#!/bin/bash
# push-gate.sh — PreToolUse hook (session 級)
# 擋 git push。
# ⛔ commit 授權⛔ 不構成 push 預授權。
# ⚠️ 2026-08-25 起 git-gate 已移除(架構師裁決乙:commit 交給主迴圈執行,push 仍守)——
#    ⇒ 本閘門是**唯一**擋在對外不可逆動作前的機器防線,⛔ 不得比照辦理拿掉。

input=$(cat)

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)

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
  deny "⛔ push-gate: 無法解析 PreToolUse 輸入(非合法 JSON),依 fail-closed 一律阻擋。⚠️ 這代表閘門本身處於不可信狀態,請回報 Yu,⛔ 不要繞過。"
fi

[ "$tool_name" = "Bash" ] || exit 0

# git [任何全域旗標] push;另涵蓋 gh pr create/merge 這類等效的對外推送
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]]+)?)*[[:space:]]+push([[:space:]]|$)'; then
  deny "⛔ push-gate: 禁止自行 git push。push 是對外不可逆動作,一律回報待 Yu 確認。⚠️ commit 已不再有閘門(2026-08-25 移除 git-gate),但那⛔ 不連帶放行 push——push 仍須逐次取得明示同意。"
fi

exit 0
