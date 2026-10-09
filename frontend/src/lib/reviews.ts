import type { Sop } from '../data/mock/types'
import { currentDueAt, isOverdue } from './workflow'

/*
 * A reviewer's or approver's assignments (My Reviews, PBI 7, 10, 25), from the
 * workflow state of each SOP. Pure functions.
 */

/**
 * - todo:    something is needed from them now;
 * - waiting: the SOP is with someone else first (Returned to the author, or still in
 *            review for an approver);
 * - done:    their decision is made and nothing else is needed, or the SOP is published.
 */
export type TaskGroup = 'todo' | 'waiting' | 'done'
/** What's needed in To do. */
export type TaskNeed = 'review' | 'approval' | 'publish'

export interface ReviewTask {
  sop: Sop
  role: 'reviewer' | 'approver'
  group: TaskGroup
  need?: TaskNeed
  /** Their decision in the current round, and when they made it. */
  decision: string
  decidedAt?: string
  /** The open stage's due date (In Review or In Approval), if any. */
  dueAt?: string
}

/** One task per SOP the user is assigned to (a person is never both reviewer and approver on one SOP). */
export function reviewTasks(userId: string, sops: Sop[]): ReviewTask[] {
  const tasks: ReviewTask[] = []
  for (const sop of sops) {
    const dueAt = currentDueAt(sop)
    const reviewer = sop.reviewers.find((person) => person.userId === userId)
    if (reviewer) {
      const group: TaskGroup =
        sop.status === 'returned'
          ? 'waiting'
          : sop.status === 'in-review' && reviewer.decision === 'pending'
            ? 'todo'
            : 'done'
      tasks.push({
        sop,
        role: 'reviewer',
        group,
        ...(group === 'todo' ? { need: 'review' as const } : {}),
        decision: reviewer.decision,
        decidedAt: reviewer.decidedAt,
        dueAt,
      })
      continue
    }
    const approver = sop.approvers.find((person) => person.userId === userId)
    if (approver) {
      let group: TaskGroup = 'done'
      let need: TaskNeed | undefined
      if (sop.status === 'returned' || sop.status === 'in-review') group = 'waiting'
      else if (sop.status === 'in-approval' && approver.decision === 'pending') [group, need] = ['todo', 'approval']
      else if (sop.status === 'approved') [group, need] = ['todo', 'publish']
      tasks.push({ sop, role: 'approver', group, ...(need ? { need } : {}), decision: approver.decision, decidedAt: approver.decidedAt, dueAt })
    }
  }
  return tasks
}

/** When the SOP was last sent for review (submitted or resubmitted). */
function sentAt(sop: Sop): string {
  return (
    [...sop.timeline].reverse().find((event) => event.type === 'submitted' || event.type === 'resubmitted')?.createdAt ??
    sop.lastUpdated
  )
}

/** Earlier due dates first; no due date last. ISO dates compare correctly as strings. */
function byDueDate(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a < b ? -1 : 1
}

/** To do order: overdue first, then the nearest due date (none last), then the oldest sent. */
export function sortTodo(tasks: ReviewTask[], now = Date.now()): ReviewTask[] {
  const overdue = (task: ReviewTask) =>
    isOverdue(task.sop, task.sop.status === 'in-approval' ? 'approval' : 'review', now) ? 0 : 1
  return [...tasks].sort(
    (a, b) =>
      overdue(a) - overdue(b) ||
      byDueDate(a.dueAt, b.dueAt) ||
      (sentAt(a.sop) < sentAt(b.sop) ? -1 : sentAt(a.sop) > sentAt(b.sop) ? 1 : 0),
  )
}

/** Waiting and Done: most recently updated first. */
export function sortRecent(tasks: ReviewTask[]): ReviewTask[] {
  return [...tasks].sort((a, b) => b.sop.lastUpdated.localeCompare(a.sop.lastUpdated))
}
