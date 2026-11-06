-- Undoes 20261106120000_delete_sop.sql. SOPs already deleted can't be brought back.
-- Deploy a frontend without Delete SOP first.
begin;
drop function if exists public.delete_sop(uuid, uuid, text);
commit;
