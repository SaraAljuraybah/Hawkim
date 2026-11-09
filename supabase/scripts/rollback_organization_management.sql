-- Undo 20261107120300_employee_positions.sql, 20261107120200_department_storage_cleanup.sql,
-- 20261107120100_divisions_departments_management.sql and 20261107120000_organization_admin_authorization.sql
-- (newest first), back to develop's schema. Roll the frontend back first.
--
-- REFUSES (and changes nothing) once the features hold data that a rollback would lose or expose:
-- SOPs deleted or moved to Others by a department deletion (dropping sops.deleted_at would show
-- retained SOPs again) or department deletion jobs. Departments that were removed stay removed (develop
-- has removed_at too) and keep their division_id cleared. Positions,
-- division emails and the management audit trail are dropped: export them first if they are needed.
-- The migration-ledger rows are removed with `supabase migration repair --status reverted` afterwards.
-- Run as one transaction.

begin;

do $$
begin
  if exists (select 1 from public.sops where deleted_at is not null or directory_group <> 'department')
    or exists (select 1 from public.department_file_deletions) then
    raise exception 'Department deletions have already retained or moved SOPs; a rollback would expose or lose them. Stop.';
  end if;
end;
$$;

-- ---------- 20261107120300 ----------
drop function if exists public.get_divisions_departments();
drop function if exists public.set_employee_positions(uuid, text[]);
drop trigger if exists profiles_require_position on public.profiles;
drop trigger if exists profiles_sync_positions on public.profiles;
drop table if exists public.employee_positions;
drop function if exists public.require_profile_position(), public.require_remaining_position(),
  public.assert_employee_has_position(uuid), public.sync_profile_positions(), public.guard_employee_position();

-- ---------- 20261107120200 ----------
drop policy if exists "Previously owned SOP paths cannot be reused" on storage.objects;
drop function if exists public.is_unused_sop_upload_path(text), public.delete_department(text, text, timestamptz),
  public.ack_department_file_deletion(uuid, uuid, text[], boolean), public.department_file_paths_present(uuid, text[]),
  public.claim_department_file_deletion(uuid), public.get_department_file_deletion(uuid),
  public.begin_department_file_deletion(text, timestamptz);
drop trigger if exists departments_pending_edit on public.departments;
drop function if exists public.guard_pending_department_edit();
alter table public.departments drop column if exists deletion_job_id;
drop table if exists public.department_file_deletion_items;
drop table if exists public.department_file_deletions;

-- ---------- 20261107120100 ----------
do $$
declare target text;
begin
  foreach target in array array['sop_versions','sop_co_authors','review_rounds','review_requests','compliance_checks','sop_comments','timeline_events'] loop
    execute format('drop trigger if exists retained_sop_guard on public.%I', target);
  end loop;
end;
$$;
drop trigger if exists sops_retained_delete_guard on public.sops;
drop trigger if exists sops_deleted_guard on public.sops;
drop function if exists public.guard_retained_sop_delete(), public.guard_deleted_sop_update(), public.guard_retained_sop();

-- develop's bodies (20261102130000_other_department_reviewers.sql).
create or replace function public.can_view_sop(p_sop_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
            and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$$;
create or replace function public.can_view_version(p_sop_id uuid, p_version integer) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (
          select 1 from public.review_requests q
          join public.review_rounds r on r.id = q.round_id
          where q.sop_id = s.id and q.reviewer_id = p.id and r.version = p_version
        ) and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$$;

drop function if exists public.save_department(text, text, text, text, text, timestamptz),
  public.delete_division(text, timestamptz), public.save_division(text, text, text, text, timestamptz);
drop table if exists public.organization_management_audit;
drop trigger if exists sops_active_department on public.sops;
drop trigger if exists profiles_active_department on public.profiles;
drop function if exists public.guard_active_department();
drop trigger if exists divisions_management_validation on public.divisions;
drop function if exists public.validate_division_management();
drop index if exists public.sops_live_department;
alter table public.sops drop column if exists directory_group;
alter table public.sops drop column if exists deleted_at;
alter table public.departments drop column if exists updated_at;
alter table public.divisions drop column if exists email;
-- develop's table-wide grant (20261104130000_reconcile_organizational_structure.sql).
revoke select on public.divisions from authenticated;
grant select on public.divisions to authenticated;

-- ---------- 20261107120000 ----------
drop function if exists public.can_manage_organization();

notify pgrst, 'reload schema';
commit;
