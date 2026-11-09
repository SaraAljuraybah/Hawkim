import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { systemEn } from './content/system.en'
import App from './App'

// No Supabase client is created and no network request is made: the configuration check and
// the session service are stand-ins.
const config = vi.hoisted(() => ({ problem: null as null | 'missing' | 'url-format' | 'secret-key' }))
vi.mock('./services/supabase', () => ({ get supabaseConfigProblem() { return config.problem }, supabase: () => { throw new Error('No client in tests') } }))
vi.mock('./services/auth', () => ({ restoreSession: () => new Promise(() => {}), onSignedOut: () => () => {}, signOut: async () => {}, signIn: vi.fn() }))

const render = (path: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

beforeEach(() => { config.problem = null })

describe('application entry point', () => {
  it('renders the sign-in page with real credentials and no demo-account notice', () => {
    const html = render('/login')
    expect(html).toContain('type="email"')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('hawkim.demo')
    expect(html).not.toContain('any non-empty demo password')
  })

  it('renders the public landing page', () => {
    const html = render('/')
    expect(html).toContain('Hawkim')
    expect(html).toContain('/login')
  })

  it.each(['missing', 'url-format', 'secret-key'] as const)('shows the not-configured screen instead of the app (%s)', (problem) => {
    config.problem = problem
    const html = render('/login')
    expect(html).toContain(systemEn.notConfigured.title.replaceAll("'", '&#x27;'))
    expect(html).not.toContain('type="password"')
  })
})
