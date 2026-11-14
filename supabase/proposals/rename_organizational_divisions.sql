-- PROPOSED DATA UPDATE ONLY. Not a migration; do not apply without approval.
-- Run the whole transaction in SQL Editor as the authorized database owner.
-- Preserves division IDs, department names and all organizational assignments.
begin;
do $$
declare requested record; current_name text;
begin
  for requested in select * from (values
    ('rnd', 'R&D Division', 'Clinical Research and Development'),
    ('governance_quality_compliance', 'Governance, Quality & Compliance', 'Quality and Compliance')
  ) changes(id, old_name, new_name) order by id
  loop
    select name into current_name from public.divisions where id = requested.id for update;
    if not found then
      raise exception 'Division % was not found; no rename applied', requested.id;
    end if;
    if current_name is distinct from requested.old_name and current_name is distinct from requested.new_name then
      raise exception 'Division % has unexpected name %; review before renaming', requested.id, current_name;
    end if;
    update public.divisions set name = requested.new_name
      where id = requested.id and name is distinct from requested.new_name;
  end loop;
end;
$$;
select id, name from public.divisions where id in ('rnd', 'governance_quality_compliance') order by id;
commit;
