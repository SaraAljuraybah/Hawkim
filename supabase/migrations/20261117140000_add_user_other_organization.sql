-- Multi-tenant, step 14: Add Staff and Add Admin never touch another organization's person.
--
-- The add-user Edge Function calls check_new_user first, then finds or creates the sign-in account, gives an
-- existing account a new random password (only the emailed link opens it), and only then calls add_user. Its
-- own profile check reads as the calling Admin, who can't see another organization's profiles, so for the
-- email of another organization's DEACTIVATED person it went on to replace that person's password before
-- add_user refused the email (since 20261116160000). check_new_user now refuses that email first, as
-- "email taken", the same as for an active person: nothing in Auth is touched.
-- check_new_user is its LATEST definition (pg_get_functiondef) with only this check added.
--
-- Undo: supabase/scripts/rollback_add_user_other_organization.sql

begin;

CREATE OR REPLACE FUNCTION public.check_new_user(p_email text, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  quality boolean;
  system_admin boolean := p_roles is not null and 'admin' = any (p_roles);
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_email is null or p_email <> lower(btrim(p_email)) or char_length(p_email) > 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 100
    or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$'
    or (not system_admin and char_length(btrim(coalesce(p_position, ''))) not between 1 and 100)
    or (not system_admin and p_department_id is null) or p_roles is null
    or not p_roles <@ array['author', 'reviewer', 'approver', 'admin'] then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;
  if exists (select 1 from public.profiles p where p.email = p_email and p.deleted_at is null) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  -- One account belongs to one organization: the email of another organization's person, active or
  -- deactivated, is taken too (so add-user never touches that person's sign-in account).
  if exists (select 1 from public.profiles p where p.email = p_email
             and p.organization_id is distinct from public.current_organization_id()) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  if system_admin and cardinality(p_roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514', hint = 'admin-exclusive';
  end if;
  if system_admin then return; end if;
  select d.is_quality into quality from public.departments d
  where d.id = p_department_id and d.organization_id = public.current_organization_id()
    and d.removed_at is null and d.deletion_job_id is null;
  if not found then
    raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
  end if;
  if 'approver' = any (p_roles) and not quality then
    raise exception 'Approver is only allowed in the Quality department' using errcode = '23514', hint = 'approver-quality';
  end if;
end;
$function$;

notify pgrst, 'reload schema';
commit;
