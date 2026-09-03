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
# ⚠️ **2026-09-02 改版**(架構師裁決:nr-planner 交接包第 3 題甲之 1 + 第 5 題):
#    原版只做**字面**比對,自捏 payload 實測 8 種寫法有 6 種放行
#    (相對路徑、Glob/Grep 以祖先目錄為根 + pattern 展開、Bash 萬用字元 / 拆字 / ~ / $HOME)。
#    現在分三層,任一層命中即擋:
#    ① 字面比對(原有,保留 —— 抓 URL-encoded 與 ~ 展開前的寫法);
#    ② **路徑正規化**:file_path / path 相對於 payload 的 cwd 補成絕對路徑、展開 ~、消掉 . 與 ..,
#       再看是否落在 vault 之下;Glob / Grep 另擋「以 vault 的**祖先**為根」(祖先為根 + pattern 就搜得進去)、
#       pattern / glob 含 `..`、以及 path 本身帶萬用字元(搜尋根不該有萬用字元);
#    ③ Bash 只能做啟發式:提到 ~/Documents、$HOME/Documents、/Users/quasi-pc/Documents、
#       `Obs?dian` 這類拆字、`Obs*` 這類萬用字元,一律擋。子代理在 Desktop/Projects 底下工作,⛔ 沒有正當理由碰 Documents。
#    ⚠️ 誠實邊界(⛔ 不要對它有超出的期待):Bash 用**變數拼接**把「Documents」本身拆開
#    (D=$HOME/Doc"u"ments)擋不住;repo 內若有指向 vault 的 symlink 也擋不住。前者是 shell 的本質,
#    後者靠「repo 內不放 symlink」的紀律。②③ 都是**字串**層面,⛔ 不呼叫 realpath(目標可能不存在、macOS 版本行為不一)。
#    ⚠️ 2026-09-02 工具層實測:Read **不展開** `?`(給 `Obs?dian` 回 File does not exist),但**會解析** `..`;
#       Glob / Grep 的展開行為在總管的 harness 裡**沒有那兩個工具**,⛔ 未實跑 —— 故 ② 對它們採「祖先即擋」的保守判準。

VAULT="/Users/quasi-pc/Documents/Obsidian Vault"
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)

# 純文字正規化:補 cwd、展開 ~、消 . 與 ..;⛔ 不碰檔案系統
norm() {
  local p="$1" out="" seg
  case "$p" in
    "~") p="$HOME" ;;
    "~/"*) p="${HOME}${p#\~}" ;;
    /*) ;;
    *) p="${cwd:-/}/$p" ;;
  esac
  local IFS='/'
  for seg in $p; do
    case "$seg" in
      ""|".") ;;
      "..") out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s' "${out:-/}"
}

under_vault() { case "$1" in "$VAULT"|"$VAULT"/*) return 0 ;; esac; return 1; }
ancestor_of_vault() { [ "$1" = "/" ] && return 0; case "$VAULT" in "$1"|"$1"/*) return 0 ;; esac; return 1; }

TAILMSG="⚠️ 任務包/派工訊息是你的唯一來源:裡面沒寫的規格就是**缺失**,請停手回報卡住,⛔ 不要去別處找。需要 vault 裡的東西 ⇒ 回報並停下;主迴圈⛔ 不得抄給你,須先落 repo(架構師 2026-09-02 裁決乙)。"
deny_path() {
  deny "⛔ vault-guard: 子代理(${agent_type})不得存取 Obsidian Vault —— vault 讀寫權**專屬主迴圈**。工具 ${tool_name} 的 $1 = [$2],$3。${TAILMSG}"
}

# ① 字面比對(原有):大小寫不敏感;涵蓋 raw、URL-encoded、以及 ~ 展開前的寫法
if printf '%s' "$payload" | grep -qiE 'Obsidian[ _]?(Vault|%20Vault)|/Users/quasi-pc/Documents/Obsidian'; then
  deny "⛔ vault-guard: 子代理(${agent_type})不得存取 Obsidian Vault(/Users/quasi-pc/Documents/Obsidian Vault/)——vault 讀寫權**專屬主迴圈**。工具 ${tool_name} 的參數命中 vault 路徑,已阻擋。${TAILMSG}"
fi

# ② 路徑正規化
case "$tool_name" in
  Read|Write|Edit|MultiEdit|NotebookEdit)
    fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null)
    if [ -n "$fp" ]; then
      n=$(norm "$fp")
      under_vault "$n" && deny_path "file_path" "$n" "正規化後落在 vault 之下"
      printf '%s' "$fp" | grep -q '[*?[]' && deny_path "file_path" "$fp" "帶萬用字元(檔案路徑不該有萬用字元)"
    fi
    ;;
  Glob|Grep)
    p=$(printf '%s' "$input" | jq -r '.tool_input.path // ""' 2>/dev/null)
    printf '%s' "$p" | grep -q '[*?[]' && deny_path "path" "$p" "搜尋根帶萬用字元(搜尋根不該有萬用字元)"
    n=$(norm "${p:-.}")
    under_vault "$n" && deny_path "path" "$n" "正規化後落在 vault 之下"
    ancestor_of_vault "$n" && deny_path "path" "$n" "是 vault 的祖先目錄(以祖先為根 + pattern 就搜得進 vault)"
    # Glob 的 pattern 是檔案樣式;Grep 的 pattern 是**正規表示式**(含 .. 很正常)⇒ Grep 只看 glob 欄
    if [ "$tool_name" = "Glob" ]; then
      pg=$(printf '%s' "$input" | jq -r '.tool_input.pattern // ""' 2>/dev/null)
    else
      pg=$(printf '%s' "$input" | jq -r '.tool_input.glob // ""' 2>/dev/null)
    fi
    if printf '%s' "$pg" | grep -qE '(^|/)\.\.(/|$)|^/|^~'; then
      deny_path "pattern/glob" "$pg" "含 ..、絕對路徑或 ~(可從搜尋根往上爬)"
    fi
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
    if printf '%s' "$cmd" | grep -qiE 'obs.{0,3}dian|(^|[^a-z])obs[*?[]|(/users/quasi-pc|\$home|\$\{home\}|~)/documents'; then
      deny_path "command" "(啟發式命中)" "疑似以萬用字元、拆字、~ 或 \$HOME 寫法指向 vault"
    fi
    ;;
esac

exit 0
