import { createContext, useContext } from 'react'
import type { ApprovalDecisionSnapshot, Sop } from '../data/mock/types'
import type { ApprovalSubmissionOptions } from '../lib/approval'
import type { ReviewAction } from '../lib/reviewFlow'
import type { InternalReviewOptions } from '../lib/internalReview'
import type { LoadStatus } from './useLoadAfterSignIn'

/**
 * What the author provides when uploading; everything else is set by the store and
 * the database. A new SOP has no co-authors (they're added later from the SOP page).
 */
export type NewDraft = Pick<Sop, 'title' | 'departmentId' | 'description'> & { file: File }


export type SubmitOptions = InternalReviewOptions


/** Legacy resubmission overrides. Internal rounds restart their saved allocations without overrides. */
export interface ResubmitOptions {
  dueDate?: string
  note?: string
}

export interface SopsStore {
  /** Whether the signed-in person's SOPs have been read from the database. */
  status: LoadStatus
  /** Every SOP, at every lifecycle stage (the directory shows the published ones). */
  sops: Sop[]
  /** Uploads the file and saves a new draft by the current user (the database gives it its number and v1); returns it. */
  addDraft: (draft: NewDraft) => Promise<Sop>

  // Actions by the current user (author or co-author). Each throws if not allowed.
  /** Main author: first submission from Draft, or a new version sent to the chosen reviewers. */
  submitForReview: (sopId: string, options: SubmitOptions) => void
  /** Main Author: submit this reviewed version to its configured Quality Document Controller. */
  submitForApproval: (sopId: string, options: ApprovalSubmissionOptions) => void
  reviewAction: (sopId: string, action: ReviewAction) => void
  /** Reviewer: take the task (required before completing or returning it). */
  acceptInternalReview: (sopId: string, roundId: string, assignmentId: string) => void
  /** Reviewer: turn the task down with a required reason. */
  declineInternalReview: (sopId: string, roundId: string, assignmentId: string, reason: string) => void
  decideInternalReview: (sopId: string, roundId: string, assignmentId: string, decision: 'completed' | 'returned', text?: string) => void
  /** Main author: send the current version to more reviewers (reopens a settled round). */
  addInternalReviewers: (sopId: string, options: SubmitOptions) => void
  /** Main author: remove a reviewer from the current round at any time, with a required reason. */
  removeInternalReviewer: (sopId: string, roundId: string, assignmentId: string, reason: string) => void
  /** Main author: legacy resubmission with an optional new date and comments (internal reviews use submitForReview). */
  resubmit: (sopId: string, options?: ResubmitOptions) => void
  /** Uploads the file as the next version (Draft or Returned). It isn't checked until someone runs a compliance check. */
  uploadVersion: (sopId: string, file: File) => Promise<void>
  /** Main author or its uploader: deletes a version (Draft or Returned; at least one remains). */
  deleteVersion: (sopId: string, version: string) => Promise<void>
  /** Author or co-author: replies to the latest round's comments. */
  addResponse: (sopId: string, text: string) => void
  /** Main author: adds one or more co-authors in a single update (all or none). */
  addCoAuthors: (sopId: string, userIds: string[]) => Promise<void>
  /** Main author: removes a co-author. */
  removeCoAuthor: (sopId: string, userId: string) => Promise<void>
  /**
   * Runs a compliance check of the current version (PBI 4, 29). It is "running"
   * for a moment, then saves its report. Refused if a check is already running.
   */
  runCheck: (sopId: string) => Promise<void>

  // Per-person reviewer and approver decisions (the review page, and the development-only
  // demo panel). Complete review and Approve take an optional comment.
  completeReview: (sopId: string, reviewerId: string, text?: string) => void
  returnAsReviewer: (sopId: string, reviewerId: string, text: string) => void
  /** An assigned reviewer adds a reviewer from another department (PBI 23). */
  routeToReviewer: (sopId: string, reviewerId: string, newReviewerId: string, note?: string) => void
  approveAs: (sopId: string, approverId: string, text?: string, snapshot?: ApprovalDecisionSnapshot) => void
  returnAsApprover: (sopId: string, approverId: string, text: string, snapshot?: ApprovalDecisionSnapshot) => void
  publishAs: (sopId: string, approverId: string, snapshot?: ApprovalDecisionSnapshot) => void

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
