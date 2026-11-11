-- Undoes 20261113140000_update_sop_details.sql: drops update_sop_details. Nothing else used it and no
-- existing object was changed, so nothing is restored. Titles and descriptions already saved stay as they are.
begin;

drop function if exists public.update_sop_details(uuid, text, text);

commit;
