-- PROPOSAL — NOT APPROVED, NOT APPLIED.
-- Lives in supabase/proposals/ so that `supabase db push` never picks it up. When the database
-- owner approves it, it moves to supabase/migrations/ with a timestamp later than the latest
-- applied migration, together with 20261029010000_internal_review_working_days.sql (this file first).
--
-- Working-day calendar helpers for review deadlines (Riyadh working-day policy):
-- - Time zone Asia/Riyadh; working days Sunday to Thursday; Friday and Saturday never count.
-- - The starting date (the date a request is sent, or accepted) is never counted.
-- - A deadline ends at 23:59:59.999 Riyadh time on its last working date.
-- - No public-holiday calendar.
--
-- The helpers are pure: they take fixed inputs and never read now(), so they give the same
-- result for the same input and can be checked with fixed examples. They do not read or change
-- any table, and they never recalculate saved deadlines.

-- The Riyadh calendar date of a moment in time.
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

-- The date p_days working days after p_from. p_from itself never counts; only Sunday to
-- Thursday count. Plain date arithmetic, so the session time zone does not matter.
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

-- The end of a Riyadh date: 23:59:59.999 (milliseconds, matching JavaScript Date precision).
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

-- Review due moment: p_duration working days after the Riyadh date of acceptance.
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

-- Response due moment: the end of the second working date after the Riyadh date the request is
-- sent. Fixed; the time of day it is sent does not change it (there is no 16:00 rule).
create function public.hawkim_review_response_due_at(p_requested_at timestamptz)
returns timestamptz
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select public.hawkim_review_due_at(p_requested_at, 2);
$$;

-- Internal helpers, like riyadh_today() and riyadh_end_of_day() in 20261026150000_internal_review.sql:
-- the review functions (security definer) call them; the browser cannot.
revoke execute on function public.hawkim_riyadh_date(timestamptz) from public, anon, authenticated;
revoke execute on function public.hawkim_add_working_days(date, integer) from public, anon, authenticated;
revoke execute on function public.hawkim_riyadh_end_of_day(date) from public, anon, authenticated;
revoke execute on function public.hawkim_review_due_at(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.hawkim_review_response_due_at(timestamptz) from public, anon, authenticated;
