#!/usr/bin/env bash
# The normal test run, against the LOCAL Supabase stack only (see README.md in this folder):
#   1. supabase db reset   (every migration + seed.sql: a clean database; SKIP_RESET=1 to skip)
#   2. every supabase/tests/*.sql, each in its own psql session (each one rolls itself back)
#   3. the *.local.mjs tests and organization_migrations.mjs (need `supabase functions serve`, see README)
#   4. the compliance service's unit tests (no model is loaded), the frontend's calendar parity test and vitest
# Left out on purpose (README.md says how to run them): the migration-sequence tests (*_before.sql,
# *_request.sql, admins_without_department.sql and every *_rolled_back.sql), the *.browser.local.mjs tests
# (Chrome and the app), and organization_anonymous_readonly.mjs (it reads the hosted project).
#
# Run from anywhere:  bash supabase/tests/run_all.local.sh
# Prints PASS/FAIL per test and a summary; exits 1 when anything failed.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
CONTAINER="${HAWKIM_DB_CONTAINER:-supabase_db_Hawkim}"

status_json="$(supabase status -o json 2>/dev/null)" || { echo "The local stack isn't running: supabase start"; exit 2; }
key() { printf '%s' "$status_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)['$1']))"; }
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_ANON_KEY="$(key ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(key SERVICE_ROLE_KEY)"
export HAWKIM_DB_CONTAINER="$CONTAINER"
fails=()

# Migration-sequence tests: they only pass at a given step around their migration or rollback script,
# and *_before.sql / *_request.sql keep their fixtures (they would change every later test).
sequence_test() {
  case "$1" in
    *_rolled_back.sql|*_before.sql|*_request.sql|admins_without_department.sql) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "${SKIP_RESET:-}" != 1 ]; then
  if supabase db reset >/dev/null 2>&1; then echo "PASS db reset (all migrations + seed)"
  else echo "FAIL db reset"; supabase db reset 2>&1 | tail -20; exit 1; fi
fi

for f in supabase/tests/*.sql; do
  name="$(basename "$f")"
  sequence_test "$name" && continue
  out="$(docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" 2>&1)"
  if [ $? -eq 0 ]; then echo "PASS $name"
  else echo "FAIL $name :: $(printf '%s' "$out" | grep -m3 -E 'ERROR|DETAIL|CONTEXT' | tr '\n' ' ' | cut -c1-400)"; fails+=("$name"); fi
done

for f in supabase/tests/*.local.mjs supabase/tests/organization_migrations.mjs; do
  name="$(basename "$f")"
  case "$name" in *.browser.local.mjs) continue ;; esac
  out="$(timeout 600 node "$f" 2>&1)"
  if [ $? -eq 0 ]; then echo "PASS $name"
  else echo "FAIL $name :: $(printf '%s' "$out" | grep -E '^FAIL|Error' | head -5 | tr '\n' ' ' | cut -c1-500)"; fails+=("$name"); fi
done

out="$(cd compliance-service && python -m unittest test_organization_paths test_worker_organization 2>&1)"
if [ $? -eq 0 ]; then echo "PASS compliance-service unittest"; else echo "FAIL compliance-service unittest :: $(printf '%s' "$out" | tail -5 | tr '\n' ' ')"; fails+=("compliance-service"); fi
out="$(cd frontend && npm run -s test:calendar 2>&1)"
if [ $? -eq 0 ]; then echo "PASS calendar_parity.test.mjs"; else echo "FAIL calendar_parity.test.mjs"; fails+=("calendar_parity.test.mjs"); fi
out="$(cd frontend && npx vitest run 2>&1)"; rc=$?
summary="$(printf '%s' "$out" | grep -E 'Test Files|Tests ' | tr '\n' ' ')"
if [ $rc -eq 0 ]; then echo "PASS frontend vitest :: $summary"; else echo "FAIL frontend vitest :: $summary"; fails+=("vitest"); fi

echo "SUMMARY: ${#fails[@]} failing${fails[*]:+: ${fails[*]}}"
[ ${#fails[@]} -eq 0 ]
