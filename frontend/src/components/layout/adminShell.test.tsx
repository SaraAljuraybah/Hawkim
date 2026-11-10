import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { appShellEn } from '../../content/app.en'
import type { Permission } from '../../data/mock/types'
import { ADMIN_HOME_PATH } from '../../lib/routes'
import { Sidebar } from './Sidebar'
import { isNavGroup, navLinks } from '../../lib/sidebarNav'
import appSource from '../../App.tsx?raw'
import signInSource from '../../pages/SignInPage.tsx?raw'

const session = vi.hoisted(() => ({ permissions: undefined as Permission[] | undefined }))
vi.mock('../../state/sessionContext', () => ({
  useSession: () => ({ signOut: () => {}, user: session.permissions && { permissions: session.permissions } }),
}))

const links = navLinks(adminEn.shell.nav)
const render = (path: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Sidebar content={adminEn.shell} /></MemoryRouter>)
/** The Manage Organization header button and its list of links. */
const group = (html: string) => ({
  button: html.match(/<button[^>]*aria-expanded="(true|false)"[^>]*>.*?<\/button>/)!,
  list: html.match(/<ul id="[^"]*"( hidden="")?[^>]*>/)!,
})

describe('the admin portal sidebar', () => {
  it('lists the tabs in this order, with Manage Organization holding Divisions & Departments, Staff and Admins', () => {
    const top = adminEn.shell.nav.map((entry) => (isNavGroup(entry) ? [entry.label, entry.children.map(({ label, href }) => [label, href])] : [entry.label, entry.href, entry.icon]))
    expect(top).toEqual([
      ['Manage Organization', [['Divisions & Departments', '/admin/departments'], ['Staff', '/admin/users'], ['Admins', '/admin/admins']]],
      ['SFDA Regulatory Requirements', '/admin/regulations', 'regulatory'],
      ['Organizational Structure', '/admin/organizational-structure', 'hierarchy'],
      ['SOP Directory', '/admin/sops', 'sops'],
      ['Requests', '/admin/requests', 'requests'],
    ])
  })

  it('has no duplicate tabs: Divisions & Departments and Staff are only inside the group', () => {
    const hrefs = links.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(new Set(links.map((item) => item.label)).size).toBe(hrefs.length)
    expect(adminEn.shell.nav.filter((entry) => !isNavGroup(entry) && ['/admin/departments', '/admin/users', '/admin/admins'].includes(entry.href))).toHaveLength(0)
  })

  it.each(links.map((item) => [item.label, item.href]))('highlights only %s on its page and its subpages', (_, href) => {
    for (const path of [href, `${href}/x`]) {
      const current = [...render(path).matchAll(/<a[^>]*aria-current="page"[^>]*>/g)].map((match) => match[0])
      expect(current).toHaveLength(1)
      expect(current[0]).toContain(`href="${href}"`)
    }
  })

  it('shows them in that order', () => {
    const html = render('/admin/users')
    const labels = [...html.matchAll(/<a[^>]*href="\/admin\/[^"]*"[^>]*>(?:<span[^>]*><\/span>)?(?:<svg.*?<\/svg>)?([^<]+)/g)].map((match) => match[1].replace(/&amp;/g, '&'))
    expect(labels).toEqual(links.map((item) => item.label))
  })

  it('takes the logo to Divisions & Departments, named for it', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Sidebar content={adminEn.shell} /></MemoryRouter>)
    const logo = html.match(/<a[^>]*aria-label="Hawkim System Admin, go to Divisions &amp; Departments"[^>]*>/)![0]
    expect(logo).toContain('href="/admin/departments"')
  })
})

describe('Manage Organization', () => {
  it('is a button that opens and closes its list, not a link to a page', () => {
    const html = render('/admin/regulations')
    const { button } = group(html)
    expect(button[0]).toContain('type="button"')
    expect(button[0]).toContain('Manage Organization')
    expect(html).not.toMatch(/<a[^>]*>(?:<svg.*?<\/svg>)?Manage Organization/)
    // The button names the list it controls.
    const controls = button[0].match(/aria-controls="([^"]+)"/)![1]
    expect(html).toContain(`<ul id="${controls}"`)
  })

  it.each(['/admin/departments', '/admin/departments/d/edit', '/admin/users', '/admin/users/new', '/admin/admins', '/admin/admins/a1/edit'])(
    'is open on its page %s (also after a refresh or a typed address), with the page highlighted',
    (path) => {
      const html = render(path)
      const { button, list } = group(html)
      expect(button[1]).toBe('true')
      expect(list[1]).toBeUndefined()
      // The chevron is turned while open.
      expect(button[0]).toContain('rotate-180')
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    },
  )

  it.each(['/admin/regulations', '/admin/sops', '/admin/requests'])('is closed elsewhere (%s), with nothing in it highlighted', (path) => {
    const html = render(path)
    const { button, list } = group(html)
    expect(button[1]).toBe('false')
    expect(list[1]).toBe(' hidden=""')
    expect(button[0]).not.toContain('rotate-180')
    expect(button[0]).not.toContain('bg-white/10')
  })

  it('indents its links under its label, without icons, and keeps the reduced-motion preference', () => {
    const html = render('/admin/admins')
    expect(group(html).list[0]).toContain('ml-[1.375rem]')
    expect(html).toMatch(/<a[^>]*href="\/admin\/admins"[^>]*><span aria-hidden="true" class="absolute[^"]*bg-gold"><\/span>Admins<\/a>/)
    expect(group(html).button[0]).toContain('motion-reduce:transition-none')
  })

  it('is only in the admin portal: the employee app has no group and no Admins link', () => {
    expect(appShellEn.nav.some((entry) => 'children' in entry)).toBe(false)
    expect(appShellEn.nav.some((entry) => entry.href.startsWith('/admin'))).toBe(false)
  })
})

describe('the signed-in user\'s role badges under the logo', () => {
  const badges = (html: string) => [...html.matchAll(/<li class="inline-flex[^"]*bg-gold-light [^"]*">([^<]+)<\/li>/g)].map((match) => match[1])

  it('shows "System Admin" for an admin, outside the logo link, in a labelled list', () => {
    session.permissions = ['admin']
    const html = renderToStaticMarkup(<MemoryRouter><Sidebar content={adminEn.shell} /></MemoryRouter>)
    expect(badges(html)).toEqual(['System Admin'])
    expect(html).toContain('<ul aria-label="Your roles" class="inline')
    expect(html.indexOf('</a>')).toBeLessThan(html.indexOf('aria-label="Your roles"'))
  })

  it('shows one badge per role, in the usual order', () => {
    session.permissions = ['author', 'reviewer', 'approver']
    const html = renderToStaticMarkup(<MemoryRouter><Sidebar content={appShellEn} /></MemoryRouter>)
    expect(badges(html)).toEqual(['Author', 'Reviewer', 'Approver'])
  })

  it('shows no badge for a user without a role', () => {
    session.permissions = []
    const html = renderToStaticMarkup(<MemoryRouter><Sidebar content={appShellEn} /></MemoryRouter>)
    expect(html).not.toContain('Your roles')
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
