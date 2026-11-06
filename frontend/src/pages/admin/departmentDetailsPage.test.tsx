import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DepartmentDetailsPage } from './DepartmentDetailsPage'

const department = { id: 'home', name: 'Home Department', initials: 'HM', description: 'Our work', divisionId: 'Medical Division' }
const member = { id: 'u1', name: 'Sara Ali', email: 'sara@example.com', initials: 'SA', departmentId: 'home', permissions: ['author'] }
const users = vi.hoisted(() => ({ value: [] as unknown[] }))
const management = vi.hoisted(() => ({ value: {} as { data?: unknown; error?: string; refresh: () => Promise<void> } }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => management.value }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [department], activeDepartments: [department], getDepartment: () => department, nameOf: () => department.name, removeDepartment: vi.fn(), configureWorkflow: vi.fn() }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: users.value, activeUsers: users.value, nameOf: () => '' }) }))
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

users.value = [member]
management.value = { refresh: vi.fn() }
const html = render()

describe('the Department details page', () => {
  it('still shows the department', () => {
    expect(html).toContain('Home Department')
  })

  it('no longer has the Review Workflow Configuration section', () => {
    for (const text of ['Review Workflow Configuration', 'Configure Review Workflow', 'Division Identifier', 'Quality Document Controller']) expect(html).not.toContain(text)
  })

  it('keeps the users list from the people store', () => {
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

  it('shows Description first, then Division, and no Initials field', () => {
    management.value = { data: snapshot(), refresh: vi.fn() }
    const page = render()
    const details = page.match(/<dl[\s\S]*?<\/dl>/)![0]
    expect(details.match(/<dt[^>]*>([^<]*)<\/dt>/g)!.map((tag) => tag.replace(/<[^>]+>/g, ''))).toEqual(['Description', 'Division'])
    expect(details).toMatch(/>Description<\/dt><dd[^>]*>Our work</)
    expect(page).not.toContain('Initials')
    // The badge beside the name is generated from the name, not the stored initials (HM).
    expect(page).toMatch(/aria-hidden="true"[^>]*>HD<\/span>/)
  })

  it('lists the department’s users as Users (N), without positions or position editing', () => {
    management.value = { data: snapshot(), refresh: vi.fn() }
    const page = render()
    expect(page).toContain('Users (1)')
    expect(page).not.toContain('Members')
    expect(page).toContain('href="/admin/users/u1"')
    for (const text of ['Lead Pharmacist', 'Trainer', 'Positions', 'Edit positions', 'Position required', 'Positions saved']) expect(page).not.toContain(text)
  })

  it('puts a small copy icon right beside each user’s email', () => {
    management.value = { data: snapshot(), refresh: vi.fn() }
    const page = render()
    expect(page).toMatch(/<p class="[^"]*">sara@example.com<\/p><span class="contents"><span class="inline-flex shrink-0">(?:<span[^>]*>)?<button[^>]*aria-label="Copy Sara Ali’s email"/)
    expect(page).not.toMatch(/>Copy</)
  })

  it('shows no copy icon for a user without an email', () => {
    users.value = [{ ...member, email: '' }]
    management.value = { data: snapshot(), refresh: vi.fn() }
    const page = render()
    users.value = [member]
    expect(page).toContain('Sara Ali')
    expect(page).not.toContain('Copy Sara Ali’s email')
  })

  it('says No users. when the department has none', () => {
    users.value = []
    management.value = { data: snapshot({ people: [], employees: 0 }), refresh: vi.fn() }
    const page = render()
    users.value = [member]
    expect(page).toContain('Users (0)')
    expect(page).toContain('No users.')
  })

  it('has no SOPs, With Access or Remove Department sections', () => {
    management.value = { data: snapshot({ deletion_job_id: 'job', employees: 0, people: [] }), refresh: vi.fn() }
    const page = render()
    for (const text of ['SOPs (3)', 'SOPs by status', '>Draft<', '>Published<', 'With Access', 'Remove Department', 'Retry file cleanup', 'Delete']) expect(page).not.toContain(text)
    expect(page.match(/<section/g)).toHaveLength(2)
  })

  it('offers Retry when the snapshot can’t load, and still shows the department', () => {
    management.value = { error: 'boom', refresh: vi.fn() }
    const page = render()
    expect(page).toContain('Could not load organizational data. Try again.')
    expect(page).toContain('>Retry<')
    expect(page).toContain('Our work')
  })
})
