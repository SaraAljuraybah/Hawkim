import { beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationFolder } from './organizationFolder'
import { fetchGuidelineQueuePosition } from './guidelines'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))

beforeEach(() => vi.clearAllMocks())

describe('the organization\'s folder', () => {
  it('is the caller\'s organization\'s id (current_organization_id)', async () => {
    rpc.mockResolvedValue({ data: 'org-medcare', error: null })
    expect(await organizationFolder()).toBe('org-medcare')
    expect(rpc).toHaveBeenCalledWith('current_organization_id')
  })

  it('refuses to upload anywhere when the account has no organization or it can\'t be read', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(organizationFolder()).rejects.toThrow()
    rpc.mockResolvedValue({ data: null, error: { message: 'Network' } })
    await expect(organizationFolder()).rejects.toThrow('Network')
  })
})

describe('a waiting GVP version\'s place in the queue', () => {
  it('is read with guideline_queue_position, and is null when it isn\'t waiting', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    expect(await fetchGuidelineQueuePosition('uuid-70')).toBe(2)
    expect(rpc).toHaveBeenCalledWith('guideline_queue_position', { p_id: 'uuid-70' })
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await fetchGuidelineQueuePosition('uuid-70')).toBeNull()
    rpc.mockResolvedValue({ data: null, error: { message: 'Administrator required' } })
    await expect(fetchGuidelineQueuePosition('uuid-70')).rejects.toThrow('Administrator required')
  })
})
