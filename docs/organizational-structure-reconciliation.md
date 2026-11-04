# Organizational Structure reconciliation report

## Outcome and scope

Repository reconciliation and local verification are complete. No production SQL, migration repair, push, merge or employee-data changes were performed. The frontend design and unrelated workflows were not changed.

The owner reports a working live RPC and a snapshot of four divisions, nine departments and nine active profiles. That is supplied context, not an independently verified production data result. Anonymous read-only API requests to the frontend-configured project were tested and refused. Direct SQL access, authenticated Admin/non-admin sessions and the remote migration ledger were unavailable.

## Files inspected

- `supabase/migrations/20261025120000_people_and_roles.sql`: profile/department/role tables, FKs, triggers, `has_role`, `is_active_user`, grants and RLS.
- `supabase/migrations/20261103130000_profile_phone_and_position.sql`: nullable profile position and phone.
- Original `20261104120000_organizational_structure.sql`, its SQL tests, and tracked `20261104120000_update_sop_description.sql`.
- Related migration references to authorization, `supabase/config.toml`, `supabase/INTEGRATION_REVIEW.md`, SQL test conventions, and Git tracking/history.
- `frontend/src/services/organization.ts`, `people.ts`, `supabase.ts`, organization service tests, chart/page components, loading/refetch tests, route guards/access tests, UserBits, permission constants and existing report.

## Files changed in this follow-up

| File | Change |
| --- | --- |
| `supabase/proposals/organizational_structure_original.sql` | Byte-preserved original untracked draft, relocated outside migration discovery |
| `supabase/migrations/20261104130000_reconcile_organizational_structure.sql` | New unique-version reconciliation migration |
| `supabase/tests/organizational_structure.sql` | Expanded authorization, privacy, FK, hierarchy, empty-state and refetch tests |
| `supabase/tests/organization_migrations.mjs` | Disposable local compatibility and preservation runner |
| `supabase/tests/organization_anonymous_readonly.mjs` | Optional public-key-only, read-only API denial check; no response bodies or keys logged |
| `supabase/scripts/audit_organizational_structure.sql` | Read-only ledger, schema, function, policy, grants and count audit |
| `supabase/scripts/verify_organizational_snapshot.sql` | Read-only check of supplied counts/assignments and full persisted employee payload |
| `frontend/src/services/organization.ts` | Nullable position type and nested response/permission/duplicate validation |
| `frontend/src/services/organization.test.ts` | Contract regression tests |
| `docs/organizational-structure.md` and this report | Updated integration state, limitations and rollout instructions |

Other dirty/untracked feature files predate this follow-up and were retained.

## Conflicts and resolutions

| Conflict | Resolution |
| --- | --- |
| Two local migrations had version `20261104120000` | Git shows the organization draft was untracked, while the SOP-description migration is tracked. The draft is archived unchanged; tracked history is untouched. The runnable reconciliation uses `20261104130000`. Remote history remains unknown and must be audited. |
| Live divisions have metadata absent from the draft | Fresh environments create the described columns. Existing environments add only missing metadata columns; compatible existing values, nullability, defaults and metadata remain unchanged. Type/PK mismatches stop reconciliation. No table recreation or record upserts. |
| Draft division ID CHECK rejects underscore IDs | Fresh schema accepts TEXT IDs without the draft's hyphen-only rule. Only that exact legacy CHECK is relaxed for underscores, retaining its constraint name. Existing IDs are not renamed. |
| Division table/column/RPC already exist manually | Existence-aware DDL and same-signature `CREATE OR REPLACE FUNCTION` avoid duplicates. Incompatible RPC signatures or overloads stop for review. Existing same-signature RPC OID/dependencies are preserved. |
| Live FK is `ON DELETE RESTRICT`, draft FK was `SET NULL` | An existing compatible `RESTRICT` FK is left intact, including its name/OID. Only the recognized legacy `SET NULL` definition is tightened to `RESTRICT`, preserving its name, key columns, target, update action and deferrability. Unexpected actions, targets, composite keys, unvalidated or duplicate FKs stop for review. This legacy conversion rebuilds the constraint and may require a brief lock. |
| Index may already exist under another name | Reuse an existing valid nonpartial leading-column division index. No additional index is made in that case. A conflicting index name fails rather than silently skipping creation. |
| Existing policies/grants can differ | Replace only feature-owned policies, retain unrelated ones, and add a restrictive SELECT guard. Revoke PUBLIC/anon/authenticated table and column privileges on divisions, then grant authenticated SELECT. No writes granted. |

The migration performs no INSERT/UPDATE/DELETE against divisions, departments, profiles, roles, SOPs or workflows, and never changes the migration ledger. Profile `deleted_at` and department `removed_at` remain unchanged. Inactive divisions (`is_active = false`) are hidden; legacy null flags remain visible. Departments retain their actual division IDs even if their division is inactive; their UI fallback uses the existing unassigned branch. No organization profile is invented.

## Authorization findings

The original `has_role('admin')` checks the caller's profile has no `deleted_at` and has an Admin role. It does not inspect Auth ban or soft-deletion status. A token can outlive account changes, so this feature now adds `can_read_organizational_structure()` to check `auth.users.deleted_at` and `banned_until` for `auth.uid()` as well. These fields are part of the [Supabase Auth user model](https://github.com/supabase/auth/blob/master/internal/models/user.go); the audit must confirm they exist in the target Auth schema.

The helper is deliberately SECURITY DEFINER because authenticated callers cannot read Auth rows. It accepts no arguments, returns only a boolean about the caller, has an empty search path, fully qualified references, no dynamic SQL and no writes. Its owner is explicitly pinned to the trusted `postgres` role; non-owner EXECUTE is granted only to `authenticated`, without grant option. API-role membership in the owner role is rejected. It does not replace `has_role` or alter authorization for unrelated SOP operations. See the [privilege and transaction follow-up](organizational-structure-migration-review.md).

The hierarchy RPC remains SECURITY INVOKER. It checks that helper before reading tables, so it retains existing RLS rather than bypassing it. Missing identities, nonexistent identities, missing/revoked Admin roles, deleted profiles, Auth-deleted and banned Admins are refused. Malformed UUID claims also fail. Anonymous RPC execution and direct divisions reads are denied. A restrictive divisions SELECT policy prevents a pre-existing permissive directory policy from exposing divisions to non-admin or deactivated callers. Unknown restrictive policies may still hide data and must be reviewed, not removed blindly. Database owners/service roles are privileged maintenance identities, outside end-user RLS guarantees.

Existing `profiles`, `departments` and `user_roles` policies intentionally allow active employees to read the directory, including department membership and permissions. They are unchanged because employee screens and SOP pickers depend on them. Thus the RPC and divisions are Admin-only, but the underlying employee/department directory is **not confidential to Admins**. If the requirement changes to hide all directory membership from non-admins, that needs a separate access redesign; hiding this page alone cannot provide that guarantee. The read-only audit identifies any live grants/policies that differ from the repository.

The RPC selects only employee ID, full name, initials, nullable position and all actual permissions. It groups by persisted `profiles.department_id`, excludes deleted profiles/removed departments, and emits empty arrays for empty memberships. No email, phone, password or Auth details enter the response. Member counts derive from those employee arrays. The frontend now rejects malformed nested records, unknown/duplicate permissions and duplicate employee memberships before rendering.

## Tests executed

- `node supabase/tests/organization_migrations.mjs`: passed fresh schema, manually initialized schema, legacy draft, incompatible-FK refusal, unexpected-overload refusal, and the operator snapshot script on isolated 4/9/9 fixtures. Fresh/manual/legacy reconciliation is replayed twice. Manual records/metadata, profile/role rows, division table OID, live RESTRICT FK OID and same-signature RPC OID are checked for preservation. No duplicate division PK/FK/index/managed-policy/RPC results.
- SQL regression tests pass in each supported scenario: real PostgreSQL RLS/grants, anonymous and invalid/missing callers, non-admin refusal, active Admin success, Auth bans/deletion, profile deletion, role revocation, direct divisions restrictions, permissive-policy resistance, empty/inactive divisions, empty/removed departments, deleted profiles, roleless/multiple-role employees, exact employee keys/privacy and changed assignments/names/positions/permissions on refetch.
- `npm test`: **101 files, 1,118 tests passed**, including existing Admin and workflow tests.
- `npm run lint`: passed.
- `npm run build`: TypeScript project checks and production build passed.
- `git diff --check`: passed.
- `node --env-file=frontend/.env.local supabase/tests/organization_anonymous_readonly.mjs`: five read-only requests to the configured `bicfkrntoliyagihdkfn.supabase.co` project passed. Anonymous RPC and direct divisions/profiles/departments/user_roles reads each returned HTTP 401 with PostgreSQL `42501`. No successful employee data retrieval, sign-in or migration request was made. This establishes anonymous denial for that environment at test time, not the policy/function definition or authenticated-role behavior.

The database runner now defaults to PostgreSQL 17, matching the repository configuration, and also passes on PostgreSQL 16. It uses actual repository people/role/profile migrations and a minimal Auth schema/role stand-in. It does not replay the complete SOP/storage migration chain or validate HTTP/JWT issuance. Full target-environment staging checks remain part of deployment. All fixture records are confined to the owned disposable database; they are not application data or evidence of live employee verification. The latest review also checks complete-migration rollback, column ACL removal, pre-existing unsafe helper ownership, surplus execution grants and unsafe owner-role membership.

## Required manual Supabase actions

1. Run `supabase/scripts/audit_organizational_structure.sql` read-only as the database owner and retain the results. Review ledger version/name/statements (not just a matching numeric version), column types, PK/FK actions, indexes, policies, grants and function definitions/owners. Check that the tracked `update_sop_description(uuid,text)` implementation matches the deployed function, because it owns version `20261104120000` locally.
2. Resolve history based on evidence. If that ledger row correctly represents the tracked SOP-description migration, leave it alone and apply only the pending reconciliation through the normal process. If it represents the organization draft, has an ambiguous name, or is absent despite manually installed functions, stop deployment: an owner must compare actual definitions to both sources and decide a documented migration-history repair/baseline. Do not mark anything applied merely because similarly named objects exist. No repair command was run or embedded in these scripts.
3. Test the pending migration on a sanitized target-version staging copy using the normal migration runner. Review the known legacy FK tightening and any DDL lock window. Unexpected schema/function definitions fail for review rather than being rewritten. Back up the target before an owner-approved production rollout. Do not run the archived draft as a production migration.
4. After owner-approved deployment, run the read-only snapshot verifier in a trusted active-Admin database context. SQL Editor can deliberately impersonate a verified Admin using the commented instructions, but that proves DB rules only. It checks the supplied four divisions, nine departments, nine profiles and all nine listed assignments. It compares names, initials, nullable positions, permissions and complete memberships to persisted records without hardcoding employee names. A changed snapshot fails explicitly rather than rewriting data.
5. Separately test requests with real ordinary employee, active Admin and deactivated Admin sessions: RPC calls, direct divisions queries, and the Admin page. Repeat anonymous checks after rollout. SQL Editor owner execution is not proof of JWT authorization. Only pre-rollout anonymous denial was checked against the configured project; authenticated-session behavior remains unverified there.

The supplied snapshot counts, live employee values, target version, function owners and complete live RLS/grants remain unverified until these actions are completed. Existing local-only Users/Departments management mutations remain a separate persistence limitation.

## Merge readiness

The repository changes pass local validation and are ready for code review. A merge that automatically deploys migrations must remain blocked until the remote ledger/version-collision audit and target staging checks above pass. This report does not give unconditional production/deployment approval or claim that `develop` has been changed.
