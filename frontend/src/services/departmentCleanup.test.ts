import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanDepartmentFiles, storageObjectExists, type CleanupDependencies } from '../../../supabase/functions/delete-department/cleanup'
const claim = vi.fn(),remove=vi.fn(),exists=vi.fn(),acknowledge=vi.fn()
const dependencies: CleanupDependencies = {claim,remove,exists,acknowledge}
beforeEach(() => {
  vi.clearAllMocks()
  claim.mockResolvedValue({state:'processing',leaseToken:'lease',files:[{bucket:'sop-files',path:'author/a.pdf'},{bucket:'sop-files',path:'author/b.docx'}]})
  remove.mockResolvedValue(undefined); exists.mockResolvedValue(false); acknowledge.mockResolvedValue('completed')
})
describe('durable physical Storage cleanup worker', () => {
  it('uses the Storage API and verifies absence before acknowledging completion', async () => {
    expect(await cleanDepartmentFiles('job',dependencies)).toBe('completed')
    expect(remove).toHaveBeenCalledWith('sop-files',['author/a.pdf','author/b.docx'])
    expect(exists).toHaveBeenCalledTimes(2)
    expect(acknowledge).toHaveBeenCalledWith('job','lease',['author/a.pdf','author/b.docx'],false)
  })
  it('leaves failed Storage deletion retryable', async () => {
    remove.mockRejectedValue(new Error('storage unavailable')); acknowledge.mockResolvedValue('failed')
    expect(await cleanDepartmentFiles('job',dependencies)).toBe('failed')
    expect(acknowledge).toHaveBeenCalledWith('job','lease',[],true)
    expect(exists).not.toHaveBeenCalled()
  })
  it('acknowledges only verified absent objects on partial failure', async () => {
    exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    acknowledge.mockResolvedValue('failed')
    await cleanDepartmentFiles('job',dependencies)
    expect(acknowledge).toHaveBeenCalledWith('job','lease',['author/a.pdf'],true)
  })
  it('treats already absent objects as idempotent success', async () => {
    remove.mockResolvedValue(undefined)
    await cleanDepartmentFiles('job',dependencies)
    expect(acknowledge).toHaveBeenCalledWith('job','lease',expect.any(Array),false)
  })
  it('does not declare success if acknowledgement fails after file deletion', async () => {
    acknowledge.mockRejectedValue(new Error('network'))
    await expect(cleanDepartmentFiles('job',dependencies)).rejects.toThrow('network')
  })
  it.each(['busy','completed'])('does not delete files for a %s claim', async (state) => {
    claim.mockResolvedValue({state})
    expect(await cleanDepartmentFiles('job',dependencies)).toBe(state)
    expect(remove).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled()
  })
  it('rejects unexpected buckets and traversal paths before touching Storage', async () => {
    claim.mockResolvedValue({state:'processing',leaseToken:'lease',files:[{bucket:'shared',path:'../file'}]})
    await cleanDepartmentFiles('job',dependencies)
    expect(remove).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith('job','lease',[],true)
  })
})

it('distinguishes explicit Storage absence from authorization or server errors', () => {
  expect(storageObjectExists({data:null,error:{code:'NoSuchKey'}})).toBe(false)
  expect(storageObjectExists({data:{id:'existing'},error:null})).toBe(true)
  expect(() => storageObjectExists({data:null,error:{code:'AccessDenied'}})).toThrow()
  expect(() => storageObjectExists({data:null,error:{code:'InternalError'}})).toThrow()
})
