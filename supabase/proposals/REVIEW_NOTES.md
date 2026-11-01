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
- Review duration: optional, **1–30 working days** when this was applied, counted after the Riyadh
  date of acceptance (that date not counted). `20261101170100_change_review_deadline.sql` later
  raised the limit to 3,650 working days.
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
are only for a disposable local database, never the shared project. `internal_review_rpc.sql` was
first run on 2 November 2026, on a throwaway in-memory Postgres (PGlite) with stand-ins for Supabase's
auth and storage schemas; its old 30-day duration check was corrected then. `calendar_helpers.sql` has
still never been executed.

## Activation

`WORKING_DAY_DEADLINES_ACTIVE` in `frontend/src/lib/deadlinePolicy.ts` is `true`, so the app reads
`deadline_policy` and the Submit for Review dialog has no response date field.

To roll back, set the switch to `false` first, then run the rollback script.

# Expired review requests

**Status: APPLIED to the live project on 2 November 2026.** The status check afterwards showed no
withdrawn requests.

`20261102120000_review_request_expired_values.sql` and `20261102120100_review_request_expired.sql`
replace the automatic withdrawal of unanswered requests with a stored `expired` status. The response
deadline itself doesn't change, and neither does Overdue after acceptance.

- `expire_due` does what `withdraw_due` did, and `withdraw_due` now calls it, so the functions that
  call it are unchanged. `withdraw_due_requests` stays for tabs still open on the previous app; the
  app calls `expire_due_requests`. Both can go once no old tab can be open.
- An expired reviewer doesn't count as taking part, as withdrawn didn't. `settle_review_round` and
  `upload_sop_version` list it; `add_reviewers` deliberately doesn't, so it refuses that reviewer.
- `resend_review_request` is the main author's Send Again: a new request, same duration, new response
  deadline. It records `review-request-resent`, not `submitted`, because `submitted` would move the
  window that decides who a general response reaches.
- `review-expired` and `review-request-resent` are private, like responses: the author, co-authors
  and the people in `recipient_ids` (the main author and the reviewer, not co-authors).
- **No scheduled job:** the bell is built in the browser, so someone has to have the app open to see a
  notification, and loading the SOP expires what is due. Because the event is dated at the deadline,
  which is usually before the session started, `isRead` keeps an expired request unread until the
  reviewer's latest request on the current version is no longer expired.
- **Backfill:** only requests with `withdrawn_at = response_due_at`, never accepted, decided or
  removed, with System's `review-withdrawn` event. They keep `withdrawn_at`, and rounds don't change.
  Requests withdrawn and later removed stay Removed, and their event keeps its wording.

`supabase/scripts/rollback_review_request_expired.sql` undoes it, after the app is back on the
previous code. Requests already sent again stay, and their event reads "submitted".
