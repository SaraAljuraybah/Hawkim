import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { OrganizationChart } from '../components/layout/OrganizationChart'
import { Sidebar } from '../components/layout/Sidebar'
import { adminEn } from '../content/admin.en'
import type { OrganizationHierarchy } from '../services/organization'
import { OrganizationalStructurePage, OrganizationContent } from './OrganizationalStructurePage'

vi.mock('../state/sessionContext', () => ({ useSession: () => ({ signOut: vi.fn() }), useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [] }) }))
const hierarchy: OrganizationHierarchy = {
  organization: { name: 'Configured Organization' }, divisions: [{ id: 'division-1', name: 'Operations' }],
  departments: [
    { id: 'department-1', name: 'Quality', divisionId: 'division-1', employees: [{ id: 'person-1', name: 'Test Employee', initials: 'TE', email: 'test.employee@test.invalid', position: 'Specialist', permissions: ['author', 'reviewer', 'approver'] }] },
    { id: 'department-2', name: 'Empty Department', divisionId: null, employees: [] },
  ],
}
const chart = (value = hierarchy, qualityDepartmentId?: string) => renderToStaticMarkup(<OrganizationChart hierarchy={value} qualityDepartmentId={qualityDepartmentId} />)

describe('Organizational Structure', () => {
  it('puts Organizational Structure last after Regulations with its existing active indicator', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/organizational-structure']}><Sidebar content={adminEn.shell} /></MemoryRouter>)
    expect(adminEn.shell.nav.map((item) => item.label)).toEqual(['Users', 'Departments', 'Requests', 'Regulations', 'Organizational Structure'])
    expect(html.indexOf('>Regulations<')).toBeLessThan(html.indexOf('>Organizational Structure<'))
    expect(html.indexOf('>Organizational Structure<')).toBeLessThan(html.indexOf('>Sign Out<'))
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/organizational-structure"/)
    expect(html).toContain('lucide-network')
  })
  it('keeps the page heading and removes the description without a replacement subtitle', () => {
    const html = renderToStaticMarkup(<OrganizationalStructurePage />)
    expect(html).toContain('>Organizational Structure</h1>')
    expect(html).not.toContain("Explore the organization")
    expect(html.slice(0, html.indexOf('role="status"'))).not.toMatch(/<p(?:\s|>)/)
    expect(html).not.toContain('Refresh')
    expect(html).not.toContain('lucide-refresh-cw')
    expect(html).not.toContain('<button')
  })
  it('renders real division and department relationships with accurate membership counts and all permissions', () => {
    const html = chart()
    for (const text of ['Configured Organization', 'Operations', 'Quality', 'Test Employee', 'Author', 'Reviewer', 'Approver', '1 employee', '0 employees']) expect(html).toContain(text)
    expect(html).toContain('Departments without a division')
    const qualityMembers = html.match(/<ul aria-label="Quality".*?<\/ul>/)![0]
    expect(qualityMembers).toContain('Test Employee')
  })
  it('shows each person as name, then roles, then email with a copy button, without the position', () => {
    const html = chart()
    const row = html.match(/<li[^>]*bg-offwhite.*?<\/li>/)![0]
    const name = row.indexOf('>Test Employee</p>')
    const roles = row.indexOf('Permissions: </span>Author, Reviewer, Approver</p>')
    const email = row.indexOf('Email: </span>test.employee@test.invalid</p>')
    expect(name).toBeGreaterThan(-1)
    expect(roles).toBeGreaterThan(name)
    expect(email).toBeGreaterThan(roles)
    expect(row.indexOf('aria-label="Copy Test Employee&#x27;s email"')).toBeGreaterThan(email)
    expect(row).toContain('aria-live="polite"')
    expect(html).not.toContain('Specialist')
    expect(html).not.toContain('Position')
  })
  it('uses plain comma-separated permissions, without chart icons or role badges', () => {
    const html = chart()
    expect(html).toContain('Permissions: </span>Author, Reviewer, Approver</p>')
    expect(html).not.toContain('rounded-full border')
    for (const icon of ['lucide-folder', 'lucide-building-2', 'lucide-network']) expect(html).not.toContain(icon)
    expect(html).toContain('lucide-chevron-down')
    expect(html).toContain('org-root--connected')
    expect(html).toContain('!text-white')
    expect(html).not.toContain('overflow-x-auto')
    expect(html).not.toContain('w-80')
  })
  it('retains database labels and department names, and shows no role label for people without a role', () => {
    const data = structuredClone(hierarchy)
    data.divisions[0].id = 'rnd'
    data.divisions[0].name = 'R&D Division'
    data.departments[0].divisionId = 'rnd'
    data.departments[0].name = 'Legal & Governance'
    data.departments[0].employees[0].permissions = []
    delete data.departments[0].employees[0].position
    const html = chart(data)
    expect(html).toContain('R&amp;D Division')
    expect(html).toContain('Legal &amp; Governance')
    expect(html).not.toContain('Permissions:')
    expect(html).not.toContain('>Employee<')
    expect(html).toContain('>Test Employee</p>')
  })
  it.each([
    ['rnd', 'Clinical Research & Development'],
    ['governance_quality_compliance', 'Quality & Compliance'],
  ])('displays the RPC-provided name for division %s without renaming its department', (id, name) => {
    const data = structuredClone(hierarchy)
    data.divisions = [{ id, name }]
    data.departments[0].divisionId = id
    data.departments[0].name = 'Legal & Governance'
    expect(chart(data)).toContain(`>${name.replaceAll('&', '&amp;')}</h3>`)
    expect(chart(data)).toContain('Legal &amp; Governance')
    data.divisions[0].name = 'A different persisted division label'
    expect(chart(data)).toContain('>A different persisted division label</h3>')
    expect(chart(data)).not.toContain(`>${name.replaceAll('&', '&amp;')}</h3>`)
  })
  it('uses independent native disclosures for mouse and keyboard expansion without exclusive grouping', () => {
    const html = chart()
    const disclosures = html.match(/<details[^>]*>/g)!
    expect(disclosures).toHaveLength(2)
    for (const disclosure of disclosures) {
      expect(disclosure).not.toContain(' name=')
      expect(disclosure).not.toContain(' open=')
    }
    expect(html.match(/<summary /g)).toHaveLength(2)
    expect(html).toContain('group-open:rotate-180')
    expect(html).toContain('max-h-80 overflow-y-auto')
  })
  it('shows empty departments, generic organization and an honest fallback without fabricated divisions', () => {
    const html = chart({ ...hierarchy, organization: null, divisions: [] })
    expect(html).toContain('>Organization<')
    expect(html).toContain('until divisions are configured')
    expect(html).toContain('No employees assigned')
    expect(html).not.toContain('Operations')
    expect(chart({ organization: null, divisions: [], departments: [] })).toContain('No departments have been configured yet')
  })
  it('gives each department with employees its own name search and role filter, side by side when wide enough', () => {
    const html = chart()
    const searches = html.match(/<div role="search"[^>]*>/g)!
    expect(searches).toEqual(['<div role="search" aria-label="Search and filter Quality" class="@container border-b border-beige p-3">'])
    expect(html).toContain('@xs:grid-cols-2')
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="organization-search-department-1"|<input[^>]*name="organization-search-department-1"[^>]*type="search"/)
    expect(html).toContain('>Search by name</label>')
    expect(html).toContain('aria-label="Filter by role"')
    expect(html).toContain('>All roles</span>')
    // No search box in a department without employees, and no "No matching employees" before searching.
    expect(html).not.toContain('organization-search-department-2')
    expect(html).not.toContain('No matching employees')
  })
  it('offers Approver in the role filter only in the Quality department', () => {
    const options = (html: string) => [...html.matchAll(/name="organization-roles-department-1" value="([^"]+)"/g)].map((match) => match[1])
    const roleLabels = (html: string) => [...html.matchAll(/<span class="min-w-0 break-words">([^<]+)<\/span>/g)].map((match) => match[1])
    const quality = chart(hierarchy, 'department-1')
    expect(options(quality)).toEqual(['author', 'reviewer', 'approver', 'others'])
    expect(roleLabels(quality)).toEqual(['Author', 'Reviewer', 'Approver', 'Others'])
    const other = chart(hierarchy, 'department-2')
    expect(options(other)).toEqual(['author', 'reviewer', 'others'])
    expect(roleLabels(other)).toEqual(['Author', 'Reviewer', 'Others'])
    expect(options(chart())).toEqual(['author', 'reviewer', 'others'])
  })
  it('renders loading skeletons and a clear retry state', () => {
    expect(renderToStaticMarkup(<OrganizationContent state={{ status: 'loading' }} reload={() => {}} />)).toContain('role="status"')
    const html = renderToStaticMarkup(<OrganizationContent state={{ status: 'error' }} reload={() => {}} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('>Retry<')
    expect(html).not.toContain('Test Employee')
  })
})
