import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetSentForApproval, rememberSentForApproval, wasSentForApproval } from './approvalSentStorage'

function memoryStorage() {
  const items = new Map<string, string>()
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) } }
}

afterEach(() => vi.unstubAllGlobals())

describe('SOP versions sent for approval in this browser', () => {
  it('remembers one version per SOP and forgets it', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    expect(wasSentForApproval('sop-1', '2')).toBe(false)
    rememberSentForApproval('sop-1', '2')
    rememberSentForApproval('sop-2', '1')
    expect(wasSentForApproval('sop-1', '2')).toBe(true)
    expect(wasSentForApproval('sop-1', '3')).toBe(false) // a new version isn't sent yet
    expect(wasSentForApproval('sop-2', '1')).toBe(true)
    forgetSentForApproval('sop-1')
    expect(wasSentForApproval('sop-1', '2')).toBe(false)
    expect(wasSentForApproval('sop-2', '1')).toBe(true)
    forgetSentForApproval('sop-2')
    expect(storage.items.size).toBe(0)
  })

  it('ignores unreadable values and unavailable storage', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    storage.items.set('hawkim.sentForApproval', 'not json')
    expect(wasSentForApproval('sop-1', '1')).toBe(false)
    storage.items.set('hawkim.sentForApproval', '["sop-1"]')
    expect(wasSentForApproval('sop-1', '1')).toBe(false)

    const blocked = () => { throw new Error('Storage blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => rememberSentForApproval('sop-1', '1')).not.toThrow()
    expect(wasSentForApproval('sop-1', '1')).toBe(false)
    expect(() => forgetSentForApproval('sop-1')).not.toThrow()
  })
})
