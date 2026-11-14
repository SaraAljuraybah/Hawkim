-- The timeline event for a pending request's review duration changed by the main author (see
-- 20261114130100_pending_review_duration.sql). Alone in its file: Postgres can't use a new enum value
-- in the transaction that adds it.
-- supabase/scripts/rollback_pending_review_duration.sql undoes what uses it; the value itself stays,
-- because Postgres can't drop an enum value.

alter type public.timeline_event_type add value 'review-duration-changed';
