# Multi-tenancy: one database, many organizations

Hawkim serves many organizations from one Supabase project: one database, one storage, one compliance
service. Each accepted **Request Hawkim** creates a new organization. The data that existed before is the
organization **MedCare**.

## How organizations are kept apart

| Layer | What keeps an organization's data its own | Migration |
|---|---|---|
| Data | `public.organizations`, and `organization_id` on the 26 tables that hold an organization's data. The database sets it (trigger `a0_organization`): from the parent row, or from the caller's profile. It never comes from the browser and never changes. Composite foreign keys `(organization_id, …)` stop rows from pointing into another organization. | `20261116120000_organizations` |
| Name, profile, Super Admin | Columns of `organizations`. They replace the `organization_settings` and `super_admin` singletons, one row per organization. | `20261116140000` |
| Reading through the API | One restrictive policy, **Same organization only**, on every table (`organization_id = current_organization_id()`). It applies on top of every read policy. Nobody without an active profile sees anything. | `20261116150000` |
| Functions | Every function a signed-in user can call only finds the caller's organization's rows. Another organization's id gets the same answer as an id that doesn't exist. | `20261116160000` – `20261116220000`, `20261117140000`, `20261117150000` |
| Storage | Every file is in its organization's folder (below). The restrictive policy **Organization folder only** limits every read, upload and delete through the API in `sop-files` and `guideline-files`. `guideline-indexes` stays service-role only. | `20261116230000` |
| Compliance service | One queue for everybody. Each job carries its organization, and `worker.py` refuses files outside that organization's folder. | `20261116220000`, worker |
| Locks | `lock_organization_changes(organization)`: one organization's staff, organization and GVP changes run one at a time, and other organizations don't wait. | `20261117130000` |

Stored files:

| Bucket | Path |
|---|---|
| `sop-files` | `<organization id>/<user id>/<random id>.pdf` or `.docx` |
| `guideline-files` | `<organization id>/files/<random id>.pdf` |
| `guideline-indexes` | `<organization id>/versions/<version id>/…` |

### Per organization

- Divisions and departments. Names and initials are unique within an organization.
- At most one Quality department.
- SOP codes: each organization starts at SOP-001.
- GVP versions, their numbers, and the **current** version. A compliance check uses its SOP's organization's current version.
- The rule "one GVP version waiting or processing at a time".
- The Super Admin.
- "Hawkim must always have an Admin".

### Shared by every organization

- **Sign-in accounts (Supabase Auth).** One account belongs to one organization. An email that already has an account in any organization is "taken" everywhere: Add Staff, Add Admin and Request Hawkim all refuse it. That tells another organization only that the email has an account, not where.
- **The compliance service (`worker.py`).** It processes one job at a time for every organization: compliance checks first, then GVP versions, oldest first. **A GVP version being processed delays every organization's checks.** The Waiting card shows a waiting version's place in that queue (`guideline_queue_position`, which returns only a number).
- **The service's status** (`compliance_service_status`). While the service is offline, a check uses the sample engine only if its organization's current version has sample findings. Any other organization's check waits for the service.

### A new organization

Accepting a request (the `access-requests` Edge Function → `accept_access_request`) creates:

- the organization, with its name and Organization Profile taken from the request;
- the departments **Pharmacovigilance** (PV, compliance check required) and **Quality Assurance** (QA, the Quality department). Departments added later don't require the check by default;
- the applicant as its **Super Admin**: an Admin, without a department or position.

## Tests

`bash supabase/tests/run_all.local.sh` runs everything against the local stack (see `supabase/tests/README.md`). The isolation tests:

- **`multi_tenant_isolation.sql`:**
  - **Functions:** every function a signed-in user can call is tested from the catalog. A function without a case fails the test. Organization B's Admin and author must get the same answer for organization A's real ids as for ids that don't exist.
  - **Tables:** every table, with the broadest grants the API roles could have. B reads, counts, updates and deletes no row of A's.
  - **Storage:** B sees no file of A's and can't upload into A's folder.
  - **Worker jobs:** finishing B's GVP version and B's compliance check changes nothing of A's.
- **`multi_tenant_isolation.local.mjs`:** the same through the real API: Storage (all three buckets), the Edge Functions (`delete-sop`, `delete-department`, `update-user-email`, `resend-invitation`) and PostgREST.
- **`add_user_other_organization.local.mjs`:** `add-user` across organizations.
- **One test per migration**, in `supabase/tests/`.

## The release (one window)

The website (`tryhawkim.com`) deploys from `develop`. The hosted database is changed only by hand. The new frontend (commit 16, kept local until the window) needs the new database, and the new database refuses the old frontend's uploads. So the steps below happen together, in one window, while nobody uses Hawkim. Estimated time: about an hour.

Placeholders used below:

- `$DB_URL`: the database connection string. Supabase Dashboard → Connect → **Session pooler**, port 5432.
- `$SUPABASE_URL` and `$SUPABASE_SERVICE_ROLE_KEY`: the project URL and the service role key, from Settings → API.

Keep the key out of shell history and files.

### 0. Before the window

- **Check what's already applied.** The hosted history ends at `20261114130100_pending_review_duration`, and three later migrations were applied by hand in the SQL Editor. Confirm, in the SQL Editor:
  ```sql
  select to_regprocedure('public.submit_access_request(text,text,text,text,text,integer,text,text,text,text,text,text,text)') is not null as m_20261115120000,
         to_regprocedure('public.report_guideline_progress(uuid,integer,text,text)') is not null        as m_20261115130000,
         to_regprocedure('public.save_guideline_passages(uuid,jsonb,boolean)') is not null              as m_20261115140000,
         (select prosrc like '%Reading the regulatory requirements file%' from pg_proc
          where oid = 'public.claim_guideline_processing()'::regprocedure)                              as m_20261115150000;
  ```
  All four should be `true`. A `false` means that migration isn't applied yet: it then runs in step 3 instead of being marked.
- **Check the queue** has at most one GVP version waiting or processing per organization (`20261116210000` stops if not):
  ```sql
  select processing_status, count(*) from public.guideline_version_drafts
  where processing_status in ('waiting', 'processing') group by 1;
  ```
- **Announce the maintenance window.**

### 1. Stop everything that writes

- Stop `worker.py` (Ctrl+C in its window).
- Keep users out. Announce it, and don't share the site during the window.

### 2. Back up (the Free plan has no backups)

**The database.** It needs Docker (or a local `pg_dump` 17). Make a complete archive of every schema (`auth`, `storage`, `public`), plus Supabase's restore-friendly dumps:

```bash
mkdir -p backup-YYYYMMDD && cd backup-YYYYMMDD
docker run --rm -v "$PWD":/backup postgres:17-alpine \
  pg_dump "$DB_URL" --format=custom --no-owner --file=/backup/hawkim.dump
docker run --rm -v "$PWD":/backup postgres:17-alpine pg_restore --list /backup/hawkim.dump > hawkim.dump.list
supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$DB_URL" -f schema.sql
supabase db dump --db-url "$DB_URL" -f data.sql --data-only --use-copy
```

**The row counts**, kept to compare with afterwards. Run in the SQL Editor and save the result:

```sql
select 'profiles' t, count(*) from public.profiles union all select 'sops', count(*) from public.sops
union all select 'sop_versions', count(*) from public.sop_versions union all select 'review_requests', count(*) from public.review_requests
union all select 'compliance_checks', count(*) from public.compliance_checks union all select 'compliance_findings', count(*) from public.compliance_findings
union all select 'guideline_versions', count(*) from public.guideline_versions union all select 'guideline_requirements', count(*) from public.guideline_requirements
union all select 'departments', count(*) from public.departments union all select 'storage.objects', count(*) from storage.objects;
```

**The storage buckets.** This only reads. Then check the copy:

```bash
SUPABASE_URL=$SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  node supabase/scripts/backup_storage.mjs backup-YYYYMMDD/storage
node supabase/scripts/backup_storage.mjs backup-YYYYMMDD/storage --verify
```

Its file count should match the `storage.objects` row count. Keep the backup folder safe and off the shared drive: it contains every SOP.

**The compliance service's local index copies**, on the worker's computer: copy `compliance-service/index/` too.

### 3. The database migrations

```bash
supabase link --project-ref <project ref>
# Only the migrations that step 0 found applied by hand:
supabase migration repair --status applied 20261115130000 20261115140000 20261115150000
supabase db push --dry-run     # must list exactly the migrations below (plus 20261115120000 if step 0 said false)
supabase db push
```

`db push` applies these 16 migrations, each in one transaction:

1. `20261116120000_organizations`
2. `20261116130000_conflict_without_retry`
3. `20261116140000_organization_settings_per_organization`
4. `20261116150000_same_organization_policies`
5. `20261116160000_scope_staff_functions`
6. `20261116170000_scope_divisions_departments`
7. `20261116180000_scope_sops`
8. `20261116190000_scope_reviews`
9. `20261116200000_guideline_versions_per_organization`
10. `20261116210000_guideline_queue_per_organization`
11. `20261116220000_scope_compliance_checks`
12. `20261116230000_storage_organization_folders`
13. `20261117120000_storage_relocation_plan`
14. `20261117130000_accept_creates_organization`
15. `20261117140000_add_user_other_organization`
16. `20261117150000_isolation_fixes`

The first one checks that no row is lost, and stops otherwise. If any migration fails, `db push` stops there. Go to **If something goes wrong** below.

### 4. Move the stored files into MedCare's folder

```bash
SUPABASE_URL=$SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  node supabase/scripts/move_storage_to_organizations.mjs          # dry run: lists every file
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/move_storage_to_organizations.mjs --apply
```

It ends with "every row's file is in its organization's folder", or exits with 1 and says what's left. It's safe to run again.

### 5. The Edge Function

Only `access-requests` changed (accepting creates an organization):

```bash
supabase functions deploy access-requests
```

The other functions are unchanged by this work.

### 6. The website

Push the held frontend commit (commit 16) to `develop`. Vercel deploys it to `tryhawkim.com`. Wait until the deployment is **Ready**.

### 7. The compliance service

On its computer:

1. `git pull`.
2. Move `compliance-service/index/versions` to `compliance-service/index/<MedCare's organization id>/versions`, or delete it, because it's downloaded again when needed:
   ```powershell
   $org = '<MedCare id>'   # select id from public.organizations;
   New-Item -ItemType Directory -Force "compliance-service/index/$org" | Out-Null
   Move-Item compliance-service/index/versions "compliance-service/index/$org/versions"
   ```
3. Start `python worker.py`.

### 8. Check

In the SQL Editor:

```sql
select id, name, super_admin_id from public.organizations;                       -- one row: MedCare
select count(*) from public.profiles where organization_id is null;              -- 0 (the column is NOT NULL)
select count(*) from public.sop_versions v join public.organizations o on o.id = v.organization_id
where v.storage_path not like o.id::text || '/%';                                -- 0
```

Then:

- Compare the row counts with step 2.
- Sign in as MedCare's Super Admin. Open an SOP and its file, open the Organization Profile, and open SFDA Regulatory Requirements and a version's file.
- Start a compliance check and see the worker pick it up.
- Send yourself a test Request Hawkim and accept it. You should see a new organization with Pharmacovigilance and Quality Assurance, its Super Admin signing in, and none of MedCare's data.

### If something goes wrong

- **Before step 6**, the old website still runs, but its uploads are refused once `20261116230000` is in. Either finish the steps, or undo.
- **Undo the migrations** (only while MedCare is the only organization) by running the rollback scripts in reverse order, as `postgres` in the SQL Editor. Then remove the reverted versions from the history with `supabase migration repair --status reverted <version>`. If step 4 has already run, first move the files back out of the organization's folder.

  | Order | Rollback script |
  |---|---|
  | 1 | `supabase/scripts/rollback_isolation_fixes.sql` |
  | 2 | `rollback_add_user_other_organization.sql` |
  | 3 | `rollback_accept_creates_organization.sql` |
  | 4 | (`20261117120000`) `drop function public.storage_paths_to_relocate();` |
  | 5 | `rollback_storage_organization_folders.sql` |
  | 6 | `rollback_scope_compliance_checks.sql` |
  | 7 | `rollback_guideline_queue_per_organization.sql` |
  | 8 | `rollback_guideline_versions_per_organization.sql` |
  | 9 | `rollback_scope_reviews.sql` |
  | 10 | `rollback_scope_sops.sql` |
  | 11 | `rollback_scope_divisions_departments.sql` |
  | 12 | `rollback_scope_staff_functions.sql` |
  | 13 | `rollback_same_organization_policies.sql` |
  | 14 | `rollback_organization_settings_per_organization.sql` |
  | 15 | `rollback_conflict_without_retry.sql` |
  | 16 | `rollback_organizations.sql` |

- **Restore the backup** when the rollback scripts aren't enough. Restore `hawkim.dump` into a new project, or, following Supabase's restore guide, `roles.sql`, then `schema.sql`, then `data.sql`. Upload the storage backup back to its buckets.
- **The website:** Vercel → hawkim → Deployments → *Instant Rollback* to the deployment before step 6. `main` still has everything up to `8179fb9`.
