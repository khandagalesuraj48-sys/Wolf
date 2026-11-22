#!/usr/bin/env bash
# TEST ONLY. Runs FALCON's SQL on a clean, throwaway Postgres: makes a new database, puts the Supabase stand-in in it, runs every
# migration TWICE (each must be safe to run again), then every test file. Never point this at Supabase.
#   PGHOST=127.0.0.1 PGPORT=5441 PGUSER=postgres supabase/test/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="falcon_test_$$"
PSQL="$(command -v psql)"
run() { timeout "$1" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${@:2}"; }
run 30 -d postgres -c "create database $db"
trap 'run 30 -d postgres -c "drop database if exists $db" >/dev/null' EXIT
run 60 -d "$db" -f "$here/00_supabase_stub.sql" >/dev/null
for pass in 1 2; do
  for f in "$here"/../migrations/*.sql; do run 120 -d "$db" -f "$f" >/dev/null; done
done
echo "migrations: ran twice, no error"
for t in "$here"/0*.test.sql; do
  echo "── $(basename "$t")"
  out="$(run 120 -d "$db" -f "$t" 2>&1)" || { echo "$out" | grep -E 'NOTICE|ERROR' | sed 's/^psql:[^ ]* //'; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* NOTICE:  //p'
  echo "$(echo "$out" | grep -c 'NOTICE:  ok –') checks passed"
done
