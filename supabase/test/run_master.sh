#!/usr/bin/env bash
# TEST ONLY. Tests supabase/FALCON_MASTER.sql exactly as the owner will run it: on a NEW, clean, throwaway Postgres database
# (with the Supabase stand-in) – once, then a second time (it must be safe to run again), then the seed twice, then every test
# file against that database. Never point this at Supabase.
#   PGHOST=127.0.0.1 PGPORT=5441 PGUSER=postgres supabase/test/run_master.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
master="$here/../FALCON_MASTER.sql"
seed="$here/../seed/seed.sql"
db="falcon_master_$$"
PSQL="$(command -v psql)"
run() { timeout "$1" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${@:2}"; }
run 30 -d postgres -c "create database $db"
trap 'run 30 -d postgres -c "drop database if exists $db" >/dev/null' EXIT
run 60 -d "$db" -f "$here/00_supabase_stub.sql" >/dev/null
run 180 -d "$db" -f "$master" >/dev/null && echo "master: first run on a clean database – no error"
run 180 -d "$db" -f "$master" >/dev/null && echo "master: second run – no error (safe to run again)"
run 60 -d "$db" -f "$seed" >/dev/null && run 60 -d "$db" -f "$seed" >/dev/null && echo "seed: ran twice – no error"
echo "items after the seed: $(run 30 -d "$db" -tAc "select count(*) from public.items i join public.companies c on c.id = i.company_id where c.code = 'RCL'")"
echo "tables: $(run 30 -d "$db" -tAc "select count(*) from pg_tables where schemaname = 'public'"), \
without row level security: $(run 30 -d "$db" -tAc "select count(*) from pg_tables where schemaname = 'public' and not rowsecurity")"
# the tests make their own made-up companies beside the seeded one, and roll back
total=0
for t in "$here"/0*.test.sql; do
  out="$(run 120 -d "$db" -f "$t" 2>&1)" || { echo "── $(basename "$t") FAILED"; echo "$out" | grep -E 'NOTICE|ERROR' | sed 's/^psql:[^ ]* //'; exit 1; }
  n="$(echo "$out" | grep -c 'NOTICE:  ok –')"; total=$((total + n))
  echo "── $(basename "$t"): $n checks passed"
done
echo "all tests on the master: $total checks passed"
