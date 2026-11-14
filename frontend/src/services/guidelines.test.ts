import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachGuidelineFile,
  createGuidelineVersion,
  deleteAddedGuidelineVersion,
  GuidelineError,
  guidelineError,
  removeGuidelineFile,
  signedGuidelineFileUrl,
  toAddedGuidelineVersion,
  updateAddedGuidelineVersion,
  updatePublishedGuidelineVersion,
  uploadGuidelineFile,
} from './guidelines'

const bucket = { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() }
const from = vi.fn(() => bucket)
const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ storage: { from }, rpc }) }))

beforeEach(() => vi.clearAllMocks())

const details = { title: 'SFDA GVP', version: '4.1', issuedDate: '2026-10-01', source: 'https://www.sfda.gov.sa/gvp' }

describe('guideline PDFs', () => {
  it('uploads to the private bucket under a new random name, as a PDF, never replacing a file', async () => {
    bucket.upload.mockResolvedValue({ data: {}, error: null })
    const file = new File(['%PDF'], 'Drug-GVP4_1.pdf', { type: '' })
    const path = await uploadGuidelineFile(file)
    expect(path).toMatch(/^files\/[0-9a-f-]{36}\.pdf$/)
    expect(from).toHaveBeenCalledWith('guideline-files')
    expect(bucket.upload).toHaveBeenCalledWith(path, file, { contentType: 'application/pdf', upsert: false })
  })

  it('reports a failed upload as an upload failure', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: { message: 'Network' } })
    await expect(uploadGuidelineFile(new File(['x'], 'a.pdf'))).rejects.toMatchObject({ reason: 'upload' })
  })

  it('removes a file quietly, even when that fails', async () => {
    bucket.remove.mockRejectedValue(new Error('offline'))
    await expect(removeGuidelineFile('files/x.pdf')).resolves.toBeUndefined()
    expect(bucket.remove).toHaveBeenCalledWith(['files/x.pdf'])
  })

  it('opens a PDF through a 10-minute signed link', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    expect(await signedGuidelineFileUrl('files/x.pdf')).toBe('https://signed')
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('files/x.pdf', 600)
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } })
    await expect(signedGuidelineFileUrl('files/x.pdf')).rejects.toThrow('Object not found')
  })
})

describe('saving versions', () => {
  it('calls the database functions with the trimmed details', async () => {
    rpc.mockResolvedValue({ data: 'uuid-new', error: null })
    expect(await createGuidelineVersion(details, 'files/a.pdf', 'Drug-GVP4_1.pdf')).toBe('uuid-new')
    expect(rpc).toHaveBeenLastCalledWith('create_guideline_draft', {
      p_name: 'SFDA GVP', p_version: '4.1', p_issued_date: '2026-10-01', p_source: 'https://www.sfda.gov.sa/gvp', p_storage_path: 'files/a.pdf', p_file_name: 'Drug-GVP4_1.pdf',
    })
    await updateAddedGuidelineVersion('uuid-new', details)
    expect(rpc).toHaveBeenLastCalledWith('update_guideline_draft', {
      p_id: 'uuid-new', p_name: 'SFDA GVP', p_version: '4.1', p_issued_date: '2026-10-01', p_source: 'https://www.sfda.gov.sa/gvp',
    })
    await updatePublishedGuidelineVersion('uuid-40', details)
    expect(rpc).toHaveBeenLastCalledWith('update_guideline_version', { p_id: 'uuid-40', p_name: 'SFDA GVP', p_issued_date: '2026-10-01', p_source: 'https://www.sfda.gov.sa/gvp' })
    await attachGuidelineFile('uuid-40', 'files/b.pdf')
    expect(rpc).toHaveBeenLastCalledWith('attach_guideline_file', { p_id: 'uuid-40', p_storage_path: 'files/b.pdf' })
    rpc.mockResolvedValue({ data: { outcome: 'deleted', storage_path: 'files/a.pdf' }, error: null })
    expect(await deleteAddedGuidelineVersion('uuid-new')).toEqual({ outcome: 'deleted', storagePath: 'files/a.pdf' })
    expect(rpc).toHaveBeenLastCalledWith('delete_guideline_draft', { p_id: 'uuid-new' })
    // Being processed: the compliance service stops, then deletes it with its file.
    rpc.mockResolvedValue({ data: { outcome: 'cancel-requested' }, error: null })
    expect(await deleteAddedGuidelineVersion('uuid-new')).toEqual({ outcome: 'cancelled' })
  })

  it('turns a refusal into its reason: the hint, no permission, or anything else', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'exists', code: '23505', hint: 'version-exists' } })
    await expect(createGuidelineVersion(details, 'files/a.pdf', 'a.pdf')).rejects.toMatchObject({ reason: 'version-exists' })
    expect(guidelineError({ message: 'x', code: '23505', hint: 'file-exists' }).reason).toBe('file-exists')
    expect(guidelineError({ message: 'x', code: '42501' }).reason).toBe('permission')
    expect(guidelineError({ message: 'Failed to fetch', code: '' }).reason).toBe('other')
    expect(guidelineError({ message: 'x', code: 'P0002' }).reason).toBe('other')
    expect(guidelineError({ message: 'x', hint: 'something-new' }).reason).toBe('other')
    expect(guidelineError({ message: 'x' })).toBeInstanceOf(GuidelineError)
  })
})

describe('an added version', () => {
  it('is never current, has no requirements yet, and was added when it was created', () => {
    const version = toAddedGuidelineVersion({
      id: 'uuid-new', name: 'SFDA GVP', version: '4.1', issued_date: '2026-10-01', source: 'https://www.sfda.gov.sa/gvp', file_name: 'Drug-GVP4_1.pdf',
      storage_path: 'files/a.pdf', file_size: 2048, created_by: 'uuid-nouf', created_at: '2026-11-07T22:30:00Z',
    })
    expect(version).toEqual({
      id: 'uuid-new', title: 'SFDA GVP', version: '4.1', issuedDate: '2026-10-01', effectiveDate: '2026-11-08', fileName: 'Drug-GVP4_1.pdf',
      storagePath: 'files/a.pdf', fileSize: 2048, source: 'https://www.sfda.gov.sa/gvp', addedById: 'uuid-nouf', addedAt: '2026-11-07T22:30:00Z',
      requirements: [], neverCurrent: true,
      // A row without a processing status is waiting (the database default).
      processing: { status: 'waiting' },
    })
  })
})
