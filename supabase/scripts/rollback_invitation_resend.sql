-- Undoes 20261111160000_invitation_resend.sql: drops its functions and its table. Nothing else used
-- them, and that migration changed no existing object, so nothing is restored.
-- Data loss: the recorded invitations (when each was sent, by whom, and when it was activated).
begin;

drop function if exists public.revert_invitation_resend(uuid, timestamptz);
drop function if exists public.claim_invitation_resend(uuid);
drop function if exists public.get_my_expired_invitations();
drop function if exists public.mark_account_activated();
drop function if exists public.record_invitation_sent(uuid);
drop function if exists public.invitation_lifetime();
drop table if exists public.user_invitations;

commit;
