-- Undoes 20261108130000_compliance_check_steps.sql. Deploy a frontend that doesn't call
-- compliance_check_steps first (the report then shows the section numbers only).
-- No data is lost: the function only reads.
begin;
drop function if exists public.compliance_check_steps(uuid);
notify pgrst, 'reload schema';
commit;
