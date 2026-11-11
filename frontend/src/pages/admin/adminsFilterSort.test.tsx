import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import type { LoadStatus } from '../../state/useLoadAfterSignIn'
import { listAdmins } from '../../lib/adminAccess'
import { AdminAdminsPage } from './AdminAdminsPage'

const SUPER = 'amal'
const fixture = vi.hoisted(() => ({ users: [] as User[], status: 'ready' as LoadStatus }))
vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ status: fixture.status, activeUsers: fixture.users }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0] }))
vi.mock('../../hooks/useSuperAdmin', () => ({ useSuperAdmin: () => ({ status: 'ready', superAdminId: 'amal', reload: vi.fn(), set: vi.fn() }) }))
const admin = (id: string, name: string): User =>
  ({ id, name, email: `${id}@example.test`, phone: '+966512345678', initials: name.slice(0, 2).toUpperCase(), departmentId: '', permissions: ['admin'] })
beforeEach(() => {
  fixture.users = [admin(SUPER, 'Zainab Super'), admin('nouf', 'Nouf Saleh'), admin('abeer', 'Abeer Omar')]
})
const names = (users: User[]) => users.map((user) => user.name)
const page = (search = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/admins${search}`]}><AdminAdminsPage /></MemoryRouter>)

describe('the Admins Filter (Role) and Sort', () => {
  it('keeps the Super Admin first by default, then sorts by name', () => {
    expect(names(listAdmins(fixture.users, SUPER, ''))).toEqual(['Zainab Super', 'Abeer Omar', 'Nouf Saleh'])
    expect(names(listAdmins(fixture.users, SUPER, '', { sort: 'name-asc' }))).toEqual(['Abeer Omar', 'Nouf Saleh', 'Zainab Super'])
    expect(names(listAdmins(fixture.users, SUPER, '', { sort: 'name-desc' }))).toEqual(['Zainab Super', 'Nouf Saleh', 'Abeer Omar'])
  })

  it('filters by role, together with the search', () => {
    expect(names(listAdmins(fixture.users, SUPER, '', { roles: ['superAdmin'] }))).toEqual(['Zainab Super'])
    expect(names(listAdmins(fixture.users, SUPER, '', { roles: ['admin'] }))).toEqual(['Abeer Omar', 'Nouf Saleh'])
    expect(names(listAdmins(fixture.users, SUPER, 'nouf', { roles: ['admin'] }))).toEqual(['Nouf Saleh'])
    expect(names(listAdmins(fixture.users, SUPER, '', { roles: ['superAdmin', 'admin'] }))).toHaveLength(3)
  })

  it('shows Search, Filter and Sort like the Staff page, with no Clear Filters until something is chosen', () => {
    const html = page()
    expect(html).toContain(adminsEn.list.search.label)
    expect(html).toContain('>Filter<')
    expect(html).toMatch(/<select[^>]*name="adminSort"/)
    for (const label of Object.values(adminsEn.list.sort.options)) expect(html).toContain(`>${label}</option>`)
    expect(html).not.toContain(adminsEn.list.clearFilters)
  })

  it('reads the Role and Sort from the URL and offers Clear Filters', () => {
    const html = page('?role=admin&sort=name-desc')
    expect(html).toContain(adminsEn.list.clearFilters)
    expect(html).toContain('2 Admins')
  })
})
