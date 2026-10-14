#!/usr/bin/env bash
#
# A local PostgreSQL for development.
#
# The project talks to a real PostgreSQL rather than an embedded one, because the
# behaviour worth relying on here — an exclusion constraint, a unique index, a
# transaction that rolls back — only exists in the database. This script keeps
# that zero-friction: it creates a cluster inside the repo, on a non-default
# port, and never touches a system PostgreSQL or launchd.
#
#   ./scripts/db-local.sh start|stop|status|reset|psql
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.pgdata/tradeflow}"
PORT="${PGPORT:-55432}"
DATABASES=(tradeflow tradeflow_shadow tradeflow_test)

# Homebrew's keg-only install is not on PATH by default.
if ! command -v pg_ctl >/dev/null 2>&1; then
  for candidate in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin; do
    if [ -x "$candidate/pg_ctl" ]; then PATH="$candidate:$PATH"; break; fi
  done
fi

if ! command -v pg_ctl >/dev/null 2>&1; then
  cat >&2 <<'MSG'
PostgreSQL 17 was not found.

  macOS:  brew install postgresql@17
  Debian: apt-get install postgresql-17

Then run this again.
MSG
  exit 1
fi

log() { printf '  %s\n' "$*"; }

start() {
  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    log "already running on port $PORT"
    return
  fi
  if [ ! -d "$PGDATA" ]; then
    log "initialising $PGDATA"
    mkdir -p "$(dirname "$PGDATA")"
    initdb -D "$PGDATA" -U postgres --encoding=UTF8 --locale=en_US.UTF-8 -A trust >/dev/null
  fi
  # fsync and full_page_writes off: this cluster is disposable and the speed
  # matters more than crash durability for a development database.
  pg_ctl -D "$PGDATA" -l "$(dirname "$PGDATA")/postgres.log" \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
    start >/dev/null
  log "started on port $PORT"
  ensure_databases
}

ensure_databases() {
  for db in "${DATABASES[@]}"; do
    if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
      psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "CREATE DATABASE $db" >/dev/null
      log "created $db"
    fi
  done
}

stop() {
  pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  log "stopped"
}

status() {
  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    log "running on port $PORT"
  else
    log "not running"
  fi
}

reset() {
  stop
  rm -rf "$PGDATA"
  log "cluster removed; run 'start' to recreate"
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  reset)  reset ;;
  psql)   exec psql -h 127.0.0.1 -p "$PORT" -U postgres -d tradeflow ;;
  *)      echo "usage: $0 {start|stop|status|reset|psql}" >&2; exit 1 ;;
esac
