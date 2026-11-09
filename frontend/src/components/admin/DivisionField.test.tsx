import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { adminEn } from '../../content/admin.en'
import type { Department } from '../../data/mock/types'
import { NO_DIVISION } from '../../lib/userAdmin'
import { DivisionField } from './DivisionField'

const content = adminEn.addUser.division
const plain: Department = { id: 'plain', name: 'Plain', initials: 'PL', description: '' }
const medical: Department = { ...plain, id: 'grouped', divisionId: 'Medical Division' }
const render = (departments: Department[], value = '', error?: string) =>
  renderToStaticMarkup(<DivisionField departments={departments} content={content} value={value} error={error} onChange={() => {}} />)
const input = (html: string) => html.match(/<input[^>]*>/)![0]
const options = (html: string) => [...html.matchAll(/<li[^>]*role="option"[^>]*>(.*?)<\/li>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''))

describe('the Division field', () => {
  it('is a required, searchable combobox', () => {
    const html = render([medical, plain])
    expect(input(html)).toContain('role="combobox"')
    expect(input(html)).toContain('aria-autocomplete="list"')
    expect(input(html)).toContain('required=""')
    expect(input(html)).not.toContain('disabled=""')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('>*<')
  })

  it('lists each division, then No Division for departments without one', () => {
    expect(options(render([plain, medical, { ...medical, id: 'other' }]))).toEqual(['Medical Division', 'No Division'])
    expect(options(render([medical]))).toEqual(['Medical Division'])
  })

  it('shows the chosen division by name', () => {
    expect(input(render([plain], NO_DIVISION))).toContain('value="No Division"')
    expect(input(render([medical, plain], 'Medical Division'))).toContain('value="Medical Division"')
  })

  it('shows its error, linked to the field', () => {
    const html = render([medical], '', 'Select a division from the list.')
    expect(html).toContain('Select a division from the list.')
    expect(input(html)).toContain('aria-invalid="true"')
    const errorId = html.match(/<p id="([^"]+)"[^>]*>.*?Select a division from the list\./)![1]
    expect(input(html)).toContain(`aria-describedby="${errorId}"`)
  })
})
