-- Undoes 20261111140000_organization_settings.sql: drops its two functions and its table. Nothing
-- else used them, and no existing object was changed by that migration, so nothing is restored.
-- Data loss: the saved organization name (one row) is discarded.
begin;

drop function if exists public.set_organization_name(text);
drop function if exists public.get_organization_name();
drop table if exists public.organization_settings;

commit;
