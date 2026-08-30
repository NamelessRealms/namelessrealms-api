#!/bin/bash
# session-brief.sh — SessionStart hook(專案主迴圈)
#
# 為什麼存在:⛔ 不要每開一個 session 就得人工貼一次開場白。
# 這支把「你是誰、開場讀什麼、收到組織層問詢要怎麼辦」在每個 session 開頭自動注入。
# ⚠️ 它是**簡報**,⛔ 不是待命令 —— 架構師直接派活時照做,不必等問詢。
# ⚠️ 與 gate-selfcheck 分開:那支的契約是「全綠即靜默」,⛔ 不得拿來夾帶常駐文字。

command -v jq >/dev/null 2>&1 || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
NAME="$(basename "$ROOT")"
KB="/Users/quasi-pc/Documents/Obsidian Vault/Claude 知識庫"

# vault 對應:⚠️ Nymless 群是**一庫管三 repo**,三個 repo 共用同一份 vault 與同一個 F 編號 backlog
case "$NAME" in
  Aegis)                        VAULT="$KB/Aegis/WORKSPACE.md";    CODE="M{n}(里程碑制)";        EXTRA="" ;;
  meridian)                     VAULT="$KB/Meridian/WORKSPACE.md"; CODE="M{n}(里程碑制)";        EXTRA="⚠️ 本專案是**暫行守則制**,⛔ 不是鐵則制。" ;;
  Nymless|allay_core|namelessrealms-api)
                                VAULT="$KB/Nymless/WORKSPACE.md";  CODE="F{n}(功能 backlog 制)"; EXTRA="⚠️ 本 repo 屬 **Nymless 群(一庫管三 repo)**:Nymless / allay_core / namelessrealms-api 共用同一份 vault 與同一條 F 編號 backlog。⛔ 進度不記 PROGRESS,記 \`FEATURE_PLAN.md\`。⚠️ 群內三 repo 的契約變更走本專案流程,⛔ 不算跨專案。" ;;
  *)                            VAULT="(未登記,請問架構師)";      CODE="{代號}";                EXTRA="" ;;
esac

read -r -d '' BRIEF <<BRIEF_EOF
【${NAME} 主迴圈 · 開場簡報(SessionStart 自動注入)】

■ 開場請先讀 \`${VAULT}\` 的**下一棒交接**節,以**最上面**的區塊為準(舊區塊僅供考古)。
  ⚠️ 交接章可能過期 —— 凡看到「尚未 commit / 尚未 push」,
  **先跑 \`git ls-remote origin <分支>\` 查遠端真值再信**,⛔ 不看本機 \`origin/*\` 快照。

■ 任務代號:${CODE}。任務走**五件套**:
  任務包 → \`{代號}-plan.md\` → **等 \`{代號}-plan-review.md\` 放行才實作** →
  \`{代號}-verification.md\` → \`{代號}-verification-audit.md\`。
  ⚠️ 既有的四件套任務⛔ 不回頭補稽核報告。
${EXTRA}

■ 收到【組織層總管問詢 · NR-Q{n}】時 —— ⚠️ 那是**問詢,⛔ 不是派工**:
  只做**唯讀盤點**,⛔ 不動任何檔、⛔ 不 commit、⛔ 不 push、⛔ 不產任務包。
  照四段回:①現況(git log -1 / status / 遠端真值 / \`docs/tasks/\` 根層除模板外有無檔)
  ②下一步是什麼(依交接章)③卡在哪(⚠️ 非程式的環境事件也要列)
  ④需要架構師裁決什麼(兩個以上選項列甲/乙/丙 + 建議與理由,⛔ 不自選)。
  用 \`mcp__ccd_session_mgmt__send_message\` 回到問詢訊息內指定的 \`session_id\`,回完**停下等**。

■ 收到【NR-D{n} 裁決回覆】時:內容是**架構師本人的裁決**,總管只做傳達。
  ⚠️ 若訊息裡有標明是「總管的建議」,那⛔ 不是裁決,⛔ 不得當作已批。

■ ⛔ commit / push 一律回報待架構師確認(\`push-gate\` 亦無條件擋 push,無例外通道)。
■ 大段中文**能搬不重寫**:整檔搬移 + 短錨點編輯,⛔ 不整份重打
  (2026-08-01 實測 \`U+651A\` 被寫成 \`U+651B\`,肉眼審不出來)。
■ ⚠️ 若上面沒有閘門自檢紅字,代表四道守門在位(**全過時是安靜的**)。
BRIEF_EOF

jq -nc --arg c "$BRIEF" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
exit 0
