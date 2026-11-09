import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchManagement, ORGANIZATION_CHANGED, organizationEvents, type ManagementSnapshot } from '../services/organizationAdmin'
import { useCurrentUser } from '../state/sessionContext'

/** One server snapshot; refresh on mutations, window focus, and while the page is open. */
export function useOrganizationManagement() {
  const userId = useCurrentUser().id
  const generation = useRef(0)
  const [result, setResult] = useState<{ userId?: string; data?: ManagementSnapshot; error?: string }>({})
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const data = await fetchManagement()
      if (request === generation.current) setResult({ userId, data })
    } catch (error) {
      if (request === generation.current) setResult({ userId, error: (error as Error).message })
    }
  }, [userId])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) return refresh() })
    const reload = () => { void refresh() }
    const requests = generation
    const timer = window.setInterval(reload, 30000)
    window.addEventListener('focus', reload)
    organizationEvents.addEventListener(ORGANIZATION_CHANGED, reload)
    return () => { active = false; ++requests.current; window.clearInterval(timer); window.removeEventListener('focus', reload); organizationEvents.removeEventListener(ORGANIZATION_CHANGED, reload) }
  }, [refresh])
  return { data: result.userId === userId ? result.data : undefined, error: result.userId === userId ? result.error : undefined, refresh }
}
