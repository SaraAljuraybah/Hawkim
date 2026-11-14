-- Undoes supabase/migrations/20261116150000_same_organization_policies.sql. Run as the owner (postgres).
-- Only safe while MedCare is the only organization: without these policies the read policies no longer
-- keep organizations apart.
begin;

do $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'More than one organization exists; without these policies they would see each other''s data';
  end if;
end;
$$;

do $$
declare t text;
begin
  for t in
    select c.relname from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace and p.polname = 'Same organization only'
  loop
    execute format('drop policy "Same organization only" on public.%I', t);
  end loop;
end;
$$;

revoke execute on function public.current_organization_id() from anon;

notify pgrst, 'reload schema';
commit;
