# Full-stack integration review

Current state of `feat/frontend-ui-enhancements` after removing prototype mode (31 October 2026).
The earlier version of this review (with `FRONTEND_PROTOTYPE = true`) is in the Git history.

**Database integration is unverified, except the working-day deadlines, the compliance check rule,
responses to one reviewer, and private comments and responses.** This review executed no SQL, applied
no migration and did not contact the shared Supabase project; all tests below run locally against
stand-ins. The database owner applied those four changes to the live project on 1 November 2026 and
checked them there, see "Compliance check", "Internal parallel review", "Private comments and
responses" and "Deadlines" below.

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
  One completed check per SOP version and GVP version: the page blocks the button, and
  `20261101140000_compliance_check_once_per_version.sql`, applied to the live project on 1 November
  2026, makes `start_compliance_check` refuse too. A failed check or a newer GVP version can still run. It covers that function
  only, so a future service that writes `compliance_checks` directly with the secret key bypasses it.
  `supabase/scripts/rollback_compliance_check_once_per_version.sql` undoes it.
- **Internal parallel review:** submit, add/remove reviewers, accept, decline, decide, respond,
  expire, send again — each checks the browser rules first, then calls the RPC and reads the SOP again.
  A response from a reviewer's comments dialog goes only to that reviewer
  (`20261101150000_respond_to_one_reviewer.sql`, applied to the live project on 1 November 2026, with
  `PER_REVIEWER_RESPONSE_ACTIVE` on). `supabase/scripts/rollback_respond_to_one_reviewer.sql` undoes it.
- **Changing a review deadline:** `20261101170000_review_deadline_event.sql` and
  `20261101170100_change_review_deadline.sql` (not applied yet; `REVIEW_DEADLINE_EDITING_ACTIVE` is on,
  and the app reads the new timeline columns, so apply them first). The main author can change or
  set the deadline of a request being reviewed, as working days from acceptance. The change is
  private like a response, but anyone who can view the version can still read the current deadline in
  `review_requests`. A calendar-v1 request moves to the working-day policy when edited. Review
  durations go up to 3,650 working days, a technical limit, confirmed in the browser above 60.
  `supabase/scripts/rollback_change_review_deadline.sql` undoes it.
- **Private comments and responses:** `20261101160000_private_review_comments_and_responses.sql`,
  applied to the live project on 1 November 2026, limits reviewer comments (`sop_comments`,
  `role = 'reviewer'`) and responses (`timeline_events`, `type = 'response'`) to the SOP's author, its
  co-authors and that reviewer, with `can_read_review_note`.
  `supabase/scripts/rollback_private_review_comments_and_responses.sql` undoes it. Sample SOPs live
  in the browser, so this doesn't cover them.
  Other reviewers can still read decline reasons, removal reasons, each other's decisions and names
  (`review_requests` and the other timeline events). Those are decided with the reviewer view rework.
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
- Decided for when approval moves to the database: an Approver may read a response addressed to their
  own comment (`can_read_review_note` already allows anyone in `recipient_ids`), and Approvers don't
  read reviewer comments.

## Deadlines: working-day policy live since 1 November 2026

- `WORKING_DAY_DEADLINES_ACTIVE = true` in `frontend/src/lib/deadlinePolicy.ts`: a fixed response
  deadline two working days after sending, set by the server, and an optional 1 to 3,650 **working** days
  of review. The Submit for Review dialog has no response date field. Deadlines are shown as saved.
- The app reads `review_requests.deadline_policy`, which comes from `20261101120000` and
  `20261101120100`, both applied to the live project. See `supabase/proposals/REVIEW_NOTES.md`.
- Requests sent earlier stay `calendar-v1` with their saved deadlines and calendar-day duration.
- Public holidays are not covered (a known limitation).
- With the switch off, the app doesn't read that column: no response date and calendar-day durations.
  `supabase/scripts/rollback_working_day_deadlines.sql` is the matching database rollback.

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
`state/SopsProvider.isolation.test.tsx`); `services/reviewSchemaContract.test.ts`,
`services/complianceSchemaContract.test.ts`, `services/responseSchemaContract.test.ts`,
`services/reviewPrivacyContract.test.ts` and `services/reviewDeadlineContract.test.ts` check SQL text
statically. None of this proves RPC behaviour, RLS, grants or deployed compatibility.

`supabase/tests/*.sql` and the CLI mode of `supabase/tests/calendar_parity.mjs` execute SQL; they
were updated to match the migrations but were **not executed**, and may only run against a
disposable local database with explicit permission. Never run them against the shared project.

## Remaining boundaries

- Approval, administration and cross-department access need tables, RPCs and RLS.
- Unanswered requests expire when review functions are called or an SOP loads, not at a scheduled
  time. That is enough for in-app notifications; a scheduled job would only be needed for emails.
- Frontend date handling outside review deadlines still uses the device's time zone for some legacy
  (sample-only) flows; devices in Saudi Arabia give the same results.
- Do not reset the database or replay the whole migration history:
  `20261025110000_drop_prototype_tables.sql` removes legacy tables.
