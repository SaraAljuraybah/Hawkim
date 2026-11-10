import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../components/layout/Sidebar'
import { OrganizationTable } from '../components/layout/OrganizationTable'
import { adminEn } from '../content/admin.en'
import { organizationRows, type OrganizationFilters } from '../lib/organization'
import type { OrganizationHierarchy } from '../services/organization'
import { OrganizationalStructurePage, OrganizationContent, OrganizationStructure } from './OrganizationalStructurePage'

vi.mock('../state/sessionContext', () => ({ useSession: () => ({ signOut: vi.fn() }), useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
const hierarchy: OrganizationHierarchy = {
  organization: null,
  divisions: [{ id: 'division-1', name: 'Operations', email: 'ops@test.invalid' }, { id: 'division-2', name: 'R&D Division', email: null }],
  departments: [
    { id: 'department-1', name: 'Quality', divisionId: 'division-1', email: 'quality@test.invalid', employees: [
      { id: 'person-1', name: 'Dana Fahad', initials: 'DF', email: 'dana@test.invalid', position: 'Specialist', permissions: ['author', 'reviewer'] },
      { id: 'person-2', name: 'No Role Person', initials: 'NR', email: 'norole@test.invalid', permissions: [] },
    ] },
    { id: 'department-2', name: 'Empty Department', divisionId: 'division-1', employees: [] },
  ],
}
const page = (value = hierarchy) => renderToStaticMarkup(<OrganizationStructure hierarchy={value} />)
const table = (filters: Partial<OrganizationFilters>, value = hierarchy) => {
  const all = { query: '', divisions: [], roles: [], ...filters }
  return renderToStaticMarkup(<OrganizationTable rows={organizationRows(value, all)} filtering filterKey="test" />)
}

describe('Organizational Structure', () => {
  it('puts Organizational Structure fourth, after SFDA Regulatory Requirements, with its existing active indicator', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/organizational-structure']}><Sidebar content={adminEn.shell} /></MemoryRouter>)
    expect(adminEn.shell.nav[3]?.label).toBe('Organizational Structure')
    expect(html.indexOf('>SFDA Regulatory Requirements<')).toBeLessThan(html.indexOf('>Organizational Structure<'))
    expect(html.indexOf('>Organizational Structure<')).toBeLessThan(html.indexOf('>SOP Directory<'))
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/organizational-structure"/)
  })
  it('has one h1 and no tree', () => {
    const html = renderToStaticMarkup(<OrganizationalStructurePage />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('>Organizational Structure</h1>')
    for (const removed of ['org-root', 'org-branches', '<details', '>Organization<']) expect(page()).not.toContain(removed)
  })
  it('shows a Name | Email table with no Users, SOPs or action columns', () => {
    const html = page()
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])).toEqual(['Name', 'Email'])
    for (const text of ['>Users<', '>SOPs<', 'lucide-pencil', 'lucide-trash', 'lucide-plus', 'lucide-eye']) expect(html).not.toContain(text)
  })
  it('shows divisions with their department count and email, or "—" when there is none', () => {
    const html = page()
    expect(html).toContain('>Operations</span>')
    expect(html).toContain('>Departments (2)</span>')
    expect(html).toContain('>Departments (0)</span>')
    expect(html).toContain('R&amp;D Division')
    expect(html).toContain('title="ops@test.invalid"')
    expect(html).toContain('aria-label="Copy email for Operations"')
    expect(html).toContain('<span aria-hidden="true">—</span><span class="sr-only">No email</span>')
  })
  it('starts with everything collapsed, each level a real toggle button', () => {
    const html = page()
    const toggles = html.slice(html.indexOf('<table')).match(/<button type="button" aria-expanded="[^"]+"[^>]*>/g)!
    // 2 divisions, 2 departments: all closed.
    expect(toggles).toHaveLength(4)
    for (const toggle of toggles) expect(toggle).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="org-children-division-1"')
    expect(html).toMatch(/<tbody id="org-children-division-1" hidden="">/)
    expect(html).toContain('aria-controls="org-staff-department-1-person-1 org-staff-department-1-person-2"')
  })
  it('shows departments with their staff count and email, and "No staff in this department"', () => {
    const html = page()
    expect(html).toContain('>Staff (2)</span>')
    expect(html).toContain('>Staff (0)</span>')
    expect(html).toContain('aria-label="Copy email for Quality"')
    expect(html).toContain('No staff in this department')
    expect(html).not.toContain('Employee')
    expect(html).not.toContain('>Users')
  })
  it('shows each person with avatar, name, roles and email with a copy button; nothing under a name without a role', () => {
    const html = table({ query: 'dana' })
    const row = html.match(/<tr id="org-staff-department-1-person-1".*?<\/tr>/)![0]
    expect(row).not.toMatch(/^<tr[^>]* hidden=/)
    expect(row).toContain('>DF</span>')
    expect(row).toContain('>Dana Fahad</span>')
    expect(row).toContain('Roles: </span>Author, Reviewer</span>')
    expect(row).toContain('title="dana@test.invalid"')
    expect(row).toContain('aria-label="Copy email for Dana Fahad"')
    expect(row).toContain('aria-live="polite"')
    expect(row).not.toContain('Specialist')
    const noRole = table({ query: 'no role' }).match(/<tr id="org-staff-department-1-person-2".*?<\/tr>/)![0]
    expect(noRole).toContain('>No Role Person</span></span>')
    expect(noRole).not.toContain('Roles:')
    expect(noRole).not.toContain('Employee')
  })
  it('opens the rows needed to show search results, and shows only the matches', () => {
    const html = table({ query: 'dana' })
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2)
    expect(html).not.toContain('No Role Person')
    expect(html).not.toContain('Empty Department')
    expect(html).not.toContain('R&amp;D Division')
  })
  it('shows an empty state when nothing matches', () => {
    expect(table({ query: 'nobody' })).toContain('No divisions, departments or staff match your search and filters.')
    expect(renderToStaticMarkup(<OrganizationTable rows={[]} filtering={false} filterKey="" />)).toContain('No divisions or departments have been configured yet.')
  })
  it('adds an "Unassigned departments" group row last, only when such a department exists', () => {
    expect(page()).not.toContain('Unassigned departments')
    const data = structuredClone(hierarchy)
    data.departments.push({ id: 'department-3', name: 'Legacy Unit', divisionId: null, employees: [] })
    const html = page(data)
    expect(html).toContain('<th scope="colgroup" colSpan="2" class="bg-beige/20 p-4 text-maroon">Unassigned departments</th>')
    expect(html.indexOf('Unassigned departments')).toBeGreaterThan(html.indexOf('R&amp;D Division'))
    expect(html.indexOf('Legacy Unit')).toBeGreaterThan(html.indexOf('Unassigned departments'))
  })
  it('has one search, a Filter button with Division and Role chips, and a Sort without SOP options', () => {
    const html = page()
    expect(html.match(/type="search"/g)).toHaveLength(1)
    expect(html).toContain('placeholder="Search by name or email"')
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="[^"]+"[^>]*>.*?lucide-funnel.*?Filter<\/button>/)
    expect([...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((match) => match[1])).toEqual(['Division', 'Role'])
    const chips = [...html.matchAll(/aria-pressed="false"[^>]*><span class="min-w-0 break-words">([^<]+)<\/span>/g)].map((match) => match[1])
    expect(chips).toEqual(['Operations', 'R&amp;D Division', 'Author', 'Reviewer', 'Approver', 'Others'])
    expect(html).toContain('>Clear all</button>')
    const sorts = [...html.matchAll(/<option value="[^"]+"[^>]*>([^<]+)<\/option>/g)].map((match) => match[1])
    expect(sorts).toEqual(['Default order', 'Name: A to Z', 'Name: Z to A', 'Departments: High to Low', 'Departments: Low to High'])
  })
  it('renders loading skeletons and a clear retry state', () => {
    expect(renderToStaticMarkup(<OrganizationContent state={{ status: 'loading' }} reload={() => {}} />)).toContain('role="status"')
    const html = renderToStaticMarkup(<OrganizationContent state={{ status: 'error' }} reload={() => {}} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('>Retry<')
  })
})
