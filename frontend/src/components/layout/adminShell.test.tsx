import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { ADMIN_HOME_PATH } from '../../lib/routes'
import { Sidebar } from './Sidebar'
import appSource from '../../App.tsx?raw'
import signInSource from '../../pages/SignInPage.tsx?raw'

vi.mock('../../state/sessionContext', () => ({ useSession: () => ({ signOut: () => {} }) }))

describe('the admin portal sidebar', () => {
  it('lists the tabs in this order, with their names and icons unchanged', () => {
    expect(adminEn.shell.nav.map(({ label, href, icon }) => [label, href, icon])).toEqual([
      ['Divisions & Departments', '/admin/departments', 'departments'],
      ['Users', '/admin/users', 'employees'],
      ['SFDA Regulatory Requirements', '/admin/regulations', 'regulatory'],
      ['Requests', '/admin/requests', 'requests'],
      ['SOP Directory', '/admin/sops', 'sops'],
      ['Organizational Structure', '/admin/organizational-structure', 'hierarchy'],
    ])
  })

  it('shows them in that order', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/users']}><Sidebar content={adminEn.shell} /></MemoryRouter>)
    const labels = [...html.matchAll(/<a[^>]*href="\/admin\/[^"]*"[^>]*>(?:<span[^>]*><\/span>)?<svg.*?<\/svg>([^<]+)/g)].map((match) => match[1].replace(/&amp;/g, '&'))
    expect(labels).toEqual(adminEn.shell.nav.map((item) => item.label))
  })

  it('takes the logo to Divisions & Departments, named for it', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Sidebar content={adminEn.shell} /></MemoryRouter>)
    const logo = html.match(/<a[^>]*aria-label="Hawkim admin, go to Divisions &amp; Departments"[^>]*>/)![0]
    expect(logo).toContain('href="/admin/departments"')
  })
})

describe('where an admin lands', () => {
  it('is Divisions & Departments', () => {
    expect(ADMIN_HOME_PATH).toBe('/admin/departments')
    expect(adminEn.shell.homeHref).toBe(ADMIN_HOME_PATH)
  })

  it('after signing in (via /admin) and when opening /admin', () => {
    expect(signInSource).toContain("const ADMIN_AFTER_SIGN_IN_PATH = '/admin'")
    expect(appSource).toContain('<Route index element={<Navigate to={ADMIN_HOME_PATH} replace />} />')
  })
})
