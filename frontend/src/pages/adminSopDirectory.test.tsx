import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminEn } from '../content/admin.en'
import { sopsEn } from '../content/sops.en'
import type { Department, Sop, User } from '../data/mock/types'
import { SopDetailPage } from './SopDetailPage'
import { AdminSopsPage, SopsPage } from './SopsPage'
import { navLinks } from '../lib/sidebarNav'

const fixture = vi.hoisted(() => ({
  user: { id: 'admin', name: 'Nouf', initials: 'NA', email: 'nouf@example.test', departmentId: 'it', permissions: ['admin'] } as User,
  it: { id: 'it', name: 'Information Technology', initials: 'IT', description: '' } as Department,
  other: { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: '' } as Department,
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
  departments: [fixture.it, fixture.other],
}) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))
vi.mock('../hooks/useFileUrl', () => ({ useFileUrl: () => undefined, currentVersionOf: () => undefined }))

const sop = (id: string, departmentId: string, status: Sop['status'] = 'published'): Sop => ({
  id, code: `SOP-${id}`, title: `Procedure ${id}`, authorId: 'someone', coAuthorIds: [], departmentId, status, version: '1',
  lastUpdated: '2026-10-01', fileName: 'a.pdf', fileType: 'pdf', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [],
})
const directory = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/sops']}><AdminSopsPage /></MemoryRouter>)
const detail = (id: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/sops/${id}`]}><Routes><Route path="/admin/sops/:id" element={<SopDetailPage admin />} /></Routes></MemoryRouter>,
)

beforeEach(() => {
  fixture.sops = []
  fixture.titles.length = 0
})

describe('the SOP Directory in the admin portal', () => {
  it('is a tab between Organizational Structure and Requests', () => {
    const labels = navLinks(adminEn.shell.nav).map((item) => item.label)
    expect(labels.indexOf('SOP Directory')).toBe(labels.indexOf('Organizational Structure') + 1)
    expect(labels.indexOf('Requests')).toBe(labels.indexOf('SOP Directory') + 1)
  })

  it('shows the existing empty-state message, not a blank area, when the admin can read no SOP', () => {
    const html = directory()
    expect(html).toContain(`>${sopsEn.empty}<`)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('>SOP Directory</h1>')
    expect(fixture.titles.at(-1)).toBe('SOP Directory · Admin | Hawkim')
  })

  it('shows the admin\'s own department, with search, sort and the views, and no File Type filter', () => {
    const html = directory()
    expect(html).toContain('Information Technology')
    for (const name of ['sopSearch', 'sopSort']) expect(html).toContain(`name="${name}"`)
    expect(html).not.toContain('name="documentType"')
    expect(html).toContain('role="tablist"')
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
    expect(fixture.titles.at(-1)).toBe('Procedure 1 · Admin | Hawkim')
  })

  it('has no edit, workflow or request buttons', () => {
    fixture.sops = [sop('1', 'it')]
    const html = detail('1')
    for (const word of ['Edit', 'Submit', 'Upload', 'Delete', 'Review', 'Approve', 'Request Access', 'Compliance Check']) expect(html).not.toContain(`>${word}`)
  })

  it('never offers Request Access for another department\'s SOP', () => {
    fixture.sops = [sop('9', 'pv')]
    const html = detail('9')
    expect(html).toContain('This SOP belongs to Pharmacovigilance.')
    expect(html).not.toContain('Request Access')
    expect(html).not.toContain('/requests/new')
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

  it('still offer Request Access and go back to /sops', () => {
    fixture.user = { ...fixture.user, permissions: ['author'] }
    fixture.sops = [sop('9', 'pv')]
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/sops/9']}><Routes><Route path="/sops/:id" element={<SopDetailPage />} /></Routes></MemoryRouter>)
    expect(html).toContain('Request Access')
    expect(html).toContain('Request access to that department to view it.')
    expect(html).toMatch(/<a[^>]*href="\/sops"[^>]*>.*Back to SOP Directory<\/a>/)
    expect(fixture.titles.at(-1)).toBe('Procedure 9 | Hawkim')
    fixture.user = { ...fixture.user, permissions: ['admin'] }
  })
})
