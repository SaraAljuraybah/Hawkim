import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { RegulationFormPage } from './RegulationFormPage'

vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' }, addVersion: vi.fn() }) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: [] }) }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'admin' }) }))

const html = renderToStaticMarkup(<MemoryRouter><RegulationFormPage /></MemoryRouter>)
const label = (text: string) => html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}(.*?)</label>`))!
const control = (id: string) => html.match(new RegExp(`<(?:input|textarea)[^>]*id="${id}"[^>]*>`))![0]

describe('Add GVP version', () => {
  it.each(['Version', 'Effective Date'])('marks %s as required, visibly and for screen readers', (text) => {
    const [, id, mark] = label(text)
    expect(mark).toContain('>*<')
    expect(control(id)).toContain('required=""')
  })

  it('marks the Guideline File as required, with text for screen readers', () => {
    const file = html.match(/<p id="[^"]+" class="[^"]*">Guideline File(.*?)<\/p>/)![1]
    expect(file).toContain('>*<')
    expect(file).toContain('<span class="sr-only"> (required)</span>')
  })

  it.each(['Issued Date', 'Summary of Changes'])('keeps %s optional, with no asterisk and no "(Optional)"', (text) => {
    const [, id, mark] = label(text)
    expect(mark).not.toContain('>*<')
    expect(control(id)).not.toContain('required=""')
  })

  it('removes "(Optional)" and keeps the hints', () => {
    expect(html).not.toContain('(Optional)')
    expect(html).toContain('For example 4.1 or 5.0.')
  })
})
