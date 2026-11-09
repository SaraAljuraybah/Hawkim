import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { toGuidelineProcessing } from '../../services/guidelines'
import { GuidelineProcessingCard } from './GuidelineProcessingCard'

const text = adminEn.regulationDetails.processing
const base: GuidelineVersion = { id: 'uuid-60', version: '6.0', effectiveDate: '2026-11-08', fileName: 'Drug-GVP6_0.pdf', requirements: [], neverCurrent: true }
const render = (processing: GuidelineVersion['processing']) =>
  renderToStaticMarkup(<GuidelineProcessingCard version={{ ...base, processing }} onRetry={async () => {}} onMakeCurrent={async () => {}} />)

describe('GVP version processing', () => {
  it('reads the processing state defensively', () => {
    expect(toGuidelineProcessing({ processing_status: 'processing' })).toEqual({ status: 'processing' })
    expect(toGuidelineProcessing({ processing_status: null })).toEqual({ status: 'waiting' })
    expect(toGuidelineProcessing({ processing_status: 'failed', processing_error: 'Not a PDF' }).error).toBe('Not a PDF')
    expect(toGuidelineProcessing({ processing_status: 'ready', processing_report: { requirements: 1510, sections: 368, pages: 369, warnings: ['Page 3 has little text', 7], missing_excluded_sections: ['III.B.4.1'] } }).report)
      .toEqual({ requirements: 1510, sections: 368, pages: 369, warnings: ['Page 3 has little text'], missingExcludedSections: ['III.B.4.1'] })
    // A broken report is not shown rather than shown wrongly.
    expect(toGuidelineProcessing({ processing_status: 'ready', processing_report: { requirements: 'many' } }).report).toBeUndefined()
  })

  it('says it is waiting or processing, with no actions yet', () => {
    for (const status of ['waiting', 'processing'] as const) {
      const html = render({ status })
      expect(html).toContain(text.status[status])
      expect(html).not.toContain(text.makeCurrent)
      expect(html).not.toContain(text.retry)
    }
  })

  it('shows the report, the warnings and Make Current when ready', () => {
    const html = render({ status: 'ready', report: { requirements: 1510, sections: 368, pages: 369, warnings: [], missingExcludedSections: ['III.B.4.1'] } })
    expect(html).toContain('1,510 requirements from 368 sections · 369 pages')
    expect(html).toContain('III.B.4.1')
    expect(html).toContain(`>${text.makeCurrent}<`)
  })

  it('shows the reason and Try Again when processing failed', () => {
    const html = render({ status: 'failed', error: 'No GVP requirements were found in this PDF.' })
    expect(html).toContain('No GVP requirements were found in this PDF.')
    expect(html).toContain(text.retry)
    expect(html).not.toContain(text.makeCurrent)
  })

  it('reads the progress only while processing', () => {
    expect(toGuidelineProcessing({ processing_status: 'processing', processing_progress: { stage: 'embedding', done: 45, total: 93 } }).progress)
      .toEqual({ stage: 'embedding', done: 45, total: 93 })
    expect(toGuidelineProcessing({ processing_status: 'ready', processing_progress: { stage: 'embedding', done: 93, total: 93 } }).progress).toBeUndefined()
    expect(toGuidelineProcessing({ processing_status: 'processing', processing_progress: { stage: 'other' } }).progress).toBeUndefined()
  })

  it('shows a labelled progress bar while embedding, and that the admin can keep working', () => {
    const html = render({ status: 'processing', progress: { stage: 'embedding', done: 45, total: 93 } })
    expect(html).toContain('Preparing requirements: 45 of 93 (48%)')
    expect(html).toMatch(/role="progressbar" aria-label="Processing progress" aria-valuemin="0" aria-valuemax="93" aria-valuenow="45"/)
    expect(html).toContain('width:48%')
    expect(html).toContain(text.keepWorking)
  })

  it('names the reading and saving stages, and says the admin can keep working while waiting', () => {
    expect(render({ status: 'processing', progress: { stage: 'reading', done: 0, total: 0 } })).toContain(text.progress.reading)
    expect(render({ status: 'processing', progress: { stage: 'saving', done: 0, total: 0 } })).toContain(text.progress.saving)
    expect(render({ status: 'waiting' })).toContain(text.keepWorking)
    expect(render({ status: 'ready', report: { requirements: 1, sections: 1, warnings: [], missingExcludedSections: [] } })).not.toContain(text.keepWorking)
  })
})

