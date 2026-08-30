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

# git [任何全域旗標] push
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]]+)?)*[[:space:]]+push([[:space:]]|$)'; then
  deny "⛔ push-gate: 禁止自行 git push。push 是對外不可逆動作,一律回報待 Yu 確認。⚠️ commit 已不再有閘門(2026-08-25 移除 git-gate),但那⛔ 不連帶放行 push——push 仍須逐次取得明示同意。"
fi

# --- gh:與 push 等效的對外動作 ---
# ⚠️ 2026-08-30 補。⛔ 在此之前本檔的**註解宣稱涵蓋 gh,實際只比對 git push** ——
#    離線探針實測 `gh pr create` / `gh pr merge` / `gh release create` **全部放行**。
#    註解與碼不符,而本檔自述是「唯一擋在對外不可逆動作前的機器防線」⇒ 補上。
# ⚠️ 刻意**只擋會對外發布或改變遠端狀態**的子指令;
#    ⛔ 唯讀的 `gh pr view/list/status`、`gh run view`(CI 綠三重確認要用)一律放行。
# ⛔ **未涵蓋(明列,⛔ 不要假設它擋得住)**:`gh pr comment` / `gh issue comment` / `gh pr review`
#    —— 對外但可撤回,列為紀律不列為機制;以及任何經 `gh` 以外途徑的對外呼叫(curl 打 API 等)。
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*gh([[:space:]]+-[^[:space:]]+)*[[:space:]]+(pr[[:space:]]+(create|merge|ready|close|reopen)|release[[:space:]]+(create|edit|delete|upload)|repo[[:space:]]+(create|delete|archive)|workflow[[:space:]]+run|api[[:space:]].*-X[[:space:]]*(POST|PUT|PATCH|DELETE))([[:space:]]|$)'; then
  deny "⛔ push-gate: 禁止自行執行 gh 的對外動作(pr create/merge/ready/close/reopen、release create/edit/delete/upload、repo create/delete/archive、workflow run、api 的寫入方法)。⚠️ 這些與 push 等效:都是**對外不可逆**。一律回報待 Yu 確認。⛔ 唯讀的 gh pr view/list、gh run view 不受限。"
fi

exit 0
