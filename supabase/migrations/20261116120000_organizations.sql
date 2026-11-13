-- Multi-tenant, step 1: organizations, and every existing row moved into the organization "MedCare".
--
-- Hawkim becomes multi-tenant: one shared database, many organizations. This migration only adds the
-- data model; the functions, policies and storage paths are scoped in the migrations after it.
--
-- 1. public.organizations: one row per organization. It has the columns of organization_settings (the
--    name and the Organization Profile), the Super Admin (replacing the super_admin singleton) and the
--    last SOP number (replacing the sop_code_counter singleton). The next migration moves the functions
--    onto it and drops the singletons; until then they are copied, not removed.
-- 2. The existing organization: "MedCare". Its name is the one saved in organization_settings, or
--    "MedCare" when none is saved. Its Super Admin, SOP counter and profile come from the singletons.
--    The next migration copies the Super Admin and the SOP counter again just before it drops the
--    singletons, so a change made between the two migrations (e.g. by the local seed) isn't lost.
--    On a new, empty database the row is created too, so the seed data belongs to it.
-- 3. organization_id on every table that holds an organization's data (26 tables). Existing rows get
--    MedCare's id through a column default that is dropped right after, so no row is rewritten and no
--    trigger runs on existing rows. access_requests gets a nullable column: a request exists before its
--    organization; accepted requests get MedCare.
-- 4. Rows can't point to another organization's rows: each parent gets unique (organization_id, id) and
--    each link's foreign key becomes composite, (organization_id, <column>) → parent (organization_id, id),
--    keeping its name and delete rule (the API's embeds rely on one relationship per link and its name).
-- 5. The database sets organization_id, never the browser (trigger a0_organization on every table):
--    - Rows that belong to another row (an SOP's versions, a check's findings, a person's roles, ...)
--      always take their parent's organization, whatever value was sent.
--    - Rows that start an organization's data (profiles, departments, divisions, GVP versions and added
--      versions): for a signed-in API caller always the caller's organization (current_organization_id());
--      for the service role and the owner the value the function set.
--    - TRANSITIONAL: when a service-role or owner insert sets no organization and the database has
--      exactly one organization, that one is used (only_organization_id()). It keeps the not-yet-scoped
--      service functions working while MedCare is the only organization, and is removed once every
--      function sets the organization itself. With two organizations it returns null and the insert fails.
--    - organization_id never changes after insert.
-- 6. A check at the end: every table has as many rows as before and none without an organization.
--
-- Undo (only while MedCare is the only organization): supabase/scripts/rollback_organizations.sql

begin;

-- ---------- 1. Organizations ----------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  -- As organization_settings.name.
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 200 and name !~ '[[:cntrl:]]'
  ),
  -- As the Organization Profile columns of organization_settings.
  email text check (email is null or (
    email = pg_catalog.btrim(email) and pg_catalog.char_length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  description text check (description is null or (
    description = pg_catalog.btrim(description) and pg_catalog.char_length(description) between 1 and 1000)),
  address text check (address is null or (
    address = pg_catalog.btrim(address) and pg_catalog.char_length(address) between 1 and 300 and address !~ '[[:cntrl:]]')),
  maps_url text check (maps_url is null or (
    pg_catalog.char_length(maps_url) <= 2048 and maps_url ~* '^https?://[^[:space:]/?#]+[.][^[:space:]]*$')),
  website text check (website is null or (
    pg_catalog.char_length(website) <= 2048 and website ~* '^https?://[^[:space:]/?#]+[.][^[:space:]]*$')),
  -- The organization's Super Admin (null until one is assigned). Linked below, once profiles has organization_id.
  super_admin_id uuid unique,
  super_admin_assigned_at timestamptz,
  -- The last SOP number used in this organization (SOP-001, SOP-002, ...).
  last_sop_number integer not null default 0 check (last_sop_number >= 0),
  -- The Request Hawkim request that created the organization (null for MedCare if none is known).
  access_request_id uuid unique references public.access_requests (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Who last saved the name or profile.
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.organizations enable row level security;
-- No policies and no grants: read and changed only through functions.
revoke all on table public.organizations from public, anon, authenticated, service_role;

-- MedCare: everything that exists today.
insert into public.organizations (name, email, description, address, maps_url, website, super_admin_id,
  super_admin_assigned_at, last_sop_number, updated_at, updated_by)
select
  coalesce(nullif(pg_catalog.btrim(s.name), ''), 'MedCare'),
  s.email, s.description, s.address, s.maps_url, s.website,
  sa.user_id, sa.assigned_at,
  coalesce((select c.last_number from public.sop_code_counter c where c.id), 0),
  coalesce(s.updated_at, now()), s.updated_by
from (select 1) one
left join public.organization_settings s on s.singleton
left join public.super_admin sa on sa.singleton;

-- ---------- 2. Row counts before (checked at the end) ----------

create temporary table organization_row_counts (table_name text primary key, n_before bigint, n_after bigint) on commit drop;

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
    execute pg_catalog.format('insert into organization_row_counts (table_name, n_before) select %L, count(*) from public.%I', t, t);
  end loop;
end;
$$;

-- ---------- 3. organization_id on every table ----------

do $$
declare
  medcare uuid := (select o.id from public.organizations o);
  t text;
begin
  foreach t in array array[
    'departments', 'divisions', 'profiles', 'user_roles', 'employee_positions', 'user_invitations',
    'admin_profile_backup', 'sops', 'sop_versions', 'sop_co_authors', 'timeline_events', 'review_rounds',
    'review_requests', 'sop_comments', 'compliance_checks', 'compliance_findings', 'guideline_versions',
    'guideline_requirements', 'sample_findings', 'guideline_version_drafts', 'guideline_draft_requirements',
    'organization_management_audit', 'department_file_deletions', 'department_file_deletion_items',
    'ampersand_name_changes'
  ] loop
    -- The default fills the existing rows without rewriting them or firing their triggers; it is dropped
    -- at once, so new rows get their organization only from the trigger below.
    execute pg_catalog.format(
      'alter table public.%I add column organization_id uuid not null default %L references public.organizations (id)',
      t, medcare);
    execute pg_catalog.format('alter table public.%I alter column organization_id drop default', t);
  end loop;
end;
$$;

-- A request belongs to an organization only once it is accepted.
alter table public.access_requests add column organization_id uuid references public.organizations (id);
update public.access_requests r set organization_id = (select o.id from public.organizations o)
where r.status = 'accepted';
-- MedCare's own request: the accepted request of its Super Admin, when there is exactly one.
update public.organizations o set access_request_id = (
  select r.id from public.access_requests r where r.status = 'accepted' and r.user_id = o.super_admin_id
)
where o.super_admin_id is not null
  and (select count(*) from public.access_requests r where r.status = 'accepted' and r.user_id = o.super_admin_id) = 1;

-- ---------- 4. Rows only point to rows of their own organization ----------

-- The parents: (organization_id, id) is unique, so composite foreign keys can point to it.
alter table public.profiles add constraint profiles_organization_id_id_key unique (organization_id, id);
alter table public.departments add constraint departments_organization_id_id_key unique (organization_id, id);
alter table public.divisions add constraint divisions_organization_id_id_key unique (organization_id, id);
alter table public.sops add constraint sops_organization_id_id_key unique (organization_id, id);
alter table public.review_rounds add constraint review_rounds_organization_id_id_key unique (organization_id, id);
alter table public.review_requests add constraint review_requests_organization_id_id_key unique (organization_id, id);
alter table public.sop_comments add constraint sop_comments_organization_id_id_key unique (organization_id, id);
alter table public.compliance_checks add constraint compliance_checks_organization_id_id_key unique (organization_id, id);
alter table public.guideline_versions add constraint guideline_versions_organization_id_id_key unique (organization_id, id);
alter table public.guideline_requirements add constraint guideline_requirements_organization_id_id_key unique (organization_id, id);
alter table public.guideline_version_drafts add constraint guideline_version_drafts_organization_id_id_key unique (organization_id, id);
alter table public.department_file_deletions add constraint department_file_deletions_organization_id_id_key unique (organization_id, id);

-- The links. Each existing single-column foreign key is replaced by its composite version, with the
-- same name, delete rule and timing: one relationship per link, so the API's embeds (and their
-- !<constraint name> hints) keep working. A null link isn't checked (MATCH SIMPLE), as before.
do $$
declare
  link text[];
  fk record;
  def text;
begin
  foreach link slice 1 in array array[
    -- child table, column, parent table
    ['profiles', 'department_id', 'departments'],
    ['departments', 'division_id', 'divisions'],
    ['departments', 'deletion_job_id', 'department_file_deletions'],
    ['user_roles', 'user_id', 'profiles'],
    ['employee_positions', 'profile_id', 'profiles'],
    ['employee_positions', 'department_id', 'departments'],
    ['user_invitations', 'user_id', 'profiles'],
    ['admin_profile_backup', 'profile_id', 'profiles'],
    ['sops', 'department_id', 'departments'],
    ['sops', 'author_id', 'profiles'],
    ['sop_versions', 'sop_id', 'sops'],
    ['sop_versions', 'uploaded_by', 'profiles'],
    ['sop_versions', 'deleted_by', 'profiles'],
    ['sop_co_authors', 'sop_id', 'sops'],
    ['sop_co_authors', 'user_id', 'profiles'],
    ['sop_co_authors', 'added_by', 'profiles'],
    ['timeline_events', 'sop_id', 'sops'],
    ['timeline_events', 'actor_id', 'profiles'],
    ['timeline_events', 'subject_id', 'profiles'],
    ['timeline_events', 'review_round_id', 'review_rounds'],
    ['timeline_events', 'review_request_id', 'review_requests'],
    ['timeline_events', 'comment_id', 'sop_comments'],
    ['review_rounds', 'sop_id', 'sops'],
    ['review_rounds', 'requested_by', 'profiles'],
    ['review_requests', 'round_id', 'review_rounds'],
    ['review_requests', 'sop_id', 'sops'],
    ['review_requests', 'reviewer_id', 'profiles'],
    ['review_requests', 'removed_by', 'profiles'],
    ['review_requests', 'comment_id', 'sop_comments'],
    ['sop_comments', 'sop_id', 'sops'],
    ['sop_comments', 'author_id', 'profiles'],
    ['sop_comments', 'review_round_id', 'review_rounds'],
    ['sop_comments', 'review_request_id', 'review_requests'],
    ['compliance_checks', 'sop_id', 'sops'],
    ['compliance_checks', 'guideline_version_id', 'guideline_versions'],
    ['compliance_checks', 'triggered_by', 'profiles'],
    ['compliance_findings', 'check_id', 'compliance_checks'],
    ['compliance_findings', 'requirement_id', 'guideline_requirements'],
    ['guideline_versions', 'added_by', 'profiles'],
    ['guideline_requirements', 'guideline_version_id', 'guideline_versions'],
    ['sample_findings', 'guideline_version_id', 'guideline_versions'],
    ['sample_findings', 'requirement_id', 'guideline_requirements'],
    ['guideline_version_drafts', 'created_by', 'profiles'],
    ['guideline_draft_requirements', 'draft_id', 'guideline_version_drafts'],
    ['organization_management_audit', 'actor_id', 'profiles'],
    ['department_file_deletions', 'department_id', 'departments'],
    ['department_file_deletions', 'requested_by', 'profiles'],
    ['department_file_deletion_items', 'job_id', 'department_file_deletions']
  ] loop
    select c.conname, pg_catalog.pg_get_constraintdef(c.oid) as definition into fk
    from pg_catalog.pg_constraint c
    where c.conrelid = ('public.' || link[1])::regclass and c.contype = 'f'
      and c.confrelid = ('public.' || link[3])::regclass
      and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
                            where a.attrelid = ('public.' || link[1])::regclass and a.attname = link[2])];
    if not found then
      raise exception 'Expected one foreign key %.% → %', link[1], link[2], link[3];
    end if;
    -- SET NULL would also clear organization_id; none of these links uses it.
    if fk.definition ~* 'set null|set default' then
      raise exception 'Unexpected delete rule on %: %', fk.conname, fk.definition;
    end if;
    def := pg_catalog.regexp_replace(fk.definition,
      '^FOREIGN KEY \((\w+)\) REFERENCES ([\w.]+)\(id\)', 'FOREIGN KEY (organization_id, \1) REFERENCES \2(organization_id, id)');
    if def = fk.definition then
      raise exception 'Unexpected foreign key definition on %: %', fk.conname, fk.definition;
    end if;
    execute pg_catalog.format('alter table public.%I drop constraint %I', link[1], fk.conname);
    execute pg_catalog.format('alter table public.%I add constraint %I %s', link[1], fk.conname, def);
  end loop;
end;
$$;

-- departments and divisions are readable column by column (divisions.email stays private). The API's
-- embed departments → divisions (division:divisions(name)) now joins on organization_id too, so it must
-- be readable there as well. Row-level security still decides which rows.
grant select (organization_id) on public.departments, public.divisions to authenticated;

-- The Super Admin is a person of the organization.
alter table public.organizations add constraint organizations_super_admin_id_fkey
  foreign key (id, super_admin_id) references public.profiles (organization_id, id);

-- ---------- 5. The database sets organization_id ----------

-- The caller's organization: the one of their active profile, or null (no profile, a deleted one, or
-- not signed in). Null matches no row.
create function public.current_organization_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.profiles p where p.id = (select auth.uid()) and p.deleted_at is null;
$$;

-- TRANSITIONAL (see the top): the organization when the database has exactly one, otherwise null.
create function public.only_organization_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.organizations o where (select count(*) from public.organizations) = 1;
$$;

-- BEFORE INSERT OR UPDATE OF organization_id. Arguments for a row that belongs to another row:
-- (parent table, column holding the parent's id, type of that id). No arguments: a row that starts an
-- organization's data.
create function public.set_row_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  parent_id text;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'A row can''t move to another organization' using errcode = '42501', hint = 'organization-fixed';
    end if;
    return new;
  end if;

  if tg_nargs = 3 then
    -- Always the parent's organization, whatever was sent.
    parent_id := pg_catalog.to_jsonb(new) ->> tg_argv[1];
    if parent_id is not null then
      execute pg_catalog.format('select p.organization_id from public.%I p where p.id = $1::%s', tg_argv[0], tg_argv[2])
        into org using parent_id;
    end if;
    if org is null then
      raise exception 'The record this belongs to was not found' using errcode = '23503';
    end if;
  elsif public.is_api_user_request() then
    -- A signed-in (or anonymous) API caller: always their own organization.
    org := public.current_organization_id();
  else
    -- The service role or the owner: the organization the function set.
    org := coalesce(new.organization_id, public.only_organization_id());
  end if;

  if org is null then
    raise exception 'An organization is required' using errcode = '23502', hint = 'organization-required';
  end if;
  new.organization_id := org;
  return new;
end;
$$;

-- Named a0_ so it runs before every other BEFORE trigger on the table (they run in name order).
do $$
declare
  spec text[];
begin
  foreach spec slice 1 in array array[
    -- table, parent table, parent id column, parent id type ('' = starts an organization's data)
    ['profiles', '', '', ''],
    ['departments', '', '', ''],
    ['divisions', '', '', ''],
    ['guideline_versions', '', '', ''],
    ['guideline_version_drafts', '', '', ''],
    -- A record of a one-time rename, written only by migrations and its rollback.
    ['ampersand_name_changes', '', '', ''],
    ['user_roles', 'profiles', 'user_id', 'uuid'],
    ['employee_positions', 'profiles', 'profile_id', 'uuid'],
    ['user_invitations', 'profiles', 'user_id', 'uuid'],
    ['admin_profile_backup', 'profiles', 'profile_id', 'uuid'],
    ['organization_management_audit', 'profiles', 'actor_id', 'uuid'],
    ['sops', 'departments', 'department_id', 'text'],
    ['sop_versions', 'sops', 'sop_id', 'uuid'],
    ['sop_co_authors', 'sops', 'sop_id', 'uuid'],
    ['timeline_events', 'sops', 'sop_id', 'uuid'],
    ['review_rounds', 'sops', 'sop_id', 'uuid'],
    ['review_requests', 'sops', 'sop_id', 'uuid'],
    ['sop_comments', 'sops', 'sop_id', 'uuid'],
    ['compliance_checks', 'sops', 'sop_id', 'uuid'],
    ['compliance_findings', 'compliance_checks', 'check_id', 'uuid'],
    ['guideline_requirements', 'guideline_versions', 'guideline_version_id', 'uuid'],
    ['sample_findings', 'guideline_versions', 'guideline_version_id', 'uuid'],
    ['guideline_draft_requirements', 'guideline_version_drafts', 'draft_id', 'uuid'],
    ['department_file_deletions', 'departments', 'department_id', 'text'],
    ['department_file_deletion_items', 'department_file_deletions', 'job_id', 'uuid']
  ] loop
    execute pg_catalog.format(
      'create trigger a0_organization before insert or update of organization_id on public.%I for each row execute function public.set_row_organization(%s)',
      spec[1],
      case when spec[2] = '' then '' else pg_catalog.format('%L, %L, %L', spec[2], spec[3], spec[4]) end);
  end loop;
end;
$$;

-- access_requests only gets an organization from accept_access_request, which sets it itself.

-- ---------- 6. Nothing lost ----------

do $$
declare
  counted record;
  missing bigint;
begin
  for counted in select table_name from organization_row_counts loop
    execute pg_catalog.format('update organization_row_counts set n_after = (select count(*) from public.%I) where table_name = %L',
      counted.table_name, counted.table_name);
  end loop;
  if exists (select 1 from organization_row_counts c where c.n_after is distinct from c.n_before) then
    raise exception 'Row counts changed while moving data into the organization: %',
      (select string_agg(c.table_name || ' ' || c.n_before || '→' || c.n_after, ', ') from organization_row_counts c
       where c.n_after is distinct from c.n_before);
  end if;
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'Expected exactly one organization (MedCare)';
  end if;
  select count(*) into missing from public.access_requests r where r.status = 'accepted' and r.organization_id is null;
  if missing > 0 then
    raise exception 'Accepted requests without an organization: %', missing;
  end if;
end;
$$;

-- ---------- 7. Owners and grants ----------

alter table public.organizations owner to postgres;
alter function public.current_organization_id() owner to postgres;
alter function public.only_organization_id() owner to postgres;
alter function public.set_row_organization() owner to postgres;

revoke all on function public.current_organization_id(), public.only_organization_id(), public.set_row_organization()
  from public, anon, authenticated, service_role;
-- Row-level security policies call it as the signed-in caller.
grant execute on function public.current_organization_id() to authenticated;

notify pgrst, 'reload schema';
commit;
