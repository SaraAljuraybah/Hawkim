-- Undoes 20261107130000_update_user_details.sql. Names, phones and positions already saved stay as
-- they are. Deploy a frontend without this save first.
begin;
drop function if exists public.update_user_details(uuid, text, text, text);
notify pgrst, 'reload schema';
commit;
