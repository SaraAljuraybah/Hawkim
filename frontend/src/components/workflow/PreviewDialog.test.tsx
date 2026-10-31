import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PreviewDialog } from './PreviewDialog'

const fallback = { text: 'Open it instead.', openPdf: 'Open PDF', newTabHint: '(opens in a new tab)' }

describe('PreviewDialog', () => {
  it('keeps the title for screen readers only, naming the dialog, with the close button', () => {
    const html = renderToStaticMarkup(<PreviewDialog title="gg · v1" url="blob:document" viewerTitle="gg, v1 (PDF)" closeLabel="Close preview" fallback={fallback} onClose={() => {}} />)
    const heading = html.match(/<h2[^>]*>gg · v1<\/h2>/)![0]
    expect(heading).toContain('class="sr-only"')
    expect(html.match(/<dialog[^>]*>/)![0]).toContain(`aria-labelledby="${heading.match(/id="([^"]+)"/)![1]}"`)
    expect(html).toContain('aria-label="Close preview"')
  })
})
