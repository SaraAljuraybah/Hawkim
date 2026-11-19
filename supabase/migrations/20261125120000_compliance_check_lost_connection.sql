-- A compliance check whose checker lost its connection ends as failed, with a clear message.
--
-- Before: when the computer running worker.py lost its internet connection during a check, the worker
-- could not tell the database that the check failed (that call needs the internet too). The check stayed
-- 'running' for 30 minutes: the website showed it as running, and the SOP could not be checked again or
-- deleted until then.
--
-- Now:
--   1. compliance_check_alive(check): the worker calls it every 20 seconds while it works on a check
--      (service role only). It records metadata.worker_seen. The shared service_heartbeat can't be used
--      for this: with two workers (two laptops), one worker's heartbeat would hide the other's lost
--      connection.
--   2. close_lost_compliance_checks(sop): the website calls it while it waits for a check. It marks the
--      SOP's check failed, with a message for the user, when
--        a. the worker has sent worker_seen and nothing came for 2 minutes (connection lost), or
--        b. no worker took the check and no checker has been online for 2 minutes.
--      Checks of an older worker that doesn't send worker_seen keep the 30-minute rule
--      (start_compliance_check, delete_sop), so updating the laptops one by one is safe.
--   The failure adds the same 'compliance-check-failed' timeline event as fail_compliance_check.
--   When the connection comes back, the worker's complete_compliance_check is refused (the check is no
--   longer running) and its fail_compliance_check does nothing, so a closed check stays closed.
--
-- No table change. Undo: drop function public.close_lost_compliance_checks(uuid);
--                        drop function public.compliance_check_alive(uuid);

begin;

create function public.compliance_check_alive(p_check_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.compliance_checks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('worker_seen', now())
  where id = p_check_id and status = 'running' and engine <> 'sample';
  -- false: the check is no longer running (closed meanwhile); the worker's result won't be saved.
  return found;
end;
$$;

create function public.close_lost_compliance_checks(p_sop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  chk public.compliance_checks;
  closed integer := 0;
  checker_online boolean := exists (
    select 1 from public.compliance_service_status s where s.last_seen > now() - interval '2 minutes');
  message text;
begin
  -- Only the caller's own organization's SOPs.
  if not exists (
    select 1 from public.sops s
    where s.id = p_sop_id and s.organization_id = public.current_organization_id()
  ) then
    return 0;
  end if;
  for chk in
    select * from public.compliance_checks c
    where c.sop_id = p_sop_id and c.status = 'running' and c.engine <> 'sample'
    for update
  loop
    message := null;
    if chk.metadata ? 'worker_seen'
       and (chk.metadata->>'worker_seen')::timestamptz < now() - interval '2 minutes' then
      message := 'The compliance checker lost its connection while checking this SOP, so the check was stopped. '
              || 'Make sure the computer running the checker is connected to the internet, then run the check again.';
    elsif not (coalesce(chk.metadata, '{}'::jsonb) ? 'claimed_at') and not checker_online
          and chk.started_at < now() - interval '2 minutes' then
      message := 'The compliance checker went offline before it could start this check, so the check was stopped. '
              || 'Make sure the checker is running and connected to the internet, then run the check again.';
    end if;
    if message is not null then
      update public.compliance_checks
      set status = 'failed', completed_at = now(), error_message = message
      where id = chk.id;
      insert into public.timeline_events (sop_id, type, actor_id, version)
      values (chk.sop_id, 'compliance-check-failed', chk.triggered_by, chk.sop_version);
      closed := closed + 1;
    end if;
  end loop;
  return closed;
end;
$$;

revoke execute on function public.compliance_check_alive(uuid) from public, anon, authenticated;
grant execute on function public.compliance_check_alive(uuid) to service_role;
revoke execute on function public.close_lost_compliance_checks(uuid) from public, anon;
grant execute on function public.close_lost_compliance_checks(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
