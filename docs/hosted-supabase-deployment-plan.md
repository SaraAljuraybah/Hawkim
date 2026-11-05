# Hosted Supabase preparation and remediation

Prepared on 5 November 2026 on `feat/divisions-departments`, based on commit `40bc455` plus the local
changes listed below. **No hosted deployment is approved. No hosted schema, policies, migration ledger,
application records, Storage objects, backups or Edge Functions were changed by this work.**

## Approved final authorization policy

Only active Admin users may view Divisions & Departments or Organizational Structure, retrieve their
management hierarchy, or create/update/delete divisions and departments. This explicit final product
decision supersedes the observed hosted active-user visibility change.

- `can_read_organizational_structure()` independently requires `has_role('admin')`, an active profile,
  and an existing Auth user with no deletion or current ban.
- `can_manage_organization()` separately enforces the same predicate. Every division, department,
  position and user-management mutation uses this helper. Widening visibility cannot grant writes.
- Both Edge Functions verify the bearer token with Auth, then call the mutation helper as the caller,
  before using server credentials. Cleanup claim/ack/presence RPCs remain service-role-only.
- A forward migration restores the Admin-only division SELECT policies, removes the two observed
  active-user policies, revokes browser write/column grants and restores the minimal hierarchy payload
  without email/phone. Unknown permissive SELECT policies cannot defeat the restrictive Admin guard.
- The frontend checks current backend authorization before mounting the Admin layout, fails closed,
  ignores stale identity responses, and checks again on window focus. Every backend operation still
  authorizes independently; this presentation gate is not the security boundary.
- Existing employee department/profile/role directory access and SOP/review authorization remain
  unchanged. Employees still obtain department IDs/names for their ordinary workflows, without a new
  grant to divisions or full hierarchy APIs. No workflow was found that needs a new hierarchy exception.

**Approved onboarding decision:** request acceptance and rejection require an active Admin approver;
there is no service-role-only exception. The new forward migration adds that database check, permits
only authenticated callers, and rejects existing-profile repurposing or a mismatched/deleted/banned
Auth identity. Submission/read/lock helpers retain their service-only scope. The captured snapshot stays
unchanged as evidence of the previous behavior. Production remains blocked until the missing external
handler/source is recovered or reconciled, changed to verify/forward the Admin user's JWT, and tested.
The existing service-key-only decision path is deliberately denied by the local remediation.

## Migration collision and source recovery

The first 20 local migration versions/names are recorded in the hosted ledger, through
`20261104130000_reconcile_organizational_structure`. The ledger entry at `20261104120000` correctly
names `update_sop_description`. Ledger presence does not establish unchanged live definitions: the
organization helper/RPC/policies were observed changing during the preceding read-only assessment.

Hosted `20261105120000` is **`access_requests`**, with no stored statements. Its source is absent from
this checkout. The original management file used that same version despite its objects being absent
from hosted Supabase.

Source recovery performed without modifying either clone:

- Listed all eight current remote branches and tags; no remote tags were listed. Available local remote
  refs cover those branch tips. Searched connected GitHub branch/commit metadata and the default-branch
  code index; no matching migration was found.
- Searched all branch/reflog histories and changed file contents in `C:/Users/Dalal/Hawkim-1` (392
  reachable/reflog commits) and `C:/Users/Dalal/Hawkim` (382). Neither contained an `access_requests`
  source path or content change.
- Both repositories report one worktree each. Searched available unreachable objects: the second clone
  had 22 unreachable blobs and three commits; none contained `access_requests`. The current clone had
  no unreachable blobs/commits. The named Hawkim architecture download contained only a slide image.
- Read the hosted table columns, enum, constraints, index, function definitions, grants, triggers and
  policies with enforced read-only SQL. No application data, tokens or file contents were exported.

**Original source not recovered.** No original migration has been fabricated, and no local production
migration was added at the hosted version. This remains a release blocker.

The checked-in `supabase/tests/fixtures/hosted-access-requests.snapshot.json` is an **observed catalog
snapshot**, not the original migration. Its provenance states that distinction. It contains a 14-column
table, a three-value enum, one secondary index, five function definitions and service-role grants. The
table has RLS enabled, no custom triggers and no policies; neither anonymous nor authenticated browser
roles have table/function access. The test materializer refuses unexpected policies, triggers or ACLs.

The observed implementation supports submit/read/accept/reject, a three-submission-per-email/day check,
a 14-day review window and token-hash matching. Acceptance inserts a profile, supplied job title and an
exclusive Admin role. It does not call the organizational visibility helper. This checkout contains no
caller of these onboarding RPCs; the employee department-access request UI is a separate workflow.
The external review-link handler, email flow and its authorization cannot be verified from this checkout.

### Safe source-reconciliation alternatives — owner decision required

1. **Preferred: recover the original artifact** from its author, another machine, SQL Editor history or
   an archive. Review provenance and compare it to the observed catalog before adding it at the existing
   `20261105120000_access_requests.sql` version. Do not replay it on the already-initialized project.
2. **If permanently unavailable: approve an explicit catalog-baseline adoption.** Review a reconstructed
   current-state schema and all external callers, label it as a dated reconstruction with the original
   source unavailable, and establish a reproducible fresh-install baseline. A reviewed local baseline
   may adopt the existing version/name only with a documented owner decision; it must never be described
   as recovered original SQL. Preserve the existing hosted row and objects. Validate against fresh and
   already-initialized environments before selecting a deployment runner.
3. **Defer rollout** while keeping the completed local security remediation ready for review.

Do not resolve this by deleting/renaming the hosted row, marking the management migration applied,
using an unexplained no-op placeholder, or copying the test fixture into runnable production migrations.
The current checkout is not ready for an unattended `db push`; source/baseline reconciliation is required.

## Collision-free local sequence

The unapplied management migration was renamed. Historical hosted versions were not edited.

| Order | File | Purpose |
| --- | --- | --- |
| Existing | `20261105120000_access_requests` | Hosted onboarding; original source missing; leave hosted ledger untouched |
| 1 | `20261105120100_organization_admin_authorization.sql` | Forward repair of visibility drift; independent mutation authorization |
| 2 | `20261105120200_divisions_departments_management.sql` | Renamed management migration: audit, CRUD, SOP directory fields and guards |
| 3 | `20261105120300_access_request_admin_decisions.sql` | Require active Admin onboarding decisions and prevent existing-employee repurposing |
| 4 | `20261105130000_department_storage_cleanup.sql` | Durable deletion jobs and Storage worker orchestration |
| 5 | `20261105140000_employee_positions.sql` | Positions, backfill/deferred constraints and management totals |
| 6 | `20261105150000_department_storage_verification.sql` | Database verifies Storage absence before acknowledgement |
| 7 | `20261105160000_user_management_and_consistency.sql` | Position sync, user management and deterministic latest review round |

Mutation-helper references were updated in the unapplied migrations and both Edge Functions. The first
20 migrations were left unchanged. Do not replay the old reconciliation migration to repair live drift.
The seven new/pending files contain their own transactions: a later failure does not undo earlier commits.
Keep organization/user/SOP writes paused through the complete sequence so no intermediate behavior is
exposed. The explicit file order is prepared; a runnable production command set remains gated on the
source/baseline decision and the current hosted ledger/configuration at rollout time.

## Local verification

All destructive checks used owned disposable local environments. The full Supabase project was
`hawkim-remediation-20261105`, with API 57431, database 57432, email sink 57434 and Edge inspector 8283.
Database/Storage volumes were separate from all existing projects. Destructive runners reject arbitrary
URLs and verify fixed loopback targets, container port bindings and dedicated mounts before fixtures.
After final verification, only this disposable project's containers/volumes were removed and its private
status/credentials file was deleted. The original Docker container/volume inventory remained intact;
the existing management Edge container remained stopped. Generated source/config copies remain ignored.

| Check | Final result |
| --- | --- |
| Complete frontend suite | **1,234 tests, 117 files passed** |
| Frontend lint | Passed |
| TypeScript/production build | Passed |
| Full migration/RPC chain | Passed all 27 repository migrations plus the observed access-request fixture; PostgreSQL 17 |
| Reconciliation compatibility suite | Passed fresh/manual/legacy, replay, preservation, privilege/owner checks and atomic rejection scenarios |
| Real local security suite | **114 matrix denials passed**, plus positive Admin, worker isolation, UI/backend drift separation and escalation checks |
| Real local invitation | Auth invitation/profile/two positions/roles persisted; duplicate email, mixed Admin roles and invalid redirect refused |
| Real local deletion suite | All 16 behavior groups passed, including real Storage removal, failure/retry, 101-file batches, concurrent operations and rollback |
| Observed access-request compatibility | Passed service-only submission/read scope, active-Admin decisions, legacy service-only decision denial, token matching, existing-employee repurposing prevention, acceptance/profile/title sync, rejection, expiry, repeat-decision rejection and pending-department rollback |
| Existing review regressions | Passed; other-department reviewer test passed five final-schema executions |
| Missing-position compatibility | Nine local legacy profiles survived unchanged without invented titles |

The SQL runner injects observed active-user drift before the forward authorization repair and forces a
failure at its last statement, verifying function/policy/ACL rollback. The security suite deliberately
widens only the visibility helper locally and verifies that all eleven administrative mutation RPCs and
both Edge Functions still refuse an employee. That local drift is restored immediately afterward.

Development failures were corrected: dollar-quoting in the new injected-error test, cleanup order in
the new frontend hook-test fixture, and an existing reconciliation-runner readiness race that saw the
image's temporary Unix-socket initialization server. TCP readiness now waits for the final server.
Sandbox Vite `spawn EPERM` failures passed when rerun with approved process permissions.

The catalog fixture is not proof that original migration history was recovered. The isolated environment
represents the relevant observed schema and legacy shapes, not a complete production-data clone. No
external onboarding handler, real production email delivery, production load/latency, hosted JWT smoke
test or restoration exercise was performed. No destructive tests targeted hosted Supabase.

The final real Supabase database was rebuilt from scratch after the onboarding decision: all 27
repository migrations plus the explicitly labeled observed catalog fixture applied successfully in order.
The 114-denial security suite and full deletion suite were then rerun against that fresh environment.
The onboarding migration explicitly refuses to run if the missing onboarding baseline is absent.

### Reproduce locally

1. Run `node supabase/tests/prepare_remediation.local.mjs` only when the ignored test project does not
   already exist. It refuses to overwrite its config and writes only under `.local-tests/`.
2. Start that workdir with the installed CLI, excluding Studio, metadata, analytics, vector, pooler,
   realtime and image proxy. Save `status --output json` privately to its `status.local.json`; do not print
   or commit credentials. The generated `120000` file is test-only catalog materialization plus drift.
3. Set `HAWKIM_LOCAL_TEST_ENV=remediation`; run `organization_security.local.mjs` and
   `deletion_supabase.local.mjs` under `supabase/tests/`. The security test sends invitations only to
   the local email sink. Run `divisions_departments.mjs` and `organization_migrations.mjs` separately;
   each creates/removes its own network-isolated PostgreSQL container.
4. From `frontend/`, run `npm test`, `npm run lint`, `npm run build`.
5. Stop only `hawkim-remediation-20261105` with its explicit project ID and `--no-backup`; remove its
   newly created private status file. Do not use a global stop, prune, hosted reset or an existing stack.

## Existing data readiness

The read-only hosted assessment found four divisions, nine active departments/profiles, one usable
active Admin, 14 SOPs, 22 versions, 13 SOPs in review/approval, eight open rounds and zero running checks.
All nine profiles have no primary position: IT 1, Pharmacovigilance 5, Quality Assurance 2, R&D 1.

- Obtain actual approved titles from the organization. None can be inferred from roles, department or
  sample data. No employee names/contact details or invented titles were written to deployment files.
- Existing null-position profiles remain valid through migration; the backfill intentionally creates
  nothing for them. Resolve their positions with `set_employee_positions` after the protected backend is
  deployed, before department reassignment or position deletion. Re-run the missing-position audit.
- Self-deletion/self-removal of Admin was verified against an Admin who was the sole usable one in the
  local fixture. Protect the existing production Admin; do not change its role, delete it or ban it as a
  smoke test. Service-role maintenance access remains privileged and must be controlled operationally.
- Existing audits found no duplicate active emails, shared version paths, missing referenced objects,
  invalid management field lengths, unsafe paths or active department/division relationship gaps.
  Recheck after the change freeze; prior counts are a dated baseline, not permanent invariants.

### Five unreferenced Storage objects — preserve

Read-only metadata audit on 5 November: all five are PDFs in private `sop-files`, each 186,928 bytes.
These are objects without a current `sop_versions.storage_path` reference, not confirmed disposable
orphans. No contents were opened and no objects were deleted. Paths are omitted; object IDs locate the
records for an authorized follow-up. Include all five in the Storage backup.

| Object ID | Created at (UTC) |
| --- | --- |
| `6a936fea-a37d-4d50-acb1-b9cb7a72dbed` | 2026-10-25 23:37:56 |
| `91318da2-8714-4114-bf3e-719a0cd9c03c` | 2026-10-26 00:02:36 |
| `b8cdc629-b7e6-418f-a21a-e047d6e7e817` | 2026-10-26 01:08:19 |
| `ba7594b5-183b-4b0e-99ce-3430e115db5d` | 2026-10-25 23:39:48 |
| `cc971406-2de0-4933-b05e-1293b01de577` | 2026-10-26 01:13:05 |

## Backup checklist — approval required before creation

The preceding read-only backup API returned no listed backup and `pitr_enabled=false`. A usable recovery
point has not been established. Do not treat internal WAL flags as verified restore capability.

- Agree the recovery point, acceptable data loss and downtime; name the operator and recovery owner.
- After approval, capture an encrypted database backup covering application and required Auth schemas,
  policies, functions, triggers, grants, positions, audit/outbox tables and the migration ledger. Check
  the export tool's schema exclusions explicitly; a default application dump is not a complete Auth backup.
- Separately back up all Storage bytes, including unreferenced objects, with bucket configuration and a
  protected path/size/content-checksum manifest. SQL backups cover Storage metadata, not object bytes.
- Retain deployment artifacts and configuration/Edge versions; store secret backups only in an approved
  secret store. Never put Auth records, credentials, raw backups or signed URLs in Git or reports.
- Verify backup completion, encryption/access controls, counts/checksums and a restore rehearsal. Record
  a consistent database/Storage cutoff while writes are paused. No backup was created by this work.

Reference: [Supabase database backup and Storage coverage](https://supabase.com/docs/guides/platform/backups).

## Staging deployment and restoration rehearsal

Use a new isolated staging project only after separate authorization. Resolve the missing-source decision and
onboarding caller update first. Use sanitized target-shaped data and separate email/Storage credentials;
ensure staging cannot send production emails or contact production workers.

1. Materialize the approved baseline and compare schema/ledger/ACLs to the frozen target snapshot.
   Include access requests and all external writers, not only the new management APIs.
2. Capture staging database and Storage backups, with enough fixtures to verify restored histories,
   positions, roles and every version file. Verify the sole Admin cannot be removed through the product.
3. Apply the seven files in order. Check ledger entries, expected objects and authorization after each.
   Deploy only matching management Edge Functions; keep other deployed functions/configuration intact.
4. Run the complete role matrix, invitation flow, external onboarding handler, assignment changes, SOP
   author/reviewer workflows, both department deletion choices, partial cleanup/retry and concurrent cases.
5. Restore the staged database/Storage into another owned disposable target or through the agreed
   restoration mechanism. Verify file bytes/checksums, relations, profiles/Auth consistency, roles,
   access-request statuses and audit/outbox states. Do not test restoration on production.
6. Record actual recovery time and discrepancies; repeat only failed/affected checks after fixes.

## Exact conditional production sequence — NOT authorized to execute

1. Obtain the source/baseline decision, onboarding caller update, successful staging/recovery
   evidence and explicit approval of the final artifact hashes and execution commands.
2. Confirm the exact configured project and branch/commit. Freeze concurrent schema/configuration edits
   and relevant application writes, including external onboarding and service-role writers. Re-read the
   ledger and relevant definitions; stop on any unexplained drift or newly applied version.
3. Complete and validate the approved coordinated database/Storage backup. Capture the protected Admin
   and baseline counts/relationships. Preserve the existing `access_requests` ledger row and objects.
4. Apply **only** the seven files listed above in order using the reviewed migration process, recording
   normal new migration applications. Never replay the first 20 files, the old colliding management
   version, seeds, reset scripts, catalog fixtures or unapproved migration repairs. Verify after each
   commit; stop on errors. No blanket push is approved while the hosted-only source remains unresolved.
5. Verify both authorization helpers, minimal hierarchy output, Admin-only division RLS, every mutation
   guard and service-only worker grants. Verify nine legacy profiles were preserved without invented titles.
6. Deploy the matching `delete-department` and `manage-users` artifacts only, preserving `send-email`.
   Verify their configured `verify_jwt=false` plus internal Auth/Admin checks. Confirm required server
   environment variables without exposing values; do not combine this rollout with key rotation.
7. Preserve hosted Auth settings: canonical site `https://www.tryhawkim.com`, existing redirect allowlist,
   disabled public signup, enabled confirmation/email hook and MFA. The local config has development
   values; do not push it wholesale. Make only separately approved configuration changes if required.
8. Release the matching frontend only after backend readiness: it selects `sops.directory_group` and its
   Admin gate calls the new helper. Use agreed non-destructive hosted smoke tests for Admin/employee/
   anonymous/inactive/banned cases. Any new account, invitation or destructive fixture needs approval.
9. Assign approved job titles through protected RPCs as separately authorized. Re-open writes, monitor
   function errors and incomplete cleanup/ban jobs, and retain the backup and audit evidence.

## Rollback and incident handling

- A failed individual migration transaction must leave its own changes absent. Earlier successful files
  remain committed: inspect state, stop the rollout and choose a reviewed forward correction.
- Disable affected management entry points/worker invocations and revert compatible frontend/Edge
  artifacts. Retain additive tables/columns and audit/outbox evidence. Do not drop objects with CASCADE
  or erase migration history. An old frontend may still need compatibility checks against the new schema.
- Do not roll back to the active-user visibility bug. Correct authorization stays in place during recovery.
- Purge preparation scrubs prose transactionally; actual file removal is external and irreversible through
  SQL rollback. Once any purge runs, recovery needs the coordinated database AND Storage backup. Restore
  into an isolated target first and reconcile any post-backup changes before cutover.
- Profile ending and Auth banning are separate operations. Failed bans remain retryable; recovering a
  deleted user requires an approved profile/Auth plan, not merely clearing a timestamp.
- A lost worker acknowledgement can retain a five-minute lease; wait for expiry and use the normal
  authorized retry. Do not shorten production leases or manually acknowledge present objects.
- Database/Storage restores, Auth unbans and production cutovers each require explicit owner approval.

## Files and outstanding gates

Local implementation changes: the new authorization and onboarding migrations; renamed management migration and
mutation guards in `13`, `14`, `16`; both Edge authorization calls; frontend Admin gate/route/tests;
catalog snapshot/materializer; local preparation/target guard/security tests; migration/deletion runner
updates; the reconciliation runner readiness fix; this plan and the main feature documentation.
Pre-existing `frontend/package-lock.json` and untracked `docs/verification/` were preserved.

Remaining gates: missing original source or explicitly approved baseline adoption; implementation and verification of the approved Admin-only
onboarding caller/source; real approved employee titles; verified coordinated backup; isolated
staging/restoration evidence; and final production approval. Unreferenced Storage objects remain intact.

Changed files for review (the pre-existing lockfile/verification directory are excluded):

- `supabase/migrations/20261105120100_organization_admin_authorization.sql` (new).
- `supabase/migrations/20261105120200_divisions_departments_management.sql` (renamed from `20261105120000_divisions_departments_management.sql`, with independent mutation guards).
- `supabase/migrations/20261105120300_access_request_admin_decisions.sql` (new, forward hardening; not recovered source).
- `supabase/migrations/20261105130000_department_storage_cleanup.sql`.
- `supabase/migrations/20261105140000_employee_positions.sql`.
- `supabase/migrations/20261105160000_user_management_and_consistency.sql`.
- `supabase/functions/delete-department/index.ts`.
- `supabase/functions/manage-users/index.ts`.
- `supabase/scripts/audit_organizational_structure.sql` (expanded read-only deployment audit).
- `frontend/src/components/admin/AdminAuthorizationGate.tsx` (new).
- `frontend/src/components/admin/adminAuthorizationGate.test.tsx` (new).
- `frontend/src/routes/guards.tsx`.
- `frontend/src/routes/organizationAccess.test.tsx`.
- `supabase/tests/fixtures/hosted-access-requests.snapshot.json` (new, schema-only provenance artifact).
- `supabase/tests/hostedAccessFixture.mjs` (new).
- `supabase/tests/localManagementTarget.mjs` (new).
- `supabase/tests/prepare_remediation.local.mjs` (new).
- `supabase/tests/organization_security.local.mjs` (new).
- `supabase/tests/deletion_supabase.local.mjs`.
- `supabase/tests/divisions_departments.mjs`.
- `supabase/tests/organization_migrations.mjs`.
- `docs/divisions-departments.md`.
- `docs/hosted-supabase-deployment-plan.md` (new).
