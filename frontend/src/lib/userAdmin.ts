import type { Department, DepartmentId, Permission, Sop, User } from '../data/mock/types'
import type { SopStatus } from '../types/status'

/*
 * Admin rules for users (PBI 15, 18, 19): adding users, changing permissions and
 * deleting users. Pure functions: the users store refuses anything they don't
 * allow, and the admin pages use them to explain why.
 * TODO: The backend must enforce these same rules.
 */

/** Every permission, in display order. */
export const PERMISSIONS: Permission[] = ['author', 'reviewer', 'approver', 'admin']

/** Simple format check: something@something.something, with no spaces. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the admin enters to add a user. */
export interface NewUser {
  name: string
  email: string
  /** As typed; saved normalised (see normalizePhone). */
  phone: string
  /** Job title, free text. */
  position: string
  /** A division, NO_DIVISION, or '' while none is chosen. */
  divisionId?: string
  departmentId: DepartmentId | ''
  permissions: Permission[]
}

export type NewUserField = 'name' | 'email' | 'phone' | 'divisionId' | 'departmentId' | 'position'
export type NewUserProblem =
  | 'name-required' | 'email-invalid' | 'email-taken' | 'phone-required' | 'phone-invalid'
  | 'division-required' | 'department-required' | 'position-required' | 'position-too-long'

/** Longest position (job title), in characters; the database checks the same limit. */
export const POSITION_MAX = 100

/**
 * A Saudi mobile number as stored: "05XXXXXXXX" or "+9665XXXXXXXX" (spaces allowed) becomes
 * "+9665XXXXXXXX". Null when it isn't one of those.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\s+/g, '').match(/^(?:05|\+9665)(\d{8})$/)
  return digits ? `+9665${digits[1]}` : null
}

/** A department's division as shown (its name once divisions are loaded), or '' without one. */
export function divisionLabel(department: Pick<Department, 'divisionId' | 'divisionName'> | undefined): string {
  return department?.divisionName ?? department?.divisionId ?? ''
}

/** The name shown for a division key (from divisionOptions), from the departments in it. */
export function divisionNameIn(departments: Pick<Department, 'divisionId' | 'divisionName'>[], division: string): string {
  return divisionLabel(departments.find((department) => department.divisionId === division)) || division
}

/** "All" in the Users list's Division and Department filters. */
export const ALL_FILTER = 'all'

export interface UserFilter {
  /** Searched in name, email, division, department and permission names, ignoring case. */
  query: string
  /** A division, NO_DIVISION, or ALL_FILTER. */
  division: string
  /** A department id, or ALL_FILTER. */
  departmentId: string
}

/** The Users list's users matching the search and both filters, by name. `permissionLabels`: the names shown. */
export function filterUsers(users: User[], getDepartment: (id: string) => Department | undefined, filter: UserFilter, permissionLabels: Record<Permission, string>): User[] {
  const text = filter.query.trim().toLowerCase()
  return users
    .filter((user) => {
      const department = getDepartment(user.departmentId)
      const searched = [user.name, user.email, divisionLabel(department), department?.name ?? '', ...user.permissions.map((permission) => permissionLabels[permission])]
      return (!text || searched.some((value) => value.toLowerCase().includes(text))) &&
        (filter.division === ALL_FILTER || (!!department && departmentsInDivision([department], filter.division).length > 0)) &&
        (filter.departmentId === ALL_FILTER || user.departmentId === filter.departmentId)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The Division choice for departments that have none. */
export const NO_DIVISION = '__no-division__'

/**
 * The divisions to choose from: each division of these departments, by name, then NO_DIVISION
 * when some department has none.
 */
export function divisionOptions(departments: Pick<Department, 'divisionId' | 'divisionName'>[]): string[] {
  const divisions = [...new Set(departments.flatMap((department) => (department.divisionId ? [department.divisionId] : [])))]
  divisions.sort((a, b) => divisionNameIn(departments, a).localeCompare(divisionNameIn(departments, b), 'en') || a.localeCompare(b, 'en'))
  return departments.some((department) => !department.divisionId) ? [...divisions, NO_DIVISION] : divisions
}

/** The Division chosen from the start: NO_DIVISION when it is the only choice, otherwise none. */
export function defaultDivision(departments: Pick<Department, 'divisionId'>[]): string {
  const options = divisionOptions(departments)
  return options.length === 1 && options[0] === NO_DIVISION ? NO_DIVISION : ''
}

/** The departments in this division (NO_DIVISION: those without one; '': none yet). */
export function departmentsInDivision<T extends Pick<Department, 'divisionId'>>(departments: T[], division: string): T[] {
  if (!division) return []
  return departments.filter((department) => (division === NO_DIVISION ? !department.divisionId : department.divisionId === division))
}

/**
 * What is wrong with each field (nothing for a valid user). Email must be unique among active
 * users, ignoring case; a division must be chosen (NO_DIVISION counts) and the department must be
 * in it; phone must be a Saudi mobile number; position is required, up to POSITION_MAX characters.
 */
export function validateNewUser(user: NewUser, activeUsers: User[], departments: Pick<Department, 'id' | 'divisionId'>[] = []): Partial<Record<NewUserField, NewUserProblem>> {
  const email = user.email.trim().toLowerCase()
  const position = user.position.trim()
  const department = departments.find((item) => item.id === user.departmentId)
  const outsideDivision = !!department && !!user.divisionId && departmentsInDivision([department], user.divisionId).length === 0
  return {
    name: user.name.trim() ? undefined : 'name-required',
    email: !EMAIL_PATTERN.test(email)
      ? 'email-invalid'
      : activeUsers.some((other) => other.email.toLowerCase() === email)
        ? 'email-taken'
        : undefined,
    phone: !user.phone.trim() ? 'phone-required' : normalizePhone(user.phone) ? undefined : 'phone-invalid',
    divisionId: user.divisionId ? undefined : 'division-required',
    departmentId: user.departmentId && !outsideDivision ? undefined : 'department-required',
    position: !position ? 'position-required' : position.length > POSITION_MAX ? 'position-too-long' : undefined,
  }
}

/**
 * A user's details as the form's starting values. The division is their department's; without an
 * active department, both wait to be chosen.
 */
export function userFormValues(user: User, activeDepartments: Pick<Department, 'id' | 'divisionId'>[]): NewUser {
  const department = activeDepartments.find((item) => item.id === user.departmentId)
  return {
    name: user.name,
    email: user.email,
    phone: user.phone ?? '',
    position: user.position ?? '',
    departmentId: department?.id ?? '',
    ...(department ? { divisionId: department.divisionId ?? NO_DIVISION } : {}),
    permissions: user.permissions,
  }
}

/** "Nouf Almutairi" → "NA": first letters of the first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return `${first}${last}`.toUpperCase()
}

/* ---------- What a user is doing on SOPs ---------- */

export type SopRole = 'author' | 'co-author' | 'reviewer' | 'approver'

/** Every SOP the user is on, with their role(s) on it, by code. */
export function involvement(userId: string, sops: Sop[]): { sop: Sop; roles: SopRole[] }[] {
  return sops
    .map((sop) => {
      const roles: SopRole[] = []
      if (sop.authorId === userId) roles.push('author')
      if (sop.coAuthorIds.includes(userId)) roles.push('co-author')
      if (sop.reviewers.some((person) => person.userId === userId)) roles.push('reviewer')
      if (sop.approvers.some((person) => person.userId === userId)) roles.push('approver')
      return { sop, roles }
    })
    .filter((item) => item.roles.length > 0)
    .sort((a, b) => a.sop.code.localeCompare(b.sop.code, 'en', { numeric: true }))
}

/**
 * Statuses where the assigned reviewers and approvers are still part of the workflow:
 * resubmitting a returned SOP sends it back to all of them, and an approved SOP
 * still has to be published by one of its approvers.
 */
const ASSIGNED_STATUSES: SopStatus[] = ['in-review', 'in-approval', 'returned', 'approved']

export type InUsePermission = Exclude<Permission, 'admin'>

/**
 * The SOPs that keep a permission in use (so it can't be removed and the user can't be deleted):
 * - author:   the user authors or co-authors an SOP that isn't published yet;
 * - reviewer: assigned as a reviewer on an SOP in review, in approval, returned or
 *             approved, excluding cancelled assignments;
 * - approver: assigned as an approver on such an SOP, whatever their own decision.
 */
export function sopsUsing(permission: InUsePermission, userId: string, sops: Sop[]): Sop[] {
  const assigned = (people: { userId: string }[]) => people.some((person) => person.userId === userId)
  return sops
    .filter((sop) => {
      switch (permission) {
        case 'author':
          return (sop.authorId === userId || sop.coAuthorIds.includes(userId)) && sop.status !== 'published'
        case 'reviewer':
          return ASSIGNED_STATUSES.includes(sop.status) && sop.reviewers.some((person) => person.userId === userId && person.decision !== 'cancelled')
        case 'approver':
          return ASSIGNED_STATUSES.includes(sop.status) && assigned(sop.approvers)
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
}

/* ---------- Why a change is refused ---------- */

export type Blocker =
  /** The admin can't delete themselves. */
  | { kind: 'self-delete' }
  /** The admin can't remove their own Admin permission. */
  | { kind: 'self-admin' }
  /** At least one admin must always exist. */
  | { kind: 'last-admin' }
  /** The permission is in use on these SOPs. */
  | { kind: 'in-use'; permission: InUsePermission; sops: Sop[] }

export interface AdminContext {
  /** The signed-in admin. */
  actorId: string
  /** Active users. */
  users: User[]
  sops: Sop[]
}

function otherAdminExists(targetId: string, users: User[]): boolean {
  return users.some((user) => user.id !== targetId && !user.deletedAt && user.permissions.includes('admin'))
}

/** Why the target's permissions can't be changed to `next` (none: it is allowed). Only removals can be refused. */
export function permissionChangeBlockers(target: User, next: Permission[], context: AdminContext): Blocker[] {
  const blockers: Blocker[] = []
  for (const permission of target.permissions.filter((item) => !next.includes(item))) {
    if (permission === 'admin') {
      if (target.id === context.actorId) blockers.push({ kind: 'self-admin' })
      else if (!otherAdminExists(target.id, context.users)) blockers.push({ kind: 'last-admin' })
    } else {
      const sops = sopsUsing(permission, target.id, context.sops)
      if (sops.length > 0) blockers.push({ kind: 'in-use', permission, sops })
    }
  }
  return blockers
}

/**
 * Why the target can't be deleted (none: it is allowed): only their own account and the last admin.
 * Work in progress doesn't block it; their name stays on the SOPs' history.
 */
export function deleteBlockers(target: User, context: AdminContext): Blocker[] {
  if (target.id === context.actorId) return [{ kind: 'self-delete' }]
  return target.permissions.includes('admin') && !otherAdminExists(target.id, context.users) ? [{ kind: 'last-admin' }] : []
}
