#!/bin/bash
# gate-selfcheck.sh — SessionStart hook (session 級)
#
# 為什麼存在:hook 失敗是**靜默放行**的。
# 實測證據(bootstrap 當天):vault-guard 的 command 因路徑含空格而以
#   `/bin/sh: /Users/quasi-pc/Desktop/Projects/Nameless: No such file or directory`
# 失敗,而工具**照跑**——閘門無聲消失,沒有任何一行 log 出現在使用者眼前。
# ⇒ 「閘門還在不在」必須每個 session 開頭主動驗一次,⛔ 不能等出事才發現。
#
# ⚠️ 本檔**不只驗存在**:存在但 chmod 掉 +x、被截斷、jq 不在 PATH,
#    三種情形下腳本都還「在」,閘門卻已經不擋了。因此逐支灌一筆**必中的假 payload**,
#    斷言真的吐出 deny。這是唯一能分辨「擋得住」與「看起來還在」的做法。
#
# 全綠 ⇒ 靜默 exit 0(⛔ 不製造每 session 一則的噪音)。
# 有紅 ⇒ 同時走兩條路:stderr 給人看、additionalContext 給模型看。

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DIR")"          # .claude/
PROBLEMS=""

add() { PROBLEMS="${PROBLEMS}
  - $1"; }

# --- 0. 相依:jq 沒了,四支閘門會全部靜默放行 ---
command -v jq >/dev/null 2>&1 || add "⛔ jq 不在 PATH —— 四支閘門都靠它解析 tool_input,缺了會**全部靜默放行**。"

# --- 1. 四支閘門:檔案完整性 + 真的擋得住 + fail-closed ---
check_gate() {
  local name="$1" payload="$2"
  local path="$DIR/$name"

  [ -f "$path" ]  || { add "⛔ $name **不存在**(預期 $path)——對應閘門已完全消失。"; return; }
  [ -s "$path" ]  || { add "⛔ $name 是**空檔**——閘門已失效。"; return; }
  [ -x "$path" ]  || { add "⛔ $name **沒有執行權限**(chmod +x 掉了)——hook 會執行失敗,而失敗是靜默放行。"; return; }
  head -1 "$path" | grep -q '^#!' || add "⚠️ $name 缺少 shebang 首行。"

  local out
  out=$(printf '%s' "$payload" | "$path" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ $name **對必中樣本沒有吐出 deny** —— 檔案還在,但已經擋不住了。實際輸出:[${out}]"

  # 輸入解析不了時必須擋(⛔ 不得退回「壞掉就放行」)
  printf 'not-json{{' | "$path" 2>/dev/null | grep -q '"permissionDecision":"deny"' \
    || add "⛔ $name **不是 fail-closed** —— 餵它壞掉的輸入時它選擇放行。這是本編排最不能有的失效方向。"
}

check_gate "vault-guard.sh"       '{"tool_name":"Read","agent_type":"nr-implementer","tool_input":{"file_path":"/Users/quasi-pc/Documents/Obsidian Vault/probe.md"}}'
check_gate "push-gate.sh"         '{"tool_name":"Bash","tool_input":{"command":"git pu'"sh"' origin main"}}'
check_gate "audit-write-guard.sh" '{"tool_name":"Bash","tool_input":{"command":"echo x > CLAUDE.md"}}'
# ⚠️ 這個必中樣本**必須帶 agent_type** —— 2026-08-29 判準改為「沒有 agent_type ⇒ 主迴圈 ⇒ 放行」之後,
#    不帶該欄的樣本語意上就是「主迴圈」,放行才是對的。沿用舊樣本會讓這一格因為**閘門修好了**而轉紅。
check_gate "review-write-guard.sh" '{"tool_name":"Write","agent_type":"nr-implementer","tool_input":{"file_path":"docs/tasks/M0-0-plan-rev'"iew"'.md"}}'

# --- 1b. review-write-guard 的**白名單**:擋得住不夠,還要驗「該放行的有放行」---
# ⚠️ 這一段是實測逼出來的:第一版沒有白名單,結果把 nr-planner 自己的正當產出也擋死,
#    整條驗證鏈寫不出東西。⛔ 只驗 deny 的自檢會漏掉這種「擋過頭」的壞法。
RWG="$DIR/review-write-guard.sh"
if [ -x "$RWG" ]; then
  wl_payload() { printf '{"tool_name":"Write","agent_type":"%s","tool_input":{"file_path":"docs/tasks/M0-0-plan-rev%s.md"}}' "$1" "iew"; }
  for a in nr-planner nr-auditor; do
    out=$(wl_payload "$a" | "$RWG" 2>/dev/null)
    printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
      && add "⛔ review-write-guard **擋住了白名單代理 $a** —— 那兩個檔是它的正當產出,擋掉等於整條驗證鏈寫不出東西。⛔ 不是放寬閘門,是白名單壞了。"
  done
  out=$(wl_payload "nr-implementer" | "$RWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ review-write-guard **放行了 nr-implementer** —— 實作側寫得到 review/audit,寫入權鐵律已失效。"

  # --- 主迴圈(payload **沒有** agent_type 欄)必須放行 ---
  # ⚠️ 架構師 2026-08-29 判準,做法照 vault-guard:`jq -r '.agent_type // ""'` + `[ -z ... ] && exit 0`。
  # ⚠️ 這一格是實測逼出來的:第一版判準寫成「has("agent_type") 且值為空 ⇒ 放行」,對真實主迴圈 payload
  #    **恆不成立**;而自捏 payload 捏得出「has 為真」的形狀 ⇒ 三發自捏實彈全過、真機仍被擋。
  #    ⇒ 本斷言的價值在於它餵的是**真實形狀**(整個欄位不存在),⛔ 不得為了讓它變綠而補上該欄。
  # ⚠️ 代價已知並接受:主迴圈與「payload 結構壞掉」在檔面上是同一個輸入 ⇒ ⛔ 無法同時做到
  #    「主迴圈放行」與「欄位缺失 fail-closed」。要擋的 nr-implementer **有**該欄,寫入權鐵律仍守得住;
  #    非法 JSON 那條 fail-closed 由上方 check_gate 的第二段獨立釘住,⛔ 不受本格影響。
  ml_payload=$(printf '{"tool_name":"Write","tool_input":{"file_path":"docs/tasks/M0-0-plan-rev%s.md"}}' "iew")
  out=$(printf '%s' "$ml_payload" | "$RWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    && add "⛔ review-write-guard **擋住了主迴圈** —— 判準應為「沒有 agent_type ⇒ 主迴圈 ⇒ 放行」(照 vault-guard 的 idiom)。⛔ 不要用 has(\"agent_type\"):真實主迴圈 payload 對它恆為 false,那一版改動等於沒有生效。"

  # --- Bash 路徑:heredoc **內文**⛔ 不得誤殺,但**標頭**的真寫入必須照擋(2026-08-29 改 ②)---
  # ⚠️ 兩格是一組,⛔ 不得只留一格:上格單獨綠 = 可能整條比對都失效了;
  #    下格單獨綠 = 剝除沒生效,誤殺還在。要同時成立才代表「剝得剛好」。
  hd() { jq -nc --arg c "$1" '{tool_name:"Bash",agent_type:"nr-implementer",tool_input:{command:$c}}'; }
  hd_body=$(printf 'cat > docs/tasks/M1-8-plan.md <<EOF\n⛔ 反例:echo x > docs/tasks/M1-8-plan-rev%s.md\nEOF\n' "iew")
  out=$(hd "$hd_body" | "$RWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    && add "⛔ review-write-guard **誤殺 heredoc 內文** —— 實作側在自己的 plan 裡引用一句反例就被擋。掃描前要先剝掉 heredoc 內文(改 ②),⛔ 不是叫人拆指令繞路。"
  hd_head=$(printf 'cat > docs/tasks/M1-8-plan-rev%s.md <<EOF\nx\nEOF\n' "iew")
  out=$(hd "$hd_head" | "$RWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ review-write-guard **放行了 heredoc 標頭寫入 review** —— 剝除剝過頭了:重導向在標頭那一行,標頭**必須保留**。寫入權鐵律已失效。"

  # --- 餵給直譯器的 heredoc:內文**會被執行** ⇒ ⛔ 不得剝除(2026-08-30 補洞)---
  # ⚠️ 這一格釘的是 2026-08-29 heredoc 剝除**自己造成的回歸**:
  #    `bash <<EOF … EOF` 的內文是**程式碼、不是資料**,剝掉等於開一條
  #    「把寫入藏進 heredoc」的路。實測當時 `bash <<EOF` 與 `sh <<'SH'` 兩種都放行了真寫入。
  # ⛔ **不得為了讓這一格變綠而放寬** —— 要綠就把「標頭是直譯器 ⇒ 不剝」的判斷加回剝除段。
  # ⚠️ 它與上面兩格合起來是**三格一組**:誤殺不得回歸、標頭不得漏掉、直譯器不得被剝。
  hd_bash=$(printf 'bash <<EOF\necho x > docs/tasks/M1-8-plan-rev%s.md\nEOF\n' "iew")
  out=$(hd "$hd_bash" | "$RWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ review-write-guard **放行了藏在 bash heredoc 裡的寫入** —— heredoc 剝除⛔ 不得套用在餵給直譯器的標頭上(bash/sh/zsh/python/perl/node/…),那種內文會被執行。"
fi

# --- 1c. vault-guard 的**權責邊界**:主迴圈可讀寫、子代理一律擋 ---
# ⚠️ 架構師 2026-08-24 拍板:vault 讀寫權收歸主迴圈,⛔ 子代理一律不可(含 nr-planner)。
# ⚠️ 這支閘門唯一的**不安全**失效方向是「agent_type 欄不見了 ⇒ 全被當成主迴圈放行」,
#    下面第二段斷言就是釘它的——⛔ 不得刪。
VG="$DIR/vault-guard.sh"
if [ -x "$VG" ]; then
  vg_payload() { printf '{"tool_name":"Read"%s,"tool_input":{"file_path":"/Users/quasi-pc/Documents/Obsidian Vault/probe.md"}}' "$1"; }
  out=$(vg_payload "" | "$VG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    && add "⛔ vault-guard **擋住了主迴圈** —— vault 讀寫權專屬主迴圈,擋掉等於沒人維護得了知識庫。"
  for a in nr-planner nr-implementer nr-auditor; do
    out=$(vg_payload ",\"agent_type\":\"$a\"" | "$VG" 2>/dev/null)
    printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
      || add "⛔ vault-guard **放行了子代理 $a** —— 子代理一旦能自己去 vault 補洞,「任務包漏寫規格就會有人卡住回報」這個訊號就消失了。"
  done
fi

# --- 1d. audit-write-guard 的**誤殺 / 剝除**三格(2026-08-30 加)---
# ⚠️ 這一組是**實害**逼出來的:2026-08-30 nr-auditor 落檔時被誤擋
#    (報告內文的 markdown 引言 `>` 與被引用的 git 子指令都被當成真的寫入),
#    它為了寫得出去,把整份報告改寫成「不含任何 < > 字元的純散文」。
#    ⇒ **閘門逼出了繞道,還損害了報告品質**,而當時**沒有任何斷言看得見這件事**。
# ⚠️ 三格一組,⛔ 不得只留一格:誤殺不得回歸 / 直譯器不得被剝 / audit 檔仍寫得到。
AWG="$DIR/audit-write-guard.sh"
if [ -x "$AWG" ]; then
  aw() { jq -nc --arg c "$1" '{tool_name:"Bash",agent_type:"nr-auditor",tool_input:{command:$c}}'; }
  aw_ok=$(printf 'cat > docs/tasks/M0-0-verification-audit.md <<%sEOF%s\n> 結論:零必改\n我試過 git add 但被擋\nEOF\n' "'" "'")
  out=$(aw "$aw_ok" | "$AWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    && add "⛔ audit-write-guard **誤殺了稽核側的正當落檔** —— heredoc **內文**(markdown 引言 / 被引用的 git 子指令)⛔ 不得算數。⚠️ 不修的後果不是「稽核寫不出來」,是**它會繞道**:2026-08-30 實測它把報告改寫成不含 < > 的純散文才寫得出去。"
  aw_hole=$(printf 'bash <<EOF\necho x > CLAUDE.md\nEOF\n')
  out=$(aw "$aw_hole" | "$AWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ audit-write-guard **放行了藏在 bash heredoc 裡的寫入** —— heredoc 剝除⛔ 不得套用在餵給直譯器的標頭上(bash/sh/python/…),那種內文會被執行。⚠️ review-write-guard 2026-08-30 就是這樣被繞過的,⛔ 不要重犯。"
  aw_deny=$(printf 'echo x > CLAUDE.md\n')
  out=$(aw "$aw_deny" | "$AWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ audit-write-guard **放行了寫入 CLAUDE.md** —— 稽核側只寫得到那一個 audit 檔,寫入權鐵律已失效。"

  # --- Write 工具的 file_path 白名單(2026-08-30 改判)---
  # ⚠️ 改判理由:舊設計不給 Write、一律走 Bash heredoc,但那**沒讓防線變強**
  #    (它仍有 Bash,heredoc 照樣寫得到任何檔)⇒ 換到的只有「報告內文被當指令掃」這個壞處,
  #    2026-08-30 實害:報告被迫改寫成不含 < > 的純散文。改用 Write 後只看 file_path 一個欄位。
  # ⚠️ 三格一組:audit 檔要寫得到 / 其他檔要擋住 / Edit 這類面⛔ 不得被一起打開。
  awf() { jq -nc --arg t "$1" --arg f "$2" '{tool_name:$t,agent_type:"nr-auditor",tool_input:{file_path:$f}}'; }
  out=$(awf Write "docs/tasks/M0-0-verification-audit.md" | "$AWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    && add "⛔ audit-write-guard **擋住了稽核側用 Write 寫自己的 audit 檔** —— 那是它的正當產出。⛔ 擋掉它只會逼它回去用 heredoc 繞路,而那正是 2026-08-30 誤擋的來源。"
  out=$(awf Write "CLAUDE.md" | "$AWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ audit-write-guard **放行了 Write 寫 CLAUDE.md** —— Write 的白名單只該放行 audit 檔,寫入權鐵律已失效。"
  out=$(awf Edit "docs/tasks/M0-0-verification-audit.md" | "$AWG" 2>/dev/null)
  printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
    || add "⛔ audit-write-guard **放行了 Edit** —— 只該開 Write 一個面;報告是一次寫完的東西,⛔ 沒有理由多開 Edit / MultiEdit / NotebookEdit。"
fi

# --- 2. settings.json 有沒有把兩支 session 級閘門接上 ---
SETTINGS="$ROOT/settings.json"
if [ ! -f "$SETTINGS" ]; then
  add "⛔ .claude/settings.json 不存在 —— push-gate **沒有被掛上**,腳本再完好也不會被呼叫。"
else
  jq -e . "$SETTINGS" >/dev/null 2>&1 || add "⛔ .claude/settings.json **不是合法 JSON** —— 整份 hook 設定會被丟掉。"
  for g in push-gate gate-selfcheck review-write-guard vault-guard; do
    grep -q "$g.sh" "$SETTINGS" || add "⛔ settings.json 裡找不到 $g.sh —— 該項未接線。"
  done
fi

# --- 3. 兩個 subagent-scoped 閘門的接線 ---
# ⚠️ 這一段的形狀是實測逼出來的,⛔ 不是風格偏好:
#    ①簡寫 `- command:` 會被**靜默丟棄**(註冊碼要 matcher + 巢狀 hooks[]);
#    ②$CLAUDE_PROJECT_DIR 展開後含空格,未加引號 ⇒ hook 執行失敗 ⇒ 靜默放行。
check_agent() {
  local agent="$1" gate="$2" consequence="$3"
  local path="$ROOT/agents/$agent"
  [ -f "$path" ] || { add "⛔ .claude/agents/$agent 不存在。"; return; }
  local fm
  fm=$(awk 'NR>1 && /^---$/{exit} NR>1{print}' "$path")
  printf '%s' "$fm" | grep -q "$gate" \
    || add "⛔ $agent 的 frontmatter 沒有 $gate —— ${consequence}"
  printf '%s' "$fm" | grep -q 'matcher:' \
    || add "⛔ $agent 的 hooks 缺 \`matcher:\` —— 這是**簡寫形狀**,Claude Code 會靜默丟棄整條 hook。"
  printf '%s' "$fm" | grep -q 'type: command' \
    || add "⛔ $agent 的 hooks 缺 \`type: command\` —— 同上,會被靜默丟棄。"
  printf '%s' "$fm" | grep -q '"\$CLAUDE_PROJECT_DIR"' \
    || add "⛔ $agent 的 hook 路徑未以雙引號包住 \$CLAUDE_PROJECT_DIR —— 專案路徑含空格,展開後會執行失敗而靜默放行。"
}

check_agent "nr-implementer.md" "vault-guard.sh"       "實作側可自由讀 vault。"
check_agent "nr-implementer.md" "review-write-guard.sh" "實作側可自由寫 review/audit 並代填架構師批覆。"
check_agent "nr-auditor.md"     "audit-write-guard.sh" "稽核側可自由寫檔與動現場。"

# --- 4. 稽核側的寫入型工具:只准 Write,其餘一律不得出現 ---
# ⚠️ **2026-08-30 改判(架構師逐字「選 1」)**:本格原文是「⛔ 不得有寫入型工具(乙案的前提)」。
#    ⚠️ 乙案的**原始文件在 repo 內查無**(全專案只有本腳本提到它)⇒ ⛔ 不宣稱知道它的全部理由;
#    但本格自己寫出來的前提是「**它只能經 audit-write-guard 落那一個檔**」,
#    而該前提在改判後**仍然成立**:`Write` 現在也走 audit-write-guard,
#    以 file_path 白名單只放行 `{代號}-verification-audit.md`(見 §1d 的三格)。
#    ⇒ **界線未變,變的只是它用哪個工具寫。**
# ⚠️ 為什麼要放 `Write` 進來:舊設計逼稽核側走 Bash heredoc,而報告內文因此被當成
#    shell 指令掃描 —— 2026-08-30 實害:它把整份 19057 B 報告改寫成
#    「不含任何 < > 字元的純散文」才寫得出去。⛔ 閘門逼出繞道 = 閘門失敗的一種。
# ⛔ `Edit` / `MultiEdit` / `NotebookEdit` **仍不得出現**:報告是一次寫完的東西,
#    ⛔ 沒有理由多開三個面;而每多一個面,audit-write-guard 就多一條要顧的路徑。
AUD="$ROOT/agents/nr-auditor.md"
if [ -f "$AUD" ]; then
  grep -qE '^tools:.*\b(Edit|MultiEdit|NotebookEdit)\b' "$AUD" \
    && add "⛔ nr-auditor 的 tools: 出現 Edit / MultiEdit / NotebookEdit —— 只准 Write 一個面(2026-08-30 改判)。⛔ 多開一個面就多一條 audit-write-guard 要顧的路徑。"
fi

# --- 5. nr-planner ⛔ 不得被掛上 review-write-guard(掛了它就寫不出自己的正當產出)---
PLN="$ROOT/agents/nr-planner.md"
if [ -f "$PLN" ]; then
  awk 'NR>1 && /^---$/{exit} NR>1{print}' "$PLN" | grep -q 'review-write-guard.sh' \
    && add "⛔ nr-planner 的 frontmatter 掛了 review-write-guard —— 那兩個檔是**它的正當產出**,掛上等於整條驗證鏈寫不出東西。⛔ 這支閘門刻意不掛它。"
else
  add "⛔ .claude/agents/nr-planner.md 不存在。"
fi

# --- 收束 ---
[ -z "$PROBLEMS" ] && exit 0

MSG="⛔⛔ 閘門自檢失敗(gate-selfcheck)——編排的強制層已破損:${PROBLEMS}

⚠️ hook 失敗是**靜默放行**的:上面每一項都代表「看起來還在,實際上不擋了」。
⛔ 在修好之前不得開任何任務包、不得派任何子代理。請立刻把本段原文回報給 Yu,並停在這裡等指示。
修好後重開 session 讓本自檢重跑一次;⛔ 不要靠 '我看過了應該沒問題' 代替重跑。"

printf '%s\n' "$MSG" >&2

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg c "$MSG" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
fi
exit 0
