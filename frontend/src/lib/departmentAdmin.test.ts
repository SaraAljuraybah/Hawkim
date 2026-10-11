import { describe, expect, it } from 'vitest'
import type { Department, Sop, User, UserRequest } from '../data/mock/types'
import type { Status } from '../types/status'
import {
  departmentIdFor,
  members,
  removalBlockers,
  validateDepartment,
  withAccess,
  type DepartmentRulesData,
} from './departmentAdmin'

/** A user whose home department is `departmentId`. */
function user(id: string, departmentId: string, deleted = false): User {
  return {
    id,
    name: id,
    email: `${id}@hawkim.demo`,
    initials: 'XX',
    departmentId,
    permissions: [],
    ...(deleted ? { deletedAt: '2026-01-01T00:00:00Z' } : {}),
  }
}

/** A department-access request from `requesterId` for `departmentId`. */
function accessRequest(requesterId: string, departmentId: string, status: Status): UserRequest {
  return {
    id: `req-${requesterId}-${departmentId}-${status}`,
    title: 'Access',
    type: 'department-access',
    departmentId,
    description: '',
    createdAt: '2026-01-01',
    status,
    requesterId,
  }
}

/** An SOP of `departmentId` with this status. */
function sop(code: string, departmentId: string, status: Sop['status']): Sop {
  return {
    id: code,
    code,
    title: code,
    departmentId,
    version: '1',
    status,
    lastUpdated: '2026-01-01',
    coAuthorIds: [],
    fileName: `${code}.pdf`,
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [],
    comments: [],
    timeline: [],
    complianceChecks: [],
  }
}

function department(id: string, name: string, initials: string, removed = false): Department {
  return { id, name, initials, description: '', ...(removed ? { removedAt: '2026-01-01T00:00:00Z' } : {}) }
}

const empty: DepartmentRulesData = { users: [], sops: [], requests: [] }
const kinds = (data: DepartmentRulesData, id = 'quality') =>
  removalBlockers(id, data).map((blocker) => `${blocker.kind} ${blocker.count}`)

describe('members and users with access', () => {
  it('counts active users whose home department it is, ignoring deleted users', () => {
    const users = [user('sara', 'it'), user('reem', 'it'), user('gone', 'it', true), user('faisal', 'quality')]
    expect(members('it', users).map((member) => member.id)).toEqual(['sara', 'reem'])
  })

  it('counts users from other departments with an approved access request, once each', () => {
    const users = [user('sara', 'it'), user('faisal', 'quality'), user('omar', 'pv'), user('gone', 'pv', true)]
    const requests = [
      accessRequest('sara', 'quality', 'approved'),
      accessRequest('sara', 'quality', 'approved'), // asked twice: still one user
      accessRequest('omar', 'quality', 'pending'), // not approved yet
      accessRequest('gone', 'quality', 'approved'), // deleted user
      accessRequest('faisal', 'quality', 'approved'), // already a member
    ]
    expect(withAccess('quality', users, requests).map((person) => person.id)).toEqual(['sara'])
  })
})

describe('removing a department', () => {
  it('is allowed when it is empty', () => {
    expect(removalBlockers('quality', empty)).toEqual([])
  })

  it('is refused while it has members', () => {
    expect(kinds({ ...empty, users: [user('faisal', 'quality'), user('khalid', 'quality')] })).toEqual(['members 2'])
  })

  it('is allowed once its only members are deleted', () => {
    expect(kinds({ ...empty, users: [user('gone', 'quality', true)] })).toEqual([])
  })

  it('is refused while it has SOPs, at any status', () => {
    for (const status of ['draft', 'in-review', 'returned', 'in-approval', 'approved', 'published'] as const) {
      expect(kinds({ ...empty, sops: [sop('SOP-001', 'quality', status)] })).toEqual(['sops 1'])
    }
  })

  it('is refused while users from other departments have approved access', () => {
    const data = { ...empty, users: [user('sara', 'it')], requests: [accessRequest('sara', 'quality', 'approved')] }
    expect(kinds(data)).toEqual(['with-access 1'])
  })

  it('is refused while access requests for it are pending (from active users)', () => {
    const data = {
      ...empty,
      users: [user('sara', 'it'), user('gone', 'it', true)],
      requests: [accessRequest('sara', 'quality', 'pending'), accessRequest('gone', 'quality', 'pending')],
    }
    expect(kinds(data)).toEqual(['pending-requests 1'])
  })

  it('is not blocked by rejected or cancelled requests, or by other departments', () => {
    const data = {
      users: [user('sara', 'it')],
      sops: [sop('SOP-001', 'it', 'draft')],
      requests: [accessRequest('sara', 'quality', 'rejected'), accessRequest('sara', 'quality', 'cancelled')],
    }
    expect(kinds(data)).toEqual([])
  })

  it('lists every blocker with its count', () => {
    const data = {
      users: [user('faisal', 'quality'), user('sara', 'it'), user('omar', 'pv')],
      sops: [sop('SOP-001', 'quality', 'published'), sop('SOP-002', 'quality', 'draft')],
      requests: [accessRequest('sara', 'quality', 'approved'), accessRequest('omar', 'quality', 'pending')],
    }
    expect(kinds(data)).toEqual(['members 1', 'sops 2', 'with-access 1', 'pending-requests 1'])
  })
})

describe('validateDepartment', () => {
  const existing = [department('quality', 'Quality Assurance', 'QA'), department('old', 'Old Team', 'OT', true)]
  const problems = (input: { name: string; initials: string; description?: string }, editingId?: string) =>
    validateDepartment({ description: '', ...input }, existing, editingId)

  it('requires a name of at most 60 characters', () => {
    expect(problems({ name: '  ', initials: 'MA' }).name).toBe('name-required')
    expect(problems({ name: 'x'.repeat(61), initials: 'MA' }).name).toBe('name-too-long')
    expect(problems({ name: 'x'.repeat(60), initials: 'MA' }).name).toBeUndefined()
  })

  it('refuses a name another department has, ignoring case and spaces around it', () => {
    expect(problems({ name: '  quality assurance ', initials: 'MA' }).name).toBe('name-taken')
  })

  it('requires 2–3 Latin letters as initials', () => {
    for (const initials of ['', 'M', 'MAXI', 'M1', 'M-A', 'مع']) {
      expect(problems({ name: 'Medical Affairs', initials }).initials, initials).toBe('initials-invalid')
    }
    expect(problems({ name: 'Medical Affairs', initials: 'ma' }).initials).toBeUndefined()
    expect(problems({ name: 'Medical Affairs', initials: 'MAF' }).initials).toBeUndefined()
  })

  it('refuses initials another department uses, ignoring case', () => {
    expect(problems({ name: 'Quality Audit', initials: 'qa' }).initials).toBe('initials-taken')
  })

  it('lets a department keep its own name and initials when edited', () => {
    expect(problems({ name: 'Quality Assurance', initials: 'QA' }, 'quality')).toEqual({
      name: undefined,
      initials: undefined,
      description: undefined,
    })
  })

  it('frees the name and initials of a removed department', () => {
    expect(problems({ name: 'Old Team', initials: 'OT' })).toEqual({ name: undefined, initials: undefined, description: undefined })
  })

  it('allows an empty description, up to 200 characters', () => {
    expect(problems({ name: 'Medical Affairs', initials: 'MA', description: 'x'.repeat(200) }).description).toBeUndefined()
    expect(problems({ name: 'Medical Affairs', initials: 'MA', description: 'x'.repeat(201) }).description).toBe(
      'description-too-long',
    )
  })
})

describe('departmentIdFor', () => {
  it('is a slug of the name', () => {
    expect(departmentIdFor('Medical Affairs', [])).toBe('medical-affairs')
    expect(departmentIdFor('Legal & Governance', [])).toBe('legal-and-governance')
  })

  it('is unique, also against removed departments', () => {
    const existing = [department('medical-affairs', 'Medical Affairs', 'MA', true), department('medical-affairs-2', 'X', 'XX')]
    expect(departmentIdFor('Medical Affairs', existing)).toBe('medical-affairs-3')
  })

  it('falls back to "department" for a name without Latin letters or digits', () => {
    expect(departmentIdFor('الشؤون الطبية', [])).toBe('department')
  })
})
