import { describe, expect, it } from 'vitest'
import type { Permission, Sop, User } from '../data/mock/types'
import type { SopStatus } from '../types/status'
import { deleteBlockers, permissionChangeBlockers, validateNewUser, type AdminContext } from './userAdmin'

/** A user in IT with these permissions. */
function user(id: string, permissions: Permission[]): User {
  return {
    id,
    name: id,
    email: `${id}@hawkim.demo`,
    initials: id.slice(0, 2).toUpperCase(),
    departmentId: 'information-technology',
    permissions,
  }
}

/** An SOP by Sara with this status and these people. */
function sop(code: string, status: SopStatus, people: Partial<Pick<Sop, 'authorId' | 'coAuthorIds' | 'reviewers' | 'approvers'>> = {}): Sop {
  return {
    id: code.toLowerCase(),
    code,
    title: code,
    departmentId: 'information-technology',
    version: '1',
    status,
    lastUpdated: '2026-01-01',
    authorId: 'sara',
    coAuthorIds: [],
    fileName: `${code}.pdf`,
    fileType: 'pdf',
    reviewers: [],
    approvers: [],
    versions: [],
    comments: [],
    timeline: [],
    complianceChecks: [],
    ...people,
  }
}

const nouf = user('nouf', ['admin'])
const sara = user('sara', ['author'])
const reem = user('reem', ['author'])
const noura = user('noura', ['reviewer'])
const huda = user('huda', ['approver'])
const lama = user('lama', ['reviewer'])

/** Nouf (the only admin) acting, with these SOPs. */
function asNouf(sops: Sop[], users: User[] = [nouf, sara, reem, noura, huda, lama]): AdminContext {
  return { actorId: nouf.id, users, sops }
}

const kinds = (blockers: { kind: string }[]) => blockers.map((blocker) => blocker.kind)
const blockingCodes = (blockers: ReturnType<typeof deleteBlockers>) =>
  blockers.flatMap((blocker) => (blocker.kind === 'in-use' ? blocker.sops.map((item) => item.code) : []))

describe('the admin can’t lock themselves out', () => {
  it('refuses deleting yourself', () => {
    expect(kinds(deleteBlockers(nouf, asNouf([])))).toEqual(['self-delete'])
  })

  it('refuses removing your own Admin permission', () => {
    expect(kinds(permissionChangeBlockers(nouf, [], asNouf([])))).toEqual(['self-admin'])
  })
})

describe('at least one admin must always exist', () => {
  // Another admin (Huda, temporarily an admin) is acting; Nouf would be the last one left.
  const hudaAdmin = user('huda', ['admin'])
  const context: AdminContext = { actorId: hudaAdmin.id, users: [nouf, sara], sops: [] }

  it('refuses removing Admin from the last admin, or deleting them', () => {
    expect(kinds(permissionChangeBlockers(nouf, [], context))).toEqual(['last-admin'])
    expect(kinds(deleteBlockers(nouf, context))).toEqual(['last-admin'])
  })

  it('allows it while another admin remains', () => {
    const withTwoAdmins: AdminContext = { ...context, users: [nouf, hudaAdmin, sara] }
    expect(permissionChangeBlockers(nouf, [], withTwoAdmins)).toEqual([])
    expect(deleteBlockers(nouf, withTwoAdmins)).toEqual([])
  })

  it('doesn’t count deleted admins', () => {
    const deletedAdmin = { ...hudaAdmin, deletedAt: '2026-01-01T00:00:00Z' }
    expect(kinds(permissionChangeBlockers(nouf, [], { ...context, users: [nouf, deletedAdmin] }))).toEqual(['last-admin'])
  })
})

describe('Author is in use while they author or co-author an unpublished SOP', () => {
  it('blocks removing Author for the author and the co-author of a draft', () => {
    const sops = [sop('SOP-001', 'draft', { authorId: 'sara', coAuthorIds: ['reem'] })]
    expect(blockingCodes(permissionChangeBlockers(sara, [], asNouf(sops)))).toEqual(['SOP-001'])
    expect(blockingCodes(permissionChangeBlockers(reem, [], asNouf(sops)))).toEqual(['SOP-001'])
  })

  it('blocks at every unpublished status, but not once published', () => {
    for (const status of ['draft', 'in-review', 'returned', 'in-approval', 'approved'] as const) {
      expect(permissionChangeBlockers(sara, [], asNouf([sop('SOP-001', status)]))).not.toEqual([])
    }
    expect(permissionChangeBlockers(sara, [], asNouf([sop('SOP-001', 'published')]))).toEqual([])
  })

  it('only blocks removing, never keeping or adding permissions', () => {
    const sops = [sop('SOP-001', 'draft')]
    expect(permissionChangeBlockers(sara, ['author', 'reviewer'], asNouf(sops))).toEqual([])
  })
})

describe('Reviewer and Approver are in use while assigned to an SOP still in the workflow', () => {
  const statuses = ['in-review', 'in-approval', 'returned', 'approved'] as const
  const decisionsOf = { reviewer: ['pending', 'completed', 'returned'], approver: ['pending', 'approved', 'returned'] } as const

  it('blocks removing Reviewer at every such status, whatever the reviewer decided', () => {
    for (const status of statuses) {
      for (const decision of decisionsOf.reviewer) {
        const sops = [sop('SOP-001', status, { reviewers: [{ userId: 'noura', decision }] })]
        expect(blockingCodes(permissionChangeBlockers(noura, [], asNouf(sops))), `${status}, ${decision}`).toEqual(['SOP-001'])
      }
    }
  })

  it('blocks removing Approver at every such status, whatever the approver decided', () => {
    for (const status of statuses) {
      for (const decision of decisionsOf.approver) {
        const sops = [sop('SOP-001', status, { approvers: [{ userId: 'huda', decision }] })]
        expect(blockingCodes(permissionChangeBlockers(huda, [], asNouf(sops))), `${status}, ${decision}`).toEqual(['SOP-001'])
      }
    }
  })

  it('doesn’t block once the SOP is published', () => {
    const sops = [
      sop('SOP-001', 'published', {
        reviewers: [{ userId: 'noura', decision: 'completed' }],
        approvers: [{ userId: 'huda', decision: 'approved' }],
      }),
    ]
    expect(permissionChangeBlockers(noura, [], asNouf(sops))).toEqual([])
    expect(permissionChangeBlockers(huda, [], asNouf(sops))).toEqual([])
  })
})

describe('deleting users', () => {
  it('refuses deleting Noura while she is assigned as a reviewer, naming every SOP', () => {
    const sops = [
      sop('SOP-081', 'returned', { reviewers: [{ userId: 'noura', decision: 'returned' }] }),
      sop('SOP-082', 'in-approval', { reviewers: [{ userId: 'noura', decision: 'completed' }] }),
      sop('SOP-017', 'published', { reviewers: [{ userId: 'noura', decision: 'completed' }] }),
    ]
    const blockers = deleteBlockers(noura, asNouf(sops))
    expect(kinds(blockers)).toEqual(['in-use'])
    expect(blockingCodes(blockers)).toEqual(['SOP-081', 'SOP-082'])
  })

  it('refuses deleting someone with work in progress even after the permission was removed', () => {
    const formerReviewer = user('noura', [])
    const sops = [sop('SOP-081', 'returned', { reviewers: [{ userId: 'noura', decision: 'returned' }] })]
    expect(blockingCodes(deleteBlockers(formerReviewer, asNouf(sops)))).toEqual(['SOP-081'])
  })

  it('allows deleting a user who isn’t assigned to anything in progress', () => {
    const sops = [
      sop('SOP-081', 'returned', { reviewers: [{ userId: 'noura', decision: 'returned' }] }),
      sop('SOP-017', 'published', { reviewers: [{ userId: 'lama', decision: 'completed' }] }),
    ]
    expect(deleteBlockers(lama, asNouf(sops))).toEqual([])
  })
})

describe('validateNewUser', () => {
  const active = [sara]

  it('requires a name, a valid email and a department', () => {
    expect(validateNewUser({ name: '  ', email: 'rana@', departmentId: '', permissions: [] }, active)).toEqual({
      name: 'name-required',
      email: 'email-invalid',
      departmentId: 'department-required',
    })
  })

  it('refuses an email an active user already has, ignoring case', () => {
    const problems = validateNewUser({ name: 'Rana', email: 'SARA@hawkim.demo', departmentId: 'finance-administration', permissions: [] }, active)
    expect(problems.email).toBe('email-taken')
  })

  it('accepts a valid user with no permissions', () => {
    const problems = validateNewUser({ name: 'Rana', email: 'rana@hawkim.demo', departmentId: 'finance-administration', permissions: [] }, active)
    expect(Object.values(problems).filter(Boolean)).toEqual([])
  })
})
