-- Run on a disposable LOCAL database right after supabase/scripts/rollback_organization_settings.sql:
-- checks that the rollback left nothing of 20261111140000_organization_settings.sql behind.
do $$
begin
  assert to_regclass('public.organization_settings') is null, 'table dropped';
  assert to_regprocedure('public.get_organization_name()') is null, 'get_organization_name dropped';
  assert to_regprocedure('public.set_organization_name(text)') is null, 'set_organization_name dropped';
  -- What the migration relied on is untouched.
  assert to_regprocedure('public.is_super_admin()') is not null, 'is_super_admin kept';
  assert to_regclass('public.super_admin') is not null, 'super_admin kept';
end;
$$;
