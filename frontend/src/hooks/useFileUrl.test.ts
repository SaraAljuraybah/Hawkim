import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sop, User } from '../data/mock/types'
import { SIGNED_URL_REFRESH_MS, useFileUrl } from './useFileUrl'

/*
 * The hook runs for real (its state, effects, cleanups, timers and asynchronous replies) in a small
 * deterministic hook host, without a DOM library. Storage and the session are stand-ins: no Supabase
 * client, no network.
 */
type Slot = { initialized?: boolean; value?: unknown; dependencies?: unknown[]; cleanup?: () => void }
const host = vi.hoisted(() => ({
  slots: [] as Slot[], index: 0, effects: [] as (() => void)[], user: null as User | null,
  requests: [] as { path: string; resolve: (url: string) => void; reject: (error: Error) => void }[],
  listeners: new Map<string, () => void>(), visibility: 'visible' as 'visible' | 'hidden',
}))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  const slot = () => host.slots[host.index++] ?? (host.slots[host.index - 1] = {})
  return {
    ...react,
    useState: (initial: unknown) => {
      const item = slot()
      if (!item.initialized) { item.initialized = true; item.value = typeof initial === 'function' ? initial() : initial }
      return [item.value, (next: unknown) => { item.value = typeof next === 'function' ? next(item.value) : next }]
    },
    useEffect: (create: () => void | (() => void), dependencies: unknown[]) => {
      const item = slot()
      if (item.dependencies && dependencies.every((value, index) => Object.is(value, item.dependencies![index]))) return
      item.dependencies = dependencies
      host.effects.push(() => { item.cleanup?.(); item.cleanup = create() ?? undefined })
    },
  }
})
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ status: host.user ? 'signed-in' : 'signed-out', user: host.user }) }))
vi.mock('../services/files', async (original) => ({
  ...await original<typeof import('../services/files')>(),
  signedFileUrl: vi.fn((path: string) => new Promise<string>((resolve, reject) => { host.requests.push({ path, resolve, reject }) })),
}))
// A stand-in Storage client for the real fileUrlOf/signedFileUrl (used by open and download actions).
const storage = vi.hoisted(() => ({ calls: [] as { bucket: string; path: string; seconds: number; options?: unknown }[] }))
vi.mock('../services/supabase', () => ({
  supabase: () => ({ storage: { from: (bucket: string) => ({
    createSignedUrl: async (path: string, seconds: number, options?: unknown) => {
      storage.calls.push({ bucket, path, seconds, options })
      return { data: { signedUrl: `https://storage.example.test/${path}?token=${storage.calls.length}` }, error: null }
    },
  }) } }),
}))

const person = (id: string): User => ({ id, name: id, email: id + '@example.test', initials: 'TT', departmentId: 'home', permissions: ['author'] })
const sara = person('sara'), noura = person('noura')
function sop(id: string, version = '1', paths: Record<string, string> = { '1': `${id}/v1.pdf`, '2': `${id}/v2.pdf` }): Sop {
  return { id, code: 'SOP-001', title: id, departmentId: 'home', authorId: 'sara', coAuthorIds: [], status: 'draft', version, lastUpdated: '2026-10-31',
    fileName: 'file.pdf', fileType: 'pdf', reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [],
    versions: Object.entries(paths).map(([number, storagePath]) => ({ version: number, fileName: 'file.pdf', fileType: 'pdf' as const, storagePath, uploadedAt: '2026-10-31T08:00:00Z' })) }
}
/**
 * Renders the hook, then runs the effects that rendering scheduled (as React does after a commit).
 * It renders twice, as React does when a component resets its state while rendering.
 */
function Probe(document: Sop | undefined): string | undefined {
  return useFileUrl(document)
}
function render(document: Sop | undefined): string | undefined {
  let url: string | undefined
  for (let pass = 0; pass < 2; pass++) {
    host.index = 0
    url = Probe(document)
  }
  host.effects.splice(0).forEach((run) => run())
  return url
}
async function settle() { for (let index = 0; index < 10; index++) await Promise.resolve() }
const signed = (path: string, n = 1) => `https://storage.example.test/${path}?token=${n}`

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-31T09:00:00+03:00') })
  host.slots = []; host.index = 0; host.effects = []; host.requests = []; host.user = sara
  host.listeners.clear(); host.visibility = 'visible'
  vi.stubGlobal('document', {
    get visibilityState() { return host.visibility },
    addEventListener: (type: string, listener: () => void) => host.listeners.set(type, listener),
    removeEventListener: (type: string, listener: () => void) => { if (host.listeners.get(type) === listener) host.listeners.delete(type) },
  })
})
afterEach(() => {
  host.slots.forEach((slot) => slot.cleanup?.())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('signed links for stored SOP files', () => {
  it('creates a signed link for the current version and shows it once Storage replies', async () => {
    const document = sop('a')
    expect(render(document)).toBeUndefined()
    expect(host.requests.map((request) => request.path)).toEqual(['a/v1.pdf'])
    host.requests[0].resolve(signed('a/v1.pdf'))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf'))
    // Re-rendering does not ask Storage again.
    render(document); render(document)
    expect(host.requests).toHaveLength(1)
  })

  it('renews the link before its 10-minute expiry while the page stays open, without a gap', async () => {
    expect(SIGNED_URL_REFRESH_MS).toBe(9 * 60 * 1000)
    const document = sop('a')
    render(document)
    host.requests[0].resolve(signed('a/v1.pdf', 1))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf', 1))
    vi.advanceTimersByTime(SIGNED_URL_REFRESH_MS - 1)
    render(document)
    expect(host.requests).toHaveLength(1)
    vi.advanceTimersByTime(1)
    // The renewal is asked for at 9 minutes; the first link (valid until 10) stays shown meanwhile.
    expect(render(document)).toBe(signed('a/v1.pdf', 1))
    expect(host.requests).toHaveLength(2)
    host.requests[1].resolve(signed('a/v1.pdf', 2))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf', 2))
    // And again 9 minutes later.
    vi.advanceTimersByTime(SIGNED_URL_REFRESH_MS)
    render(document)
    expect(host.requests).toHaveLength(3)
  })

  it('makes a new link when the tab comes back after the link expired (timers held back while away)', async () => {
    const document = sop('a')
    render(document)
    host.requests[0].resolve(signed('a/v1.pdf', 1))
    await settle()
    render(document)
    // The device slept: 11 minutes passed but no timer ran.
    host.visibility = 'hidden'
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    host.visibility = 'visible'
    host.listeners.get('visibilitychange')!()
    render(document)
    expect(host.requests).toHaveLength(2)
    host.requests[1].resolve(signed('a/v1.pdf', 2))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf', 2))
    // Coming back soon after a renewal does not ask again.
    host.listeners.get('visibilitychange')!()
    render(document)
    expect(host.requests).toHaveLength(2)
  })

  it('opening or downloading always asks Storage for a new 10-minute link, so an expired one is never reused', async () => {
    const { fileUrlOf } = await vi.importActual<typeof import('../services/files')>('../services/files')
    storage.calls.splice(0)
    const first = await fileUrlOf({ storagePath: 'a/v1.pdf' }, 'SOP.pdf')
    vi.advanceTimersByTime(11 * 60 * 1000)
    const second = await fileUrlOf({ storagePath: 'a/v1.pdf' }, 'SOP.pdf')
    expect(first).not.toBe(second)
    expect(storage.calls).toEqual([
      { bucket: 'sop-files', path: 'a/v1.pdf', seconds: 600, options: { download: 'SOP.pdf' } },
      { bucket: 'sop-files', path: 'a/v1.pdf', seconds: 600, options: { download: 'SOP.pdf' } },
    ])
  })

  it('never shows the previous file when switching between two SOPs, and ignores the late reply for the first', async () => {
    render(sop('a'))
    host.requests[0].resolve(signed('a/v1.pdf'))
    await settle()
    expect(render(sop('a'))).toBe(signed('a/v1.pdf'))
    expect(render(sop('b'))).toBeUndefined()
    expect(host.requests[1].path).toBe('b/v1.pdf')
    // Back to A before B replies, then B's reply arrives late: it is ignored.
    expect(render(sop('a'))).toBeUndefined()
    host.requests[1].resolve(signed('b/v1.pdf'))
    await settle()
    expect(render(sop('a'))).toBeUndefined()
    host.requests[2].resolve(signed('a/v1.pdf', 2))
    await settle()
    expect(render(sop('a'))).toBe(signed('a/v1.pdf', 2))
  })

  it('never shows the previous version\'s link when the SOP moves to another version', async () => {
    render(sop('a', '1'))
    host.requests[0].resolve(signed('a/v1.pdf'))
    await settle()
    expect(render(sop('a', '1'))).toBe(signed('a/v1.pdf'))
    expect(render(sop('a', '2'))).toBeUndefined()
    expect(host.requests[1].path).toBe('a/v2.pdf')
    host.requests[1].resolve(signed('a/v2.pdf'))
    await settle()
    expect(render(sop('a', '2'))).toBe(signed('a/v2.pdf'))
  })
})

describe('signed links and the signed-in user', () => {
  it('shows nothing after signing out and asks for a new link after signing in again (no reuse)', async () => {
    const document = sop('a')
    render(document)
    host.requests[0].resolve(signed('a/v1.pdf', 1))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf', 1))
    host.user = null
    expect(render(document)).toBeUndefined()
    expect(host.requests).toHaveLength(1)
    // No renewal for a signed-out tab.
    vi.advanceTimersByTime(SIGNED_URL_REFRESH_MS)
    render(document)
    expect(host.requests).toHaveLength(1)
    host.user = sara
    expect(render(document)).toBeUndefined()
    expect(host.requests).toHaveLength(2)
    host.requests[1].resolve(signed('a/v1.pdf', 2))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf', 2))
  })

  it('never shows another user the previous user\'s link for the same stored file', async () => {
    const document = sop('shared')
    render(document)
    host.requests[0].resolve(signed('shared/v1.pdf', 1))
    await settle()
    expect(render(document)).toBe(signed('shared/v1.pdf', 1))
    host.user = noura
    expect(render(document)).toBeUndefined()
    expect(host.requests.map((request) => request.path)).toEqual(['shared/v1.pdf', 'shared/v1.pdf'])
    host.requests[1].resolve(signed('shared/v1.pdf', 2))
    await settle()
    expect(render(document)).toBe(signed('shared/v1.pdf', 2))
  })

  it('ignores a reply that arrives after signing out or switching accounts', async () => {
    const document = sop('a')
    render(document)
    host.user = null
    render(document)
    host.requests[0].resolve(signed('a/v1.pdf', 1))
    await settle()
    expect(render(document)).toBeUndefined()

    host.user = sara
    render(document)
    host.user = noura
    render(document)
    // Sara's request replies after Noura signed in: ignored.
    host.requests[1].resolve(signed('a/v1.pdf', 2))
    await settle()
    expect(render(document)).toBeUndefined()
    host.requests[2].resolve(signed('a/v1.pdf', 3))
    await settle()
    expect(render(document)).toBe(signed('a/v1.pdf', 3))
  })
})

describe('Storage failures and sample files', () => {
  it.each(['Object not found', 'new row violates row-level security policy', 'Failed to fetch'])('shows no link when Storage refuses or fails (%s), and recovers for another file', async (message) => {
    render(sop('a'))
    host.requests[0].reject(new Error(message))
    await settle()
    expect(render(sop('a'))).toBeUndefined()
    // A failure schedules no renewal.
    vi.advanceTimersByTime(SIGNED_URL_REFRESH_MS)
    render(sop('a'))
    expect(host.requests).toHaveLength(1)
    render(sop('b'))
    host.requests[1].resolve(signed('b/v1.pdf'))
    await settle()
    expect(render(sop('b'))).toBe(signed('b/v1.pdf'))
  })

  it('keeps an earlier valid link hidden once a renewal is refused', async () => {
    const document = sop('a')
    render(document)
    host.requests[0].resolve(signed('a/v1.pdf', 1))
    await settle()
    vi.advanceTimersByTime(SIGNED_URL_REFRESH_MS)
    render(document)
    host.requests[1].reject(new Error('Access denied'))
    await settle()
    expect(render(document)).toBeUndefined()
  })

  it('shows sample files only from safe URLs, without asking Storage', async () => {
    const sample = (fileUrl: string): Sop => ({ ...sop('sample'), versions: [{ version: '1', fileName: 'file.pdf', fileType: 'pdf', fileUrl, uploadedAt: '2026-10-31T08:00:00Z' }] })
    expect(render(sample('/sample-sops/procedure.pdf'))).toBe('/sample-sops/procedure.pdf')
    expect(render(sample('blob:local-procedure'))).toBe('blob:local-procedure')
    for (const unsafe of ['https://example.test/private.pdf', '//example.test/private.pdf', 'javascript:alert(1)']) expect(render(sample(unsafe))).toBeUndefined()
    expect(host.requests).toEqual([])
    const { fileUrlOf } = await import('../services/files')
    expect(await fileUrlOf({ fileUrl: '/sample-sops/procedure.pdf' })).toBe('/sample-sops/procedure.pdf')
    expect(await fileUrlOf({ fileUrl: 'https://example.test/private.pdf' })).toBeUndefined()
    expect(render(undefined)).toBeUndefined()
  })
})
