import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ManagementSnapshot } from '../../services/organizationAdmin'
import { managementError } from '../../services/organizationAdmin'
import { HierarchyTable } from './AdminDepartmentsPage'
import { DepartmentFormPage } from './DepartmentFormPage'

// Pharmacovigilance and Quality Assurance are the organization's default departments (system_key); Medical is not.
const snapshot: ManagementSnapshot = {
  divisions: [
    { id: 'v', name: 'Safety', description: 'Work', email: 's@test.invalid', updated_at: 'r' },
    { id: 'w', name: 'Quality', description: 'Work', email: 'q@test.invalid', updated_at: 'r' },
  ],
  departments: [
    { id: 'pv', name: 'Pharmacovigilance', initials: 'PV', description: 'Drug safety', email: 'pv@test.invalid', division_id: 'v', updated_at: 'r', employees: 0, sops: 0, status_counts: {}, people: [], system_key: 'pharmacovigilance' },
    { id: 'qa', name: 'Quality Assurance', initials: 'QA', description: 'Quality', email: 'qa@test.invalid', division_id: null, updated_at: 'r', employees: 0, sops: 0, status_counts: {}, people: [], system_key: 'quality-assurance' },
    { id: 'md', name: 'Medical', initials: 'MD', description: 'Medical', email: 'md@test.invalid', division_id: 'v', updated_at: 'r', employees: 0, sops: 0, status_counts: {}, people: [], system_key: null },
  ],
}
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../hooks/useOrganizationManagement', () => ({ useOrganizationManagement: () => ({ data: snapshot, refresh: vi.fn() }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ reload: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ signOut: vi.fn() }) }))

// A search opens the divisions it matches (every department here has an "a" or "i" in its name).
const table = (query = 'a') => renderToStaticMarkup(<MemoryRouter><HierarchyTable snapshot={snapshot} query={query} onEdit={vi.fn()} onPreview={vi.fn()}
  onViewDepartment={vi.fn()} onAddDepartment={vi.fn()} onEditDepartment={vi.fn()} onDeleteDivision={vi.fn()} onDeleteDepartment={vi.fn()} /></MemoryRouter>)
/** A department's button with this action, and the tooltip text it is described by. */
const button = (html: string, action: 'Delete' | 'Edit', name: string) => {
  const tag = html.match(new RegExp(`<button[^>]*aria-label="${action} ${name}"[^>]*>`))![0]
  const described = tag.match(/aria-describedby="([^"]+)"/)?.[1]
  const reason = described && html.match(new RegExp(`id="${described}"[^>]*><span[^>]*>([^<]*)<`))?.[1]
  return { disabled: tag.includes('aria-disabled="true"'), reason }
}
const form = (id: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/admin/departments/${id}/edit`]}>
    <Routes><Route path="/admin/departments/:id/edit" element={<DepartmentFormPage />} /></Routes>
  </MemoryRouter>,
)
const nameInput = (html: string) => html.match(/<input[^>]*name="name"[^>]*>/)![0]

describe('Divisions and Departments: the default departments', () => {
  it.each(['Pharmacovigilance', 'Quality Assurance'])('%s: Delete is disabled, saying why; Edit stays available', (name) => {
    const html = table(name)
    expect(button(html, 'Delete', name)).toEqual({ disabled: true, reason: 'This is a default department and cannot be deleted.' })
    expect(button(html, 'Edit', name).disabled).toBe(false)
  })

  it('an ordinary department can still be deleted', () => {
    expect(button(table('Medical'), 'Delete', 'Medical')).toEqual({ disabled: false, reason: undefined })
  })

  it('stays listed, with or without a division', () => {
    expect(table('Pharmacovigilance')).toContain('>Pharmacovigilance</span>')
    expect(table('Quality Assurance')).toContain('>Quality Assurance</span>')
  })
})

describe('Edit Department: a default department', () => {
  it('shows its name read-only, with the reason, and keeps the other fields editable', () => {
    const html = form('pv')
    const input = nameInput(html)
    expect(input).toContain('readOnly=""')
    expect(input).toContain('value="Pharmacovigilance"')
    expect(html).toContain('The name of a default department cannot be changed.')
    // The division can still be changed, and so can the description and email.
    // (Attributes only: the shared field classes include a "disabled:" style.)
    const locked = /\s(disabled|readOnly)=""/
    expect(html.match(/<select[^>]*name="division"[^>]*>/)![0]).not.toMatch(locked)
    expect(html.match(/<textarea[^>]*name="description"[^>]*>/)![0]).not.toMatch(locked)
    expect(html.match(/<input[^>]*name="email"[^>]*>/)![0]).not.toMatch(locked)
  })

  it('an ordinary department\'s name can still be edited', () => {
    const html = form('md')
    expect(nameInput(html)).not.toContain('readOnly')
    expect(html).not.toContain('The name of a default department cannot be changed.')
  })

  it('explains the database\'s refusals in the admin\'s words', () => {
    expect(managementError({ code: 'P0001', hint: 'default-department', message: 'Default departments cannot be deleted.' }).message)
      .toBe('This is a default department and cannot be deleted.')
    expect(managementError({ code: '23514', hint: 'default-department', message: "A default department's name can't be changed" }).message)
      .toBe('The name of a default department cannot be changed.')
  })
})
