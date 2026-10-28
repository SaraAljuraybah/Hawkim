-- Calendar and input primitives for the review RPCs. These functions do not
-- create assignments, authorize mutations, or recalculate existing records.
-- The canonical workflow migration must call them when that schema is supplied.

create function public.hawkim_riyadh_date(p_at timestamptz)
returns date
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
begin
  if p_at is null or not isfinite(p_at) then
    raise exception using errcode = '22023', message = 'A finite review timestamp is required';
  end if;
  return (p_at at time zone 'Asia/Riyadh')::date;
end;
$$;

-- Exclude the origin date; only Sunday through Thursday count. Calendar-date
-- arithmetic avoids browser/session timezone and elapsed-24-hour assumptions.
create function public.hawkim_add_working_days(p_from date, p_days integer)
returns date
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  result date := p_from;
  remaining integer := p_days;
begin
  if p_from is null or not isfinite(p_from) or p_days is null or p_days < 1 or p_days > 30 then
    raise exception using errcode = '22023', message = 'A finite date and a duration of 1 to 30 working days are required';
  end if;
  while remaining > 0 loop
    result := result + 1;
    if extract(isodow from result) not in (5, 6) then
      remaining := remaining - 1;
    end if;
  end loop;
  return result;
end;
$$;

create function public.hawkim_riyadh_end_of_day(p_day date)
returns timestamptz
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
begin
  if p_day is null or not isfinite(p_day) then
    raise exception using errcode = '22023', message = 'A finite review date is required';
  end if;
  return (p_day + time '23:59:59.999') at time zone 'Asia/Riyadh';
end;
$$;

-- The duration starts at acceptance. The acceptance date itself never counts.
create function public.hawkim_review_due_at(p_accepted_at timestamptz, p_duration integer)
returns timestamptz
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select public.hawkim_riyadh_end_of_day(
    public.hawkim_add_working_days(public.hawkim_riyadh_date(p_accepted_at), p_duration)
  );
$$;

-- The fixed response allocation is separate from the duration after acceptance.
-- Its last date is the second working date after the request's Riyadh date.
create function public.hawkim_review_response_due_at(p_requested_at timestamptz)
returns timestamptz
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select public.hawkim_review_due_at(p_requested_at, 2);
$$;

-- Preserve the response allocation's 08:00/16:00 policy, in Riyadh. Before
-- 08:00 count from that morning; at/after 16:00 or on weekends count from the
-- next working morning. This affects the displayed allocation, not the fixed
-- response due date, and does not restrict when a reviewer may respond.
create function public.hawkim_review_response_counts_from(p_requested_at timestamptz)
returns timestamptz
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  local_day date := public.hawkim_riyadh_date(p_requested_at);
  local_time time := (p_requested_at at time zone 'Asia/Riyadh')::time;
begin
  if extract(isodow from local_day) in (5, 6) then
    while extract(isodow from local_day) in (5, 6) loop
      local_day := local_day + 1;
    end loop;
    return (local_day + time '08:00:00') at time zone 'Asia/Riyadh';
  end if;
  if local_time < time '08:00:00' then
    return (local_day + time '08:00:00') at time zone 'Asia/Riyadh';
  end if;
  if local_time >= time '16:00:00' then
    return (public.hawkim_add_working_days(local_day, 1) + time '08:00:00') at time zone 'Asia/Riyadh';
  end if;
  return p_requested_at;
end;
$$;

-- JavaScript string.length and HTML maxlength count UTF-16 code units. Match
-- that existing UI contract rather than accepting more astral characters in SQL.
create function public.hawkim_utf16_length(p_text text)
returns integer
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select char_length(p_text) + count(*)::integer
  from generate_series(1, char_length(p_text)) as characters(position)
  where ascii(substr(p_text, position, 1)) > 65535;
$$;

-- Match ECMAScript String.trim(), including non-ASCII whitespace and BOM.
create function public.hawkim_trim_review_text(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

create function public.hawkim_validate_review_note(p_note text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  normalized text := public.hawkim_trim_review_text(p_note);
begin
  if public.hawkim_utf16_length(normalized) > 1000 then
    raise exception using errcode = '22023', message = 'Submission comments must be at most 1000 characters';
  end if;
  return nullif(normalized, '');
end;
$$;

create function public.hawkim_validate_sop_title(p_title text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  normalized text := public.hawkim_trim_review_text(p_title);
begin
  -- HTML maxlength and the direct draft guard count the original input before trimming.
  if normalized is null or normalized = '' or public.hawkim_utf16_length(p_title) > 50 then
    raise exception using errcode = '22023', message = 'An SOP title of 1 to 50 characters is required';
  end if;
  return normalized;
end;
$$;

-- Pure helpers reveal no application data. Avoid implicit anonymous execution;
-- authenticated RPC callers and service-role jobs may use them when integrated.
revoke all on function public.hawkim_riyadh_date(timestamptz) from public;
revoke all on function public.hawkim_add_working_days(date, integer) from public;
revoke all on function public.hawkim_riyadh_end_of_day(date) from public;
revoke all on function public.hawkim_review_due_at(timestamptz, integer) from public;
revoke all on function public.hawkim_review_response_due_at(timestamptz) from public;
revoke all on function public.hawkim_review_response_counts_from(timestamptz) from public;
revoke all on function public.hawkim_utf16_length(text) from public;
revoke all on function public.hawkim_trim_review_text(text) from public;
revoke all on function public.hawkim_validate_review_note(text) from public;
revoke all on function public.hawkim_validate_sop_title(text) from public;

-- Conditional grants keep the migration testable in ordinary local PostgreSQL.
do $$
declare
  application_role text;
  helper regprocedure;
begin
  foreach application_role in array array['authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = application_role) then
      foreach helper in array array[
        'public.hawkim_riyadh_date(timestamptz)'::regprocedure,
        'public.hawkim_add_working_days(date,integer)'::regprocedure,
        'public.hawkim_riyadh_end_of_day(date)'::regprocedure,
        'public.hawkim_review_due_at(timestamptz,integer)'::regprocedure,
        'public.hawkim_review_response_due_at(timestamptz)'::regprocedure,
        'public.hawkim_review_response_counts_from(timestamptz)'::regprocedure,
        'public.hawkim_utf16_length(text)'::regprocedure,
        'public.hawkim_trim_review_text(text)'::regprocedure,
        'public.hawkim_validate_review_note(text)'::regprocedure,
        'public.hawkim_validate_sop_title(text)'::regprocedure
      ] loop
        execute format('grant execute on function %s to %I', helper, application_role);
      end loop;
    end if;
  end loop;
end;
$$;
