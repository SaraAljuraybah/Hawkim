# Manage Organization → Admins (Super Admin and Admin)

Hawkim is **single-tenant: one organization per deployment**. Each organization has its own Hawkim
deployment (frontend + its own Supabase project, Auth and storage). "The organization" is therefore the
whole database, and there is no organization id.

## Roles

Both levels hold the one existing role, `admin` (`user_roles`). Every admin-only function, policy and
route keeps working for both. The **Super Admin** is a designation on top of it: the single row of
`public.super_admin` names one active Admin.

| Action | Super Admin | Admin |
|---|---|---|
| View Admins | Yes | Yes |
| Add a regular Admin | Yes | Yes |
| Edit a regular Admin (or themselves) | Yes | Yes |
| Edit the Super Admin | Themselves only | No |
| Delete a regular Admin | Yes | No |
| Make Super Admin (transfer) | Yes | No |
| Delete the Super Admin | No (transfer first) | No |
| Staff, Divisions & Departments, everything else | Full | Full |

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
sign-in account was created.

## Tests

- `supabase/tests/super_admin.sql`: every rule above as direct, hand-crafted calls. Local disposable
  database only; rolled back.
- `supabase/tests/admins.browser.local.mjs`: Chrome end to end against a local stack, its Edge Functions
  and the dev server, plus direct API calls as a regular Admin. Instructions are at the top of the file.
- Frontend: `src/lib/adminAccess.test.ts`, `src/services/admins.test.ts`,
  `src/pages/admin/adminsPages.test.tsx` and `src/components/layout/adminShell.test.tsx` (sidebar).
