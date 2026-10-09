import { describe, expect, it } from 'vitest'
import type { Department, User, UserRequest } from '../data/mock/types'
import type { Status } from '../types/status'
import { getUserDepartments } from './departments'
import { approveBlockers, decideRequest, pendingRequests, rejectBlocker, type RequestRulesData } from './requestAdmin'

/* Sara works in IT and asks for access to Quality Assurance. Nouf is the admin. */
const sara: User = {
  id: 'sara',
  name: 'Sara',
  email: 'sara@hawkim.demo',
  initials: 'SA',
  departmentId: 'it',
  permissions: ['author'],
}
const it_: Department = { id: 'it', name: 'Information Technology', initials: 'IT', description: '' }
const quality: Department = { id: 'quality', name: 'Quality Assurance', initials: 'QA', description: '' }

function request(status: Status, overrides: Partial<UserRequest> = {}): UserRequest {
  return {
    id: 'req-1',
    title: 'Access to Quality Assurance',
    type: 'department-access',
    departmentId: 'quality',
    description: '',
    createdAt: '2026-10-01',
    status,
    requesterId: 'sara',
    ...overrides,
  }
}

const data: RequestRulesData = { users: [sara], departments: [it_, quality] }

describe('which requests can be decided', () => {
  it('allows approving and rejecting a pending request', () => {
    expect(approveBlockers(request('pending'), data)).toEqual([])
    expect(rejectBlocker(request('pending'))).toBeUndefined()
  })

  it('keeps approved, rejected and cancelled requests read-only', () => {
    for (const status of ['approved', 'rejected', 'cancelled'] as const) {
      expect(approveBlockers(request(status), data)).toEqual(['not-pending'])
      expect(rejectBlocker(request(status))).toBe('not-pending')
    }
  })

  it('refuses approving access to a removed department, but allows rejecting it', () => {
    const removed = { ...data, departments: [it_, { ...quality, removedAt: '2026-10-02T09:00:00Z' }] }
    expect(approveBlockers(request('pending'), removed)).toEqual(['department-removed'])
    expect(rejectBlocker(request('pending'))).toBeUndefined()
  })

  it('refuses approving a request from a deleted user, but allows rejecting it', () => {
    const deleted = { ...data, users: [{ ...sara, deletedAt: '2026-10-02T09:00:00Z' }] }
    expect(approveBlockers(request('pending'), deleted)).toEqual(['requester-deleted'])
    expect(approveBlockers(request('pending', { type: 'role-change', departmentId: undefined }), deleted)).toEqual([
      'requester-deleted',
    ])
  })

  it('gives every reason when both the requester and the department are gone', () => {
    const both = {
      users: [{ ...sara, deletedAt: '2026-10-02T09:00:00Z' }],
      departments: [it_, { ...quality, removedAt: '2026-10-03T09:00:00Z' }],
    }
    expect(approveBlockers(request('pending'), both)).toEqual(['requester-deleted', 'department-removed'])
  })

  it('doesn’t check a department for permission and role change requests', () => {
    const change = request('pending', { type: 'permission-change', departmentId: undefined })
    expect(approveBlockers(change, data)).toEqual([])
  })
})

describe('deciding', () => {
  it('records the decision, who made it and when', () => {
    expect(decideRequest(request('pending'), 'rejected', 'nouf', '2026-10-03T10:00:00Z')).toMatchObject({
      status: 'rejected',
      decidedById: 'nouf',
      decidedAt: '2026-10-03T10:00:00Z',
    })
  })

  it('gives access when a Department Access request is approved, and not when it is rejected', () => {
    const pending = request('pending')
    const departmentsOf = (requests: UserRequest[]) =>
      getUserDepartments(sara, requests, [it_, quality]).map((department) => department.id)

    expect(departmentsOf([pending])).toEqual(['it'])
    expect(departmentsOf([decideRequest(pending, 'approved', 'nouf')])).toEqual(['it', 'quality'])
    expect(departmentsOf([decideRequest(pending, 'rejected', 'nouf')])).toEqual(['it'])
  })

  it('counts only pending requests as waiting', () => {
    const requests = [request('pending'), request('approved'), request('cancelled'), request('pending', { id: 'req-2' })]
    expect(pendingRequests(requests).map((item) => item.id)).toEqual(['req-1', 'req-2'])
  })
})
