import { describe, expect, it, vi } from 'vitest'
import { PROFILE_CHECK_INTERVAL_MS, watchActiveProfile, type WatchEnvironment } from './profileWatch'

/** A stand-in for the browser: the interval and the two events are fired by hand. */
function fakeEnvironment(visible = true) {
  const listeners = new Map<string, () => void>()
  let tick: (() => void) | undefined
  const environment: WatchEnvironment = {
    setInterval: vi.fn((callback: () => void, ms: number) => { expect(ms).toBe(PROFILE_CHECK_INTERVAL_MS); tick = callback; return 1 }),
    clearInterval: vi.fn(() => { tick = undefined }),
    addEventListener: vi.fn((type: string, callback: () => void) => { listeners.set(type, callback) }),
    removeEventListener: vi.fn((type: string) => { listeners.delete(type) }),
    isVisible: () => visible,
  }
  return {
    environment,
    tick: () => tick?.(),
    fire: (type: 'focus' | 'visibilitychange') => listeners.get(type)?.(),
    listening: () => listeners.size,
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('an open tab whose profile is deactivated', () => {
  it('ends the session at the next check (interval, focus or showing the tab), once', async () => {
    const fake = fakeEnvironment()
    const check = vi.fn(async () => false)
    const onEnded = vi.fn()
    watchActiveProfile('u', check, onEnded, fake.environment)
    fake.fire('focus')
    await settle()
    expect(check).toHaveBeenCalledWith('u')
    expect(onEnded).toHaveBeenCalledTimes(1)
    // It stopped watching.
    expect(fake.listening()).toBe(0)
    fake.tick()
    await settle()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it.each(['tick', 'visibilitychange'] as const)('also checks on %s', async (trigger) => {
    const fake = fakeEnvironment()
    const onEnded = vi.fn()
    watchActiveProfile('u', async () => false, onEnded, fake.environment)
    if (trigger === 'tick') fake.tick()
    else fake.fire(trigger)
    await settle()
    expect(onEnded).toHaveBeenCalled()
  })
})

describe('everyone else stays signed in', () => {
  it('keeps an active profile signed in', async () => {
    const fake = fakeEnvironment()
    const onEnded = vi.fn()
    watchActiveProfile('u', async () => true, onEnded, fake.environment)
    fake.tick()
    fake.fire('focus')
    await settle()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('never signs out when the server can\'t be reached', async () => {
    const fake = fakeEnvironment()
    const onEnded = vi.fn()
    watchActiveProfile('u', async () => undefined, onEnded, fake.environment)
    fake.tick()
    await settle()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('doesn\'t check while the tab is hidden', async () => {
    const fake = fakeEnvironment(false)
    const check = vi.fn(async () => false)
    watchActiveProfile('u', check, vi.fn(), fake.environment)
    fake.tick()
    await settle()
    expect(check).not.toHaveBeenCalled()
  })

  it('stops watching when the person signs out (cleanup)', () => {
    const fake = fakeEnvironment()
    const stop = watchActiveProfile('u', async () => true, vi.fn(), fake.environment)
    stop()
    expect(fake.listening()).toBe(0)
    expect(fake.environment.clearInterval).toHaveBeenCalled()
  })
})
