-- The timeline event for a changed review deadline. Alone in its file: Postgres can't use a new
-- enum value in the transaction that adds it, and 20261101170100 names it in a read policy.

alter type public.timeline_event_type add value 'review-deadline-changed';
