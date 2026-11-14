import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Department, User } from '../../data/mock/types'
import { AdminUsersPage } from './AdminUsersPage'

/* The Staff page's Active Staff / Deactive Staff tabs, on the real page with real (fixture) status data. */

const fixture = vi.hoisted(() => ({
  users: [
    { id: 'admin', name: 'Nouf Admin', email: 'nouf@example.test', initials: 'NA', departmentId: 'qa', permissions: ['admin'] },
    { id: 'sara', name: 'Sara Aljuraybah', email: 'sara@example.test', initials: 'SA', departmentId: 'pv', permissions: ['author', 'reviewer'] },
    { id: 'reem', name: 'Reem Alharbi', email: 'reem@example.test', initials: 'RA', departmentId: 'qa', permissions: ['approver'] },
    { id: 'huda', name: 'Huda Saleh', email: 'huda@example.test', initials: 'HS', departmentId: 'pv', permissions: ['reviewer'], deletedAt: '2026-11-01T09:00:00Z' },
    { id: 'amal', name: 'Amal Fahad', email: 'amal@example.test', initials: 'AF', departmentId: 'qa', permissions: ['author'], deletedAt: '2026-11-02T09:00:00Z' },
    { id: 'old-admin', name: 'Old Admin', email: 'old@example.test', initials: 'OA', departmentId: 'qa', permissions: ['admin'], deletedAt: '2026-11-03T09:00:00Z' },
  ] as User[],
  departments: [
    { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'regulatory_drug_safety', divisionName: 'Regulatory and Drug Safety' },
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: '' },
  ] as Department[],
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({
  useUsers: () => ({ users: fixture.users, activeUsers: fixture.users.filter((user) => !user.deletedAt), deleteUser: vi.fn(), reactivateUser: vi.fn() }),
}))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0] }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({
  useDepartments: () => ({ activeDepartments: fixture.departments, getDepartment: (id: string) => fixture.departments.find((item) => item.id === id) }),
}))

const render = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/users${search}`]}><AdminUsersPage /></MemoryRouter>)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const names = (html: string) => [...table(html).matchAll(/<th scope="row"[^>]*><span[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)<\/span><\/th>/g)].map((match) => match[1])
const tabs = (html: string) => [...html.matchAll(/<button type="button" role="tab"[^>]*aria-selected="(true|false)"[^>]*class="([^"]*)"[^>]*>([^<]+)<\/button>/g)]
  .map(([, selected, className, label]) => ({ label, selected: selected === 'true', className }))
const headings = (html: string) => [...table(html).matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])

describe('the Active Staff and Deactive Staff tabs', () => {
  it('replace the staff count: two tabs, side by side, right under Search | Filter | Sort and right above the table', () => {
    const html = render()
    expect(html).not.toMatch(/\d+ staff members?</)
    expect(tabs(html).map((tab) => tab.label)).toEqual(['Active Staff', 'Deactivated Staff'])
    expect(html).toMatch(/<div role="tablist" aria-label="Staff status"/)
    const toolbar = html.indexOf('name="staffSort"'), tablist = html.indexOf('role="tablist"'), panel = html.indexOf('role="tabpanel"'), tableAt = html.indexOf('<table')
    expect(toolbar).toBeLessThan(tablist)
    expect(tablist).toBeLessThan(panel)
    expect(panel).toBeLessThan(tableAt)
    // The table frame joins the tabs: its top-left corner is square, under the first tab.
    expect(html).toContain('rounded-xl border border-beige bg-white rounded-tl-none')
  })

  it('opens on Active Staff, which lists active staff only', () => {
    const html = render()
    expect(tabs(html).map((tab) => tab.selected)).toEqual([true, false])
    expect(names(html)).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
    expect(html).not.toContain('Huda Saleh')
    expect(html).not.toContain('Old Admin')
  })

  it('shows the selected tab white, bold and maroon, joined to the table; the other beige and regular', () => {
    const [active, deactivated] = tabs(render())
    for (const token of ['bg-white', 'font-semibold', 'text-maroon', 'border-b-white', 'z-10']) expect(active.className.split(' ')).toContain(token)
    for (const token of ['bg-beige', 'font-normal', 'text-text-gray', 'hover:text-maroon']) expect(deactivated.className.split(' ')).toContain(token)
    expect(deactivated.className).not.toContain('font-semibold')
    // Rectangular tabs (only the outer top corners rounded), not pills.
    expect(active.className).not.toContain('rounded-full')
  })

  it('Deactive Staff (?status=deactivated) lists deactivated staff only, never Admins', () => {
    const html = render('?status=deactivated')
    expect(tabs(html).map((tab) => tab.selected)).toEqual([false, true])
    expect(names(html)).toEqual(['Amal Fahad', 'Huda Saleh'])
    expect(html).not.toContain('Sara Aljuraybah')
    expect(html).not.toContain('Old Admin')
  })

  it('keeps the same columns, with Reactivate in place of Delete on Deactive Staff', () => {
    expect(headings(render())).toEqual(['Name', 'Division', 'Department', 'Permission', 'Preview', 'Edit', 'Delete'])
    const deactivated = render('?status=deactivated')
    expect(headings(deactivated)).toEqual(['Name', 'Division', 'Department', 'Permission', 'Preview', 'Edit', 'Reactivate'])
    expect(deactivated).toContain('aria-label="Reactivate Huda Saleh"')
    expect(deactivated).toContain('aria-label="View Huda Saleh"')
    expect(deactivated).toContain('aria-label="Edit Huda Saleh"')
    expect(deactivated).not.toMatch(/aria-label="Delete /)
    expect(render()).not.toMatch(/aria-label="Reactivate /)
  })

  it('searches, filters and sorts within the selected tab only', () => {
    // A deactivated person is never found on Active Staff, and the other way round.
    expect(names(render('?sort=name-asc'))).toEqual(['Reem Alharbi', 'Sara Aljuraybah'])
    expect(names(render('?status=deactivated&sort=name-desc'))).toEqual(['Huda Saleh', 'Amal Fahad'])
    expect(names(render('?status=deactivated&permission=reviewer'))).toEqual(['Huda Saleh'])
    expect(names(render('?permission=reviewer'))).toEqual(['Sara Aljuraybah'])
    expect(names(render('?status=deactivated&dept=qa&division=__unassigned__'))).not.toContain('Reem Alharbi')
  })

  it('shows its own empty state when no deactivated staff match', () => {
    const html = render('?status=deactivated&permission=approver')
    expect(html).not.toContain('<table')
    expect(html).toContain('>No deactivated staff members found.<')
    expect(html).not.toContain('Reem Alharbi')
    expect(render('?permission=approver&division=regulatory_drug_safety')).toContain('>No staff found.<')
  })
})
