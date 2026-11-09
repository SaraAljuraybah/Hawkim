import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { Department, User } from '../../data/mock/types'
import { UserDetailsPage } from './UserDetailsPage'

const fixture = vi.hoisted(() => ({ user: null as User | null, department: null as Department | null }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: [fixture.user], deleteUser: vi.fn() }) }))
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
  it('lists Name, Email, Phone Number, Division, Department, Position and Permission, like My Profile', () => {
    const html = render()
    const labels = [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels).toEqual(['Name', 'Email', 'Phone Number', 'Division', 'Department', 'Position', 'Permission'])
    for (const dt of html.match(/<dt[^>]*>/g)!) expect(dt).toContain('font-bold text-maroon')
    expect(detail(html, 'Name')).toBe('Rana')
    expect(detail(html, 'Department')).toBe('Home')
    expect(detail(html, 'Permission')).toBe('Author, Reviewer')
    expect(html).not.toContain('Directory Access')
  })

  it('shows — for every empty value, read-only', () => {
    fixture.user = { ...fixture.user!, permissions: [] }
    const html = render()
    for (const label of ['Phone Number', 'Division', 'Position', 'Permission']) expect(detail(html, label)).toBe('—')
    for (const name of ['phone', 'position', 'division']) expect(html).not.toContain(`name="${name}"`)
    fixture.user = { ...fixture.user!, phone: '+966512345678', position: 'Regulatory Specialist' }
    expect(detail(render(), 'Phone Number')).toBe('+966512345678')
    expect(detail(render(), 'Position')).toBe('Regulatory Specialist')
  })

  it('shows the division of the user\'s department', () => {
    fixture.department = { ...fixture.department!, divisionId: 'Medical Division' }
    expect(detail(render(), 'Division')).toBe('Medical Division')
  })

  it('has the shared header: large avatar, the name as the h1 with Delete beside it, and the badges', () => {
    const html = render()
    expect(html).toContain('<span aria-hidden="true" class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-beige text-xs font-semibold text-maroon size-14 text-base">RA</span>')
    expect(html).toMatch(/<div class="flex items-start gap-2"><h1 class="min-w-0 text-2xl break-words tracking-tight sm:text-3xl">Rana<\/h1><div><span class="relative inline-flex"><button type="button" aria-label="Delete Rana"/)
    expect(html.match(/<h1/g)).toHaveLength(1)
  })

  it('has one Delete user: the Trash button in the header, and no Delete User section', () => {
    const html = render()
    const header = html.slice(html.indexOf('<h1'), html.indexOf('details-title'))
    expect(header).toMatch(/<button type="button" aria-label="Delete Rana"[^>]*text-status-rejected-fg/)
    expect(html.match(/aria-label="Delete Rana"/g)).toHaveLength(1)
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
  it('reads Permission on the Edit User message and the Users list', () => {
    expect(adminEn.editUser.refused).toBe("Permission wasn't saved:")
    expect(adminEn.usersList.columns.permissions).toBe('Permission')
  })
})

describe('after Add User', () => {
  const opened = (state: unknown) => renderToStaticMarkup(<MemoryRouter initialEntries={[{ pathname: '/admin/users/rana', state }]}><Routes><Route path="/admin/users/:id" element={<UserDetailsPage />} /></Routes></MemoryRouter>)

  it('says the invitation went out, in green', () => {
    const html = opened({ added: true, invitationFailed: false })
    expect(html).toContain('User added. We&#x27;ve emailed them an invitation to set their password.')
    expect(html).toContain('bg-status-approved-bg')
    expect(html).not.toContain('bg-status-pending-bg')
  })

  it('says when the invitation could not be sent, in amber, pointing to Forgot Password', () => {
    const html = opened({ added: true, invitationFailed: true })
    expect(html).toContain('User added, but the invitation email couldn&#x27;t be sent. Ask them to use Forgot Password on the sign-in page.')
    expect(html).toContain('bg-status-pending-bg')
    expect(html).not.toContain('bg-status-approved-bg')
  })

  it('says nothing when just viewing the page', () => {
    const html = opened(null)
    expect(html).not.toContain('User added')
    expect(html).toContain('<div role="status"></div>')
  })
})
