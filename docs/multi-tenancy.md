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

The website (`tryhawkim.com`) deploys from `develop`. The hosted database is changed only by hand. The new frontend (commit 16, kept local until the window) needs the new database, and the new database refuses the old frontend's uploads. So the steps below happen together, in one window, while nobody uses Hawkim. Estimated time: about an hour. Do the **rehearsal** (below) first,
on a copy, and only then the real window.

Rules for the team:

- **During the window, nobody pushes to `develop`.** Every push goes live on `tryhawkim.com` at once and
  would mix with the release. Hold your commits until the window is over and has been announced as done.
- **After the window, everyone runs, on their computer:**
  ```bash
  git pull
  supabase db reset        # every migration + seed.sql: your local database becomes multi-tenant too
  ```
  A local database without the new migrations doesn't match the website any more: uploads and most pages
  would fail against it. If `supabase db reset` reports an error, stop and say so; don't work around it.

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

`db push` applies these 17 migrations, each in one transaction:

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
17. `20261117160000_storage_relocation_reverse` (only used to undo step 4, see below)

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
- **If step 4 has already run**, first move the files back out of MedCare's folder, while the migrations are still in place. It refuses when there is more than one organization:
  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/move_storage_to_organizations.mjs --reverse          # dry run
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/move_storage_to_organizations.mjs --reverse --apply
  ```
  It ends with "every row's file is out of its organization's folder". If step 5 has run, also deploy the previous `access-requests` from `main` (`git checkout main -- supabase/functions/access-requests`, deploy, then `git checkout develop -- supabase/functions/access-requests`).
- **Undo the migrations** (only while MedCare is the only organization) by running the rollback scripts in reverse order, as `postgres` in the SQL Editor. Then remove the reverted versions from the history with `supabase migration repair --status reverted <version>`.

  | Order | Rollback script |
  |---|---|
  | 0 | `20261117160000`: `drop function public.restore_storage_path(text, text, text); drop function public.storage_paths_to_restore();` (after the `--reverse` move) |
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

- **Restore the backup** when the rollback scripts aren't enough. Restore `hawkim.dump` into a new project, or, following Supabase's restore guide, `roles.sql`, then `schema.sql`, then `data.sql`. Upload the storage backup back to its buckets with `backup_storage.mjs <folder> --restore`.
- **The website:** Vercel → hawkim → Deployments → *Instant Rollback* to the deployment before step 6. `main` still has everything up to `8179fb9`.

## The rehearsal (before the real window)

Steps 3–8 run once on a **copy** of the hosted project, a second free Supabase project, so any surprise
shows up there first. The real project, the website and the real worker are not changed. Do it a day or two
before the window, with the backup from step 2. Allow about two hours.

Below, `$R_REF`, `$R_DB_URL`, `$R_URL`, `$R_ANON_KEY` and `$R_SERVICE_ROLE_KEY` are the rehearsal project's
project ref, Session pooler connection string, URL, publishable (anon) key and service role key (Project
Settings → Database and → API Keys).

### R1. Make the backup

Do steps 1 and 2 above on the real project (step 2 only reads it), then let people use Hawkim again. From
here on the backup folder is only read.

### R2. Create the rehearsal project

- Supabase Dashboard → **New project**: name `hawkim-rehearsal`, the same region as the real project, a new
  database password.
- The Free plan allows two active projects. If you already have two, pause the other one first (not the real
  Hawkim project).

### R3. Restore the database into it

Roles, then the schema, then the data with triggers off while it loads (Supabase's "restore a backup into a
new project" steps):

```bash
cd backup-YYYYMMDD
docker run --rm -v "$PWD":/backup postgres:17-alpine psql "$R_DB_URL" \
  --single-transaction --variable ON_ERROR_STOP=1 \
  --file /backup/roles.sql --file /backup/schema.sql \
  --command 'SET session_replication_role = replica' --file /backup/data.sql
```

If `roles.sql` stops on a role that already exists, delete that statement from the file and run the command
again (it is one transaction: a failed run leaves nothing behind). Then run step 2's row-count query in the
rehearsal project's SQL Editor: the counts must equal the saved ones.

### R4. Restore the stored files into it

```bash
SUPABASE_URL=$R_URL SUPABASE_SERVICE_ROLE_KEY=$R_SERVICE_ROLE_KEY \
  node supabase/scripts/backup_storage.mjs backup-YYYYMMDD/storage --restore
```

It creates any missing bucket with the settings it had, checks every file against the manifest, and uploads
it at the same path. The number it prints must equal step 2's file count.

### R5. The migration history

```bash
supabase link --project-ref $R_REF
supabase migration list
```

The restore may or may not have brought the history along (it depends on what `supabase db dump` included). It
must look like the real project's: applied up to `20261114130100`, nothing newer. If it is empty, mark every
migration up to and including `20261114130100` as applied with
`supabase migration repair --status applied <version> ...`. Then run step 0's checks in the rehearsal
project's SQL Editor: the answers must be the same as on the real project.

### R6. Steps 3–8 on the rehearsal project

Follow the steps above, with the rehearsal values everywhere:

| Step | On the rehearsal project |
|---|---|
| **3** | Already linked to `$R_REF` (R5). The same `repair`, `db push --dry-run` and `db push`. |
| **4** | `move_storage_to_organizations.mjs` with `SUPABASE_URL=$R_URL SUPABASE_SERVICE_ROLE_KEY=$R_SERVICE_ROLE_KEY`: dry run, then `--apply`. |
| **5** | `supabase functions deploy access-requests --project-ref $R_REF`, then `supabase secrets set --project-ref $R_REF SITE_URL=http://localhost:5173` and the email key (a test key, or any value: accepting still works and only says the email couldn't be sent). |
| **6** | **Don't push.** Run the held frontend commit on your computer against the rehearsal project (below). |
| **7** | Run the worker against the rehearsal project (below). The real `.env` stays as it is. |
| **8** | The same checks on `http://localhost:5173`, **except the test Request Hawkim**: it creates a second organization, and the undo (R7) only works while MedCare is the only one. It comes after R7. |

Step 6, the website on your computer (the held commit is already on your local `develop`):

```bash
cd frontend
cp .env.local .env.local.real          # keep your usual settings, if you have the file
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_PUBLISHABLE_KEY=%s\n' "$R_URL" "$R_ANON_KEY" > .env.local
npm run dev                            # http://localhost:5173
```

Step 7, the worker, in a new PowerShell window (the variables override `.env` for this window only). Stop
the real worker first: two workers on one computer need twice the RAM.

```powershell
cd compliance-service
$env:SUPABASE_URL = '<R_URL>'; $env:SUPABASE_SECRET_KEY = '<R_SERVICE_ROLE_KEY>'
python worker.py
```

### R7. Rehearse the undo too

On the rehearsal project, in the order of "If something goes wrong":

1. `move_storage_to_organizations.mjs --reverse` (dry run), then `--reverse --apply`.
2. The rollback scripts in the order of the table, then `supabase migration repair --status reverted <version>` for each.
3. Check that the old website (`main`) works against it again. Clone `main` into a separate folder, so
   your `develop` and its held commit stay as they are:
   ```bash
   git clone --branch main <repository URL> hawkim-main
   cp frontend/.env.local hawkim-main/frontend/.env.local      # the rehearsal settings
   cd hawkim-main/frontend && npm install && npm run dev
   ```
   Sign in, open an SOP's file and a GVP version.
4. Undo step 5 the same way: deploy `access-requests` from `hawkim-main` with `--project-ref $R_REF`.

Then go forward again, as in the real window: steps 3, 4 and 5 from R6 once more (the `repair` marks the
reverted versions as not applied, so `db push` applies them again), the website from your `develop` folder,
and step 8 **with** the test Request Hawkim this time: accept it, sign in as the new Super Admin, and check
that MedCare's SOPs, people and GVP versions aren't visible.

### R8. Clean up

- `frontend/.env.local`: put yours back (`mv .env.local.real .env.local`). Close the PowerShell window with
  the rehearsal variables and start the real worker again. Delete the `hawkim-main` folder.
- Relink the CLI to the real project: `supabase link --project-ref <real ref>`.
- **Delete the rehearsal project**: Project Settings → General → Delete project. It holds a full copy of the
  real data.
- Write down anything that went differently from these steps and fix this document before the real window.
