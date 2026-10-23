import { useEffect, useState } from 'react'

/** Refresh active deadline labels each minute and at the exact expiry timestamp.
 * When no deadline is supplied, it acts as a stable, periodically refreshed clock
 * for form date pickers and future deadline previews (including crossing midnight).
 */
export function useDeadlineClock(deadline: string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const deadlineTimestamp = deadline ? new Date(deadline).getTime() : undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    function refresh() {
      const timestamp = Date.now()
      setNow(timestamp)
      const remaining = deadlineTimestamp === undefined ? 60_000 : deadlineTimestamp - timestamp
      if (remaining > 0) timer = setTimeout(refresh, Math.min(60_000, remaining))
    }
    refresh()
    return () => clearTimeout(timer)
  }, [deadline, active])
  return now
}
