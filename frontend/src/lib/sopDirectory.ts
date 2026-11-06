import type { DepartmentId, Sop, SopFileType } from '../data/mock/types'
import type { SopTabKey } from '../content/types'
import type { MySopSort } from './mySops'
import { parsePage, readChoice } from './pagination'

export type SopDocumentFilter = 'all' | SopFileType

/** The directory section shown: the active department's SOPs, or Others (SOPs of deleted departments). */
export const OTHERS_SECTION = '__others__'

/**
 * Search only inside the active department's published directory (or Others), ordered by the date
 * shown on the card. A department's directory never includes SOPs moved to Others.
 */
export function filterDirectorySops(
  all: Sop[], departmentId: DepartmentId | typeof OTHERS_SECTION, query = '', documentType: SopDocumentFilter = 'all', sort: MySopSort = 'newest',
): Sop[] {
  const search = query.trim().toLowerCase()
  const inSection = (sop: Sop) => departmentId === OTHERS_SECTION
    ? sop.directoryGroup === 'others'
    : sop.directoryGroup !== 'others' && sop.departmentId === departmentId
  const visible = all.filter((sop) =>
    sop.status === 'published' && inSection(sop) &&
    (documentType === 'all' || sop.fileType === documentType) &&
    (!search || sop.code.toLowerCase().includes(search) || sop.title.toLowerCase().includes(search)),
  )
  const direction = sort === 'oldest' ? 1 : -1
  // SOPs with the same date stay in code order in both directions.
  return visible.sort((a, b) =>
    direction * a.lastUpdated.localeCompare(b.lastUpdated) || a.code.localeCompare(b.code, 'en', { numeric: true }))
}

/** The SOP Directory in the URL: the tab, search, sort, file type and page (defaults add nothing). */
export interface DirectoryUrlState {
  tab: SopTabKey
  query: string
  sort: MySopSort
  documentType: SopDocumentFilter
  page: number
}

export const DIRECTORY_URL_DEFAULTS = { tab: 'all', q: '', sort: 'newest', type: 'all', page: '1' }

/** Reads the directory from the URL; an invalid value means its default (Others falls back to All when it isn't shown). */
export function readDirectoryUrl(params: URLSearchParams): DirectoryUrlState {
  return {
    tab: readChoice(params, 'tab', ['all', 'recent', 'others'] as const, 'all'),
    query: params.get('q') ?? '',
    sort: readChoice(params, 'sort', ['newest', 'oldest'] as const, 'newest'),
    documentType: readChoice(params, 'type', ['all', 'pdf', 'docx'] as const, 'all'),
    page: parsePage(params.get('page')),
  }
}
