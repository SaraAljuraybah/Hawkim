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
  it('opens the tooltip above by default, or below when asked (e.g. in the top bar)', () => {
    expect(renderToStaticMarkup(<IconButton label="Edit" icon={Eye} />)).toContain('bottom-full pb-1.5')
    const below = renderToStaticMarkup(<IconButton label="Edit" icon={Eye} tooltipPlacement="below" />)
    expect(below).toContain('top-full pt-1.5')
    expect(below).not.toContain('bottom-full')
  })
  it('still shows the reason when the action is unavailable', () => {
    const html = renderToStaticMarkup(<IconButton label="Edit QA" disabledReason="Cleanup pending" icon={Eye} />)
    expect(tooltip(html)).toBe('Cleanup pending')
  })
})
