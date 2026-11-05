import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Copy } from 'lucide-react'
import { copyToClipboard } from './clipboard'
import { CopyButton, type CopyStatus } from './CopyButton'
import { IconButton } from './IconButton'

// Renders the button in a chosen state: CopyButton's status is the only useState starting at 'idle'.
const state = vi.hoisted(() => ({ status: 'idle' as CopyStatus }))
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return {
    ...react,
    useState: (initial: unknown) => (initial === 'idle' ? [state.status, () => {}] : react.useState(initial)),
  }
})
beforeEach(() => { state.status = 'idle' })

const render = (status: CopyStatus) => {
  state.status = status
  return renderToStaticMarkup(<CopyButton text="sara@test.invalid" label="Copy Sara Ahmed's email" copiedText="Copied" failedText="Couldn't copy" />)
}

describe('CopyButton', () => {
  it('is a button named after what it copies, with an empty polite live region', () => {
    const html = render('idle')
    expect(html).toMatch(/<button type="button" aria-label="Copy Sara Ahmed&#x27;s email"/)
    expect(html).toContain('lucide-copy')
    expect(html).toMatch(/<span aria-live="polite"[^>]*><\/span>/)
  })
  it('has no hover tooltip, keeps a full-size button and puts the message on its own line', () => {
    const html = render('idle')
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain('<span class="inline-flex shrink-0">')
    expect(html).toMatch(/<span aria-live="polite" class="basis-full /)
  })
  it('leaves the tooltip on other icon buttons by default', () => {
    const html = renderToStaticMarkup(<IconButton label="Preview v2" icon={Copy} />)
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('>Preview v2<')
  })
})

describe('CopyButton states', () => {
  it('shows and announces "Copied" with a check icon after copying', () => {
    const html = render('copied')
    expect(html).toMatch(/<span aria-live="polite"[^>]*text-maroon[^>]*>Copied<\/span>/)
    expect(html).toContain('lucide-check')
  })
  it('shows and announces a short error when copying fails', () => {
    const html = render('failed')
    expect(html).toMatch(/<span aria-live="polite"[^>]*text-status-rejected-fg[^>]*>Couldn&#x27;t copy<\/span>/)
    expect(html).toContain('lucide-copy')
  })
})

describe('copyToClipboard', () => {
  it('writes the exact text and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await copyToClipboard('sara@test.invalid', { writeText })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('sara@test.invalid')
  })
  it('reports failure when the browser refuses', async () => {
    expect(await copyToClipboard('x', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).toBe(false)
  })
  it('reports failure when the Clipboard API is unavailable', async () => {
    expect(await copyToClipboard('x', undefined)).toBe(false)
  })
})
