import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { profileEn } from '../../content/profile.en'
import { ChangePasswordDialog } from './ChangePasswordDialog'

const render = () => renderToStaticMarkup(<ChangePasswordDialog open content={profileEn.password.dialog} onClose={() => {}} onChanged={() => {}} />)
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]

describe('Change Password dialog', () => {
  it('shows a centred key icon in a beige circle and the title, with no subtitle', () => {
    const html = render()
    const circle = html.match(/<div aria-hidden="true" class="([^"]*)">(<svg[^>]*>)/)!
    expect(circle[1]).toContain('rounded-full bg-beige text-maroon')
    expect(circle[1]).toContain('mx-auto')
    expect(circle[2]).toContain('lucide-key-round')
    expect(html).toMatch(/<h2[^>]*class="[^"]*text-center[^"]*">Change Password<\/h2>/)
    expect(html).not.toContain('Enter your current and new password')
    expect(html).not.toMatch(/<dialog[^>]*aria-describedby/)
  })

  it('has three required password fields with an eye button, no lock icon, and the right autocomplete', () => {
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
      expect(field).not.toContain('pl-10')
      const id = field.match(/id="([^"]+)"/)![1]
      // Required: the red asterisk after the label.
      expect(html).toContain(`<label for="${id}" class="mb-1.5 block text-sm font-medium text-maroon">${label}<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span></label>`)
      expect(html).toContain(`aria-label="Show password" aria-controls="${id}"`)
    }
    expect(html).not.toContain('lucide-lock')
    expect(html).toContain('>At least 6 characters.<')
  })

  it('offers Cancel, Save and a × close button, with an alert area for failures that adds space above the buttons', () => {
    const html = render()
    expect(html).toMatch(/<button type="button" class="[^"]*">Cancel<\/button>/)
    expect(html).toMatch(/<button type="submit" class="[^"]*bg-maroon[^"]*">Save<\/button>/)
    expect(html).toContain('aria-label="Close"')
    // The alert area is the last child, so the last field keeps its bottom margin above it.
    expect(html).toMatch(/name="confirmPassword"[\s\S]*<\/div><div role="alert" tabindex="-1" class="[^"]*"><\/div><\/div><div class="mt-6 flex/)
    expect(html).not.toContain('isn’t connected yet')
  })
})
