-- Phase 5: SOPs, their versions and files, and the timeline events for uploads and deletions.
--
-- Rules enforced here (never only in the browser):
-- - SOP numbers come from one global counter: SOP-001, SOP-002… (never reused).
-- - Only an active Author creates an SOP, always in their home department.
-- - Only the main author uploads a new version for now (co-authors come with their table).
-- - The main author, or the person who uploaded it, deletes a version; at least one stays.
--   Deleting only marks the version deleted; its file is kept.
-- - Version numbers are never reused, deleted versions included.
-- - Files are PDF or DOCX, at most 10 MB, and are never changed or removed.
--
-- Still checked only in the browser until review requests are in the database: a version
-- sent for review can't be deleted, and during review a new version waits for every reviewer.
--
-- The browser only reads these tables; every change goes through the functions below.

-- ---------- Types ----------

create type public.sop_status as enum ('draft', 'in-review', 'in-approval', 'approved', 'returned', 'published');

create type public.sop_file_type as enum ('pdf', 'docx');

-- The events of this delivery's features (more can be added later with alter type … add value).
create type public.timeline_event_type as enum (
  'version-uploaded',
  'version-deleted',
  'co-author-added',
  'co-author-removed',
  'compliance-check-completed',
  'compliance-check-failed',
  'submitted',
  'resubmitted',
  'review-accepted',
  'review-declined',
  'review-withdrawn',
  'reviewer-removed',
  'review-completed',
  'review-changes-requested',
  'internal-review-completed',
  'response'
);

-- ---------- SOP numbers ----------

-- One row with the last number used. Only the trigger below reads or changes it.
create table public.sop_code_counter (
  id boolean primary key default true check (id),
  last_number integer not null default 0 check (last_number >= 0)
);

insert into public.sop_code_counter (id, last_number) values (true, 0);

-- ---------- Tables ----------

create table public.sops (
  id uuid primary key default gen_random_uuid(),
  -- e.g. 'SOP-001'; always set by the assign_sop_code trigger.
  code text not null unique check (code ~ '^SOP-[0-9]{3,}$'),
  title text not null check (title = btrim(title) and length(title) between 1 and 150),
  description text not null default '' check (description = btrim(description) and length(description) <= 1000),
  department_id text not null references public.departments (id),
  author_id uuid not null references public.profiles (id),
  status public.sop_status not null default 'draft',
  -- The current version (a version that isn't deleted).
  current_version integer not null check (current_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sops_author on public.sops (author_id);
create index sops_department_status on public.sops (department_id, status);

create table public.sop_versions (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id),
  -- 1, 2, 3…: one more than the highest ever used, deleted versions included.
  version integer not null check (version >= 1),
  -- The name the file was uploaded with (shown, and used for downloads).
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_type public.sop_file_type not null,
  -- Where the file is in the sop-files bucket: '<uploader id>/<random id>.pdf|docx'.
  storage_path text not null unique,
  file_size bigint not null check (file_size between 1 and 10485760),
  uploaded_by uuid not null references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  -- Set when the version is deleted; the row and its file stay so the number is never reused.
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  unique (sop_id, version),
  check ((deleted_at is null) = (deleted_by is null))
);

-- The current version must exist. Checked at the end of the transaction, because an SOP and
-- its first version are created together.
alter table public.sops
  add constraint sops_current_version_fkey foreign key (id, current_version)
  references public.sop_versions (sop_id, version) deferrable initially deferred;

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id),
  type public.timeline_event_type not null,
  -- Who did it; empty for automatic steps (shown as System).
  actor_id uuid references public.profiles (id),
  -- The SOP version the event is about.
  version integer not null check (version >= 1),
  -- Who it was sent to, if anyone.
  recipient_ids uuid[] not null default '{}',
  -- The person an event is about (e.g. the co-author added or removed).
  subject_id uuid references public.profiles (id),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index timeline_events_sop on public.timeline_events (sop_id, created_at);

-- ---------- SOP number trigger ----------

-- Takes the next number under a row lock, so two SOPs created at once never get the same one.
create function public.assign_sop_code() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  next_number integer;
begin
  update public.sop_code_counter set last_number = last_number + 1 where id returning last_number into next_number;
  -- At least three digits: SOP-001 … SOP-999, then SOP-1000.
  new.code := 'SOP-' || case when next_number < 1000 then lpad(next_number::text, 3, '0') else next_number::text end;
  return new;
end;
$$;

create trigger sops_assign_code
before insert on public.sops
for each row execute function public.assign_sop_code();

-- ---------- Who can see what ----------

-- The signed-in, active person may see this SOP: they are its main author, or it is published
-- in their own department. Later phases add co-authors and reviewers here; the policies stay.
create function public.can_view_sop(p_sop_id uuid) returns boolean
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
      and (s.author_id = p.id or (s.status = 'published' and s.department_id = p.department_id))
  );
$$;

-- The person may see this version of the SOP (its file, and its timeline events). For now the
-- same as the SOP; reviewers will only see the versions sent to them.
create function public.can_view_version(p_sop_id uuid, p_version integer) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_sop(p_sop_id);
$$;

-- The person may read this file: it belongs to a version they may see that isn't deleted.
create function public.can_read_sop_file(p_path text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sop_versions v
    where v.storage_path = p_path and v.deleted_at is null and public.can_view_version(v.sop_id, v.version)
  );
$$;

-- ---------- File check (used by the functions below) ----------

-- The file the signed-in person just uploaded for a version: it must be in sop-files, in their own
-- folder, uploaded by them, not used by any version yet, and of the type its name says.
create function public.check_sop_file(p_storage_path text, p_file_name text)
returns table (file_type public.sop_file_type, file_size bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  name_type public.sop_file_type;
  expected_type text;
  object_type text;
  object_size bigint;
begin
  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255 then
    raise exception 'The file name must be 1 to 255 characters' using errcode = 'check_violation';
  end if;
  name_type := case
    when lower(btrim(p_file_name)) like '%.pdf' then 'pdf'
    when lower(btrim(p_file_name)) like '%.docx' then 'docx'
  end;
  if name_type is null then
    raise exception 'Only PDF and DOCX files can be uploaded' using errcode = 'check_violation';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.' || name_type::text || '$') then
    raise exception 'The file is not in your upload folder' using errcode = 'check_violation';
  end if;

  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
  into object_type, object_size
  from storage.objects o
  where o.bucket_id = 'sop-files' and o.name = p_storage_path and o.owner_id = (select auth.uid())::text;
  if not found then
    raise exception 'The uploaded file was not found' using errcode = 'no_data_found';
  end if;
  -- Worked out first: inside an IF condition, a CASE's own THEN would end the condition.
  if name_type = 'pdf' then
    expected_type := 'application/pdf';
  else
    expected_type := 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  end if;
  if object_type is distinct from expected_type then
    raise exception 'The file type does not match its name' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sop_versions v where v.storage_path = p_storage_path) then
    raise exception 'This file is already used by a version' using errcode = 'unique_violation';
  end if;

  return query select name_type, object_size;
end;
$$;

-- ---------- Actions ----------

-- An active Author creates an SOP in their home department with its first version (v1).
-- Returns the new SOP's id; its number comes from the counter.
create function public.create_sop(p_title text, p_description text, p_department_id text, p_storage_path text, p_file_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  upload record;
  new_id uuid;
begin
  if not public.has_role('author') then
    raise exception 'An active Author account is required to create an SOP' using errcode = 'insufficient_privilege';
  end if;
  if p_department_id is distinct from (select p.department_id from public.profiles p where p.id = actor) then
    raise exception 'SOPs can only be created in your home department' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.removed_at is null) then
    raise exception 'The home department is unavailable' using errcode = 'check_violation';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 150 then
    raise exception 'A title of up to 150 characters is required' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_description, ''))) > 1000 then
    raise exception 'The description must be at most 1000 characters' using errcode = 'check_violation';
  end if;

  select * into upload from public.check_sop_file(p_storage_path, p_file_name);

  insert into public.sops (title, description, department_id, author_id, current_version)
  values (btrim(p_title), btrim(coalesce(p_description, '')), p_department_id, actor, 1)
  returning id into new_id;

  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (new_id, 1, btrim(p_file_name), upload.file_type, p_storage_path, upload.file_size, actor);

  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (new_id, 'version-uploaded', actor, 1);

  return new_id;
end;
$$;

-- The main author uploads the next version, which becomes current (Draft, Returned or In Review).
-- Returns the new version number.
create function public.upload_sop_version(p_sop_id uuid, p_storage_path text, p_file_name text)
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
  if not found or not public.has_role('author') or sop.author_id <> actor then
    raise exception 'Only the author can upload a version' using errcode = 'insufficient_privilege';
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

-- The main author, or the person who uploaded it, deletes a version (Draft, Returned or In Review).
-- At least one version stays; deleting the current one makes the newest remaining one current.
create function public.delete_sop_version(p_sop_id uuid, p_version integer)
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
  if not public.is_active_user() or (sop.author_id <> actor and target.uploaded_by <> actor) then
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

revoke execute on function public.assign_sop_code() from public, anon, authenticated;
revoke execute on function public.check_sop_file(text, text) from public, anon, authenticated;
revoke execute on function public.can_view_sop(uuid) from public, anon;
revoke execute on function public.can_view_version(uuid, integer) from public, anon;
revoke execute on function public.can_read_sop_file(text) from public, anon;
revoke execute on function public.create_sop(text, text, text, text, text) from public, anon;
revoke execute on function public.upload_sop_version(uuid, text, text) from public, anon;
revoke execute on function public.delete_sop_version(uuid, integer) from public, anon;
grant execute on function public.can_view_sop(uuid) to authenticated;
grant execute on function public.can_view_version(uuid, integer) to authenticated;
grant execute on function public.can_read_sop_file(text) to authenticated;
grant execute on function public.create_sop(text, text, text, text, text) to authenticated;
grant execute on function public.upload_sop_version(uuid, text, text) to authenticated;
grant execute on function public.delete_sop_version(uuid, integer) to authenticated;

-- ---------- Row level security ----------

alter table public.sop_code_counter enable row level security;
alter table public.sops enable row level security;
alter table public.sop_versions enable row level security;
alter table public.timeline_events enable row level security;

create policy "People can read the SOPs they may see"
on public.sops for select to authenticated
using (public.can_view_sop(id));

create policy "People can read the versions they may see"
on public.sop_versions for select to authenticated
using (public.can_view_version(sop_id, version));

create policy "People can read the timeline of the versions they may see"
on public.timeline_events for select to authenticated
using (public.can_view_version(sop_id, version));

-- No insert, update or delete policies, and read-only grants: changes only through the functions.
-- The counter has no policy at all, so nobody can read it from the browser.
revoke all on public.sop_code_counter, public.sops, public.sop_versions, public.timeline_events from anon, authenticated;
grant select on public.sops, public.sop_versions, public.timeline_events to authenticated;

-- ---------- File storage ----------

-- Private bucket for SOP files: PDF and DOCX only, at most 10 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-files', 'sop-files', false, 10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- An active Author uploads into their own folder, as '<their id>/<random id>.pdf|docx'.
create policy "Authors can upload SOP files to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sop-files'
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(pdf|docx)$')
  and (select public.has_role('author'))
);

-- A file can be read (and a signed link created) only for a version the person may see.
create policy "People can read the files of the SOP versions they may see"
on storage.objects for select to authenticated
using (bucket_id = 'sop-files' and public.can_read_sop_file(name));

-- No update or delete policies: files in sop-files are never changed or removed.
