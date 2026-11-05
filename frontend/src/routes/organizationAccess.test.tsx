import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import { appShellEn } from '../content/app.en'
import { adminEn } from '../content/admin.en'
import type { User } from '../data/mock/types'
import { isPathAllowed, visibleNavItems } from '../lib/departmentNavigation'
import { ORGANIZATIONAL_STRUCTURE_PATH } from '../lib/routes'
import { ActiveDepartmentProvider } from '../state/ActiveDepartmentProvider'
import { AdminArea, EmployeeArea } from './guards'

const session = vi.hoisted(() => ({ user: null as User | null }))
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ status: 'signed-in', user: session.user }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ status: 'ready' }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ status: 'ready' }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ status: 'ready' }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ status: 'ready' }) }))
beforeEach(() => { session.user = { id: 'u', name: 'User', email: 'u@test.invalid', initials: 'U', departmentId: 'd', permissions: [] } })

describe('the Admin guard enclosing Organizational Structure', () => {
  it('sends signed-out visitors to login', () => {
    session.user = null
    const result = AdminArea()
    expect(result.type).toBe(Navigate)
    expect(result.props.to).toBe('/login')
  })
  it.each(['author', 'reviewer', 'approver'] as const)('keeps %s users in the employee shell with Not Found', (permission) => {
    session.user!.permissions = [permission]
    const result = AdminArea()
    expect(result.type).toBe(ActiveDepartmentProvider)
    expect(result.props.children.props.children.props.embedded).toBe(true)
  })
  it('allows Admins into the lazy Admin portal', () => {
    session.user!.permissions = ['admin']
    expect(AdminArea().type).toBe(Suspense)
  })
})

describe('Organizational Structure for every signed-in user', () => {
  it.each([[[]], [['author']], [['reviewer']], [['approver']], [['author', 'reviewer']]] as const)('opens in the employee shell for %j users', (permissions) => {
    session.user!.permissions = [...permissions]
    const result = EmployeeArea()
    expect(result.type).toBe(ActiveDepartmentProvider)
    const item = visibleNavItems(appShellEn.nav, session.user!, false).find((entry) => entry.href === ORGANIZATIONAL_STRUCTURE_PATH)
    expect(item?.label).toBe('Organizational Structure')
  })
  it('stays available in a department the user only has read-only access to', () => {
    expect(isPathAllowed(ORGANIZATIONAL_STRUCTURE_PATH, true)).toBe(true)
    expect(visibleNavItems(appShellEn.nav, session.user!, true).map((entry) => entry.href)).toContain(ORGANIZATIONAL_STRUCTURE_PATH)
  })
  it('keeps the page in the admin portal for Admins, who never see the employee shell', () => {
    session.user!.permissions = ['admin']
    const result = EmployeeArea()
    expect(result.type).toBe(Navigate)
    expect(adminEn.shell.nav.map((entry) => entry.href)).toContain('/admin/organizational-structure')
  })
})
