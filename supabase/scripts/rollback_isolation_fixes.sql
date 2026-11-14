-- Undoes supabase/migrations/20261117150000_isolation_fixes.sql: the functions as they were before it
-- (pg_get_functiondef). Run as the owner (postgres).
begin;

CREATE OR REPLACE FUNCTION public.check_co_author()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  sop public.sops;
  person public.profiles;
begin
  select * into sop from public.sops s where s.id = new.sop_id;
  select * into person from public.profiles p where p.id = new.user_id;
  if person.id is null or person.deleted_at is not null
     or not exists (select 1 from public.user_roles r where r.user_id = new.user_id and r.role = 'author') then
    raise exception 'A co-author must be an active Author' using errcode = 'check_violation';
  end if;
  if person.department_id is distinct from sop.department_id then
    raise exception 'A co-author must be from the SOP''s department' using errcode = 'check_violation';
  end if;
  if new.user_id = sop.author_id then
    raise exception 'The main author can''t also be a co-author' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.review_requests q where q.sop_id = new.sop_id and q.reviewer_id = new.user_id) then
    raise exception 'Reviewers and approvers cannot be co-authors' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_published_guideline_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.guideline_versions g where g.storage_path = p_path);
$function$;

CREATE OR REPLACE FUNCTION public.is_unused_guideline_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists (select 1 from public.guideline_versions g where g.storage_path = p_path)
     and not exists (select 1 from public.guideline_version_drafts d where d.storage_path = p_path);
$function$;

CREATE OR REPLACE FUNCTION public.is_unused_sop_upload_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists(select 1 from public.sop_versions where storage_path=p_path)
    and not exists(select 1 from public.department_file_deletion_items where storage_path=p_path);
$function$;

notify pgrst, 'reload schema';
commit;
