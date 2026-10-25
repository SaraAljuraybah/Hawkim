import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tooltip } from './Tooltip'

const trigger = (tooltipId: string) => <button type="button" aria-disabled="true" aria-describedby={tooltipId}>Submit for approval</button>

describe('Tooltip', () => {
  it('keeps a plain text tooltip hidden until opened, linked to its trigger', () => {
    const html = renderToStaticMarkup(<Tooltip text="Not available now">{trigger}</Tooltip>)
    const id = html.match(/aria-describedby="([^"]+)"/)![1]
    expect(html).toMatch(new RegExp(`<span id="${id}" role="tooltip" hidden=""[^>]*max-w-\\[15rem\\]`))
    expect(html).toContain('>Not available now<')
  })
  it('takes content such as a heading and lines, with room for a few lines', () => {
    const html = renderToStaticMarkup(
      <Tooltip openOnTap wide text={<><span className="block">You can't submit for approval yet:</span><span className="block">No approver is assigned.</span></>}>{trigger}</Tooltip>)
    expect(html).toContain('max-w-[min(20rem,calc(100vw-2rem))]')
    expect(html).toContain('<span class="block">You can&#x27;t submit for approval yet:</span><span class="block">No approver is assigned.</span>')
    expect(html).toContain('role="tooltip" hidden=""')
  })
})
