#!/bin/bash
#
# daily-builder :: start.sh
#
# Modes:
#   (default)           interactive launcher — auto-detects unfinished project
#                       or offers mode switch (surprise / guided / wishlist)
#   --polish <repo>     run the finishing-pass prompt on an existing project
#   --evaluate <repo>   run the evaluator on an existing project and print result
#   --resume <repo>     resume a specific project (bypasses unfinished-detection)
#   --help              show this help
#
# Mode switch prompts for: [s]urprise / [g]uided / [w]ishlist (5s default → s).
#
# See ~/daily-builder/lib/ for the Python helpers this script calls.

set -o pipefail

# ── Colors ────────────────────────────────────────────
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Paths ─────────────────────────────────────────────
DAILY_BUILDER="$HOME/daily-builder"
PROJECTS_DIR="$HOME/dev/daily-projects"
PROMPTS_DIR="$DAILY_BUILDER/prompts"
DASHBOARD_DIR="$DAILY_BUILDER/dashboard"
LIB_DIR="$DAILY_BUILDER/lib"
HISTORY_FILE="$DAILY_BUILDER/project_history.md"
WISHLIST_FILE="$DAILY_BUILDER/wishlist.md"
LOG_FILE="$DAILY_BUILDER/session.log"
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M)

mkdir -p "$PROJECTS_DIR"

log() {
    printf "[%s %s] %s\n" "$DATE" "$TIME" "$1" >> "$LOG_FILE"
}
log ""
log "Session started"

# ── Python helpers ────────────────────────────────────
PY() {
    PYTHONPATH="$DAILY_BUILDER" python3 "$@"
}

# ── Argument parsing ──────────────────────────────────
MODE_OVERRIDE=""
POLISH_TARGET=""
EVALUATE_TARGET=""
RESUME_TARGET=""

while [ $# -gt 0 ]; do
    case "$1" in
        --polish)
            POLISH_TARGET="$2"
            shift 2
            ;;
        --evaluate)
            EVALUATE_TARGET="$2"
            shift 2
            ;;
        --resume)
            RESUME_TARGET="$2"
            shift 2
            ;;
        --mode)
            MODE_OVERRIDE="$2"
            shift 2
            ;;
        --help|-h)
            cat <<EOF
daily-builder — start.sh

Usage:
  start.sh                           interactive launcher
  start.sh --mode surprise|guided|wishlist
                                     skip the mode prompt
  start.sh --resume <repo-name>      resume a specific project
  start.sh --polish <repo-name>      run finishing pass on a project
  start.sh --evaluate <repo-name>    run evaluator on a project

Files:
  Wishlist:   ~/daily-builder/wishlist.md
  Config:     ~/daily-builder/config.json
  History:    ~/daily-builder/project_history.md
  Dashboard:  http://localhost:8765
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ── Header ────────────────────────────────────────────
clear
echo ""
echo -e "${BLUE}${BOLD}  ██████╗  █████╗ ██╗██╗  ██╗   ██╗${RESET}"
echo -e "${BLUE}${BOLD}  ██╔══██╗██╔══██╗██║██║  ╚██╗ ██╔╝${RESET}"
echo -e "${BLUE}${BOLD}  ██║  ██║███████║██║██║   ╚████╔╝ ${RESET}"
echo -e "${BLUE}${BOLD}  ██║  ██║██╔══██║██║██║    ╚██╔╝  ${RESET}"
echo -e "${BLUE}${BOLD}  ██████╔╝██║  ██║██║███████╗██║   ${RESET}"
echo -e "${BLUE}${BOLD}  ╚═════╝ ╚═╝  ╚═╝╚═╝╚══════╝╚═╝  ${RESET}"
echo -e "${CYAN}${BOLD}         BUILDER  —  $DATE${RESET}"
echo ""
echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
echo ""

# ── Start dashboard server in background ──────────────
echo -e "  ${GREEN}▶${RESET} Starting dashboard..."
pkill -f "dashboard/server.py" 2>/dev/null
sleep 1
python3 "$DASHBOARD_DIR/server.py" &
DASHBOARD_PID=$!
sleep 1
echo -e "  ${GREEN}✓${RESET} Dashboard running at ${CYAN}http://localhost:8765${RESET}"
open "http://localhost:8765" 2>/dev/null || true
echo ""

cleanup() {
    kill "$DASHBOARD_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ── Polish mode ───────────────────────────────────────
if [ -n "$POLISH_TARGET" ]; then
    PROJECT_DIR="$PROJECTS_DIR/$POLISH_TARGET"
    if [ ! -d "$PROJECT_DIR" ]; then
        echo -e "  ${RED}✗${RESET} Project not found: $POLISH_TARGET"
        exit 1
    fi
    echo -e "  ${MAGENTA}◆${RESET} Finishing pass on ${BOLD}$POLISH_TARGET${RESET}..."
    log "Finishing pass: $POLISH_TARGET"
    cd "$PROJECT_DIR"
    echo ""
    echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
    echo ""
    claude --dangerously-skip-permissions \
        -p "$(cat "$PROMPTS_DIR/finishing_pass.md")"
    exit 0
fi

# ── Evaluate mode ─────────────────────────────────────
if [ -n "$EVALUATE_TARGET" ]; then
    PROJECT_DIR="$PROJECTS_DIR/$EVALUATE_TARGET"
    if [ ! -d "$PROJECT_DIR" ]; then
        echo -e "  ${RED}✗${RESET} Project not found: $EVALUATE_TARGET"
        exit 1
    fi
    echo -e "  ${MAGENTA}◆${RESET} Evaluating ${BOLD}$EVALUATE_TARGET${RESET}..."
    log "Evaluate: $EVALUATE_TARGET"
    PY - <<PYEOF
import json
from pathlib import Path
from lib.evaluate import evaluate, record_in_history
from lib.paths import HISTORY_FILE

proj = Path("$PROJECT_DIR")
result = evaluate(proj)
print(json.dumps(result.to_dict(), indent=2))
record_in_history(proj.name, result, HISTORY_FILE)
PYEOF
    exit 0
fi

# ── Explicit resume target ────────────────────────────
UNFINISHED=""
if [ -n "$RESUME_TARGET" ]; then
    if [ -d "$PROJECTS_DIR/$RESUME_TARGET" ]; then
        UNFINISHED="$PROJECTS_DIR/$RESUME_TARGET/"
    else
        echo -e "  ${RED}✗${RESET} Project not found: $RESUME_TARGET"
        exit 1
    fi
fi

# ── Auto-detect unfinished project via git (not state.md) ─
if [ -z "$UNFINISHED" ]; then
    CANDIDATE=$(PY - <<'PYEOF'
from lib.paths import PROJECTS_DIR, Config
from lib.project_state import find_resumable

cfg = Config.load()
project = find_resumable(PROJECTS_DIR, cfg)
if project is not None:
    print(project.path)
PYEOF
)
    if [ -n "$CANDIDATE" ]; then
        UNFINISHED="$CANDIDATE/"
    fi
fi

# ── Resume path ───────────────────────────────────────
if [ -n "$UNFINISHED" ]; then
    PROJECT_NAME=$(basename "$UNFINISHED")
    echo -e "  ${YELLOW}◉${RESET} Unfinished project detected:"
    echo ""
    echo -e "  ${BOLD}  $PROJECT_NAME${RESET}"
    echo ""

    PY - <<PYEOF
from pathlib import Path
from lib.project_state import get_state, get_progress

state = get_state(Path("$UNFINISHED".rstrip("/")))
completed, total, display = get_progress(Path("$UNFINISHED".rstrip("/")))
print(f"  Status:   {state.status} ({state.reason})")
print(f"  Progress: {display}")
if state.last_commit_at:
    print(f"  Last:     {state.last_commit_hash} {state.last_commit_subject}")
PYEOF

    echo ""
    echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
    echo ""
    printf "  Resume this project? ${BOLD}(y/n):${RESET} "
    read -r ANSWER

    if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
        echo ""
        echo -e "  ${GREEN}▶${RESET} Resuming ${BOLD}$PROJECT_NAME${RESET}..."
        log "Resuming: $PROJECT_NAME"
        cd "$UNFINISHED"
        echo ""
        echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
        echo ""
        claude --dangerously-skip-permissions

        # After Claude exits, run evaluator
        echo ""
        echo -e "  ${MAGENTA}◆${RESET} Running evaluator..."
        PY - <<PYEOF
from pathlib import Path
from lib.evaluate import evaluate, record_in_history
from lib.paths import HISTORY_FILE, Config

proj = Path("$UNFINISHED".rstrip("/"))
cfg = Config.load()
result = evaluate(proj, cfg)
print(f"  Score: {result.score}/100 (heuristic: {result.heuristic.score})")
if result.needs_finishing_pass:
    print(f"  ${YELLOW}◉{RESET} Score below {cfg.auto_suggest_below_score}. Suggest: start.sh --polish {proj.name}")
record_in_history(proj.name, result, HISTORY_FILE)
PYEOF
        exit 0
    else
        echo ""
        echo -e "  ${YELLOW}Skipping resume. Starting a new project instead.${RESET}"
        echo ""
        UNFINISHED=""
    fi
fi

# ── Mode switch ───────────────────────────────────────
SELECTED_MODE=""
if [ -n "$MODE_OVERRIDE" ]; then
    SELECTED_MODE="$MODE_OVERRIDE"
else
    echo -e "  ${BOLD}Pick a mode${RESET}:"
    echo -e "    ${GREEN}s${RESET} — ${BOLD}surprise${RESET}   LRU domain + auto-generate idea"
    echo -e "    ${CYAN}g${RESET} — ${BOLD}guided${RESET}     pick domain + give angle"
    echo -e "    ${MAGENTA}w${RESET} — ${BOLD}wishlist${RESET}   pick from wishlist.md"
    echo ""
    printf "  ${BOLD}Choice (s/g/w):${RESET} "

    read -r MODE_INPUT
    case "$MODE_INPUT" in
        g|G|guided) SELECTED_MODE="guided" ;;
        w|W|wishlist) SELECTED_MODE="wishlist" ;;
        s|S|surprise|"") SELECTED_MODE="surprise" ;;
        *) SELECTED_MODE="surprise" ;;
    esac
fi

echo ""
echo -e "  ${GREEN}▶${RESET} Mode: ${BOLD}$SELECTED_MODE${RESET}"
log "Mode: $SELECTED_MODE"
echo ""

# ── Build the domain + angle prompt additions ─────────
DOMAIN_LABEL=""
EXTRA_CONTEXT=""

if [ "$SELECTED_MODE" = "surprise" ]; then
    DOMAIN_PICK=$(PY - <<'PYEOF'
from lib.paths import HISTORY_FILE, Config
from lib.pick_domain import pick
cfg = Config.load()
p = pick(HISTORY_FILE, cfg)
print(f"{p.key}|{p.label}|{p.reason}")
PYEOF
)
    DOMAIN_KEY=$(echo "$DOMAIN_PICK" | cut -d'|' -f1)
    DOMAIN_LABEL=$(echo "$DOMAIN_PICK" | cut -d'|' -f2)
    DOMAIN_REASON=$(echo "$DOMAIN_PICK" | cut -d'|' -f3)
    echo -e "  ${CYAN}Domain:${RESET} $DOMAIN_LABEL"
    echo -e "  ${DIM}  $DOMAIN_REASON${RESET}"
    EXTRA_CONTEXT="DOMAIN: $DOMAIN_LABEL"

elif [ "$SELECTED_MODE" = "guided" ]; then
    echo -e "  ${BOLD}Pick a domain${RESET}:"
    echo "    1 — Cybersecurity and Offensive/Defensive Security Tools"
    echo "    2 — Systems Programming and Low-Level CS"
    echo "    3 — Big Data, Data Engineering and Analytics Pipelines"
    echo "    4 — AI/ML Engineering and Applied Intelligence"
    echo "    5 — Network Engineering and Distributed Systems"
    echo "    6 — Developer Tooling, CLIs and Platform Engineering"
    echo ""
    printf "  ${BOLD}Choice (1-6):${RESET} "
    read -r DOMAIN_CHOICE

    case "$DOMAIN_CHOICE" in
        1) DOMAIN_LABEL="Cybersecurity and Offensive/Defensive Security Tools" ;;
        2) DOMAIN_LABEL="Systems Programming and Low-Level CS" ;;
        3) DOMAIN_LABEL="Big Data, Data Engineering and Analytics Pipelines" ;;
        4) DOMAIN_LABEL="AI/ML Engineering and Applied Intelligence" ;;
        5) DOMAIN_LABEL="Network Engineering and Distributed Systems" ;;
        *) DOMAIN_LABEL="Developer Tooling, CLIs and Platform Engineering" ;;
    esac

    echo ""
    echo -e "  ${BOLD}Give a specific angle or theme${RESET} (free text, one line):"
    printf "  > "
    read -r ANGLE
    EXTRA_CONTEXT="DOMAIN: $DOMAIN_LABEL
ANGLE: $ANGLE"

elif [ "$SELECTED_MODE" = "wishlist" ]; then
    if [ ! -f "$WISHLIST_FILE" ]; then
        echo -e "  ${RED}✗${RESET} No wishlist.md found. Create one at $WISHLIST_FILE"
        exit 1
    fi

    ENTRIES=$(PY - <<PYEOF
from pathlib import Path
import re
text = Path("$WISHLIST_FILE").read_text(encoding="utf-8")
unused_section = re.search(r"##\s*Unused\s*\n(.*?)(?:\n##|\Z)", text, re.DOTALL)
if not unused_section:
    print("")
else:
    body = unused_section.group(1)
    items = re.findall(r"^- \[ \]\s+(.+)$", body, re.MULTILINE)
    for i, it in enumerate(items, 1):
        if "add your own" in it.lower():
            continue
        print(f"{i}|{it}")
PYEOF
)

    if [ -z "$ENTRIES" ]; then
        echo -e "  ${YELLOW}Wishlist is empty.${RESET} Add ideas to $WISHLIST_FILE"
        exit 0
    fi

    echo -e "  ${BOLD}Unused wishlist entries${RESET}:"
    echo "$ENTRIES" | while IFS='|' read -r NUM TEXT; do
        echo -e "    ${CYAN}$NUM${RESET} — $TEXT"
    done
    echo ""
    printf "  ${BOLD}Pick a number:${RESET} "
    read -r WISH_NUM

    ENTRY=$(echo "$ENTRIES" | awk -F'|' -v n="$WISH_NUM" '$1 == n {sub(/^[0-9]+\|/, ""); print}')
    if [ -z "$ENTRY" ]; then
        echo -e "  ${RED}✗${RESET} Invalid selection"
        exit 1
    fi
    EXTRA_CONTEXT="WISHLIST_ENTRY: $ENTRY"
    echo -e "  ${GREEN}✓${RESET} Selected: $ENTRY"
fi

# ── Generate project idea (with dedupe retries) ───────
echo ""
echo -e "  ${GREEN}▶${RESET} Generating project idea..."
echo ""

ATTEMPT=0
MAX_ATTEMPTS=3
IDEA_JSON="{}"
SIMILAR_NAME=""
SIMILAR_SCORE="0.00"
SIMILAR_THRESHOLD="0.55"
LAST_FAILURE_REASON=""

DEBUG_DIR="$DAILY_BUILDER/.debug"
mkdir -p "$DEBUG_DIR"

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    BASE_PROMPT=$(cat "$PROMPTS_DIR/generate_idea.md")
    FULL_PROMPT="$EXTRA_CONTEXT

$BASE_PROMPT"
    if [ -n "$SIMILAR_NAME" ] && [ "$LAST_FAILURE_REASON" = "dedupe" ]; then
        FULL_PROMPT="$FULL_PROMPT

IMPORTANT: Your previous attempt was too similar to an existing project
($SIMILAR_NAME, cosine similarity $SIMILAR_SCORE). Generate a completely
different idea — different algorithm, different tech stack, different user."
    fi

    RAW_LOG="$DEBUG_DIR/generate_attempt_${ATTEMPT}.log"
    IDEA_RAW=$(claude --dangerously-skip-permissions -p "$FULL_PROMPT" 2>"$RAW_LOG")

    IDEA_JSON=$(echo "$IDEA_RAW" | PY - <<'PYEOF'
import sys, json, re
raw = sys.stdin.read()
match = re.search(r"\{.*\}", raw, re.DOTALL)
if match:
    try:
        data = json.loads(match.group())
        print(json.dumps(data))
    except Exception:
        print("{}")
else:
    print("{}")
PYEOF
)

    if [ "$IDEA_JSON" = "{}" ]; then
        LAST_FAILURE_REASON="generation"
        echo -e "  ${RED}✗${RESET} Idea generation failed (attempt $ATTEMPT)."
        echo "$IDEA_RAW" > "$DEBUG_DIR/generate_attempt_${ATTEMPT}.stdout"
        echo -e "  ${DIM}  stderr: $RAW_LOG${RESET}"
        echo -e "  ${DIM}  stdout: $DEBUG_DIR/generate_attempt_${ATTEMPT}.stdout${RESET}"
        if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
            break
        fi
        echo -e "  ${YELLOW}  Retrying in 2s...${RESET}"
        sleep 2
        continue
    fi

    DEDUPE_RESULT=$(echo "$IDEA_JSON" | PY - <<PYEOF
import sys, json
from pathlib import Path
from lib.dedupe import check
from lib.paths import HISTORY_FILE, Config

cfg = Config.load()
idea = json.loads(sys.stdin.read())
r = check(idea, HISTORY_FILE, cfg)
print(f"{int(r.too_similar)}|{r.max_score:.3f}|{r.most_similar_name or ''}|{r.threshold:.2f}")
PYEOF
)
    TOO_SIMILAR=$(echo "$DEDUPE_RESULT" | cut -d'|' -f1)
    SIMILAR_SCORE=$(echo "$DEDUPE_RESULT" | cut -d'|' -f2)
    SIMILAR_NAME=$(echo "$DEDUPE_RESULT" | cut -d'|' -f3)
    SIMILAR_THRESHOLD=$(echo "$DEDUPE_RESULT" | cut -d'|' -f4)

    if [ "$TOO_SIMILAR" = "1" ]; then
        LAST_FAILURE_REASON="dedupe"
        echo -e "  ${YELLOW}◉${RESET} Too similar to existing ${BOLD}$SIMILAR_NAME${RESET} (score $SIMILAR_SCORE >= $SIMILAR_THRESHOLD). Regenerating..."
        continue
    fi

    LAST_FAILURE_REASON=""
    break
done

if [ "$IDEA_JSON" = "{}" ]; then
    echo -e "  ${RED}✗${RESET} Could not generate a usable idea after $MAX_ATTEMPTS attempts."
    echo -e "  ${DIM}  Check debug logs in $DEBUG_DIR${RESET}"
    log "ERROR: idea generation exhausted retries"
    exit 1
fi

# ── Parse the idea fields ─────────────────────────────
REPO_NAME=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('repo_name','unknown'))")
FULL_NAME=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('full_name','Unknown'))")
TAGLINE=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('tagline',''))")
DOMAIN=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('domain',''))")
PROBLEM=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('problem',''))")
SESSIONS=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('estimated_sessions','2'))")
WHY=$(echo "$IDEA_JSON" | PY -c "import json,sys; print(json.load(sys.stdin).get('why_impressive',''))")
STACK=$(echo "$IDEA_JSON" | PY -c "import json,sys; d=json.load(sys.stdin); print(', '.join(d.get('tech_stack',[])))")
FEATURES=$(echo "$IDEA_JSON" | PY -c "
import json,sys
d = json.load(sys.stdin)
for f in d.get('core_features', []):
    print('    • ' + f)
")

echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
echo ""
echo -e "  ${BOLD}  $FULL_NAME${RESET}"
echo -e "  ${CYAN}  $TAGLINE${RESET}"
echo ""
echo -e "  ${YELLOW}  Domain:${RESET}    $DOMAIN"
echo -e "  ${YELLOW}  Stack:${RESET}     $STACK"
echo -e "  ${YELLOW}  Sessions:${RESET}  ~$SESSIONS"
echo ""
echo -e "  ${YELLOW}  Problem:${RESET}"
echo "    $PROBLEM"
echo ""
echo -e "  ${YELLOW}  Core features:${RESET}"
echo -e "${GREEN}$FEATURES${RESET}"
echo ""
echo -e "  ${YELLOW}  Why it stands out:${RESET}"
echo "    $WHY"
echo ""
echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
echo ""
printf "  ${BOLD}Approve? (y/n):${RESET} "
read -r APPROVE

if [ "$APPROVE" != "y" ] && [ "$APPROVE" != "Y" ]; then
    echo -e "  ${YELLOW}Session cancelled.${RESET}"
    exit 0
fi

# ── Set up project ────────────────────────────────────
echo ""
echo -e "  ${GREEN}▶${RESET} Setting up project..."
PROJECT_DIR="$PROJECTS_DIR/$REPO_NAME"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

git init -q
git checkout -q -b main 2>/dev/null || git checkout -q main
gh repo create "$REPO_NAME" --public --description "$TAGLINE" 2>/dev/null || true
git remote add origin "https://github.com/$(gh api user --jq .login 2>/dev/null)/$REPO_NAME.git" 2>/dev/null || true

echo -e "  ${GREEN}✓${RESET} GitHub repo created"
log "New project: $REPO_NAME (mode=$SELECTED_MODE)"

# ── Write CLAUDE.md ───────────────────────────────────
echo -e "  ${GREEN}▶${RESET} Writing memory files..."

cat > "$PROJECT_DIR/CLAUDE.md" <<CLAUDEEOF
# Agent Instructions — Read Before Every Action

Read in this order, every session:

1. \`~/daily-builder/prompts/rules/session_protocol.md\`
2. \`~/daily-builder/prompts/rules/quality_bar.md\`
3. \`~/daily-builder/prompts/rules/code_rules.md\`
4. \`state.md\` in this directory
5. This file

---

# Project: $FULL_NAME

**Tagline:** $TAGLINE

**Domain:** $DOMAIN

**Tech stack:** $STACK

**Problem:** $PROBLEM

**Why it stands out:** $WHY

---

# Core features

$(echo "$FEATURES")

---

# Full Implementation Plan

Read \`~/daily-builder/prompts/new_project.md\` for the complete instructions.
Start at STEP 3 — the idea is already chosen and approved. Details are above.
Do not regenerate ideas.

Estimated sessions: $SESSIONS
CLAUDEEOF

# ── Write state.md ────────────────────────────────────
cat > "$PROJECT_DIR/state.md" <<STATEEOF
## Status
IN PROGRESS

## Project
$REPO_NAME — $TAGLINE

## Session count
1

## Completed steps
None yet.

## In progress
Project initialization — reading plan and setting up structure

## Next steps
1. Read ~/daily-builder/prompts/new_project.md fully
2. Write the complete technical specification for $FULL_NAME
3. Set up project folder structure and initialize dependencies

## Blockers
None

## Notes
Fresh start. Mode: $SELECTED_MODE.

## Git log
No commits yet.
STATEEOF

echo -e "  ${GREEN}✓${RESET} Memory files written"

# ── Append to project_history.md ──────────────────────
PY - <<PYEOF
from pathlib import Path
entry = """
$DATE — $REPO_NAME
- Domain: $DOMAIN
- Description: $TAGLINE
- Tech stack: $STACK
- Status: IN PROGRESS
- GitHub: https://github.com/rayancheca/$REPO_NAME
"""
history = Path("$HISTORY_FILE")
if not history.exists():
    history.write_text("# Project History\n\n## Built Projects\n" + entry, encoding="utf-8")
else:
    history.write_text(history.read_text(encoding="utf-8") + entry, encoding="utf-8")
PYEOF

# ── Launch Claude Code ────────────────────────────────
echo -e "  ${GREEN}▶${RESET} Launching Claude Code..."
echo ""
echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
echo ""

claude --dangerously-skip-permissions

# ── Post-session evaluation ───────────────────────────
echo ""
echo -e "  ${MAGENTA}◆${RESET} Running evaluator..."
PY - <<PYEOF
from pathlib import Path
from lib.evaluate import evaluate, record_in_history
from lib.paths import HISTORY_FILE, Config

proj = Path("$PROJECT_DIR")
cfg = Config.load()
result = evaluate(proj, cfg)
print(f"  Score: {result.score}/100 (heuristic: {result.heuristic.score})")
if result.needs_finishing_pass:
    print(f"  Below threshold — consider: start.sh --polish {proj.name}")
record_in_history(proj.name, result, HISTORY_FILE)
PYEOF

echo ""
echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
echo -e "  ${GREEN}✓${RESET} Session complete — ${DATE}"
log "Session ended"
