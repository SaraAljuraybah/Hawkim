import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { User } from '../data/mock/types'
import { SessionProvider } from './SessionProvider'
import { useSession, type SessionStore } from './sessionContext'

const service = vi.hoisted(() => ({
  restoreSession: vi.fn(() => new Promise(() => {})),
  onSignedOut: vi.fn(() => () => {}),
  signOut: vi.fn(async () => {}),
}))
vi.mock('../services/auth', () => service)
afterEach(() => vi.unstubAllGlobals())

const sara: User = { id: 'uuid-sara', name: 'Sara Aljuraybah', email: 'sara.aljuraybah@hawkim.test', initials: 'SA', departmentId: 'information-technology', permissions: ['author'] }

function capture(): SessionStore {
  const observe = vi.fn<(store: SessionStore) => void>()
  function Capture() { observe(useSession()); return null }
  renderToStaticMarkup(<SessionProvider><Capture /></SessionProvider>)
  return observe.mock.calls.at(-1)![0]
}

describe('sign-in', () => {
  it('starts signed out without restoring an experimental backend session', () => {
    expect(capture()).toMatchObject({ status: 'signed-out', user: null })
  })

  it('forgets the department remembered from a previous session', () => {
    const local = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', local)
    capture().signIn(sara)
    expect(local.removeItem).toHaveBeenCalledWith('hawkim.activeDepartment')
  })

  it('signs out locally without contacting experimental authentication', async () => {
    const local = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', local)
    capture().signOut()
    await Promise.resolve()
    expect(service.signOut).not.toHaveBeenCalled()
    expect(service.restoreSession).not.toHaveBeenCalled()
    expect(service.onSignedOut).not.toHaveBeenCalled()
    expect(local.removeItem).toHaveBeenCalledWith('hawkim.activeDepartment')
  })
})
