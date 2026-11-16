# Release plan: Staff → Sent Invitations

Written for whoever runs or reviews the release (the project owner). Every step was rehearsed on the local stack
first; the hosted rollout and its checks are recorded at the end.

## What is released

| Part | Change |
|---|---|
| Database | Two forward-only migrations, in this order: `20261122120000_staff_invitations`, `20261123120000_staff_invitations_reinvite` |
| Rollback | `supabase/scripts/rollback_staff_invitations_reinvite.sql`, then `supabase/scripts/rollback_staff_invitations.sql` |
| Edge Functions | `add-user` and `resend-invitation` changed; `cancel-invitation` and `invitation-link-state` are new |
| Website | Staff page's third tab, Sent Invitations; "This invitation has been cancelled." on Set New Password; people pickers offer activated staff only |

## What it does

- Add Staff still creates the account and profile at once, but the person is listed on **Sent Invitations**, not
  Active Staff, until they open the link and save a password (`mark_account_activated`, now waited for).
- **Resend** (only once the 24 hours are over) gives the account a password nobody knows first (every earlier link
  dies), then emails a new link; the Sent Date and the 24 hours start again. A failed send puts everything back.
- **Cancel** records the cancellation, then bans the sign-in account in Auth and replaces its password (every link
  and session ends). The staff profile, details and permissions are kept; the person is not deactivated and is on
  no Staff tab. `is_active_user()` is false for them, so row level security refuses them everywhere. Set New
  Password says "This invitation has been cancelled." for their links, also after they are invited again.
- **Re-invite**: Add Staff with a cancelled staff member's email reuses their account and profile (no duplicate),
  saves the details entered, lifts the ban with a new password nobody knows, emails a new link and records it
  (Sent, 24 hours). They stay off Active Staff and can't sign in until they accept it. If the email can't be sent,
  the account is banned again and the invitation stays cancelled (`invitation-failed`).
- **People pickers** (reviewers, routing, approvers, co-authors, the Quality Document Controller) offer only
  activated staff (`lib/assignable.ts`, fed by `get_unactivated_people`). The database refuses not-yet-activated
  people as new reviewers and co-authors (triggers on `review_requests` and `sop_co_authors`). History is untouched.
- Every link carries `?invitation=<random reference>`; it is not a token. `invitation-link-state` answers only
  cancelled / replaced / expired / used / valid / unknown for it.
- Audit rows go to `organization_management_audit` (`invitation-sent`, `-resent`, `-resend-undone`, `-cancelled`,
  `-cancel-undone`, `-activated`, `reinvite-user`), never holding a link, token or password.
- People without an invitation record (added before invitations were tracked, or whose invitation email failed)
  are unchanged everywhere.
- One-time backfill (second migration): an invitation whose person signed in after it was sent counts as activated.

## Order: database, then the Edge Functions, then the website

- **New website, old database**: safe. The Staff page can't read the invitations, so Active Staff lists everyone as
  before; pickers treat everyone as activated.
- **New database, old Edge Functions**: safe. `record_invitation_sent` keeps working with one argument.
- **New Edge Functions, old database**: not safe (add-user couldn't record the invitation). Functions go **after**
  the migrations.

## Steps

1. Read-only preflight (SQL Editor): migration history ends at `20261121120000`; invitation rows and who signed in
   after their invitation:
   ```sql
   select i.user_id, i.sent_at, u.last_sign_in_at
   from public.user_invitations i join auth.users u on u.id = i.user_id
   where (i.activated_at is null or i.activated_at < i.sent_at) and u.last_sign_in_at > i.sent_at;
   ```
   The second migration's backfill marks exactly these rows activated.
2. Apply both migrations, in order.
3. Deploy the functions:
   ```bash
   supabase functions deploy add-user --use-api
   supabase functions deploy resend-invitation --use-api
   supabase functions deploy cancel-invitation --use-api
   supabase functions deploy invitation-link-state --no-verify-jwt --use-api
   ```
   `invitation-link-state` runs with JWT verification off (Set New Password calls it signed out with the
   publishable key); it only uses the service key inside.
4. Push the website (`develop` deploys it).

## Rollback

`rollback_staff_invitations_reinvite.sql`, then `rollback_staff_invitations.sql`, then redeploy the previous
`add-user` and `resend-invitation`. Both restore every function they changed exactly (checked locally). Cancelled
people stay banned in Auth (unban them there if they should be invited again). The activation backfill and the
audit rows are kept.

## Known limits

- An access token issued before cancelling stays valid for Auth until it expires (at most an hour), but the
  database refuses that person everything (`is_active_user()`), and it can't be refreshed.
- Approver and Quality Document Controller choices are kept by the app, not the database; the app offers only
  activated staff for them.
