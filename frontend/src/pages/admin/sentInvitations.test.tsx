import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Department, User } from '../../data/mock/types'
import type { StaffInvitation } from '../../services/invitations'
import { AdminUsersPage } from './AdminUsersPage'

/* Staff → Sent Invitations, on the real page with fixture people and invitations. */

const DAY = 24 * 60 * 60 * 1000
const fixture = vi.hoisted(() => ({
  users: [] as User[],
  departments: [] as Department[],
  invitations: { status: 'ready' as 'loading' | 'ready' | 'failed', invitations: [] as StaffInvitation[] },
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useStaffInvitations', () => ({
  useStaffInvitations: () => ({ ...fixture.invitations, reload: vi.fn(), resend: vi.fn(), cancel: vi.fn() }),
}))
vi.mock('../../state/usersContext', () => ({
  useUsers: () => ({ users: fixture.users, activeUsers: fixture.users.filter((user) => !user.deletedAt), deleteUser: vi.fn(), reactivateUser: vi.fn() }),
}))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0] }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({
  useDepartments: () => ({ activeDepartments: fixture.departments, getDepartment: (id: string) => fixture.departments.find((item) => item.id === id) }),
}))

const sentAgo = (ms: number): StaffInvitation => {
  const sent = Date.now() - ms
  return { userId: '', sentAt: new Date(sent).toISOString(), expiresAt: new Date(sent + DAY).toISOString(), expired: ms >= DAY, cancelled: false }
}

beforeEach(() => {
  fixture.users = [
    { id: 'admin', name: 'Nouf Admin', email: 'nouf@example.test', initials: 'NA', departmentId: 'qa', permissions: ['admin'] },
    { id: 'sara', name: 'Sara Aljuraybah', email: 'sara@example.test', initials: 'SA', departmentId: 'pv', permissions: ['author'] },
    { id: 'rana', name: 'Rana Saleh', email: 'rana@example.test', initials: 'RS', departmentId: 'pv', phone: '+966512345678', position: 'Analyst', permissions: ['author', 'reviewer'] },
    { id: 'omar', name: 'Omar Ali', email: 'omar@example.test', initials: 'OA', departmentId: 'qa', permissions: ['approver'] },
    { id: 'cancelled', name: 'Cancelled Person', email: 'cancelled@example.test', initials: 'CP', departmentId: 'qa', permissions: ['author'] },
    { id: 'huda', name: 'Huda Saleh', email: 'huda@example.test', initials: 'HS', departmentId: 'pv', permissions: ['reviewer'], deletedAt: '2026-11-01T09:00:00Z' },
  ]
  fixture.departments = [
    { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'rds', divisionName: 'Regulatory and Drug Safety' },
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '' },
  ]
  fixture.invitations = {
    status: 'ready',
    invitations: [
      { ...sentAgo(2 * 60 * 60 * 1000), userId: 'rana' },
      { ...sentAgo(30 * 60 * 60 * 1000), userId: 'omar' },
      { ...sentAgo(60 * 60 * 1000), userId: 'cancelled', cancelled: true },
    ],
  }
})

const render = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/users${search}`]}><AdminUsersPage /></MemoryRouter>)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const rows = (html: string) => table(html).split('<tr>').slice(2)
const names = (html: string) => [...table(html).matchAll(/<th scope="row"[^>]*><span[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)<\/span><\/th>/g)].map((match) => match[1])
const headings = (html: string) => [...table(html).matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
const tabs = (html: string) => [...html.matchAll(/<button type="button" role="tab"[^>]*aria-selected="(true|false)"[^>]*>([^<]+)<\/button>/g)]
  .map(([, selected, label]) => ({ label, selected: selected === 'true' }))
/** The row's buttons, in order: their accessible names and whether they are disabled. */
const buttons = (row: string) => [...row.matchAll(/<button type="button"([^>]*)aria-label="([^"]+)"([^>]*)>/g)]
  .map(([, before, label, after]) => ({ label, disabled: `${before}${after}`.includes('aria-disabled="true"') }))
  .filter((button) => !button.label.startsWith('Copy '))

describe('the Sent Invitations tab', () => {
  it('is the third tab, beside Active Staff and Deactivated Staff', () => {
    const html = render('?status=invitations')
    expect(tabs(html)).toEqual([
      { label: 'Active Staff', selected: false },
      { label: 'Deactivated Staff', selected: false },
      { label: 'Sent Invitations', selected: true },
    ])
  })

  it('has the columns in order: Full Name, Email, Invitation Status, Sent Date, Actions (no Expires At)', () => {
    const html = render('?status=invitations')
    expect(headings(html)).toEqual(['Name', 'Email', 'Invitation Status', 'Sent Date', 'Actions'])
    expect(html).not.toMatch(/Expires At/i)
  })

  it('shows the 24-hour note above the table', () => {
    const html = render('?status=invitations')
    const note = html.indexOf('Invitations expire 24 hours after being sent. Expired invitations can be resent.')
    expect(note).toBeGreaterThan(-1)
    expect(note).toBeLessThan(html.indexOf('<table'))
    expect(render()).not.toContain('Invitations expire 24 hours')
  })

  it('lists invited staff only: not cancelled invitations, active or deactivated staff, nor Admins', () => {
    expect(names(render('?status=invitations'))).toEqual(['Rana Saleh', 'Omar Ali'])
  })

  it('shows each status as a badge in the table, and the email with its copy button', () => {
    const [rana, omar] = rows(render('?status=invitations'))
    expect(rana).toMatch(/bg-status-pending-bg[^>]*>.*Sent<\/span>/)
    expect(omar).toMatch(/bg-status-cancelled-bg[^>]*>.*Expired<\/span>/)
    expect(rana).toContain('rana@example.test')
    expect(rana).toContain('aria-label="Copy Rana Saleh’s email"')
    expect(rana).toMatch(/<time dateTime="[^"]+">/)
  })

  it('always shows Preview, Resend and Cancel, in that order; Resend is disabled while the invitation is Sent', () => {
    const [rana, omar] = rows(render('?status=invitations'))
    expect(buttons(rana)).toEqual([
      { label: 'Preview Rana Saleh', disabled: false },
      { label: 'Resend invitation to Rana Saleh', disabled: true },
      { label: 'Cancel invitation for Rana Saleh', disabled: false },
    ])
    expect(rana).toContain('>Available when the invitation expires.<')
    expect(buttons(omar)).toEqual([
      { label: 'Preview Omar Ali', disabled: false },
      { label: 'Resend invitation to Omar Ali', disabled: false },
      { label: 'Cancel invitation for Omar Ali', disabled: false },
    ])
  })

  it('filters by status through the existing Filter, which offers All Statuses, Sent and Expired', () => {
    const html = render('?status=invitations')
    expect(html).toContain('>All Statuses<')
    expect(names(render('?status=invitations&invitation=sent'))).toEqual(['Rana Saleh'])
    expect(names(render('?status=invitations&invitation=expired'))).toEqual(['Omar Ali'])
    expect(names(render('?status=invitations&invitation=sent,expired'))).toEqual(['Rana Saleh', 'Omar Ali'])
    // The Division, Department and Permission filters of the other tabs don't apply here.
    expect(names(render('?status=invitations&permission=reviewer'))).toEqual(['Rana Saleh', 'Omar Ali'])
  })

  it('keeps the same Sort control and options; newest sent first by default', () => {
    const html = render('?status=invitations')
    expect(html).toContain('name="staffSort"')
    expect(html).toContain('Staff name')
    expect(names(render('?status=invitations&sort=name-asc'))).toEqual(['Omar Ali', 'Rana Saleh'])
    expect(names(render('?status=invitations&sort=name-desc'))).toEqual(['Rana Saleh', 'Omar Ali'])
  })

  it('keeps the same search field', () => {
    const html = render('?status=invitations')
    expect(html).toContain('name="search"')
    expect(html).toContain('Search Staff')
  })

  it('shows its own empty, loading and failed states', () => {
    fixture.invitations = { status: 'ready', invitations: [] }
    expect(render('?status=invitations')).toContain('>No sent invitations found.<')
    fixture.invitations = { status: 'failed', invitations: [] }
    expect(render('?status=invitations')).toContain('Invitations couldn’t be loaded.')
    fixture.invitations = { status: 'loading', invitations: [] }
    expect(render('?status=invitations')).not.toContain('<table')
  })
})

describe('the other Staff tabs with invitations', () => {
  it('Active Staff leaves out invited staff (waiting or cancelled): nobody is on two tabs', () => {
    expect(names(render())).toEqual(['Sara Aljuraybah'])
    expect(names(render('?status=deactivated'))).toEqual(['Huda Saleh'])
  })

  it('Active Staff lists everyone as before when the invitations can\'t be read', () => {
    fixture.invitations = { status: 'failed', invitations: [] }
    expect(names(render())).toEqual(['Cancelled Person', 'Omar Ali', 'Rana Saleh', 'Sara Aljuraybah'])
  })

  it('keeps the Division, Department and Permission Filter and the columns on Active and Deactivated Staff', () => {
    const html = render()
    expect(html).not.toContain('All Statuses')
    expect(headings(html)).toEqual(['Name', 'Division', 'Department', 'Permission', 'Preview', 'Edit', 'Delete'])
    expect(names(render('?permission=author'))).toEqual(['Sara Aljuraybah'])
  })
})
