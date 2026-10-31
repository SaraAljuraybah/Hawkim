import type { Sop } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { isAuthorOrCoAuthor } from './workflow'

export type MySopCategory = 'new' | 'progress' | 'completed'
export type MySopRole = 'all' | 'main' | 'coauthor'

const categories: Record<MySopCategory, readonly SopStatus[]> = {
  new: ['draft'],
  progress: ['in-review', 'returned', 'in-approval'],
  completed: ['approved', 'published'],
}

export interface MySopFilters {
  category: MySopCategory
  query?: string
  sopId?: string
  updatedDate?: string
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
    (!filters.sopId || sop.id === filters.sopId) &&
    (!filters.updatedDate || sop.lastUpdated.slice(0, 10) === filters.updatedDate) &&
    (!filters.role || filters.role === 'all' || (filters.role === 'main' ? sop.authorId === userId : sop.authorId !== userId)),
  )
}
