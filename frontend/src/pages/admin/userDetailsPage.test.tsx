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

beforeEach(() => { fixture.user = { id: 'rana', name: 'Rana', email: 'rana@example.test', initials: 'RA', departmentId: 'home', permissions: ['author'] } })

describe('a user\'s details page', () => {
  it('shows the division read-only, and — without one', () => {
    expect(division(render())).toBe('—')
    fixture.user = { ...fixture.user!, divisionId: 'Medical Division' }
    expect(division(render())).toBe('Medical Division')
    expect(render()).not.toContain('name="division"')
  })

  it('calls the permissions section Role', () => {
    const html = render()
    expect(html).toContain('>Role<')
    expect(html).toContain('Role of Rana')
    expect(html).toContain('>Save Role<')
    expect(html).not.toContain('Permissions')
  })
})

describe('the Role wording', () => {
  it('reads Role on the details page messages and the Users list', () => {
    expect(adminEn.userDetails.permissions).toMatchObject({ saved: 'Role updated.', refused: "Role wasn't saved:" })
    expect(adminEn.usersList.permissionFilter).toEqual({ label: 'Role', all: 'All Roles' })
    expect(adminEn.usersList.columns.permissions).toBe('Role')
  })
})
