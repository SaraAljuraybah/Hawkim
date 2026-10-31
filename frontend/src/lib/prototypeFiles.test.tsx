import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileTypeOf, fileUrlOf } from './prototypeFiles'
import { useFileUrl } from '../hooks/useFileUrl'
import type { Sop } from '../data/mock/types'

const signedFileUrl = vi.hoisted(() => vi.fn(async () => 'https://signed.example.test/file'))
vi.mock('../services/files', () => ({ signedFileUrl, SIGNED_URL_SECONDS: 600 }))
vi.mock('../state/sessionContext', () => ({ useSession: () => ({ status: 'signed-in', user: { id: 'sara' } }) }))

/** The hook's first rendered value (no effects run in static rendering). */
function firstUrl(sop: Sop | undefined): string | undefined {
  const seen = vi.fn<(url: string | undefined) => void>()
  function Probe({ report }: { report: (url: string | undefined) => void }) { report(useFileUrl(sop)); return null }
  renderToStaticMarkup(<Probe report={seen} />)
  return seen.mock.calls[0][0]
}

describe('sample (in-memory) document URLs', () => {
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

  it('shows only safe sample URLs, and waits for a signed link for a stored file', () => {
    const document = { version: '1', fileUrl: 'blob:top-level', versions: [{ version: '1', fileUrl: 'blob:current' }] } as Sop
    expect(firstUrl(document)).toBe('blob:current')
    expect(firstUrl(undefined)).toBeUndefined()
    expect(firstUrl({ ...document, fileUrl: undefined, versions: [] })).toBeUndefined()
    expect(firstUrl({ ...document, fileUrl: undefined, versions: [{ ...document.versions[0], fileUrl: 'https://example.test/private.pdf' }] })).toBeUndefined()
    // A stored file is never shown from a cached or sample URL: it gets a fresh signed link (made after rendering).
    expect(firstUrl({ ...document, versions: [{ version: '1', storagePath: 'author/stored.pdf' }] } as Sop)).toBeUndefined()
  })
})
