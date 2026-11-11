-- Run on a disposable LOCAL database right after supabase/scripts/rollback_invitation_resend.sql:
-- checks that the rollback left nothing of 20261112130000_invitation_resend.sql behind.
do $$
begin
  assert to_regclass('public.user_invitations') is null, 'table dropped';
  assert to_regprocedure('public.invitation_lifetime()') is null;
  assert to_regprocedure('public.record_invitation_sent(uuid)') is null;
  assert to_regprocedure('public.mark_account_activated()') is null;
  assert to_regprocedure('public.get_my_expired_invitations()') is null;
  assert to_regprocedure('public.claim_invitation_resend(uuid)') is null;
  assert to_regprocedure('public.revert_invitation_resend(uuid, timestamptz)') is null;
  -- What the migration relied on is untouched.
  assert to_regprocedure('public.is_active_admin(uuid)') is not null, 'is_active_admin kept';
  assert to_regclass('public.super_admin') is not null, 'super_admin kept';
end;
$$;
