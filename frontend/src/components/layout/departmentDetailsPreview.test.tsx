import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DepartmentDetailsPreview, type DepartmentDetailsPreviewDepartment } from './DepartmentDetailsPreview'

/* A department's read-only details pop-up on Organizational Structure (staff and admins see the same). */

const quality: DepartmentDetailsPreviewDepartment = {
  name: 'Quality', divisionName: 'Operations', description: 'Keeps quality high.', email: 'quality@test.invalid',
}
const render = (department = quality) => renderToStaticMarkup(<DepartmentDetailsPreview department={department} onClose={() => {}} />)
const rows = (html: string) => [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map((match) => [match[1], match[2]])

describe('the department details pop-up', () => {
  it('is titled with the department name and shows its division, description and email, like the admin preview', () => {
    const html = render()
    expect(html).toMatch(/<h2[^>]*>Quality<\/h2>/)
    expect(rows(html).map(([label]) => label)).toEqual(['Division', 'Description', 'Email'])
    expect(html).toContain('>Operations<')
    expect(html).toContain('Keeps quality high.')
    expect(html).toContain('quality@test.invalid')
    expect(html).toContain('aria-label="Copy email for Quality"')
  })

  it('says "Not set" for what the department doesn’t have', () => {
    const html = render({ name: 'Legacy', divisionName: undefined, description: '  ', email: null })
    expect(rows(html).map(([, value]) => value)).toEqual(['Not set', 'Not set', 'Not set'])
  })

  it('is read-only: Close is its only action', () => {
    const html = render()
    const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[0])
    for (const label of ['Edit', 'Delete', 'Add', 'Save']) expect(html).not.toMatch(new RegExp(`>${label}[^<]*</button>`))
    expect(buttons.some((button) => button.includes('>Close</button>'))).toBe(true)
  })
})
