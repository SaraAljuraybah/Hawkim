import { createContext, useContext } from 'react'
import type { AuthoredSop } from '../data/mock/types'

/** What the author provides when uploading; everything else is set by the store. */
export type NewDraft = Pick<AuthoredSop, 'title' | 'departmentId' | 'description' | 'fileName' | 'fileType'>

export interface AuthoredSopsStore {
  /** All SOPs authored by the current user (every department and status). */
  authoredSops: AuthoredSop[]
  /** Saves a new draft (next free code, version 1.0, today) and returns it. */
  addDraft: (draft: NewDraft) => AuthoredSop
}

export const AuthoredSopsContext = createContext<AuthoredSopsStore | null>(null)

/** Access the author's SOPs. Must be used inside <AuthoredSopsProvider>. */
export function useAuthoredSops(): AuthoredSopsStore {
  const store = useContext(AuthoredSopsContext)
  if (!store) throw new Error('useAuthoredSops must be used inside <AuthoredSopsProvider>')
  return store
}
