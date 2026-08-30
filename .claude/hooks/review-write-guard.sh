#!/bin/bash
# review-write-guard.sh — PreToolUse hook
#   掛載點:①.claude/settings.json(涵蓋主迴圈**與所有子代理**)②nr-implementer 的 frontmatter(冗餘防線)
#
# 擋什麼:寫入 docs/tasks/{代號}-plan-review.md 與 {代號}-verification-audit.md,
#         **除非**發動者是主迴圈(見「主迴圈放行」段)或在白名單內(見 ALLOWED_AGENTS)。
#
# 為什麼:WORKFLOW 的寫入權鐵律(2026-08-19 事故促成)原本靠**自律**——
# 「實作側不得寫 review/audit、不得代填架構師批覆」。M1-7 產包時發現一個破口:
# 新編排把協作側(nr-planner)搬進 Claude Code 行程內跑,於是「誰寫的」這條界
# 在檔案系統上**不再有任何機制對應**——同一個行程裡,主迴圈與實作側同樣寫得到那兩個檔。
# ⚠️ 批覆記錄由非裁決方寫入即屬**偽造**,內容碰巧正確也不改變性質:
#    檔案管道的全部價值來自「誰寫的」。本閘門把它從紀律變成機制(同 audit-write-guard 的思路)。
#
# ⚠️ 身分判定用 payload 的 `agent_type`——**這是實測結果,⛔ 不是推測**(2026-08-24 探針取樣):
#    子代理的 PreToolUse payload **多出** `agent_type` 與 `agent_id` 兩欄(`agent_type` 即代理名),
#    主迴圈**整個 key 不存在**;`session_id` / `transcript_path` / `prompt_id` 主子**完全相同**
#    ⇒ ⛔ 不能用 session 或 transcript 分辨誰是誰,只有 `agent_type` 分得開。
#    ⚠️ 2026-08-24 原本把主迴圈記成「兩欄皆 null」,**那是錯的** ——
#    `jq -r '.agent_type // ""'` 對「缺 key」與「值為 null」回傳相同的空字串,當初分不出來;
#    2026-08-29 用 `jq -e 'has("agent_type")'` 才驗到是**缺 key**。⛔ 別再用「皆 null」推論別的東西。
#    ⚠️ 同一次取樣也證實:**settings.json 的 hook 會下沉到子代理**
#    (第一版把本閘門掛在 settings.json 就一併擋住了 nr-planner,當場現形)⇒
#    ⛔ 沒有「只掛主迴圈」這種掛法,白名單是唯一解。
#
# ⚠️ 誠實的邊界(⛔ 不要對這支閘門有超出它能力的期待):
#   ①它擋的是**寫入**,⛔ 不驗內容。「批覆是不是逐字轉錄架構師原話」機器驗不了,
#     那條仍是 WORKFLOW 的紀律條款(見 WORKFLOW「批覆回填規則」)。
#   ②讀取一律放行——主迴圈與實作側**必須**讀得到 review 才知道要改什麼。
#   ③寬擋:命令字串同時出現目標檔名與寫入跡象(重導向/tee/sed -i/cp/mv/rm/…)就擋,
#     即使那只是出現在 grep 樣式或備份指令裡。偏安全方向,同 audit-write-guard 誤殺 `ls | grep touch`。
#     ⚠️ 撞到時的正確反應是**拆開指令**或改用檔案編輯工具,⛔ 不是放寬本閘門。
#     ⚠️ **例外已修**(2026-08-29,改 ②):heredoc **內文**不再算數,見下方「heredoc 內文剝除」。
#   ④`agent_type` 由 harness 填寫,⛔ 不是模型可自報的欄位。⚠️ **2026-08-29 起失效方向翻轉**:
#     主迴圈放行段用的是「沒有 agent_type」,harness 若改名或移除該欄 ⇒ 所有呼叫都被當成主迴圈
#     ⇒ **一律放行**(fail-open),⛔ 不再是舊註解說的「一律阻擋」。
#     ⚠️ 而且 gate-selfcheck **抓不到** —— 它餵的自捏 payload 仍帶著該欄,會維持全綠。
#     ⇒ 掩護不在這裡:本 guard 另掛在 nr-implementer 的 frontmatter 上(見 gate-selfcheck §4),
#     那條不依賴 payload 任何欄位。這是接受風險後的**明示取捨**,⛔ 不是疏漏。
#   ⑤⚠️ **它只看得見 shell 層的寫入**(重導向 / tee / rm / cp / mv / sed -i / …)。
#     `python3 -c "open(...,'w')"` 或 `node -e "fs.writeFileSync(...)"` **⛔ 擋不住**——
#     2026-08-30 實測,且**修補前後皆然**(拿 e687cdc 的版本跑同一發也是放行)
#     ⇒ ⛔ 這**不是** heredoc 剝除造成的,是本閘門的**原有邊界**。
#     要擋得住得換成檔案系統層的機制,那是另一件事。⛔ 不要對本閘門有超出這個範圍的期待。

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
  deny "⛔ review-write-guard: 無法解析 PreToolUse 輸入(非合法 JSON),依 fail-closed 一律阻擋。⚠️ 這代表閘門本身處於不可信狀態,請回報 Yu,⛔ 不要繞過。"
fi

# --- 白名單:這兩個代理寫這兩個檔是它們的**正當產出** ---
# nr-planner  → {代號}-plan-review.md
# nr-auditor  → {代號}-verification-audit.md(它另有 audit-write-guard 把它鎖在那一個檔上)
# ⚠️ **2026-08-29 改判**:主迴圈落不進白名單,但下方有專屬放行段 ⇒ **不再被擋**。
#    理由:批覆內容完全來自主迴圈交給 nr-planner 的派工訊息,planner 一個字都無從查證
#    ⇒ 主迴圈要偽造在派工訊息裡偽造即可,本閘門攔不住;它增加的完整性接近零,
#    成本卻是每個裁決一次完整的代理往返(M1-8 實測 9 次以上)。
#    ⇒ 本閘門的對象收斂為「非裁決方的**實作側**」,那才是 2026-08-19 事故的真正形狀。
ALLOWED_AGENTS="nr-planner nr-auditor"
agent_type=$(printf '%s' "$input" | jq -r '.agent_type // ""' 2>/dev/null)
for a in $ALLOWED_AGENTS; do
  [ "$agent_type" = "$a" ] && exit 0
done

# --- 主迴圈放行(架構師 2026-08-29 裁決)---
# ⚠️⚠️ 判別只能看「值為空」,⛔ 不可加 jq has("agent_type") 這一層:
#    2026-08-29 實測 —— 真實主迴圈 payload **根本沒有 agent_type 這個 key**。
#    ⇒ 「主迴圈」與「harness 移除該欄」在檔面上是同一個輸入,⛔ 無法用本欄分開,
#    加了 has() 的效果不是 fail-closed,是**放行段永不觸發**(主迴圈每次都被擋)。
#    ⚠️ 這個坑**自捏 payload 驗不出來**(捏得出 has 為真的形狀)⇒ 驗它必須用真實 Write。
# ⚠️ fail-open 的顧慮由**另一條路**掩護,⛔ 不靠這一行:見標頭 ④。
if [ -z "$agent_type" ]; then
  exit 0
fi

TARGETS='\-(plan-review|verification-audit)\.md'
PREFIX="⛔ review-write-guard: {代號}-plan-review.md 與 {代號}-verification-audit.md 只有 nr-planner / nr-auditor 寫得到,而你是 [${agent_type}]。"
TAIL="⚠️ 批覆記錄由非裁決方寫入即屬偽造,內容碰巧正確也一樣——檔案管道的全部價值來自「誰寫的」。有要回報的事(裁示請求、審核意見、發現前提錯誤),一律寫進**自己產出的檔**(plan / verification)或另立回報檔,然後停下來等對方處理。⛔ 看到 review/audit 不存在時,正確動作是等待,不是補上。讀取不受限制。"

# --- 1. 寫入型工具:比對 file_path / notebook_path ---
case "$tool_name" in
  Write|Edit|MultiEdit|NotebookEdit)
    fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null)
    if printf '%s' "$fp" | grep -qE "$TARGETS"; then
      deny "${PREFIX}偵測到 ${tool_name} 寫入 [${fp}]。${TAIL}"
    fi
    exit 0
    ;;
esac

[ "$tool_name" = "Bash" ] || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)

# --- heredoc 內文剝除(2026-08-29,改 ②)---
# ⚠️ 為什麼要剝:下方四條比對掃的是整個 command 字串,分不出「指令」與「heredoc 內文」。
#    ⇒ nr-implementer 寫自己的 plan 時,只要內文引用一句反例
#    (例:⛔ 不可以 echo x > docs/tasks/…-plan-review.md)整條指令就被擋。2026-08-29 實測重現。
# ⚠️ 剝內文**不會**放過真的寫入:重導向 / tee / rm / sed -i 一定落在 heredoc **標頭那一行**,標頭保留。
#    實測 21/21(2026-08-30 補洞後重跑):六發真寫入仍 DENY(含 `cat > <review> <<EOF` 這種標頭寫法)、六發誤殺消失、
#    五發既有行為不變(讀取放行、git mv 維持擋)。
# ⚠️ `\047` 是 awk 的單引號八進位跳脫 —— 這樣整段程式裡沒有字面單引號,才塞得進外層的 '...'。
#    ⛔ 不得改寫成 ['"] 那種字元類。
# ⚠️ 已知限制(⛔ 據實記,不是沒想到):一行有多個 heredoc 只認第一個;`<<` 出現在引號字串內
#    會被誤認成標頭 ⇒ 後續幾行被剝掉,失效方向是**放行**。要更嚴得真的 parse shell,不划算。
# ⚠️⚠️ **2026-08-30 補洞(⛔ 這是 2026-08-29 那次修補自己造成的回歸)**:
#    剝除**只適用於資料型 heredoc**。`bash <<EOF … EOF` 的內文**會被執行** ——
#    剝掉它等於開一條「把寫入藏進 heredoc」的路。實測(引入剝除之後、補洞之前):
#    `bash <<EOF` 與 `sh <<'SH'` **兩種都放行了真正的寫入**。
#    ⇒ 標頭行若餵給直譯器(bash/sh/zsh/ksh/dash/python*/perl/ruby/node/env/eval/xargs),
#    **⛔ 不剝**,內文照掃。⚠️ 2026-08-29 的 17 格矩陣沒有涵蓋這種形狀;本閘門的能力邊界見標頭 ⑤。
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

# 命令沒提到目標檔名 ⇒ 與本閘門無關,直接放行(⛔ 不做無關的廣泛攔截)
printf '%s' "$cmd" | grep -qE "$TARGETS" || exit 0

# --- 2. 重導向到目標檔 ---
if printf '%s' "$cmd" | grep -qE '>>?[[:space:]]*[^[:space:];|&()]*'"$TARGETS"; then
  deny "${PREFIX}偵測到 shell 重導向寫入該檔。${TAIL}"
fi

# --- 3. 檔案改動類指令 / 原地編輯(命令已確定提到目標檔名) ---
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|&&|\|\||[[:space:]])(rm|mv|cp|tee|truncate|dd|install|ln|touch|unlink|shred|patch)([[:space:]]|$)'; then
  deny "${PREFIX}偵測到檔案改動類指令(rm/mv/cp/tee/touch/…)指向該檔。${TAIL}"
fi
if printf '%s' "$cmd" | grep -qE '\b(sed|perl|awk)\b[^|;]*[[:space:]]-i'; then
  deny "${PREFIX}偵測到原地編輯(sed -i / perl -i)指向該檔。${TAIL}"
fi

exit 0