-- NOT EXECUTED. Static companion to supabase/proposals/20261029000000_review_deadline_helpers.sql.
-- Only for a disposable LOCAL database, after the proposal is approved, and only with explicit
-- permission. Never run it against the shared Supabase project. No rows change.
begin;
set local plpgsql.check_asserts = on;
set local time zone 'America/Los_Angeles';

do $$
declare
  example record;
  duration integer;
  accepted_at timestamptz;
  due_at timestamptz;
  target_date date;
  counted_days integer;
  day_offset integer;
  rejected boolean;
begin
  -- Agreed examples plus acceptance during Friday/Saturday and year rollover.
  for example in select * from (values
    ('2026-10-25 12:00:00+03'::timestamptz, 2, date '2026-10-27'),
    ('2026-10-29 12:00:00+03'::timestamptz, 2, date '2026-11-02'),
    ('2026-10-29 12:00:00+03'::timestamptz, 3, date '2026-11-03'),
    ('2026-10-30 12:00:00+03'::timestamptz, 1, date '2026-11-01'),
    ('2026-10-31 12:00:00+03'::timestamptz, 1, date '2026-11-01'),
    ('2026-10-26 12:00:00+03'::timestamptz, 5, date '2026-11-02'),
    ('2026-12-31 23:59:00+03'::timestamptz, 2, date '2027-01-04'),
    ('2028-02-28 12:00:00+03'::timestamptz, 1, date '2028-02-29')
  ) as examples(accepted_at, duration, expected_day) loop
    due_at := public.hawkim_review_due_at(example.accepted_at, example.duration);
    assert public.hawkim_riyadh_date(due_at) = example.expected_day, 'Working-day example failed';
    assert (due_at at time zone 'Asia/Riyadh')::time = time '23:59:59.999', 'Deadline must retain Riyadh end-of-day';
  end loop;

  -- All acceptance weekdays, each requested duration, with an independent count.
  foreach duration in array array[1, 2, 3, 5, 10] loop
    for day_offset in 0..6 loop
      accepted_at := timestamptz '2026-10-25 19:15:43.123+03' + day_offset * interval '1 day';
      due_at := public.hawkim_review_due_at(accepted_at, duration);
      target_date := public.hawkim_riyadh_date(due_at);
      select count(*) into counted_days
      from generate_series(1, target_date - public.hawkim_riyadh_date(accepted_at)) as days(offset_days)
      where extract(isodow from public.hawkim_riyadh_date(accepted_at) + offset_days) not in (5, 6);
      assert counted_days = duration, 'Acceptance date must be excluded and each following working date counted once';
      assert extract(isodow from target_date) not in (5, 6), 'Friday and Saturday cannot be deadlines';
    end loop;
  end loop;

  -- Riyadh's date, not the UTC/client/session date, governs both deadline types.
  assert public.hawkim_review_due_at(timestamptz '2026-10-29 21:30:00+00', 2)
    = timestamptz '2026-11-02 23:59:59.999+03', 'Riyadh date must be used after UTC rollover';
  assert public.hawkim_review_response_due_at(timestamptz '2026-10-29 10:00:00+03')
    = timestamptz '2026-11-02 23:59:59.999+03', 'Response allocation must be exactly two subsequent working dates';
  assert public.hawkim_review_response_due_at(timestamptz '2026-10-30 10:00:00+03')
    = timestamptz '2026-11-02 23:59:59.999+03', 'A weekend response request must skip Friday and Saturday';
  assert public.hawkim_review_response_due_at(timestamptz '2026-10-25 07:00:00+03')
    = public.hawkim_review_response_due_at(timestamptz '2026-10-25 17:00:00+03'), 'Cutoff must not move the fixed last response date';
  assert public.hawkim_review_due_at(timestamptz '2026-11-01 12:00:00+03', 5)
    > public.hawkim_review_response_due_at(timestamptz '2026-10-29 12:00:00+03'), 'Review duration starts from acceptance separately from the request';
  assert public.hawkim_review_due_at(timestamptz '2026-10-29 12:00:00+03', 2)
    = timestamptz '2026-11-02 23:59:59.999+03'
    and public.hawkim_review_response_due_at(timestamptz '2026-10-25 12:00:00+03')
    = timestamptz '2026-10-27 23:59:59.999+03', 'The same two-day duration must start at the later acceptance, independently of the earlier request';
  assert public.hawkim_review_due_at(timestamptz '2026-10-25 12:00:00+03', 1)
    - timestamptz '2026-10-26 23:59:59.998+03' = interval '1 millisecond', 'Same-day expiry must retain millisecond precision';

  -- The same results must survive a different database session timezone.
  perform set_config('TimeZone', 'Pacific/Auckland', true);
  assert public.hawkim_review_due_at(timestamptz '2026-10-29 21:30:00+00', 2)
    = timestamptz '2026-11-02 23:59:59.999+03', 'Session timezone must not affect deadlines';

  foreach duration in array array[0, 31] loop
    rejected := false;
    begin perform public.hawkim_review_due_at(now(), duration);
    exception when invalid_parameter_value then rejected := true; end;
    assert rejected, 'Out-of-range review durations must be rejected';
  end loop;
  rejected := false;
  begin perform public.hawkim_review_due_at(null, 1);
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'Missing acceptance timestamps must be rejected';
  rejected := false;
  begin perform public.hawkim_review_due_at('infinity', 1);
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'Infinite acceptance timestamps must be rejected';
  rejected := false;
  begin perform public.hawkim_review_due_at(now(), null);
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'Missing duration must be rejected by the deadline calculator';
  assert public.hawkim_review_response_due_at(timestamptz '2026-10-29 17:00:00+03')
    = timestamptz '2026-11-02 23:59:59.999+03', 'There is no 16:00 rule: Thursday after 16:00 is still due Monday';
  assert public.hawkim_review_response_due_at(timestamptz '2026-11-01 23:59:00+03')
    = timestamptz '2026-11-03 23:59:59.999+03', 'Sunday 23:59 counts Monday and Tuesday';

  -- These are pure calculation helpers, not assignment/mutation authority.
  assert not exists (
    select 1
    from pg_proc as routine
    cross join lateral aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
    where routine.oid = 'public.hawkim_review_due_at(timestamptz,integer)'::regprocedure
      and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  ), 'Anonymous PUBLIC execution must not be implicitly granted';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    assert not has_function_privilege('authenticated', 'public.hawkim_review_due_at(timestamptz,integer)', 'EXECUTE'), 'Internal helpers must not be callable from the browser';
  end if;
end;
$$;

rollback;

-- Browser roles cannot call the internal helpers directly (the review RPCs call them as definer).
begin;
set local plpgsql.check_asserts = on;
do $$
declare
  test_role text;
  denied boolean;
begin
  foreach test_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = test_role) then
      denied := false;
      execute format('set local role %I', test_role);
      begin
        perform public.hawkim_review_response_due_at(now());
      exception when insufficient_privilege then
        denied := true;
      end;
      perform set_config('role', 'none', true);
      assert denied, format('%s must not execute internal deadline helpers', test_role);
    end if;
  end loop;
end;
$$;
rollback;
