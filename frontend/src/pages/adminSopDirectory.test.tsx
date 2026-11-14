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
const directory = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/sops${search}`]}><AdminSopsPage /></MemoryRouter>)
const detail = (id: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/sops/${id}`]}><Routes><Route path="/admin/sops/:id" element={<SopDetailPage admin />} /></Routes></MemoryRouter>,
)

beforeEach(() => {
  fixture.sops = []
  fixture.titles.length = 0
})

describe('the SOP Directory in the admin portal', () => {
  it('is a tab between Regulatory Requirements and Requests', () => {
    const labels = navLinks(adminEn.shell.nav).map((item) => item.label)
    expect(labels.indexOf('SOP Directory')).toBe(labels.indexOf('Regulatory Requirements') + 1)
    expect(labels.indexOf('Requests')).toBe(labels.indexOf('SOP Directory') + 1)
  })

  it('shows an empty-state message, not a blank area, when the admin can read no SOP', () => {
    const html = directory()
    expect(html).toContain(`>${sopsEn.adminEmpty}<`)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('>SOP Directory</h1>')
    expect(fixture.titles.at(-1)).toBe('SOP Directory · Admin Portal | Hawkim')
  })

  it('has Search, Filter and Sort By on one row (as on Organizational Structure), the views, no File Type filter and no department line', () => {
    const html = directory()
    for (const name of ['sopSearch', 'sopSort']) expect(html).toContain(`name="${name}"`)
    // The row of every list page (stacked on small screens; one row from lg), on the page background: no card.
    expect(html).toContain('<div role="search" aria-label="Search and filter SOPs" class="mt-6"><div class="relative grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">')
    expect(html).not.toContain('rounded-xl border border-beige bg-white p-4 sm:p-5')
    const order = ['name="sopSearch"', '>Filter</label>', 'name="sopSort"'].map((part) => html.indexOf(part))
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
    expect(html).toContain('>2 SOPs<')
  })

  it('replaces the dropdowns with the Filter panel: Division and Department chips, no Role card, and no Clear Filters by default', () => {
    const html = directory()
    const button = html.match(/<label for="([^"]+)" class="mb-1.5 block text-sm font-medium text-maroon">Filter<\/label><button id="([^"]+)" type="button" aria-label="Filter" aria-expanded="false" aria-controls="[^"]+"[^>]*>/)!
    expect(button[1]).toBe(button[2])
    // The field of every filter page: like the other dropdowns, "All" while nothing is chosen.
    expect(button[0]).toContain('min-h-11')
    expect(html).toMatch(/aria-controls="[^"]+"[^>]*><span class="truncate text-text-gray">All<\/span><svg[^>]*lucide-chevron-down/)
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division', 'Department'])
    expect(html).not.toContain('>Role<')
    for (const removed of ['name="divisionFilter"', 'name="departmentFilter"', 'Filter by Division', 'Filter by Department', 'No Division', '>Clear Filters<'])
      expect(html).not.toContain(removed)
    expect(html).toContain('>Clear all</button>')
    // Division chips from the real data (removed departments left out); Department chips grouped by division, unassigned last.
    const chips = [...html.matchAll(/aria-pressed="false"[^>]*><span class="min-w-0 break-words">([^<]+)<\/span>/g)].map((match) => match[1])
    expect(chips).toEqual(['Medical', 'Pharmacovigilance', 'Information Technology'])
    expect([...html.matchAll(/<p id="[^"]+" class="mb-1.5 text-xs font-semibold text-text-gray">([^<]+)<\/p>/g)].map((match) => match[1])).toEqual(['Medical', 'Unassigned departments'])
    expect(html.match(/max-h-\[8.5rem\] overflow-y-auto/g)).toHaveLength(2)
    expect(html).not.toContain('Old Department')
    expect(html).not.toContain('Gone Division')
  })

  it('keeps the selected divisions and departments from the URL, with the count, the badge and Clear Filters', () => {
    fixture.sops = [sop('1', 'it'), sop('9', 'pv')]
    const byDivision = directory('?division=med,gone')
    expect(byDivision).toContain('>Procedure 9<')
    expect(byDivision).not.toContain('Procedure 1<')
    expect(byDivision).toContain('>1 SOP<')
    expect(byDivision).toContain('aria-label="Filter: 1 division"')
    expect(byDivision).toContain('>1 division</span>')
    expect(byDivision).toMatch(/aria-pressed="true"[^>]*>(?:<svg.*?<\/svg>)?<span class="min-w-0 break-words">Medical</)
    expect(byDivision).toContain('>Clear Filters<')
    // With a division selected, only its departments are offered (no Unassigned group).
    expect(byDivision).not.toContain('>Unassigned departments</p>')
    // An old single-value link still works.
    const byDepartment = directory('?dept=it')
    expect(byDepartment).toContain('>Procedure 1<')
    expect(byDepartment).not.toContain('Procedure 9<')
    expect(byDepartment).toContain('aria-label="Filter: 1 department"')
  })

  it('combines them with Rule 1, and ignores the removed No Division value in old links', () => {
    fixture.sops = [sop('1', 'it'), sop('9', 'pv')]
    // The unassigned department isn't offered while a division is selected, so it is dropped; the division keeps its departments.
    const both = directory('?division=med&dept=it')
    expect(both).toContain('>Procedure 9<')
    expect(both).not.toContain('Procedure 1<')
    expect(both).toContain('aria-label="Filter: 1 division"')
    // Departments only: just those, in any division.
    expect(directory('?dept=pv,it')).toContain('>2 SOPs<')
    expect(directory('?dept=pv')).toContain('>1 SOP<')
    // "No Division" (the removed chip) in an old link is ignored.
    expect(directory('?division=__no-division__')).toContain('>2 SOPs<')
  })

  it('shows the normal empty state, with Clear Filters, when nothing matches', () => {
    fixture.sops = [sop('9', 'pv')]
    const html = directory('?q=nothing')
    expect(html).toContain('>0 SOPs<')
    expect(html).toContain(`>${sopsEn.filters.empty}<`)
    expect(html).toContain('>Clear Filters<')
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
