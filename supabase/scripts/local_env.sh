#!/usr/bin/env bash
# For the rehearsal on the local stack (docs/multi-tenancy.md): the local stack's URL and keys, taken from
# `supabase status`, without showing them. Refuses anything that isn't the local stack.
#
#   bash supabase/scripts/local_env.sh <command> [args...]   runs it with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
#   bash supabase/scripts/local_env.sh --frontend            prints frontend/.env.local's two lines for the local stack
set -euo pipefail
status="$(supabase status -o env 2>/dev/null)" || { echo "The local stack isn't running: supabase start" >&2; exit 2; }
value() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
API_URL="$(value API_URL)"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "Refusing: $API_URL isn't the local stack" >&2; exit 2 ;; esac
if [ "${1:-}" = --frontend ]; then
  printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_PUBLISHABLE_KEY=%s\n' "$API_URL" "$(value ANON_KEY)"
  exit 0
fi
[ $# -gt 0 ] || { echo "Usage: bash supabase/scripts/local_env.sh <command> [args...] | --frontend" >&2; exit 2; }
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$(value SERVICE_ROLE_KEY)" exec "$@"
