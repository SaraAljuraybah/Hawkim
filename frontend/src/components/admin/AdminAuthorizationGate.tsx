import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../services/supabase'
import { useSession } from '../../state/sessionContext'
import { LoadFailedPage } from '../../pages/LoadFailedPage'
import { NotFoundPage } from '../../pages/NotFoundPage'
import { PageLoading } from '../ui/PageLoading'

/**
 * Verify current backend authorization before mounting any Admin interface.
 * Session roles alone may be stale after an Auth ban, profile deletion or role revocation.
 * RPCs independently authorize every read/write; this gate controls presentation only.
 *
 * The first check shows a loader. Later checks (on window focus) keep the current screen while
 * they run, so an open form isn't lost, and then remove it if access was revoked or can't be
 * confirmed (fails closed).
 */
export function AdminAuthorizationGate({ children, permission = 'can_manage_organization', denied }: {
  children: ReactNode; permission?: 'can_manage_organization' | 'can_read_organizational_structure'
  /** Shown when the backend refuses (default: the full-page Not Found). */
  denied?: ReactNode
}) {
  const userId = useSession().user?.id ?? ''
  const [result, setResult] = useState<{ userId: string; state: 'allowed' | 'denied' | 'error' } | null>(null)
  useEffect(() => {
    let active = true
    let sequence = 0
    const verify = async () => {
      const request = ++sequence
      try {
        const { data, error } = await supabase().rpc(permission)
        if (active && request === sequence) setResult({ userId, state: error ? 'error' : data === true ? 'allowed' : 'denied' })
      } catch {
        if (active && request === sequence) setResult({ userId, state: 'error' })
      }
    }
    if (userId) void verify()
    window.addEventListener('focus', verify)
    return () => { active = false; window.removeEventListener('focus', verify) }
  }, [userId, permission])
  // A result for another identity never carries over.
  if (!userId || result?.userId !== userId) return <PageLoading fullScreen />
  if (result.state === 'error') return <LoadFailedPage />
  if (result.state === 'denied') return denied ?? <NotFoundPage />
  return children
}
