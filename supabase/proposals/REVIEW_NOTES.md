# Proposal: Riyadh working-day review deadlines

**Status: NOT APPROVED. NOT APPLIED. NOT EXECUTED.** Nothing in this folder has been run against
any database. Database integration of this proposal is unverified.

This folder is deliberately outside `supabase/migrations/`, so `npx supabase db push` never
applies these files. Only the database owner decides whether and when they are applied.

## Files

| File | What it does |
| --- | --- |
| `20261029000000_review_deadline_helpers.sql` | Five pure calendar helpers (no table access, no `now()` inside): Riyadh date, add 1–30 working days, Riyadh end of day (23:59:59.999), review due moment, response due moment. Execute is revoked from `public`, `anon` and `authenticated`, like `riyadh_today()` / `riyadh_end_of_day()`. |
| `20261029010000_internal_review_working_days.sql` | Adds `review_requests.deadline_policy`, and replaces three internal-review functions (`check_review_options`, `send_review_requests`, `accept_review`) so new requests use working days. |

Both files were first moved here unchanged (commit "move unapproved deadline migrations"), then
corrected in a separate commit, so the original versions stay in the Git history.

## The policy

- Time zone `Asia/Riyadh`; working days Sunday to Thursday; Friday and Saturday never count.
- Response deadline: fixed, the end of the **second working day after the request date** (that
  date not counted). There is no 16:00 rule any more for new requests.
- Review duration: optional, **1–30 working days**, counted after the Riyadh date of acceptance
  (that date not counted).
- Every deadline ends at **23:59:59.999** Riyadh time (millisecond precision, matching JavaScript).
- No public-holiday calendar.

## What changes for existing data

- Adding the column with default `calendar-v1` labels every existing request; the default then
  becomes `riyadh-working-days-v1` for new requests. No other row is updated, nothing is backfilled.
- Saved deadlines (`response_due_date/at`, `review_due_date/at`), decisions, comments and rounds are
  never recalculated.
- A `calendar-v1` request that is still pending and is accepted after the migration keeps its
  original calendar-day duration (this is why `deadline_policy` is needed).
- `withdraw_due()` / `withdraw_due_requests()` are unchanged: they compare against the saved
  `response_due_at`.

## Corrections made to Dalal's original proposal

| Original | Corrected |
| --- | --- |
| 50-character title trigger `sops_title_limit`, `check_sop_title_limit()`, `hawkim_validate_sop_title()` and a replacement `create_sop` | Removed. The database keeps its approved 1–150 title limit; 50 is a frontend rule. |
| Submission note limit raised to 1000 (`hawkim_validate_review_note`, UTF-16 length and trim helpers) | Removed. The approved 500-character check in `check_review_options` is kept exactly. |
| `response_counts_from` column and `hawkim_review_response_counts_from()` (old 8:00/16:00 display rule) | Removed. Not part of the agreed policy. |
| `check_review_options` rejected a browser date different from the server's calculation | **Midnight fix:** no comparison any more. The server alone sets the response deadline from one `now()`; the `p_response_due_date` parameter stays (same signature) and is ignored. A preview made before midnight can no longer cause a rejection after midnight. |
| Helpers granted to `authenticated` and `service_role` through a conditional `DO` block | Removed. Helpers are internal (revoked), like the existing Riyadh helpers; the review RPCs call them as security definer. |
| `send_review_requests` normalised notes with the custom trim helper | Original handling kept: `nullif(btrim(...), '')`. |

## What it deliberately does not touch

RLS policies, table grants, triggers, the public RPC grants, `create_sop`, title or note limits,
`withdraw_due`, every other function, and every existing row except the new column's default value.
Function signatures and return values are unchanged, so current frontend calls keep working.

## Before approving, the database owner should check

1. The ordering: the helpers file first, then the working-days file, each with a new timestamp
   later than the latest applied migration (currently `20261026150000_internal_review.sql`).
2. That `create or replace` of the three functions matches the deployed versions apart from the
   deadline lines (compare with `20261026150000_internal_review.sql`).
3. The static companion tests `supabase/tests/calendar_helpers.sql` and
   `supabase/tests/internal_review_rpc.sql` (updated to match; never executed). They are only for a
   disposable local database, and only with explicit permission.

## Activation (one approved change)

1. Apply the two files (database owner, after approval).
2. In the same change, set `WORKING_DAY_DEADLINES_ACTIVE = true` in
   `frontend/src/lib/deadlinePolicy.ts`. That switches the Submit for Review dialog to the fixed
   two-working-day date and working-day duration, and makes the app read `deadline_policy`.
3. Until both are done, the app follows the approved backend and shows "pending activation".
