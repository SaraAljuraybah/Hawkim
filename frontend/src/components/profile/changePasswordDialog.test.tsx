import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { profileEn } from '../../content/profile.en'
import { ChangePasswordDialog } from './ChangePasswordDialog'

const render = () => renderToStaticMarkup(<ChangePasswordDialog open content={profileEn.password.dialog} onClose={() => {}} />)
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]

describe('Change Password dialog', () => {
  it('shows a centred key icon in a beige circle, the title and the subtitle', () => {
    const html = render()
    const circle = html.match(/<div aria-hidden="true" class="([^"]*)">(<svg[^>]*>)/)!
    expect(circle[1]).toContain('rounded-full bg-beige text-maroon')
    expect(circle[1]).toContain('mx-auto')
    expect(circle[2]).toContain('lucide-key-round')
    expect(html).toMatch(/<h2[^>]*class="[^"]*text-center[^"]*">Change Password<\/h2>/)
    expect(html).toContain('>Enter your current and new password.<')
  })

  it('has three required password fields with a lock icon, an eye button and the right autocomplete', () => {
    const html = render()
    for (const [name, label, autocomplete] of [
      ['currentPassword', 'Current Password', 'current-password'],
      ['newPassword', 'New Password', 'new-password'],
      ['confirmPassword', 'Confirm New Password', 'new-password'],
    ]) {
      const field = input(html, name)
      expect(field).toContain('type="password"')
      expect(field).toMatch(new RegExp(`autocomplete="${autocomplete}"`, 'i'))
      expect(field).toContain('required=""')
      expect(field).toContain('pl-10')
      const id = field.match(/id="([^"]+)"/)![1]
      expect(html).toContain(`<label for="${id}" class="mb-1.5 block text-sm font-medium text-maroon">${label}</label>`)
      expect(html).toContain(`aria-label="Show password" aria-controls="${id}"`)
    }
    expect(html.match(/lucide-lock/g)).toHaveLength(3)
    expect(html).toContain('>At least 6 characters.<')
  })

  it('offers Cancel, Save and a × close button, with a status area for the not-connected message', () => {
    const html = render()
    expect(html).toMatch(/<button type="button" class="[^"]*">Cancel<\/button>/)
    expect(html).toMatch(/<button type="submit" class="[^"]*bg-maroon[^"]*">Save<\/button>/)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('<div role="status" class="empty:-mt-5"></div>')
    expect(html).not.toContain('isn’t connected yet')
  })
})
