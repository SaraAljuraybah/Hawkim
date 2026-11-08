-- The SOP text of the steps behind each finding of a compliance check, for the report's SOP Reference.
--
-- The compliance service keeps every step it checked in the check's metadata (raw_results, its audit
-- copy: step text, the requirement it was compared with, the model's raw answer…). This function
-- returns only three values per step, so the rest never reaches the browser:
--   code      the exact code of the requirement the step was compared with (requirement.id), which is
--             the finding's guideline_requirements.code;
--   chunk_id  the step's id, e.g. 'MySOP::003';
--   text      the step's SOP text.
-- It leaves out the steps the service left out of its findings (compliance-service/hawkim/aggregate.py
-- findings_for_database): not valid, no label, or no requirement. Steps come in document order.
--
-- Access: the same as the report's (the compliance_checks and compliance_findings policies), so a
-- check the caller may not see, or that doesn't exist, returns no rows.
--
-- Additive: adds this one read-only function. No existing table, column, row, function, trigger or
-- policy changes.
-- Undo: supabase/scripts/rollback_compliance_check_steps.sql

begin;

create function public.compliance_check_steps(p_check_id uuid)
returns table (code text, chunk_id text, text text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.step->'requirement'->>'id', s.step->>'chunk_id', s.step->>'text'
  from public.compliance_checks c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.metadata->'raw_results') = 'array' then c.metadata->'raw_results' else '[]'::jsonb end
  ) with ordinality as s(step, position)
  where c.id = p_check_id
    and c.status = 'completed'
    and public.can_view_version(c.sop_id, c.sop_version)
    -- aggregate.py: `if not f.get("valid") or not f.get("label") or not req: continue`, then
    -- groups by req["id"]. No requirement, an empty one or one without an id has no id here.
    and s.step->'valid' = 'true'::jsonb
    and coalesce(s.step->>'label', '') <> ''
    and s.step->'requirement'->>'id' is not null
  order by s.position;
$$;

alter function public.compliance_check_steps(uuid) owner to postgres;
revoke all on function public.compliance_check_steps(uuid) from public, anon, authenticated, service_role;
grant execute on function public.compliance_check_steps(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
