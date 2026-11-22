#!/usr/bin/env bash
# Builds supabase/FALCON_MASTER.sql – the ONE script to run in the Supabase SQL Editor – from the numbered migrations, in their
# order, inside one transaction (all or nothing). The migrations stay the source; run this after any change to them, then run
# supabase/test/run_master.sh to test the master on a clean database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/FALCON_MASTER.sql"
files=("$here"/migrations/[0-9][0-9][0-9][0-9]_*.sql)
{
  echo "-- FALCON – Food & Site Operations · Sketchline Industries"
  echo "-- MASTER DATABASE SCRIPT · built from supabase/migrations/ by supabase/build_master.sh – do not edit by hand."
  echo "--"
  echo "-- Run it ONCE on the FALCON Supabase project (SQL Editor → New query → paste → Run). It is safe to run again: every"
  echo "-- table, type, function, rule and policy is made only if it is missing, or replaced with the same definition. It deletes"
  echo "-- no data. It runs in ONE transaction: if any statement fails, nothing of it stays."
  echo "-- After it: supabase/seed/seed.sql (the company and the items), once."
  echo "--"
  echo "-- Execution order (each part as in its file):"
  for f in "${files[@]}"; do echo "--   $(basename "$f")"; done
  echo "--"
  echo "-- Needs on Supabase: the extensions schema (always there) – btree_gist and pgcrypto are created in it by part 0001."
  echo
  echo "begin;"
  echo "set local client_min_messages = warning;"
  for f in "${files[@]}"; do
    echo
    echo "-- ═════════════════════════════════════════════════════════════════════════ $(basename "$f")"
    cat "$f"
  done
  echo
  echo "commit;"
} > "$out"
echo "built $(basename "$out"): ${#files[@]} parts, $(wc -l < "$out") lines, sha256 $(sha256sum "$out" | cut -c1-16)"
