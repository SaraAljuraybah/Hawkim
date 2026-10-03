import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { currentUser } from '../data/mock/currentUser'
import { sops as seedSops } from '../data/mock/sops'
import type { Sop } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { nextSopCode } from '../lib/sopCodes'
import { SopsContext, type NewDraft, type SopsStore } from './sopsContext'

/**
 * In-memory store of every SOP (one list for the directory, My SOPs and the workflow).
 * Starts with the sample data; changes are lost on reload.
 * TODO: Replace with API calls once the backend exists.
 */
export function SopsProvider({ children }: { children: ReactNode }) {
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const [sops, setSops] = useState<Sop[]>(seedSops)

  const addDraft = useCallback(
    (draft: NewDraft) => {
      const code = nextSopCode(
        sops.filter((sop) => sop.authorId === user.id).map((sop) => sop.code),
        sops.map((sop) => sop.code),
      )
      const created: Sop = {
        ...draft,
        id: code.toLowerCase(),
        code,
        version: '1.0',
        status: 'draft',
        authorId: user.id,
        lastUpdated: todayIsoDate(),
      }
      setSops((current) => [created, ...current])
      return created
    },
    [sops, user.id],
  )

  const store = useMemo<SopsStore>(() => ({ sops, addDraft }), [sops, addDraft])

  return <SopsContext.Provider value={store}>{children}</SopsContext.Provider>
}
