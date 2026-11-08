import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DepartmentPreview } from './DepartmentPreview'
import { DivisionPreview } from './DivisionDialogs'
import type { ManagedDepartment } from '../../services/organizationAdmin'

const department: ManagedDepartment = {
  id: 'qa', name: 'Quality Assurance', initials: 'QA', description: 'Audits and CAPA', email: 'qa@test.invalid',
  division_id: 'quality', updated_at: 'r1', people: [], employees: 0, sops: 0, status_counts: {},
}
const markup = (change: Partial<ManagedDepartment> = {}, divisionName: string | undefined = 'Quality Division') =>
  renderToStaticMarkup(<DepartmentPreview department={{ ...department, ...change }} divisionName={divisionName} onClose={vi.fn()} />)
const terms = (html: string) => html.match(/<dt[^>]*>([^<]*)<\/dt>/g)!.map((tag) => tag.replace(/<[^>]+>/g, ''))

describe('department details dialog', () => {
  it('has the department name as its title, then Division, Description and Email', () => {
    const html = markup()
    expect(html).toMatch(/<h2[^>]*>Quality Assurance<\/h2>/)
    expect(terms(html)).toEqual(['Division', 'Description', 'Email'])
    expect(html).toMatch(/>Division<\/dt><dd class="mt-1 break-words text-black">Quality Division</)
    expect(html).toMatch(/>Description<\/dt><dd class="mt-1 break-words text-black">Audits and CAPA</)
  })

  it('shows the email with the same copy button as the division dialog', () => {
    const html = markup()
    expect(html).toMatch(/>qa@test.invalid<\/span><span class="contents"><span class="inline-flex shrink-0">(?:<span[^>]*>)?<button[^>]*aria-label="Copy email"/)
  })

  it('says No email recorded. (muted) without a copy button when there is no email', () => {
    for (const email of [null, undefined, '']) {
      const html = markup({ email })
      expect(html).toMatch(/>Email<\/dt><dd class="mt-1 text-text-gray">No email recorded.</)
      expect(html).not.toContain('Copy email')
    }
  })

  it('says Not provided. (muted) when the description is empty', () => {
    for (const description of ['', '   ']) {
      expect(markup({ description })).toMatch(/>Description<\/dt><dd class="mt-1 text-text-gray">Not provided.</)
    }
  })

  it('says No division (muted) for a legacy department without one', () => {
    const html = renderToStaticMarkup(<DepartmentPreview department={{ ...department, division_id: null }} onClose={vi.fn()} />)
    expect(html).toMatch(/>Division<\/dt><dd class="mt-1 text-text-gray">No division</)
  })

  it('has only a Close button, in the same footer as the division dialog, and no Edit button', () => {
    const html = markup()
    const footer = (page: string) => page.match(/<div class="mt-6 flex[^"]*">[\s\S]*?<\/div>/)![0]
    expect(footer(html)).toMatch(/>Close<\/button>/)
    expect(html).not.toMatch(/>Edit</)
    expect(html).not.toContain('>Cancel<')
    const division = renderToStaticMarkup(<DivisionPreview division={{ id: 'v', name: 'V', description: '', email: null, updated_at: null }} onEdit={vi.fn()} onClose={vi.fn()} />)
    expect(footer(html)).toBe(footer(division))
  })
})
