#!/bin/bash
#
# daily-builder :: dashboard.sh
#
# Start, stop, or view status of the mission-control dashboard —
# without running a full start.sh session.
#
# Usage:
#   dashboard.sh            # start (or restart) in background, open browser
#   dashboard.sh start      # same as above
#   dashboard.sh stop       # kill the server
#   dashboard.sh status     # is it running? on what port?
#   dashboard.sh log        # tail the server log
#   dashboard.sh fg         # run in foreground (you see all output, Ctrl+C kills)

set -o pipefail

DAILY_BUILDER="$HOME/daily-builder"
SERVER="$DAILY_BUILDER/dashboard/server.py"
LOG="$DAILY_BUILDER/.debug/dashboard.log"
PORT=8765

mkdir -p "$(dirname "$LOG")"

CMD="${1:-start}"

case "$CMD" in
    start|"")
        # Kill any existing instance first (idempotent restart)
        pkill -f "dashboard/server.py" 2>/dev/null
        sleep 0.5
        nohup python3 "$SERVER" > "$LOG" 2>&1 &
        DISOWN_PID=$!
        disown 2>/dev/null || true
        sleep 1
        if lsof -i ":$PORT" >/dev/null 2>&1; then
            echo "✓ dashboard running at http://localhost:$PORT (pid $DISOWN_PID)"
            echo "  log: $LOG"
            open "http://localhost:$PORT" 2>/dev/null || true
        else
            echo "✗ dashboard failed to start — see $LOG"
            exit 1
        fi
        ;;
    stop)
        if pkill -f "dashboard/server.py"; then
            echo "✓ dashboard stopped"
        else
            echo "  nothing to stop"
        fi
        ;;
    status)
        if pgrep -f "dashboard/server.py" >/dev/null; then
            pid=$(pgrep -f "dashboard/server.py" | head -1)
            echo "✓ dashboard running (pid $pid) at http://localhost:$PORT"
        else
            echo "  not running"
        fi
        ;;
    log)
        tail -f "$LOG"
        ;;
    fg|foreground)
        pkill -f "dashboard/server.py" 2>/dev/null
        sleep 0.5
        python3 "$SERVER"
        ;;
    *)
        echo "usage: dashboard.sh [start|stop|status|log|fg]"
        exit 1
        ;;
esac
