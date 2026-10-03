import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { mockAuthoredSops } from '../data/mock/authoredSops'
import { currentUser } from '../data/mock/currentUser'
import { sops } from '../data/mock/sops'
import type { AuthoredSop } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { nextSopCode } from '../lib/sopCodes'
import { AuthoredSopsContext, type AuthoredSopsStore, type NewDraft } from './authoredSopsContext'

/**
 * In-memory store of the current user's authored SOPs, shared by My SOPs and Upload SOP.
 * Starts with the sample data; uploads are added immediately and lost on reload.
 * TODO: Replace with API calls (load the author's SOPs, upload a draft) once the backend exists.
 */
export function AuthoredSopsProvider({ children }: { children: ReactNode }) {
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const [authoredSops, setAuthoredSops] = useState<AuthoredSop[]>(mockAuthoredSops)

  const addDraft = useCallback(
    (draft: NewDraft) => {
      const code = nextSopCode(
        authoredSops.map((sop) => sop.code),
        [...authoredSops, ...sops].map((sop) => sop.code),
      )
      const created: AuthoredSop = {
        ...draft,
        id: code.toLowerCase(),
        code,
        version: '1.0',
        status: 'draft',
        authorId: user.id,
        lastUpdated: todayIsoDate(),
      }
      setAuthoredSops((current) => [created, ...current])
      return created
    },
    [authoredSops, user.id],
  )

  const store = useMemo<AuthoredSopsStore>(() => ({ authoredSops, addDraft }), [authoredSops, addDraft])

  return <AuthoredSopsContext.Provider value={store}>{children}</AuthoredSopsContext.Provider>
}
