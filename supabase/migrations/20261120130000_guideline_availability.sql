-- Whether the caller's organization has a regulatory guideline to check SOPs against, and if not, why not.
--
-- A new organization starts with no guideline version (accept_access_request creates none, and nothing copies
-- another organization's). An Author who presses Check Compliance needs to know which of these is true; only Admins
-- can read the added versions (guideline_version_drafts), so this function tells every active user of the
-- organization just one word, for their own organization only:
--   'available'    the organization has a current (published) version: checks run against it;
--   'processing'   none is current, and an added version is waiting for or being processed by the compliance service;
--   'unpublished'  none is current, and an added version was processed but not published (it is never made current here);
--   'failed'       none is current, and processing of the added version failed;
--   'cancelled'    none is current, and processing of the added version is being cancelled;
--   'none'         no version was ever added.
-- When a version is current, a newer version being processed doesn't matter: checks use the current one.
--
-- start_compliance_check already refuses a check when its SOP's organization has no current version
-- ('No guideline is available to check against', no_data_found); it is unchanged.
begin;

create function public.guideline_availability() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_organization uuid := public.current_organization_id();
  v_state text;
begin
  if v_organization is null or not public.is_active_user() then
    raise exception 'Only an active user can see the regulatory guideline' using errcode = '42501';
  end if;
  if public.current_guideline_version(v_organization) is not null then
    return 'available';
  end if;
  select case
      when d.cancel_requested then 'cancelled'
      when d.processing_status in ('waiting', 'processing') then 'processing'
      when d.processing_status = 'ready' then 'unpublished'
      else 'failed'
    end
  into v_state
  from public.guideline_version_drafts d
  where d.organization_id = v_organization
  order by case
      when not d.cancel_requested and d.processing_status in ('waiting', 'processing') then 1
      when not d.cancel_requested and d.processing_status = 'ready' then 2
      when not d.cancel_requested and d.processing_status = 'failed' then 3
      else 4
    end, d.updated_at desc, d.id
  limit 1;
  return coalesce(v_state, 'none');
end;
$$;
revoke all on function public.guideline_availability() from public, anon, authenticated;
grant execute on function public.guideline_availability() to authenticated;

commit;
