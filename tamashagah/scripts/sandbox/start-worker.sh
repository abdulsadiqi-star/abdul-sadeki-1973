#!/usr/bin/env bash
# Start the background worker of THIS checkout (log: .data/worker.log, pid: .data/worker.pid).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .data
if [ -f .data/worker.pid ] && kill -0 "$(cat .data/worker.pid)" 2>/dev/null; then kill "$(cat .data/worker.pid)"; sleep 1; fi
nohup pnpm exec tsx --env-file-if-exists=.env worker/index.ts > .data/worker.log 2>&1 &
echo $! > .data/worker.pid
echo "✔ worker started (pid $(cat .data/worker.pid), log .data/worker.log)"
