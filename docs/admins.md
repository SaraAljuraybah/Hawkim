# Manage Organization → Admins (Super Admin and Admin)

Hawkim is **single-tenant: one organization per deployment**. Each organization has its own Hawkim
deployment (frontend + its own Supabase project, Auth and storage). "The organization" is therefore the
whole database, and there is no organization id.

## Roles

Hawkim has exactly two administrator roles: **Super Admin** and **Admin**. There is no third one.

Both levels hold the one existing role, `admin` (`user_roles`). Every admin-only function, policy and
route keeps working for both. The **Super Admin** is a designation on top of it: the single row of
`public.super_admin` names one active Admin.

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

1. The organization submits **Request Hawkim**; the Hawkim team gets the review email.
2. **Provision a dedicated deployment.** There is no automatic provisioning in this repository; it is done
   by hand:
   - create a new Supabase project;
   - apply every migration (`supabase db push`);
   - deploy the Edge Functions (`access-requests`, `add-user`, `update-user-email`, `send-email`,
     `delete-department`, `delete-sop`) with their secrets (`SNDR_API_KEY`, `SITE_URL`, …);
   - create the frontend deployment with that project's URL and publishable key.
3. **Accept the request on that new deployment.** Its review link (from its own `access-requests`
   function) creates the applicant's account. The applicant becomes the organization's **Super Admin**.
4. The Super Admin adds Admins under Manage Organization → Admins.

A deployment that already has an Admin refuses to accept any request (`deployment_onboarded`), so a
second organization is never created inside an existing deployment. The review page tells the Hawkim
team to set up a separate deployment.

## Applying the migration to an existing deployment

The migration assigns a Super Admin only when this is unambiguous: **exactly one accepted Request Hawkim
whose applicant is still an active Admin**. Otherwise it assigns no one and prints a warning. Until a
Super Admin is assigned, every Admin keeps working, but nobody can delete Admins or transfer the role.

Before applying it to a hosted project, check what it will do (read-only):

```sql
select r.user_id, p.full_name, p.email, r.decided_at
from public.access_requests r join public.profiles p on p.id = r.user_id
where r.status = 'accepted' and p.deleted_at is null;
select count(*) from public.user_roles r join public.profiles p on p.id = r.user_id and p.deleted_at is null where r.role = 'admin';
```

If no Super Admin was assigned, the project owner names one explicitly, as `postgres`:

```sql
select public.assign_initial_super_admin('<user id>');
```

Deploy the `access-requests` Edge Function together with the migration. It checks `deployment_onboarded`
before creating any account. Without it, the database still refuses the acceptance, but only after the
sign-in account was created. Deploy it either with the CLI (`index.ts`) or by pasting
`access-requests-single-file.ts` into the dashboard editor; both files behave the same.

**After the migration, a deployment that already has an Admin accepts no Request Hawkim.** Requests can
still be submitted there, but Accept answers `409 deployment_onboarded`. New organizations are accepted
on their own, new deployment (see above).

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
| Edge Function | `access-requests` (redeploy) | the migration (`deployment_onboarded`) |
| Edge Functions | `add-user`, `update-user-email`: unchanged, no redeploy | the functions the migration replaces in place |
| Frontend | the build of `develop` | the migration |

Order: preflight, migration, `access-requests`, initial Super Admin (only if the migration didn't assign
one), frontend, smoke tests. The migration is additive: it creates one table, new functions and three
triggers, replaces `add_user`, `set_user_email` and `accept_access_request`, and changes no existing row
(it may insert the one `super_admin` row).

Preflight (read-only, SQL Editor):

```sql
-- 1. The latest applied migrations (expect 20261110130000 on top).
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
-- 2. Not applied yet (expect no rows, then null).
select proname from pg_proc where proname in ('get_super_admin_id', 'transfer_super_admin', 'deployment_onboarded');
select to_regclass('public.super_admin');
-- 3. Whom the migration would make Super Admin: it assigns one only if this returns exactly one person.
select distinct r.user_id, p.full_name, p.email, r.decided_at
from public.access_requests r join public.profiles p on p.id = r.user_id
join public.user_roles ur on ur.user_id = p.id and ur.role = 'admin'
where r.status = 'accepted' and p.deleted_at is null;
-- 4. The active Admins (one of them becomes Super Admin).
select p.id, p.full_name, p.email from public.profiles p
join public.user_roles r on r.user_id = p.id and r.role = 'admin' where p.deleted_at is null order by p.full_name;
```

If query 3 doesn't return exactly the person who should be Super Admin, the project owner decides who it
is before the release, and runs `select public.assign_initial_super_admin('<user id>');` (as `postgres`)
right after the migration. Never guess the id.

Release (only with the owner's approval, after a backup or with point-in-time recovery confirmed):

```powershell
cd C:\Users\Dalal\Hawkim-latest
npx supabase login
npx supabase link --project-ref <project ref>
npx supabase migration list            # only 20261111120000 is local-only
npx supabase db push --dry-run         # lists only 20261111120000_super_admin.sql
npx supabase db push
npx supabase functions deploy access-requests --no-verify-jwt
```

After it (read-only):

```sql
select user_id, assigned_at from public.super_admin;            -- exactly one row
select proname, proacl from pg_proc where proname in
  ('get_super_admin_id', 'update_admin', 'delete_admin', 'transfer_super_admin', 'deployment_onboarded', 'assign_initial_super_admin');
-- get_super_admin_id, update_admin, delete_admin, transfer_super_admin: authenticated only;
-- deployment_onboarded: service_role only; assign_initial_super_admin: the owner only.
```

Smoke tests: as the Super Admin, the Admins page lists every Admin with the right badges, and the
sidebar and top bar say "Super Admin"; as a regular Admin, they say "Admin", there is no Delete or Make
Super Admin, and editing the Super Admin is refused; Staff still lists no administrators; an Admin can
still open every department's published SOPs.

Going back: the migration has no rollback script. If something is wrong after it, fix forward with a new
migration. Redeploying the previous frontend only takes the pages away: the database rules stay in force
(Staff can't grant or remove Admin, the Super Admin is protected, the deployment accepts no Request
Hawkim). Staff Management keeps working either way.

## Tests

- `supabase/tests/super_admin.sql`: every rule above as direct, hand-crafted calls. Local disposable
  database only; rolled back.
- `supabase/tests/admins.browser.local.mjs`: Chrome end to end against a local stack, its Edge Functions
  and the dev server, plus direct API calls as a regular Admin. Instructions are at the top of the file.
- Frontend: `src/lib/adminAccess.test.ts`, `src/services/admins.test.ts`,
  `src/pages/admin/adminsPages.test.tsx` and `src/components/layout/adminShell.test.tsx` (sidebar).
