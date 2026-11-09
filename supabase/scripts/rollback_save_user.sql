-- Undoes 20261107140000_save_user.sql. Permissions, departments and details already saved stay as
-- they are. Deploy a frontend without this save first.
begin;
drop function if exists public.save_user(uuid, text, text, text, text, text[], text, text[]);
notify pgrst, 'reload schema';
commit;
