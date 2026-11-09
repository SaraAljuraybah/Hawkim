import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { OrganizationHierarchy } from '../services/organization'
import { OrganizationalStructurePage, type OrganizationLoadState } from './OrganizationalStructurePage'

type Slot = { value?: unknown; initialized?: boolean; dependencies?: unknown[]; cleanup?: () => void }
const host = vi.hoisted(() => ({ slots: [] as Slot[], index: 0, effects: [] as (() => void)[], userId: 'admin-1', load: vi.fn() }))
vi.mock('../services/organization', () => ({ fetchOrganization: host.load }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => ({ id: host.userId }) }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [] }) }))
// Same deterministic hook-host approach used by the existing provider tests.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  const slot = () => host.slots[host.index++] ?? (host.slots[host.index - 1] = {})
  return {
    ...react,
    useState: (initial: unknown) => {
      const item = slot()
      if (!item.initialized) { item.value = initial; item.initialized = true }
      return [item.value, (next: unknown) => { item.value = typeof next === 'function' ? next(item.value) : next }]
    },
    useEffect: (create: () => (() => void), dependencies: unknown[]) => {
      const item = slot()
      if (item.dependencies && dependencies.every((value, index) => Object.is(value, item.dependencies![index]))) return
      item.dependencies = dependencies
      host.effects.push(() => { item.cleanup?.(); item.cleanup = create() })
    },
  }
})
function render() {
  host.index = 0
  const page = OrganizationalStructurePage({})
  const content = page.props.children[1] as ReactElement<{ state: OrganizationLoadState; reload: () => void }>
  host.effects.splice(0).forEach((effect) => effect())
  return content.props
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const snapshot: OrganizationHierarchy = {
  organization: null, divisions: [], departments: [
    { id: 'a', name: 'A', divisionId: null, employees: [{ id: 'u', name: 'Persisted name', initials: 'PN', email: 'persisted@test.invalid', permissions: ['author'] }] },
    { id: 'b', name: 'B', divisionId: null, employees: [] },
  ],
}
beforeEach(() => {
  host.slots.forEach((slot) => slot.cleanup?.())
  host.slots = []; host.effects = []; host.index = 0; host.userId = 'admin-1'
  host.load.mockReset()
})

describe('organization loading and refetching', () => {
  it('automatically loads once on opening and fetches again when the page is reopened', async () => {
    host.load.mockResolvedValue(snapshot)
    expect(render().state.status).toBe('loading')
    await flush()
    expect(render().state).toEqual({ status: 'ready', hierarchy: snapshot })
    render()
    expect(host.load).toHaveBeenCalledTimes(1)
    host.slots.forEach((slot) => slot.cleanup?.())
    host.slots = []
    expect(render().state.status).toBe('loading')
    await flush()
    expect(render().state).toEqual({ status: 'ready', hierarchy: snapshot })
    expect(host.load).toHaveBeenCalledTimes(2)
  })
  it('shows API failures and retries through the actual page handler', async () => {
    host.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot)
    expect(render().state.status).toBe('loading')
    await flush()
    const failed = render()
    expect(failed.state.status).toBe('error')
    failed.reload()
    expect(render().state.status).toBe('loading')
    await flush()
    expect(render().state).toEqual({ status: 'ready', hierarchy: snapshot })
    expect(host.load).toHaveBeenCalledTimes(2)
  })
  it('replaces assignments, counts, names and permissions on refetch', async () => {
    const changed = structuredClone(snapshot)
    changed.departments[1].employees = [{ ...changed.departments[0].employees[0], name: 'Renamed employee', permissions: ['author', 'reviewer'] }]
    changed.departments[0].employees = []
    host.load.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(changed)
    render(); await flush()
    expect(render().state).toEqual({ status: 'ready', hierarchy: snapshot })
    render().reload(); render(); await flush()
    expect(render().state).toEqual({ status: 'ready', hierarchy: changed })
  })
  it('discards late responses and hides data when the signed-in identity changes', async () => {
    let finish!: (value: OrganizationHierarchy) => void
    host.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce({ ...snapshot, departments: [] })
    render()
    host.userId = 'admin-2'
    expect(render().state.status).toBe('loading')
    finish(snapshot)
    await flush()
    expect(render().state).toEqual({ status: 'ready', hierarchy: { ...snapshot, departments: [] } })
  })
})
