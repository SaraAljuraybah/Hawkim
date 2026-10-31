# Full-stack integration review

Current state of `feat/frontend-ui-enhancements` after removing prototype mode (31 October 2026).
The earlier version of this review (with `FRONTEND_PROTOTYPE = true`) is in the Git history.

**Database integration is unverified.** No SQL was executed, no migration was applied, and the
shared Supabase project was not contacted. All tests below run locally against stand-ins.

## What runs on the real backend (from `develop`)

The prototype switch `FRONTEND_PROTOTYPE` and its file were removed. The app uses `develop`'s
Supabase paths again, with Dalal's new UI on top:

- **Sign-in:** Supabase Auth (`services/auth.ts`), sessions per browser tab (`sessionStorage`). The
  local "select a demo identity by email" sign-in and the `.demo` accounts were removed.
- **People, departments, guideline versions:** loaded from the database after sign-in.
- **SOPs, versions, files, co-authors:** through the existing RPCs and Storage; files open through
  10-minute signed links again (`services/files.ts`), not prototype-only URLs.
- **Compliance check:** only where `departments.requires_compliance_check` is true
  (Pharmacovigilance), as the database enforces. The prototype "required for every SOP" rule was removed.
- **Internal parallel review:** submit, add/remove reviewers, accept, decline, decide, respond,
  withdraw — each checks the browser rules first, then calls the RPC and reads the SOP again.
- **Identity isolation (Dalal's):** rows are reloaded per signed-in user; a previous user's database
  rows are cleared before the next user's load; late replies and stale callbacks are rejected.

`services/sops.ts` reads only columns that exist in the approved schema
(`response_due_at` and `review_due_at` are now read and shown as saved).

## Still in this browser tab only (not in the database)

Approval (submission, Approver decisions, publication), the admin portal, user requests and access
to other departments, and notification read state. They work on top of the real SOPs and reset on
reload, as in `develop`. Note:

- The database gives an assigned Approver **no read access** to an SOP (no approval tables or RLS
  basis yet), so the approval flow cannot be completed end to end on database SOPs.
- No Approver account currently exists in Supabase Auth (the seed lists approvers, but none can sign
  in). Treat Approver availability as unverified.

## Deadlines: working-day policy pending activation

- Live now (matches the approved `20261026150000_internal_review.sql`): optional author-chosen
  response date (today or later; tomorrow or later from 16:00), optional 1–30 **calendar** days of
  review, deadlines shown exactly as saved. The Submit for Review dialog says the working-day policy
  is pending activation.
- Ready but switched off: `WORKING_DAY_DEADLINES_ACTIVE = false` in `frontend/src/lib/deadlinePolicy.ts`.
  The working-day code (`lib/riyadhWorkingDays.ts`, `lib/fixedResponseDeadline.ts`) and its tests
  are kept; those tests run with the switch mocked on.
- Database proposal: `supabase/proposals/` (corrected; see `REVIEW_NOTES.md`). Never in
  `supabase/migrations/` until approved.

## Agreed validation limits

| Field | Limit | Where |
| --- | --- | --- |
| SOP title | 50 characters (required) | Frontend only; the database keeps 1–150 |
| Submission note | 500 characters | Frontend and the approved database check (the branch's 1000 was set back) |
| Reviewer decision comments, reasons | 1,000 characters | Frontend and database |
| SOP file | PDF or DOCX, 10 MB, required | Frontend and Storage/RPC |

## Local verification (no database)

From `frontend/`: `npm test`, `npm run test:calendar`, `npm run lint`, `npx tsc -b`, `npm run build`.
Service and provider tests use mocked services (a stand-in database in
`state/SopsProvider.isolation.test.tsx`); `services/reviewSchemaContract.test.ts` checks SQL text
statically. None of this proves RPC behaviour, RLS, grants or deployed compatibility.

`supabase/tests/*.sql` and the CLI mode of `supabase/tests/calendar_parity.mjs` execute SQL; they
were updated to match the corrected proposal but were **not executed**, and may only run against a
disposable local database with explicit permission. Never run them against the shared project.

## Remaining boundaries

- Approval, administration and cross-department access need tables, RPCs and RLS.
- Unattended withdrawal of expired pending requests still needs a scheduled job; today it runs when
  review functions are called or a SOP loads.
- Frontend date handling outside review deadlines still uses the device's time zone for some legacy
  (sample-only) flows; devices in Saudi Arabia give the same results.
- Do not reset the database or replay the whole migration history:
  `20261025110000_drop_prototype_tables.sql` removes legacy tables.
