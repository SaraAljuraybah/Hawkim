import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileTypeOf, fileUrlOf, SIGNED_URL_SECONDS, storagePathFor, uploadSopFile } from './files'

const bucket = { upload: vi.fn(), createSignedUrl: vi.fn() }
const from = vi.fn(() => bucket)
vi.mock('./supabase', () => ({ supabase: () => ({ storage: { from } }) }))

beforeEach(() => vi.clearAllMocks())

describe('SOP files', () => {
  it('knows PDF and Word (.docx) files by their name', () => {
    expect(fileTypeOf('Backup.PDF')).toBe('pdf')
    expect(fileTypeOf('نموذج الإجراء.docx')).toBe('docx')
    expect(fileTypeOf('old.doc')).toBeUndefined()
  })

  it('stores each upload in the uploader\'s folder under a random name', () => {
    expect(storagePathFor('uuid-sara', 'docx', 'random-id')).toBe('uuid-sara/random-id.docx')
  })

  it('uploads with the right type, never replacing a file, and keeps the original name', async () => {
    bucket.upload.mockResolvedValue({ data: {}, error: null })
    // Some systems give a .docx file no type at all.
    const file = new File(['x'], 'Procédure finale.docx', { type: '' })
    const stored = await uploadSopFile('uuid-sara', file)
    expect(stored.fileName).toBe('Procédure finale.docx')
    expect(stored.storagePath).toMatch(/^uuid-sara\/[0-9a-f-]{36}\.docx$/)
    expect(from).toHaveBeenCalledWith('sop-files')
    expect(bucket.upload).toHaveBeenCalledWith(stored.storagePath, file, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false,
    })
  })

  it('refuses other file types and reports a failed upload', async () => {
    await expect(uploadSopFile('uuid-sara', new File(['x'], 'notes.txt'))).rejects.toThrow()
    expect(bucket.upload).not.toHaveBeenCalled()
    bucket.upload.mockResolvedValue({ data: null, error: { message: 'The object exceeded the maximum allowed size' } })
    await expect(uploadSopFile('uuid-sara', new File(['x'], 'big.pdf'))).rejects.toThrow('maximum allowed size')
  })

  it('opens stored files through a 10-minute signed link, and sample files by their URL', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    expect(await fileUrlOf({ storagePath: 'uuid-sara/a.pdf' })).toBe('https://signed')
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('uuid-sara/a.pdf', SIGNED_URL_SECONDS, undefined)
    expect(SIGNED_URL_SECONDS).toBe(600)
    await fileUrlOf({ storagePath: 'uuid-sara/a.pdf' }, 'SOP-001_v1.pdf')
    expect(bucket.createSignedUrl).toHaveBeenLastCalledWith('uuid-sara/a.pdf', 600, { download: 'SOP-001_v1.pdf' })
    expect(await fileUrlOf({ fileUrl: '/sample-sops/SOP-078.pdf' })).toBe('/sample-sops/SOP-078.pdf')
    expect(await fileUrlOf({})).toBeUndefined()
  })

  it('reports a file the person may not read', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } })
    await expect(fileUrlOf({ storagePath: 'uuid-sara/a.pdf' })).rejects.toThrow('Object not found')
  })
})
