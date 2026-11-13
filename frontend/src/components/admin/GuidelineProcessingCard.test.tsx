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
    expect(toGuidelineProcessing({ processing_status: 'processing', progress_percent: 28, stage: 'Preparing requirements', stage_detail: 'batch 32 of 186' }).progress)
      .toEqual({ percent: 28, stage: 'Preparing requirements', detail: 'batch 32 of 186' })
    expect(toGuidelineProcessing({ processing_status: 'processing', progress_percent: null, stage: 'Reading the PDF', stage_detail: null }).progress)
      .toEqual({ percent: 0, stage: 'Reading the PDF' })
    expect(toGuidelineProcessing({ processing_status: 'ready', progress_percent: 100, stage: 'Saving the requirements' }).progress).toBeUndefined()
  })

  it('shows one labelled progress bar across the stages, and that the admin can keep working', () => {
    const html = render({ status: 'processing', progress: { percent: 28, stage: 'Preparing requirements', detail: 'batch 32 of 186' } })
    expect(html).toContain('Preparing requirements: batch 32 of 186 (28%)')
    expect(html).toMatch(/role="progressbar" aria-label="Processing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="28"/)
    expect(html).toContain('width:28%')
    expect(html).toContain(text.keepWorking)
    expect(render({ status: 'processing', progress: { percent: 4, stage: 'Reading the PDF', detail: 'page 15 of 368' } }))
      .toContain('Reading the PDF: page 15 of 368 (4%)')
  })

  it('shows the bar at 0% while processing before any progress, and no bar while waiting', () => {
    const html = render({ status: 'processing' })
    expect(html).toContain(`${text.progress.starting} (0%)`)
    expect(html).toContain('aria-valuenow="0"')
    expect(render({ status: 'waiting' })).not.toContain('progressbar')
    expect(render({ status: 'waiting' })).toContain(text.keepWorking)
    expect(render({ status: 'ready', report: { requirements: 1, sections: 1, warnings: [], missingExcludedSections: [] } })).not.toContain(text.keepWorking)
  })
})

