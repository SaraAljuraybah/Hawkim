import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProcessingStatusBadge } from './ProcessingStatusBadge'

describe('the processing status label', () => {
  it('is yellow while waiting, blue while processing, green when ready and red when failed, always with its text', () => {
    const html = (status: Parameters<typeof ProcessingStatusBadge>[0]['status']) => renderToStaticMarkup(<ProcessingStatusBadge status={status} />)
    expect(html('waiting')).toMatch(/bg-status-pending-bg text-status-pending-fg[^>]*>Waiting</)
    expect(html('processing')).toMatch(/bg-status-processing-bg text-status-processing-fg[^>]*>Processing…</)
    expect(html('ready')).toMatch(/bg-status-approved-bg text-status-approved-fg[^>]*>Ready</)
    expect(html('failed')).toMatch(/bg-status-rejected-bg text-status-rejected-fg[^>]*>Failed</)
  })
})
