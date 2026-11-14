-- The compliance report's Procedures section: the procedures (steps) the compliance service extracted
-- from the checked SOP version's file, and how many it checked.
--
-- The compliance service keeps every step it read in the check's metadata (raw_results, its audit copy:
-- step text, retrieved requirements, the model's raw answer…). This function returns only what the report
-- shows, as one jsonb value, so the rest never reaches the browser:
--   steps_checked  how many steps the service checked (metadata.steps_checked), or null;
--   procedures     one object per step, in document order (the number at the end of its chunk_id,
--                  e.g. 'MySOP::003'; raw_results itself is sorted by result):
--                    chunk_id  the step's id: the findings' evidence.steps[].chunk_id, which links the two;
--                    heading   the step's heading (its section);
--                    page      the page it starts on, or null;
--                    text      the step's SOP text.
--                  Empty for sample checks (no raw_results) and when raw_results isn't an array.
-- A check that doesn't exist, isn't completed, or that the caller may not see (the compliance_checks policy:
-- can_view_version) returns null. Security definer, so it still works once the browser can no longer read
-- the metadata column (20261118130000).
--
-- Additive: adds this one read-only function. No existing table, column, row, function or policy changes.
-- Undo: supabase/scripts/rollback_compliance_check_procedures.sql

begin;

create function public.compliance_check_procedures(p_check_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'steps_checked', case when jsonb_typeof(c.metadata->'steps_checked') = 'number' then c.metadata->'steps_checked' end,
    'procedures', coalesce((
      select jsonb_agg(jsonb_build_object(
          'chunk_id', s.step->>'chunk_id',
          'heading', case when jsonb_typeof(s.step->'heading') = 'string' then s.step->>'heading' end,
          'page', case when jsonb_typeof(s.step->'page') = 'number' then s.step->'page' end,
          'text', case when jsonb_typeof(s.step->'text') = 'string' then s.step->>'text' end)
        order by (substring(s.step->>'chunk_id' from '::([0-9]{1,9})$'))::integer nulls last, s.position)
      from jsonb_array_elements(
        case when jsonb_typeof(c.metadata->'raw_results') = 'array' then c.metadata->'raw_results' else '[]'::jsonb end
      ) with ordinality as s(step, position)
      where jsonb_typeof(s.step) = 'object'
        and jsonb_typeof(s.step->'chunk_id') = 'string'
        and s.step->>'chunk_id' <> ''
    ), '[]'::jsonb))
  from public.compliance_checks c
  where c.id = p_check_id
    and c.status = 'completed'
    and public.can_view_version(c.sop_id, c.sop_version);
$$;

alter function public.compliance_check_procedures(uuid) owner to postgres;
revoke all on function public.compliance_check_procedures(uuid) from public, anon, authenticated, service_role;
grant execute on function public.compliance_check_procedures(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
