-- Undoes 20261118130000_close_compliance_check_metadata.sql: `authenticated` reads every column of
-- compliance_checks again, metadata included (the row policy is unchanged). No data changes.
begin;

do $$
declare
  v_columns text;
begin
  select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
  into v_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.compliance_checks'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'metadata';
  execute pg_catalog.format('revoke select (%s) on public.compliance_checks from authenticated', v_columns);
end;
$$;
grant select on public.compliance_checks to authenticated;

notify pgrst, 'reload schema';

commit;
