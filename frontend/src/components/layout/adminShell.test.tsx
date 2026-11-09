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
      ['Staff', '/admin/users', 'employees'],
      ['SFDA Regulatory Requirements', '/admin/regulations', 'regulatory'],
      ['Organizational Structure', '/admin/organizational-structure', 'hierarchy'],
      ['SOP Directory', '/admin/sops', 'sops'],
      ['Requests', '/admin/requests', 'requests'],
    ])
  })

  it('has no duplicate tabs', () => {
    const hrefs = adminEn.shell.nav.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(new Set(adminEn.shell.nav.map((item) => item.label)).size).toBe(hrefs.length)
  })

  it.each(adminEn.shell.nav.map((item) => [item.label, item.href]))('highlights only %s on its page and its subpages', (_, href) => {
    for (const path of [href, `${href}/x`]) {
      const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Sidebar content={adminEn.shell} /></MemoryRouter>)
      const current = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>/g)].map((match) => match[0])
      expect(current).toHaveLength(1)
      expect(current[0]).toContain(`href="${href}"`)
    }
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
