-- Undoes 20261101170100_change_review_deadline.sql. Only if something goes wrong after applying it.
-- Run it yourself in the Supabase SQL Editor (it is not a migration), and only AFTER the app is back
-- on REVIEW_DEADLINE_EDITING_ACTIVE = false.
--
-- FIRST run this. A pending request listed here can't be accepted after the rollback, because its
-- duration is over the old limit of 30 working days: decide what to do with it before going on.
--
--   select id, sop_id, review_duration_days from public.review_requests
--   where status = 'pending' and review_duration_days > 30;
--
-- It removes change_review_deadline and restores the review duration limit of 1 to 30 and the
-- timeline read policy as they were. No row changes: changed deadlines and their timeline events
-- stay, and a request that moved from calendar-v1 stays on the working-day policy. The limit on the
-- table is restored as "not valid", so it applies to new rows only and keeps any longer durations
-- saved already. The two event columns and the enum value stay, because the app may read the
-- columns and Postgres can't easily remove the value; both are harmless. Both migrations stay
-- recorded as applied, so a later fix goes in as a new migration.

begin;

drop function public.change_review_deadline(uuid, integer);

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type = 'response'
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);

create or replace function public.check_review_options(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person uuid;
begin
  if coalesce(cardinality(p_reviewer_ids), 0) = 0
     or cardinality(p_reviewer_ids) <> (select count(distinct u) from unnest(p_reviewer_ids) as u) then
    raise exception 'Select one or more different eligible internal reviewers' using errcode = 'check_violation';
  end if;
  foreach person in array p_reviewer_ids loop
    if not public.is_eligible_reviewer(p_sop_id, person) then
      raise exception 'Select eligible reviewers from the SOP home department; Authors and co-authors cannot review' using errcode = 'check_violation';
    end if;
  end loop;
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'Submission notes must be at most 500 characters' using errcode = 'check_violation';
  end if;
  if p_review_duration_days is not null and p_review_duration_days not between 1 and 30 then
    raise exception 'Choose an optional review duration of 1 to 30 working days' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.hawkim_add_working_days(p_from date, p_days integer)
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

alter table public.review_requests drop constraint review_requests_review_duration_days_check;
alter table public.review_requests
  add constraint review_requests_review_duration_days_check check (review_duration_days between 1 and 30) not valid;

notify pgrst, 'reload schema';

commit;
