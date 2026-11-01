# Riyadh working-day review deadlines

**Status: APPLIED to the live project on 1 November 2026, with `WORKING_DAY_DEADLINES_ACTIVE` on.**
The database owner approved and applied the two files in `supabase/migrations/`. Afterwards the
existing rows were `calendar-v1` and unchanged, the calculation and permissions were correct, and a
new request in the browser got the right response and review deadlines. The SQL tests in
`supabase/tests/` were skipped for this delivery and have never been executed.

## Files

| File | What it does |
| --- | --- |
| `20261101120000_review_deadline_helpers.sql` | Five pure calendar helpers (no table access, no `now()` inside): Riyadh date, add 1–30 working days, Riyadh end of day (23:59:59.999), review due moment, response due moment. Execute is revoked from `public`, `anon` and `authenticated`, like `riyadh_today()` / `riyadh_end_of_day()`. |
| `20261101120100_internal_review_working_days.sql` | Adds `review_requests.deadline_policy`, and replaces three internal-review functions (`check_review_options`, `send_review_requests`, `accept_review`) so new requests use working days. |

Both files were first moved to `supabase/proposals/` unchanged (commit "move unapproved deadline
migrations"), then corrected in a separate commit, so the original versions stay in the Git history.
After approval they moved to `supabase/migrations/` with new timestamps; only their header comments
changed. `supabase/scripts/rollback_working_day_deadlines.sql` undoes them.

## The policy

- Time zone `Asia/Riyadh`; working days Sunday to Thursday; Friday and Saturday never count.
- Response deadline: fixed, the end of the **second working day after the request date** (that
  date not counted). There is no 16:00 rule any more for new requests.
- Review duration: optional, **1–30 working days**, counted after the Riyadh date of acceptance
  (that date not counted).
- Every deadline ends at **23:59:59.999** Riyadh time (millisecond precision, matching JavaScript).
- Every new request gets a response deadline, so an unanswered request is always withdrawn in the end.

**Known limitation: public holidays are not covered.** There is no holiday calendar, and that is out
of scope for this delivery: a public holiday from Sunday to Thursday counts as a working day.

## What changes for existing data

- Adding the column with default `calendar-v1` labels every existing request; the default then
  becomes `riyadh-working-days-v1` for new requests. No other row is updated, nothing is backfilled.
- Saved deadlines (`response_due_date/at`, `review_due_date/at`), decisions, comments and rounds are
  never recalculated.
- A `calendar-v1` request that is still pending and is accepted after the migration keeps its
  original calendar-day duration (this is why `deadline_policy` is needed).
- A reviewer added to a round that was already open gets the new policy, so one round can hold both.
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

## SQL tests

The companion tests `supabase/tests/calendar_helpers.sql` and `supabase/tests/internal_review_rpc.sql`
were never executed. They are only for a disposable local database, and only with explicit permission.

## Activation

`WORKING_DAY_DEADLINES_ACTIVE` in `frontend/src/lib/deadlinePolicy.ts` is `true`, so the app reads
`deadline_policy` and the Submit for Review dialog has no response date field.

To roll back, set the switch to `false` first, then run the rollback script.
