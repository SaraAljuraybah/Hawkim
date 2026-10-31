import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TextField } from './TextField'

describe('TextField', () => {
  it('shows a red asterisk hidden from screen readers when requiredMark is set', () => {
    const html = renderToStaticMarkup(<TextField label="Title" required requiredMark />)
    expect(html).toContain('<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>')
    expect(html).toContain('required=""')
  })

  it('shows no asterisk by default, even on a required field', () => {
    const html = renderToStaticMarkup(<TextField label="Title" required />)
    expect(html).not.toContain('*')
  })

  it('shows the counter and links it to the input', () => {
    const html = renderToStaticMarkup(<TextField id="title" label="Title" counter="0 / 50" />)
    expect(html).toContain('<p id="title-counter" class="shrink-0 text-sm text-text-gray tabular-nums">0 / 50</p>')
    expect(html).toContain('aria-describedby="title-counter"')
  })

  it('keeps the counter next to an error and describes the input with both', () => {
    const html = renderToStaticMarkup(<TextField id="title" label="Title" counter="0 / 50" error="Enter a title." />)
    expect(html).toContain('Enter a title.')
    expect(html).toContain('0 / 50')
    expect(html).toContain('aria-describedby="title-error title-counter"')
  })
})
