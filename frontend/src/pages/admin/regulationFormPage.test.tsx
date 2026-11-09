import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { riyadhDate } from '../../lib/riyadhWorkingDays'
import { RegulationFormPage } from './RegulationFormPage'

vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ allVersions: [{ version: '4.0' }], current: { version: '4.0' }, addVersion: vi.fn() }) }))

const html = renderToStaticMarkup(<MemoryRouter><RegulationFormPage /></MemoryRouter>)
const label = (text: string) => html.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}(.*?)</label>`))!
const control = (id: string) => html.match(new RegExp(`<(?:input|textarea)[^>]*id="${id}"[^>]*>`))![0]

describe('Add GVP version', () => {
  it('asks for Title, Version, Issued by SFDA On, Added to Hawkim On, File and Source, in this order', () => {
    const order = ['>Title', '>Version', '>Issued by SFDA On', '>Added to Hawkim On', '>File<', '>Source']
    const positions = order.map((text) => html.indexOf(text))
    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it.each(['Title', 'Version', 'Issued by SFDA On', 'Added to Hawkim On', 'Source'])('marks %s as required, visibly and for screen readers', (text) => {
    const [, id, mark] = label(text)
    expect(mark).toContain('>*<')
    expect(control(id)).toContain('required=""')
  })

  it('calls the file field File and marks it required, with text for screen readers', () => {
    expect(html).not.toContain('Guideline File')
    const file = html.match(/<p id="[^"]+" class="[^"]*">File(.*?)<\/p>/)![1]
    expect(file).toContain('>*<')
    expect(file).toContain('<span class="sr-only"> (required)</span>')
  })

  it('asks for the SFDA issue date with its own error, no later than the added date', () => {
    const [, id] = label('Issued by SFDA On')
    expect(control(id)).toContain(`max="${riyadhDate(new Date())}"`)
    expect(adminEn.regulationForm.errors.issuedRequired).toBe('Enter the date SFDA issued this version.')
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

  it('asks for the Source as an https link with a placeholder, and the Title as empty text with no placeholder', () => {
    const source = control(label('Source')[1])
    expect(source).toContain('type="url"')
    expect(source).toContain('placeholder="https://www.sfda.gov.sa/..."')
    expect(source).toContain('maxLength="300"')
    const title = control(label('Title')[1])
    expect(title).not.toContain('placeholder=')
    expect(title).toContain('value=""')
    expect(html).not.toContain('SFDA GVP Guideline')
    expect(title).toContain('maxLength="100"')
  })

  it('says what it does, without the word "draft", and that the PDF can\'t be changed later', () => {
    const text = adminEn.regulationForm
    expect(html).toContain('>Add a new version of the SFDA GVP guideline.</p>')
    expect(text.dialog.title).toBe('Add GVP Version {version}?')
    expect(text.dialog.description).toBe('You can change its title, version number, source and issue date later. To change the PDF, delete the version and add it again.')
    expect(text.dialog.confirm).toBe('Add Version')
    expect(adminEn.regulations.added).toBe('GVP version {version} added.')
    expect(JSON.stringify({ text, list: adminEn.regulations, details: adminEn.regulationDetails })).not.toMatch(/draft/i)
  })

  it('has no Summary of Changes and no "(Optional)"', () => {
    expect(html).not.toContain('Summary of Changes')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('(Optional)')
  })
})
