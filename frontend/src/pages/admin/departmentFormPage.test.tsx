import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import { DepartmentFormPage } from './DepartmentFormPage'

const department = { id: 'home', name: 'Home', initials: 'HM', description: 'Our work' }
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ activeDepartments: [department], departments: [department], addDepartment: vi.fn(), updateDepartment: vi.fn() }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [] }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))

const render = (path: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/departments/new" element={<DepartmentFormPage />} />
      <Route path="/admin/departments/:id/edit" element={<DepartmentFormPage />} />
    </Routes>
  </MemoryRouter>,
)

describe.each([['Add Department', '/admin/departments/new'], ['Edit Department', '/admin/departments/home/edit']])('%s', (_, path) => {
  const html = render(path)
  const label = (text: string) => html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}(.*?)</label>`))!
  const control = (id: string) => html.match(new RegExp(`<(?:input|textarea)[^>]*id="${id}"[^>]*>`))![0]

  it.each(['Name', 'Initials'])('marks %s as required, visibly and for screen readers', (text) => {
    const [, id, mark] = label(text)
    expect(mark).toContain('>*<')
    expect(control(id)).toContain('required=""')
  })

  it('keeps Description optional, with no asterisk and no "(Optional)", and keeps the hints', () => {
    const [, id, mark] = label('Description')
    expect(mark).not.toContain('>*<')
    expect(control(id)).not.toContain('required=""')
    expect(html).not.toContain('(Optional)')
    expect(html).toContain('2–3 letters, e.g. QA.')
    expect(html).toContain('One line about what the department does')
  })
})

describe('Review Workflow Configuration', () => {
  it('labels its optional fields without "(Optional)"', () => {
    expect(reviewFlowEn.workflowConfig.division).toBe('Division Identifier')
    expect(reviewFlowEn.workflowConfig.controller).toBe('Quality Document Controller')
  })
})
