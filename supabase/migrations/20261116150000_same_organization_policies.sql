-- Multi-tenant, step 3: every table's rows stay within the caller's organization.
--
-- One RESTRICTIVE policy, "Same organization only", on every table that holds an organization's data
-- (the 26 tables with organization_id, and organizations itself by its id). A restrictive policy is
-- ANDed with every permissive one, so all the existing read policies (and any added later) only ever
-- return the caller's organization's rows, whatever else they allow. It is FOR ALL and TO PUBLIC, so it
-- also limits inserts, updates and deletes (WITH CHECK), for every API role, in case a table is granted
-- more than it is today (e.g. the hosted project's default grants).
--
-- The caller's organization is current_organization_id(): that of their active profile, or null, which
-- matches no row (anonymous callers, people without a profile and deleted profiles see nothing). It is
-- now also granted to anon, so a policy check for an anonymous request returns no rows instead of a
-- permission error.
--
-- Not changed here: the functions, which run as their owner (who isn't subject to these policies) and
-- are scoped one by one in the next migrations; storage (its own step); compliance_service_status (the
-- one worker's heartbeat, the same for everyone) and sop_code_counter (replaced by a per-organization
-- counter when SOP codes are numbered per organization).
--
-- Undo: supabase/scripts/rollback_same_organization_policies.sql

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'departments', 'divisions', 'profiles', 'user_roles', 'employee_positions', 'user_invitations',
    'admin_profile_backup', 'sops', 'sop_versions', 'sop_co_authors', 'timeline_events', 'review_rounds',
    'review_requests', 'sop_comments', 'compliance_checks', 'compliance_findings', 'guideline_versions',
    'guideline_requirements', 'sample_findings', 'guideline_version_drafts', 'guideline_draft_requirements',
    'organization_management_audit', 'department_file_deletions', 'department_file_deletion_items',
    'ampersand_name_changes', 'access_requests'
  ] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception 'Row-level security is off on %', t;
    end if;
    execute pg_catalog.format(
      'create policy "Same organization only" on public.%I as restrictive for all to public '
      'using (organization_id = (select public.current_organization_id())) '
      'with check (organization_id = (select public.current_organization_id()))', t);
  end loop;
end;
$$;

create policy "Same organization only" on public.organizations as restrictive for all to public
  using (id = (select public.current_organization_id()))
  with check (id = (select public.current_organization_id()));

-- Every table with organization_id has the policy (a table added without it fails here).
do $$
begin
  if exists (
    select 1 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'Same organization only' and not p.polpermissive)
  ) then
    raise exception 'A table with organization_id has no "Same organization only" policy';
  end if;
end;
$$;

grant execute on function public.current_organization_id() to anon;

notify pgrst, 'reload schema';
commit;
