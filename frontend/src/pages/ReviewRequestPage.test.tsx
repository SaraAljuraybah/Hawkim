import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { reviewRequestEn } from '../content/accessRequest.en'
import { decideAccessRequest, viewAccessRequest } from '../services/accessRequests'
import { ReviewRequestPage } from './ReviewRequestPage'

vi.mock('../services/accessRequests', () => ({ viewAccessRequest: vi.fn(() => new Promise(() => {})), decideAccessRequest: vi.fn() }))

describe('Review request page', () => {
  it('only loads the request when opened; nothing is accepted or rejected by opening the link', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/review-request?id=abc&token=def']}><ReviewRequestPage /></MemoryRouter>)
    expect(html).toContain(reviewRequestEn.loading)
    expect(decideAccessRequest).not.toHaveBeenCalled()
    expect(viewAccessRequest).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'accept')
  })

  it('explains what accepting does and every outcome has text', () => {
    expect(reviewRequestEn.text).toMatch(/Admin/)
    expect(reviewRequestEn.accepted.text).toContain('{email}')
    expect(reviewRequestEn.accepted.emailFailed).toContain('Forgot password')
    expect(reviewRequestEn.rejected.text).toContain('{email}')
  })
})
