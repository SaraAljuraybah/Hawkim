-- The browser can no longer read compliance_checks.metadata.
--
-- metadata is the compliance service's record of a check: run time, model names, warnings, and raw_results,
-- its audit copy of every step (the model's raw answers included). Until now a signed-in user could read
-- all of it, through the API, for every check they may see. The website only needs two things from it, and
-- reads both through security definer functions that return only those:
--   compliance_check_procedures  steps_checked and the procedures (20261118120000);
--   compliance_check_steps       each finding's step text (20261108130000).
--
-- How: `authenticated` loses the table-wide select and gets select on every other column. The row policy
-- ("People can read the checks of the versions they may see") is unchanged. The service role, the owner
-- and the security definer functions are unaffected. anon already has no grant on the table.
-- A column added to compliance_checks later is NOT readable by the browser until it is granted.
--
-- Deploy a frontend that no longer selects metadata (steps_checked:metadata->steps_checked) BEFORE this:
-- with it, the whole SOP list query is refused.
-- Undo: supabase/scripts/rollback_close_compliance_check_metadata.sql

begin;

revoke select on public.compliance_checks from authenticated;

do $$
declare
  v_columns text;
begin
  select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
  into v_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.compliance_checks'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'metadata';
  execute pg_catalog.format('grant select (%s) on public.compliance_checks to authenticated', v_columns);
end;
$$;

notify pgrst, 'reload schema';

commit;
