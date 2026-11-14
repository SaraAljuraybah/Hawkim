import { describe, expect, it } from 'vitest'
import type { User } from '../data/mock/types'
import { adminRole, administrators, canDeleteAdmin, canEditAdmin, canMakeSuperAdmin, listAdmins } from './adminAccess'

const person = (id: string, name: string, email: string, permissions: User['permissions'] = ['admin']): User =>
  ({ id, name, email, initials: name.slice(0, 2), departmentId: '', permissions })

describe('the Admins permission matrix (what the pages show)', () => {
  const SUPER = 'a'
  it.each([
    // viewer, target, edit, delete, make super admin
    ['Super Admin on a regular Admin', SUPER, 'b', true, true, true],
    ['Super Admin on themselves', SUPER, SUPER, true, false, false],
    ['regular Admin on another regular Admin', 'b', 'c', true, false, false],
    ['regular Admin on themselves', 'b', 'b', true, false, false],
    ['regular Admin on the Super Admin', 'b', SUPER, false, false, false],
  ])('%s', (_, viewer, target, edit, del, transfer) => {
    expect(canEditAdmin(viewer, target, SUPER)).toBe(edit)
    expect(canDeleteAdmin(viewer, target, SUPER)).toBe(del)
    expect(canMakeSuperAdmin(viewer, target, SUPER)).toBe(transfer)
  })

  it('offers no elevated action to anyone while no Super Admin is assigned', () => {
    expect(canDeleteAdmin('a', 'b', null)).toBe(false)
    expect(canMakeSuperAdmin('a', 'b', null)).toBe(false)
    expect(canEditAdmin('a', 'b', null)).toBe(true)
  })

  it('moves with the role: after a transfer the former Super Admin loses it at once', () => {
    // Before: a is the Super Admin. After: b is.
    expect(canDeleteAdmin('a', 'b', 'a')).toBe(true)
    expect(canDeleteAdmin('a', 'b', 'b')).toBe(false)
    expect(canEditAdmin('a', 'b', 'b')).toBe(false)
    // The new Super Admin may then delete the former one, now a regular Admin.
    expect(canDeleteAdmin('b', 'a', 'b')).toBe(true)
  })

  it('names the roles', () => {
    expect(adminRole('a', 'a')).toBe('superAdmin')
    expect(adminRole('b', 'a')).toBe('admin')
    expect(adminRole('b', null)).toBe('admin')
  })
})

describe('the administrators list', () => {
  const nouf = person('n', 'Nouf Saleh', 'nouf@example.test')
  const amal = person('a', 'Amal Fahad', 'amal@example.test')
  const zaid = person('z', 'Zaid Omar', 'zaid@hawkim.test')
  const sara = person('s', 'Sara Author', 'sara@example.test', ['author'])

  it('holds only accounts with the Admin permission', () => {
    expect(administrators([nouf, sara, amal]).map((user) => user.id)).toEqual(['n', 'a'])
  })

  it('puts the Super Admin first, then sorts by name', () => {
    expect(listAdmins([nouf, amal, zaid], 'z', '').map((user) => user.id)).toEqual(['z', 'a', 'n'])
  })

  it('searches by name or email, ignoring case and surrounding spaces', () => {
    expect(listAdmins([nouf, amal, zaid], 'z', '  NOUF ').map((user) => user.id)).toEqual(['n'])
    expect(listAdmins([nouf, amal, zaid], 'z', 'hawkim.test').map((user) => user.id)).toEqual(['z'])
    expect(listAdmins([nouf, amal, zaid], 'z', 'nobody')).toEqual([])
  })
})
