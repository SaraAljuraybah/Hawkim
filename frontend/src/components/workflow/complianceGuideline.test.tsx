import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ComplianceGuideline } from './ComplianceGuideline'

vi.mock('../../state/guidelinesContext', () => ({
  useGuidelines: () => ({
    current: { id: 'gvp-4-0', title: 'SFDA GVP Guideline', version: '4.0', issuedDate: '2026-01-01', addedAt: '2026-02-03T10:00:00Z' },
  }),
}))

const render = () => renderToStaticMarkup(<MemoryRouter><ComplianceGuideline sopId="sop-1" /></MemoryRouter>)

describe('the Compliance Overview guideline card', () => {
  it('has a small "Preview" label above the eye, styled like the SOP History table’s action headings', () => {
    const html = render()
    expect(html).toMatch(
      /<div class="flex shrink-0 flex-col items-center gap-1"><span aria-hidden="true" class="text-sm font-medium text-text-gray">Preview<\/span><span class="relative inline-flex"><button[^>]*><svg[^>]*lucide-eye/,
    )
  })

  it('keeps the button’s own name, tooltip and behaviour (the label is only a visual heading)', () => {
    const html = render()
    expect(html).toContain('aria-label="View SFDA GVP Guideline v4.0"')
    expect(html).toMatch(/role="tooltip"[^>]*><span[^>]*>View SFDA GVP Guideline v4\.0<\/span>/)
    expect(html.match(/<button/g)).toHaveLength(1)
  })
})
