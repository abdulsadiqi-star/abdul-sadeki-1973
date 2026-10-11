#!/usr/bin/env bash
# Rebuild this checkout and (re)start its production server in the background.
#   scripts/sandbox/restart.sh            # port taken from APP_URL in .env
#   scripts/sandbox/restart.sh 3101
# Log: .data/start.log. Stops ONLY the process listening on that port (never uses pkill -f).
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${1:-$(node -e 'const m=require("fs").readFileSync(".env","utf8").match(/^APP_URL=(.*)$/m);console.log(new URL(m[1].trim()).port||3000)')}"
mkdir -p .data
pid="$(lsof -ti:"$PORT" || true)"
if [ -n "$pid" ]; then kill $pid; sleep 1; fi
pnpm build
PORT="$PORT" nohup pnpm start > .data/start.log 2>&1 &
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:${PORT}/login"; then echo "✔ server up on :${PORT} (log: .data/start.log)"; exit 0; fi
  sleep 1
done
echo "✖ server did not come up; see .data/start.log" >&2
tail -20 .data/start.log >&2
exit 1
