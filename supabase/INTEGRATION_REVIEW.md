# Full-stack integration review

This document records the dependencies and unresolved decisions for the merged
frontend and retained Supabase implementation. It does not approve deployment,
execute SQL, or enable the integration. `FRONTEND_PROTOTYPE` remains `true`.

## Schema and migration dependencies

The approved context-only schema export contains the existing SOP, version,
compliance, review-round and review-request tables. It does **not** contain
`review_requests.deadline_policy` or `review_requests.response_counts_from`.

The proposed integration requires these files in order, after the existing
internal-review migration and its dependencies:

1. `migrations/20261029000000_review_deadline_helpers.sql`: pure calculation and
   input-validation functions.
2. `migrations/20261029010000_internal_review_working_days.sql`: additive request
   metadata, replacement review RPC helpers/acceptance, and SOP title validation.

`frontend/src/services/sops.ts` explicitly selects both new columns. Making the
TypeScript DTO properties optional does not make that SQL query compatible with
an unextended database. Do not deploy the dependent service until the extensions
and their policies have been approved and applied through the team's process.
Do not silently retry without the fields or recompute old deadlines: that loses
the distinction between historical calendar requests and new working-day ones.

The additions label existing requests `calendar-v1` before changing the default
for future requests to `riyadh-working-days-v1`. Saved response/review instants,
decisions, comments and version-scoped history are not rewritten. Pending legacy
requests still get a calendar-based duration if later accepted.

The approved export omits RPC bodies, RLS, triggers, grants, enum definitions and
some composite-constraint details. Repository definitions can be compared
statically, but this does not certify the deployed definitions or migration ledger.

## Decisions requiring team approval

| Area | Approved schema / existing behavior | Proposed behavior |
| --- | --- | --- |
| SOP title | Table CHECK allows 1–150 PostgreSQL characters; current UI limits input to 50 UTF-16 units | A new trigger and replacement `create_sop` enforce the UI's 50-unit limit on the server |
| Review duration | Nullable integer 1–30; earlier RPC counts calendar dates | Same optional numeric range, counting future Sunday–Thursday dates from acceptance |
| Response deadline | Existing RPC accepts an optional date with a minimum | Server fixes two future working dates after sending; NULL from an older client still gets a deadline |
| Submission comments | Timeline allows 1,000 characters; earlier RPC permits 500 | Up to 1,000 trimmed UTF-16 units, matching the current frontend |
| Request metadata | Neither new column appears in the approved export | Add `deadline_policy` and nullable `response_counts_from` |
| Calculation permissions | Effective grants/default privileges are not in the export | Helpers revoke PUBLIC and grant authenticated/service_role; explicit or inherited anon grants still require review |

The title trigger is stricter than the existing table CHECK. It does not truncate
old titles or fire on unrelated column updates, but an explicit future title
update must satisfy the proposed limit. JavaScript UTF-16 length also differs
from PostgreSQL character length for supplementary Unicode characters; the same
distinction applies to descriptions and review comments.

New calculations use `Asia/Riyadh`, exclude the origin date and Friday/Saturday,
and end at `23:59:59.999` Riyadh time. There is no public-holiday calendar. Review
duration starts at acceptance; the response period starts from the sending date.
The 08:00/16:00 rule controls the displayed allocation start, not the final fixed
response date or the hours in which a reviewer may respond.

## Local verification without a database

From `frontend/`:

```sh
npm test
npm run test:calendar
npm run lint
npx tsc -b
npm run build
```

`test:calendar` requires Node 24+ and imports the real frontend calendar using
native TypeScript support. It tests independently specified result fixtures and
the parity comparator; it does not invoke Docker, psql or PostgreSQL. Frontend
service tests mock Supabase. Static migration-contract tests inspect SQL text;
none of these proves actual SQL execution, RLS or deployed compatibility.

`tests/calendar_helpers.sql`, `tests/internal_review_rpc.sql`, and the explicit
CLI invocation of `tests/calendar_parity.mjs` execute SQL. They must only run
later against an explicitly authorized disposable local database. They were not
executed during this review. The RPC fixture now sets deterministic round
chronology inside its rollback-only test transaction; production ordering is
unchanged.

## Remaining integration boundaries

- Approval submission/decisions/publishing and some administration/request state
  remain local; the SOP mapper initializes `approvers: []`.
- Existing repository access functions do not provide a persisted access basis
  for an assigned Approver or an approved foreign-department directory grant.
- Current-version compliance is mandatory for every SOP in the prototype, but
  the retained backend gates it by `departments.requires_compliance_check`.
- Unattended withdrawal of expired pending requests still needs an approved
  scheduling arrangement; current calls occur during actions/browser activity.
- Real RPC, RLS, Storage authorization, migrations and cross-timezone SQL parity
  still require execution in an authorized disposable environment.

Before any deployment, reconcile the target's migration history with the approved
schema. Do not reset the database or replay the whole history: the preexisting
`20261025110000_drop_prototype_tables.sql` removes legacy tables. It is preserved
unchanged, and no permission to run it is implied by this review.

The branch can be reviewed as a full-stack proposal, with these decisions and
boundaries explicit. It is not yet a verified, fully persisted integration ready
for deployment.
