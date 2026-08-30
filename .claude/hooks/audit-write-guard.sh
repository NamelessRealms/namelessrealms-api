#!/bin/bash
# audit-write-guard.sh — PreToolUse hook (subagent-scoped: nr-auditor)
#
# 稽核側有 Bash ⇒ heredoc 寫得到任何檔;**光靠工具清單擋不住它**。
# 本閘門把「稽核側只寫得到那一個檔」從**紀律**變成**機制**。
#
# 放行:唯一可寫的目標是 docs/tasks/{代號}-verification-audit.md(以及 /dev/null)。
#
# ⚠️ **2026-08-30 改判:改為給它 `Write`,並在此以 file_path 白名單放行。**
#    舊設計不給 Write/Edit、一律走 Bash heredoc。但那**沒有讓防線變強** ——
#    它仍然有 Bash,heredoc 照樣寫得到任何檔,所以下方的 shell 掃描本來就非做不可。
#    換到的**只有壞處**:報告內文被塞進命令字串裡,而掃描分不出「指令」與「內文」
#    ⇒ 2026-08-30 實害:報告裡的 markdown 引言 `>` 與被引用的 git 子指令觸發誤擋,
#    nr-auditor 為了寫得出去,把整份 19057 B 報告改寫成「不含任何 < > 字元的純散文」。
#    ⇒ 改用 `Write` 之後,判斷只看 **file_path 一個欄位**,報告內文**根本不進掃描** ——
#    這一整類誤擋在結構上消失。⚠️ 防線⛔ 未放寬:Bash 那條路徑一行未動、照掃。
#    ⚠️ **只放行 `Write`**:`Edit` / `MultiEdit` / `NotebookEdit` 仍一律擋
#    ——報告是一次寫完的東西,⛔ 沒有理由多開三個面。
# 阻擋:其餘一切 shell 層的檔案改動 —— 重導向、tee、sed -i、cp/mv/rm/touch/chmod、
#       以及所有會動到 repo 現場的 git 子指令(checkout / reset / clean / add / commit / push …)。
#       ⚠️ 稽核側動到現場 = 把「聲稱 vs 現場」的比較基準毀掉,比寫錯檔嚴重得多。
#
# ⚠️ 誠實的邊界(⛔ 不要對這支閘門有超出它能力的期待):
#   ①它管的是 **shell 層**的檔案改動。`./gradlew test` 或 `docker compose up` 會寫
#     build/ 與 log,本閘門看不見、也**不該**看見 —— 鐵則 1 要的就是實跑。
#   ②寬擋:命令字串裡出現 rm/cp/mv/touch 這些詞就擋,即使只是出現在 grep 樣式裡
#     (例:`ls | grep touch` 會被誤殺)。偏安全方向(同 review-write-guard 的寬擋)。
#   ③只放行 /dev/null 與 audit 檔,⛔ 不放行 /tmp —— 一旦能寫暫存腳本,
#     「寫檔 → 下一次呼叫執行它」就繞過本閘門了。
#   ⑥⚠️ `Write` 的白名單比對的是 **file_path 字串**,⛔ 不是真實路徑
#     ⇒ `/tmp/docs/tasks/x-verification-audit.md` 這種**會過**。
#     ⚠️ 據實記,⛔ 不假裝修乾淨了;它與下方 shell 重導向白名單是**同一個判準**,
#     風險等同、⛔ 未因本次改動而升高。
#   ④⚠️ **heredoc 內文不算數**(2026-08-30 加)——見下方「heredoc 內文剝除」。
#     ⚠️ 這是**實害**逼出來的:nr-auditor 落檔時,報告內文只要有 markdown 引言 `>`
#     或引用到 git 子指令,整條指令就被擋 ⇒ 它把整份報告改寫成
#     「不含任何 < > 字元的純散文」才寫得出去。**閘門逼出了繞道,還損害了報告品質。**
#   ⑤⚠️ 殘餘誤擋(⛔ 據實記,⛔ 不假裝修乾淨了):`grep "a -> b.md" f` 這種
#     ——引號字串內的 `>` 後面緊跟著一個詞——仍會被當成重導向目標而擋。
#     ⚠️ 但 `grep -n "case X ->" f.java`(`>` 後面只有引號)**已放行**,見下方 §1 的引號跳過。

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)

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
  deny "⛔ audit-write-guard: 無法解析 PreToolUse 輸入(非合法 JSON),依 fail-closed 一律阻擋。⚠️ 這代表閘門本身處於不可信狀態,請回報 Yu,⛔ 不要繞過。"
fi

PREFIX="⛔ audit-write-guard: 稽核側只寫得到 docs/tasks/{代號}-verification-audit.md,其餘一切檔案改動一律阻擋。"
TAIL="⚠️ 稽核側動到現場,就毀掉了「聲稱 vs 現場」的比較基準。落檔請直接用 **Write 工具**寫 docs/tasks/{代號}-verification-audit.md(2026-08-30 起放行)——⚠️ 這樣報告內文⛔ 不會被當成 shell 指令掃描,markdown 引言與程式碼片段可以照原樣寫。⛔ 不需要再用 heredoc 繞路。"

# --- 寫入型工具 ---
# ⚠️ `Write` 走 file_path 白名單(2026-08-30 改判,理由見檔頭);
#    `Edit` / `MultiEdit` / `NotebookEdit` **仍一律擋**,⛔ 不多開面。
case "$tool_name" in
  Write)
    fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
    printf '%s' "$fp" | grep -qE '(^|/)docs/tasks/[^/]+-verification-audit\.md$' && exit 0
    deny "${PREFIX}偵測到 Write 寫入 [${fp}]。${TAIL}"
    ;;
  Edit|MultiEdit|NotebookEdit)
    deny "${PREFIX}(工具 ${tool_name} 仍一律阻擋 —— 報告請用 Write 一次寫完。)${TAIL}"
    ;;
esac

[ "$tool_name" = "Bash" ] || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)

# --- heredoc 內文剝除(2026-08-30)---
# ⚠️ 為什麼要剝:下方四段掃的是整串命令字串,分不出「指令」與「heredoc 內文」。
#    稽核側落檔用的正是 `cat > <audit 檔> <<'EOF' … EOF`,而報告內文本來就會出現
#    markdown 引言 `>`、Java 的 `->`、以及被引用的 git 子指令 ⇒ 誤擋。2026-08-30 實測有實害。
# ⚠️ 剝內文⛔ 不會放過真的寫入:重導向落在 heredoc **標頭那一行**,標頭保留
#    (上方 TAIL 推薦的寫法正是這個形狀)。
# ⚠️⚠️ **餵給直譯器的 heredoc ⛔ 不剝** —— `bash <<EOF … EOF` 的內文**會被執行**,
#    那是程式碼不是資料;剝了等於開一條「把寫入藏進 heredoc」的路。
#    ⚠️ 這一條是 review-write-guard 2026-08-30 的**實際教訓**(它先漏了,實測可繞),
#    ⛔ 不要在這裡重犯。
# ⚠️ `\047` 是 awk 的單引號八進位跳脫,讓整段程式不含字面單引號 ⇒ 塞得進外層的 '...'。
cmd=$(printf '%s' "$cmd" | awk '
  BEGIN { ind = 0 }
  {
    if (ind) {
      line = $0
      sub(/^[ \t]+/, "", line)
      if (line == delim) { ind = 0 }
      next
    }
    if (match($0, /<<-?[ \t]*["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
      if ($0 ~ /(^|[ \t;&|(])(bash|sh|zsh|ksh|dash|python[0-9.]*|perl|ruby|node|env|eval|xargs)([ \t]|$)/) { print; next }
      delim = substr($0, RSTART, RLENGTH)
      sub(/^<<-?[ \t]*/, "", delim)
      gsub(/["\047]/, "", delim)
      ind = 1
    }
    print
  }
')

# --- 1. 重導向目標逐一比對白名單 ---
# 2>&1 這種不會被匹配到(`>` 後面接 & 不符合目標字元集),刻意如此。
targets=$(printf '%s' "$cmd" | grep -oE '[0-9]?>>?\|?[[:space:]]*[^[:space:];|&()]+' 2>/dev/null)
if [ -n "$targets" ]; then
  while IFS= read -r raw; do
    [ -n "$raw" ] || continue
    tgt=$(printf '%s' "$raw" | sed -E 's/^[0-9]?>>?\|?[[:space:]]*//')
    case "$tgt" in
      /dev/null|/dev/stdout|/dev/stderr) continue ;;
    esac
    # ⚠️ 抽出來的「目標」若整串只是引號字元,那不可能是檔名 —— 它來自 Java 的 `->`
    #    (例:grep -n "case X ->" f.java ⇒ `>` 後面接的是收尾的雙引號)。2026-08-30 誤擋實例。
    # ⛔ 這不開洞:`echo x->CLAUDE.md` 抽到的目標是 CLAUDE.md,照擋。
    printf '%s' "$tgt" | grep -qE "^[\"']+$" && continue
    printf '%s' "$tgt" | grep -qE '(^|/)docs/tasks/[^/]+-verification-audit\.md$' && continue
    deny "${PREFIX}偵測到寫入目標:[${tgt}]。${TAIL}"
  done <<< "$targets"
fi

# --- 2. 檔案改動類指令 ---
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|&&|\|\||[[:space:]])(rm|mv|cp|tee|truncate|dd|install|ln|chmod|chown|mkdir|rmdir|touch|unlink|shred|patch)([[:space:]]|$)'; then
  deny "${PREFIX}偵測到檔案改動類指令(rm/mv/cp/tee/touch/chmod/… 之一)。${TAIL}"
fi

# --- 3. 原地編輯 ---
if printf '%s' "$cmd" | grep -qE '\b(sed|perl)\b[^|;]*[[:space:]]-i'; then
  deny "${PREFIX}偵測到原地編輯(sed -i / perl -i)。${TAIL}"
fi

# --- 4. 會動到 repo 現場的 git 子指令 ---
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|&&|\|\||[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]]+)?)*[[:space:]]+(checkout|reset|clean|restore|stash|rebase|merge|revert|apply|cherry-pick|add|switch|gc|prune|commit|push|pull|fetch|tag|remote|config|worktree|filter-branch|update-ref)([[:space:]]|$)'; then
  deny "${PREFIX}偵測到會改動 repo 現場的 git 子指令。⚠️ 稽核側一律唯讀:status / log / diff / show / rev-parse / ls-files / cat-file / blame 可用,其餘⛔ 不可。${TAIL}"
fi

exit 0