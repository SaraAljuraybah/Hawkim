import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanDepartmentFiles, cleanDepartmentFilesUntilDone, storageObjectExists, type CleanupDependencies } from '../../../supabase/functions/delete-department/cleanup'
const claim = vi.fn(), remove = vi.fn(), present = vi.fn(), acknowledge = vi.fn()
const dependencies: CleanupDependencies = { claim, remove, present, acknowledge }
const files = [{ bucket: 'sop-files', path: 'author/a.pdf' }, { bucket: 'sop-files', path: 'author/b.docx' }]
beforeEach(() => {
  vi.clearAllMocks()
  claim.mockResolvedValue({ state: 'processing', leaseToken: 'lease', files })
  remove.mockResolvedValue(undefined); present.mockResolvedValue([]); acknowledge.mockResolvedValue('completed')
})
describe('durable physical Storage cleanup worker', () => {
  it('uses the Storage API, then verifies absence in the database before acknowledging', async () => {
    expect(await cleanDepartmentFiles('job', dependencies)).toBe('completed')
    expect(remove).toHaveBeenCalledWith('sop-files', ['author/a.pdf', 'author/b.docx'])
    expect(present).toHaveBeenCalledWith('job', ['author/a.pdf', 'author/b.docx'])
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', ['author/a.pdf', 'author/b.docx'], false)
  })
  it('leaves a failed Storage deletion retryable and acknowledges nothing still present', async () => {
    remove.mockRejectedValue(new Error('storage unavailable')); present.mockResolvedValue(['author/a.pdf', 'author/b.docx'])
    acknowledge.mockResolvedValue('failed')
    expect(await cleanDepartmentFiles('job', dependencies)).toBe('failed')
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', [], true)
  })
  it('acknowledges only verified absent objects on a partial failure', async () => {
    present.mockResolvedValue(['author/b.docx']); acknowledge.mockResolvedValue('failed')
    await cleanDepartmentFiles('job', dependencies)
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', ['author/a.pdf'], true)
  })
  it('treats a Storage error as success when every object is verifiably gone (e.g. already missing)', async () => {
    remove.mockRejectedValue(new Error('not found'))
    await cleanDepartmentFiles('job', dependencies)
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', ['author/a.pdf', 'author/b.docx'], false)
  })
  it('acknowledges nothing when verification itself fails', async () => {
    present.mockRejectedValue(new Error('db down')); acknowledge.mockResolvedValue('failed')
    await cleanDepartmentFiles('job', dependencies)
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', [], true)
  })
  it('does not declare success if the acknowledgement fails after file deletion', async () => {
    acknowledge.mockRejectedValue(new Error('network'))
    await expect(cleanDepartmentFiles('job', dependencies)).rejects.toThrow('network')
  })
  it.each(['busy', 'completed'])('does not delete files for a %s claim', async (state) => {
    claim.mockResolvedValue({ state })
    expect(await cleanDepartmentFiles('job', dependencies)).toBe(state)
    expect(remove).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled()
  })
  it('rejects unexpected buckets and traversal paths before touching Storage', async () => {
    claim.mockResolvedValue({ state: 'processing', leaseToken: 'lease', files: [{ bucket: 'shared', path: '../file' }] })
    await cleanDepartmentFiles('job', dependencies)
    expect(remove).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', [], true)
  })
  it('completes an empty manifest without touching Storage', async () => {
    claim.mockResolvedValue({ state: 'processing', leaseToken: 'lease', files: [] })
    await cleanDepartmentFiles('job', dependencies)
    expect(remove).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith('job', 'lease', [], false)
  })
  it('keeps processing batches until done, and stops at the time budget', async () => {
    acknowledge.mockResolvedValueOnce('pending').mockResolvedValueOnce('pending').mockResolvedValueOnce('completed')
    expect(await cleanDepartmentFilesUntilDone('job', dependencies)).toBe('completed')
    expect(claim).toHaveBeenCalledTimes(3)
    vi.clearAllMocks(); claim.mockResolvedValue({ state: 'processing', leaseToken: 'lease', files }); present.mockResolvedValue([])
    acknowledge.mockResolvedValue('pending')
    let clock = 0
    // Start = 60, end = 160; after batch 1 the clock reads 120 (continue), after batch 2 it reads 180 (stop).
    expect(await cleanDepartmentFilesUntilDone('job', dependencies, 100, () => (clock += 60))).toBe('pending')
    expect(claim).toHaveBeenCalledTimes(2)
  })
})

it('distinguishes explicit Storage absence from authorization or server errors', () => {
  expect(storageObjectExists({ data: null, error: { code: 'NoSuchKey' } })).toBe(false)
  expect(storageObjectExists({ data: { id: 'existing' }, error: null })).toBe(true)
  expect(() => storageObjectExists({ data: null, error: { code: 'AccessDenied' } })).toThrow()
})
