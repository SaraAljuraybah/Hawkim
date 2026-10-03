import { createContext, useContext } from 'react'
import type { Sop } from '../data/mock/types'

/** What the author provides when uploading; everything else is set by the store. */
export type NewDraft = Pick<Sop, 'title' | 'departmentId' | 'description' | 'fileName' | 'fileType' | 'fileUrl'>

export interface SopsStore {
  /** Every SOP, at every lifecycle stage (the directory shows the published ones). */
  sops: Sop[]
  /** Saves a new draft by the current user (next free code, version 1.0, today) and returns it. */
  addDraft: (draft: NewDraft) => Sop
}

export const SopsContext = createContext<SopsStore | null>(null)

/** Access the SOPs store. Must be used inside <SopsProvider>. */
export function useSops(): SopsStore {
  const store = useContext(SopsContext)
  if (!store) throw new Error('useSops must be used inside <SopsProvider>')
  return store
}
