import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Eye } from 'lucide-react'
import { IconButton } from './IconButton'

const tooltip = (html: string) => html.match(/role="tooltip"[^>]*><span[^>]*>([^<]*)</)![1]

describe('IconButton tooltip', () => {
  it('shows the label as the tooltip by default', () => {
    const html = renderToStaticMarkup(<IconButton label="Preview v2" icon={Eye} />)
    expect(html).toContain('aria-label="Preview v2"')
    expect(tooltip(html)).toBe('Preview v2')
  })
  it('still shows the reason when the action is unavailable', () => {
    const html = renderToStaticMarkup(<IconButton label="Edit QA" disabledReason="Cleanup pending" icon={Eye} />)
    expect(tooltip(html)).toBe('Cleanup pending')
  })
})
