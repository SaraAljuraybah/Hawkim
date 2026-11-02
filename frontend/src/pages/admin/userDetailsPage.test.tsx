import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import type { User } from '../../data/mock/types'
import { UserDetailsPage } from './UserDetailsPage'

const fixture = vi.hoisted(() => ({ user: null as User | null }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ activeUsers: [fixture.user], updatePermissions: vi.fn(), deleteUser: vi.fn() }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [] }) }))
vi.mock('../../state/requestsContext', () => ({ useRequests: () => ({ requests: [] }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ activeDepartments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }], nameOf: () => 'Home' }) }))

const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/users/rana']}><Routes><Route path="/admin/users/:id" element={<UserDetailsPage />} /></Routes></MemoryRouter>)
const division = (html: string) => html.match(/<dt[^>]*>Division<\/dt><dd[^>]*>([^<]*)</)![1]
const detail = (html: string, label: string) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([^<]*)<`))![1]

beforeEach(() => { fixture.user = { id: 'rana', name: 'Rana', email: 'rana@example.test', initials: 'RA', departmentId: 'home', permissions: ['author'] } })

describe('a user\'s details page', () => {
  it('shows the division read-only, and — without one', () => {
    expect(division(render())).toBe('—')
    fixture.user = { ...fixture.user!, divisionId: 'Medical Division' }
    expect(division(render())).toBe('Medical Division')
    expect(render()).not.toContain('name="division"')
  })

  it('shows the phone number and position read-only, and — without them', () => {
    expect(detail(render(), 'Phone Number')).toBe('—')
    expect(detail(render(), 'Position')).toBe('—')
    fixture.user = { ...fixture.user!, phone: '+966512345678', position: 'Regulatory Specialist' }
    const html = render()
    expect(detail(html, 'Phone Number')).toBe('+966512345678')
    expect(detail(html, 'Position')).toBe('Regulatory Specialist')
    expect(html).not.toContain('name="phone"')
    expect(html).not.toContain('name="position"')
  })

  it('lists Email, Phone Number, Position, Division, then Home Department', () => {
    const labels = [...render().matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels.slice(0, 5)).toEqual(['Email', 'Phone Number', 'Position', 'Division', 'Home Department'])
  })

  it('calls the permissions section Permission', () => {
    const html = render()
    expect(html).toContain('>Permission<')
    expect(html).toContain('Permission of Rana')
    expect(html).toContain('>Save Permission<')
    expect(html).not.toContain('>Role<')
    expect(html).not.toContain('Permissions')
  })
})

describe('the Permission wording', () => {
  it('reads Permission on the details page messages and the Users list', () => {
    expect(adminEn.userDetails.permissions).toMatchObject({ saved: 'Permission updated.', refused: "Permission wasn't saved:" })
    expect(adminEn.usersList.permissionFilter).toEqual({ label: 'Permission', all: 'All Permissions' })
    expect(adminEn.usersList.columns.permissions).toBe('Permission')
  })
})
