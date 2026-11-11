import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TextAreaField } from './TextAreaField'

describe('TextAreaField', () => {
  it('shows a red asterisk hidden from screen readers when requiredMark is set', () => {
    const html = renderToStaticMarkup(<TextAreaField label="Justification" required requiredMark />)
    expect(html).toContain('<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>')
    expect(html).toContain('required=""')
  })

  it('shows the red asterisk on a required field by itself, and none on an optional one', () => {
    expect(renderToStaticMarkup(<TextAreaField label="Reason for Removing" required />))
      .toContain('Reason for Removing<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span></label>')
    expect(renderToStaticMarkup(<TextAreaField label="Reason for Removing" />)).not.toContain('*')
  })
})
