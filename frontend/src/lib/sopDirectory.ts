import type { SopTabKey } from '../content/types'
import type { DepartmentId, Sop, SopFileType } from '../data/mock/types'

export type SopDocumentFilter = 'all' | SopFileType

/** Search only inside the active department's published directory, then apply tab ordering. */
export function filterDirectorySops(
  all: Sop[], departmentId: DepartmentId, tab: SopTabKey, query = '', documentType: SopDocumentFilter = 'all',
): Sop[] {
  const search = query.trim().toLowerCase()
  const visible = all.filter((sop) =>
    sop.status === 'published' && sop.departmentId === departmentId &&
    (documentType === 'all' || sop.fileType === documentType) &&
    (!search || sop.code.toLowerCase().includes(search) || sop.title.toLowerCase().includes(search)),
  )
  return tab === 'recent'
    ? visible.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    : visible.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
}
