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
    expect(html).toContain('>View and manage Hawkim&#x27;s Admins.</p>')
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins\/new"[^>]*>.*Add Admin<\/a>/)
    expect(html).toContain('placeholder="Search by admin name or email"')
    // As wide as every list page's search.
    expect(html).toContain('<div class="mt-8 relative grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">')
  })

  it('has the columns Name, Email, Phone Number, Role, then Preview, Edit and Delete with visible headings', () => {
    const html = at('/admin/admins')
    const columns = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
    expect(columns).toEqual(['Full Name', 'Email', 'Phone Number', 'Permission', 'Preview', 'Edit', 'Delete'])
    expect(html).not.toContain('sr-only">Actions')
    // As on Divisions and Departments: 6rem per action column, each heading centred above its button.
    expect(html).toContain('<colgroup><col/><col/><col/><col/><col class="w-24"/><col class="w-24"/><col class="w-24"/></colgroup>')
    for (const heading of ['Preview', 'Edit', 'Delete']) {
      expect(html).toContain(`<th scope="col" class="px-2 py-3 text-center font-semibold last:rounded-tr-xl">${heading}</th>`)
    }
  })

  it('puts each action in its own column, with an empty cell where there is none (no Delete on the Super Admin)', () => {
    const cells = (name: string) => [...row(at('/admin/admins'), name).matchAll(/<td class="px-2 py-3\.5 text-center \[&amp;&gt;\*\]:mx-auto">(.*?)<\/td>/g)].map((match) => match[1])
    const named = (name: string) => cells(name).map((cell) => cell.match(/aria-label="([^"]+)"/)?.[1] ?? '')
    expect(named('Nouf Saleh')).toEqual(['View Nouf Saleh', 'Edit Nouf Saleh', 'Delete Nouf Saleh'])
    expect(named('Amal Fahad')).toEqual(['View Amal Fahad', 'Edit Amal Fahad', ''])
    expect(cells('Amal Fahad')[2]).toBe('')
    // A regular Admin: no Edit on the Super Admin (its cell kept), and no Delete column at all.
    fixture.viewer = 'nouf'
    expect(named('Amal Fahad')).toEqual(['View Amal Fahad', ''])
  })

  it('shows the Delete column (heading, cells and its 6rem column) to the Super Admin only', () => {
    const headings = (html: string) => [...table(html).matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
    const actionCols = (html: string) => (table(html).match(/<col class="w-24"\/>/g) ?? []).length
    const superAdminView = at('/admin/admins')
    expect(headings(superAdminView)).toEqual(['Full Name', 'Email', 'Phone Number', 'Permission', 'Preview', 'Edit', 'Delete'])
    expect(actionCols(superAdminView)).toBe(3)
    fixture.viewer = 'nouf'
    const regular = at('/admin/admins')
    expect(headings(regular)).toEqual(['Full Name', 'Email', 'Phone Number', 'Permission', 'Preview', 'Edit'])
    expect(actionCols(regular)).toBe(2)
    // Every row has as many cells as there are headings: no empty Delete cells left behind.
    for (const name of ['Amal Fahad', 'Nouf Saleh', 'Zaid Omar']) {
      expect((row(regular, name).match(/<td /g) ?? []).length).toBe(5)
    }
  })

  it('lists administrators only, the Super Admin first with its own badge', () => {
    const html = table(at('/admin/admins'))
    expect(html).not.toContain('Sara Author')
    expect(html.indexOf('Amal Fahad')).toBeLessThan(html.indexOf('Nouf Saleh'))
    expect(row(at('/admin/admins'), 'Amal Fahad')).toContain('bg-maroon text-offwhite')
    expect(row(at('/admin/admins'), 'Amal Fahad')).toContain('>Super Admin</span>')
    expect(row(at('/admin/admins'), 'Nouf Saleh')).toContain('>Admin</span>')
    expect(html).toContain('>nouf@example.test<')
    // Every email has its copy button.
    expect(row(at('/admin/admins'), 'Nouf Saleh')).toContain('aria-label="Copy Nouf Saleh’s email"')
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
    expect(labels(row(html, 'Amal Fahad'))).toEqual(['Copy Amal Fahad’s email', 'View Amal Fahad'])
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

  it('shows the Super Admin Edit and Delete on a regular Admin; Make Super Admin is on Edit Admin', () => {
    const html = actions(at('/admin/admins/nouf'))
    expect(html).toContain('href="/admin/admins/nouf/edit"')
    expect(html).not.toContain('Make Super Admin')
    expect(html).toContain('>Delete Admin</button>')
  })

  it('shows the Permission once, as a gold badge in the Details card (none under the name)', () => {
    const html = at('/admin/admins/nouf')
    const header = html.slice(html.indexOf('<h1'), html.indexOf('admin-details-title'))
    expect(header).not.toContain('>Admin</span>')
    const permission = html.slice(html.indexOf('>Permission</dt>'))
    expect(permission).toMatch(/^>Permission<\/dt><dd[^>]*><span class="[^"]*bg-gold-light px-2 text-maroon[^"]*">Admin<\/span>/)
    const superAdmin = at(`/admin/admins/${SUPER}`)
    expect(superAdmin.slice(superAdmin.indexOf('>Permission</dt>'))).toMatch(/^>Permission<\/dt><dd[^>]*><span class="[^"]*bg-gold-light px-2 text-maroon[^"]*"><svg[^>]*lucide-crown[^>]*>.*?<\/svg>Super Admin<\/span>/)
  })

  it('shows its actions as labelled maroon filled buttons (like Add Admin) at the top right', () => {
    const html = at('/admin/admins/nouf')
    const group = html.match(/<\/h1>.*?<div class="flex flex-wrap items-center gap-2">(.*?)<\/div>/)![1]
    const buttons = group.match(/<(a|button) [^>]*>.*?<\/\1>/g)!
    expect(buttons.map((button) => button.replace(/<[^>]*>/g, ''))).toEqual(['Edit Admin', 'Delete Admin'])
    for (const button of buttons) expect(button).toContain('border border-maroon bg-maroon text-offwhite')
    for (const button of buttons) expect(button).toContain('h-10 px-4 text-sm')
    expect(group).toMatch(/lucide-trash/)
  })

  it('lays out the Details card like a staff member\'s page: 14px bold maroon labels, 16px regular maroon values, dividers', () => {
    const html = at('/admin/admins/nouf')
    expect(html).toContain('<dl class="mt-4 divide-y divide-beige">')
    for (const dt of html.match(/<dt[^>]*>/g)!) expect(dt).toContain('text-sm font-bold text-maroon')
    for (const dd of html.match(/<dd[^>]*>/g)!) expect(dd).toContain('text-base break-words text-maroon')
  })

  it('shows a regular Admin only Edit on another regular Admin', () => {
    fixture.viewer = 'zaid'
    const html = actions(at('/admin/admins/nouf'))
    expect(html).toContain('href="/admin/admins/nouf/edit"')
    expect(html).not.toContain('Make Super Admin')
    expect(html).not.toContain('>Delete Admin<')
  })

  it("shows a regular Admin the Super Admin's details only, and says why", () => {
    fixture.viewer = 'nouf'
    const html = at(`/admin/admins/${SUPER}`)
    expect(actions(html)).not.toContain('/edit')
    expect(actions(html)).not.toContain('Make Super Admin')
    expect(actions(html)).not.toContain('>Delete Admin<')
    expect(html).toContain(adminsEn.details.superAdminReadOnly)
  })

  it('lets the Super Admin edit their own account, without Delete or Make Super Admin', () => {
    const html = at(`/admin/admins/${SUPER}`)
    expect(actions(html)).toContain(`href="/admin/admins/${SUPER}/edit"`)
    expect(actions(html)).not.toContain('Make Super Admin')
    expect(actions(html)).not.toContain('>Delete Admin<')
    expect(html).toContain(adminsEn.details.ownSuperAdmin)
  })

  it('lists name, email, phone and role, in the same order as Edit Admin', () => {
    const html = at('/admin/admins/nouf')
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(['Full Name', 'Email', 'Phone Number', 'Permission'])
    expect(html).not.toContain('>Division<')
  })

  it('heads the card "Details", without "This is you." on your own page', () => {
    fixture.viewer = 'nouf'
    const html = at('/admin/admins/nouf')
    expect(html).toMatch(/<h2 id="admin-details-title"[^>]*>Details<\/h2>/)
    expect(html).not.toContain('Administrator Details')
    expect(html).not.toContain('This is you.')
    expect(html).not.toContain('lucide-info')
  })

  it('has a copy button beside the email, as on Divisions and Departments', () => {
    const html = at('/admin/admins/nouf')
    const email = html.slice(html.indexOf('>Email</dt>'), html.indexOf('>Phone Number</dt>'))
    expect(email).toContain('>nouf@example.test</span>')
    expect(email).toContain('aria-label="Copy Nouf Saleh’s email"')
    expect(email).toContain('lucide-copy')
  })

  it('says "Admin", never "administrator", on the Admins pages', () => {
    for (const path of ['/admin/admins', '/admin/admins/new', '/admin/admins/nouf', '/admin/admins/nouf/edit']) {
      expect(at(path).toLowerCase()).not.toContain('administrator')
    }
    expect(JSON.stringify(adminsEn).toLowerCase()).not.toContain('administrator')
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
    // Cancel and Back both return to the Admins list, never to the Admin's page.
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins"[^>]*>Cancel<\/a>/)
    expect(html).not.toMatch(/href="\/admin\/admins\/nouf"/)
  })

  it('goes Back to the Admins list', () => {
    const html = at('/admin/admins/nouf/edit')
    expect(html).toMatch(/^.*?<a[^>]*href="\/admin\/admins"[^>]*><svg[^>]*lucide-arrow-left/s)
    expect(html).toContain('Back to Admins')
    fixture.viewer = 'nouf'
    // The read-only explanation's button goes to the list too.
    const readOnly = at(`/admin/admins/${SUPER}/edit`)
    expect(readOnly).not.toMatch(new RegExp(`href="/admin/admins/${SUPER}"`))
  })

  it('offers Make Super Admin (gold crown, maroon filled) to the Super Admin on a regular Admin only', () => {
    const html = at('/admin/admins/nouf/edit')
    const button = html.match(/<button[^>]*>(?:(?!<\/button>).)*Make Super Admin<\/button>/s)![0]
    expect(button).toContain('border border-maroon bg-maroon text-offwhite')
    expect(button).toMatch(/lucide-crown[^"]*text-gold"/)
    // Before the form, beside the name.
    expect(html.indexOf('Make Super Admin')).toBeLessThan(html.indexOf('<form'))
    // Not on their own account (they are the Super Admin already).
    expect(at(`/admin/admins/${SUPER}/edit`)).not.toContain('Make Super Admin')
    // Never for a regular Admin, on anyone.
    fixture.viewer = 'nouf'
    expect(at('/admin/admins/zaid/edit')).not.toContain('Make Super Admin')
    expect(at('/admin/admins/nouf/edit')).not.toContain('Make Super Admin')
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
    // One text under the title, no separate note, and no "administrator".
    expect(html).toContain('<p class="mt-2 max-w-2xl text-text-gray">Add someone who should manage your organization in Hawkim. The Super Admin permission can only be transferred by the current Super Admin.</p>')
    expect(html).not.toContain('set their password')
    expect(html).not.toContain('lucide-info')
    expect(html.toLowerCase()).not.toContain('administrator')
    expect(html.match(/>\*</g)).toHaveLength(3)
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins"[^>]*>Cancel<\/a>/)
  })
})

describe('Make Super Admin', () => {
  it('asks with the agreed title, text and buttons', () => {
    const text = adminsEn.transfer
    expect(text.title).toBe('Transfer Super Admin Permission?')
    expect(text.intro.replace('{name}', 'Nouf Saleh')).toBe('Are you sure you want to make Nouf Saleh the new Super Admin?')
    expect(text.proceed).toBe('If you proceed:')
    expect(text.consequences.map((line) => line.replace('{name}', 'Nouf Saleh'))).toEqual([
      'Nouf Saleh will become the new Super Admin.',
      'Your permission will change to a regular Admin.',
      'You will lose permission to delete Admins and transfer the Super Admin permission.',
      'You will retain your regular Admin permissions.',
    ])
    expect(text.effect).toBe('This change will take effect immediately.')
    expect([text.cancel, text.confirm]).toEqual(['Cancel', 'Confirm Transfer'])
  })
})
