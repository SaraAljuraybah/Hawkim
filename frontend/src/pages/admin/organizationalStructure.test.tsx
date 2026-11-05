import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { OrganizationChart } from '../../components/admin/OrganizationChart'
import { Sidebar } from '../../components/layout/Sidebar'
import { adminEn } from '../../content/admin.en'
import type { OrganizationHierarchy } from '../../services/organization'
import { OrganizationalStructurePage, OrganizationContent } from './OrganizationalStructurePage'

vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ signOut: vi.fn() }), useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
const hierarchy: OrganizationHierarchy = {
  organization: { name: 'Configured Organization' }, divisions: [{ id: 'division-1', name: 'Operations' }],
  departments: [
    { id: 'department-1', name: 'Quality', divisionId: 'division-1', employees: [{ id: 'person-1', name: 'Test Employee', initials: 'TE', position: 'Specialist', permissions: ['author', 'reviewer', 'approver'] }] },
    { id: 'department-2', name: 'Empty Department', divisionId: null, employees: [] },
  ],
}
const chart = (value = hierarchy) => renderToStaticMarkup(<OrganizationChart hierarchy={value} />)

describe('Organizational Structure', () => {
  it('puts Organizational Structure last after Regulations with its existing active indicator', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/organizational-structure']}><Sidebar content={adminEn.shell} /></MemoryRouter>)
    expect(adminEn.shell.nav.map((item) => item.label)).toEqual(['Users', 'Divisions & Departments', 'Requests', 'Regulations', 'Organizational Structure'])
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
    for (const text of ['Configured Organization', 'Operations', 'Quality', 'Test Employee', 'Specialist', 'Author', 'Reviewer', 'Approver', '1 employee', '0 employees']) expect(html).toContain(text)
    expect(html).toContain('Departments without a division')
    const qualityMembers = html.match(/<ul aria-label="Quality".*?<\/ul>/)![0]
    expect(qualityMembers).toContain('Test Employee')
    expect(html).not.toContain('email')
  })
  it('uses plain permissions distinct from the job position, without chart icons or role badges', () => {
    const html = chart()
    expect(html).toContain('Position: </span>Specialist</p>')
    expect(html).toContain('Permissions: </span>Author, Reviewer, Approver</p>')
    expect(html).not.toContain('rounded-full border')
    for (const icon of ['lucide-folder', 'lucide-building-2', 'lucide-network']) expect(html).not.toContain(icon)
    expect(html).toContain('lucide-chevron-down')
    expect(html).toContain('org-root--connected')
    expect(html).toContain('!text-white')
    expect(html).not.toContain('overflow-x-auto')
    expect(html).not.toContain('w-80')
  })
  it('retains database labels, department names and the roleless Employee meaning', () => {
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
    expect(html).toContain('Permissions: </span>Employee</p>')
    expect(html).not.toContain('Position:')
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
  it('renders loading skeletons and a clear retry state', () => {
    expect(renderToStaticMarkup(<OrganizationContent state={{ status: 'loading' }} reload={() => {}} />)).toContain('role="status"')
    const html = renderToStaticMarkup(<OrganizationContent state={{ status: 'error' }} reload={() => {}} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('>Retry<')
    expect(html).not.toContain('Test Employee')
  })
})
