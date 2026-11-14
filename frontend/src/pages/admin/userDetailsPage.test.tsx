import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { Department, User } from '../../data/mock/types'
import { UserDetailsPage } from './UserDetailsPage'

const fixture = vi.hoisted(() => ({ user: null as User | null, department: null as Department | null }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [fixture.user], activeUsers: [fixture.user], deleteUser: vi.fn(), reactivateUser: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ getDepartment: (id: string) => (fixture.department?.id === id ? fixture.department : undefined) }) }))

const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/users/rana']}><Routes><Route path="/admin/users/:id" element={<UserDetailsPage />} /></Routes></MemoryRouter>)
const detail = (html: string, label: string) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([^<]*)<`))![1]

beforeEach(() => {
  fixture.user = { id: 'rana', name: 'Rana', email: 'rana@example.test', initials: 'RA', departmentId: 'home', permissions: ['author', 'reviewer'] }
  fixture.department = { id: 'home', name: 'Home', initials: 'HM', description: '' }
})

describe('a user\'s details page', () => {
  it('lists Full Name, Email, Phone Number, Division, Department, Position and Permission, like My Profile', () => {
    const html = render()
    const labels = [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels).toEqual(['Full Name', 'Email', 'Phone Number', 'Division', 'Department', 'Position', 'Permission'])
    // As on an Admin's page: labels 14px bold maroon, values 16px regular maroon.
    for (const dt of html.match(/<dt[^>]*>/g)!) expect(dt).toContain('text-sm font-bold text-maroon')
    for (const dd of html.match(/<dd[^>]*>/g)!) {
      expect(dd).toContain('text-base')
      expect(dd).toContain('text-maroon')
      expect(dd).not.toMatch(/font-(semibold|bold)|text-text-gray/)
    }
    expect(detail(html, 'Full Name')).toBe('Rana')
    expect(detail(html, 'Department')).toBe('Home')
    expect(html).not.toContain('Directory Access')
  })

  it('shows the permissions once, as solid light-gold badges in Details, with no description', () => {
    const html = render()
    expect(html).not.toContain('contact details, placement and permissions')
    expect(html).not.toContain('<p class="mt-2 text-text-gray">')
    const badges = [...html.matchAll(/<li class="([^"]*)">([^<]+)<\/li>/g)]
    // Only as the Permission value: no duplicate badges under the name.
    expect(badges.map((match) => match[2])).toEqual(['Author', 'Reviewer'])
    for (const [, className] of badges) {
      expect(className.split(' ')).toContain('bg-gold-light')
      expect(className).toContain('text-maroon')
    }
    const permission = html.slice(html.indexOf('>Permission</dt>'))
    expect(permission).toMatch(/^>Permission<\/dt><dd[^>]*><ul class="flex flex-wrap gap-1\.5 "><li[^>]*>Author<\/li><li[^>]*>Reviewer<\/li><\/ul>/)
  })

  it('copies the email from a copy icon right after the address', () => {
    const html = render()
    const email = html.slice(html.indexOf('>Email</dt>'), html.indexOf('>Phone Number</dt>'))
    expect(email).toContain('<span class="min-w-0 break-all">rana@example.test</span>')
    expect(email).toContain(`aria-label="${adminEn.userDetails.copyEmail.replace('{name}', 'Rana')}"`)
    expect(email).toContain('aria-live="polite"')
  })

  it('shows only the Details card, with no "Involved in" section', () => {
    const html = render()
    expect(html).toContain('id="details-title"')
    expect(html.match(/<h2[^>]*>/g)).toHaveLength(1)
    for (const removed of ['Involved in', 'Not involved in any SOP.', 'involvement-title', 'SOPs this staff member is involved in']) expect(html).not.toContain(removed)
  })

  it('shows — for every empty value, read-only', () => {
    fixture.user = { ...fixture.user!, permissions: [] }
    const html = render()
    for (const label of ['Phone Number', 'Division', 'Position', 'Permission']) expect(detail(html, label)).toBe('—')
    expect(html).not.toContain('<li')
    for (const name of ['phone', 'position', 'division']) expect(html).not.toContain(`name="${name}"`)
    fixture.user = { ...fixture.user!, phone: '+966512345678', position: 'Regulatory Specialist' }
    expect(detail(render(), 'Phone Number')).toBe('+966512345678')
    expect(detail(render(), 'Position')).toBe('Regulatory Specialist')
  })

  it('shows the division of the user\'s department', () => {
    fixture.department = { ...fixture.department!, divisionId: 'Medical Division' }
    expect(detail(render(), 'Division')).toBe('Medical Division')
  })

  it("has the Admin page's header: avatar, the name as the h1 (no badges under it), and Edit Staff and Delete Staff at the top right", () => {
    const html = render()
    expect(html).toContain('<span aria-hidden="true" class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-beige text-xs font-semibold text-maroon size-10 text-sm sm:size-14 sm:text-base">RA</span>')
    // The name block, then the actions (Edit Staff before Delete Staff) in their own group after it.
    expect(html).toMatch(/<h1 class="text-xl break-words tracking-tight sm:text-3xl">Rana<\/h1><\/div><\/div><div class="flex flex-wrap items-center gap-2"><a [^>]*href="\/admin\/users\/[^"]+\/edit"[^>]*>.*?Edit Staff<\/a><button type="button"[^>]*>.*?Delete Staff<\/button>/)
    expect(html.match(/<h1/g)).toHaveLength(1)
  })

  it('has one Delete Staff: a labelled maroon filled button with the Trash icon, and no Delete User section', () => {
    const html = render()
    const header = html.slice(html.indexOf('<h1'), html.indexOf('details-title'))
    const button = header.match(/<button type="button"[^>]*>.*?<\/button>/)![0]
    expect(button).toMatch(/lucide-trash/)
    expect(button).toContain('>Delete Staff</button>')
    expect(button).toContain('border border-maroon bg-maroon text-offwhite')
    expect(html.match(/>Delete Staff</g)).toHaveLength(1)
    expect(html).not.toContain('>Delete User<')
    expect(html).not.toContain('delete-title')
  })

  it('is read-only: permissions are shown in Details, with no checkboxes or Save', () => {
    const html = render()
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('Save Permission')
    expect(html).not.toContain('permissions-title')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('>Role<')
    expect(html).not.toContain('Permissions')
  })
})

describe('the Permission wording', () => {
  it('reads Permission on the Edit Staff message and the Staff list', () => {
    expect(adminEn.editUser.refused).toBe("Permission wasn't saved:")
    expect(adminEn.usersList.columns.permissions).toBe('Permission')
  })
})

describe('after Add User', () => {
  const opened = (state: unknown) => renderToStaticMarkup(<MemoryRouter initialEntries={[{ pathname: '/admin/users/rana', state }]}><Routes><Route path="/admin/users/:id" element={<UserDetailsPage />} /></Routes></MemoryRouter>)

  it('says the invitation went out, in green', () => {
    const html = opened({ added: true, invitationFailed: false })
    expect(html).toContain('Staff member added. We&#x27;ve emailed them an invitation to set their password.')
    expect(html).toContain('bg-status-approved-bg')
    expect(html).not.toContain('bg-status-pending-bg')
  })

  it('says when the invitation could not be sent, in amber, pointing to Forgot Password', () => {
    const html = opened({ added: true, invitationFailed: true })
    expect(html).toContain('Staff member added, but the invitation email couldn&#x27;t be sent. Ask them to use Forgot Password on the sign-in page.')
    expect(html).toContain('bg-status-pending-bg')
    expect(html).not.toContain('bg-status-approved-bg')
  })

  it('says nothing when just viewing the page', () => {
    const html = opened(null)
    expect(html).not.toContain('Staff member added')
    expect(html).toContain('<div role="status"></div>')
  })
})

describe("a deactivated staff member's page (Preview on the Deactive Staff tab)", () => {
  it('opens, with Edit Staff and Reactivate Staff in place of Delete, and Back to the Deactive Staff tab', () => {
    fixture.user = { ...fixture.user!, deletedAt: '2026-11-01T09:00:00Z' }
    const html = render()
    expect(html).toContain('>Rana</h1>')
    expect(html).toContain('>Edit Staff</a>')
    expect(html).toMatch(/<button type="button"[^>]*>(?:(?!<\/button>).)*lucide-rotate-ccw(?:(?!<\/button>).)*Reactivate Staff<\/button>/)
    expect(html).not.toContain('>Delete Staff<')
    expect(html).toMatch(/<a[^>]*href="\/admin\/users\?status=deactivated"[^>]*>(?:(?!<\/a>).)*Back to Staff<\/a>/)
  })

  it('still shows Not Found for a deactivated Admin (Admins are on the Admins page)', () => {
    fixture.user = { ...fixture.user!, permissions: ['admin'], deletedAt: '2026-11-01T09:00:00Z' }
    expect(render()).not.toContain('>Rana</h1>')
  })
})
