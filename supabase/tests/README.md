# Database and integration tests

Every test here runs against a **local** Supabase stack only. The JS tests refuse any URL that isn't
localhost. The SQL tests roll themselves back unless they are part of a migration sequence (see below).
Never run them against the shared project. The exception is `staff_management_rollback.sql`, which is
written to be safe there.

## The normal run

```bash
supabase start
supabase functions serve --env-file <file>     # in a second terminal; the file is shown below
bash supabase/tests/run_all.local.sh
```

The env file for the Edge Functions contains:

```
SNDR_API_KEY=local-test-only
SNDR_API_URL=http://host.docker.internal:56498/v1/send
SITE_URL=http://127.0.0.1:5179
```

`run_all.local.sh` does these steps in order:

1. It resets the database (`supabase db reset`: every migration and `seed.sql`). Set `SKIP_RESET=1` to skip this.
2. It runs every `*.sql` test in its own session.
3. It runs the `*.local.mjs` tests and `organization_migrations.mjs`. `storage_move.local.mjs` runs first: its `--reverse` checks need MedCare to be the only organization, and the other local tests leave theirs behind.
4. It runs the compliance service's unit tests (`compliance-service/test_*.py`, no model is loaded), the
   frontend's calendar parity test and vitest.

It exits with 1 if anything failed.

The `*.local.mjs` tests create people the way the app does (`local_people.mjs`):

- The first Admin is the Super Admin, if the database has one. Otherwise it is the first active Admin.
  Otherwise one is created through Request Hawkim.
- Everyone else is added with `add_user`, which is what Add Staff and Add Admin call.
- Fixture reads and writes run as the database owner. The API roles, the service role included, have
  no direct table access.

## Left out of the normal run

### Migration-sequence tests

These tests check a migration and its rollback script step by step. They only pass at their step.
Some of them keep their fixtures, which would change every later test. Run each sequence on its own
fresh local database (`supabase db reset`), in this order.

**`20261112140000_admins_without_department.sql`**

The migration has to run after the fixtures, so first reset to the migration before it:

```bash
supabase db reset --version 20261112130000   # every migration up to and including 20261112130000
psql "$DB" -f supabase/tests/admins_without_department_before.sql       # 1. fixtures (kept)
psql "$DB" -f supabase/migrations/20261112140000_admins_without_department.sql   # 2.
psql "$DB" -f supabase/tests/admins_without_department.sql              # 3. assertions (rolled back)
psql "$DB" -f supabase/tests/admins_without_department_request.sql      # 4. a request without a position (kept)
psql "$DB" -f supabase/scripts/rollback_admins_without_department.sql   # 5.
psql "$DB" -f supabase/tests/admins_without_department_rolled_back.sql  # 6.
```

`DB` is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Alternatively, pipe each file into
`docker exec -i supabase_db_Hawkim psql -U postgres -d postgres -v ON_ERROR_STOP=1`.

**Rollback checks**

Each of these checks that a rollback script left nothing of its migration behind. A rollback script for
an older migration can only run while the later migrations that depend on it aren't applied yet. So
reset to that migration first, run the script, then run the check:

| Reset to | Script | Then run |
|---|---|---|
| `supabase db reset --version 20261112130000` | `scripts/rollback_invitation_resend.sql` | `invitation_resend_rolled_back.sql` |
| `supabase db reset --version 20261111140000` | `scripts/rollback_organization_settings.sql` | `organization_settings_rolled_back.sql` |
| (the sequence above) | `scripts/rollback_admins_without_department.sql` | `admins_without_department_rolled_back.sql` |

Afterwards, `supabase db reset` brings back every migration.

### Other tests

- `*.browser.local.mjs`: these drive the app in Chrome (`CHROME_PATH`, `HAWKIM_APP_URL`, puppeteer-core).
  The header of each file says how to run it.
- `organization_anonymous_readonly.mjs`: a read-only, anonymous check of the project the frontend is
  configured for (`frontend/.env.local`). It isn't local.
