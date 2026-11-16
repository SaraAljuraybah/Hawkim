import { describe, expect, it } from 'vitest'
import type { Department, User } from '../data/mock/types'
import type { StaffInvitation } from '../services/invitations'
import {
  filterInvitations, INVITATION_LIFETIME_MS, invitationRows, invitationStatus, invitedIds, withCancelled, withResent,
} from './staffInvitations'
import { staffWithStatus } from './userAdmin'

const departments: Department[] = [
  { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'rds', divisionName: 'Regulatory and Drug Safety' },
  { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '' },
]
const getDepartment = (id: string) => departments.find((department) => department.id === id)
const person = (id: string, name: string, extra: Partial<User> = {}): User =>
  ({ id, name, email: `${id}@example.test`, initials: name.slice(0, 2), departmentId: 'pv', permissions: ['author'], ...extra })

const NOW = Date.parse('2026-11-16T12:00:00Z')
const invitation = (userId: string, sentAt: string, extra: Partial<StaffInvitation> = {}): StaffInvitation => ({
  userId, sentAt, expiresAt: new Date(Date.parse(sentAt) + INVITATION_LIFETIME_MS).toISOString(), expired: false, cancelled: false, ...extra,
})

const users = [
  person('rana', 'Rana Saleh', { email: 'rana.saleh@hawkim.test', departmentId: 'qa' }),
  person('omar', 'Omar Ali', { permissions: ['reviewer', 'approver'] }),
  person('lama', 'Lama Fahad'),
  person('active', 'Active Person'),
  person('gone', 'Deactivated Person', { deletedAt: '2026-11-10T00:00:00Z' }),
  person('chief', 'An Admin', { permissions: ['admin'] }),
  person('cancelled', 'Cancelled Person'),
]
const invitations = [
  invitation('rana', '2026-11-16T09:00:00Z'), // Sent (3 hours ago)
  invitation('omar', '2026-11-14T09:00:00Z', { expired: true }), // Expired (the database said so)
  invitation('lama', '2026-11-15T11:00:00Z'), // Expired by the clock since it was read (25 hours ago)
  invitation('gone', '2026-11-16T08:00:00Z'),
  invitation('chief', '2026-11-16T08:00:00Z'),
  invitation('cancelled', '2026-11-16T07:00:00Z', { cancelled: true }),
]
const rows = invitationRows(users, invitations)
const ids = (list: { user: User }[]) => list.map((row) => row.user.id)

describe('the invitation status', () => {
  it('is Sent while the 24 hours last, and Expired after (the database\'s verdict or the clock)', () => {
    expect(invitationStatus(invitations[0], NOW)).toBe('sent')
    expect(invitationStatus(invitations[1], NOW)).toBe('expired')
    expect(invitationStatus(invitations[2], NOW)).toBe('expired')
    // Exactly 24 hours after sending, it has expired.
    const sent = invitation('x', '2026-11-15T12:00:00Z')
    expect(invitationStatus(sent, NOW - 1)).toBe('sent')
    expect(invitationStatus(sent, NOW)).toBe('expired')
  })
})

describe('who is on which Staff tab', () => {
  it('lists waiting invitations of active staff only: never Admins, deactivated staff or cancelled invitations', () => {
    expect(ids(rows)).toEqual(['rana', 'omar', 'lama'])
  })

  it('never lists a person with an invitation that is not activated on Active Staff (waiting or cancelled)', () => {
    const invited = invitedIds(invitations)
    const active = staffWithStatus(users, 'active', invited).map((user) => user.id)
    expect(active).toEqual(['active'])
    for (const id of ids(rows)) expect(active).not.toContain(id)
    expect(active).not.toContain('cancelled')
    // Deactivated staff stay on Deactivated Staff, whatever their invitation.
    expect(staffWithStatus(users, 'deactivated', invited).map((user) => user.id)).toEqual(['gone'])
  })

  it('lists everyone on Active Staff as before when there are no tracked invitations (or they could not be read)', () => {
    expect(staffWithStatus(users, 'active').map((user) => user.id)).toEqual(['rana', 'omar', 'lama', 'active', 'cancelled'])
  })

  it('moves an activated person to Active Staff: their invitation is no longer listed', () => {
    const afterActivation = invitations.filter((item) => item.userId !== 'rana')
    expect(ids(invitationRows(users, afterActivation))).not.toContain('rana')
    expect(staffWithStatus(users, 'active', invitedIds(afterActivation)).map((user) => user.id)).toContain('rana')
  })
})

describe('search, Filter and Sort on Sent Invitations', () => {
  const filter = (query: string, statuses: ('sent' | 'expired')[] = [], sort?: Parameters<typeof filterInvitations>[2]['sort']) =>
    ids(filterInvitations(rows, getDepartment, { query, statuses, sort }, NOW))

  it('searches the full name and the email only, ignoring case', () => {
    expect(filter('rana')).toEqual(['rana'])
    expect(filter('OMAR ali')).toEqual(['omar'])
    expect(filter('saleh@hawkim')).toEqual(['rana'])
    expect(filter('lama@example')).toEqual(['lama'])
    // Not the department, division or permissions.
    expect(filter('Pharmacovigilance')).toEqual([])
    expect(filter('Reviewer')).toEqual([])
  })

  it('filters by status: All Statuses (nothing chosen), Sent, Expired, or both', () => {
    expect(filter('')).toHaveLength(3)
    expect(filter('', ['sent'])).toEqual(['rana'])
    expect(filter('', ['expired']).sort()).toEqual(['lama', 'omar'])
    expect(filter('', ['sent', 'expired'])).toHaveLength(3)
  })

  it('sorts with the Staff sort: newest sent first by default, then by name, division or department', () => {
    expect(filter('')).toEqual(['rana', 'lama', 'omar'])
    expect(filter('', [], 'name-asc')).toEqual(['lama', 'omar', 'rana'])
    expect(filter('', [], 'name-desc')).toEqual(['rana', 'omar', 'lama'])
    // Quality Assurance has no division: last either way.
    expect(filter('', [], 'division-asc')).toEqual(['lama', 'omar', 'rana'])
    expect(filter('', [], 'department-desc')).toEqual(['rana', 'lama', 'omar'])
  })

  it('applies the search, the Filter and the sort together', () => {
    expect(filter('a', ['expired'], 'name-desc')).toEqual(['omar', 'lama'])
    expect(filter('example', ['sent'])).toEqual([])
  })
})

describe('after Resend and Cancel', () => {
  it('Resend: Sent again from the new sending, for another 24 hours; the others are unchanged', () => {
    const resent = withResent(invitations, 'omar', '2026-11-16T12:00:00.000Z')
    const omar = resent.find((item) => item.userId === 'omar')!
    expect(omar).toEqual({ ...invitations[1], sentAt: '2026-11-16T12:00:00.000Z', expiresAt: '2026-11-17T12:00:00.000Z', expired: false })
    expect(invitationStatus(omar, NOW)).toBe('sent')
    expect(resent.filter((item) => item.userId !== 'omar')).toEqual(invitations.filter((item) => item.userId !== 'omar'))
  })

  it('Cancel: off Sent Invitations, and still off Active Staff (not deactivated either)', () => {
    const cancelled = withCancelled(invitations, 'rana')
    expect(ids(invitationRows(users, cancelled))).toEqual(['omar', 'lama'])
    expect(staffWithStatus(users, 'active', invitedIds(cancelled)).map((user) => user.id)).not.toContain('rana')
    expect(staffWithStatus(users, 'deactivated', invitedIds(cancelled)).map((user) => user.id)).not.toContain('rana')
  })
})
