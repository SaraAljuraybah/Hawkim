#!/usr/bin/env bash
# Restores the hosted project's backup (docs/multi-tenancy.md, step 2) into the LOCAL Supabase stack, for the
# rehearsal. It replaces everything in the local database and the local stored files.
#
#   bash supabase/scripts/restore_backup_locally.sh <backup folder>
#
# The backup folder has data.sql, schema.sql and storage/ (with manifest.json), made by step 2.
# 1. Local database at the hosted project's state: the migrations up to 20261114130100 (the hosted history),
#    then the four 20261115… migrations by hand, outside the history (as they were applied on hosted).
# 2. data.sql: every table it has data for is emptied first, then it is loaded in one transaction.
# 3. The stored files: backup_storage.mjs --restore, into the local Storage.
# 4. Prints the step 2 row counts and compares the local schema with the backup's schema.sql.
# The local keys come from `supabase status`; none is printed. It only ever talks to 127.0.0.1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BACKUP="${1:?Usage: bash supabase/scripts/restore_backup_locally.sh <backup folder>}"
BACKUP="$(cd "$BACKUP" && pwd)"
CONTAINER="${HAWKIM_DB_CONTAINER:-supabase_db_Hawkim}"
HOSTED_HISTORY_END=20261114130100
BY_HAND=(20261115120000 20261115130000 20261115140000 20261115150000)
for f in data.sql schema.sql storage/manifest.json; do
  [ -f "$BACKUP/$f" ] || { echo "Missing $BACKUP/$f"; exit 2; }
done

status="$(supabase status -o env 2>/dev/null)" || { echo "The local stack isn't running: supabase start"; exit 2; }
value() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
API_URL="$(value API_URL)"; DB_URL="$(value DB_URL)"; SERVICE_ROLE_KEY="$(value SERVICE_ROLE_KEY)"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "Refusing: $API_URL isn't the local stack"; exit 2 ;; esac
case "$DB_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "Refusing: the database isn't local"; exit 2 ;; esac
psql_local() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "1. Local database at the hosted state (up to $HOSTED_HISTORY_END, then ${BY_HAND[*]} by hand)"
supabase db reset --local --no-seed --version "$HOSTED_HISTORY_END" >/dev/null
for v in "${BY_HAND[@]}"; do psql_local < supabase/migrations/${v}_*.sql >/dev/null; done

echo "2. Loading data.sql"
# Only the COPY blocks that have rows: an empty one still needs the insert privilege, which postgres
# doesn't have on some of Supabase's internal tables (e.g. storage.buckets_vectors).
data="$(mktemp)"
awk '/^COPY "/ { block = $0 "\n"; inblock = 1; rows = 0; next }
     inblock && /^\\\.$/ { if (rows) printf "%s%s\n", block, $0; inblock = 0; next }
     inblock { block = block $0 "\n"; rows++; next }
     { print }' "$BACKUP/data.sql" > "$data"
tables="$(grep -oE '^COPY "[^"]+"\."[^"]+"' "$data" | cut -d' ' -f2 | sort -u | paste -sd, -)"
[ -n "$tables" ] || { echo "data.sql has no rows"; exit 1; }
echo "   $(printf '%s' "$tables" | tr ',' '\n' | wc -l | tr -d ' ') table(s) with rows"
{ echo "begin;"; echo "set session_replication_role = replica;"; echo "truncate $tables cascade;"
  cat "$data"; echo "commit;"; } | psql_local >/dev/null
rm -f "$data"

echo "3. Restoring the stored files"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node supabase/scripts/backup_storage.mjs "$BACKUP/storage" --restore

echo "4. Row counts (compare with the ones saved in step 2)"
docker exec -i "$CONTAINER" psql -X -U postgres -d postgres <<'SQL'
select 'profiles' t, count(*) from public.profiles union all select 'sops', count(*) from public.sops
union all select 'sop_versions', count(*) from public.sop_versions union all select 'review_requests', count(*) from public.review_requests
union all select 'compliance_checks', count(*) from public.compliance_checks union all select 'compliance_findings', count(*) from public.compliance_findings
union all select 'guideline_versions', count(*) from public.guideline_versions union all select 'guideline_requirements', count(*) from public.guideline_requirements
union all select 'departments', count(*) from public.departments union all select 'storage.objects', count(*) from storage.objects;
SQL

echo "   Schema: the local database against the backup's schema.sql"
local_schema="$(mktemp)"
supabase db dump --db-url "$DB_URL" -f "$local_schema" >/dev/null 2>&1
if diff -q "$BACKUP/schema.sql" "$local_schema" >/dev/null; then
  echo "   The same: the local schema is the hosted schema."
else
  cp "$local_schema" "$BACKUP/schema.local.sql"
  echo "   DIFFERENT. Compare them: diff \"$BACKUP/schema.sql\" \"$BACKUP/schema.local.sql\""
  echo "   (each difference is something on hosted that the migrations don't have, or the other way round)"
fi
rm -f "$local_schema"
echo "Done. Next: docs/multi-tenancy.md, rehearsal step L3 (the migration history)."
