#!/usr/bin/env bash
# Shared helpers for the sandbox scripts (sourced, not executed).

# PIDs listening on / connected to a TCP port. NOTE: `lsof` and `ss -p` do NOT work in this VM; `fuser` does.
port_pids() {
  fuser -n tcp "$1" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
}

# Free a TCP port: SIGTERM first, wait up to ~10 s (Next.js shuts down gracefully), then SIGKILL.
# Never uses `pkill -f`. Returns non-zero if the port could not be freed.
free_port() {
  local port="$1" pids
  pids="$(port_pids "$port")"
  [ -z "$pids" ] && return 0
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    [ -z "$(port_pids "$port")" ] && return 0
    sleep 0.5
  done
  pids="$(port_pids "$port")"
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  for _ in $(seq 1 10); do
    [ -z "$(port_pids "$port")" ] && return 0
    sleep 0.5
  done
  echo "could not free port $port" >&2
  return 1
}

# Port from APP_URL in .env (default 3000).
app_port() {
  node -e 'const m=require("fs").readFileSync(".env","utf8").match(/^APP_URL=(.*)$/m);console.log(new URL(m[1].trim()).port||3000)'
}
