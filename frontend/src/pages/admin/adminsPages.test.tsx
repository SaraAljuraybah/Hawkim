import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import type { LoadStatus } from '../../state/useLoadAfterSignIn'
import { AddAdminPage } from './AddAdminPage'
import { AdminAdminsPage } from './AdminAdminsPage'
import { AdminDetailsPage } from './AdminDetailsPage'
import { EditAdminPage } from './EditAdminPage'

const SUPER = 'amal'
const fixture = vi.hoisted(() => ({
  viewer: 'amal',
  users: [] as User[],
  usersStatus: 'ready' as LoadStatus,
  superAdmin: { status: 'ready' as LoadStatus, superAdminId: 'amal' as string | null },
}))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({
  useUsers: () => ({ status: fixture.usersStatus, activeUsers: fixture.users, addUser: vi.fn(), updateAdmin: vi.fn(), deleteAdmin: vi.fn() }),
}))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.viewer) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ activeDepartments: [] }) }))
vi.mock('../../hooks/useSuperAdmin', () => ({ useSuperAdmin: () => ({ ...fixture.superAdmin, reload: vi.fn(), set: vi.fn() }) }))

const admin = (id: string, name: string, email: string, phone = '+966512345678'): User =>
  ({ id, name, email, phone, initials: name.slice(0, 2).toUpperCase(), departmentId: '', permissions: ['admin'] })

beforeEach(() => {
  fixture.viewer = SUPER
  fixture.usersStatus = 'ready'
  fixture.superAdmin = { status: 'ready', superAdminId: SUPER }
  fixture.users = [
    admin(SUPER, 'Amal Fahad', 'amal@example.test'),
    admin('nouf', 'Nouf Saleh', 'nouf@example.test'),
    admin('zaid', 'Zaid Omar', 'zaid@example.test'),
    { id: 'sara', name: 'Sara Author', email: 'sara@example.test', initials: 'SA', departmentId: 'qa', position: 'Specialist', permissions: ['author'] },
  ]
})

const at = (path: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/admins" element={<AdminAdminsPage />} />
      <Route path="/admin/admins/new" element={<AddAdminPage />} />
      <Route path="/admin/admins/:id" element={<AdminDetailsPage />} />
      <Route path="/admin/admins/:id/edit" element={<EditAdminPage />} />
    </Routes>
  </MemoryRouter>,
)
const table = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'))
const row = (html: string, name: string) => {
  const start = table(html).indexOf(`>${name}</span></th>`)
  return table(html).slice(start, table(html).indexOf('</tr>', start))
}
const labels = (html: string) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])

describe('the Admins list', () => {
  it('has a heading, a description, Add Admin and a search by name or email', () => {
    const html = at('/admin/admins')
    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1)
    expect(html).toContain('>Admins</h1>')
    expect(html).toContain(adminsEn.list.description)
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins\/new"[^>]*>.*Add Admin<\/a>/)
    expect(html).toContain('placeholder="Search by admin name or email"')
    // As wide as every list page's search.
    expect(html).toContain('<div class="mt-8 relative grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">')
  })

  it('has the columns Name, Email, Phone Number, Role and Actions', () => {
    const columns = [...at('/admin/admins').matchAll(/<th scope="col"[^>]*>(?:<span class="sr-only">)?([^<]+)(?:<\/span>)?<\/th>/g)].map((match) => match[1])
    expect(columns).toEqual(['Full Name', 'Email', 'Phone Number', 'Role', 'Actions'])
  })

  it('lists administrators only, the Super Admin first with its own badge', () => {
    const html = table(at('/admin/admins'))
    expect(html).not.toContain('Sara Author')
    expect(html.indexOf('Amal Fahad')).toBeLessThan(html.indexOf('Nouf Saleh'))
    expect(row(at('/admin/admins'), 'Amal Fahad')).toContain('bg-maroon text-offwhite')
    expect(row(at('/admin/admins'), 'Amal Fahad')).toContain('>Super Admin</span>')
    expect(row(at('/admin/admins'), 'Nouf Saleh')).toContain('>Admin</span>')
    expect(html).toContain('>nouf@example.test<')
    expect(html).toContain('>+966512345678<')
  })

  it('gives the Super Admin View, Edit and Delete on regular Admins, and no Delete on themselves', () => {
    const html = at('/admin/admins')
    expect(labels(row(html, 'Nouf Saleh'))).toEqual(expect.arrayContaining(['View Nouf Saleh', 'Edit Nouf Saleh', 'Delete Nouf Saleh']))
    expect(labels(row(html, 'Amal Fahad'))).toEqual(expect.arrayContaining(['View Amal Fahad', 'Edit Amal Fahad']))
    expect(labels(row(html, 'Amal Fahad'))).not.toContain('Delete Amal Fahad')
  })

  it('gives a regular Admin no Delete at all, and no Edit on the Super Admin', () => {
    fixture.viewer = 'nouf'
    const html = at('/admin/admins')
    expect(html).not.toMatch(/aria-label="Delete /)
    expect(labels(row(html, 'Amal Fahad'))).toEqual(['View Amal Fahad'])
    expect(labels(row(html, 'Zaid Omar'))).toEqual(expect.arrayContaining(['View Zaid Omar', 'Edit Zaid Omar']))
    expect(labels(row(html, 'Nouf Saleh'))).toEqual(expect.arrayContaining(['Edit Nouf Saleh']))
  })

  it('shows the same people and actions as cards on narrow screens', () => {
    const html = at('/admin/admins')
    const cards = html.slice(html.indexOf('<ul aria-label="Admins"'))
    expect(cards).toContain('md:hidden')
    for (const name of ['Amal Fahad', 'Nouf Saleh', 'Zaid Omar']) expect(cards).toContain(`>${name}<`)
    expect(cards).toContain('aria-label="Delete Nouf Saleh"')
  })

  it('shows a loading state, then a load error with Try Again', () => {
    fixture.superAdmin = { status: 'loading', superAdminId: null }
    expect(at('/admin/admins')).toContain(adminsEn.list.loading)
    expect(at('/admin/admins')).not.toContain('<table')
    fixture.superAdmin = { status: 'error', superAdminId: null }
    const html = at('/admin/admins')
    expect(html).toContain('role="alert"')
    expect(html).toContain(adminsEn.list.loadFailed.replace(/'/g, '&#x27;'))
    expect(html).toContain('>Try Again<')
  })

  it('shows an empty state without administrators', () => {
    fixture.users = fixture.users.filter((user) => !user.permissions.includes('admin'))
    expect(at('/admin/admins')).toContain(adminsEn.list.empty)
  })

  it('shows no elevated action before the Super Admin is known', () => {
    fixture.superAdmin = { status: 'ready', superAdminId: null }
    expect(at('/admin/admins')).not.toMatch(/aria-label="Delete /)
  })
})

describe("an administrator's page", () => {
  const actions = (html: string) => html.slice(html.indexOf('</h1>'), html.indexOf('admin-details-title'))

  it('shows the Super Admin Edit, Make Super Admin and Delete on a regular Admin', () => {
    const html = actions(at('/admin/admins/nouf'))
    expect(html).toContain('href="/admin/admins/nouf/edit"')
    expect(html).toContain('>Make Super Admin<')
    expect(html).toContain('aria-label="Delete Nouf Saleh"')
  })

  it('shows a regular Admin only Edit on another regular Admin', () => {
    fixture.viewer = 'zaid'
    const html = actions(at('/admin/admins/nouf'))
    expect(html).toContain('href="/admin/admins/nouf/edit"')
    expect(html).not.toContain('Make Super Admin')
    expect(html).not.toContain('aria-label="Delete')
  })

  it("shows a regular Admin the Super Admin's details only, and says why", () => {
    fixture.viewer = 'nouf'
    const html = at(`/admin/admins/${SUPER}`)
    expect(actions(html)).not.toContain('/edit')
    expect(actions(html)).not.toContain('Make Super Admin')
    expect(actions(html)).not.toContain('aria-label="Delete')
    expect(html).toContain(adminsEn.details.superAdminReadOnly)
  })

  it('lets the Super Admin edit their own account, without Delete or Make Super Admin', () => {
    const html = at(`/admin/admins/${SUPER}`)
    expect(actions(html)).toContain(`href="/admin/admins/${SUPER}/edit"`)
    expect(actions(html)).not.toContain('Make Super Admin')
    expect(actions(html)).not.toContain('aria-label="Delete')
    expect(html).toContain(adminsEn.details.ownSuperAdmin)
  })

  it('lists name, email, phone and role, in the same order as Edit Admin', () => {
    const html = at('/admin/admins/nouf')
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(['Full Name', 'Email', 'Phone Number', 'Role'])
    expect(html).not.toContain('>Division<')
  })

  it('is Not Found for staff and unknown accounts', () => {
    expect(at('/admin/admins/sara')).not.toContain('Sara Author')
    expect(at('/admin/admins/nobody')).not.toContain('admin-details-title')
  })
})

describe('Edit Admin', () => {
  it('has Full Name, Email and Phone Number only, filled in, with no role or organization fields', () => {
    const html = at('/admin/admins/nouf/edit')
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual(['name', 'email', 'phone'])
    expect(html).toContain('value="Nouf Saleh"')
    expect(html).toContain('value="nouf@example.test"')
    expect(html).not.toContain('Super Admin</option>')
    expect(html).not.toContain('type="checkbox"')
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins\/nouf"[^>]*>Cancel<\/a>/)
  })

  it("is read-only for a regular Admin on the Super Admin's account", () => {
    fixture.viewer = 'nouf'
    const html = at(`/admin/admins/${SUPER}/edit`)
    expect(html).not.toContain('<form')
    expect(html).toContain(adminsEn.edit.readOnly)
  })

  it('opens for the Super Admin on their own account', () => {
    expect(at(`/admin/admins/${SUPER}/edit`)).toContain('<form')
  })
})

describe('Add Admin', () => {
  it('asks only for Full Name, Email and Phone Number, and offers no role', () => {
    const html = at('/admin/admins/new')
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual(['name', 'email', 'phone'])
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('<select')
    expect(html).toContain(adminsEn.add.roleNote)
    expect(html.match(/>\*</g)).toHaveLength(3)
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins"[^>]*>Cancel<\/a>/)
  })
})

describe('Make Super Admin', () => {
  it('asks with the agreed title, text and buttons', () => {
    const text = adminsEn.transfer
    expect(text.title).toBe('Transfer Super Admin Role?')
    expect(text.intro.replace('{name}', 'Nouf Saleh')).toBe('Are you sure you want to make Nouf Saleh the new Super Admin?')
    expect(text.proceed).toBe('If you proceed:')
    expect(text.consequences.map((line) => line.replace('{name}', 'Nouf Saleh'))).toEqual([
      'Nouf Saleh will become the new Super Admin.',
      'Your role will change to a regular Admin.',
      'You will lose permission to delete administrators and transfer the Super Admin role.',
      'You will retain your regular administrator permissions.',
    ])
    expect(text.effect).toBe('This change will take effect immediately.')
    expect([text.cancel, text.confirm]).toEqual(['Cancel', 'Confirm Transfer'])
  })
})
