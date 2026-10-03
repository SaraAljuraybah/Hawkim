import type { DepartmentId, Permission, Sop, User } from '../data/mock/types'
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
  departmentId: DepartmentId | ''
  permissions: Permission[]
}

export type NewUserField = 'name' | 'email' | 'departmentId'
export type NewUserProblem = 'name-required' | 'email-invalid' | 'email-taken' | 'department-required'

/** What is wrong with each field (nothing for a valid user). Email must be unique among active users, ignoring case. */
export function validateNewUser(user: NewUser, activeUsers: User[]): Partial<Record<NewUserField, NewUserProblem>> {
  const email = user.email.trim().toLowerCase()
  return {
    name: user.name.trim() ? undefined : 'name-required',
    email: !EMAIL_PATTERN.test(email)
      ? 'email-invalid'
      : activeUsers.some((other) => other.email.toLowerCase() === email)
        ? 'email-taken'
        : undefined,
    departmentId: user.departmentId ? undefined : 'department-required',
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
 *             approved, whatever their own decision;
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
          return ASSIGNED_STATUSES.includes(sop.status) && assigned(sop.reviewers)
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

/** Why the target can't be deleted (none: it is allowed). */
export function deleteBlockers(target: User, context: AdminContext): Blocker[] {
  if (target.id === context.actorId) return [{ kind: 'self-delete' }]
  const blockers: Blocker[] = []
  if (target.permissions.includes('admin') && !otherAdminExists(target.id, context.users)) {
    blockers.push({ kind: 'last-admin' })
  }
  // Whatever their permissions are now, they can't leave work in progress behind.
  for (const permission of ['author', 'reviewer', 'approver'] as const) {
    const sops = sopsUsing(permission, target.id, context.sops)
    if (sops.length > 0) blockers.push({ kind: 'in-use', permission, sops })
  }
  return blockers
}
