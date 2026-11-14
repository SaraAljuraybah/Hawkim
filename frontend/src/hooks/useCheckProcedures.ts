import { useCallback, useEffect, useState } from 'react'
import type { CheckProcedures } from '../data/mock/types'
import { fetchCheckProcedures } from '../services/compliance'

export type CheckProceduresState =
  | { state: 'loading' }
  | { state: 'failed'; retry: () => void }
  | { state: 'ready'; data: CheckProcedures }

/**
 * A completed check's procedures and how many steps it checked, read when its report is shown
 * (compliance_check_procedures). `checkId` undefined (a sample check, or no report): nothing is read
 * and it stays 'loading'; the report doesn't show it then.
 */
export function useCheckProcedures(checkId: string | undefined): CheckProceduresState {
  const [result, setResult] = useState<{ checkId: string; data?: CheckProcedures; failed?: boolean } | undefined>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!checkId) return
    let current = true
    fetchCheckProcedures(checkId).then(
      (data) => current && setResult({ checkId, data }),
      () => current && setResult({ checkId, failed: true }),
    )
    return () => {
      current = false
    }
  }, [checkId, attempt])

  const retry = useCallback(() => {
    setResult(undefined)
    setAttempt((count) => count + 1)
  }, [])

  // Only the answer for this check (a version chosen since keeps 'loading' until its own arrives).
  if (!checkId || result?.checkId !== checkId) return { state: 'loading' }
  if (result.failed) return { state: 'failed', retry }
  return result.data ? { state: 'ready', data: result.data } : { state: 'loading' }
}
