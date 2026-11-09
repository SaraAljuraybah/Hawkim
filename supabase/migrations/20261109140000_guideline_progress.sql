-- SFDA Regulatory Requirements, phase 2: the compliance service reports how far it has got with an
-- added GVP version, so its page can show a progress bar (e.g. "Preparing requirements: 45 of 93").
--
-- Additive: one column on guideline_version_drafts and one function for the service role.

begin;

-- e.g. {"stage": "embedding", "done": 45, "total": 93, "at": "..."}; only meaningful while processing.
alter table public.guideline_version_drafts add column processing_progress jsonb;

create function public.report_guideline_progress(p_id uuid, p_stage text, p_done integer, p_total integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_stage not in ('reading', 'embedding', 'saving') then
    raise exception 'Invalid stage' using errcode = '22023';
  end if;
  update public.guideline_version_drafts
  set processing_progress = jsonb_build_object(
        'stage', p_stage, 'done', greatest(coalesce(p_done, 0), 0), 'total', greatest(coalesce(p_total, 0), 0), 'at', now())
  where id = p_id and processing_status = 'processing';
end;
$$;

revoke execute on function public.report_guideline_progress(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.report_guideline_progress(uuid, text, integer, integer) to service_role;

commit;
