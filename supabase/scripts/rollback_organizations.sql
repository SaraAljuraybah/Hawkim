-- Undoes supabase/migrations/20261116120000_organizations.sql. Run as the owner (postgres).
-- Only while MedCare is the only organization: with a second organization its data would lose the
-- organization it belongs to, so the script refuses. organization_settings, super_admin and
-- sop_code_counter still hold their values after that migration, so nothing else needs restoring.
begin;

do $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'More than one organization exists; this rollback would mix their data';
  end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'departments', 'divisions', 'profiles', 'user_roles', 'employee_positions', 'user_invitations',
    'admin_profile_backup', 'sops', 'sop_versions', 'sop_co_authors', 'timeline_events', 'review_rounds',
    'review_requests', 'sop_comments', 'compliance_checks', 'compliance_findings', 'guideline_versions',
    'guideline_requirements', 'sample_findings', 'guideline_version_drafts', 'guideline_draft_requirements',
    'organization_management_audit', 'department_file_deletions', 'department_file_deletion_items',
    'ampersand_name_changes'
  ] loop
    execute format('drop trigger if exists a0_organization on public.%I', t);
  end loop;
end;
$$;

-- The links back to their single-column foreign keys, with the same name, delete rule and timing (the
-- migration replaced each one in place). Dropping organization_id with cascade would otherwise drop them
-- for good. organizations_super_admin_id_fkey goes with the organizations table.
do $$
declare
  fk record;
  def text;
  n integer := 0;
begin
  for fk in
    select c.conrelid::regclass::text as tbl, c.conname, pg_catalog.pg_get_constraintdef(c.oid) as definition
    from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid <> 'public.organizations'::regclass
      and pg_catalog.pg_get_constraintdef(c.oid) ~ '^FOREIGN KEY \(organization_id, \w+\)'
  loop
    def := pg_catalog.regexp_replace(fk.definition,
      '^FOREIGN KEY \(organization_id, (\w+)\) REFERENCES ([\w.]+)\(organization_id, id\)', 'FOREIGN KEY (\1) REFERENCES \2(id)');
    if def = fk.definition then
      raise exception 'Unexpected foreign key definition on %: %', fk.conname, fk.definition;
    end if;
    execute pg_catalog.format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    execute pg_catalog.format('alter table %s add constraint %I %s', fk.tbl, fk.conname, def);
    n := n + 1;
  end loop;
  if n <> 48 then
    raise exception 'Expected the 48 foreign keys of 20261116120000, found %', n;
  end if;
end;
$$;

do $$
declare t text;
begin
  -- Dropping the column also drops the composite keys built on it.
  foreach t in array array[
    'departments', 'divisions', 'profiles', 'user_roles', 'employee_positions', 'user_invitations',
    'admin_profile_backup', 'sops', 'sop_versions', 'sop_co_authors', 'timeline_events', 'review_rounds',
    'review_requests', 'sop_comments', 'compliance_checks', 'compliance_findings', 'guideline_versions',
    'guideline_requirements', 'sample_findings', 'guideline_version_drafts', 'guideline_draft_requirements',
    'organization_management_audit', 'department_file_deletions', 'department_file_deletion_items',
    'ampersand_name_changes', 'access_requests'
  ] loop
    execute format('alter table public.%I drop column if exists organization_id cascade', t);
  end loop;
end;
$$;

drop table public.organizations;
drop function public.set_row_organization();
drop function public.only_organization_id();
drop function public.current_organization_id();

notify pgrst, 'reload schema';
commit;
