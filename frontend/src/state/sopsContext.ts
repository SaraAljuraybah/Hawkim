import { createContext, useContext } from 'react'
import type { Sop } from '../data/mock/types'
import type { UploadedFile } from '../lib/workflow'

/** What the author provides when uploading; everything else is set by the store. */
export type NewDraft = Pick<Sop, 'title' | 'departmentId' | 'description' | 'coAuthorIds'> & UploadedFile

export interface SubmitOptions {
  reviewerIds: string[]
  approverIds: string[]
  reviewDueDays: number
  approvalDueDays: number
  note?: string
}

export interface SopsStore {
  /** Every SOP, at every lifecycle stage (the directory shows the published ones). */
  sops: Sop[]
  /** Saves a new draft by the current user (next free code, version 1.0, today) and returns it. */
  addDraft: (draft: NewDraft) => Sop

  // Actions by the current user (author or co-author). Each throws if not allowed.
  submitForReview: (sopId: string, options: SubmitOptions) => void
  resubmit: (sopId: string, note?: string) => void
  replaceFile: (sopId: string, file: UploadedFile) => void
  uploadNewVersion: (sopId: string, file: UploadedFile) => void
  /** Adds one or more co-authors in a single update. */
  addCoAuthors: (sopId: string, userIds: string[]) => void
  removeCoAuthor: (sopId: string, userId: string) => void

  // Per-person reviewer and approver decisions. Used by the development-only demo
  // panel until the reviewer and approver screens exist.
  completeReview: (sopId: string, reviewerId: string) => void
  returnAsReviewer: (sopId: string, reviewerId: string, text: string) => void
  approveAs: (sopId: string, approverId: string) => void
  returnAsApprover: (sopId: string, approverId: string, text: string) => void
  publishAs: (sopId: string, approverId: string) => void

  /** DEVELOPMENT ONLY: move this SOP's due dates `days` earlier (to test Overdue). */
  shiftDueDates: (sopId: string, days: number) => void
}

export const SopsContext = createContext<SopsStore | null>(null)

/** Access the SOPs store. Must be used inside <SopsProvider>. */
export function useSops(): SopsStore {
  const store = useContext(SopsContext)
  if (!store) throw new Error('useSops must be used inside <SopsProvider>')
  return store
}
