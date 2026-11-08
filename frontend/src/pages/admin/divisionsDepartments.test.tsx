import { organizationAdminEn } from '../../content/organizationAdmin.en'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { HierarchyTable } from './AdminDepartmentsPage'
import { Sidebar } from '../../components/layout/Sidebar'
import { adminEn } from '../../content/admin.en'
import type { ManagementSnapshot } from '../../services/organizationAdmin'
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ signOut: vi.fn() }) }))
const snapshot: ManagementSnapshot = { divisions: [{ id: 'v', name: 'Safety', description: 'Work', email: 's@test.invalid', updated_at: 'revision' }], departments: [
  { id: 'd', name: 'Medical', initials: 'MD', description: '', division_id: 'v', updated_at: 'revision', employees: 5, sops: 1, status_counts: { draft: 1 } },
] }
const render = (query = '', data = snapshot) => renderToStaticMarkup(<MemoryRouter><HierarchyTable snapshot={data} query={query} onEdit={vi.fn()} onPreview={vi.fn()} onViewDepartment={vi.fn()} onDeleteDivision={vi.fn()} onDeleteDepartment={vi.fn()} /></MemoryRouter>)
describe('unified divisions and departments table', () => {
  it('renders exactly one table, three named columns and an unlabeled action column', () => {
    const html = render()
    expect(html.match(/<table /g)).toHaveLength(1)
    expect(html).toContain('>Users</th>'); expect(html).toContain('>SOPs</th>'); expect(html).not.toContain('Employees')
    expect(html).not.toContain('With Access'); expect(html).not.toContain('>Description</th>')
    expect(html).toContain('Departments (1)')
  })
  it('keeps aggregates visible while child departments and their add button are collapsed', () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('>5</td>'); expect(html).toContain('>1</td>')
    expect(html).not.toContain('Add Department'); expect(html).not.toContain('>Medical</a>')
  })
  it('opens matching departments under their parent and presets Add Department to that division', () => {
    const html = render(' medical ')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('>Medical</span>')
    expect(html).toContain('/admin/departments/new?division=v')
    expect(html).toContain('Departments (1)')
  })
  it('drops the inner Departments label (the count stays under the name) and previews divisions and departments', () => {
    const html = render('safety')
    expect(html).not.toContain('>Departments</span>')
    expect(html).toContain('Departments (1)')
    expect(html).toContain('aria-label="Preview Safety"')
    expect(html).toContain('aria-label="Preview Medical"')
    expect(html).toContain('>Medical</span>')
    expect(html).not.toContain('href="/admin/departments/d"')
  })
  it('uses focusable restricted-action tooltips for employee and division blockers', () => {
    const html = render('safety')
    expect(html).toContain(organizationAdminEn.divisionBlocked)
    expect(html).toContain(organizationAdminEn.departmentBlocked)
    expect(html).toContain('aria-disabled="true"')
  })
  it('shows 0 for empty divisions and a meaningful search empty state', () => {
    const html = render('', { ...snapshot, departments: [] })
    expect(html.match(/>0<\/td>/g)).toHaveLength(2)
    expect(render('unknown')).toContain('No divisions or departments match your search.')
  })
  it('preserves unassigned legacy departments without inventing a parent', () => {
    const html = render('', { ...snapshot, divisions: [] })
    expect(html).toContain('Unassigned departments'); expect(html).toContain('Medical')
  })
})
describe('admin navigation', () => {
  it.each(['/admin/departments', '/admin/departments/d', '/admin/departments/d/edit'])('highlights the unified entry at %s', (path) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Sidebar content={adminEn.shell} /></MemoryRouter>)
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/departments"|href="\/admin\/departments"[^>]*aria-current="page"/)
    expect(adminEn.shell.nav.filter((item) => item.label === 'Departments')).toHaveLength(0)
    expect(adminEn.shell.nav.filter((item) => item.label === 'Divisions & Departments')).toHaveLength(1)
    expect(adminEn.shell.nav.at(-1)?.label).toBe('Organizational Structure')
  })
})
