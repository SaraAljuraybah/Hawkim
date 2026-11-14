-- Multi-tenant, step 17: what the isolation test (supabase/tests/multi_tenant_isolation.sql) found.
--
-- Called by another organization with that organization's real ids, these answered differently than for
-- ids that don't exist, so they told whether something of another organization exists:
--   check_co_author  (add_co_authors with another organization's person) "must be from the SOP's department"
--                    instead of "must be an active Author"
--   is_published_guideline_path, is_unused_guideline_path, is_unused_sop_upload_path  (used by the storage
--                    policies) true or false for another organization's stored file
-- Now another organization's person is an unknown one, and a path outside the caller's organization's folder
-- gets the same answer whether it exists or not. The storage policies already refuse those paths (the
-- "Organization folder only" policy), so nothing else changes. Each function is its LATEST definition
-- (pg_get_functiondef) with only the change named above it.
--
-- Undo: supabase/scripts/rollback_isolation_fixes.sql

begin;

-- check_co_author: a person of another organization is answered as an unknown one ("must be an active Author"), not "must be from the SOP's department".
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
  select * into person from public.profiles p where p.id = new.user_id and p.organization_id = sop.organization_id;
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

-- is_published_guideline_path: only a path in the caller's organization's folder can be published (any other: false, as for an unknown one).
CREATE OR REPLACE FUNCTION public.is_published_guideline_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_path like public.current_organization_id()::text || '/%'
    and exists (select 1 from public.guideline_versions g where g.storage_path = p_path);
$function$;

-- is_unused_guideline_path: only a path in the caller's organization's folder can be unused (any other: false, whether a version uses it or not).
CREATE OR REPLACE FUNCTION public.is_unused_guideline_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_path like public.current_organization_id()::text || '/%'
     and not exists (select 1 from public.guideline_versions g where g.storage_path = p_path)
     and not exists (select 1 from public.guideline_version_drafts d where d.storage_path = p_path);
$function$;

-- is_unused_sop_upload_path: as is_unused_guideline_path, for SOP files.
CREATE OR REPLACE FUNCTION public.is_unused_sop_upload_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_path like public.current_organization_id()::text || '/%'
    and not exists(select 1 from public.sop_versions where storage_path=p_path)
    and not exists(select 1 from public.department_file_deletion_items where storage_path=p_path);
$function$;

notify pgrst, 'reload schema';
commit;
