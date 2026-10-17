#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
export COLLECTOR_WAIT=1
if [ -n "${DATABASE_URL:-}" ]; then
  export COLLECTOR_DATABASE_URL="$DATABASE_URL"
else
  export COLLECTOR_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54329/postgres"
fi
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:8091/health; then
  if [ -x /workspace/collector/.venv/bin/python ]; then
    (
      cd /workspace/collector
      .venv/bin/python -m pulso_collector >>/tmp/pulso-collector.log 2>&1 &
    )
  fi
fi
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
fi
