import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionProvider } from './SessionProvider'
import { useSession, type SessionStore } from './sessionContext'

vi.mock('./usersContext', () => ({ useUsers: () => ({ activeUsers: [] }) }))
afterEach(() => vi.unstubAllGlobals())

function capture(): SessionStore {
  const observe = vi.fn<(store: SessionStore) => void>()
  function Capture() { observe(useSession()); return null }
  renderToStaticMarkup(<SessionProvider><Capture /></SessionProvider>)
  return observe.mock.calls.at(-1)![0]
}

describe('sign-in', () => {
  it('forgets the department remembered from a previous session', () => {
    const local = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    capture().signIn('user-sara')
    expect(local.removeItem).toHaveBeenCalledWith('hawkim.activeDepartment')
  })
})
