#!/bin/bash

# Activate the Python virtual environment
source "$HOME/daily-builder/venv/bin/activate"

PROJECTS_DIR="$HOME/dev/daily-projects"
LOG_FILE="$HOME/daily-builder/build.log"
DATE=$(date +%Y-%m-%d)

mkdir -p "$PROJECTS_DIR"
echo "" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "[$DATE] Daily build starting at $(date +%H:%M)" >> "$LOG_FILE"

# Check for an unfinished project first
UNFINISHED=$(python3 "$HOME/daily-builder/check_unfinished.py")

if [ "$UNFINISHED" != "none" ]; then
    echo "[$DATE] Resuming unfinished project: $UNFINISHED" >> "$LOG_FILE"
    cd "$UNFINISHED"

    claude --dangerously-skip-permissions \
           -p "Read CLAUDE.md and state.md carefully. Resume the project exactly where it was left off. Continue building step by step, test each piece, fix bugs, commit working code to git. Update state.md as you go. When done, mark state.md Status as COMPLETE." \
           --max-turns 80 >> "$LOG_FILE" 2>&1

else
    # Generate new project idea
    echo "[$DATE] Generating new project idea..." >> "$LOG_FILE"
    python3 "$HOME/daily-builder/generate_ideas.py" > /tmp/todays_project.json 2>> "$LOG_FILE"

    if [ $? -ne 0 ]; then
        echo "[$DATE] ERROR: Failed to generate idea. Check API key." >> "$LOG_FILE"
        exit 1
    fi

    REPO_NAME=$(python3 -c "import json; d=json.load(open('/tmp/todays_project.json')); print(d['repo_name'])")
    TAGLINE=$(python3 -c "import json; d=json.load(open('/tmp/todays_project.json')); print(d['tagline'])")

    echo "[$DATE] Selected project: $REPO_NAME" >> "$LOG_FILE"
    echo "[$DATE] $TAGLINE" >> "$LOG_FILE"

    PROJECT_DIR="$PROJECTS_DIR/$REPO_NAME"
    mkdir -p "$PROJECT_DIR"
    cd "$PROJECT_DIR"

    # Init git and GitHub repo
    git init >> "$LOG_FILE" 2>&1
    git checkout -b main >> "$LOG_FILE" 2>&1

    gh repo create "$REPO_NAME" --public --description "$TAGLINE" >> "$LOG_FILE" 2>&1
    git remote add origin "https://github.com/$(gh api user --jq .login)/$REPO_NAME.git" >> "$LOG_FILE" 2>&1

    # Write CLAUDE.md and state.md
    python3 "$HOME/daily-builder/write_memory_files.py" /tmp/todays_project.json >> "$LOG_FILE" 2>&1
    echo "[$DATE] Memory files written" >> "$LOG_FILE"

    # Launch Claude Code to build
    echo "[$DATE] Launching Claude Code..." >> "$LOG_FILE"
    claude --dangerously-skip-permissions \
           -p "Read CLAUDE.md fully first, then read state.md. Build this project step by step following the plan. After each working feature, commit to git. Update state.md after every major step. When done, mark Status as COMPLETE in state.md." \
           --max-turns 80 >> "$LOG_FILE" 2>&1
fi

# Push everything to GitHub
echo "[$DATE] Pushing to GitHub..." >> "$LOG_FILE"
git add -A 2>> "$LOG_FILE"
git commit -m "[$DATE] Automated daily build" >> "$LOG_FILE" 2>&1
git push --set-upstream origin main >> "$LOG_FILE" 2>&1 || git push >> "$LOG_FILE" 2>&1

echo "[$DATE] Build session complete." >> "$LOG_FILE"