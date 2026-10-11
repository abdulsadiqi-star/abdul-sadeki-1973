#!/usr/bin/env bash
# Stop the server and the worker started from THIS checkout (by port / pid file). Never uses pkill -f.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${1:-$(node -e 'const m=require("fs").readFileSync(".env","utf8").match(/^APP_URL=(.*)$/m);console.log(new URL(m[1].trim()).port||3000)')}"
pid="$(lsof -ti:"$PORT" || true)"; [ -n "$pid" ] && kill $pid && echo "stopped server :$PORT"
if [ -f .data/worker.pid ]; then kill "$(cat .data/worker.pid)" 2>/dev/null && echo "stopped worker"; rm -f .data/worker.pid; fi
exit 0
