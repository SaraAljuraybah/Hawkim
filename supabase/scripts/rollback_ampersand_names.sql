-- Undoes 20261113120000_ampersand_names.sql: puts back each name it changed (from
-- public.ampersand_name_changes), then drops that table. A name edited again since the migration is
-- left as it is now (only rows still holding the migration's new name are restored).
begin;

update public.divisions d set name = c.old_name
from public.ampersand_name_changes c
where c.entity = 'division' and c.entity_id = d.id and d.name = c.new_name;

update public.departments d set name = c.old_name, updated_at = pg_catalog.clock_timestamp()
from public.ampersand_name_changes c
where c.entity = 'department' and c.entity_id = d.id and d.name = c.new_name and d.deletion_job_id is null;

update public.organization_settings o set name = c.old_name, updated_at = now()
from public.ampersand_name_changes c
where c.entity = 'organization' and o.singleton and o.name = c.new_name;

drop table if exists public.ampersand_name_changes;

commit;
