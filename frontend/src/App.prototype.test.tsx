import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

// Any accidental static or dynamic client import fails this entry-point regression
// immediately. No connection, credentials, SQL or experimental service is exercised.
vi.mock('./services/supabase', () => { throw new Error('Frontend prototype must not load a Supabase client') })

describe('frontend-only application entry point', () => {
  it('renders the existing sign-in page and an explicit local-demo notice without backend configuration', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>)
    expect(html).toContain('Local frontend prototype')
    expect(html).toContain('sara.aljuraybah@hawkim.demo')
    expect(html).toContain('type="email"')
    expect(html).not.toContain('VITE_SUPABASE')
  })

  it('renders the public landing page without importing the experimental client', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(html).toContain('Hawkim')
    expect(html).toContain('/login')
  })
})
