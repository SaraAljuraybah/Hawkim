import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DepartmentDetailsPage } from './DepartmentDetailsPage'

const department = { id: 'home', name: 'Home Department', initials: 'HM', description: 'Our work', divisionId: 'Medical Division' }
const member = { id: 'u1', name: 'Sara Ali', email: 'sara@example.com', initials: 'SA', departmentId: 'home', permissions: ['author'] }
const management = vi.hoisted(() => ({ value: {} as { data?: unknown; error?: string; refresh: () => Promise<void> } }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => management.value }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [department], activeDepartments: [department], getDepartment: () => department, nameOf: () => department.name, removeDepartment: vi.fn(), configureWorkflow: vi.fn() }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [member], activeUsers: [member], nameOf: () => '' }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/requestsContext', () => ({ useRequests: () => ({ requests: [] }) }))

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  divisions: [{ id: 'division-1', name: 'Medical Affairs', description: '', email: null, updated_at: 'v1' }],
  departments: [{
    id: 'home', name: 'Home Department', initials: 'HM', description: 'Our work', division_id: 'division-1', updated_at: 'r1',
    people: [{ ...member, positions: ['Lead Pharmacist', 'Trainer'] }], employees: 1, sops: 3,
    status_counts: { draft: 2, published: 1 }, ...overrides,
  }],
})
const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/departments/home']}><Routes><Route path="/admin/departments/:id" element={<DepartmentDetailsPage />} /></Routes></MemoryRouter>)

management.value = { refresh: vi.fn() }
const html = render()

describe('the Department details page', () => {
  it('still shows the department', () => {
    expect(html).toContain('Home Department')
  })

  it('no longer has the Review Workflow Configuration section', () => {
    for (const text of ['Review Workflow Configuration', 'Configure Review Workflow', 'Division Identifier', 'Quality Document Controller']) expect(html).not.toContain(text)
  })

  it('keeps the members and with-access panels from the people store', () => {
    expect(html).toContain('Sara Ali')
    expect(html).toContain('sara@example.com')
  })
})

describe('with the admin management snapshot', () => {
  it('shows the department’s division by name', () => {
    management.value = { data: snapshot(), refresh: vi.fn() }
    expect(render()).toMatch(/>Division<\/dt><dd[^>]*>Medical Affairs</)
  })

  it('says when a legacy department has no division', () => {
    management.value = { data: snapshot({ division_id: null }), refresh: vi.fn() }
    expect(render()).toMatch(/>Division<\/dt><dd[^>]*>No division</)
  })

  it('lists each member’s positions with an Edit positions action', () => {
    management.value = { data: snapshot(), refresh: vi.fn() }
    const page = render()
    expect(page).toContain('Lead Pharmacist, Trainer')
    expect(page).toContain('aria-label="Edit positions for Sara Ali"')
  })

  it('counts SOPs from the snapshot, by status', () => {
    management.value = { data: snapshot(), refresh: vi.fn() }
    const page = render()
    expect(page).toMatch(/SOPs \(3\)/)
    expect(page).toMatch(/>Draft<\/dt><dd[^>]*>2</)
    expect(page).toMatch(/>Published<\/dt><dd[^>]*>1</)
  })

  it('offers Retry file cleanup when a confirmed deletion is still pending', () => {
    management.value = { data: snapshot({ deletion_job_id: 'job', employees: 0, people: [] }), refresh: vi.fn() }
    expect(render()).toContain('Retry file cleanup')
  })

  it('offers Retry instead of SOP counts and Remove when the snapshot can’t load', () => {
    management.value = { error: 'boom', refresh: vi.fn() }
    const page = render()
    expect(page).toContain('Could not load organizational data. Try again.')
    expect(page).not.toContain('Remove Department</button>')
  })
})
