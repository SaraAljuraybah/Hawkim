import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DepartmentDetailsPage } from './DepartmentDetailsPage'

const department = { id: 'home', name: 'Home Department', initials: 'HM', description: 'Our work', divisionId: 'Medical Division' }
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [department], activeDepartments: [department], getDepartment: () => department, nameOf: () => department.name, removeDepartment: vi.fn(), configureWorkflow: vi.fn() }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [], activeUsers: [], nameOf: () => '' }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/requestsContext', () => ({ useRequests: () => ({ requests: [] }) }))

const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/departments/home']}><Routes><Route path="/admin/departments/:id" element={<DepartmentDetailsPage />} /></Routes></MemoryRouter>)

describe('the Department details page', () => {
  it('still shows the department', () => {
    expect(html).toContain('Home Department')
  })

  it('no longer has the Review Workflow Configuration section', () => {
    for (const text of ['Review Workflow Configuration', 'Configure Review Workflow', 'Division Identifier', 'Quality Document Controller']) expect(html).not.toContain(text)
  })
})
