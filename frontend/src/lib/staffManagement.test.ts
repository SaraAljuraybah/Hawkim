import { describe, expect, it } from 'vitest'
import type { Permission, Sop, User } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import {
  hasUnsavedChanges,
  isSystemAdmin,
  NO_DIVISION,
  responsibilitiesInProgress,
  transfersDepartment,
  validateNewUser,
  type NewUser,
} from './userAdmin'

/*
 * Staff Management (Tasks 7–16): System Admin accounts, unsaved changes and the department transfer
 * restriction. The database applies the same transfer rule (profiles_department_transfer_guard,
 * tested in supabase/tests/staff_management.local.mjs).
 */

const rana: User = { id: 'rana', name: 'Rana', email: 'rana@hawkim.demo', initials: 'RA', departmentId: 'qa', permissions: ['author', 'reviewer'] }
const huda: User = { ...rana, id: 'huda', name: 'Huda', permissions: ['approver'] }

function sop(code: string, status: SopStatus, people: Partial<Pick<Sop, 'authorId' | 'coAuthorIds' | 'reviewers' | 'approvers'>> = {}): Sop {
  return {
    id: code.toLowerCase(), code, title: code, departmentId: 'qa', version: '1', status, lastUpdated: '2026-01-01',
    authorId: 'someone-else', coAuthorIds: [], fileName: `${code}.pdf`, fileType: 'pdf', reviewers: [], approvers: [],
    versions: [], comments: [], timeline: [], complianceChecks: [], ...people,
  }
}

describe('a System Admin account', () => {
  const admin: NewUser = { name: 'Nouf', email: 'nouf@hawkim.demo', phone: '+966512345678', position: '', departmentId: '', permissions: ['admin'] }

  it('is an account with the Admin permission', () => {
    expect(isSystemAdmin(admin)).toBe(true)
    expect(isSystemAdmin({ permissions: ['author', 'reviewer'] as Permission[] })).toBe(false)
    expect(isSystemAdmin({ permissions: [] })).toBe(false)
  })

  it('needs no division, department or position', () => {
    expect(Object.values(validateNewUser(admin, [])).filter(Boolean)).toEqual([])
  })

  it('still needs a name, a valid unique email and a +9665 phone number', () => {
    expect(validateNewUser({ ...admin, name: ' ', email: 'nouf@', phone: '0512345678' }, [])).toMatchObject({
      name: 'name-required', email: 'email-invalid', phone: 'phone-invalid',
    })
    expect(validateNewUser(admin, [{ ...rana, email: 'NOUF@hawkim.demo' }]).email).toBe('email-taken')
  })

  it('leaves the organizational fields required for every other account', () => {
    expect(validateNewUser({ ...admin, permissions: ['author'] }, [])).toMatchObject({
      divisionId: 'division-required', departmentId: 'department-required', position: 'position-required',
    })
    expect(validateNewUser({ ...admin, permissions: [] }, [])).toMatchObject({ departmentId: 'department-required' })
  })
})

describe('unsaved changes in the staff form', () => {
  const initial: NewUser = { name: 'Rana', email: 'rana@hawkim.demo', phone: '+966512345678', position: 'QA Specialist', divisionId: NO_DIVISION, departmentId: 'qa', permissions: ['author'] }

  it('are none while every field is as it started', () => {
    expect(hasUnsavedChanges(initial, { ...initial })).toBe(false)
  })

  it.each([
    ['name', { name: 'Rana A.' }], ['email', { email: 'new@hawkim.demo' }], ['phone', { phone: '+966500000000' }],
    ['position', { position: 'QA Lead' }], ['department', { departmentId: 'it' }], ['division', { divisionId: 'Medical' }],
    ['permissions', { permissions: ['author', 'reviewer'] as Permission[] }],
  ])('count a changed %s', (_field, change) => {
    expect(hasUnsavedChanges(initial, { ...initial, ...change })).toBe(true)
  })

  it('ignore typing a field back to what it was, and the permissions order', () => {
    expect(hasUnsavedChanges({ ...initial, permissions: ['author', 'reviewer'] }, { ...initial, permissions: ['reviewer', 'author'] })).toBe(false)
  })

  it('ignore the hidden fields of a System Admin', () => {
    const admin: NewUser = { ...initial, permissions: ['admin'], position: '', departmentId: '' }
    expect(hasUnsavedChanges(admin, { ...admin, position: 'Anything', departmentId: 'it' })).toBe(false)
    expect(hasUnsavedChanges(admin, { ...admin, phone: '+966500000000' })).toBe(true)
  })
})

describe('a department transfer', () => {
  it('is a change from one department to another for staff only', () => {
    expect(transfersDepartment(rana, { departmentId: 'it', permissions: ['author'] })).toBe(true)
    expect(transfersDepartment(rana, { departmentId: 'qa', permissions: ['author'] })).toBe(false)
    // A System Admin getting or keeping no department isn't a transfer.
    expect(transfersDepartment({ departmentId: '' }, { departmentId: 'it', permissions: ['author'] })).toBe(false)
    expect(transfersDepartment(rana, { departmentId: '', permissions: ['admin'] })).toBe(false)
  })
})

describe('SOP responsibilities in progress (department transfer restriction)', () => {
  it('blocks an Author of an unfinished SOP, in every unfinished status', () => {
    for (const status of ['draft', 'in-review', 'in-approval', 'approved', 'returned'] as SopStatus[]) {
      const work = responsibilitiesInProgress(rana, [sop('SOP-1', status, { authorId: 'rana' })])
      expect(work).toEqual({ total: 1, byRole: { author: 1, 'co-author': 0, reviewer: 0, approver: 0 } })
    }
  })

  it('blocks a Co-author of an unfinished SOP', () => {
    expect(responsibilitiesInProgress(rana, [sop('SOP-1', 'draft', { coAuthorIds: ['rana'] })]).byRole['co-author']).toBe(1)
  })

  it('blocks a Reviewer with a pending task, and while a reviewed SOP is still in progress', () => {
    for (const decision of ['pending', 'completed', 'returned'] as const) {
      const work = responsibilitiesInProgress(rana, [sop('SOP-1', 'in-review', { reviewers: [{ userId: 'rana', decision }] })])
      expect(work.byRole.reviewer).toBe(1)
    }
  })

  it('does not count a cancelled review, or a review on a published SOP', () => {
    expect(responsibilitiesInProgress(rana, [sop('SOP-1', 'in-review', { reviewers: [{ userId: 'rana', decision: 'cancelled' }] })]).total).toBe(0)
    expect(responsibilitiesInProgress(rana, [sop('SOP-1', 'published', { reviewers: [{ userId: 'rana', decision: 'completed' }] })]).total).toBe(0)
  })

  it('blocks an Approver while an SOP waits for approval or publication', () => {
    expect(responsibilitiesInProgress(huda, [sop('SOP-1', 'in-approval')]).byRole.approver).toBe(1)
    expect(responsibilitiesInProgress(huda, [sop('SOP-1', 'approved')]).byRole.approver).toBe(1)
    expect(responsibilitiesInProgress(huda, [sop('SOP-1', 'in-review'), sop('SOP-2', 'published')]).total).toBe(0)
  })

  it('counts each SOP once for someone with several roles on it, and every role', () => {
    const both = sop('SOP-1', 'in-review', { authorId: 'rana', reviewers: [{ userId: 'rana', decision: 'pending' }] })
    expect(responsibilitiesInProgress(rana, [both])).toEqual({ total: 1, byRole: { author: 1, 'co-author': 0, reviewer: 1, approver: 0 } })
  })

  it('counts several unfinished SOPs', () => {
    const sops = [sop('SOP-1', 'draft', { authorId: 'rana' }), sop('SOP-2', 'returned', { coAuthorIds: ['rana'] }),
      sop('SOP-3', 'in-review', { reviewers: [{ userId: 'rana', decision: 'pending' }] })]
    expect(responsibilitiesInProgress(rana, sops).total).toBe(3)
  })

  it('allows the transfer once every responsibility is complete, and for staff without SOPs', () => {
    expect(responsibilitiesInProgress(rana, [sop('SOP-1', 'published', { authorId: 'rana', coAuthorIds: ['rana'] })]).total).toBe(0)
    expect(responsibilitiesInProgress(rana, []).total).toBe(0)
    expect(responsibilitiesInProgress(rana, [sop('SOP-1', 'draft')]).total).toBe(0)
  })
})
