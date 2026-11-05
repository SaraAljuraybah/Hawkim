# Divisions & Departments

Branch `feat/divisions-departments`. The management migrations and Edge Functions have not been
deployed to hosted Supabase by this work. Hosted catalog/configuration access was read-only; integration
tests ran only in disposable local environments.

**Approved final product policy (5 November 2026): active Admin users only may view either organization
interface, read the management hierarchy, or modify divisions/departments.** The local remediation and
current hosted readiness findings are in [the deployment plan](hosted-supabase-deployment-plan.md).
Its deployment restrictions supersede the older rollout instructions and historical test notes here.

## What is implemented

- **One hierarchical table** (`/admin/divisions-departments`): columns Name, Employees, SOPs, Actions.
  Each division row shows its name with `Departments (N)` underneath. The chevron and the name are a
  single toggle (`aria-expanded`). Column widths are fixed, so expanding or searching never shifts them.
- **Totals** come from the database: the snapshot RPC returns each division's department count, distinct
  active employees and live SOP records over *all* its departments. They do not depend on expansion or
  search. SOP totals count SOP records, never versions.
- **Expanded division**: a section header with `Departments` on the left (no count) and `+ Add Department`
  on the right, using the same `Button` component, variant and size as `+ Add Division`. It opens the
  department form pre-bound to that division (no division picker). Collapsed divisions show neither.
- **Search** opens matching divisions; they can still be collapsed while searching.
- **Actions**: division View / Edit / Delete; department Edit / Delete (existing `IconButton` styles).
  Disabled actions explain why in their tooltip (division with departments; department with employees;
  department whose file cleanup is pending).
- **Division preview**: existing `FormDialog`; Edit in the header (top-right, new opt-in `headerAction`
  prop); description; email as a read-only `TextField` with a Copy button inside it and a status message
  (`Copied!` / failure fallback).
- **Department details**: description under the title; employees table with Name, Email, **Positions**
  (badges, same style as permission badges) and an Edit-positions action; With Access; SOP status counts.
- **Multiple positions per employee** (new): admin edits an employee's positions in a dialog (1–10 titles,
  up to 100 characters, case-insensitive duplicates removed, the first is the primary one).
- **Deletion**: see the rules below. "Move to Others" is the default; "Delete SOPs" requires an extra
  checkbox and runs through the secure Edge Function with durable, retryable Storage cleanup.

## Database (migrations, in order)

| Migration | Contents |
| --- | --- |
| `20261105120100_organization_admin_authorization.sql` | Forward repair of hosted visibility drift; strict Admin-only read helper, independent `can_manage_organization`, Admin-only division RLS and minimal hierarchy payload |
| `20261105120200_divisions_departments_management.sql` | `divisions.email`, `departments.updated_at`, `sops.deleted_at`, `sops.directory_group`; audit table; admin RPCs `get_divisions_departments`, `save_division`, `delete_division`, `save_department`, `delete_department`; assignment and retained-SOP guards |
| `20261105120300_access_request_admin_decisions.sql` | Forward onboarding hardening from observed definitions: active Admin decisions, matching new Auth identity, no existing-employee repurposing; external caller update remains a deployment blocker |
| `20261105130000_department_storage_cleanup.sql` | Durable deletion job (`department_file_deletions` + items), `begin_department_file_deletion`, `get_department_file_deletion` (admin), `claim_…`/`ack_…` (service role only), path-reuse policy |
| `20261105140000_employee_positions.sql` (**new**) | `employee_positions` table, home-department guard, sync from `profiles.position`, commit-time "position required" rule, backfill, admin RPC `set_employee_positions`, snapshot with positions and server division totals |
| `20261105150000_department_storage_verification.sql` (**new**) | `department_file_paths_present` (service role only); `ack_department_file_deletion` refuses any path still present in `storage.objects` |
| `20261105160000_user_management_and_consistency.sql` (**new**) | Position sync fix; read-only `get_employees_missing_positions`; optional division email; persisted users (`create_employee_profile`, `set_user_roles`, `delete_user_profile`, internal `user_role_in_use`); deterministic `latest_round()` |

Existing tables are reused (`divisions`, `departments.division_id`, `profiles.department_id`, `user_roles`,
`sops`, `sop_versions`, review/compliance tables). No duplicate tables or conflicting foreign keys.

### Positions model

- `employee_positions(profile_id, department_id, title, sort_order)`, unique per
  `(profile, department, lower(title))`. A position can only be held in the employee's **current home
  department** (`profiles.department_id`, which still drives every access rule).
- **Required**: deferred constraint triggers check at commit that every active profile with a department
  holds at least one position there (on profile insert/department change, and on position update/delete).
- `profiles.position` remains the primary position (read by the profile/user pages) and is synced into the
  table; a department change drops the old department's positions and carries the primary one over.
- Editing `profiles.position` directly **replaces** the primary row (renamed in place; if the new title is
  already one of the employee's titles, that row becomes first and the old primary row goes). Secondary
  titles are never touched. `set_employee_positions` and `create_employee_profile` write the whole ordered
  list themselves and switch the profile trigger off for their own statements (`hawkim.positions_managed`).
- Browser: read-only (active users, same as profiles). Writes only through `set_employee_positions`
  (admin, audited).
- Legacy profiles that have a department but no `profiles.position` stay valid until their department or
  positions change; the department page shows them as "Position required". Nothing is invented. Audit
  (admin RPC `get_employees_missing_positions()`, read only) or in SQL:

  ```sql
  select p.id, p.full_name, p.department_id from public.profiles p
  where p.deleted_at is null and p.department_id is not null
    and not exists (select 1 from public.employee_positions e
                    where e.profile_id = p.id and e.department_id = p.department_id);
  ```

## Security

- Read RPCs check `can_read_organizational_structure()`; administrative mutations independently check
  `can_manage_organization()`. Both require an active Admin role/profile and an Auth user not deleted or
  banned. Functions are `security definer` with an empty `search_path`; `public`/`anon` have no
  execute rights; browser table writes are not granted. The audit table is private.
- Cleanup worker RPCs (`claim_…`, `ack_…`, `department_file_paths_present`) are executable by
  `service_role` only, and the service-role key is used only inside the Edge Function.
- **Edge Function `delete-department`** with `verify_jwt = false`: the function itself requires a
  `Bearer` token, verifies it with `auth.getUser(token)` against the Auth server, then calls
  `can_manage_organization()` **as that user**. Anonymous keys, expired/forged tokens and
  non-admins get 401/403 before any service-role client is created. The gateway check is off so the
  function can answer CORS preflight and so it keeps working if the project moves to the newer JWT
  signing keys; the in-function check is stricter than the gateway's (it also rejects banned/deleted
  users and non-admins). Setting `verify_jwt = true` is also safe with legacy keys if you prefer both. Invalid bodies get
  400; responses never include paths, SQL errors or credentials.

## Users (Add User, permissions, delete) — persisted

- **Add User** → Edge Function `manage-users` (`action: 'create'`): verifies the caller (as below), runs
  `create_employee_profile` as the admin in **dry-run** mode (every rule checked before any account exists),
  then `auth.admin.inviteUserByEmail` (service role, server only), then `create_employee_profile` with the
  new Auth id: profile (email lower-cased, phone normalised to `+9665XXXXXXXX`, initials), ordered positions
  and roles in one transaction. If that fails, the new Auth user is deleted again. The invitation opens
  `/reset-password` (which now accepts `type=invite` links) to set the first password.
- **Permissions** → admin RPC `set_user_roles`: own Admin can't be removed, at least one admin remains,
  Admin is exclusive, Approver only in Quality, Author/Reviewer can't be removed while in use on SOPs
  (same rule as `lib/userAdmin.ts`; Approver assignments aren't stored in the database yet).
- **Delete** → `manage-users` (`action: 'delete'`): `delete_user_profile` (not self, not the last admin,
  no work in progress) ends the profile (`deleted_at`; name and history kept), then the Auth account is
  banned. A repeat is allowed, so a failed ban can be retried.
- All three are audited in `organization_management_audit`. Counts on Divisions & Departments come only
  from persisted profiles (`deleted_at is null`), so they change only after the database commits.

## Deletion rules

- **Division**: cannot be deleted while it has departments (including one whose file cleanup is pending).
  Deletion is a soft `is_active = false`; nothing is cascaded.
- **Department with employees**: cannot be deleted. Enforced in `delete_department` and
  `begin_department_file_deletion`; concurrent assignment is serialized by row locks and triggers, so a
  removal and an assignment can never both commit.
- **Department without SOPs**: simple confirmation (`empty`).
- **Department with SOPs** — the admin chooses:
  - **Move to Others** (default, `others`): SOP records, every version, files, history, co-authors and
    author access are kept; `sops.directory_group = 'others'`; the department becomes a removed tombstone
    (its id stays on the SOPs as ownership/confidentiality evidence). Authors and co-authors find them in
    SOP Directory → Directory section → Others. Published-directory access for other employees followed
    the (now empty) department, so nobody gains new access.
  - **Delete SOPs** (`delete`, Edge Function only):
    1. `begin_department_file_deletion` (one transaction): re-checks employees and active workflows, creates
       one job with every `storage_path` of every version (including already soft-deleted versions),
       scrubs SOP prose/comments/findings, marks SOPs and versions deleted, and marks the department
       *pending*. Duplicate or concurrent requests return the same job.
    2. Worker (service role): claims a batch of 100 under a 5-minute lease, calls the Storage API `remove`,
       then asks the database which paths still exist in `storage.objects`. Only absent paths are
       acknowledged; `ack` re-verifies and refuses any present path. Several batches run per request
       (20-second budget).
    3. The department is finalized (`removed_at`) **only** when every file is verified absent.
  - Missing files count as deleted (verifiably absent). Permission/Storage/network errors leave the job
    `failed`, the department pending (no edits, no assignments) and the SOPs unavailable; the UI offers
    **Retry file cleanup**. Lost acknowledgements are recovered when the lease expires.
- **Active work blocks deletion**: SOPs in review/approval, open review rounds and running compliance checks.
  This is kept deliberately: those workflows still reference the SOP and its department's reviewers, so
  moving or deleting mid-review would leave reviewers acting on a record that has changed underneath them.
  Settle the review/check first; nothing is silently cancelled. (Business decision: if you prefer
  auto-withdrawing reviews on deletion, that needs a new rule.)

## Deployment (requires your approval — nothing has been applied)

**Blocked:** hosted version `20261105120000` belongs to `access_requests`, whose original migration source
has not been recovered. Do not run a blanket database push, modify that ledger entry, or install the
catalog-derived test fixture in production. Management has been renumbered to `20261105120200`;
authorization repair is `20261105120100`, and onboarding hardening is `20261105120300`, followed by the existing `13`–`16` migrations. Use the exact
conditional sequence, backup gates, source-reconciliation alternatives and restoration procedure in
[the deployment plan](hosted-supabase-deployment-plan.md). No hosted execution has been approved.

Division email is **optional** (form and database agree: blank is stored as null; a given address must be
valid, at most 254 characters).

## Tests executed (2026-11-05)

| Suite | Result |
| --- | --- |
| Frontend `npm test` (Vitest) | 115 files, 1,211 tests passed, 0 failed, 0 skipped |
| `npm run lint` (oxlint) | 0 warnings, 0 errors |
| `npm run build` (tsc + Vite) | passed |
| Edge Function type-check (`tsc --strict` with Deno/npm shims) | passed |
| `node supabase/tests/divisions_departments.mjs` | all steps passed on a disposable local PostgreSQL 16 cluster: full chain of 24 migrations, CRUD, auth, counts, both dispositions, rollback, concurrency, Storage job, **positions**, **server totals**, **DB-verified Storage absence**, `internal_review_rpc.sql` on the final schema |
| `node supabase/tests/organization_migrations.mjs` | all scenarios passed |
| Browser render (Playwright, 1440px and 390px) | screenshots of table (collapsed/expanded/search), preview, delete dialog, blocked delete, department details and positions dialog; no page errors. Supabase HTTP was answered from an in-memory fixture — **visual check only, not integration** |

Notes:

- The runners expect Docker `postgres:17-alpine`; Docker Hub was unreachable here, so a local disposable
  PostgreSQL 16 cluster stood in for the container. Re-run with Docker to confirm on PostgreSQL 17.
- `other_department_reviewers.sql` was flaky on every schema version: it creates review rounds in one
  transaction, so `latest_round()` tied on `requested_at` and fell back to random uuid order (the frontend
  sort had the same tie). Fixed in `20261105160000` (and `services/sops.ts`): the version breaks the tie.
  The runner now **requires** it to pass 5 of 5 times on the final schema; it is informational only at the
  mid-chain step, before the fix exists.
- `supabase/tests/management_supabase.local.mjs` (real local Auth/PostgREST/Storage/Edge) was updated for
  positions and DB verification but **not run** here (needs `supabase start`).

## Requires your manual verification

See "Manual testing" in the hand-over message; in short: run `management_supabase.local.mjs` against
`supabase start`, then on a staging project: both deletion paths with real files, a forced Storage failure
and retry, non-admin calls to the RPCs and the Edge Function, and the visual comparison with the approved
screenshots.

## Remaining limitations

- Hosted migrations, Edge deployment, real Storage delivery, real invitation emails and real data are untested.
- An email that belonged to a deleted user can't be invited again: the old Auth account still holds it
  (Add User reports "already has a Hawkim account").
- Approver assignments aren't stored in the database yet, so the server can't block removing an Approver
  permission that is in use (the browser check has the same limit today).
- Files already downloaded or served through short-lived signed URLs cannot be revoked.
