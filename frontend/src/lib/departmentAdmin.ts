import type { Department, DepartmentId, Sop, User, UserRequest } from '../data/mock/types'

/*
 * Admin rules for departments (PBI 13): who belongs to a department, adding and
 * editing departments, and when a department can be removed. Pure functions: the
 * departments store refuses anything they don't allow, and the admin pages use
 * them to explain why.
 * TODO: The backend must enforce these same rules.
 */

export const NAME_MAX = 60
export const DESCRIPTION_MAX = 200
/** Initials: 2 or 3 Latin letters (stored uppercase). */
const INITIALS_PATTERN = /^[A-Za-z]{2,3}$/

/* ---------- Who belongs to a department ---------- */

/** Members: active (not deleted) users whose home department it is. */
export function members(departmentId: DepartmentId, users: User[]): User[] {
  return users.filter((user) => !user.deletedAt && user.departmentId === departmentId)
}

/**
 * With access: active users from other departments who joined it through an
 * approved department-access request (each user once).
 */
export function withAccess(departmentId: DepartmentId, users: User[], requests: UserRequest[]): User[] {
  const approved = new Set(
    requests
      .filter(
        (request) =>
          request.type === 'department-access' && request.departmentId === departmentId && request.status === 'approved',
      )
      .map((request) => request.requesterId),
  )
  return users.filter((user) => !user.deletedAt && user.departmentId !== departmentId && approved.has(user.id))
}

/** Pending department-access requests for it, from active users. */
export function pendingAccessRequests(departmentId: DepartmentId, users: User[], requests: UserRequest[]): UserRequest[] {
  const active = new Set(users.filter((user) => !user.deletedAt).map((user) => user.id))
  return requests.filter(
    (request) =>
      request.type === 'department-access' &&
      request.departmentId === departmentId &&
      request.status === 'pending' &&
      active.has(request.requesterId),
  )
}

/** The department's SOPs, at any status. */
export function sopsIn(departmentId: DepartmentId, sops: Sop[]): Sop[] {
  return sops.filter((sop) => sop.departmentId === departmentId)
}

/* ---------- Removing ---------- */

/** What keeps a department from being removed, with how many. */
export type RemovalBlocker = {
  kind: 'members' | 'sops' | 'with-access' | 'pending-requests'
  count: number
}

export interface DepartmentRulesData {
  users: User[]
  sops: Sop[]
  requests: UserRequest[]
}

/**
 * Why the department can't be removed (none: it is allowed). It must have no members,
 * no SOPs (any status), nobody with approved access and no pending access requests.
 */
export function removalBlockers(departmentId: DepartmentId, data: DepartmentRulesData): RemovalBlocker[] {
  const blockers: RemovalBlocker[] = [
    { kind: 'members', count: members(departmentId, data.users).length },
    { kind: 'sops', count: sopsIn(departmentId, data.sops).length },
    { kind: 'with-access', count: withAccess(departmentId, data.users, data.requests).length },
    { kind: 'pending-requests', count: pendingAccessRequests(departmentId, data.users, data.requests).length },
  ]
  return blockers.filter((blocker) => blocker.count > 0)
}

/* ---------- Adding and editing ---------- */

/** What the admin enters. */
export interface DepartmentInput {
  name: string
  initials: string
  description: string
}

export type DepartmentField = keyof DepartmentInput
export type DepartmentProblem =
  | 'name-required'
  | 'name-too-long'
  | 'name-taken'
  | 'initials-invalid'
  | 'initials-taken'
  | 'description-too-long'

/** The input as it is saved: trimmed, initials uppercase. */
export function normalizeDepartment(input: DepartmentInput): DepartmentInput {
  return { name: input.name.trim(), initials: input.initials.trim().toUpperCase(), description: input.description.trim() }
}

/**
 * What is wrong with each field (nothing for a valid department). Name and initials
 * must be unique among active departments, ignoring case; `editingId` is the
 * department being edited (it may keep its own name and initials).
 */
export function validateDepartment(
  input: DepartmentInput,
  departments: Department[],
  editingId?: DepartmentId,
): Partial<Record<DepartmentField, DepartmentProblem>> {
  const { name, initials, description } = normalizeDepartment(input)
  const others = departments.filter((department) => !department.removedAt && department.id !== editingId)
  return {
    name: !name
      ? 'name-required'
      : name.length > NAME_MAX
        ? 'name-too-long'
        : others.some((department) => department.name.toLowerCase() === name.toLowerCase())
          ? 'name-taken'
          : undefined,
    initials: !INITIALS_PATTERN.test(initials)
      ? 'initials-invalid'
      : others.some((department) => department.initials.toUpperCase() === initials)
        ? 'initials-taken'
        : undefined,
    description: description.length > DESCRIPTION_MAX ? 'description-too-long' : undefined,
  }
}

/**
 * A new department's id: a slug of its name ("Medical Affairs" → "medical-affairs"),
 * made unique against every department ever created (removed ones too, so a new
 * department never takes over old links) by adding -2, -3…
 */
export function departmentIdFor(name: string, departments: Department[]): DepartmentId {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'department'
  const taken = new Set(departments.map((department) => department.id))
  if (!taken.has(slug)) return slug
  let n = 2
  while (taken.has(`${slug}-${n}`)) n += 1
  return `${slug}-${n}`
}
