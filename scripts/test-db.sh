#!/usr/bin/env bash
#
# Applies every migration to a throwaway Postgres and runs the assertion suite.
#
# Catches the class of mistake that only shows up in the database — a policy
# that recurses, a view that leaks across tenants, a constraint that rejects
# what the app sends — without needing the Supabase project to exist.
#
#   ./scripts/test-db.sh                 # uses PGHOST/PGPORT below
#   PGPORT=55432 ./scripts/test-db.sh
#
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-balaji_test}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)
QUIET=(-c "set client_min_messages = warning")

echo "==> recreating $DB"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null

echo "==> supabase shim"
"${PSQL[@]}" -d "$DB" "${QUIET[@]}" -f "$ROOT/supabase/test/00_shim.sql" >/dev/null

echo "==> migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$file")"
  "${PSQL[@]}" -d "$DB" "${QUIET[@]}" -f "$file" >/dev/null
done

echo "==> seed"
"${PSQL[@]}" -d "$DB" "${QUIET[@]}" -f "$ROOT/supabase/test/01_seed.sql" >/dev/null

echo "==> assertions"
"${PSQL[@]}" -d "$DB" -t -A -f "$ROOT/supabase/test/02_assertions.sql" 2>&1 \
  | grep -Ev '^$' | sed -E 's/^psql:[^ ]+ //; s/^NOTICE:  //'

echo "==> ok"
