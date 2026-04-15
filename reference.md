# Daily Builder — Quick Reference

## Start a session
```bash
bash ~/daily-builder/start.sh
```

## When Claude Code launches (paste this every time)
Read CLAUDE.md and state.md carefully, then follow the implementation plan exactly. Work slowly and carefully, verify each step before moving on, and commit after every working feature.

## If Claude Code gets interrupted mid-session
Continue from where you left off. Read state.md to see the last completed step, then continue with the next step. Work slowly, verify each step, commit after every working feature.

## If Claude Code finishes but the project feels incomplete
cd ~/dev/daily-projects/PROJECT-NAME
claude
Then type:
The project feels incomplete. Read CLAUDE.md and state.md, then continue building. Focus on making it fully functional, visually polished, and well documented. Commit everything when done.

## Stop a session cleanly
Press **Ctrl+C** once — Claude Code saves state and stops gracefully.

## Resume a project tomorrow
Just run `start.sh` again — it detects unfinished projects automatically and asks if you want to resume.

## Check what's running
```bash
# See active Claude Code process
ps aux | grep claude

# Watch state.md update in real time
watch -n 3 cat ~/dev/daily-projects/PROJECT-NAME/state.md

# Check build log
tail -f ~/daily-builder/session.log
```

## Kill everything (ports, servers)
```bash
lsof -ti:8000,5173,8765 | xargs kill -9
pkill -f "uvicorn" && pkill -f "vite" && pkill -f "node"
```

## Open dashboard
```bash
python3 ~/daily-builder/dashboard/server.py &
# then open http://localhost:8765
```

## Navigate to a project
```bash
cd ~/dev/daily-projects/PROJECT-NAME
```

## Run Claude inside a project manually
```bash
cd ~/dev/daily-projects/PROJECT-NAME && claude
```

## Fix a broken project
```bash
cd ~/dev/daily-projects/PROJECT-NAME
claude
```
Then type:
The project has bugs. Read CLAUDE.md and state.md, then debug and fix everything that isn't working. Run the code, verify it works, and commit the fixes.

## Project locations
| What | Where |
|------|-------|
| All projects | `~/dev/daily-projects/` |
| Orchestrator | `~/daily-builder/start.sh` |
| Prompts | `~/daily-builder/prompts/` |
| Dashboard | `~/daily-builder/dashboard/` |
| Session log | `~/daily-builder/session.log` |
| Project history | `~/daily-builder/project_history.md` |

## Project memory files (inside each project)
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Full project spec and standing instructions — never delete |
| `state.md` | Current progress, completed steps, next steps — updated by Claude |

## GitHub repos
All projects push to: `github.com/rayancheca`