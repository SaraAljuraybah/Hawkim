-- Run against a disposable LOCAL database after loading the helper migration:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/calendar_helpers.sql
-- No canonical workflow schema or pgTAP extension is required. No rows change.
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
  emoji text := U&'\+01F600';
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
  assert public.hawkim_review_response_counts_from(timestamptz '2026-10-29 16:00:00+03')
    = timestamptz '2026-11-01 08:00:00+03', 'After-cutoff Thursday starts counting Sunday morning';
  assert public.hawkim_review_response_counts_from(timestamptz '2026-10-30 12:00:00+03')
    = timestamptz '2026-11-01 08:00:00+03', 'Weekend request starts counting Sunday morning';
  assert public.hawkim_review_response_counts_from(timestamptz '2026-10-25 07:59:59+03')
    = timestamptz '2026-10-25 08:00:00+03', 'Before opening starts counting at 08:00';
  assert public.hawkim_review_response_counts_from(timestamptz '2026-10-25 15:59:59.123+03')
    = timestamptz '2026-10-25 15:59:59.123+03', 'During working hours preserve the precise request timestamp';
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
  assert public.hawkim_review_response_counts_from(timestamptz '2026-10-29 13:00:00+00')
    = timestamptz '2026-11-01 08:00:00+03', 'Cutoff must use Riyadh, not session time';

  foreach duration in array array[500, 501, 1000] loop
    assert public.hawkim_validate_review_note(repeat('x', duration)) = repeat('x', duration), 'Valid comments must be preserved in full';
  end loop;
  assert public.hawkim_validate_review_note(null) is null, 'Comments remain optional';
  assert public.hawkim_validate_review_note(E' \t\n') is null, 'Whitespace-only comments normalize to no comment';
  assert public.hawkim_validate_review_note(U&'\00A0hello\FEFF') = 'hello', 'Whitespace normalization must match JavaScript trim';
  assert public.hawkim_validate_review_note(repeat(emoji, 500)) = repeat(emoji, 500), '1000 UTF-16 units must be accepted';
  assert public.hawkim_utf16_length('') = 0, 'Empty text has zero UTF-16 units';
  assert public.hawkim_utf16_length(emoji) = 2, 'Astral characters match HTML maxlength';
  assert public.hawkim_validate_sop_title(repeat('x', 50)) = repeat('x', 50), 'A 50-character title must be accepted';
  assert public.hawkim_validate_sop_title(repeat(emoji, 25)) = repeat(emoji, 25), 'Title limits must match JavaScript for astral characters';
  assert public.hawkim_validate_sop_title('  Procedure  ') = 'Procedure', 'Valid titles are normalized before storage';

  rejected := false;
  begin perform public.hawkim_validate_review_note(repeat('x', 1001));
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, '1001-character comments must be rejected';
  rejected := false;
  begin perform public.hawkim_validate_review_note(repeat(emoji, 500) || 'x');
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, '1001 UTF-16 units must be rejected';
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
  rejected := false;
  begin perform public.hawkim_validate_sop_title(repeat('x', 51));
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'A title over 50 units must be rejected';
  rejected := false;
  begin perform public.hawkim_validate_sop_title(' ' || repeat('x', 50) || ' ');
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'Title limits count the original input like HTML maxlength and the draft guard';
  rejected := false;
  begin perform public.hawkim_validate_sop_title(E' \t\n');
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'A blank title must be rejected';
  rejected := false;
  begin perform public.hawkim_validate_sop_title(null);
  exception when invalid_parameter_value then rejected := true; end;
  assert rejected, 'A missing title must be rejected';

  -- These are pure calculation helpers, not assignment/mutation authority.
  assert not exists (
    select 1
    from pg_proc as routine
    cross join lateral aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
    where routine.oid = 'public.hawkim_review_due_at(timestamptz,integer)'::regprocedure
      and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  ), 'Anonymous PUBLIC execution must not be implicitly granted';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    assert has_function_privilege('authenticated', 'public.hawkim_review_due_at(timestamptz,integer)', 'EXECUTE'), 'Authenticated calls must receive the explicit calculation grant';
  end if;
end;
$$;

rollback;

-- Exercise actual invoker permissions when Supabase-style roles exist locally.
begin;
set local plpgsql.check_asserts = on;
do $$
declare
  test_role text;
  denied boolean := false;
begin
  foreach test_role in array array['authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = test_role) then
      execute format('set local role %I', test_role);
      assert public.hawkim_review_response_due_at(timestamptz '2026-10-29 12:00:00+03')
        = timestamptz '2026-11-02 23:59:59.999+03', 'Explicitly granted invoker must execute nested helpers';
      assert public.hawkim_validate_review_note(repeat('x', 1000)) = repeat('x', 1000), 'Granted invoker must execute note validation';
      perform set_config('role', 'none', true);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    set local role anon;
    begin
      perform public.hawkim_review_response_due_at(now());
    exception when insufficient_privilege then
      denied := true;
    end;
    perform set_config('role', 'none', true);
    assert denied, 'Anonymous execution must be denied';
  end if;
end;
$$;
rollback;
