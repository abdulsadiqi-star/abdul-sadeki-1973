#!/usr/bin/env bash
# Rebuild this checkout and (re)start its production server in the background.
#   scripts/sandbox/restart.sh            # port taken from APP_URL in .env
#   scripts/sandbox/restart.sh 3101
# Log: .data/start.log. Stops ONLY the process listening on that port (never uses pkill -f), waits until it is
# really gone BEFORE building (a stale server would otherwise keep serving the old build), and verifies that the
# NEW server owns the port.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/sandbox/lib.sh
PORT="${1:-$(app_port)}"
mkdir -p .data
free_port "$PORT"
pnpm build
: > .data/start.log
PORT="$PORT" nohup pnpm start > .data/start.log 2>&1 &
for _ in $(seq 1 90); do
  if grep -q "EADDRINUSE" .data/start.log 2>/dev/null; then
    echo "✖ port $PORT is still in use (EADDRINUSE); see .data/start.log" >&2
    exit 1
  fi
  if grep -q "Ready in" .data/start.log 2>/dev/null && curl -s -o /dev/null "http://localhost:${PORT}/api/health"; then
    echo "✔ fresh server up on :${PORT} (log: .data/start.log)"
    exit 0
  fi
  sleep 1
done
echo "✖ server did not come up; see .data/start.log" >&2
tail -20 .data/start.log >&2
exit 1
