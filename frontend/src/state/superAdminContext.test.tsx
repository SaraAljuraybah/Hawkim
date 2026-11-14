import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { User } from '../data/mock/types'
import { useSuperAdmin, type SuperAdminState } from '../hooks/useSuperAdmin'
import { SuperAdminContext, useAdminRoleLabel } from './superAdminContext'

vi.mock('../services/admins', () => ({ fetchSuperAdminId: vi.fn(() => new Promise(() => {})) }))

/* Who the Super Admin is: one shared state for the admin portal, so a transfer relabels everything at once. */

/** Renders `read` (a hook call) once on the server and returns what it gave. */
function Probe<T>({ read, onRead }: { read: () => T; onRead: (value: T) => void }) {
  onRead(read())
  return null
}

const shared = (superAdminId: string | null, status: SuperAdminState['status'] = 'ready'): SuperAdminState =>
  ({ status, superAdminId, reload: vi.fn(), set: vi.fn() })

describe('useSuperAdmin', () => {
  it('uses the portal\'s shared state, so Make Super Admin (set) updates the sidebar, top bar and My Profile', () => {
    const value = shared('a')
    const seen: { state?: SuperAdminState } = {}
    renderToStaticMarkup(<SuperAdminContext.Provider value={value}><Probe read={useSuperAdmin} onRead={(state) => { seen.state = state }} /></SuperAdminContext.Provider>)
    expect(seen.state).toBe(value)
  })

  it('loads on its own outside the portal (loading at first, nothing elevated)', () => {
    const seen: { state?: SuperAdminState } = {}
    renderToStaticMarkup(<Probe read={useSuperAdmin} onRead={(state) => { seen.state = state }} />)
    expect(seen.state?.status).toBe('loading')
    expect(seen.state?.superAdminId).toBeNull()
  })
})

describe('useAdminRoleLabel', () => {
  const admin = { id: 'a', permissions: ['admin'] } as Pick<User, 'id' | 'permissions'>
  const label = (user: Pick<User, 'id' | 'permissions'>, value: SuperAdminState | null) => {
    const seen: { label?: string | null } = {}
    const useLabel = () => useAdminRoleLabel(user)
    renderToStaticMarkup(<SuperAdminContext.Provider value={value}><Probe read={useLabel} onRead={(found) => { seen.label = found }} /></SuperAdminContext.Provider>)
    return seen.label
  }

  it('is Super Admin for the current Super Admin and Admin for every other administrator', () => {
    expect(label(admin, shared('a'))).toBe('Super Admin')
    expect(label(admin, shared('b'))).toBe('Admin')
    expect(label(admin, shared(null))).toBe('Admin')
  })

  it('follows a transfer: the former Super Admin becomes Admin, the recipient Super Admin', () => {
    const recipient = { id: 'b', permissions: ['admin'] } as Pick<User, 'id' | 'permissions'>
    expect([label(admin, shared('a')), label(recipient, shared('a'))]).toEqual(['Super Admin', 'Admin'])
    expect([label(admin, shared('b')), label(recipient, shared('b'))]).toEqual(['Admin', 'Super Admin'])
  })

  it('is unknown (null) while loading or after a failed load, and not an administrator role for staff or outside the portal', () => {
    expect(label(admin, shared(null, 'loading'))).toBeNull()
    expect(label(admin, shared('a', 'error'))).toBeNull()
    expect(label({ id: 'a', permissions: ['author'] }, shared('a'))).toBeUndefined()
    expect(label(admin, null)).toBeUndefined()
  })
})
