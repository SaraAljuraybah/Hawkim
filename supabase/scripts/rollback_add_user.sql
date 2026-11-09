-- Undoes 20261107150000_add_user.sql. Users already added stay. Deploy a frontend without this save
-- and delete the add-user Edge Function first.
begin;
drop function if exists public.add_user(uuid, text, text, text, text, text, text[]);
drop function if exists public.check_new_user(text, text, text, text, text, text[]);
notify pgrst, 'reload schema';
commit;
