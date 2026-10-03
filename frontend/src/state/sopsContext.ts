import { createContext, useContext } from 'react'
import type { ReviewRole, Sop } from '../data/mock/types'
import type { UploadedFile } from '../lib/workflow'

/** What the author provides when uploading; everything else is set by the store. */
export type NewDraft = Pick<Sop, 'title' | 'departmentId' | 'description'> & UploadedFile

export interface SopsStore {
  /** Every SOP, at every lifecycle stage (the directory shows the published ones). */
  sops: Sop[]
  /** Saves a new draft by the current user (next free code, version 1.0, today) and returns it. */
  addDraft: (draft: NewDraft) => Sop

  // Author actions (current user). Each throws if not allowed in the SOP's current status.
  submitForReview: (sopId: string, reviewerId: string, approverId: string, note?: string) => void
  replaceFile: (sopId: string, file: UploadedFile) => void
  uploadNewVersion: (sopId: string, file: UploadedFile) => void
  resubmit: (sopId: string, note?: string) => void

  // Reviewer / approver actions (the assigned person is the actor). Used by the
  // development-only demo panel until the reviewer and approver screens exist.
  returnWithComment: (sopId: string, role: ReviewRole, text: string) => void
  forwardToApprover: (sopId: string) => void
  approve: (sopId: string) => void
  publish: (sopId: string) => void
}

export const SopsContext = createContext<SopsStore | null>(null)

/** Access the SOPs store. Must be used inside <SopsProvider>. */
export function useSops(): SopsStore {
  const store = useContext(SopsContext)
  if (!store) throw new Error('useSops must be used inside <SopsProvider>')
  return store
}
