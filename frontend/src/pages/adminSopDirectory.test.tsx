import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminEn } from '../content/admin.en'
import { sopsEn } from '../content/sops.en'
import type { Department, Sop, User } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { recentSince } from '../lib/sopDirectory'
import { SopDetailPage } from './SopDetailPage'
import { AdminSopsPage, SopsPage } from './SopsPage'
import { navLinks } from '../lib/sidebarNav'

const fixture = vi.hoisted(() => ({
  user: { id: 'admin', name: 'Nouf', initials: 'NA', email: 'nouf@example.test', departmentId: 'it', permissions: ['admin'] } as User,
  it: { id: 'it', name: 'Information Technology', initials: 'IT', description: '' } as Department,
  other: { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '', divisionId: 'med', divisionName: 'Medical' } as Department,
  removed: { id: 'old', name: 'Old Department', initials: 'OD', description: '', divisionId: 'gone', divisionName: 'Gone Division', removedAt: '2026-01-01' } as Department,
  sops: [] as Sop[],
  titles: [] as string[],
}))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title?: string) => { if (title) fixture.titles.push(title) } }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
// The admin portal has no department provider: the admin pages must not use it.
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => { throw new Error('useActiveDepartment must be used inside <ActiveDepartmentProvider>') } }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({
  getDepartment: (id: string) => [fixture.it, fixture.other].find((item) => item.id === id),
  nameOf: (id: string) => [fixture.it, fixture.other].find((item) => item.id === id)?.name ?? '',
  departments: [fixture.it, fixture.other, fixture.removed],
}) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))
vi.mock('../hooks/useFileUrl', () => ({ useFileUrl: () => undefined, currentVersionOf: () => undefined }))

const sop = (id: string, departmentId: string, status: Sop['status'] = 'published'): Sop => ({
  id, code: `SOP-${id}`, title: `Procedure ${id}`, authorId: 'someone', coAuthorIds: [], departmentId, status, version: '1',
  lastUpdated: '2026-10-01', fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
})
/** A checkbox dropdown's button and its list of checkboxes (MultiSelectField). */
const dropdown = (html: string, name: string) => {
  const start = html.lastIndexOf('<button', html.indexOf(`name="${name}"`))
  return html.slice(start, html.indexOf('</div>', html.lastIndexOf(`name="${name}"`)))
}
const choices = (html: string) => [...html.matchAll(/value="([^"]+)"(?: checked="")?\/><span[^>]*>([^<]+)<\/span>/g)].map((match) => match[2])
const directory = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/sops${search}`]}><AdminSopsPage /></MemoryRouter>)
const detail = (id: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/sops/${id}`]}><Routes><Route path="/admin/sops/:id" element={<SopDetailPage admin />} /></Routes></MemoryRouter>,
)

beforeEach(() => {
  fixture.sops = []
  fixture.titles.length = 0
})

describe('the SOP Directory in the admin portal', () => {
  it('is a tab between SFDA Regulatory Requirements and Requests', () => {
    const labels = navLinks(adminEn.shell.nav).map((item) => item.label)
    expect(labels.indexOf('SOP Directory')).toBe(labels.indexOf('SFDA Regulatory Requirements') + 1)
    expect(labels.indexOf('Requests')).toBe(labels.indexOf('SOP Directory') + 1)
  })

  it('shows an empty-state message, not a blank area, when the admin can read no SOP', () => {
    const html = directory()
    expect(html).toContain(`>${sopsEn.adminEmpty}<`)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('>SOP Directory</h1>')
    expect(fixture.titles.at(-1)).toBe('SOP Directory · Admin Portal | Hawkim')
  })

  it('has Search, Filter by Division, Filter by Department and Sort By on one row, the views, no File Type filter and no department line', () => {
    const html = directory()
    for (const name of ['sopSearch', 'sopSort']) expect(html).toContain(`name="${name}"`)
    // Stacked on phones, 2×2 from sm, one row from xl.
    expect(html).toContain('sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]')
    const order = ['name="sopSearch"', '>Filter by Division</span>', '>Filter by Department</span>', 'name="sopSort"'].map((part) => html.indexOf(part))
    expect(order.every((position, index) => position > -1 && (index === 0 || position > order[index - 1]))).toBe(true)
    expect(html).not.toContain('name="documentType"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('>Recently Published<')
    // Every department, so no "Department: …" line under the subtitle.
    expect(html).not.toContain('Department: </span>')
  })

  it('lists every department\'s published SOPs, never Others', () => {
    fixture.sops = [sop('1', 'it'), sop('9', 'pv'), { ...sop('8', 'pv'), directoryGroup: 'others' }]
    const html = directory()
    expect(html).toContain('>Procedure 1<')
    expect(html).toContain('>Procedure 9<')
    expect(html).not.toContain('Procedure 8')
    expect(html).toContain('>2 SOPs found<')
  })

  it('uses the Divisions and Departments checkbox dropdowns, from the real data without removed departments', () => {
    const html = directory()
    const divisions = dropdown(html, 'divisionFilter')
    expect(divisions).toMatch(/^<button type="button" aria-label="Filter by Division" aria-expanded="false"/)
    expect(divisions).toContain('>All divisions</span>')
    expect(divisions).toContain('role="group" aria-label="Filter by Division" hidden=""')
    expect(choices(divisions)).toEqual(['Medical', 'No Division'])
    const departments = dropdown(html, 'departmentFilter')
    expect(departments).toContain('>All departments</span>')
    expect(choices(departments)).toEqual(['Information Technology', 'Pharmacovigilance'])
    expect(html).not.toContain('Old Department')
    expect(html).not.toContain('Gone Division')
    expect(html).not.toContain('>Clear Filters<')
  })

  it('keeps the checked divisions and departments from the URL, with the count and Clear Filters', () => {
    fixture.sops = [sop('1', 'it'), sop('9', 'pv')]
    const byDivision = directory('?division=med,gone')
    expect(byDivision).toContain('>Procedure 9<')
    expect(byDivision).not.toContain('Procedure 1<')
    expect(byDivision).toContain('>1 SOP found<')
    expect(dropdown(byDivision, 'divisionFilter')).toContain('aria-label="Filter by Division: Medical"')
    expect(byDivision).toContain('>Clear Filters<')
    const byDepartment = directory('?dept=it')
    expect(byDepartment).toContain('>Procedure 1<')
    expect(byDepartment).not.toContain('Procedure 9<')
    expect(dropdown(byDepartment, 'departmentFilter')).toContain('aria-label="Filter by Department: Information Technology"')
  })

  it('needs both when both are used: a mismatch shows the normal empty state, and the department stays checked', () => {
    fixture.sops = [sop('1', 'it'), sop('9', 'pv')]
    const html = directory('?division=med&dept=it')
    expect(html).toContain('>0 SOPs found<')
    expect(html).toContain(`>${sopsEn.filters.empty}<`)
    expect(dropdown(html, 'departmentFilter')).toContain('checked="" value="it"')
  })

  it('shows SOPs of the last three months on Recently Published', () => {
    fixture.sops = [{ ...sop('1', 'it'), lastUpdated: todayIsoDate() }, { ...sop('2', 'pv'), lastUpdated: '2020-01-01' }, { ...sop('3', 'pv'), lastUpdated: recentSince() }]
    const recent = directory('?tab=recent')
    expect(recent).toContain('>Procedure 1<')
    expect(recent).toContain('>Procedure 3<')
    expect(recent).not.toContain('Procedure 2')
    expect(directory()).toContain('>Procedure 2<')
    fixture.sops = [{ ...sop('2', 'pv'), lastUpdated: '2020-01-01' }]
    expect(directory('?tab=recent')).toContain(`>${sopsEn.recentEmpty}<`)
  })

  it('lists the published SOPs it can read, opening inside the admin portal', () => {
    fixture.sops = [sop('1', 'it'), sop('2', 'it', 'draft')]
    const html = directory()
    expect(html).toContain('>Procedure 1<')
    expect(html).not.toContain('Procedure 2')
    expect(html).toContain('href="/admin/sops/1"')
    expect(html).not.toContain('href="/sops/1"')
  })
})

describe('an SOP opened from the admin directory', () => {
  it('goes back to the admin directory, with the admin tab title', () => {
    fixture.sops = [sop('1', 'it')]
    const html = detail('1')
    expect(html).toMatch(/<a[^>]*href="\/admin\/sops"[^>]*>.*Back to SOP Directory<\/a>/)
    expect(fixture.titles.at(-1)).toBe('Procedure 1 · Admin Portal | Hawkim')
  })

  it('has no edit, workflow or request buttons', () => {
    fixture.sops = [sop('1', 'it')]
    const html = detail('1')
    for (const word of ['Edit', 'Submit', 'Upload', 'Delete', 'Review', 'Approve', 'Request Access', 'Compliance Check']) expect(html).not.toContain(`>${word}`)
  })

  it('opens another department\'s published SOP (its file, when it has one), with no Request Access', () => {
    fixture.sops = [sop('9', 'pv')]
    const html = detail('9')
    expect(html).toContain('>Procedure 9</h1>')
    // Granted: the viewer's place (this test SOP has no file), not "no access".
    expect(html).toContain('The file for this SOP isn&#x27;t available yet.')
    expect(html).not.toContain('This SOP belongs to')
    expect(html).not.toContain('Request Access')
    expect(html).not.toContain('/requests/new')
  })

  it('says "<division> · <department> · Published on <date>" under the title, for every role', () => {
    // The date is the one on the directory cards; screen readers hear a comma instead of each "·". No version.
    const subtitle = (html: string) => html.match(/<\/h1><p class="mt-2 text-sm text-text-gray">(.*?)<\/p>/)![1]
    const dot = '<span><span aria-hidden="true"> · </span><span class="sr-only">, </span></span>'
    const expected = `<span>Medical</span>${dot}<span>Pharmacovigilance</span>${dot}<span>Published on </span><time dateTime="2026-10-01">Oct 1, 2026</time>`
    fixture.sops = [sop('9', 'pv')]
    expect(subtitle(detail('9'))).toBe(expected)
    expect(subtitle(detail('9'))).not.toContain('SOP v')
    fixture.user = { ...fixture.user, permissions: ['author'] }
    const employee = renderToStaticMarkup(<MemoryRouter initialEntries={['/sops/9']}><Routes><Route path="/sops/:id" element={<SopDetailPage />} /></Routes></MemoryRouter>)
    expect(subtitle(employee)).toBe(expected)
    fixture.user = { ...fixture.user, permissions: ['admin'] }
    // A department without a division: from the department.
    fixture.sops = [sop('1', 'it')]
    expect(subtitle(detail('1'))).toBe(`<span>Information Technology</span>${dot}<span>Published on </span><time dateTime="2026-10-01">Oct 1, 2026</time>`)
  })

  it('still locks an SOP in Others, without Request Access', () => {
    fixture.sops = [{ ...sop('8', 'pv'), directoryGroup: 'others' }]
    const html = detail('8')
    expect(html).toContain('This SOP belongs to Pharmacovigilance.')
    expect(html).not.toContain('Request Access')
  })

  it('shows Not Found for an SOP that isn\'t published', () => {
    fixture.sops = [sop('3', 'it', 'in-review')]
    expect(detail('3')).not.toContain('Procedure 3')
  })
})

describe('the employee pages stay as they were', () => {
  it('still need the department provider for the directory', () => {
    expect(() => renderToStaticMarkup(<MemoryRouter><SopsPage /></MemoryRouter>)).toThrow('ActiveDepartmentProvider')
  })

  it('show the no-access panel without Request Access for an SOP they didn\'t work on, and go back to /sops', () => {
    fixture.user = { ...fixture.user, permissions: ['author'] }
    fixture.sops = [sop('9', 'pv')]
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/sops/9']}><Routes><Route path="/sops/:id" element={<SopDetailPage />} /></Routes></MemoryRouter>)
    expect(html).not.toContain('Request Access')
    expect(html).toContain(sopsEn.detail.noAccess.text)
    expect(html).toMatch(/<a[^>]*href="\/sops"[^>]*>.*Back to SOP Directory<\/a>/)
    expect(fixture.titles.at(-1)).toBe('Procedure 9 | Hawkim')
    fixture.user = { ...fixture.user, permissions: ['admin'] }
  })
})
