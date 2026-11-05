import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../services/supabase'
import { useSession } from '../../state/sessionContext'
import { LoadFailedPage } from '../../pages/LoadFailedPage'
import { NotFoundPage } from '../../pages/NotFoundPage'
import { PageLoading } from '../ui/PageLoading'

/** Verify current backend authorization before mounting any Admin interface.
 * Session roles alone may be stale after an Auth ban, profile deletion or role revocation.
 * RPCs independently authorize every read/write; this gate controls presentation only.
 */
export function AdminAuthorizationGate({ children }: { children: ReactNode }) {
  const userId = useSession().user?.id ?? ''
  const [result, setResult] = useState<{ userId: string; state: 'allowed' | 'denied' | 'error' } | null>(null)
  useEffect(() => {
    let active = true
    let sequence = 0
    const verify = async () => {
      const request = ++sequence
      setResult(null)
      try {
        const { data, error } = await supabase().rpc('can_manage_organization')
        if (active && request === sequence) setResult({ userId, state: error ? 'error' : data === true ? 'allowed' : 'denied' })
      } catch {
        if (active && request === sequence) setResult({ userId, state: 'error' })
      }
    }
    if (userId) void verify()
    window.addEventListener('focus', verify)
    return () => { active = false; window.removeEventListener('focus', verify) }
  }, [userId])
  if (!userId || result?.userId !== userId) return <PageLoading fullScreen />
  if (result.state === 'error') return <LoadFailedPage />
  if (result.state === 'denied') return <NotFoundPage />
  return children
}
