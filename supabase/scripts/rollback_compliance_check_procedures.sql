-- Undoes 20261118120000_compliance_check_procedures.sql. Undo 20261118130000 first
-- (rollback_close_compliance_check_metadata.sql) and deploy a frontend that doesn't call
-- compliance_check_procedures.
-- No data is lost: the function only reads.
begin;
drop function if exists public.compliance_check_procedures(uuid);
notify pgrst, 'reload schema';
commit;
