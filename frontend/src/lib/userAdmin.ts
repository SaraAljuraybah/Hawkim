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
  /** As typed; must be +9665XXXXXXXX (see normalizePhone). */
  phone: string
  /** Job title, free text. */
  position: string
  /** A division, NO_DIVISION, or '' while none is chosen. */
  divisionId?: string
  departmentId: DepartmentId | ''
  permissions: Permission[]
}

export type NewUserField = 'name' | 'email' | 'phone' | 'divisionId' | 'departmentId' | 'position' | 'permissions'
export type NewUserProblem =
  | 'name-required' | 'email-invalid' | 'email-taken' | 'phone-required' | 'phone-invalid'
  | 'division-required' | 'department-required' | 'position-required' | 'position-too-long' | 'approver-outside-quality'

/** Longest position (job title), in characters; the database checks the same limit. */
export const POSITION_MAX = 100

/** A Saudi mobile number, as entered and as stored: +9665 followed by exactly 8 digits. */
export const PHONE_PATTERN = /^\+9665\d{8}$/

/**
 * The phone number as stored ("+9665XXXXXXXX"), or null when it isn't in exactly that format. Only
 * surrounding spaces are ignored: other formats (e.g. "05…") are refused, never rewritten. The
 * database checks the same pattern.
 */
export function normalizePhone(raw: string): string | null {
  const phone = raw.trim()
  return PHONE_PATTERN.test(phone) ? phone : null
}

/**
 * A System Admin account: the Admin permission (never held with another one). It has no division,
 * department or position, so those aren't asked for or shown.
 */
export function isSystemAdmin(user: { permissions: Permission[] }): boolean {
  return user.permissions.includes('admin')
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
 * users, ignoring case; phone must be +9665XXXXXXXX. Staff also need a division (NO_DIVISION
 * counts) with the department in it, and a position of up to POSITION_MAX characters; a System Admin
 * (see isSystemAdmin) has none of those. Approver is only for the Quality department (the database
 * refuses it too).
 */
export function validateNewUser(user: NewUser, activeUsers: User[], departments: Pick<Department, 'id' | 'divisionId' | 'isQuality'>[] = []): Partial<Record<NewUserField, NewUserProblem>> {
  const email = user.email.trim().toLowerCase()
  const position = user.position.trim()
  const department = departments.find((item) => item.id === user.departmentId)
  const outsideDivision = !!department && !!user.divisionId && departmentsInDivision([department], user.divisionId).length === 0
  const staff = !isSystemAdmin(user)
  return {
    name: user.name.trim() ? undefined : 'name-required',
    email: !EMAIL_PATTERN.test(email)
      ? 'email-invalid'
      : activeUsers.some((other) => other.email.toLowerCase() === email)
        ? 'email-taken'
        : undefined,
    phone: !user.phone.trim() ? 'phone-required' : normalizePhone(user.phone) ? undefined : 'phone-invalid',
    divisionId: !staff || user.divisionId ? undefined : 'division-required',
    departmentId: !staff || (user.departmentId && !outsideDivision) ? undefined : 'department-required',
    position: !staff ? undefined : !position ? 'position-required' : position.length > POSITION_MAX ? 'position-too-long' : undefined,
    permissions: department && !department.isQuality && user.permissions.includes('approver') ? 'approver-outside-quality' : undefined,
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

/** Whether the entered email differs from the user's (compared as stored: trimmed, lowercase). */
export function changesEmail(user: User, input: NewUser): boolean {
  return input.email.trim().toLowerCase() !== user.email.toLowerCase()
}

/**
 * Whether the form shows anything different from what it started with. A System Admin's form
 * doesn't show division, department or position, so those don't count for them.
 */
export function hasUnsavedChanges(initial: NewUser, current: NewUser): boolean {
  const fields: (keyof NewUser)[] = isSystemAdmin(current) && isSystemAdmin(initial)
    ? ['name', 'email', 'phone']
    : ['name', 'email', 'phone', 'divisionId', 'departmentId', 'position']
  return fields.some((field) => (initial[field] ?? '') !== (current[field] ?? '')) || changesPermissions({ permissions: initial.permissions }, current.permissions)
}

/** Whether the permissions differ, in whatever order they were ticked. */
export function changesPermissions(user: Pick<User, 'permissions'>, permissions: Permission[]): boolean {
  return PERMISSIONS.some((permission) => permissions.includes(permission) !== user.permissions.includes(permission))
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

/* ---------- Department transfers ---------- */

/** The SOPs that keep someone in their department, per responsibility, and how many SOPs in all. */
export interface ResponsibilitiesInProgress {
  total: number
  byRole: Record<SopRole, number>
}

/**
 * The SOP work a staff member still has, as the database counts it (profiles_department_transfer_guard
 * in 20261110120000_staff_management.sql): authoring or co-authoring an SOP that isn't published;
 * reviewing an SOP in review, in approval, returned or approved (their review isn't cancelled); and,
 * for anyone holding Approver, every SOP in approval or approved, because approver assignments aren't
 * stored in the database. While any remain, they can't move to another department.
 */
export function responsibilitiesInProgress(user: Pick<User, 'id' | 'permissions'>, sops: Sop[]): ResponsibilitiesInProgress {
  const byRole: Record<SopRole, number> = { author: 0, 'co-author': 0, reviewer: 0, approver: 0 }
  const blocking = new Set<string>()
  const count = (role: SopRole, sop: Sop) => {
    byRole[role] += 1
    blocking.add(sop.id)
  }
  for (const sop of sops) {
    const unfinished = sop.status !== 'published'
    if (unfinished && sop.authorId === user.id) count('author', sop)
    if (unfinished && sop.authorId !== user.id && sop.coAuthorIds.includes(user.id)) count('co-author', sop)
    if (ASSIGNED_STATUSES.includes(sop.status) && sop.reviewers.some((person) => person.userId === user.id && person.decision !== 'cancelled')) count('reviewer', sop)
    if ((sop.status === 'in-approval' || sop.status === 'approved')
      && (user.permissions.includes('approver') || sop.approvers.some((person) => person.userId === user.id))) count('approver', sop)
  }
  return { total: blocking.size, byRole }
}

/** Whether saving `next` moves the user from their current department to another one. */
export function transfersDepartment(user: Pick<User, 'departmentId'>, next: Pick<NewUser, 'departmentId' | 'permissions'>): boolean {
  return !!user.departmentId && !isSystemAdmin(next) && !!next.departmentId && next.departmentId !== user.departmentId
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
