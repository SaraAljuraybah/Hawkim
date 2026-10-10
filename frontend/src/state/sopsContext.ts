import { createContext, useContext } from 'react'
import type { Sop } from '../data/mock/types'
import type { UploadedFile } from '../lib/workflow'

/** What the author provides when uploading; everything else is set by the store. */
export type NewDraft = Pick<Sop, 'title' | 'departmentId' | 'description' | 'coAuthorIds'> & UploadedFile

export interface SubmitOptions {
  reviewerIds: string[]
  approverIds: string[]
  /** Optional: a stage without due days has no due date. */
  reviewDueDays?: number
  approvalDueDays?: number
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
  /** Uploads the next version (Draft or Returned) and starts a compliance check of it. */
  uploadVersion: (sopId: string, file: UploadedFile) => void
  /** Main author: deletes a version (Draft or Returned; at least one remains). */
  deleteVersion: (sopId: string, version: string) => void
  /** Author or co-author: replies to the latest round's comments. */
  addResponse: (sopId: string, text: string) => void
  /** Adds one or more co-authors in a single update. */
  addCoAuthors: (sopId: string, userIds: string[]) => void
  removeCoAuthor: (sopId: string, userId: string) => void
  /**
   * Runs a compliance check of the current version (PBI 4, 29). It is "running"
   * for a moment, then saves its report. Throws if a check is already running.
   */
  runCheck: (sopId: string) => void

  // Per-person reviewer and approver decisions (the review page, and the development-only
  // demo panel). Complete review and Approve take an optional comment.
  completeReview: (sopId: string, reviewerId: string, text?: string) => void
  returnAsReviewer: (sopId: string, reviewerId: string, text: string) => void
  /** An assigned reviewer adds a reviewer from another department (PBI 23). */
  routeToReviewer: (sopId: string, reviewerId: string, newReviewerId: string, note?: string) => void
  approveAs: (sopId: string, approverId: string, text?: string) => void
  returnAsApprover: (sopId: string, approverId: string, text: string) => void
  publishAs: (sopId: string, approverId: string) => void

  /** DEVELOPMENT ONLY: move this SOP's due dates `days` earlier (to test Overdue). */
  shiftDueDates: (sopId: string, days: number) => void
  /** DEVELOPMENT ONLY: when on, the next compliance check started fails instead of completing (then it turns off). */
  failNextCheck: boolean
  setFailNextCheck: (on: boolean) => void
}

export const SopsContext = createContext<SopsStore | null>(null)

/** Access the SOPs store. Must be used inside <SopsProvider>. */
export function useSops(): SopsStore {
  const store = useContext(SopsContext)
  if (!store) throw new Error('useSops must be used inside <SopsProvider>')
  return store
}
