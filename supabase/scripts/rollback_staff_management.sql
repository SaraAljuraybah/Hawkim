-- Undoes 20261110120000_staff_management.sql. Deploy a frontend and Edge Functions without it first.
-- save_user, add_user and check_new_user go back to their 20261107140000 / 20261107150000 versions:
-- re-run those two migration bodies' CREATE statements as CREATE OR REPLACE after this script.
-- Restoring NOT NULL fails while a System Admin has no department: give them one first.
begin;
drop trigger if exists profiles_department_transfer_guard on public.profiles;
drop trigger if exists sops_lock_author on public.sops;
drop trigger if exists sops_lock_approvers on public.sops;
drop trigger if exists sop_co_authors_a_lock_assignee on public.sop_co_authors;
drop trigger if exists review_requests_lock_assignee on public.review_requests;
drop trigger if exists profiles_require_department on public.profiles;
drop trigger if exists user_roles_require_department on public.user_roles;
drop function if exists public.guard_department_transfer();
drop function if exists public.assert_department_transfer_allowed(uuid);
drop function if exists public.lock_sop_assignee();
drop function if exists public.lock_sop_approvers();
drop function if exists public.sop_responsibilities_in_progress(uuid);
drop function if exists public.require_profile_department();
drop function if exists public.require_role_department();
drop function if exists public.assert_staff_has_department(uuid);
drop function if exists public.set_user_email(uuid, text, boolean);
drop trigger if exists profiles_active_department on public.profiles;
create trigger profiles_active_department before insert or update of department_id on public.profiles
for each row execute function public.guard_active_department();
alter table public.profiles alter column department_id set not null;
notify pgrst, 'reload schema';
commit;
