import { describe, expect, it } from 'vitest'
import type { Department, Sop, User, UserRequest } from '../data/mock/types'
import { getDepartmentState, getDirectoryDepartments, getUserDepartments, hasDirectoryAccess } from './departments'
import { directorySopsFor } from './sopAccess'
import { members, withAccess } from './departmentAdmin'

const user: User = { id: 'user', name: 'User', email: 'user@example.test', initials: 'UU', departmentId: 'home', permissions: ['author', 'reviewer', 'approver'] }
const departments: Department[] = ['home', 'a', 'b', 'c'].map((id) => ({ id, name: id, initials: id, description: '' }))
const request = (departmentId: string, status: UserRequest['status'] = 'approved', overrides: Partial<UserRequest> = {}): UserRequest => ({
  id: departmentId + status, title: 'Access', description: '', type: 'department-access', departmentId, status, createdAt: '2026-10-23', requesterId: user.id, ...overrides,
})
const ids = (items: Department[]) => items.map((department) => department.id)

describe('membership and read-only directory grants', () => {
  it('keeps membership, user roles and department employee lists unchanged after multiple approvals', () => {
    const before = structuredClone(user)
    const requests = [request('a'), request('b'), request('a')]
    expect(ids(getUserDepartments(user, departments))).toEqual(['home'])
    expect(ids(getDirectoryDepartments(user, requests, departments))).toEqual(['home', 'a', 'b'])
    expect(members('a', [user])).toEqual([])
    expect(withAccess('a', [user], requests)).toEqual([user])
    expect(user).toEqual(before)
  })
  it.each(['pending', 'rejected', 'cancelled'] as const)('does not turn a %s request into access', (status) => {
    expect(ids(getDirectoryDepartments(user, [request('a', status)], departments))).toEqual(['home'])
    expect(hasDirectoryAccess(user, 'a', [request('a', status)])).toBe(false)
  })
  it('keeps approved directories independent of unrelated requests and requester identities', () => {
    const requests = [request('a'), request('b', 'approved', { requesterId: 'other' }), request('c', 'approved', { type: 'role-change' })]
    expect(ids(getDirectoryDepartments(user, requests, departments))).toEqual(['home', 'a'])
    expect(ids(getDirectoryDepartments(user, [...requests, request('b')], departments))).toEqual(['home', 'a', 'b'])
    expect(ids(getDirectoryDepartments(user, [request('b')], departments))).toEqual(['home', 'b'])
  })
  it('does not offer removed directories or deleted-user access', () => {
    expect(ids(getDirectoryDepartments(user, [request('a')], departments.map((department) => department.id === 'a' ? { ...department, removedAt: '2026-10-23' } : department)))).toEqual(['home'])
    expect(getDirectoryDepartments({ ...user, deletedAt: '2026-10-23' }, [request('a')], departments)).toEqual([])
  })
  it('distinguishes selected directories, home membership, read-only grants and pending requests', () => {
    const requests = [request('a'), request('b', 'pending')]
    expect(getDepartmentState('home', 'a', user, requests)).toBe('member')
    expect(getDepartmentState('a', 'a', user, requests)).toBe('current')
    expect(getDepartmentState('a', 'home', user, requests)).toBe('directory')
    expect(getDepartmentState('b', 'home', user, requests)).toBe('requested')
    expect(getDepartmentState('c', 'home', user, requests)).toBe('none')
    expect(getDepartmentState('c', 'c', user, requests)).toBe('none')
  })
  it('filters actual directory data to authorized published SOPs before display', () => {
    const items = [
      { id: 'home-published', departmentId: 'home', status: 'published' },
      { id: 'a-published', departmentId: 'a', status: 'published' },
      { id: 'a-draft', departmentId: 'a', status: 'draft' },
      { id: 'a-review', departmentId: 'a', status: 'in-review' },
      { id: 'b-published', departmentId: 'b', status: 'published' },
    ] as Sop[]
    expect(directorySopsFor(items, user, [request('a'), request('b', 'pending')]).map((sop) => sop.id)).toEqual(['home-published', 'a-published'])
  })
})
