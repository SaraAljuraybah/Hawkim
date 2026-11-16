import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelInvitation, fetchStaffInvitations, resendInvitation,
  type CancelInvitationFailure, type ResendFailureReason, type StaffInvitation,
} from '../services/invitations'
import { withCancelled, withResent } from '../lib/staffInvitations'

export interface StaffInvitations {
  /** 'failed': they couldn't be read (Active Staff then lists everyone, as before Sent Invitations). */
  status: 'loading' | 'ready' | 'failed'
  invitations: StaffInvitation[]
  reload: () => Promise<void>
  /** Resend; on success the invitation is Sent again, from the new sending. Nothing changes on failure. */
  resend: (userId: string) => Promise<{ ok: true; email: string } | { ok: false; reason: ResendFailureReason }>
  /** Cancel; on success the invitation is cancelled (no longer on Sent Invitations, nor on Active Staff). */
  cancel: (userId: string) => Promise<{ ok: true } | { ok: false; reason: CancelInvitationFailure }>
}

/** The Staff page's staff invitations that aren't activated (get_staff_invitations), read when the page opens. */
export function useStaffInvitations(): StaffInvitations {
  const [status, setStatus] = useState<StaffInvitations['status']>('loading')
  const [invitations, setInvitations] = useState<StaffInvitation[]>([])
  const mounted = useRef(true)

  const reload = useCallback(async () => {
    try {
      const list = await fetchStaffInvitations()
      if (!mounted.current) return
      setInvitations(list)
      setStatus('ready')
    } catch {
      if (mounted.current) setStatus('failed')
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // After the first render, so it never runs during it.
    const load = window.setTimeout(() => void reload(), 0)
    return () => {
      mounted.current = false
      window.clearTimeout(load)
    }
  }, [reload])

  const resend = useCallback(async (userId: string) => {
    const result = await resendInvitation(userId)
    if (result.ok && mounted.current) {
      const sentAt = result.sentAt ?? new Date().toISOString()
      setInvitations((list) => withResent(list, userId, sentAt))
    }
    return result.ok ? { ok: true as const, email: result.email } : result
  }, [])

  const cancel = useCallback(async (userId: string) => {
    const result = await cancelInvitation(userId)
    if (result.ok && mounted.current) {
      setInvitations((list) => withCancelled(list, userId))
    }
    return result
  }, [])

  return { status, invitations, reload, resend, cancel }
}
