import type { Permission, User } from '../data/mock/types'

/*
 * Search and role filter for one department's list on the Organizational Structure page.
 * Pure functions.
 */

/** "Others": people with none of the roles the filter lists (Author, Reviewer, Approver). */
export const OTHERS_FILTER = 'others'
export type RoleFilter = Extract<Permission, 'author' | 'reviewer' | 'approver'> | typeof OTHERS_FILTER

const FILTER_ROLES: Permission[] = ['author', 'reviewer', 'approver']

type Person = Pick<User, 'name' | 'permissions'>

/** The filter's options: Approver only in the Quality department (the only one that can have Approvers). */
export function roleFilters(isQuality: boolean): RoleFilter[] {
  return isQuality ? ['author', 'reviewer', 'approver', OTHERS_FILTER] : ['author', 'reviewer', OTHERS_FILTER]
}

/** Whether the name contains the search text (case-insensitive, surrounding spaces ignored). */
export function matchesName(person: Person, query: string): boolean {
  const text = query.trim().toLowerCase()
  return !text || person.name.toLowerCase().includes(text)
}

/** Whether the person has ANY of the selected roles; nothing selected matches everyone. */
export function matchesRoles(person: Person, selected: RoleFilter[]): boolean {
  if (!selected.length) return true
  return selected.some((filter) => filter === OTHERS_FILTER
    ? !person.permissions.some((permission) => FILTER_ROLES.includes(permission))
    : person.permissions.includes(filter))
}

/** The people matching both the search and the role filter, in their original order. */
export function filterPeople<T extends Person>(people: T[], query: string, selected: RoleFilter[]): T[] {
  return people.filter((person) => matchesName(person, query) && matchesRoles(person, selected))
}
