import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import type { User } from '../data/mock/types'
import { ActiveDepartmentProvider } from '../state/ActiveDepartmentProvider'
import { AdminArea } from './guards'

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
