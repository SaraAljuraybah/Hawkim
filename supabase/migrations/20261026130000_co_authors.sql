-- Phase 6: co-authors of an SOP.
--
-- Rules enforced here (never only in the browser):
-- - Only the main author adds or removes co-authors, and not once the SOP is published.
-- - A co-author is an active Author from the SOP's department, and not its main author.
-- - Co-authors can see the SOP (and its files), upload new versions, and delete the versions they uploaded.
--
-- Still checked only in the browser: a co-author can't be a reviewer or an approver on the SOP
-- (review requests come to the database later; approval isn't part of this delivery).

-- ---------- Table ----------

create table public.sop_co_authors (
  sop_id uuid not null references public.sops (id),
  user_id uuid not null references public.profiles (id),
  added_by uuid not null references public.profiles (id),
  added_at timestamptz not null default now(),
  primary key (sop_id, user_id)
);

create index sop_co_authors_user on public.sop_co_authors (user_id);

-- ---------- Rules for every co-author row ----------

create function public.check_co_author() returns trigger
language plpgsql
set search_path = ''
as $$
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
  return new;
end;
$$;

create trigger sop_co_authors_check
before insert or update on public.sop_co_authors
for each row execute function public.check_co_author();

-- ---------- Helper ----------

-- This person is a co-author of this SOP.
create function public.is_co_author(p_sop_id uuid, p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.sop_co_authors c where c.sop_id = p_sop_id and c.user_id = p_user_id);
$$;

-- ---------- Who can see an SOP: now co-authors too ----------

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
      )
  );
$$;

-- ---------- Actions ----------

-- The main author adds one or more co-authors at once; if one can't be added, none are.
create function public.add_co_authors(p_sop_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  person uuid;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author') or sop.author_id <> actor then
    raise exception 'Only the author can manage co-authors' using errcode = 'insufficient_privilege';
  end if;
  if sop.status = 'published' then
    raise exception 'Co-authors can''t change once the SOP is published' using errcode = 'check_violation';
  end if;
  if coalesce(cardinality(p_user_ids), 0) = 0
     or cardinality(p_user_ids) <> (select count(distinct u) from unnest(p_user_ids) as u) then
    raise exception 'Select one or more different people' using errcode = 'check_violation';
  end if;

  foreach person in array p_user_ids loop
    if public.is_co_author(p_sop_id, person) then
      raise exception 'Already an author of this SOP' using errcode = 'unique_violation';
    end if;
    -- The rules for the person are checked by the sop_co_authors_check trigger.
    insert into public.sop_co_authors (sop_id, user_id, added_by) values (p_sop_id, person, actor);
    insert into public.timeline_events (sop_id, type, actor_id, version, subject_id)
    values (p_sop_id, 'co-author-added', actor, sop.current_version, person);
  end loop;
end;
$$;

-- The main author removes a co-author. Their name stays in the timeline, and the versions they uploaded stay.
create function public.remove_co_author(p_sop_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author') or sop.author_id <> actor then
    raise exception 'Only the author can manage co-authors' using errcode = 'insufficient_privilege';
  end if;
  if sop.status = 'published' then
    raise exception 'Co-authors can''t change once the SOP is published' using errcode = 'check_violation';
  end if;

  delete from public.sop_co_authors c where c.sop_id = p_sop_id and c.user_id = p_user_id;
  if not found then
    raise exception 'Not a co-author of this SOP' using errcode = 'no_data_found';
  end if;

  insert into public.timeline_events (sop_id, type, actor_id, version, subject_id)
  values (p_sop_id, 'co-author-removed', actor, sop.current_version, p_user_id);
end;
$$;

-- The main author or a co-author uploads the next version (unchanged otherwise).
create or replace function public.upload_sop_version(p_sop_id uuid, p_storage_path text, p_file_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  upload record;
  next_version integer;
begin
  -- Lock the SOP so two uploads at once can't get the same number.
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author')
     or (sop.author_id <> actor and not public.is_co_author(p_sop_id, actor)) then
    raise exception 'Only the author or a co-author can upload a version' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review') then
    raise exception 'A version can''t be uploaded while the SOP is %', sop.status using errcode = 'check_violation';
  end if;

  select * into upload from public.check_sop_file(p_storage_path, p_file_name);
  select max(v.version) + 1 into next_version from public.sop_versions v where v.sop_id = p_sop_id;

  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (p_sop_id, next_version, btrim(p_file_name), upload.file_type, p_storage_path, upload.file_size, actor);

  update public.sops set current_version = next_version, updated_at = now() where id = p_sop_id;

  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (p_sop_id, 'version-uploaded', actor, next_version);

  return next_version;
end;
$$;

-- The main author, or a co-author who uploaded the version, deletes it (unchanged otherwise).
create or replace function public.delete_sop_version(p_sop_id uuid, p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  target public.sop_versions;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  select * into target from public.sop_versions v where v.sop_id = p_sop_id and v.version = p_version and v.deleted_at is null;
  if sop.id is null or target.id is null then
    raise exception 'This version doesn''t exist' using errcode = 'no_data_found';
  end if;
  if not public.is_active_user()
     or not (sop.author_id = actor or (target.uploaded_by = actor and public.is_co_author(p_sop_id, actor))) then
    raise exception 'Only the main author or the person who uploaded this version can delete it' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review') then
    raise exception 'A version can''t be deleted while the SOP is %', sop.status using errcode = 'check_violation';
  end if;
  if (select count(*) from public.sop_versions v where v.sop_id = p_sop_id and v.deleted_at is null) <= 1 then
    raise exception 'At least one version must remain' using errcode = 'check_violation';
  end if;

  update public.sop_versions set deleted_at = now(), deleted_by = actor where id = target.id;

  update public.sops
  set current_version = case
        when current_version = p_version then
          (select max(v.version) from public.sop_versions v where v.sop_id = p_sop_id and v.deleted_at is null)
        else current_version end,
      updated_at = now()
  where id = p_sop_id;

  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (p_sop_id, 'version-deleted', actor, p_version);
end;
$$;

-- ---------- Who can run the functions ----------

revoke execute on function public.check_co_author() from public, anon, authenticated;
revoke execute on function public.is_co_author(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.add_co_authors(uuid, uuid[]) from public, anon;
revoke execute on function public.remove_co_author(uuid, uuid) from public, anon;
grant execute on function public.add_co_authors(uuid, uuid[]) to authenticated;
grant execute on function public.remove_co_author(uuid, uuid) to authenticated;

-- ---------- Row level security ----------

alter table public.sop_co_authors enable row level security;

create policy "People can read the co-authors of the SOPs they may see"
on public.sop_co_authors for select to authenticated
using (public.can_view_sop(sop_id));

revoke all on public.sop_co_authors from anon, authenticated;
grant select on public.sop_co_authors to authenticated;
