import type { Permission, User } from '../data/mock/types'
import type { OrganizationDepartment, OrganizationEmployee, OrganizationHierarchy } from '../services/organization'

/*
 * Search, filters and sort for the Organizational Structure table (divisions → departments → staff).
 * Pure functions.
 */

/** "Others": staff with none of the roles the filter lists (Author, Reviewer, Approver). */
export const OTHERS_FILTER = 'others'
export type RoleFilter = Extract<Permission, 'author' | 'reviewer' | 'approver'> | typeof OTHERS_FILTER
/** The Role filter's chips, in order. */
export const ROLE_FILTERS: RoleFilter[] = ['author', 'reviewer', 'approver', OTHERS_FILTER]

const FILTER_ROLES: Permission[] = ['author', 'reviewer', 'approver']

/** The Divisions and Departments sort options, without the SOP ones. Sorting orders divisions only. */
export const ORGANIZATION_SORTS = ['default', 'name-asc', 'name-desc', 'departments-desc', 'departments-asc'] as const
export type OrganizationSort = (typeof ORGANIZATION_SORTS)[number]

/** The group of departments without a (shown) division: always last, never a Division filter choice. */
export const UNASSIGNED_GROUP_ID = 'unassigned'

export interface OrganizationFilters {
  query: string
  /** Division ids (any of them); empty: every division. */
  divisions: string[]
  /**
   * Department ids (any of them); empty: every department. Narrows only the divisions they belong
   * to: another selected division keeps all its departments.
   */
  departments: string[]
  /** Roles (any of them); empty: every person. */
  roles: RoleFilter[]
}

export interface DepartmentRow {
  department: OrganizationDepartment
  /** The staff rows to show (all of them when not filtering). */
  staff: OrganizationEmployee[]
  /** Opened automatically while filtering, because staff inside it are results. */
  autoOpen: boolean
}

export interface DivisionRow {
  id: string
  name: string
  email: string | null
  /** The "Unassigned departments" group, not a real division. */
  unassigned: boolean
  /** Every department in the division, whatever is filtered. */
  departmentCount: number
  departments: DepartmentRow[]
  /** Opened automatically while filtering, because something inside it is a result. */
  autoOpen: boolean
}

type Person = Pick<User, 'name' | 'permissions'>

/** Whether the person has ANY of the selected roles; nothing selected matches everyone. */
export function matchesRoles(person: Person, selected: RoleFilter[]): boolean {
  if (!selected.length) return true
  return selected.some((filter) => filter === OTHERS_FILTER
    ? !person.permissions.some((permission) => FILTER_ROLES.includes(permission))
    : person.permissions.includes(filter))
}

/** Whether a scroll box's content is taller than the box (allowing a pixel of rounding). */
export function overflows(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > 1
}

/** Whether the name or email contains the search text (case-insensitive, surrounding spaces ignored). */
export function matchesSearch(item: { name: string; email?: string | null }, query: string): boolean {
  const text = query.trim().toLowerCase()
  return !text || item.name.toLowerCase().includes(text) || !!item.email?.toLowerCase().includes(text)
}

/** Whether any search text or filter is active. */
export function isFiltering(filters: OrganizationFilters): boolean {
  return !!filters.query.trim() || filters.divisions.length > 0 || filters.departments.length > 0 || filters.roles.length > 0
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)

function sortRows(rows: DivisionRow[], sort: OrganizationSort): DivisionRow[] {
  if (sort === 'default') return rows
  const compare: Record<Exclude<OrganizationSort, 'default'>, (a: DivisionRow, b: DivisionRow) => number> = {
    'name-asc': byName,
    'name-desc': (a, b) => -byName(a, b),
    'departments-desc': (a, b) => b.departmentCount - a.departmentCount || byName(a, b),
    'departments-asc': (a, b) => a.departmentCount - b.departmentCount || byName(a, b),
  }
  return [...rows].sort(compare[sort])
}

/**
 * The table's rows. Not filtering: every division (then "Unassigned departments", if any), every
 * department and every person, nothing opened. While filtering:
 *  - a row is shown when it matches the search, a row above it matches, or something inside it matches;
 *  - a row is opened automatically only when something inside it is a result;
 *  - the Role filter applies to staff: only staff with a selected role are shown, and only the
 *    departments and divisions that contain such staff;
 *  - the Division filter keeps only the selected divisions (never the unassigned group);
 *  - the Department filter keeps only the selected departments in their divisions (or the
 *    unassigned group), opened to show them; other selected divisions keep all their departments.
 */
export function organizationRows(hierarchy: OrganizationHierarchy, filters: OrganizationFilters, sort: OrganizationSort = 'default'): DivisionRow[] {
  const divisionIds = new Set(hierarchy.divisions.map((division) => division.id))
  const groups = hierarchy.divisions.map((division) => ({
    id: division.id, name: division.name, email: division.email ?? null, unassigned: false,
    departments: hierarchy.departments.filter((department) => department.divisionId === division.id),
  }))
  const unassigned = hierarchy.departments.filter((department) => !department.divisionId || !divisionIds.has(department.divisionId))
  const all = [...groups, ...(unassigned.length ? [{ id: UNASSIGNED_GROUP_ID, name: '', email: null, unassigned: true, departments: unassigned }] : [])]
  const filtering = isFiltering(filters)
  const query = filters.query.trim()
  const roles = filters.roles
  const selected = new Set(filters.divisions)
  const selectedDepartments = new Set(filters.departments)
  const rows: DivisionRow[] = []
  for (const group of all) {
    const base = { id: group.id, name: group.name, email: group.email, unassigned: group.unassigned, departmentCount: group.departments.length }
    if (!filtering) {
      rows.push({ ...base, autoOpen: false, departments: group.departments.map((department) => ({ department, staff: department.employees, autoOpen: false })) })
      continue
    }
    // Departments picked in this group: only they are shown, and the group opens to show them.
    const picked = group.departments.filter((department) => selectedDepartments.has(department.id))
    if ((selected.size || selectedDepartments.size) && !picked.length && (group.unassigned || !selected.has(group.id))) continue
    const divisionMatch = !!query && !group.unassigned && matchesSearch(group, query)
    const departments: (DepartmentRow & { hit: boolean })[] = []
    for (const department of picked.length ? picked : group.departments) {
      const departmentMatch = !!query && matchesSearch(department, query)
      const inherited = divisionMatch || departmentMatch
      const staff = department.employees.filter((person) => matchesRoles(person, roles) && (inherited || matchesSearch(person, query)))
      // Results inside: any staff shown because of the Role filter, or staff matching the search themselves.
      const autoOpen = staff.some((person) => roles.length > 0 || (!!query && matchesSearch(person, query)))
      const visible = roles.length ? staff.length > 0 : !query || inherited || staff.length > 0
      if (visible) departments.push({ department, staff, autoOpen, hit: departmentMatch || autoOpen })
    }
    const visible = roles.length ? departments.length > 0 : !query || divisionMatch || departments.length > 0
    if (!visible) continue
    rows.push({ ...base, autoOpen: picked.length > 0 || departments.some((row) => row.hit), departments: departments.map(({ department, staff, autoOpen }) => ({ department, staff, autoOpen })) })
  }
  // The unassigned group stays last whatever the sort.
  const assigned = rows.filter((row) => !row.unassigned)
  return [...sortRows(assigned, sort), ...rows.filter((row) => row.unassigned)]
}

export interface DepartmentFilterGroup {
  id: string
  /** The division's name; empty for the unassigned group. */
  label: string
  unassigned: boolean
  options: { value: string; label: string }[]
}

/** What the Department filter's chips need: the divisions, and the departments with their division (none: unassigned). */
export interface FilterDepartments {
  divisions: { id: string; name: string }[]
  departments: { id: string; name: string; divisionId?: string | null }[]
}

/**
 * The Department filter's chips, grouped by division (A to Z, departments A to Z), then the
 * unassigned departments. With divisions selected, only those divisions' groups. Used by
 * Organizational Structure and the admin SOP Directory.
 */
export function departmentFilterGroups(hierarchy: FilterDepartments, selectedDivisions: string[]): DepartmentFilterGroup[] {
  const divisionIds = new Set(hierarchy.divisions.map((division) => division.id))
  const options = (departments: FilterDepartments['departments']) => [...departments].sort(byName).map((department) => ({ value: department.id, label: department.name }))
  const groups: DepartmentFilterGroup[] = [...hierarchy.divisions].sort(byName)
    .filter((division) => !selectedDivisions.length || selectedDivisions.includes(division.id))
    .map((division) => ({ id: division.id, label: division.name, unassigned: false,
      options: options(hierarchy.departments.filter((department) => department.divisionId === division.id)) }))
    .filter((group) => group.options.length > 0)
  const unassigned = hierarchy.departments.filter((department) => !department.divisionId || !divisionIds.has(department.divisionId))
  if (!selectedDivisions.length && unassigned.length) groups.push({ id: UNASSIGNED_GROUP_ID, label: '', unassigned: true, options: options(unassigned) })
  return groups
}

/**
 * The Division and Department filters together (Rule 1), for a list of items in departments (the
 * admin SOP Directory). Nothing selected: everything matches. Otherwise the department's group (its
 * division, or the unassigned group, from `groupOf`) must have departments selected, in which case
 * only those departments match, or else be a selected division; a selected division with no
 * departments selected keeps all its departments.
 */
export function matchesDivisionDepartmentFilter(
  departmentId: string, divisions: string[], departments: string[], groupOf: (departmentId: string) => string,
): boolean {
  if (!divisions.length && !departments.length) return true
  const group = groupOf(departmentId)
  const picked = departments.filter((id) => groupOf(id) === group)
  if (picked.length) return picked.includes(departmentId)
  return group !== UNASSIGNED_GROUP_ID && divisions.includes(group)
}

/** The Division and Department filter's data from a list of departments: the active ones and their divisions. */
export function filterDepartmentsFrom(
  departments: { id: string; name: string; divisionId?: string; divisionName?: string; removedAt?: string }[],
): FilterDepartments {
  const active = departments.filter((department) => !department.removedAt)
  const divisions = new Map<string, string>()
  for (const department of active) if (department.divisionId) divisions.set(department.divisionId, department.divisionName ?? department.divisionId)
  return {
    divisions: [...divisions].map(([id, name]) => ({ id, name })),
    departments: active.map((department) => ({ id: department.id, name: department.name, divisionId: department.divisionId })),
  }
}

/**
 * What the Filter shows and applies, from the ids in the URL: the Division chips (A to Z), the
 * Department chips grouped under the selected divisions (departmentFilterGroups), and the selections
 * without choices no longer offered (an old link, or a department outside the selected divisions).
 */
export function filterSelection(data: FilterDepartments, divisionIds: string[], departmentIds: string[]) {
  const divisionChoices = [...data.divisions].sort(byName).map((division) => ({ value: division.id, label: division.name }))
  const divisions = divisionIds.filter((id) => divisionChoices.some((option) => option.value === id))
  const groups = departmentFilterGroups(data, divisions)
  const departments = departmentIds.filter((id) => groups.some((group) => group.options.some((option) => option.value === id)))
  return { divisionChoices, divisions, groups, departments }
}

/** After the divisions change: the selected departments still offered under them (deselecting a division drops its departments). */
export function departmentsKept(data: FilterDepartments, divisions: string[], departments: string[]): string[] {
  const offered = new Set(departmentFilterGroups(data, divisions).flatMap((group) => group.options.map((option) => option.value)))
  return departments.filter((id) => offered.has(id))
}
