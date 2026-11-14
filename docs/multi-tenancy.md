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
on your computer's local stack with a copy of the hosted data, and only then the real window.

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

- **Check what's already applied.** The hosted history ends at `20261114130100_pending_review_duration`, and four later migrations were applied by hand in the SQL Editor. Confirm, in the SQL Editor:
  ```sql
  select to_regprocedure('public.submit_access_request(text,text,text,text,text,integer,text,text,text,text,text,text,text)') is not null as m_20261115120000,
         to_regprocedure('public.report_guideline_progress(uuid,integer,text,text)') is not null        as m_20261115130000,
         to_regprocedure('public.save_guideline_passages(uuid,jsonb,boolean)') is not null              as m_20261115140000,
         (select prosrc like '%Reading the regulatory requirements file%' from pg_proc
          where oid = 'public.claim_guideline_processing()'::regprocedure)                              as m_20261115150000;
  ```
  All four should be `true`. A `false` means that migration isn't applied yet: it then runs in step 3 instead of being marked.

  **Result (2026-11-14): all four `true`, and the queue check below returned no rows.** Step 3 marks all four as applied. Run both checks again on the day of the window; if anything differs, stop and update step 3 first.
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
# The four migrations step 0 found applied by hand (all four true on 2026-11-14):
supabase migration repair --status applied 20261115120000 20261115130000 20261115140000 20261115150000
supabase migration list        # remote: applied up to 20261115150000; the 17 below are local only
supabase db push --dry-run     # must list exactly the 17 migrations below, 20261116120000 to 20261117160000, nothing else
supabase db push
```

`db push` applies these 17 migrations, each in one transaction. If the dry run lists anything else (in particular one of the four `20261115…` migrations), or fewer than 17, stop: don't push.

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
- **Undo the migrations** (only while MedCare is the only organization) by running the rollback scripts in reverse order, as `postgres` in the SQL Editor. NOTICEs about dropped constraints are expected. Then remove the reverted versions from the history with `supabase migration repair --status reverted <version>`. `supabase/tests/multi_tenant_rollback.local.sh` checks this order end to end: the schema afterwards is the hosted one, statement for statement.

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

Steps 3–8 and the undo run once on **your computer's local Supabase stack**, loaded with the hosted
project's backup, so any surprise shows up there first. (The Free plan allows no second project.) The hosted
project is only read, by step 2. The website on `tryhawkim.com` and the real worker are not changed. Do it a
day or two before the window. Allow about two hours.

- **No key or password goes into a chat, a file in the repository, or a command line you share.** The local
  stack's keys come from `supabase status` inside the scripts below. The hosted connection string is used only
  by step 2, in your own terminal.
- **The local stack will hold a full copy of the real data**, including every SOP file. L7 removes it.
- **Nothing is emailed to anyone.** The restored data has real addresses, but the local Auth sends its emails
  to Mailpit (`http://127.0.0.1:54324`), and in L4 the Edge Function's emails go to Mailpit too
  (`local_email_to_mailpit.mjs`). Open them there.
- The same test, without real data, runs automatically: `bash supabase/tests/multi_tenant_rollback.local.sh`.
  It builds the hosted state locally, applies the 17 migrations, undoes them, and checks that the schema is
  the same statement for statement and that no row is lost.

### L1. The backup (hosted project, read only)

Do step 2 on the hosted project: the database dumps, the row counts and the storage backup with `--verify`.
Save the row counts in `backup-YYYYMMDD/row_counts.txt`. Nobody has to stop using Hawkim for this; only the
real window's backup has to be taken with everything stopped.

### L2. Restore it into the local stack

The local stack is replaced. Commit or note anything you need from it first.

```bash
supabase start                                    # if it isn't running
bash supabase/scripts/restore_backup_locally.sh backup-YYYYMMDD
```

The script:

1. Puts the local database at the hosted state: the migrations up to `20261114130100` (the hosted history),
   then the four `20261115…` migrations by hand, outside the history, as on hosted.
2. Empties every table `data.sql` has rows for and loads it in one transaction. That includes `auth.users`
   with the password hashes, so everyone's real password works locally.
3. Uploads every stored file into the local Storage, after checking it against the manifest.
4. Prints the row counts and compares the local schema with the backup's `schema.sql`.

Check:

- **The row counts equal `row_counts.txt`.**
- **It says "The same: the local schema is the hosted schema."** If it says DIFFERENT, stop and compare the two
  files it names. Each difference is something on hosted that the migrations don't have (or the other way
  round), and step 3 would meet it on hosted too.

If signing in later fails with "Database error querying schema", some `auth.users` rows were created with plain
SQL instead of by Auth (their token columns are NULL). Stop and say so; don't edit them.

### L3. Step 0 and the migration history

```bash
supabase migration list --local     # applied up to 20261114130100; the four 20261115… and the 17 are local only
```

In the local database (`docker exec -it supabase_db_Hawkim psql -U postgres`), step 0's checks must give the
same answers as on hosted: all four `true`, and no GVP version waiting or processing.

### L4. Steps 3–8 on the local stack

| Step | Locally |
|---|---|
| **3** | `supabase migration repair --local --status applied 20261115120000 20261115130000 20261115140000 20261115150000`, then `supabase db push --local --dry-run` (exactly the 17), then `supabase db push --local`. |
| **4** | `bash supabase/scripts/local_env.sh node supabase/scripts/move_storage_to_organizations.mjs`, then the same with `--apply`. |
| **5** | Create `supabase/functions/.env` (git ignores it) with the lines below. Then, each in its own terminal: `node supabase/scripts/local_email_to_mailpit.mjs` and `supabase functions serve`. It serves the `access-requests` of your working copy. |
| **6** | **Don't push.** In `frontend/`, keep your settings (`cp .env.local .env.local.real`), then `bash ../supabase/scripts/local_env.sh --frontend > .env.local` and `npm run dev`. The website runs on `http://localhost:5173` from your `develop`, which has the held commit on top. |
| **7** | Stop the real worker (two workers need twice the RAM). In a new PowerShell window, from the repository, run the lines below. They override `.env` for this window only and show no key. Leave `compliance-service/index/` as it is: step 7's move is for the real window only. |
| **8** | Step 8's SQL in the local database, and the checks on `http://localhost:5173`, **except the test Request Hawkim**. It creates a second organization, and the undo only works while MedCare is the only one. It comes after L5. |

`supabase/functions/.env` for step 5. No real email key: the emails go to `local_email_to_mailpit.mjs`, which
hands them to Mailpit, and their links point to `http://localhost:5173`:

```
SITE_URL=http://localhost:5173
SNDR_API_KEY=rehearsal
SNDR_API_URL=http://host.docker.internal:56499/v1/send
```

Step 7, the worker (PowerShell):

```powershell
$s = supabase status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $s.API_URL; $env:SUPABASE_SECRET_KEY = $s.SERVICE_ROLE_KEY
cd compliance-service; python worker.py
```

Sign in with your real Hawkim account and password: they came with the backup.

### L5. The undo, then forward again

The undo, in the order of **If something goes wrong**:

1. `bash supabase/scripts/local_env.sh node supabase/scripts/move_storage_to_organizations.mjs --reverse`, then the same with `--reverse --apply`.
2. The rollback scripts in the order of the table, in the local database:
   `docker exec -i supabase_db_Hawkim psql -U postgres -v ON_ERROR_STOP=1 < supabase/scripts/rollback_<name>.sql`
   (rows 0 and 4 are the two `drop function` lines: paste them into `psql`). The NOTICEs about dropped
   constraints are expected. Then
   `supabase migration repair --local --status reverted 20261116120000 … 20261117160000` (all 17).
3. The old website against it: `git worktree add --detach ../hawkim-main origin/main`, copy
   `frontend/.env.local` into `../hawkim-main/frontend/`, then `npm install` and `npm run dev` there. Sign in,
   open an SOP's file and a GVP version. Stop it, and serve the old `access-requests` the same way: stop
   `supabase functions serve` and start it from `../hawkim-main` (copy `supabase/functions/.env` there too).

Then forward again, as in the real window: in your repository, steps 3, 4 and 5 from L4 once more (`db push
--local` applies the 17 again), the website from your `develop`, and step 8 **with** the test Request Hawkim:
submit it on `http://localhost:5173` with an address like `you+rehearsal@…`. In Mailpit, open "Hawkim request:
…" and its review link, and accept. Open "Your Hawkim account is ready", set the password, sign in as the
new Super Admin, and check that MedCare's SOPs, people and GVP versions aren't
there. Then sign in as MedCare's Super Admin and check that the new organization isn't visible either.

### L6. What the rehearsal can't cover

The local stack is close to hosted, but not the same. Run `supabase services` while linked to the hosted
project to see both sides' versions. On 2026-11-14 the local stack was Postgres `17.11.0.003`, PostgREST
`v14.18`, Auth (GoTrue) `v2.197.0`, Storage `v1.80.2` and Edge Runtime `v1.74.3`.

| Not covered | Why it matters | What covers it |
|---|---|---|
| **Service versions** | A different PostgREST, Auth or Storage version can behave differently (errors, embeds, Storage's move). | `supabase services`. A version difference is worth a look, not a stop. Step 8 on hosted. |
| **Settings outside the database** | Auth (Site URL, redirect URLs, email templates, SMTP, rate limits), API (exposed schemas, max rows), Storage's global file size limit and the Edge Function secrets are set in the Dashboard. The backup doesn't have them. | They aren't changed by the release. Step 8 on hosted. |
| **Grants made by the platform** | Hosted gives `service_role` and the API roles some table grants the local stack doesn't. The tests found that the scripts work without them. | The schema comparison in L2 shows any grant in `public` that differs. |
| **The connection** | `db push` runs over the network through the pooler, and the hosted database is smaller (Free plan). Timeouts and run times differ. | Each migration is one transaction: one that fails leaves nothing half done. |
| **The website's build** | Locally the website runs with `npm run dev`, not Vercel's production build and environment variables. | `npm run build` passes. Vercel's deployment must be Ready in step 6. |
| **Real email** | Nothing is sent in the rehearsal. | Step 8's test Request Hawkim on hosted. |
| **The data since the backup** | Anything done after L1 isn't in the rehearsal. | The real window takes its own backup (step 2) with everything stopped. |
| **The SQL Editor** | The rollback runs through `psql` locally, and in the SQL Editor on hosted (as `postgres` in both). | The same role and the same scripts. |

### L7. Clean up

- Stop `supabase functions serve`, `local_email_to_mailpit.mjs` and `npm run dev` (Ctrl+C).
- `frontend/.env.local`: put yours back (`mv .env.local.real .env.local`). Delete `supabase/functions/.env`
  if it only had the rehearsal lines. Close the PowerShell window with the rehearsal variables, and start
  the real worker again.
- Delete the old website's folder: `git worktree remove ../hawkim-main`.
- Delete the worker's copy of the local indexes: `compliance-service/index/<local MedCare id>/` (the local
  MedCare's id isn't the hosted one).
- **Remove the real data from the local stack:** `supabase stop --no-backup` (this deletes its volumes,
  including the stored files), then `supabase start` and `supabase db reset`.
- Keep `backup-YYYYMMDD` safe until after the real window; then delete it like any copy of the real data.
- Write down anything that went differently from these steps, and fix this document before the real window.
