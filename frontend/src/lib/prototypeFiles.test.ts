import { describe, expect, it } from 'vitest'
import { fileTypeOf, fileUrlOf } from './prototypeFiles'
import { useFileUrl } from '../hooks/useFileUrl'
import type { Sop } from '../data/mock/types'

describe('local prototype document URLs', () => {
  it('opens local sample and object URLs without requesting storage URLs', async () => {
    for (const fileUrl of ['/sample-sops/procedure.pdf', 'blob:local-procedure']) {
      expect(await fileUrlOf({ fileUrl, storagePath: 'experimental/private.pdf' })).toBe(fileUrl)
    }
    expect(fileTypeOf({ name: 'Procedure.PDF' })).toBe('pdf')
    expect(fileTypeOf({ name: 'Procedure.docx' })).toBe('docx')
    expect(() => fileTypeOf({ name: 'Procedure.exe' })).toThrow(/Only PDF and DOCX/)
  })

  it('does not connect remote, protocol-relative or storage-only documents', async () => {
    for (const fileUrl of ['https://example.test/private.pdf', '//example.test/private.pdf', '/\\example.test/private.pdf', '/\n/example.test/private.pdf', 'javascript:alert(1)', undefined]) {
      expect(await fileUrlOf({ fileUrl, storagePath: 'experimental/private.pdf' })).toBeUndefined()
    }
  })

  it('does not retain a previous document URL when the authorized SOP changes', () => {
    const document = { version: '1', fileUrl: 'blob:top-level', versions: [{ version: '1', fileUrl: 'blob:current' }] } as Sop
    expect(useFileUrl(document)).toBe('blob:current')
    expect(useFileUrl(undefined)).toBeUndefined()
    expect(useFileUrl({ ...document, fileUrl: undefined, versions: [] })).toBeUndefined()
    expect(useFileUrl({ ...document, fileUrl: undefined, versions: [{ ...document.versions[0], fileUrl: 'https://example.test/private.pdf' }] })).toBeUndefined()
  })
})
