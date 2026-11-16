import { describe, expect, it } from 'vitest'
import type { Department, Sop, User } from '../data/mock/types'
import { eligibleApprovers } from './approval'
import { isAssignable } from './assignable'
import { eligibleReviewers, qualityController, validateWorkflowConfiguration } from './reviewFlow'
import { validateNewUser } from './userAdmin'
import { canBeRoutedTo } from './workflow'

/* Only activated staff can be given new work; people without an invitation record (legacy) are unchanged. */

const person = (id: string, extra: Partial<User> = {}): User =>
  ({ id, name: `Person ${id}`, email: `${id}@example.test`, initials: 'PP', departmentId: 'home', permissions: ['reviewer', 'author'], ...extra })
const legacy = person('legacy')
const waiting = person('waiting', { invitation: 'pending' })
const cancelled = person('cancelled', { invitation: 'cancelled' })
const gone = person('gone', { deletedAt: '2026-11-01T00:00:00Z' })
const everyone = [legacy, waiting, cancelled, gone]
const ids = (users: User[]) => users.map((user) => user.id)

const sop = { id: 's', departmentId: 'other', authorId: 'author', coAuthorIds: [], reviewers: [], approvers: [] } as unknown as Sop
const quality: Department = { id: 'qa', name: 'Quality', initials: 'QA', description: '', isQuality: true }

describe('who can be given new work', () => {
  it('is active and not waiting on an invitation (sent, expired or cancelled)', () => {
    expect(ids(everyone.filter(isAssignable))).toEqual(['legacy'])
  })

  it('reviewers: the pickers never offer a not-yet-activated person', () => {
    expect(ids(eligibleReviewers(sop, 'home', everyone))).toEqual(['legacy'])
    expect(everyone.filter((user) => canBeRoutedTo(sop, user)).map((user) => user.id)).toEqual(['legacy'])
  })

  it('approvers and the Quality Document Controller too', () => {
    const approvers = everyone.map((user) => ({ ...user, departmentId: 'qa', permissions: ['approver' as const] }))
    expect(ids(eligibleApprovers(sop, { users: approvers, departments: [quality] }))).toEqual(['legacy'])
    const departments = [{ ...quality, id: 'other', qualityControllerId: 'waiting' }]
    expect(qualityController(sop, { users: approvers, departments })).toBeUndefined()
    expect(() => validateWorkflowConfiguration({ qualityControllerId: 'cancelled' }, approvers)).toThrow()
    expect(validateWorkflowConfiguration({ qualityControllerId: 'legacy' }, approvers).qualityControllerId).toBe('legacy')
  })
})

describe('Add Staff with the email of someone not activated', () => {
  const staff = { name: 'X', email: 'cancelled@example.test', phone: '+966512345678', position: 'Officer', divisionId: '__no-division__', departmentId: 'home', permissions: ['author' as const] }

  it('may invite a cancelled staff member again; a waiting one is still taken', () => {
    expect(validateNewUser(staff, everyone).email).toBeUndefined()
    expect(validateNewUser({ ...staff, email: 'waiting@example.test' }, everyone).email).toBe('email-taken')
    expect(validateNewUser({ ...staff, email: 'legacy@example.test' }, everyone).email).toBe('email-taken')
  })

  it('never through Add Admin', () => {
    expect(validateNewUser({ ...staff, permissions: ['admin'], position: '', departmentId: '', divisionId: '' }, everyone).email).toBe('email-taken')
  })
})
