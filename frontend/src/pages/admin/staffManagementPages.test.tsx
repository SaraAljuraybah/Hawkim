import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom'
import { UserForm } from '../../components/admin/UserForm'
import { UnsavedChangesGuard } from '../../components/ui/UnsavedChangesGuard'
import { adminEn } from '../../content/admin.en'
import type { Department, User } from '../../data/mock/types'
import type { NewUser } from '../../lib/userAdmin'
import { UserDetailsPage } from './UserDetailsPage'

/* Staff Management (Tasks 9–16) on the pages: System Admin fields, Edit Staff, wording and the guard. */

const home: Department = { id: 'home', name: 'Home', initials: 'HM', description: '' }
const fixture = vi.hoisted(() => ({ user: null as User | null }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: [fixture.user], deleteUser: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({
  useDepartments: () => ({ activeDepartments: [home], getDepartment: (id: string) => (id === 'home' ? home : undefined) }),
}))

beforeEach(() => {
  fixture.user = { id: 'rana', name: 'Rana', email: 'rana@example.test', initials: 'RA', departmentId: 'home', phone: '+966512345678', position: 'QA Specialist', permissions: ['author'] }
})

const details = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/users/rana']}><Routes><Route path="/admin/users/:id" element={<UserDetailsPage />} /></Routes></MemoryRouter>)
const labels = (html: string) => [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])

describe('Staff Details', () => {
  it('opens Edit Staff from the header, in the secondary button style', () => {
    const link = details().match(/<a[^>]*href="\/admin\/users\/rana\/edit"[^>]*>.*?<\/a>/)![0]
    expect(link).toContain('Edit Staff')
    expect(link).toContain('border-maroon/40')
  })

  it('lists the organizational fields for staff', () => {
    expect(labels(details())).toEqual(['Name', 'Email', 'Phone Number', 'Division', 'Department', 'Position', 'Permission'])
  })

  it("sends an administrator's Staff page to their page under Manage Organization → Admins", () => {
    fixture.user = { ...fixture.user!, departmentId: '', position: undefined, permissions: ['admin'] }
    const html = details()
    expect(labels(html)).toEqual([])
    expect(html).not.toContain('Edit Staff')
  })

  it('says Staff, not Users', () => {
    const html = details()
    expect(html).toContain('Back to Staff')
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\busers?\b/i)
  })
})

const staff: NewUser = { name: 'Rana', email: 'rana@example.test', phone: '+966512345678', position: 'QA Specialist', departmentId: 'home', permissions: ['author'] }
const form = (initial: NewUser) => renderToStaticMarkup(
  <MemoryRouter><UserForm initial={initial} otherUsers={[]} submitLabel="Save Changes" onSubmit={() => {}} unsavedChanges={adminEn.editUser.discard} /></MemoryRouter>,
)

describe('the staff form', () => {
  it('asks for every field, marked required, for staff', () => {
    const html = form(staff)
    for (const name of ['name', 'email', 'phone', 'division', 'department', 'position']) {
      expect(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]).toContain('required=""')
    }
  })

  it('takes the phone number as +9665XXXXXXXX: the 8 digits after a fixed "+9665"', () => {
    const html = form(staff)
    const phone = html.match(/<input[^>]*name="phone"[^>]*>/)![0]
    expect(phone).toContain('inputMode="numeric"')
    expect(html).toMatch(/<span id="[^"]+">\+9665<\/span>/)
    expect(html).toContain('Saudi mobile number: +9665XXXXXXXX')
  })

  it('hides division, department and position for a System Admin, keeping name, email and phone required', () => {
    const html = form({ ...staff, departmentId: '', position: '', permissions: ['admin'] })
    for (const name of ['division', 'department', 'position']) expect(html).not.toContain(`name="${name}"`)
    for (const name of ['name', 'email', 'phone']) expect(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]).toContain('required=""')
  })

  it('renders without the data router (no navigation guard there) and shows no dialog while nothing changed', () => {
    expect(form(staff)).not.toContain('Discard unsaved changes?')
  })
})

describe('the unsaved changes guard', () => {
  it('keeps its question closed until someone tries to leave, in the app\'s data router', () => {
    const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesGuard when text={adminEn.editUser.discard} /> }])
    const html = renderToStaticMarkup(<RouterProvider router={router} />)
    // The dialog is in the page, closed; it opens when navigation is blocked.
    expect(html).toContain('role="alertdialog"')
    expect(html).not.toContain('Discard unsaved changes?')
  })

  it('uses the required wording', () => {
    expect(adminEn.editUser.discard).toEqual({
      title: 'Discard unsaved changes?',
      description: 'You have unsaved changes. Are you sure you want to leave without saving?',
      keep: 'Keep Editing',
      discard: 'Discard Changes',
    })
  })
})

describe('the department transfer message', () => {
  it('uses the required title and explanation, with the count of blocking SOPs', () => {
    expect(adminEn.editUser.transfer.title).toBe('Department Transfer Not Allowed')
    expect(adminEn.editUser.transfer.message).toBe('This staff member has incomplete SOP responsibilities. All assigned SOP work must be completed before transferring them to another department.')
    expect(adminEn.editUser.transfer.count.other.replace('{count}', '3')).toBe('Blocking: 3 SOPs in progress.')
  })
})
