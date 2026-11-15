-- Requests to the Admins, saved in the database: the first type is "Regulatory Guideline Addition".
--
-- Submit a Request, My Requests and the admin Requests pages kept every request in the browser (sample data, lost on
-- reload). This table holds the requests that are saved, starting with one type:
--   'regulatory-guideline-addition'  an employee asks the Admins to add the regulatory guideline the organization's
--                                    compliance checks need. Approving it only records the decision: an Admin still
--                                    adds and processes the guideline in SFDA Regulatory Requirements.
-- The other request types (Department Access, Permission Change, Role Change) stay as they were (not saved yet).
--
-- Rules:
--   - Each request belongs to one organization: the requester's (trigger a0_organization, from the requester's
--     profile). The organization never comes from the browser and never changes.
--   - Nobody writes the table directly (no insert, update or delete grant). Three functions do:
--       submit_user_request   an active user sends a request; they are its requester; status 'pending'.
--       cancel_user_request   the requester cancels their own pending request.
--       decide_user_request   an Admin (or the Super Admin) of the organization approves or rejects a pending
--                             request; who decided and when are kept. A request from a deleted user can't be approved.
--     Each locks the request row, so two decisions (or a decision and a cancellation) can't both apply.
--   - Reading: a requester reads their own requests; an Admin reads every request of the organization. The
--     restrictive policy "Same organization only" (20261116150000) limits both to the caller's organization.
--   - Attachments are not saved (the form says they are optional; they are not sent with this type).
begin;

create table public.user_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  type text not null check (type in ('regulatory-guideline-addition')),
  title text not null check (title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 100),
  description text not null check (description = pg_catalog.btrim(description) and pg_catalog.char_length(description) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requester_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  decided_by uuid,
  decided_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, requester_id) references public.profiles (organization_id, id),
  foreign key (organization_id, decided_by) references public.profiles (organization_id, id),
  constraint user_requests_decision check ((status in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null)),
  constraint user_requests_cancellation check ((status = 'cancelled') = (cancelled_at is not null))
);
comment on table public.user_requests is
  'Requests to the organization''s Admins that are saved (20261120140000): only Regulatory Guideline Addition so far. Written only by submit_user_request, cancel_user_request and decide_user_request.';
create index user_requests_requester on public.user_requests (organization_id, requester_id, created_at desc);
create index user_requests_status on public.user_requests (organization_id, status, created_at);

-- The requester's organization, whatever was sent (as for the other organization tables).
create trigger a0_organization before insert or update of organization_id on public.user_requests
  for each row execute function public.set_row_organization('profiles', 'requester_id', 'uuid');

alter table public.user_requests enable row level security;
create policy "Same organization only" on public.user_requests as restrictive for all to public
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));
create policy "Requesters and Admins can read requests" on public.user_requests for select to authenticated
  using ((requester_id = (select auth.uid()) and (select public.is_active_user())) or (select public.can_manage_organization()));

revoke all on table public.user_requests from public, anon, authenticated, service_role;
grant select on table public.user_requests to authenticated;

-- ---------- Sending a request ----------
create function public.submit_user_request(p_type text, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  new_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'Only an active user can send a request' using errcode = '42501';
  end if;
  if p_type is distinct from 'regulatory-guideline-addition' then
    raise exception 'Choose a request type' using errcode = '23514', hint = 'type';
  end if;
  if v_title = '' then raise exception 'Enter a title' using errcode = '23514', hint = 'title'; end if;
  if pg_catalog.char_length(v_title) > 100 then raise exception 'The title is too long' using errcode = '23514', hint = 'title'; end if;
  if v_description = '' then raise exception 'Enter a description' using errcode = '23514', hint = 'description'; end if;
  if pg_catalog.char_length(v_description) > 1000 then raise exception 'The description is too long' using errcode = '23514', hint = 'description'; end if;

  -- The requester is the caller; the organization is the caller's (trigger a0_organization).
  insert into public.user_requests (type, title, description, requester_id)
  values (p_type, v_title, v_description, (select auth.uid()))
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------- The requester cancels their pending request ----------
create function public.cancel_user_request(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare request public.user_requests;
begin
  if not public.is_active_user() then
    raise exception 'Only an active user can cancel a request' using errcode = '42501';
  end if;
  -- Another organization's request, or another person's, is answered as one that doesn't exist.
  select * into request from public.user_requests r
  where r.id = p_id and r.organization_id = public.current_organization_id() and r.requester_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'This request doesn''t exist' using errcode = 'P0002';
  end if;
  if request.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled' using errcode = 'P0001', hint = 'not-pending';
  end if;
  update public.user_requests set status = 'cancelled', cancelled_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = request.id;
end;
$$;

-- ---------- An Admin approves or rejects ----------
create function public.decide_user_request(p_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = ''
as $$
declare request public.user_requests;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject' using errcode = '23514';
  end if;
  select * into request from public.user_requests r
  where r.id = p_id and r.organization_id = public.current_organization_id()
  for update;
  if not found then
    raise exception 'This request doesn''t exist' using errcode = 'P0002';
  end if;
  if request.status <> 'pending' then
    raise exception 'Only a pending request can be approved or rejected' using errcode = 'P0001', hint = 'not-pending';
  end if;
  if p_decision = 'approved' and exists (
    select 1 from public.profiles p where p.id = request.requester_id and p.deleted_at is not null) then
    raise exception 'A request from a deleted user can''t be approved' using errcode = 'P0001', hint = 'requester-deleted';
  end if;
  -- Only the decision is recorded: approving a Regulatory Guideline Addition adds no guideline.
  update public.user_requests
  set status = p_decision, decided_by = (select auth.uid()), decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = request.id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'decide-request', request.id::text, pg_catalog.jsonb_build_object('decision', p_decision, 'type', request.type));
end;
$$;

revoke all on function public.submit_user_request(text, text, text) from public, anon, authenticated;
revoke all on function public.cancel_user_request(uuid) from public, anon, authenticated;
revoke all on function public.decide_user_request(uuid, text) from public, anon, authenticated;
grant execute on function public.submit_user_request(text, text, text) to authenticated;
grant execute on function public.cancel_user_request(uuid) to authenticated;
grant execute on function public.decide_user_request(uuid, text) to authenticated;

commit;
