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
