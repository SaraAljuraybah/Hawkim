import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { riyadhDate } from '../../lib/riyadhWorkingDays'
import { RegulationFormPage } from './RegulationFormPage'

vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ versions: [{ version: '4.0' }], current: { version: '4.0' }, addVersion: vi.fn() }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [] }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))

const html = renderToStaticMarkup(<MemoryRouter><RegulationFormPage /></MemoryRouter>)
const label = (text: string) => html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}(.*?)</label>`))!
const control = (id: string) => html.match(new RegExp(`<(?:input|textarea)[^>]*id="${id}"[^>]*>`))![0]

describe('Add GVP version', () => {
  it('asks for Title, Version, Issued by SFDA On, Added to Hawkim On, the Guideline File and Source, in this order', () => {
    const order = ['>Title', '>Version', '>Issued by SFDA On', '>Added to Hawkim On', '>Guideline File', '>Source']
    const positions = order.map((text) => html.indexOf(text))
    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it.each(['Title', 'Version', 'Added to Hawkim On', 'Source'])('marks %s as required, visibly and for screen readers', (text) => {
    const [, id, mark] = label(text)
    expect(mark).toContain('>*<')
    expect(control(id)).toContain('required=""')
  })

  it('marks the Guideline File as required, with text for screen readers', () => {
    const file = html.match(/<p id="[^"]+" class="[^"]*">Guideline File(.*?)<\/p>/)![1]
    expect(file).toContain('>*<')
    expect(file).toContain('<span class="sr-only"> (required)</span>')
  })

  it('keeps Issued by SFDA On optional, with no asterisk', () => {
    const [, id, mark] = label('Issued by SFDA On')
    expect(mark).not.toContain('>*<')
    expect(control(id)).not.toContain('required=""')
  })

  it('shows today in Riyadh as Added to Hawkim On, read-only, with no hint', () => {
    const [, id] = label('Added to Hawkim On')
    const input = control(id)
    expect(input).toContain('readOnly=""')
    expect(input).toContain('type="date"')
    expect(input).toContain(`value="${riyadhDate(new Date())}"`)
    expect(html).not.toContain('It can be in the future')
    expect(html).not.toContain('Effective Date')
  })

  it('takes the version from the admin, with no value filled in', () => {
    const [, id] = label('Version')
    expect(control(id)).toContain('value=""')
    expect(html).toContain('For example 4.1 or 5.0.')
  })

  it('asks for the Source as an https link and the Title as text, with placeholders and limits', () => {
    const source = control(label('Source')[1])
    expect(source).toContain('type="url"')
    expect(source).toContain('placeholder="https://www.sfda.gov.sa/..."')
    expect(source).toContain('maxLength="300"')
    const title = control(label('Title')[1])
    expect(title).toContain('placeholder="SFDA GVP Guideline"')
    expect(title).toContain('maxLength="100"')
  })

  it('has no Summary of Changes and no "(Optional)"', () => {
    expect(html).not.toContain('Summary of Changes')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('(Optional)')
  })
})
