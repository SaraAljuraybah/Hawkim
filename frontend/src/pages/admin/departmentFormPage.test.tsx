import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import type { ManagementSnapshot } from '../../services/organizationAdmin'
import { DepartmentFormPage } from './DepartmentFormPage'

const snapshot: ManagementSnapshot = {
  divisions: [
    { id: 'medical', name: 'Medical Division', description: '', email: null, updated_at: 'v1' },
    { id: 'quality', name: 'Quality Division', description: '', email: null, updated_at: 'v1' },
  ],
  departments: [
    { id: 'home', name: 'Home', initials: 'HM', description: 'Our work', email: 'home@hawkim.test', division_id: 'quality', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
    { id: 'legacy', name: 'Legacy', initials: 'LG', description: '', division_id: null, updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {} },
    { id: 'pending', name: 'Pending', initials: 'PD', description: '', division_id: 'medical', updated_at: 'r1', deletion_job_id: 'job', people: [], employees: 0, sops: 0, status_counts: {} },
  ],
}
const management = vi.hoisted(() => ({ value: {} as { data?: unknown; error?: string; refresh: () => Promise<void> } }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => management.value }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ reload: vi.fn() }) }))
// Set now as well: the describe.each blocks below render while the tests are collected.
const loaded = () => { management.value = { data: snapshot, refresh: vi.fn() } }
loaded()
beforeEach(loaded)

const render = (path: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/departments/new" element={<DepartmentFormPage />} />
      <Route path="/admin/departments/:id/edit" element={<DepartmentFormPage />} />
    </Routes>
  </MemoryRouter>,
)
const selected = (html: string) => html.match(/<select[^>]*name="division"[^>]*>[\s\S]*?<\/select>/)![0].match(/<option[^>]*selected=""[^>]*>([^<]*)</)?.[1]

describe.each([['Add Department', '/admin/departments/new'], ['Edit Department', '/admin/departments/home/edit']])('%s', (_, path) => {
  const html = render(path)
  const label = (text: string) => html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}(.*?)</label>`))!
  const control = (id: string) => html.match(new RegExp(`<(?:input|textarea|select)[^>]*id="${id}"[^>]*>`))![0]

  it('marks Name as required, visibly and for screen readers', () => {
    const [, id, mark] = label('Name')
    expect(mark).toContain('>*<')
    expect(control(id)).toContain('required=""')
  })

  it('has no Initials field: they are generated from the name and can’t be typed', () => {
    expect(html).not.toMatch(/>Initials</)
    expect(html).not.toContain('name="initials"')
    expect(html).not.toContain('2–3 letters')
    expect(html.match(/<(input|textarea|select)[^>]*name="([^"]+)"/g)!.map((tag) => tag.match(/name="([^"]+)"/)![1])).toEqual(['division', 'name', 'description', 'email'])
  })

  it('has an optional Email field after Description, with its placeholder', () => {
    const [, id, mark] = label('Email')
    expect(mark).not.toContain('>*<')
    const input = control(id)
    expect(input).not.toContain('required=""')
    expect(input).toContain('type="email"')
    expect(input).toContain('placeholder="e.g. qa@example.com"')
  })

  it('keeps Description optional, with no asterisk and no "(Optional)", and keeps the hints', () => {
    const [, id, mark] = label('Description')
    expect(mark).not.toContain('>*<')
    expect(control(id)).not.toContain('required=""')
    expect(html).not.toContain('(Optional)')
    expect(html).toContain('One line about what the department does')
  })

  it('asks for the Division first, as a required field listing the active divisions', () => {
    const [, id, mark] = label('Division')
    expect(mark).toContain('>*<')
    expect(control(id)).toContain('required=""')
    expect(html.indexOf('>Division<')).toBeLessThan(html.indexOf('>Name<'))
    expect(html).toContain('>Medical Division<')
    expect(html).toContain('>Quality Division<')
  })
})

describe('Review Workflow Configuration', () => {
  it('labels its optional fields without "(Optional)"', () => {
    expect(reviewFlowEn.workflowConfig.division).toBe('Division Identifier')
    expect(reviewFlowEn.workflowConfig.controller).toBe('Quality Document Controller')
  })
})

describe('the Division of a department', () => {
  it('starts empty for a new department, so the admin must choose', () => {
    expect(selected(render('/admin/departments/new'))).toBe('Select a division')
  })

  it('is preset from ?division=<id> (Add Department under a division)', () => {
    expect(selected(render('/admin/departments/new?division=medical'))).toBe('Medical Division')
  })

  it('ignores an unknown or inactive ?division and says why', () => {
    const html = render('/admin/departments/new?division=gone')
    expect(selected(html)).toBe('Select a division')
    expect(html).toContain('The division in the link is no longer available. Select a division.')
  })

  it('shows the edited department’s own division, ignoring ?division', () => {
    expect(selected(render('/admin/departments/home/edit?division=medical'))).toBe('Quality Division')
  })

  it('lets a legacy department without a division keep none (optional, no asterisk)', () => {
    const html = render('/admin/departments/legacy/edit')
    expect(selected(html)).toBe('No division (existing assignment)')
    const select = html.match(/<select[^>]*name="division"[^>]*>/)![0]
    expect(select).not.toContain('required=""')
  })
})

describe('loading, errors and unavailable departments', () => {
  it('waits for the management snapshot before showing the form', () => {
    management.value = { refresh: vi.fn() }
    const html = render('/admin/departments/new')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('<form')
  })

  it('offers Retry when the snapshot can’t be loaded', () => {
    management.value = { error: 'boom', refresh: vi.fn() }
    const html = render('/admin/departments/new')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Could not load organizational data. Try again.')
    expect(html).toContain('>Retry<')
  })

  it('shows Not Found for a department that isn’t active', () => {
    expect(render('/admin/departments/removed/edit')).not.toContain('<form')
  })

  it('doesn’t offer editing while the department’s file cleanup is pending', () => {
    const html = render('/admin/departments/pending/edit')
    expect(html).not.toContain('<form')
    expect(html).toContain('File cleanup for this department is still in progress.')
  })
})

describe('the Email field’s starting value', () => {
  const email = (html: string) => html.match(/<input[^>]*name="email"[^>]*>/)![0].match(/value="([^"]*)"/)?.[1] ?? ''
  it('is empty when adding a department', () => {
    expect(email(render('/admin/departments/new'))).toBe('')
  })
  it('is the saved email when editing, and empty for a department without one', () => {
    expect(email(render('/admin/departments/home/edit'))).toBe('home@hawkim.test')
    expect(email(render('/admin/departments/legacy/edit'))).toBe('')
  })
})
