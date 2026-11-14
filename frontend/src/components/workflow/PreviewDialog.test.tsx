import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MetaLine } from '../ui/MetaLine'
import { sopWorkflowEn } from '../../content/workflow.en'
import { formatReviewDate } from '../../lib/format'
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

describe('the preview dialog header line', () => {
  const meta = (uploader?: string) => (
    <MetaLine template={uploader ? sopWorkflowEn.history.previewMeta : sopWorkflowEn.history.previewMetaNoUploader}
      values={{ file: 'Safety Procedure.pdf', date: <time dateTime="2026-11-12T21:30:00Z">{formatReviewDate('2026-11-12T21:30:00Z')}</time>, name: uploader ?? '' }} />
  )
  const render = (uploader?: string) => renderToStaticMarkup(<PreviewDialog title="gg · v1" meta={meta(uploader)} url="blob:document" viewerTitle="gg, v1 (PDF)" closeLabel="Close preview" fallback={fallback} onClose={() => {}} />)
  const text = (html: string) => html.match(/<p class="text-sm text-text-gray">(.*?)<\/p>/)![1].replace(/<span class="sr-only">, <\/span>/g, '').replace(/<[^>]+>/g, '')

  it('shows the uploaded file name, the day it was added (in Riyadh) and who added it, like the SOP detail subtitle', () => {
    const html = render('Sara Ahmed')
    // 21:30 UTC on 12 November is 13 November in Riyadh.
    expect(text(html)).toBe('Safety Procedure.pdf · Added on Nov 13, 2026 · by Sara Ahmed')
    expect(html).toContain('<time dateTime="2026-11-12T21:30:00Z">')
    // Screen readers hear commas, not dots.
    expect(html.match(/<span aria-hidden="true"> · <\/span><span class="sr-only">, <\/span>/g)).toHaveLength(2)
    expect(html.indexOf('Safety Procedure.pdf')).toBeLessThan(html.indexOf('aria-label="Close preview"'))
  })

  it('leaves out "by" when the uploader isn\'t known', () => {
    expect(text(render())).toBe('Safety Procedure.pdf · Added on Nov 13, 2026')
  })
})
