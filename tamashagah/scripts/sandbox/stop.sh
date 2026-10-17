#!/usr/bin/env bash
# Stop the server and the worker started from THIS checkout (by port / pid file). Never uses pkill -f.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/sandbox/lib.sh
PORT="${1:-$(app_port)}"
free_port "$PORT" && echo "port $PORT free"
if [ -f .data/worker.pid ]; then kill "$(cat .data/worker.pid)" 2>/dev/null && echo "stopped worker"; rm -f .data/worker.pid; fi
exit 0
