import type { Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { isAuthorOrCoAuthor } from './workflow'

export type MySopCategory = 'new' | 'progress' | 'completed'
export type MySopRole = 'all' | 'main' | 'coauthor'
export type MySopSort = 'newest' | 'oldest'

const categories: Record<MySopCategory, readonly SopStatus[]> = {
  new: ['draft'],
  progress: ['in-review', 'returned', 'in-approval'],
  completed: ['approved', 'published'],
}

export interface MySopFilters {
  category: MySopCategory
  query?: string
  role?: MySopRole
}

/** The SOPs of New SOPs and In Progress: the main author may delete them; never approved or published ones. */
export const DELETABLE_STATUSES: readonly SopStatus[] = [...categories.new, ...categories.progress]

/** Only the main author, and only in New SOPs and In Progress (the database checks it again). */
export function canDeleteSop(sop: Sop, userId: string): boolean {
  return !!userId && sop.authorId === userId && DELETABLE_STATUSES.includes(sop.status)
}

/** Minutes after which a check still marked running was left behind, as in start_compliance_check and delete_sop. */
const LEFT_BEHIND_MINUTES = { sample: 5, service: 30 }

/** A compliance check is really still running (one left behind doesn't block deleting the SOP). */
export function hasRunningCheck(sop: Sop, now = Date.now()): boolean {
  return sop.complianceChecks.some((check) => {
    if (check.status !== 'running') return false
    const minutes = (check.engine ?? 'sample') === 'sample' ? LEFT_BEHIND_MINUTES.sample : LEFT_BEHIND_MINUTES.service
    return now - new Date(check.startedAt).getTime() < minutes * 60_000
  })
}

/** Why deleting an SOP or a version was refused (the delete-sop Edge Function's codes); `failed` for anything unexpected. */
export type SopDeleteErrorCode = 'not-found' | 'not-allowed' | 'not-deletable' | 'check-running' | 'invalid-reason' | 'failed'
const DELETE_ERROR_CODES: readonly string[] = ['not-found', 'not-allowed', 'not-deletable', 'check-running', 'invalid-reason']

export function isSopDeleteErrorCode(value: unknown): value is SopDeleteErrorCode {
  return typeof value === 'string' && DELETE_ERROR_CODES.includes(value)
}

/** A refused delete: its code, and the database's message when there is one. */
export class SopDeleteError extends Error {
  readonly code: SopDeleteErrorCode
  constructor(code: SopDeleteErrorCode, message: string) {
    super(message)
    this.name = 'SopDeleteError'
    this.code = code
  }
}

/** Home-department ownership is independent of the directory being browsed. */
export function authoredSopsFor(sops: Sop[], userId: string, departmentId: string): Sop[] {
  return sops
    .filter((sop) => sop.departmentId === departmentId && isAuthorOrCoAuthor(sop, userId))
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
}

/** Presentation filters never change lifecycle statuses or the input data. */
export function filterMySops(sops: Sop[], userId: string, filters: MySopFilters): Sop[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''
  return sops.filter((sop) =>
    categories[filters.category].includes(sop.status) &&
    (!query || sop.title.toLocaleLowerCase().includes(query)) &&
    (!filters.role || filters.role === 'all' || (filters.role === 'main' ? sop.authorId === userId : sop.authorId !== userId)),
  )
}

/** Sorts by last updated date; `sops` are newest first (authoredSopsFor), so oldest first is the exact reverse. */
export function sortMySops(sops: Sop[], sort: MySopSort): Sop[] {
  return sort === 'oldest' ? [...sops].reverse() : sops
}

/** The distinct SOP titles to suggest in the search, A to Z. */
export function mySopTitles(sops: Sop[]): string[] {
  return [...new Set(sops.map((sop) => sop.title))].sort((a, b) => a.localeCompare(b))
}
