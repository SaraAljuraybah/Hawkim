import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PasswordField } from './PasswordField'

const render = (lockIcon?: boolean) =>
  renderToStaticMarkup(<PasswordField label="Password" showLabel="Show password" hideLabel="Hide password" lockIcon={lockIcon} />)

describe('PasswordField', () => {
  it('shows the current state while hidden: dots and a crossed-out eye, named Show password', () => {
    const html = render()
    expect(html).toContain('type="password"')
    const toggle = html.match(/<button[^>]*aria-label="([^"]+)"[^>]*>(<svg[^>]*>)/)!
    expect(toggle[1]).toBe('Show password')
    expect(toggle[2]).toContain('lucide-eye-off')
    expect(html).not.toContain('aria-pressed')
  })

  it('has no lock icon unless asked for', () => {
    expect(render()).not.toContain('lucide-lock')
    expect(render()).not.toContain('pl-10')
    const html = render(true)
    expect(html.match(/<svg[^>]*>/)![0]).toContain('lucide-lock')
    expect(html.match(/<svg[^>]*>/)![0]).toContain('aria-hidden="true"')
    expect(html).toContain('pl-10')
  })
})
