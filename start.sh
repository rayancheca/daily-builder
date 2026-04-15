#!/bin/bash

# ── Colors ────────────────────────────────────────────
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Paths ─────────────────────────────────────────────
DAILY_BUILDER="$HOME/daily-builder"
PROJECTS_DIR="$HOME/dev/daily-projects"
PROMPTS_DIR="$DAILY_BUILDER/prompts"
DASHBOARD_DIR="$DAILY_BUILDER/dashboard"
HISTORY_FILE="$DAILY_BUILDER/project_history.md"
LOG_FILE="$DAILY_BUILDER/session.log"
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M)

mkdir -p "$PROJECTS_DIR"
echo "" >> "$LOG_FILE"
echo "[$DATE $TIME] Session started" >> "$LOG_FILE"

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
pkill -f "server.py" 2>/dev/null
sleep 1
python3 "$DASHBOARD_DIR/server.py" &
DASHBOARD_PID=$!
sleep 1
echo -e "  ${GREEN}✓${RESET} Dashboard running at ${CYAN}http://localhost:8765${RESET}"
open "http://localhost:8765"
echo ""

# ── Check for unfinished project ──────────────────────
UNFINISHED=""
for dir in "$PROJECTS_DIR"/*/; do
    if [ -f "$dir/state.md" ]; then
        if ! grep -q "COMPLETE" "$dir/state.md"; then
            UNFINISHED="$dir"
            break
        fi
    fi
done

# ── Resume path ───────────────────────────────────────
if [ -n "$UNFINISHED" ]; then
    PROJECT_NAME=$(basename "$UNFINISHED")
    echo -e "  ${YELLOW}◉${RESET} Unfinished project found:"
    echo ""
    echo -e "  ${BOLD}  $PROJECT_NAME${RESET}"
    echo ""

    SESSION=$(grep -A1 "## Session count" "$UNFINISHED/state.md" 2>/dev/null | tail -1)
    IN_PROGRESS=$(grep -A1 "## In progress" "$UNFINISHED/state.md" 2>/dev/null | tail -1)
    echo -e "  ${CYAN}  Session:${RESET}     $SESSION"
    echo -e "  ${CYAN}  In progress:${RESET} $IN_PROGRESS"
    echo ""
    echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
    echo ""
    echo -e -n "  Resume this project? ${BOLD}(y/n):${RESET} "
    read ANSWER

    if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
        echo ""
        echo -e "  ${GREEN}▶${RESET} Resuming ${BOLD}$PROJECT_NAME${RESET}..."
        echo "[$DATE $TIME] Resuming: $PROJECT_NAME" >> "$LOG_FILE"
        cd "$UNFINISHED"
        echo ""
        echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
        echo ""
        claude --dangerously-skip-permissions
    else
        echo ""
        echo -e "  ${YELLOW}Skipping resume. Starting a new project instead.${RESET}"
        echo ""
        UNFINISHED=""
    fi
fi

# ── New project path ──────────────────────────────────
if [ -z "$UNFINISHED" ]; then
    echo -e "  ${GREEN}▶${RESET} Generating project idea..."
    echo ""

    IDEA_RAW=$(claude --dangerously-skip-permissions \
                  -p "$(cat "$PROMPTS_DIR/generate_idea.md")" 2>/dev/null)

    IDEA_JSON=$(echo "$IDEA_RAW" | python3 -c "
import sys, json, re
raw = sys.stdin.read()
match = re.search(r'\{.*\}', raw, re.DOTALL)
if match:
    try:
        data = json.loads(match.group())
        print(json.dumps(data))
    except:
        print('{}')
else:
    print('{}')
")

    if [ "$IDEA_JSON" = "{}" ]; then
        echo -e "  ${RED}✗${RESET} Failed to generate idea. Check that Claude Code is working."
        echo "[$DATE $TIME] ERROR: Failed to generate idea" >> "$LOG_FILE"
        kill $DASHBOARD_PID 2>/dev/null
        exit 1
    fi

    REPO_NAME=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('repo_name','unknown'))")
    FULL_NAME=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('full_name','Unknown'))")
    TAGLINE=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tagline',''))")
    DOMAIN=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('domain',''))")
    PROBLEM=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('problem',''))")
    SESSIONS=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('estimated_sessions','2'))")
    WHY=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('why_impressive',''))")
    STACK=$(echo "$IDEA_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(', '.join(d.get('tech_stack',[])))")
    FEATURES=$(echo "$IDEA_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for f in d.get('core_features',[]):
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
    echo -e "  ${RESET}  $PROBLEM${RESET}"
    echo ""
    echo -e "  ${YELLOW}  Core features:${RESET}"
    echo -e "${GREEN}$FEATURES${RESET}"
    echo ""
    echo -e "  ${YELLOW}  Why it stands out:${RESET}"
    echo -e "  ${RESET}  $WHY${RESET}"
    echo ""
    echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
    echo ""
    echo -e -n "  ${BOLD}Approve this project? (y/n/regenerate):${RESET} "
    read ANSWER

    while [ "$ANSWER" = "regenerate" ] || [ "$ANSWER" = "r" ]; do
        echo ""
        echo -e "  ${GREEN}▶${RESET} Regenerating idea..."
        IDEA_RAW=$(claude --dangerously-skip-permissions \
                  -p "$(cat "$PROMPTS_DIR/generate_idea.md") Generate a completely different idea from the last one." 2>/dev/null)
        IDEA_JSON=$(echo "$IDEA_RAW" | python3 -c "
import sys, json, re
raw = sys.stdin.read()
match = re.search(r'\{.*\}', raw, re.DOTALL)
if match:
    try:
        data = json.loads(match.group())
        print(json.dumps(data))
    except:
        print('{}')
else:
    print('{}')
")
        REPO_NAME=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('repo_name','unknown'))")
        FULL_NAME=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('full_name','Unknown'))")
        TAGLINE=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tagline',''))")
        DOMAIN=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('domain',''))")
        PROBLEM=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('problem',''))")
        SESSIONS=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('estimated_sessions','2'))")
        WHY=$(echo "$IDEA_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('why_impressive',''))")
        STACK=$(echo "$IDEA_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(', '.join(d.get('tech_stack',[])))")
        FEATURES=$(echo "$IDEA_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for f in d.get('core_features',[]):
    print('    • ' + f)
")
        echo ""
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
        echo -e "  ${RESET}  $PROBLEM${RESET}"
        echo ""
        echo -e "  ${YELLOW}  Core features:${RESET}"
        echo -e "${GREEN}$FEATURES${RESET}"
        echo ""
        echo -e "  ${YELLOW}  Why it stands out:${RESET}"
        echo -e "  ${RESET}  $WHY${RESET}"
        echo ""
        echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
        echo ""
        echo -e -n "  ${BOLD}Approve this project? (y/n/regenerate):${RESET} "
        read ANSWER
    done

    if [ "$ANSWER" != "y" ] && [ "$ANSWER" != "Y" ]; then
        echo ""
        echo -e "  ${YELLOW}Session cancelled.${RESET}"
        kill $DASHBOARD_PID 2>/dev/null
        exit 0
    fi

    # ── Set up project ─────────────────────────────────
    echo ""
    echo -e "  ${GREEN}▶${RESET} Setting up project..."
    PROJECT_DIR="$PROJECTS_DIR/$REPO_NAME"
    mkdir -p "$PROJECT_DIR"
    cd "$PROJECT_DIR"

    git init -q
    git checkout -q -b main
    gh repo create "$REPO_NAME" --public --description "$TAGLINE" 2>/dev/null
    git remote add origin "https://github.com/$(gh api user --jq .login)/$REPO_NAME.git" 2>/dev/null

echo -e "  ${GREEN}✓${RESET} GitHub repo created"
    echo "[$DATE $TIME] New project: $REPO_NAME" >> "$LOG_FILE"

    # ── Write CLAUDE.md ────────────────────────────────
    echo -e "  ${GREEN}▶${RESET} Writing memory files..."

    cat > "$PROJECT_DIR/CLAUDE.md" << CLAUDEEOF
# Agent Instructions — Read Before Every Action

- Read state.md FIRST before touching any code
- Never skip a step in the implementation plan — do them in strict order
- After every working feature: git add -A && git commit -m "feat: description"
- Update state.md after completing each numbered implementation step
- Always run the code and verify it works before marking a step done
- If something fails, fix it completely before moving on — never leave broken code
- Write README.md progressively as you build — not all at once at the end
- Prioritize: correctness first, then full functionality, then visual polish
- The project must look good — use rich terminal formatting, colors, proper UI
- Never leave TODO comments without implementing them in the same step
- Work SLOWLY and CAREFULLY — quality over speed
- A step is NOT done until it runs without errors and looks good

---

# Project: $FULL_NAME

**Tagline:** $TAGLINE

**Domain:** $DOMAIN

**Tech stack:** $STACK

---

# Full Implementation Plan

Read ~/daily-builder/prompts/new_project.md for the complete instructions.

Your job is to build this project from scratch following every step in that file.
Start at STEP 3 — the idea is already chosen and approved.
The project details are above. Do not generate new ideas.
CLAUDEEOF

    # ── Write state.md ────────────────────────────────
    cat > "$PROJECT_DIR/state.md" << STATEEOF
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
Fresh start. Follow new_project.md from STEP 3 exactly.

## Git log
No commits yet.
STATEEOF

    echo -e "  ${GREEN}✓${RESET} Memory files written"

    # ── Launch Claude Code ─────────────────────────────
    echo -e "  ${GREEN}▶${RESET} Launching Claude Code..."
    echo ""
    echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
    echo ""

    claude --dangerously-skip-permissions

fi

# ── Cleanup ───────────────────────────────────────────
echo ""
echo -e "  ${CYAN}────────────────────────────────────────${RESET}"
echo -e "  ${GREEN}✓${RESET} Session complete — ${DATE}"
echo "[$DATE $TIME] Session ended" >> "$LOG_FILE"
kill $DASHBOARD_PID 2>/dev/null