# Release plan: Staff → Sent Invitations

Written for whoever runs the release (the project owner). Nothing here has been run against the hosted project;
every step was rehearsed on the local stack only.

## What is released

| Part | Change |
|---|---|
| Database | One forward-only migration: `20261122120000_staff_invitations` (rollback: `supabase/scripts/rollback_staff_invitations.sql`) |
| Edge Functions | `add-user` and `resend-invitation` changed; `cancel-invitation` and `invitation-link-state` are new |
| Website | Staff page's third tab, Sent Invitations; Set New Password's "This invitation has been cancelled." |

## What it does

- Add Staff still creates the account and profile at once, but the person is listed on **Sent Invitations**, not
  Active Staff, until they open the link and save a password (`mark_account_activated`, now waited for).
- **Resend** (only once the 24 hours are over) gives the account a password nobody knows first (every earlier link
  dies), then emails a new link; the Sent Date and the 24 hours start again. A failed send puts everything back.
- **Cancel** records the cancellation, then bans the sign-in account in Auth and replaces its password (every link
  and session ends). The staff profile, details and permissions are kept; the person is not deactivated and is on
  no Staff tab. `is_active_user()` is false for them, so row level security refuses them everywhere even with a
  token issued earlier. Set New Password says "This invitation has been cancelled." for their links.
- Every link now carries `?invitation=<random reference>`; it is not a token. `invitation-link-state` answers
  only cancelled / replaced / expired / used / valid / unknown for it.
- Audit rows go to `organization_management_audit` (`invitation-sent`, `-resent`, `-resend-undone`, `-cancelled`,
  `-cancel-undone`, `-activated`), never holding a link, token or password.
- People without an invitation record (added before 2026-11-12, or whose invitation email failed) are unchanged.

## Order: database, then the Edge Functions, then (already live) the website

- **New website, old database**: safe. The Staff page can't read the invitations, so Active Staff lists everyone as
  before and Sent Invitations says it couldn't load them. Set New Password works as before.
- **New database, old Edge Functions**: safe. `record_invitation_sent` keeps working with one argument (the link's
  reference is optional); links simply have no reference yet.
- **New Edge Functions, old database**: not safe (add-user couldn't record the invitation). Functions go **after**
  the migration.

## Steps

1. Read-only check first (SQL Editor). Tracked invitations that were activated but never marked would move from
   Active Staff to Sent Invitations; these rows show whether that can happen (people who signed in after the
   invitation was sent, without it being marked):
   ```sql
   select i.user_id, i.sent_at, u.last_sign_in_at
   from public.user_invitations i join auth.users u on u.id = i.user_id
   where (i.activated_at is null or i.activated_at < i.sent_at) and u.last_sign_in_at > i.sent_at;
   ```
   Any such person is marked again the next time they sign in with their password. To move them at once, set
   `activated_at = now()` for exactly those rows.
2. Apply `supabase/migrations/20261122120000_staff_invitations.sql`.
3. Deploy the functions:
   ```bash
   supabase functions deploy add-user --use-api
   supabase functions deploy resend-invitation --use-api
   supabase functions deploy cancel-invitation --use-api
   supabase functions deploy invitation-link-state --no-verify-jwt --use-api
   ```
   `invitation-link-state` must run with JWT verification off (Set New Password calls it signed out with the
   publishable key); it only uses the service key inside.
4. Check: Staff → Sent Invitations loads; add a test staff member, cancel the invitation, open its email link →
   "This invitation has been cancelled."

## Rollback

`supabase/scripts/rollback_staff_invitations.sql`, then redeploy the previous `add-user` and `resend-invitation`.
Cancelled people stay banned in Auth (unban them there if they should be invited again).

## Known limits

- A cancelled person's email can't be added again through Add Staff (the account is blocked: `account-blocked`).
- Pickers outside the Staff page (e.g. reviewers) still list people whose invitation is waiting, as before.
- An access token issued before cancelling stays valid for Auth until it expires (at most an hour), but the
  database refuses that person everything (`is_active_user()`), and it can't be refreshed.
