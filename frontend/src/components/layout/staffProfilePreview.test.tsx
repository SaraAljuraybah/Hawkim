import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaffProfilePreview } from './StaffProfilePreview'

const preview = (overrides = {}) => ({
  person: { id: 'dana', name: 'Dana Fahad', initials: 'DF', email: 'dana@test.invalid', permissions: ['author', 'reviewer'] as const, position: 'Specialist', phone: '+966512345678' },
  departmentName: 'Quality',
  divisionName: 'Operations',
  ...overrides,
})
const render = (value = preview()) => renderToStaticMarkup(
  <StaffProfilePreview preview={{ ...value, person: { ...value.person, permissions: [...value.person.permissions] } }} onClose={() => {}} />,
)
const row = (html: string, label: string) => html.slice(html.indexOf(`>${label}</dt>`), html.indexOf('</dd>', html.indexOf(`>${label}</dt>`)))

describe('Staff Profile Preview (Organizational Structure)', () => {
  it('opens as the shared dialog, titled with the selected person, with Close', () => {
    const html = render()
    expect(html).toMatch(/^<dialog aria-labelledby="[^"]+"/)
    expect(html).toContain('>Dana Fahad</h2>')
    expect(html).toContain('>Close</button>')
  })

  it("shows the person's details as on a staff member's page, the email with its copy button", () => {
    const html = render()
    expect([...html.matchAll(/<dt class="text-sm font-bold text-maroon">([^<]+)<\/dt>/g)].map((match) => match[1]))
      .toEqual(['Email', 'Phone Number', 'Position', 'Division', 'Department', 'Permission'])
    expect(row(html, 'Email')).toContain('dana@test.invalid')
    expect(row(html, 'Email')).toContain('aria-label="Copy email for Dana Fahad"')
    expect(row(html, 'Phone Number')).toContain('+966512345678')
    expect(row(html, 'Position')).toContain('Specialist')
    expect(row(html, 'Division')).toContain('Operations')
    expect(row(html, 'Department')).toContain('Quality')
  })

  it('shows the permissions once, as the gold badges used everywhere', () => {
    const html = render()
    const badges = [...html.matchAll(/<li class="([^"]*)">([^<]+)<\/li>/g)]
    expect(badges.map((match) => match[2])).toEqual(['Author', 'Reviewer'])
    for (const [, className] of badges) expect(className).toContain('bg-gold-light')
  })

  it('shows another person when another name is chosen', () => {
    const html = render(preview({ person: { id: 'omar', name: 'Omar Saad', initials: 'OS', email: 'omar@test.invalid', permissions: ['approver'] as const } }))
    expect(html).toContain('>Omar Saad</h2>')
    expect(html).toContain('omar@test.invalid')
    expect(html).not.toContain('Dana Fahad')
  })

  it('shows the phone number from the profile, in the same row layout, and no account details', () => {
    const html = render()
    expect(html).toMatch(/<dt class="text-sm font-bold text-maroon">Phone Number<\/dt><dd[^>]*>\+966512345678<\/dd>/)
    expect(html.match(/\+966512345678/g)).toHaveLength(1)
    expect(html).not.toMatch(/Password|Last sign/i)
  })

  it('says Not set for what the person has none of (no division, position or permission)', () => {
    const html = render(preview({ divisionName: undefined, person: { id: 'x', name: 'X', initials: 'X', email: 'x@test.invalid', permissions: [] as const } }))
    for (const label of ['Phone Number', 'Position', 'Division', 'Permission']) expect(row(html, label)).toContain('Not set')
  })
})
