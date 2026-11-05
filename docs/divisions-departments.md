# Divisions & Departments

Implemented on `feat/divisions-departments`, based on the local `develop`. No push or merge.

## Architecture and files

The React/Vite/TypeScript frontend uses the existing Hawkim components, content files,
Tailwind tokens, session provider, role model and Supabase client. Supabase PostgreSQL
is authoritative. No additional database, authentication provider or dependencies.

- `frontend/src/pages/admin/AdminDepartmentsPage.tsx`: single hierarchical table, full-child
  aggregates, search, division preview/edit/delete and nested department creation.
- `frontend/src/components/admin/DivisionDialogs.tsx`: shared division form and centered preview,
  exact clipboard copying with failure feedback.
- `frontend/src/components/admin/DeleteDepartmentDialog.tsx`: shared department deletion flow.
- `frontend/src/pages/admin/DepartmentFormPage.tsx`: persisted department create/edit/move.
- `frontend/src/pages/admin/DepartmentDetailsPage.tsx`: description under title, authoritative
  employees with multiple role badges, existing With Access section, server SOP status counts.
- `frontend/src/services/organizationAdmin.ts`, `frontend/src/hooks/useOrganizationManagement.ts`:
  authenticated RPCs, validated snapshots, safe user-facing errors, polling/focus refresh.
- `frontend/src/lib/organizationAdmin.ts`: division totals independent of filtering/expansion.
- `frontend/src/state/DepartmentsProvider.tsx`: database-backed CRUD and shared directory refresh.
- `frontend/src/state/SopsProvider.tsx`: refresh after organizational operations, removing stale
  database rows while preserving existing sample-workflow support.
- `frontend/src/services/people.ts`, `frontend/src/services/sops.ts`, `frontend/src/data/mock/types.ts`:
  existing division FK, revision tokens and directory-group serialization.
- `frontend/src/lib/sopDirectory.ts`, `frontend/src/lib/sopAccess.ts`,
  `frontend/src/pages/SopsPage.tsx`, `frontend/src/pages/SopDetailPage.tsx`: real Others directory.
- `frontend/src/App.tsx`, `frontend/src/content/admin.en.ts`,
  `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/content/types.ts`: unified navigation,
  active indicator for legacy department subpages, old list redirect.
- `frontend/src/components/ui/IconButton.tsx`: client-side links and existing gold edit treatment.
- `frontend/src/content/organizationAdmin.en.ts`: module text and safe error messages.

The Organizational Structure page, chart, service and existing RPC are unchanged. Its navigation
regression test changes only the expected label of the adjacent administration entry.

## Database/API

Migration: `supabase/migrations/20261105120000_divisions_departments_management.sql`.

Uses existing `divisions`, `departments.division_id`, `profiles.department_id`, `user_roles`,
`sops.department_id`, `sop_versions`, review rounds/requests, compliance and file-access functions.
The current model gives each employee one home department and multiple roles. Roles are
aggregated separately; employee totals count profiles once. SOP totals count SOP records,
never versions. Parent totals sum all department counts in one snapshot, including collapsed
and filtered-out children. No N+1 HTTP requests.

Authenticated RPCs:

| Function | Behavior |
| --- | --- |
| `get_divisions_departments()` | One admin-only snapshot of active divisions/departments, employee identities/roles, SOP totals and status counts |
| `save_division(id,name,description,email,expected_updated_at)` | Create or edit; required email; normalized fields; duplicate-name and revision checks |
| `delete_division(id,expected_updated_at)` | Remove only when there are no active departments |
| `save_department(id,name,initials,description,division_id,expected_updated_at)` | Create, edit or move using the existing FK and validation rules |
| `delete_department(id,sop_action,expected_updated_at)` | Atomic dependency handling and removal; action is `empty`, `delete`, or `others` |

All operations independently require `can_read_organizational_structure()`, including active Admin
role, active profile and non-banned/non-deleted Auth identity. Mutations use security-definer
functions with empty search paths and no public/anonymous execution. Browser table writes remain
ungranted. Audit records are private. The existing repository has no tenant key; no new tenant model
is introduced. Existing SOP visibility predicates remain intact with an added deleted-SOP guard.

Organization mutations serialize with an advisory transaction lock. Revision tokens reject stale
edits/deletions. Department removal locks its row and all linked SOPs; assignment triggers acquire
conflicting department locks and reject assignment to a removed department. Retained-SOP triggers
prevent older mutation RPCs from changing deleted records. Failure rolls back the entire operation.

## Deletion and Others

- A division containing departments cannot be deleted.
- A department containing active employees cannot be deleted.
- Departments without SOPs use normal confirmation.
- Departments with SOPs require an explicit disposition. The default preserves SOPs in Others.
  Deleting associated SOPs requires an additional checked confirmation.
- Open reviews, in-review/in-approval SOPs and running compliance checks block department removal.
  Settle these operations first; nothing is silently cancelled.
- `delete` marks SOPs and versions deleted. Existing file retention is preserved: no storage
  objects, versions, workflow evidence, comments or users are physically cascaded or purged.
- `others` sets `sops.directory_group = 'others'`. SOPs/files/history/authorship are retained.
  The department is a removed historical tombstone and its division assignment is cleared.
  The original SOP department FK remains solely as historical ownership/security evidence,
  rather than inventing an Others department or discarding authorization provenance.
- Directory > Others searches records already authorized by existing access rules. Authors and
  co-authors can find their moved drafts there too; other employees still require published
  directory access. An Others label itself grants no new permission. Reviewer-only assignments
  continue through the existing version-restricted review views.

This deliberately follows the repository's soft-removal and retained-file model. Physical SOP
purging is not implemented. Files already downloaded or served through existing short-lived signed
URLs cannot be revoked retroactively.

## Refresh, loading and failures

Management snapshots refresh after mutations, on window focus and every 30 seconds while open.
Counts come from the database, so changes in employee/SOP assignments are reflected on the next
refresh. Shared department and SOP stores refresh after a committed management operation.
Errors do not replace records with demo data. Failed writes stay in their dialog/form. Stale
records produce a refresh/retry message; cancel performs no mutation. Native dialogs provide
modal focus containment, Escape dismissal and the existing overlay styling.

## Safe rollout and legacy email cleanup

1. Back up the target database and inspect its migration ledger. Apply all prior migrations,
   especially `20261104130000_reconcile_organizational_structure.sql`.
2. Review and apply `20261105120000_divisions_departments_management.sql` using the normal Supabase
   migration process, then deploy this frontend. Do not deploy the new frontend against the old
   schema: the selected columns and RPCs depend on this migration.
3. Existing division emails remain unchanged; missing values stay null. No fake addresses or
   division/department mappings are seeded. Creation/editing requires a valid email.
4. Obtain missing emails from the organization owner and edit those divisions through the form.
   Do not derive addresses from names. Audit with:

   ```sql
   select id, name, email from public.divisions
   where is_active is not false and (email is null or btrim(email) = '');
   ```

5. Existing unassigned departments remain visible under Unassigned departments. Edit to choose
   an authoritative division; no assignment is guessed. New departments require an active division.

## Verification

Run from `frontend/`: `npm test`, `npm run lint`, `npm run build` (includes TypeScript checks).
Run from repository root: `node supabase/tests/divisions_departments.mjs`.

The integration runner creates its own disposable PostgreSQL 17 Docker container, publishes no
ports, accepts no external connection URL, applies the full migration chain, and stops/removes
only that container. Auth and Storage schemas are minimal local fixtures; this exercises real
PostgreSQL RPCs, triggers, role checks and RLS, not hosted Supabase HTTP or Storage delivery.

Coverage includes hierarchy totals/search/zero values, collapsed and expanded rows, action
callbacks, navigation, required email, shared editing, clipboard success/failure, cancellation,
destructive confirmation, explicit dispositions, Others visibility/confidentiality, RPC contracts,
legacy upgrade preservation, persistence, multiple-role counting, SOP version counting, stale
writes, active workflow blocking, retained-file access, forced-failure rollback and concurrent
employee assignment versus deletion. Existing frontend regression suites are retained.

Limitations: no approved screenshots were present in the supplied attachment; no browser-level
visual, clipboard, focus or viewport test has been performed. Native dialog behavior is reused.
Hosted Supabase migrations, authentication sessions, PostgREST/Storage delivery, cross-device
refresh and real production data have not been tested or changed. Existing browser-only access
requests and approval handoff remain as implemented by the repository; this module does not make
those unrelated workflows persistent. In particular the database can enforce only persisted
workflow states, not a browser-only approval handoff.

## Results on 2026-11-05

- Frontend: **109 test files, 1,171 tests passed**; production build/TypeScript and lint passed.
- Management integration runner: all 21 migrations applied; management CRUD, authorization,
  aggregation, both dispositions, retention, forced-failure rollback and concurrent assignment
  tests passed on disposable PostgreSQL 17.
- Existing `organization_migrations.mjs`: all fresh/manual/legacy reconciliation, preservation,
  rollback, authorization, unsafe-schema and snapshot checks passed.
- Existing `internal_review_rpc.sql`: passed against the complete schema including the new migration.
- Existing `other_department_reviewers.sql`: fails with `Reviewers can only be added to the review
  of the current version`. The runner executes it both before and after the management migration
  and verifies that the failure is already present and unchanged. This pre-existing SQL check
  is reported explicitly, rather than claimed as passing or removed.
- Hosted deployment and browser visual/interaction verification remain unperformed. Apply the
  migration before using the new frontend against a hosted project.
- Git changes are uncommitted on `feat/divisions-departments`; no push or merge. The pre-existing
  `frontend/package-lock.json` change was preserved.
