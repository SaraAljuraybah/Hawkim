import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { OrganizationProfile } from '../../services/organizationProfile'
import { OrganizationProfilePage, ProfileForm, ProfileView } from './OrganizationProfilePage'

vi.mock('../../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => ({ id: 'super' }) }))
vi.mock('../../hooks/useSuperAdmin', () => ({ useSuperAdmin: () => ({ status: 'ready', superAdminId: 'super' }) }))

const saved: OrganizationProfile = {
  name: 'Riyadh Pharma', email: 'info@riyadh-pharma.test', description: 'Makes medicines.',
  address: 'King Fahd Road, Riyadh', mapsUrl: 'https://maps.google.com/?q=riyadh', website: 'https://riyadh-pharma.test',
}
const view = (profile = saved) => renderToStaticMarkup(<ProfileView profile={profile} />)
const form = (profile = saved) => renderToStaticMarkup(<MemoryRouter><ProfileForm initial={profile} onSaved={() => {}} onCancel={() => {}} /></MemoryRouter>)

describe('Organization Profile', () => {
  it('is a page with one h1, loading the saved profile from the database', () => {
    const html = renderToStaticMarkup(<MemoryRouter><OrganizationProfilePage /></MemoryRouter>)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('>Organization Profile</h1>')
    expect(html).toContain('Loading the organization profile…')
  })

  it('shows all six values, the email with its copy button and the links opening in a new tab', () => {
    const html = view()
    for (const label of ['Organization Name', 'Organization Email', 'Description', 'Address', 'Google Maps Link', 'Website']) {
      expect(html).toContain(`>${label}</dt>`)
    }
    for (const value of Object.values(saved)) expect(html).toContain(value)
    expect(html).toContain('aria-label="Copy the organization’s email"')
    expect(html).toMatch(/<a href="https:\/\/maps\.google\.com\/\?q=riyadh" target="_blank" rel="noopener noreferrer" aria-label="Google Maps Link \(opens in a new tab\)"/)
    expect(html).toMatch(/<a href="https:\/\/riyadh-pharma\.test" target="_blank" rel="noopener noreferrer"/)
  })

  it('puts the Address and the Google Maps Link side by side in ONE Address box (stacked on phones)', () => {
    const html = view()
    const box = html.match(/<dl class="grid gap-4 rounded-lg border border-beige p-4 sm:grid-cols-2">(.*?)<\/dl>/)![1]
    expect([...box.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(['Address', 'Google Maps Link'])
    expect(box).toContain('King Fahd Road, Riyadh')
    expect(box).toContain('https://maps.google.com/?q=riyadh')
    // Two separate values, not one combined text.
    expect(box).not.toContain('King Fahd Road, Riyadh https://')
  })

  it('shows Not set for values that were never saved, never invented ones', () => {
    const html = view({ ...saved, email: '', address: '', mapsUrl: '', website: '' })
    expect(html.match(/>Not set</g)).toHaveLength(4)
    expect(html).not.toContain('<a href')
  })

  it('edits the six values with their saved values, each required with the red asterisk', () => {
    const html = form()
    for (const [name, value] of [['name', saved.name], ['email', saved.email], ['address', saved.address], ['mapsUrl', saved.mapsUrl], ['website', saved.website]]) {
      const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]
      expect(input).toContain('required=""')
      expect(input).toContain(`value="${value}"`)
    }
    const description = html.match(/<textarea[^>]*name="description"[^>]*>[^<]*<\/textarea>/)![0]
    expect(description).toContain('required=""')
    expect(description).toContain('>Makes medicines.</textarea>')
    // One asterisk per field, after its label.
    expect(html.match(/<span aria-hidden="true" class="ml-0\.5 text-status-rejected-fg">\*<\/span>/g)).toHaveLength(6)
    expect(html).toContain('type="email"')
    expect(html.match(/type="url"/g)).toHaveLength(2)
  })

  it('keeps the Address and the Google Maps Link as two inputs in one Address box in the form too', () => {
    const html = form()
    const box = html.match(/<fieldset class="rounded-lg border border-beige p-4"><legend[^>]*>Address<\/legend><div class="grid gap-4 sm:grid-cols-2">(.*?)<\/fieldset>/)![1]
    expect([...box.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1])).toEqual(['address', 'mapsUrl'])
  })

  it('ends with Cancel and Save Changes', () => {
    const html = form()
    expect(html.indexOf('>Cancel</button>')).toBeLessThan(html.indexOf('>Save Changes</button>'))
    expect(html).toMatch(/<button type="submit"[^>]*>Save Changes<\/button>/)
  })
})
