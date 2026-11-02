import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { adminEn } from '../../content/admin.en'
import type { Department } from '../../data/mock/types'
import { DivisionField } from './DivisionField'

const content = adminEn.addUser.division
const plain: Department = { id: 'plain', name: 'Plain', initials: 'PL', description: '' }
const inDivision: Department = { ...plain, id: 'grouped', divisionId: 'Medical Division' }
const render = (department?: Department, error?: string) => renderToStaticMarkup(<DivisionField department={department} content={content} value="" error={error} onChange={() => {}} />)
const select = (html: string) => html.match(/<select[^>]*>/)![0]

describe('the Division field', () => {
  it('waits for a department', () => {
    const html = render()
    expect(select(html)).toContain('disabled=""')
    expect(select(html)).not.toContain('required=""')
    expect(html).toContain('>Select a department first<')
    expect(html).not.toContain('>*<')
  })

  it('stays disabled and optional for a department without a division', () => {
    const html = render(plain)
    expect(select(html)).toContain('disabled=""')
    expect(select(html)).not.toContain('required=""')
    expect(html).toContain('>No divisions available<')
    expect(html).not.toContain('>*<')
  })

  it('is required, and lists only that division, for a department with one', () => {
    const html = render(inDivision)
    expect(select(html)).not.toContain('disabled=""')
    expect(select(html)).toContain('required=""')
    expect(html).toContain('>Select a division<')
    expect(html.match(/<option value="Medical Division"/g)).toHaveLength(1)
    expect(html).toContain('>*<')
  })

  it('shows its error, linked to the field', () => {
    const html = render(inDivision, 'Select a division.')
    expect(html).toContain('Select a division.')
    expect(select(html)).toContain('aria-invalid="true"')
    expect(select(html)).toContain('aria-describedby=')
  })
})
