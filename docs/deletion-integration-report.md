# Divisions & Departments deletion verification

Verified 5 November 2026, on `feat/divisions-departments` at `7f4bdd6`.

## Outcome

All eight requested deletion areas passed. No application deletion defect was confirmed. Two existing PostgreSQL test-runner defects were reproduced and fixed. Application code and migrations were unchanged.

The final real Supabase run passed all 16 behavior groups (plus target checks). The PostgreSQL migration/RPC suite passed, including all five management migrations and the existing review regressions. Eight relevant frontend test files passed: **120 tests**. Frontend lint, TypeScript/production build, Node syntax checks and `git diff --check` passed. The full 1,225-test frontend suite and 29 invitation checks reported in the handoff were not rerun; they are prior results, not new evidence from this verification.

## Isolation and preservation

- Created a new Supabase project, `hawkim-deletion-20261105`, with a fresh database and Storage. Applied all 25 repository migrations from scratch; no production seed ran.
- API: `http://127.0.0.1:56431`; PostgreSQL: `127.0.0.1:56432/postgres`; local email: port 56434; Edge inspector: 8183.
- Verified dedicated Docker mounts `supabase_db_hawkim-deletion-20261105` and `supabase_storage_hawkim-deletion-20261105`. The test refuses other API/database URLs and verifies container mounts and the database port before creating fixtures.
- The separate PostgreSQL suite uses its own automatically removed container, no published ports and `--network none`; its Auth and Storage schemas are stand-ins. Real file deletion was tested separately through Supabase Storage and Edge APIs.
- Existing `hawkim-management-local` services on 55431/55432 and unrelated Docker services were preserved. Its already-stopped Edge container was not restarted. Existing invitation-test volumes were preserved.
- After verification, stopped only `hawkim-deletion-20261105` with its explicit project ID and `--no-backup`. Verified its containers/volumes were removed and the original container/volume inventory remained. Removed the new private status/credentials file; ignored configuration/source copies remain for reference.
- No hosted Supabase URL was used, queried, migrated or reset. `frontend/.env.local` was not read or changed.
- No branch/worktree created, commit made, push, merge or deployment performed.
- Pre-existing `frontend/package-lock.json` changes and untracked `docs/verification/` files were preserved. This report uses a new path outside that existing directory.

## Passed tests

| Requested area | New local evidence |
| --- | --- |
| Department deletion restrictions | Assigned employees block both normal deletion and purge preparation. Nonempty departments require an SOP disposition. Stale timestamps conflict. Direct destructive SQL RPC bypass is refused. Active review/approval statuses, an open review round on a draft SOP, and a running compliance check block removal. Edge requires explicit destructive confirmation. |
| Move SOPs to Others | Department becomes a tombstone; SOP remains live in `others`; both version files remain in Storage and author access is preserved. |
| Delete SOPs and Storage files | Real local Edge worker removes every version object; SOP access disappears and department finalizes. A previously soft-deleted version is included. Storage metadata reports absence and file download fails. Relational SOP/version tombstones are retained by design. |
| Storage failures and retries | Real author Storage permission failure leaves the job failed and department incomplete; admin Edge retry completes. Partial deletion acknowledges only absent files. A 101-file job processes 100 files, stays pending, then completes the remainder. Lost acknowledgement leaves an active lease; expiry enables recovery. |
| Division deletion | Assigned active departments prevent removal. An empty division becomes inactive and disappears from management results; repeat removal conflicts. Concurrent deletion versus department creation cannot both commit. |
| User soft deletion | Self-deletion and deletion of an author with work in progress are refused. Successful Edge deletion retains and ends the profile, bans Auth, blocks a fresh login and existing-token SOP reads. Retrying is idempotent. The SQL suite also verifies last-admin and retained-history rules. |
| Admin authorization | Non-admin and anonymous calls cannot delete departments/divisions/users or access worker RPCs. Non-admin Edge calls fail. Ended and banned administrators cannot use issued tokens to authorize deletion. |
| Concurrent operations and rollback | Both employee-assignment/deletion orderings preserve invariants using overlapping database sessions. Concurrent purge starts return one job; simultaneous claims issue one lease and one busy response. Injected audit failure rolls back Others movement and purge preparation, including manifests and SOP scrubbing. Finalization failure rolls back database completion after file removal; lease expiry and retry safely complete. |

Additional checks cover pending-job assignment/movement restrictions, refusal to acknowledge files still present in Storage, prohibition on reusing deleted upload paths, count/position persistence, and original organizational structure compatibility.

The PostgreSQL suite also passed stale/missing lease and unexpected-path rejection, partial recovery, role restrictions, transactional rollback and both existing review regressions. `other_department_reviewers.sql` passed five successive executions on the final schema. Its informational intermediate-schema result is not treated as a final-schema result.

## Failures encountered and fixes

1. **Existing runner startup race:** `pg_isready` could observe the image's temporary Unix-socket initialization server. The first actual SQL command then failed when that server stopped. Changed readiness to TCP `127.0.0.1`, available when the final server starts.
2. **Existing runner migration selection:** comparing a full migration filename with the timestamp-only string `20261105130000` included that same migration again. The suite stopped with `relation department_file_deletions already exists`. Changed the exclusive lower boundary to the complete cleanup migration filename. The full suite then passed.
3. **New test fixture corrections during development:** the copied helper generated duplicate department initials, and an added review fixture initially used an unsupported enum value. Replaced initials with unused three-letter values and used `completed` for the review round. Final run passed.
4. **Environment-only frontend startup failure:** sandbox restrictions produced `spawn EPERM` while Vite loaded its configuration. Rerunning the same 120 tests with approved execution permissions passed; no dependency or lockfile change was needed.

**Remaining failed tests: none in the final runs.** Expected permission, conflict and injected-failure responses above are passing negative tests.

## Files changed

- `supabase/tests/divisions_departments.mjs`: two runner fixes.
- `supabase/tests/deletion_supabase.local.mjs`: real local deletion integration coverage with fixed disposable-target checks; imports the production cleanup worker for controlled failure injection and calls the actual Edge functions for successful deletion/recovery.
- `docs/deletion-integration-report.md`: this report.

Local test configuration, copied functions/migrations and credentials were placed under ignored `.local-tests/deletion-20261105/`. They are not deployment changes or commit candidates.

## Reproduction

Use Node 24, installed frontend dependencies, Docker Desktop and the installed Supabase CLI. Create a **new disposable** project before running; never point the existing management fixture script at shared data. The new test deliberately accepts only this project name and these ports.

1. Under `.local-tests/deletion-20261105/supabase/`, copy the current repository `migrations/` and `functions/` directories. Do not copy hosted secrets or project links.
2. Configure project ID `hawkim-deletion-20261105`, API 56431, DB 56432, shadow 56430, PostgreSQL 17, email 56434, inspector 8183, seed disabled, and Studio/analytics/realtime disabled. Expose `public` and `graphql_public`, with `public, extensions` in the API extra search path. Enable Auth and Storage; disable email confirmation. Set `verify_jwt = false` for `delete-department` and `manage-users`, which verify Auth tokens internally.
3. Run `supabase start --workdir .local-tests/deletion-20261105 --exclude studio,postgres-meta,logflare,vector,supavisor,realtime,imgproxy`.
4. Save `supabase status --workdir .local-tests/deletion-20261105 --output json` privately to `.local-tests/deletion-20261105/status.local.json`; do not print or commit it.
5. Run `node supabase/tests/deletion_supabase.local.mjs`. Separately run `node supabase/tests/divisions_departments.mjs`.
6. Dispose of **only** the created project with `supabase stop --project-id hawkim-deletion-20261105 --no-backup`. Never use `--all`, Docker prune, or reset an existing project.

## Remaining work before hosted deployment

- Review these test changes and approve the hosted rollout separately. This local verification is not evidence of the hosted project's current migration ledger, policy state or Edge configuration.
- Reconcile the hosted migration ledger/schema with the existing organizational-structure reconciliation decision; confirm which of the five management migrations remain unapplied. Prepare the exact ordered migration list before execution. Do not blindly replay the non-idempotent cleanup migration or mark it applied without evidence.
- Confirm an available backup/recovery procedure and a deployment window for DDL and row locks. Review the intended retention behavior: SOP relational/audit tombstones remain after file removal, while document content is scrubbed; moving to Others preserves files.
- Deploy matching `delete-department` and `manage-users` Edge functions with server-side Supabase credentials, internal token verification, and the repository function configuration. Ensure service-role credentials remain server-only.
- Confirm invitation redirect/email configuration as part of the separate user-management rollout; invitation delivery was outside this deletion-focused rerun.
- Perform authorized hosted smoke checks of load/permissions and ordinary CRUD after rollout. Any hosted destructive smoke scenario requires its own explicit approval and disposable records.
- Establish operational handling of failed/pending cleanup jobs and failed user bans. Recovery is explicit retry; an interrupted worker may require the five-minute lease to expire. The test shortens leases only inside the disposable database. Batching was verified at 101 files, not at production-scale latency or service limits.
- Existing signed URLs and previously downloaded file copies are not revocation evidence from these tests; no browser visual regression, production load test, real network outage or real Auth-admin ban outage was simulated.
