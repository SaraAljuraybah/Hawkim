# Divisions & Departments

Admins manage divisions, departments (each in a division), employee positions and department deletion
from **Admin → Divisions & Departments** (`/admin/departments`). Every rule is enforced by the database;
the screens only explain it.

## What it does

| Feature | Where |
| --- | --- |
| Divisions: add, edit (optional email), delete when empty | `AdminDepartmentsPage`, `DivisionDialogs` → `save_division`, `delete_division` |
| Departments: add in a division (`/admin/departments/new?division=<id>`), edit, move to another division | `DepartmentFormPage` → `save_department` |
| Department page: division, members with positions, users with access, SOP counts, deletion | `DepartmentDetailsPage` → `get_divisions_departments`, `set_employee_positions` |
| Delete a department: blocked while it has employees or open reviews/checks; its SOPs either move to **Others** or are deleted with their files | `DeleteDepartmentDialog` → `delete_department` or the `delete-department` Edge Function |
| SOP Directory → **Others** tab: published SOPs of deleted departments, for their main author and co-authors | `SopsPage`, `lib/sopAccess.ts` |
| Division names wherever departments are grouped (reviewer pickers, Add User, review tables) | `services/people.ts` loads `departments.division_id` and the division name |

Concurrency: every edit sends the version it started from (`updated_at`); a stale edit is refused with
"Someone else changed this record". Admin only: `can_manage_organization()` (an active Admin whose Auth
account is not deleted or banned). The admin portal also re-checks it before it opens
(`AdminAuthorizationGate`), so a revoked or banned Admin loses the portal without reloading.

Unchanged from develop: the Organizational Structure page and its read rule (every active employee),
`latest_round()`, Request Hawkim, SOP deletion by its author (`delete-sop`), review routing rules
(divisions only label the pickers; who may be chosen is unchanged).

## Migrations

| Migration | Contents |
| --- | --- |
| `20261107120000_organization_admin_authorization.sql` | `can_manage_organization()` |
| `20261107120100_divisions_departments_management.sql` | Optional division email (not directly readable by employees), `departments.updated_at`, `sops.deleted_at` / `directory_group`, audit table, division/department RPCs, retained-SOP guards, `can_view_sop`/`can_view_version` + `deleted_at` |
| `20261107120200_department_storage_cleanup.sql` | Durable Storage cleanup outbox (NULL, blank and duplicate paths excluded), `delete_department` |
| `20261107120300_employee_positions.sql` | `employee_positions` (synced with `profiles.position`, required for new assignments; existing profiles without a title are grandfathered), `set_employee_positions`, `get_divisions_departments` |

They were reconciled from the `feat/divisions-departments` branch (its six migrations
`20261105120100`–`20261105160001`). Not carried over: that branch's own access-request migrations
(develop's Request Hawkim replaces them) and its `latest_round()` change.

Rollback (newest first, frontend first): `supabase/scripts/rollback_organization_management.sql`. It refuses
once a department deletion has retained or moved SOPs.

## Deployment record — 6 November 2026, project Hawkim (`bicfkrntoliyagihdkfn`)

Before applying:
- Project identity: the same ref in the app's Supabase URL, the earlier CLI link and the CLI project list.
- Migration ledger: exactly develop's 24 migrations, nothing else; none of the new objects existed.
  (The earlier "drift" was develop's own migrations, deployed by the team.)
- Live bodies of `can_view_sop`, `can_view_version`, `latest_round`, `get_organizational_structure`,
  `can_read_organizational_structure`, `delete_sop`, `accept_access_request`, `has_role`, `is_active_user`
  matched develop's source.
- No platform backup was available (`backups list`: none, PITR off), so a logical backup (roles, schema,
  data incl. `auth` and `storage` metadata) was taken with `supabase db dump` and kept **outside Git** on the
  deploying machine (`C:\Users\Dalal\hawkim-backups\20261106-pre-organization-management\`). It was restored
  into a disposable local Supabase stack: all 17 compared tables matched the live row counts.
- On that restored copy: the four migrations applied, every record was kept, existing Admins could manage,
  employees kept the chart, the admin snapshot passed the frontend's validator, and the rollback script
  restored the previous schema with all records.

Applied: `supabase db push` (dry run first: exactly the four files). Afterwards: ledger 28 entries; the 12
functions and 4 tables exist; all 17 record counts unchanged; develop's functions above unchanged; in a
rolled-back transaction an existing Admin could manage (9 departments) and an existing employee could
not, but still saw the chart.

Edge Function `delete-department` deployed (version 1, Verify JWT on, like `delete-sop`). No secrets needed
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are provided). Checked: no token → 401,
public key only → 401 `unauthorized` from the function itself. It was not run on production data.

## Tests

- Frontend: `npm run build`, `npm run lint`, `npx vitest run` (in `frontend/`).
- SQL (disposable local database only): `supabase/tests/*.sql`, including `organization_management.sql`.
- End to end on a local Supabase stack (Auth, Storage, Edge Functions):
  `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/organization_management.local.mjs`
  (refuses any non-localhost URL).

Legacy fixtures for `organization_management.sql` (commit them before applying the migrations to also
check the backfill):

```sql
insert into public.divisions(id, name) values ('legacy-division', 'Legacy Division');
insert into public.departments(id, name, initials, division_id) values ('legacy-home', 'Legacy Home', 'LH', 'legacy-division');
insert into public.departments(id, name, initials) values ('legacy-unassigned', 'Legacy Unassigned', 'LU');
insert into auth.users(id) values ('b7100000-0000-4000-8000-000000000001'), ('b7100000-0000-4000-8000-000000000002');
insert into public.profiles(id, full_name, email, initials, department_id, "position") values
  ('b7100000-0000-4000-8000-000000000001', 'Legacy With Title', 'legacy-1@test.invalid', 'LW', 'legacy-home', 'Pharmacist'),
  ('b7100000-0000-4000-8000-000000000002', 'Legacy No Title', 'legacy-2@test.invalid', 'LN', 'legacy-home', null);
```

## Known limits

- Existing employees have no position (their profiles had none); one is required when their department
  changes. Admins add them on the department page.
- Two SOP deletion models coexist: an author's deletion removes the SOP; a department deletion keeps it as
  hidden evidence. `supabase/scripts/reset_test_sops.sql` can't remove such a retained SOP.
- `guard_retained_sop()` locks the SOP row on each insert/update of its child rows (develop's RPCs already
  lock it first).
