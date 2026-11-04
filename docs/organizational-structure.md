# Organizational Structure

Route: `/admin/organizational-structure`, inside the existing `AdminArea` guard.
The sidebar entry sits after Regulations, before the separate Sign Out action, and uses Lucide Network.

## Implementation

- `frontend/src/pages/admin/OrganizationalStructurePage.tsx`: initial load, refresh, retry, skeletons and session-safe responses.
- `frontend/src/components/admin/OrganizationChart.tsx` and `organizationChart.css`: responsive four/two/one-column hierarchy with organization/division/department connectors, independent native keyboard-accessible department disclosures and vertically scrolling employee lists. Chart employee permissions are plain text, separate from optional job positions.
- `frontend/src/services/organization.ts`: authenticated Supabase RPC client; no mock imports or fallback data.
- `frontend/src/content/organization.en.ts`: page text.
- `frontend/src/components/admin/UserBits.tsx`: existing avatar reused by the chart; permission badges remain available to other Admin pages.
- `App.tsx`, `routes/adminPortal.ts`, `content/admin.en.ts`, `content/types.ts`, and `components/icons.ts`: route, lazy export and sidebar registration.
- `supabase/migrations/20261104130000_reconcile_organizational_structure.sql`: compatible division schema and Admin-only `get_organizational_structure()` RPC. The original untracked draft is preserved at `supabase/proposals/organizational_structure_original.sql`, outside the runnable migrations.
- Tests: `pages/admin/organizationalStructure.test.tsx`, `pages/admin/organizationalStructureLoading.test.tsx`, `routes/organizationAccess.test.tsx`, `services/organization.test.ts`, and `supabase/tests/organizational_structure.sql`.

## Data and authorization

The RPC reads the same persisted `profiles`, `departments`, and `user_roles` tables as Users and Departments. `profiles.department_id` identifies the home department; `user_roles.user_id` supplies every actual permission. `full_name`, `initials` and optional `position` come from the profile. Counts are derived from the returned employee arrays. Deleted profiles and removed departments are excluded; granted directory access does not count as membership.

`divisions.id` links to the new nullable `departments.division_id`. No division records or assignments are seeded. Configure actual divisions and assignments through the existing database administration process. Unassigned departments remain directly under Organization, or under a labeled unassigned branch alongside configured divisions. There is no organization profile table; the root uses the generic Organization label.

The RPC uses invoker security and existing RLS. Its narrowly scoped `can_read_organizational_structure()` helper checks `has_role('admin')`, the active profile, and Auth ban/soft-deletion status. Anonymous execution is revoked. Divisions also have a restrictive Admin SELECT policy. The RPC returns no email, phone or authentication details. One SQL statement returns a consistent snapshot, grouping memberships and permissions without per-department API queries. Employee-directory access to profiles, departments and roles remains unchanged; those underlying directory records are not Admin-confidential.

## Deployment and limits

The owner reports that the feature is now loading real data after manual SQL Editor changes. Those changes and the remote migration ledger have not been independently inspected here. Before applying reconciliation, follow [the reconciliation report](organizational-structure-reconciliation.md), including the version-collision audit. Do not blindly replay the archived draft or mark a migration as applied. The prior people/roles and profile phone/position migrations must already exist. Missing RPCs and API failures show an error and Retry; they never produce fake records.

Refresh and reopening the page retrieve current persisted assignments, department names, user names and permissions. Existing UsersProvider and DepartmentsProvider management operations are **local-only**, as documented in their source. Those unsaved edits cannot be reflected in a database snapshot. Persisting all existing management operations remains a separate backend dependency; this feature does not claim to fix it or present those local records as database records.

Validation: all 1,118 frontend tests, lint and the TypeScript/production build pass. Reconciliation, replay, relationship and authorization tests pass on disposable PostgreSQL 16 using the real people/role schema and a minimal local stand-in for Supabase's auth schema and roles. This verifies query behavior, not the shared Supabase deployment. No shared-project employee records or live deployment were verified. The reference screenshots were not supplied in the attachment, so visual fidelity is based on the written requirements and existing theme; no browser screenshot comparison was performed.

The SQL test is for a disposable local database only, after migrations. Run with `psql -v ON_ERROR_STOP=1 -f supabase/tests/organizational_structure.sql`; fixture inserts are rolled back. It checks anonymous/non-admin/deleted-admin refusal, division mapping, deleted/removed records, multiple permissions, empty counts, privacy, and refreshed assignments/names/positions/permissions.

For repeatable compatibility testing, run `node supabase/tests/organization_migrations.mjs`. It uses an already-installed `postgres:17-alpine` Docker image (PostgreSQL 16 is also supported), starts an owned container with no published ports, and removes it afterward. It accepts no remote database URL. See the reconciliation report for the limits of this local harness and the read-only live verification scripts, and the [migration privilege review](organizational-structure-migration-review.md) for the transactional and owner/grant checks.
