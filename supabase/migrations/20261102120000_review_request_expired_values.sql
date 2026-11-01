-- The new values for an expired review request. Alone in its file: Postgres can't use a new enum
-- value in the transaction that adds it, and 20261102120100 uses all three.

alter type public.review_request_status add value 'expired';
alter type public.timeline_event_type add value 'review-expired';
alter type public.timeline_event_type add value 'review-request-resent';
