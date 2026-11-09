import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { Department, User } from '../../data/mock/types'
import { adminUserEditPath } from '../../lib/routes'
import { EditUserPage } from './EditUserPage'

const medical: Department = { id: 'safety', name: 'Drug Safety', initials: 'DS', description: '', divisionId: 'medical', divisionName: 'Medical Division' }
const medicalToo: Department = { ...medical, id: 'affairs', name: 'Medical Affairs' }
const other: Department = { ...medical, id: 'it', name: 'Information Technology', divisionId: 'tech', divisionName: 'Technology Division' }
const fixture = vi.hoisted(() => ({ users: [] as User[], titles: [] as string[] }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title?: string) => { if (title) fixture.titles.push(title) } }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: fixture.users, updateUser: vi.fn(), deleteUser: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ activeDepartments: [medical, medicalToo, other] }) }))

const render = (id = 'rana') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[adminUserEditPath(id)]}>
    <Routes><Route path="/admin/users/:id/edit" element={<EditUserPage />} /></Routes>
  </MemoryRouter>,
)
const control = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]
const checkbox = (html: string, value: string) => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))![0]

beforeEach(() => {
  fixture.users = [{
    id: 'rana', name: 'Rana Saleh', email: 'rana@example.test', initials: 'RS', departmentId: 'safety',
    phone: '+966512345678', position: 'Specialist', permissions: ['author', 'reviewer'],
  }]
})

describe('Edit Staff', () => {
  it('has one h1, Edit Staff, with its subtitle and browser tab title', () => {
    fixture.titles.length = 0
    const html = render()
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('>Edit Staff</h1>')
    expect(html).toContain('Update this staff member&#x27;s details and permissions.')
    expect(fixture.titles.at(-1)).toBe(adminEn.pageTitle.replace('{page}', 'Edit Staff'))
  })

  it('fills in every field with the user\'s details, all editable', () => {
    const html = render()
    expect(control(html, 'name')).toContain('value="Rana Saleh"')
    expect(control(html, 'email')).toContain('value="rana@example.test"')
    expect(control(html, 'phone')).toContain('value="+966512345678"')
    expect(control(html, 'division')).toContain('value="Medical Division"')
    expect(control(html, 'department')).toContain('value="Drug Safety"')
    expect(control(html, 'position')).toContain('value="Specialist"')
    for (const name of ['name', 'email', 'phone', 'division', 'department', 'position']) {
      expect(control(html, name)).not.toContain('readOnly')
      expect(control(html, name)).not.toContain('disabled=""')
    }
  })

  it('keeps Add User\'s helper texts and required marks', () => {
    const html = render()
    expect(html).toContain(adminEn.addUser.email.hint)
    expect(html).toContain(adminEn.addUser.phone.hint)
    expect(html.match(/>\*</g)).toHaveLength(6)
  })

  it('lists only the departments of the user\'s division', () => {
    const html = render()
    expect(html).toContain('>Drug Safety<')
    expect(html).toContain('>Medical Affairs<')
    expect(html).not.toContain('>Information Technology<')
  })

  it('checks the user\'s permissions only', () => {
    const html = render()
    expect(checkbox(html, 'author')).toContain('checked=""')
    expect(checkbox(html, 'reviewer')).toContain('checked=""')
    expect(checkbox(html, 'approver')).not.toContain('checked=""')
    expect(checkbox(html, 'admin')).not.toContain('checked=""')
  })

  it('shows the avatar, name and Delete in a row above the form, with one Delete', () => {
    const html = render()
    const row = html.slice(html.indexOf('</h1>'), html.indexOf('<form'))
    expect(row).toContain('>RS</span>')
    expect(row).toMatch(/<p[^>]*>Rana Saleh<\/p>/)
    expect(row.indexOf('>Rana Saleh<')).toBeLessThan(row.indexOf('aria-label="Delete Rana Saleh"'))
    expect(html.match(/aria-label="Delete Rana Saleh"/g)).toHaveLength(1)
  })

  it('ends with Cancel, back to the Staff list, and Save Changes', () => {
    const html = render()
    const actions = html.slice(html.lastIndexOf('name="permissions"'), html.indexOf('</form>'))
    expect(actions).toMatch(/<a[^>]*href="\/admin\/users"[^>]*>Cancel<\/a>/)
    expect(actions).toMatch(/<button type="submit"[^>]*>Save Changes<\/button>/)
    expect(html).not.toContain('>Add Staff<')
    expect(html).toMatch(/<a[^>]*href="\/admin\/users"[^>]*>.*Back to Staff<\/a>/)
  })

  it('keeps an empty live region at the top for the success message', () => {
    const html = render()
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('<form'))
    expect(html).toContain('<div role="status" tabindex="-1" class="rounded-lg focus:outline-none"></div>')
    expect(adminEn.editUser.saved).toBe('Changes saved.')
  })

  it('shows Not Found for an unknown user', () => {
    expect(render('nobody')).not.toContain('<form')
  })
})
