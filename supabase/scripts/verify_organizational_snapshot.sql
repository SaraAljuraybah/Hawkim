-- READ ONLY. Expected 4/9/9 counts and assignments are from the user's snapshot,
-- never application logic or seed data. Requires an active Admin's trusted
-- authenticated database context. SQL Editor impersonation can check DB rules
-- but does NOT prove real JWT authorization. To impersonate deliberately, fill in
-- the two commented lines below after BEGIN with an independently verified ID.
begin read only;
-- select set_config('request.jwt.claim.sub', '<verified-active-admin-uuid>', true);
-- set local role authenticated;
set local plpgsql.check_asserts = on;
do $$
declare snapshot jsonb; item record; actual jsonb;
begin
  if current_user <> 'authenticated' or auth.uid() is null then
    raise exception 'This check requires an authenticated Admin context, not a database-owner bypass';
  end if;
  snapshot := public.get_organizational_structure();
  assert jsonb_array_length(snapshot->'divisions') = 4, 'Division count differs from provided snapshot';
  assert jsonb_array_length(snapshot->'departments') = 9, 'Department count differs from provided snapshot';
  assert (select sum(jsonb_array_length(value->'employees')) from jsonb_array_elements(snapshot->'departments')) = 9, 'Employee count differs from provided snapshot';
  assert snapshot->'divisions' = (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id), '[]'::jsonb)
    from public.divisions where is_active is not false), 'Division names or IDs differ from persisted rows';
  assert (select jsonb_agg(value - 'employees' order by value->>'name', value->>'id') from jsonb_array_elements(snapshot->'departments')) =
    (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'divisionId', division_id) order by name, id)
    from public.departments where removed_at is null), 'Department names or relationships differ from persisted rows';
  for item in select * from (values
    ('research-development', 'rnd'), ('clinical-operations', 'rnd'),
    ('regulatory-affairs', 'regulatory_drug_safety'), ('pharmacovigilance', 'regulatory_drug_safety'),
    ('quality-assurance', 'governance_quality_compliance'), ('legal-governance', 'governance_quality_compliance'),
    ('human-resources', 'corporate_services_operations'), ('finance-administration', 'corporate_services_operations'),
    ('information-technology', 'corporate_services_operations')
  ) expected(department_id, division_id)
  loop
    select value into actual from jsonb_array_elements(snapshot->'departments') where value->>'id' = item.department_id;
    assert actual is not null and actual->>'divisionId' = item.division_id, 'Snapshot assignment mismatch: ' || item.department_id;
  end loop;
  -- Compare the complete payload to persisted rows, including names/positions,
  -- not a list of copied employee names. Bidirectional EXCEPT detects omissions.
  assert not exists (
    (select d.value->>'id', e.value from jsonb_array_elements(snapshot->'departments') d
      cross join lateral jsonb_array_elements(d.value->'employees') e
    except
    select p.department_id, jsonb_build_object('id', p.id, 'name', p.full_name, 'initials', p.initials, 'position', p.position,
      'permissions', coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '[]'::jsonb))
    from public.profiles p join public.departments d on d.id = p.department_id where p.deleted_at is null and d.removed_at is null)
    union all
    (select p.department_id, jsonb_build_object('id', p.id, 'name', p.full_name, 'initials', p.initials, 'position', p.position,
      'permissions', coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '[]'::jsonb))
    from public.profiles p join public.departments d on d.id = p.department_id where p.deleted_at is null and d.removed_at is null
    except
    select d.value->>'id', e.value from jsonb_array_elements(snapshot->'departments') d
      cross join lateral jsonb_array_elements(d.value->'employees') e)
  ), 'RPC employees differ from persisted records, or unexpected fields were returned';
end;
$$;
commit;
