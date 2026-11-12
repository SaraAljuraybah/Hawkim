-- The new value for a review round that closed with nobody taking part (see
-- 20261114120100_review_back_to_draft.sql). Alone in its file: Postgres can't use a new enum value in
-- the transaction that adds it.
-- supabase/scripts/rollback_review_back_to_draft.sql undoes what uses it; the value itself stays,
-- because Postgres can't drop an enum value.

alter type public.review_round_status add value 'closed';
