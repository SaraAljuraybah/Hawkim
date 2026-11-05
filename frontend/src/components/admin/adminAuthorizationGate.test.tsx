import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthorizationGate } from './AdminAuthorizationGate'
import { PageLoading } from '../ui/PageLoading'
import { NotFoundPage } from '../../pages/NotFoundPage'
import { LoadFailedPage } from '../../pages/LoadFailedPage'

type Slot = { value?: unknown; initialized?: boolean; deps?: unknown[]; cleanup?: () => void }
const host = vi.hoisted(() => ({ slots: [] as Slot[], index: 0, effects: [] as (() => void)[], userId: 'admin', rpc: vi.fn(), focus: undefined as (() => void) | undefined }))
vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ user: host.userId ? { id: host.userId } : null }) }))
vi.mock('../../services/supabase', () => ({ supabase: () => ({ rpc: host.rpc }) }))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  const slot = () => host.slots[host.index++] ?? (host.slots[host.index - 1] = {})
  return { ...react,
    useState: (initial: unknown) => {
      const item = slot()
      if (!item.initialized) { item.initialized = true; item.value = initial }
      return [item.value, (value: unknown) => { item.value = value }]
    },
    useEffect: (create: () => (() => void), deps: unknown[]) => {
      const item = slot()
      if (item.deps && deps.every((value, i) => Object.is(value, item.deps![i]))) return
      item.deps = deps
      host.effects.push(() => { item.cleanup?.(); item.cleanup = create() })
    },
  }
})
const render = () => {
  host.index = 0
  const result = AdminAuthorizationGate({ children: 'ADMIN CONTENT' })
  host.effects.splice(0).forEach(effect => effect())
  return result
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  host.slots.forEach(slot => slot.cleanup?.())
  host.slots = []; host.effects = []; host.index = 0; host.userId = 'admin'; host.focus = undefined
  host.rpc.mockReset()
  vi.stubGlobal('window', {
    addEventListener: (_name: string, listener: () => void) => { host.focus = listener },
    removeEventListener: () => { host.focus = undefined },
  })
})
afterEach(() => { host.slots.forEach(slot => slot.cleanup?.()); host.slots = []; vi.unstubAllGlobals() })

describe('current backend authorization before mounting Admin UI', () => {
  it('waits, verifies the mutation authorization helper, then mounts an allowed Admin', async () => {
    host.rpc.mockResolvedValue({ data: true, error: null })
    expect(render()).toMatchObject({ type: PageLoading })
    await flush()
    expect(render()).toBe('ADMIN CONTENT')
    expect(host.rpc).toHaveBeenCalledWith('can_manage_organization')
  })
  it.each([false, null, 'true'])('keeps the portal hidden when authorization is %s', async data => {
    host.rpc.mockResolvedValue({ data, error: null })
    render(); await flush()
    expect(render()).toMatchObject({ type: NotFoundPage })
  })
  it('fails closed on a database error or network failure', async () => {
    host.rpc.mockResolvedValue({ data: true, error: { code: '42501' } })
    render(); await flush()
    expect(render()).toMatchObject({ type: LoadFailedPage })
    host.rpc.mockRejectedValue(new Error('offline'))
    host.focus?.(); await flush()
    expect(render()).toMatchObject({ type: LoadFailedPage })
  })
  it('drops authorization on identity changes and ignores a prior identity response', async () => {
    let settle!: (result: { data: boolean; error: null }) => void
    host.rpc.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    render()
    host.userId = 'employee'
    host.rpc.mockResolvedValue({ data: false, error: null })
    expect(render()).toMatchObject({ type: PageLoading })
    await flush(); settle({ data: true, error: null }); await flush()
    expect(render()).toMatchObject({ type: NotFoundPage })
  })
  it('rechecks on focus and removes previously allowed content after revocation', async () => {
    host.rpc.mockResolvedValue({ data: true, error: null })
    render(); await flush(); expect(render()).toBe('ADMIN CONTENT')
    host.rpc.mockResolvedValue({ data: false, error: null })
    host.focus?.()
    expect(render()).toMatchObject({ type: PageLoading })
    await flush(); expect(render()).toMatchObject({ type: NotFoundPage })
  })
  it('does not request authorization for a signed-out visitor', () => {
    host.userId = ''
    expect(render()).toMatchObject({ type: PageLoading })
    expect(host.rpc).not.toHaveBeenCalled()
  })
})
