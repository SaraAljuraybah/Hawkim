import { describe, expect, it } from 'vitest'
import type { User } from '../data/mock/types'
import { clearedStaffParams, staffWithStatus } from './userAdmin'

const person = (id: string, permissions: User['permissions'], deletedAt?: string): User =>
  ({ id, name: id, email: `${id}@test.invalid`, initials: 'XX', departmentId: 'qa', permissions, ...(deletedAt ? { deletedAt } : {}) })

const people = [
  person('active-author', ['author']),
  person('active-none', []),
  person('deactivated-reviewer', ['reviewer'], '2026-11-01T09:00:00Z'),
  person('active-admin', ['admin']),
  person('deleted-admin', ['admin'], '2026-11-02T09:00:00Z'),
]

describe('the Staff tabs', () => {
  it('Active Staff: active staff only (never Admins, never deactivated staff)', () => {
    expect(staffWithStatus(people, 'active').map((user) => user.id)).toEqual(['active-author', 'active-none'])
  })

  it('Deactive Staff: deactivated staff only (never Admins)', () => {
    expect(staffWithStatus(people, 'deactivated').map((user) => user.id)).toEqual(['deactivated-reviewer'])
  })

  it('never mixes the two', () => {
    const active = staffWithStatus(people, 'active')
    const deactivated = staffWithStatus(people, 'deactivated')
    expect(active.some((user) => deactivated.includes(user))).toBe(false)
  })

  it('keeps the tab when the filters are cleared', () => {
    const cleared = clearedStaffParams(new URLSearchParams('status=deactivated&division=a&dept=b&permission=author&sort=name-desc'))
    expect(cleared.toString()).toBe('status=deactivated')
  })
})
