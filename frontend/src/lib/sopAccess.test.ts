import { describe, expect, it } from 'vitest'
import type { DepartmentId, UserRequest } from '../data/mock/types'
import type { Status } from '../types/status'
import { getSopAccess } from './sopAccess'

// Sara works in IT. The SOPs below belong to other departments unless stated.
const sara = { departmentId: 'information-technology' as DepartmentId }

/** One of Sara's requests to the admin team. */
function request(type: UserRequest['type'], departmentId: DepartmentId | undefined, status: Status): UserRequest {
  return {
    id: `req-${type}-${departmentId}-${status}`,
    title: 'Request',
    type,
    departmentId,
    description: '',
    createdAt: '2026-01-01',
    status,
    requesterId: 'sara',
  }
}

describe('getSopAccess', () => {
  it('grants access to SOPs of the home department, without any request', () => {
    expect(getSopAccess({ departmentId: 'information-technology' }, sara, [])).toBe('granted')
  })

  it('grants access to a department joined through an approved access request', () => {
    const requests = [request('department-access', 'pharmacovigilance', 'approved')]
    expect(getSopAccess({ departmentId: 'pharmacovigilance' }, sara, requests)).toBe('granted')
  })

  it('shows "requested" while an access request for that department is pending', () => {
    const requests = [request('department-access', 'pharmacovigilance', 'pending')]
    expect(getSopAccess({ departmentId: 'pharmacovigilance' }, sara, requests)).toBe('requested')
  })

  it('is locked without a request, or when the request was rejected or cancelled', () => {
    expect(getSopAccess({ departmentId: 'pharmacovigilance' }, sara, [])).toBe('locked')
    expect(
      getSopAccess({ departmentId: 'pharmacovigilance' }, sara, [
        request('department-access', 'pharmacovigilance', 'rejected'),
        request('department-access', 'pharmacovigilance', 'cancelled'),
      ]),
    ).toBe('locked')
  })

  it('only counts department-access requests for the SOP’s own department', () => {
    const requests = [
      request('department-access', 'quality-assurance', 'approved'),
      request('permission-change', undefined, 'approved'),
    ]
    expect(getSopAccess({ departmentId: 'pharmacovigilance' }, sara, requests)).toBe('locked')
  })

  it('prefers "granted" when an approved and a pending request exist for the same department', () => {
    const requests = [
      request('department-access', 'pharmacovigilance', 'pending'),
      request('department-access', 'pharmacovigilance', 'approved'),
    ]
    expect(getSopAccess({ departmentId: 'pharmacovigilance' }, sara, requests)).toBe('granted')
  })
})
