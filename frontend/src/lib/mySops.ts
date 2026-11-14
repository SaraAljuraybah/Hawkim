import type { MySopsContent } from '../content/types'
import type { Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { parsePage, readChoice, resultsParams } from './pagination'
import { isAuthorOrCoAuthor } from './workflow'

export type MySopCategory = 'new' | 'progress' | 'completed'
export type MySopRole = 'all' | 'main' | 'coauthor'
/** The Sort field's orders: Last Updated (newest or oldest first) and Title (A to Z or Z to A). */
export const MY_SOP_SORTS = ['newest', 'oldest', 'title-asc', 'title-desc'] as const
export type MySopSort = (typeof MY_SOP_SORTS)[number]
export type MySopSortGroup = 'lastUpdated' | 'title'

/** The heading the sort is listed under in the Sort field. */
export const mySopSortGroup = (sort: MySopSort): MySopSortGroup => (sort.startsWith('title-') ? 'title' : 'lastUpdated')

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

/** The message for a refused delete (the content file has one per refusal code). */
export function deleteErrorText(failure: unknown, content: MySopsContent['deleteSop']): string {
  return content.errors[failure instanceof SopDeleteError ? failure.code : 'failed']
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

/**
 * Sorts by last updated date or by title. `sops` are newest first (authoredSopsFor), so oldest first is
 * the exact reverse, and SOPs with the same title stay newest first (the sort is stable).
 */
export function sortMySops(sops: Sop[], sort: MySopSort): Sop[] {
  if (sort === 'newest') return sops
  if (sort === 'oldest') return [...sops].reverse()
  const direction = sort === 'title-desc' ? -1 : 1
  return [...sops].sort((a, b) => direction * a.title.localeCompare(b.title))
}

/** The distinct SOP titles to suggest in the search, A to Z. */
export function mySopTitles(sops: Sop[]): string[] {
  return [...new Set(sops.map((sop) => sop.title))].sort((a, b) => a.localeCompare(b))
}

/** My SOPs in the URL: the tab, search, sort, My Role and page (defaults add nothing). */
export interface MySopsUrlState {
  category: MySopCategory
  query: string
  sort: MySopSort
  role: MySopRole
  page: number
}

export const MY_SOPS_URL_DEFAULTS = { tab: 'new', q: '', sort: 'newest', role: 'all', page: '1' }

/** Clear Filters, as on Staff and Admins: the URL without the search, the role and the sort, back on page 1 (the tab stays). */
export function clearedMySopsParams(current: URLSearchParams): URLSearchParams {
  return resultsParams(current, { q: undefined, role: undefined, sort: undefined }, MY_SOPS_URL_DEFAULTS)
}

/** Reads My SOPs from the URL; an invalid value means its default. */
export function readMySopsUrl(params: URLSearchParams): MySopsUrlState {
  return {
    category: readChoice(params, 'tab', ['new', 'progress', 'completed'] as const, 'new'),
    query: params.get('q') ?? '',
    sort: readChoice(params, 'sort', MY_SOP_SORTS, 'newest'),
    role: readChoice(params, 'role', ['all', 'main', 'coauthor'] as const, 'all'),
    page: parsePage(params.get('page')),
  }
}
