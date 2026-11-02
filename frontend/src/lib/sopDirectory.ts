import type { DepartmentId, Sop, SopFileType } from '../data/mock/types'
import type { MySopSort } from './mySops'

export type SopDocumentFilter = 'all' | SopFileType

/** Search only inside the active department's published directory, ordered by the date shown on the card. */
export function filterDirectorySops(
  all: Sop[], departmentId: DepartmentId, query = '', documentType: SopDocumentFilter = 'all', sort: MySopSort = 'newest',
): Sop[] {
  const search = query.trim().toLowerCase()
  const visible = all.filter((sop) =>
    sop.status === 'published' && sop.departmentId === departmentId &&
    (documentType === 'all' || sop.fileType === documentType) &&
    (!search || sop.code.toLowerCase().includes(search) || sop.title.toLowerCase().includes(search)),
  )
  const direction = sort === 'oldest' ? 1 : -1
  // SOPs with the same date stay in code order in both directions.
  return visible.sort((a, b) =>
    direction * a.lastUpdated.localeCompare(b.lastUpdated) || a.code.localeCompare(b.code, 'en', { numeric: true }))
}
