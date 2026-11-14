# Manage Organization → Admins (Super Admin and Admin)

Hawkim is **multi-tenant**: one Supabase project holds many organizations, and each accepted Request
Hawkim creates one (see [multi-tenancy.md](multi-tenancy.md)). Everything below is per organization: each
organization has its own Super Admin and Admins, and the Super Admin designation is
`organizations.super_admin_id`. The release sections further down (preflight, hosted status, the
`20261111120000_super_admin.sql` rollout) describe the earlier single-tenant setup and are kept as history:
`deployment_onboarded` and "one organization per deployment" were removed in `20261117130000`.

## Roles

Hawkim has exactly two administrator roles: **Super Admin** and **Admin**. There is no third one.

Both levels hold the one existing role, `admin` (`user_roles`). Every admin-only function, policy and
route keeps working for both. The **Super Admin** is a designation on top of it: the single row of
`public.super_admin` names one active Admin. Since `20261116140000_organization_settings_per_organization.sql`
the designation is `organizations.super_admin_id`, one per organization (and that table is gone).

### Names shown to people

- An administrator's role is shown as **Super Admin** (the current Super Admin) or **Admin** (everyone
  else), in the sidebar badge, the top bar, My Profile and the Admins pages. The portal reads who the
  Super Admin is once (`SuperAdminProvider` in `AdminLayout`), and Make Super Admin updates it, so every
  label changes at once. Until it is known, no role is shown, so the Super Admin is never shown as Admin.
- The accepted Request Hawkim applicant is described as the organization's **Super Admin** (review page,
  review email, welcome email).
- General text says "administrator(s)". The portal itself is the **Admin Portal** (tab titles, the
  navigation's accessible name); **Manage Organization** is only its sidebar group.
- Internal names are unchanged on purpose, so nothing that is already deployed breaks: the `admin` role,
  `isSystemAdmin()` in the frontend (true for both levels), the `system_admin` variables in SQL functions
  and the policy names "System admins can read ..." of `20261110130000_admin_reads_published_sops.sql`.
  None of them is shown to anyone.

| Action | Super Admin | Admin |
|---|---|---|
| View Admins | Yes | Yes |
| Add a regular Admin | Yes | Yes |
| Edit a regular Admin (or themselves) | Yes | Yes |
| Edit the Super Admin | Themselves only | No |
| Delete a regular Admin | Yes | No |
| Make Super Admin (transfer) | Yes | No |
| Delete the Super Admin | No (transfer first) | No |
| Staff, Divisions and Departments, everything else | Full | Full |

The database enforces all of this (migration `supabase/migrations/20261111120000_super_admin.sql`). The
pages only decide what is shown:

- **At most one Super Admin.** The table's key can only be `true`.
- **Never zero once assigned.** The row can't be deleted. The Super Admin's profile can't be ended, and
  their Admin role can't be removed.
- **Transfer is all or nothing.** `transfer_super_admin(recipient)` is one `UPDATE` under the row's lock.
  A repeated or concurrent request finds the role already moved and is refused. The recipient must be an
  active Admin (not deleted, not banned, not staff, not the caller).
- **Delete Admin** (`delete_admin`, Super Admin only) ends the profile (`deleted_at`), as Hawkim does for
  every deleted person. Their name stays on SOP history; nothing is removed.
- **Edit Admin** (`update_admin`) changes name and phone only, never the role. Email goes through the
  existing `update-user-email` Edge Function, which also changes the sign-in account. Its dry run already
  refuses a regular Admin changing the Super Admin's email.
- **Add Admin** is the existing `add-user` Edge Function with the Admin permission. It creates a real
  sign-in account and emails an invitation. Retrying reuses the same account.
- **Staff no longer manages Admins.** The Staff pages don't list or offer the Admin permission. The
  database refuses granting or removing `admin` through the Staff functions (`admin-managed-separately`).
- **Checks always read the current state.** A former Super Admin's open session loses the elevated
  actions immediately.
- **Audit.** Add, edit, delete and transfer are recorded in `organization_management_audit`. A transfer
  records the previous and new Super Admin, the person who started it, and the roles before and after.

## Onboarding a new organization (Request Hawkim)

### How it works today

The Request Hawkim form (`/request-hawkim`), the team's review page (`/review-request`) and the
`access-requests` Edge Function are part of **every** Hawkim deployment: the same frontend and the same
Supabase project as the organization's own data.

1. A visitor submits the form. The request is stored in **this project's** `access_requests`, and a
   review link with a random 32-byte token (only its SHA-256 is stored) is emailed to `REQUESTS_TO`
   (default `requests@tryhawkim.com`). At most 3 requests per email in 24 hours.
2. Whoever holds the review link can view, accept or reject. The link expires after 14 days and works
   once: a decided request can't be decided again (`lock_pending_access_request`, row lock).
3. **Accept** creates the applicant's sign-in account and Admin profile **in this same project** and,
   since `20261111120000`, makes them its Super Admin. If the project already has an Admin, Accept is
   refused with `409 deployment_onboarded` before any account is created.

So the project that **receives** a request is also the one the applicant **gets an account in**. In a
single-tenant setup that is only correct for a brand-new, empty deployment.

### What the hosted project is (checked 2026-11-10, read-only)

It is a **mixed** environment (intake and an organization's deployment in one project):

- Intake: its `access-requests` function is deployed and answers (`view` with an unknown id returns the
  function's own `404 {"error":"not_found"}`), and `www.tryhawkim.com` is the default `SITE_URL` of both
  the review link and the set-password link.
- Organization: it has the full organizational schema (anonymous reads of divisions, departments,
  profiles and roles are refused, as they should be) and the Admin accounts that sign in to its admin
  portal.

What can't be seen without signing in: how many requests were accepted there, and for how many
organizations. Preflight queries 3 and 5 below answer that. **If requests from more than one organization
were accepted there, those organizations' contacts are Admins of the same database and can see each
other's data**: that must be resolved before anything else.

### The consequence of the new rule

Once `20261111120000` is applied to the hosted project (which already has Admins), **every Accept there
answers 409**. Requests can still be submitted and are stored, but the Hawkim team can no longer approve
new customers there in the way it does today. Pending review links expire after 14 days.

The documented alternative ("accept the request on the new deployment") also has a gap: the request was
submitted to the hosted project, so a new deployment has no record of it and no review link for it.

### Proposed architecture (not implemented; needs approval)

Keep single tenancy, and separate **intake and approval** from **provisioning**:

1. **Central intake (Hawkim's own project, no customer data).** The public Request Hawkim form, the review
   page and the request records. Accept there only records the decision and notifies the team with the
   provisioning checklist. It creates **no** account and grants nothing anywhere. Today's hosted project
   can play this role only if it holds no organization's working data; since it does, a small separate
   intake project (or keeping the hosted one as intake and moving the organization out) is the clean
   option.
2. **One deployment per organization**, provisioned by the Hawkim team after approval (the checklist below;
   still by hand).
3. **Initial Super Admin of the new deployment**, set by the Hawkim operator as the project owner: create
   the approved contact's sign-in account (an Auth invite), then an owner-only function creates the Admin
   profile and the Super Admin row, refusing when the deployment already has an Admin (the same rule as
   `deployment_onboarded`). Nobody signed in to the app can call it.
4. Organization deployments don't take requests: their "Request Hawkim" link points to the central site,
   or `access-requests` runs in an "intake disabled" mode there.

Changes this would need (after approval): an intake mode for `access-requests` (`central`: approve
without provisioning; `organization`: refuse submissions), an owner-only bootstrap function and script,
and the frontend link. No multi-tenancy, no organization id, no automatic infrastructure.

Until that is decided, the safe choices are: don't apply `20261111120000` to the hosted project while the
team still needs to approve customers there, **or** accept that approvals there stop and handle pending
requests by hand.

### Provisioning checklist for a new organization (by hand)

- create a new Supabase project;
- apply every migration (`supabase db push`);
- deploy the Edge Functions (`access-requests`, `add-user`, `update-user-email`, `send-email`,
  `delete-department`, `delete-sop`) with their secrets (`SNDR_API_KEY`, `SITE_URL`, …);
- create the frontend deployment with that project's URL and publishable key;
- create the approved contact as its first Admin and Super Admin (today: accept a request submitted on
  that deployment; after the change above: the owner-only bootstrap);
- the Super Admin adds Admins under Manage Organization → Admins.

## Applying the migration to an existing deployment

The migration **never chooses a Super Admin** for a deployment that already has Admins. An accepted
request doesn't prove who owns a deployment: in a mixed project it may be another organization's
contact. It only prints a warning with the counts. Until the project owner names one, every Admin keeps
working, but nobody can delete Admins or transfer the role.

### Read-only preflight (SQL Editor)

```sql
-- 1. The latest applied migrations (expect 20261110130000_admin_reads_published_sops on top).
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;

-- 2. Not applied yet (expect no rows, then null).
select proname from pg_proc where proname in ('get_super_admin_id', 'transfer_super_admin', 'deployment_onboarded');
select to_regclass('public.super_admin');

-- 3. Which organizations were accepted INTO this project. More than one organization: stop (see above).
select organization, count(*) as accepted, min(decided_at) as first, max(decided_at) as last
from public.access_requests where status = 'accepted' group by organization order by first;

-- 4. Requests that couldn't be accepted here any more after the migration.
select count(*) as pending_and_valid from public.access_requests
where status = 'pending' and review_expires_at > now();

-- 5. Every active Admin, their sign-in account, and the accepted request (if any) that created them.
select p.id, p.full_name, p.email, u.created_at as account_created, u.last_sign_in_at,
       u.banned_until, u.deleted_at as account_deleted,
       (select string_agg(r.organization || ' (' || r.decided_at::date || ')', '; ')
          from public.access_requests r where r.user_id = p.id and r.status = 'accepted') as accepted_request
from public.profiles p
join public.user_roles ur on ur.user_id = p.id and ur.role = 'admin'
join auth.users u on u.id = p.id
where p.deleted_at is null
order by u.created_at;

-- 6. Role anomalies (expect no rows): an Admin holding another role too.
select user_id, array_agg(role order by role) as roles from public.user_roles
group by user_id having bool_or(role = 'admin') and count(*) > 1;

-- 7. Accepted applicants who are no longer active Admins (informational).
select r.organization, r.email, r.user_id from public.access_requests r
left join public.profiles p on p.id = r.user_id and p.deleted_at is null
left join public.user_roles ur on ur.user_id = r.user_id and ur.role = 'admin'
where r.status = 'accepted' and (p.id is null or ur.user_id is null);
```

### Choosing the initial Super Admin

1. Run the preflight. If query 3 lists more than one organization, or query 6 returns rows, stop and
   resolve that first.
2. The project owner states in writing who is responsible for this deployment's organization. The person
   must appear in query 5 with no `banned_until` in the future and no `account_deleted`.
3. Never take an id from a guess, from "the oldest Admin" or from "the only accepted request". If no one
   in query 5 is clearly that person, don't assign anyone yet. Admins keep working without a Super Admin.
4. After the migration, as `postgres`: `select public.assign_initial_super_admin('<that id>');`. It
   refuses if a Super Admin already exists or the person isn't an active Admin. Since
   `20261116140000` it names the organization too:
   `select public.assign_initial_super_admin('<organization id>', '<that id>');`.

## Hosted project status and release plan

Status checked on 2026-11-10 (read-only, by calling each function anonymously: a missing function
answers 404 `PGRST202`, an existing one `42501` permission denied, so nothing runs). The hosted project
has every migration up to `20261110130000_admin_reads_published_sops.sql`, including Staff Management.
It doesn't have `20261111120000_super_admin.sql`: `get_super_admin_id`, `transfer_super_admin` and
`deployment_onboarded` are missing. That is why the Admins page there shows "The administrators couldn't
be loaded" (`POST /rest/v1/rpc/get_super_admin_id` returns 404). The Admins feature is **not live** until
the release below is done.

What the release needs:

| Item | What | Depends on |
|---|---|---|
| Migration | `20261111120000_super_admin.sql` (one transaction) | `can_manage_organization` (20261107120000), `organization_management_audit` (20261107120100), `lock_pending_access_request` (20261106130000), the Staff Management `check_new_user`, `save_user` and `set_user_email` (20261110120000) |
| Edge Function | `access-requests` (redeploy, with the migration) | the migration (`deployment_onboarded`) |
| Edge Functions | `add-user`, `update-user-email`: unchanged, no redeploy | the functions the migration replaces in place |
| Frontend | the build of `develop` | the migration |

Blocking decisions before the release: the Request Hawkim architecture above, and the initial Super
Admin (named in writing).

Order: backup check, preflight, migration, `access-requests`, initial Super Admin, frontend, smoke tests.
The migration is additive: it creates one table, new functions and three triggers, replaces `add_user`,
`set_user_email` and `accept_access_request`, and changes no existing row.

Backup check: the project's plan has daily backups or point-in-time recovery enabled, and the latest
backup is from today (Dashboard → Database → Backups). Note the time just before `db push`.

Release (only with the owner's approval):

```powershell
cd C:\Users\Dalal\Hawkim-latest
npx supabase login
npx supabase link --project-ref <project ref>
npx supabase migration list            # only 20261111120000 is local-only
npx supabase db push --dry-run         # lists only 20261111120000_super_admin.sql
npx supabase db push                   # expect the warning "No Super Admin assigned: …"
npx supabase functions deploy access-requests --no-verify-jwt
```

Then, as `postgres` in the SQL Editor, the named person: `select public.assign_initial_super_admin('<id>');`
(since `20261116140000`: `select public.assign_initial_super_admin('<organization id>', '<id>');`)

After it (read-only):

```sql
select user_id, assigned_at from public.super_admin;            -- exactly one row, the named person
-- since 20261116140000: select id, name, super_admin_id from public.organizations;
select proname, proacl from pg_proc where proname in
  ('get_super_admin_id', 'update_admin', 'delete_admin', 'transfer_super_admin', 'deployment_onboarded', 'assign_initial_super_admin');
-- get_super_admin_id, update_admin, delete_admin, transfer_super_admin: authenticated only;
-- deployment_onboarded: service_role only; assign_initial_super_admin: the owner only.
```

Smoke tests: as the Super Admin, the Admins page lists every Admin with the right badges, and the
sidebar and top bar say "Super Admin"; as a regular Admin, they say "Admin", there is no Delete or Make
Super Admin, and editing the Super Admin is refused; Staff still lists no administrators; an Admin can
still open every department's published SOPs; Staff, Divisions and Departments and SOP pages work as
before.

Going back: the migration has no rollback script. If something is wrong after it, fix forward with a new
migration, or restore the backup taken before it. Redeploying the previous frontend only takes the pages
away: the database rules stay in force (Staff can't grant or remove Admin, the Super Admin is protected,
the deployment accepts no Request Hawkim). Staff Management keeps working either way.

## Tests

- `supabase/tests/super_admin.sql`: every rule above as direct, hand-crafted calls. Local disposable
  database only; rolled back.
- `supabase/tests/super_admin_concurrency.local.mjs`: two real database sessions at once (simultaneous
  transfers, transfer versus deletion), authorization after a transfer and the audit records. Local stack
  only (`HAWKIM_DB_CONTAINER`); it moves the Super Admin to its own fixture during the run and gives it
  back, then deletes every fixture row.
- `supabase/tests/admins.browser.local.mjs`: Chrome end to end against a local stack, its Edge Functions
  and the dev server, plus direct API calls as a regular Admin. Instructions are at the top of the file.
- Frontend: `src/lib/adminAccess.test.ts`, `src/services/admins.test.ts`,
  `src/pages/admin/adminsPages.test.tsx` and `src/components/layout/adminShell.test.tsx` (sidebar).
