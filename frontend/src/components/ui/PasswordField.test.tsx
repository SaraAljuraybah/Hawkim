import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PasswordField } from './PasswordField'

const render = () => renderToStaticMarkup(<PasswordField label="Password" showLabel="Show password" hideLabel="Hide password" />)

describe('PasswordField', () => {
  it('shows the current state while hidden: dots and a crossed-out eye, named Show password', () => {
    const html = render()
    expect(html).toContain('type="password"')
    const toggle = html.match(/<button[^>]*aria-label="([^"]+)"[^>]*>(<svg[^>]*>)/)!
    expect(toggle[1]).toBe('Show password')
    expect(toggle[2]).toContain('lucide-eye-off')
    expect(html).not.toContain('aria-pressed')
    expect(html).not.toContain('lucide-lock')
  })
})
