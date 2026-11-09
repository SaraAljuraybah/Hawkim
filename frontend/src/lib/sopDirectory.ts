import type { Department, DepartmentId, Sop } from '../data/mock/types'
import type { SopTabKey } from '../content/types'
import { todayIsoDate } from './format'
import type { MySopSort } from './mySops'
import { parsePage, readChoice, readList } from './pagination'
import { inDivisions } from './userAdmin'

/** The directory section shown: the active department's SOPs, or Others (SOPs of deleted departments). */
export const OTHERS_SECTION = '__others__'
/** Every department's directory at once (the System Admin's SOP Directory). Never Others. */
export const ALL_DEPARTMENTS = '__all__'

/** Recently Published: SOPs whose date (the one on the card) is within this many months. */
export const RECENT_MONTHS = 3

/** The first date (ISO) that counts as recent, RECENT_MONTHS before today in local time. */
export function recentSince(today = new Date()): string {
  const since = new Date(today.getFullYear(), today.getMonth() - RECENT_MONTHS, today.getDate())
  // A day the earlier month doesn't have (e.g. 31 May → 31 February) rolls over; use that month's last day.
  if (since.getMonth() !== (today.getMonth() - RECENT_MONTHS + 12) % 12) since.setDate(0)
  return todayIsoDate(since)
}

export interface DirectoryFilters {
  /** Only SOPs dated on or after this ISO date (Recently Published). */
  since?: string
  /** Only SOPs of departments in these divisions (NO_DIVISION: none); empty or left out means every division. */
  divisions?: string[]
  /** Looks up an SOP's department, for the division filter. */
  getDepartment?: (id: DepartmentId) => Pick<Department, 'divisionId'> | undefined
  /** Only these departments; empty or left out means every department of the section. */
  departments?: DepartmentId[]
}

/**
 * Search only inside the active department's published directory (or Others, or every department),
 * ordered by the date shown on the card. A department's directory never includes SOPs moved to Others.
 * The division and department filters are independent: an SOP must match both.
 */
export function filterDirectorySops(
  all: Sop[],
  section: DepartmentId | typeof OTHERS_SECTION | typeof ALL_DEPARTMENTS,
  query = '',
  sort: MySopSort = 'newest',
  { since, divisions = [], getDepartment, departments = [] }: DirectoryFilters = {},
): Sop[] {
  const search = query.trim().toLowerCase()
  const inSection = (sop: Sop) => section === OTHERS_SECTION
    ? sop.directoryGroup === 'others'
    : sop.directoryGroup !== 'others' && (section === ALL_DEPARTMENTS || sop.departmentId === section)
  const visible = all.filter((sop) =>
    sop.status === 'published' && inSection(sop) &&
    (divisions.length === 0 || inDivisions(getDepartment?.(sop.departmentId), divisions)) &&
    (departments.length === 0 || departments.includes(sop.departmentId)) &&
    (!since || sop.lastUpdated >= since) &&
    (!search || sop.code.toLowerCase().includes(search) || sop.title.toLowerCase().includes(search)),
  )
  const direction = sort === 'oldest' ? 1 : -1
  // SOPs with the same date stay in code order in both directions.
  return visible.sort((a, b) =>
    direction * a.lastUpdated.localeCompare(b.lastUpdated) || a.code.localeCompare(b.code, 'en', { numeric: true }))
}

/** The SOP Directory in the URL: the tab, search, sort, division and department filters and page (defaults add nothing). */
export interface DirectoryUrlState {
  tab: SopTabKey
  query: string
  sort: MySopSort
  /** The division filter (System Admin); empty means every division. */
  divisions: string[]
  /** The department filter (System Admin), as ids; empty means every department. */
  departments: DepartmentId[]
  page: number
}

export const DIRECTORY_URL_DEFAULTS = { tab: 'all', q: '', sort: 'newest', division: '', dept: '', page: '1' }

/**
 * Reads the directory from the URL; an invalid value means its default (Others falls back to All when it
 * isn't shown). Anything else in the address, such as `type` from the removed File Type filter, is ignored.
 */
export function readDirectoryUrl(params: URLSearchParams): DirectoryUrlState {
  return {
    tab: readChoice(params, 'tab', ['all', 'recent', 'others'] as const, 'all'),
    query: params.get('q') ?? '',
    sort: readChoice(params, 'sort', ['newest', 'oldest'] as const, 'newest'),
    divisions: readList(params, 'division'),
    departments: readList(params, 'dept'),
    page: parsePage(params.get('page')),
  }
}
