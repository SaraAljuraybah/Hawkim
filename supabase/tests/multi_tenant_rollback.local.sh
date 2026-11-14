#!/usr/bin/env bash
# The multi-tenant release's way back, end to end, against the LOCAL stack only (docs/multi-tenancy.md,
# "If something goes wrong"). It replaces the local database twice; it ends with a normal `supabase db reset`.
#
#   bash supabase/tests/multi_tenant_rollback.local.sh
#
# 1. The local database at the hosted project's state: migrations up to 20261114130100, then the four
#    20261115… migrations by hand, with the seed of that time (8179fb9) and its sign-in accounts.
# 2. Its schema is dumped, the 17 migrations are applied (as step 3 does), then undone with the rollback
#    scripts in the order of the plan's table.
# 3. The schema must be the same as in 1, statement for statement (functions, policies, grants, keys,
#    foreign keys), and no row may be lost. 4. Then the 17 must apply again (going forward after an undo).
# Not in run_all.local.sh (it resets the database); run it after changing a migration or rollback script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CONTAINER="${HAWKIM_DB_CONTAINER:-supabase_db_Hawkim}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status="$(supabase status -o env 2>/dev/null)" || { echo "The local stack isn't running: supabase start"; exit 2; }
DB_URL="$(printf '%s\n' "$status" | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
case "$DB_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "Refusing: the database isn't local"; exit 2 ;; esac
psql_local() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
MIGRATIONS=(20261116120000 20261116130000 20261116140000 20261116150000 20261116160000 20261116170000
  20261116180000 20261116190000 20261116200000 20261116210000 20261116220000 20261116230000
  20261117120000 20261117130000 20261117140000 20261117150000 20261117160000)
COUNTS="select (select count(*) from public.profiles) || '/' || (select count(*) from public.departments) || '/' ||
  (select count(*) from public.user_roles) || '/' || (select count(*) from public.guideline_requirements) || '/' ||
  (select count(*) from public.sample_findings) || '/' || (select count(*) from auth.users)"

echo "1. The hosted state"
supabase db reset --local --no-seed --version 20261114130100 >/dev/null 2>&1
for v in 20261115120000 20261115130000 20261115140000 20261115150000; do psql_local < supabase/migrations/${v}_*.sql >/dev/null; done
git show 8179fb9:supabase/seed.sql > "$WORK/seed.sql"
for e in $(grep -oE '[a-z0-9._-]+@hawkim\.test' "$WORK/seed.sql" | sort -u); do
  echo "insert into auth.users (id, instance_id, email, aud, role) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', '$e', 'authenticated', 'authenticated');"
done | psql_local
psql_local < "$WORK/seed.sql" >/dev/null 2>&1
before_counts="$(psql_local -At -c "$COUNTS")"
supabase db dump --db-url "$DB_URL" -f "$WORK/before.sql" >/dev/null 2>&1

echo "2. The 17 migrations, then the way back"
supabase migration repair --local --status applied 20261115120000 20261115130000 20261115140000 20261115150000 >/dev/null 2>&1
supabase db push --local --yes >/dev/null 2>&1
[ "$(psql_local -At -c 'select count(*) from public.organizations')" = 1 ] || { echo "FAIL: db push didn't create MedCare"; exit 1; }
echo "drop function public.restore_storage_path(text, text, text); drop function public.storage_paths_to_restore();" | psql_local
for s in isolation_fixes add_user_other_organization accept_creates_organization; do psql_local < supabase/scripts/rollback_$s.sql >/dev/null; done
echo "drop function public.storage_paths_to_relocate();" | psql_local
for s in storage_organization_folders scope_compliance_checks guideline_queue_per_organization \
  guideline_versions_per_organization scope_reviews scope_sops scope_divisions_departments scope_staff_functions \
  same_organization_policies organization_settings_per_organization conflict_without_retry organizations; do
  psql_local < supabase/scripts/rollback_$s.sql >/dev/null 2>&1 || { echo "FAIL: rollback_$s.sql"; psql_local < supabase/scripts/rollback_$s.sql 2>&1 | grep ERROR; exit 1; }
done
supabase migration repair --local --status reverted "${MIGRATIONS[@]}" >/dev/null 2>&1
after_counts="$(psql_local -At -c "$COUNTS")"
supabase db dump --db-url "$DB_URL" -f "$WORK/after.sql" >/dev/null 2>&1

echo "3. The schema and the rows, before and after"
fail=0
python -I - "$WORK/before.sql" "$WORK/after.sql" <<'PY' || fail=1
import collections, re, sys
def statements(path):
    text = open(path, encoding='utf-8').read()
    parts = re.split(r'\n(?=(?:CREATE|ALTER|COMMENT|GRANT|REVOKE|SET) )', text)
    return collections.Counter(' '.join(p.split()) for p in parts if p.strip())
before, after = statements(sys.argv[1]), statements(sys.argv[2])
lost, added = before - after, after - before
for s in sorted(lost): print('   only before:', s[:220])
for s in sorted(added): print('   only after: ', s[:220])
print(f'   {sum(before.values())} statements before, {len(lost)} lost, {len(added)} added')
sys.exit(1 if lost or added else 0)
PY
if [ "$before_counts" != "$after_counts" ]; then echo "   rows: before $before_counts, after $after_counts"; fail=1; fi

echo "4. Forward again: the 17 migrations apply a second time"
if supabase db push --local --yes >/dev/null 2>&1 \
  && [ "$(psql_local -At -c "select count(*) from public.organizations")" = 1 ] \
  && [ "$(psql_local -At -c "select count(*) from public.profiles where organization_id is null")" = 0 ] \
  && [ "$(psql_local -At -c "select count(*) from supabase_migrations.schema_migrations where version >= '20261116120000'")" = 17 ]; then
  echo "   applied again: MedCare, every row in it"
else echo "   FAIL: the second db push"; fail=1; fi

echo "   (back to the normal local database: supabase db reset)"
supabase db reset --local >/dev/null 2>&1
if [ $fail = 0 ]; then echo "PASS: the way back restores the hosted schema exactly, and every row ($before_counts)"; else echo "FAIL"; exit 1; fi
