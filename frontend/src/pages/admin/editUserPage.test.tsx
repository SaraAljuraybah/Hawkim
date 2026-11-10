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
  it('has one h1: "Edit Staff" as a small line above the name, no subtitle, with the browser tab title', () => {
    fixture.titles.length = 0
    const html = render()
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('<h1 class="min-w-0 text-xl break-words tracking-tight sm:text-3xl"><span class="block text-sm font-medium tracking-normal text-text-gray">Edit Staff</span> Rana Saleh</h1>')
    expect(html).not.toContain('Update this staff member&#x27;s details and permissions.')
    expect(fixture.titles.at(-1)).toBe(adminEn.pageTitle.replace('{page}', 'Edit Staff'))
  })

  it('fills in every field with the user\'s details, all editable', () => {
    const html = render()
    expect(control(html, 'name')).toContain('value="Rana Saleh"')
    expect(control(html, 'email')).toContain('value="rana@example.test"')
    // The 8 digits after the fixed "+9665"; saved as +9665XXXXXXXX.
    expect(control(html, 'phone')).toContain('value="12345678"')
    expect(html).toMatch(/<span id="[^"]+">\+9665<\/span>/)
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
    expect(html).not.toContain('They sign in with this email.')
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
    // Admin isn't a Staff permission (Manage Organization → Admins).
    expect(html).not.toContain('value="admin"')
  })

  it('has the User Details header above the form: large avatar, name, Delete beside it and the saved badges', () => {
    const html = render()
    const header = html.slice(0, html.indexOf('<form'))
    expect(header).toContain('class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-beige text-xs font-semibold text-maroon size-10 text-sm sm:size-14 sm:text-base">RS</span>')
    // Delete beside the name, below the "Edit Staff" line; no Edit Staff button here.
    expect(header).toMatch(/Rana Saleh<\/h1><div class="flex shrink-0 items-center gap-2 mt-5"><span class="relative inline-flex"><button type="button" aria-label="Delete Rana Saleh"/)
    expect(header).not.toContain('>Edit Staff</a>')
    expect([...header.matchAll(/<li class="inline-flex[^"]*">([^<]+)<\/li>/g)].map((match) => match[1])).toEqual(['Author', 'Reviewer'])
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
