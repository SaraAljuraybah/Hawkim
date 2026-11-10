// Browser end-to-end test of Staff Deactivation and Add Staff reactivation, and of the Staff & Profiles UI
// changes (sidebar header, gold permission badges, Staff details readability, page descriptions): real
// Chrome through the UI, against a REAL LOCAL Supabase stack and the local dev server. Disposable data
// only; refuses anything but localhost. No real email: it starts the stand-in email service that add-user
// must be served with (see staff_deactivation.local.mjs for the functions env file).
//
//   supabase start && supabase functions serve --env-file <file>
//   (frontend) VITE_SUPABASE_URL=<local API URL> VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key> npx vite --port 5179
//   npm install puppeteer-core in any folder (it isn't a project dependency), then:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   PUPPETEER_CORE_DIR=<that folder> CHROME_PATH=<chrome executable> [SCREENSHOT_DIR=<folder>] \
//   node supabase/tests/staff_deactivation.browser.local.mjs
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const puppeteerPath = createRequire(`${process.env.PUPPETEER_CORE_DIR ?? '.'}/`).resolve('puppeteer-core')
const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href)
const url = process.env.SUPABASE_URL
const APP = process.env.HAWKIM_APP_URL ?? 'http://127.0.0.1:5179'
const SHOTS = process.env.SCREENSHOT_DIR
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? '') || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(APP)) {
  console.error('Refusing to run: the Supabase stack and the app must both be local.')
  process.exit(2)
}
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const run = randomUUID().slice(0, 6)
const results = []
let failed = 0
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message.split('\n')[0]}`) }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
async function ok(promise, what) { const { data, error } = await promise; if (error) throw new Error(`${what}: ${error.message}`); return data }

// ---------- stand-in email service ----------
const mailbox = []
let emailMode = 'accept'
const mock = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    if (emailMode === 'fail') { response.writeHead(500).end(); return }
    const message = JSON.parse(body || '{}')
    mailbox.push({ to: message.to?.[0], subject: message.subject, html: message.html })
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"local"}')
  })
})
await new Promise((resolve) => mock.listen(Number(process.env.SNDR_MOCK_PORT ?? 56498), '0.0.0.0', resolve))

// ---------- fixtures ----------
const password = `E2e-${randomUUID()}`
const RA = 'regulatory-affairs'
async function person(key, department, roles) {
  const email = `ui-deact-${key}-${run}@test.invalid`
  const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
  await ok(service.from('profiles').insert({ id: user.id, full_name: `UI ${key} ${run}`, email, initials: 'UI', department_id: department, position: 'QA Specialist', phone: '+966500000001' }), `profile ${key}`)
  if (roles.length) await ok(service.from('user_roles').insert(roles.map((role) => ({ user_id: user.id, role }))), `roles ${key}`)
  return { id: user.id, email, name: `UI ${key} ${run}` }
}
const admin = await person('admin', 'quality-assurance', ['admin'])
const staff = await person('staff', RA, ['author', 'reviewer'])
const target = await person('target', RA, ['author'])
const busy = await person('busy', RA, ['author'])
const late = await person('late', RA, ['author'])
// The busy author has a Draft (through the real RPC): work in progress.
{
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options)
  await ok(client.auth.signInWithPassword({ email: busy.email, password }), 'sign in busy')
  const path = `${busy.id}/${randomUUID()}.pdf`
  await ok(client.storage.from('sop-files').upload(path, new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' }), 'upload')
  await ok(client.rpc('create_sop', { p_title: `UI draft ${run}`, p_description: '', p_department_id: RA, p_storage_path: path, p_file_name: 'a.pdf' }), 'create_sop')
}
/** A Draft by this person, through the real RPC (work in progress). */
async function draftBy(who) {
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options)
  await ok(client.auth.signInWithPassword({ email: who.email, password }), `sign in ${who.email}`)
  const path = `${who.id}/${randomUUID()}.pdf`
  await ok(client.storage.from('sop-files').upload(path, new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' }), 'upload')
  await ok(client.rpc('create_sop', { p_title: `UI late draft ${run}`, p_description: '', p_department_id: RA, p_storage_path: path, p_file_name: 'a.pdf' }), 'create_sop')
}
const departments = await ok(service.from('departments').select('id, name, division:divisions(name)').is('removed_at', null), 'departments')
const ra = departments.find((d) => d.id === RA)
const profile = async (id) => ok(service.from('profiles').select('id, full_name, deleted_at, department_id, user_roles(role)').eq('id', id).single(), 'read profile')

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] })
async function signIn(email) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.setDefaultTimeout(30000)
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('input[name="email"]', { visible: true })
  await page.type('input[name="email"]', email)
  await page.type('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => location.pathname !== '/login')
  await page.waitForSelector('header')
  return page
}
const bodyText = (page) => page.evaluate(() => document.body.innerText)
const waitText = (page, value, timeout = 15000) => page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value)
const nextTick = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }
/** The sidebar header (the logo row): its text. */
const sidebarHeader = (page) => page.evaluate(() => {
  const logo = [...document.querySelectorAll('a[aria-label]')].find((a) => a.textContent?.includes('Hawkim'))
  return logo?.parentElement?.innerText ?? ''
})
async function choose(page, name, label) {
  await page.click(`input[name="${name}"]`, { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.type(`input[name="${name}"]`, label)
  const option = await page.waitForSelector(`::-p-xpath(//li[@role="option" and normalize-space(.)="${label}"])`, { timeout: 5000 })
  await option.click()
}
async function clickButton(page, label) {
  const element = await page.waitForSelector(`::-p-xpath(//button[normalize-space(.)="${label}" or @aria-label="${label}"])`, { visible: true })
  await element.click()
}
async function addStaff(page, email, name) {
  await page.goto(`${APP}/admin/users/new`, { waitUntil: 'networkidle2' })
  await page.type('input[name="name"]', name)
  await page.type('input[name="email"]', email)
  await page.type('input[name="phone"]', '12345678')
  // The division field is the first combobox; its name follows DivisionField.
  const division = await page.$('input[name="division"]')
  if (division) await choose(page, 'division', ra.division?.name ?? 'No Division')
  await choose(page, 'department', ra.name)
  await page.type('input[name="position"]', 'Senior Officer')
  await page.click('input[name="permissions"][value="reviewer"]')
  await clickButton(page, 'Add Staff')
}

// ---------- the tests ----------
const staffPage = await signIn(staff.email)
const targetPage = await signIn(target.email)
const page = await signIn(admin.email)
// Leaving Add Staff with typed details asks the browser's own question: leave.
page.on('dialog', (dialog) => dialog.accept())

await check('Sidebar: a staff member sees only "Hawkim" beside the logo, and still has My SOPs and My Reviews', async () => {
  const header = await sidebarHeader(staffPage)
  assert(header.trim() === 'Hawkim', `header: ${JSON.stringify(header)}`)
  const text = await bodyText(staffPage)
  assert(text.includes('My SOPs') && text.includes('My Reviews'), 'navigation kept')
  await shot(staffPage, '01-staff-sidebar')
})

await check('Sidebar: the admin portal keeps the administrator\'s role beside the logo', async () => {
  await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  const header = await sidebarHeader(page)
  assert(/Hawkim\s*(Super Admin|Admin)/.test(header), `header: ${JSON.stringify(header)}`)
})

await check('Staff list: has its description under the heading', async () => {
  await waitText(page, "View and manage your organization's staff and their permissions.")
  await shot(page, '02-staff-list')
})

await check('Staff details: gold badges, readable details and the description, without overflow (desktop and phone)', async () => {
  await page.goto(`${APP}/admin/users/${staff.id}`, { waitUntil: 'networkidle2' })
  await waitText(page, "View this staff member's contact details, placement and permissions.")
  for (const [width, name] of [[1280, '03-staff-details-desktop'], [390, '04-staff-details-phone']]) {
    await page.setViewport({ width, height: 900 })
    await nextTick(300)
    const layout = await page.evaluate(() => {
      const dt = document.querySelector('dl dt'), dd = document.querySelector('dl dd')
      const badges = [...document.querySelectorAll('main li')].filter((li) => ['Author', 'Reviewer', 'Approver'].includes(li.textContent ?? '')).map((li) => ({ text: li.textContent, bg: getComputedStyle(li).backgroundColor, color: getComputedStyle(li).color }))
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        dt: parseFloat(getComputedStyle(dt).fontSize), dd: parseFloat(getComputedStyle(dd).fontSize),
        dtTop: dt.getBoundingClientRect().top, ddTop: dd.getBoundingClientRect().top,
        badges,
      }
    })
    assert(!layout.overflow, `horizontal overflow at ${width}px`)
    assert(layout.dd > layout.dt && layout.dd >= 16, `value ${layout.dd}px vs label ${layout.dt}px`)
    // Side by side on desktop, label above value on a phone.
    assert(width > 640 ? Math.abs(layout.ddTop - layout.dtTop) < 8 : layout.ddTop > layout.dtTop + 8, `alignment at ${width}px`)
    const gold = layout.badges.filter((badge) => ['Author', 'Reviewer'].includes(badge.text))
    assert(gold.length === 2 && gold.every((badge) => badge.bg === 'rgb(216, 183, 122)' && badge.color === 'rgb(58, 11, 24)'), `badges ${JSON.stringify(layout.badges)}`)
    await shot(page, name)
  }
  await page.setViewport({ width: 1280, height: 900 })
})

await check('Delete Staff: the dialog says it deactivates, and work in progress is refused with no false success', async () => {
  await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  await clickButton(page, `Delete ${busy.name}`)
  await waitText(page, 'Deactivate Staff?')
  await shot(page, '05-deactivate-dialog')
  await clickButton(page, 'Deactivate')
  await waitText(page, `${busy.name} wasn't deactivated:`)
  assert((await bodyText(page)).includes('has 1 SOP in progress'), 'explains the SOP in progress')
  assert(!(await bodyText(page)).includes('deactivated successfully'), 'no success message')
  assert(!(await profile(busy.id)).deleted_at, 'still active')
})

await check('Delete Staff: a refusal by the server (work started after the page loaded) is shown, with no false success', async () => {
  await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  await waitText(page, late.name)
  // The page's own SOP list doesn't know this Draft yet: only the server can refuse it.
  await draftBy(late)
  await clickButton(page, `Delete ${late.name}`)
  await clickButton(page, 'Deactivate')
  await waitText(page, `${late.name} wasn't deactivated:`)
  assert((await bodyText(page)).includes('has 1 SOP in progress'), 'explains the server refusal')
  assert(!(await bodyText(page)).includes(`${late.name} deactivated successfully`), 'no success message')
  assert(!(await profile(late.id)).deleted_at, 'still active in the database')
})

await check('Delete Staff: Deactivate deactivates in the database, the row leaves the list, and it stays so after a reload', async () => {
  await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  await clickButton(page, `Delete ${target.name}`)
  await waitText(page, `Are you sure you want to deactivate ${target.name}? They will lose access to Hawkim, but their account information and history will be preserved.`)
  await clickButton(page, 'Deactivate')
  await waitText(page, `${target.name} deactivated successfully.`)
  assert(!(await page.$(`::-p-xpath(//button[@aria-label="Delete ${target.name}"])`)), 'the row is gone')
  assert((await profile(target.id)).deleted_at, 'deactivated in the database')
  await page.reload({ waitUntil: 'networkidle2' })
  await nextTick(800)
  assert(!(await bodyText(page)).includes(target.name), 'still gone after a reload')
})

await check('An open tab of the deactivated staff member signs out when it is used again', async () => {
  await targetPage.bringToFront()
  await targetPage.evaluate(() => window.dispatchEvent(new Event('focus')))
  await targetPage.waitForFunction(() => location.pathname === '/login', { timeout: 15000 })
})

await check('A deactivated employee can\'t sign in to Hawkim', async () => {
  const context = await browser.createBrowserContext()
  const login = await context.newPage()
  await login.goto(`${APP}/login`, { waitUntil: 'networkidle2' })
  await login.type('input[name="email"]', target.email)
  await login.type('input[name="password"]', password)
  await login.click('button[type="submit"]')
  await waitText(login, "This account doesn't have access to Hawkim.")
  assert(await login.evaluate(() => location.pathname) === '/login', 'left the sign-in page')
  await context.close()
})

await check('Add Staff with their email, if the invitation can\'t be sent: an error, and they stay deactivated', async () => {
  await page.bringToFront()
  emailMode = 'fail'
  await addStaff(page, target.email, `UI Back ${run}`)
  await waitText(page, "their new invitation couldn't be sent, so they stay deactivated")
  emailMode = 'accept'
  assert((await profile(target.id)).deleted_at, 'still deactivated')
})

await check('Add Staff with their email reactivates the same person, with the new details and a new invitation', async () => {
  const sent = mailbox.length
  await addStaff(page, target.email.toUpperCase(), `UI Back ${run}`)
  await page.waitForFunction((id) => location.pathname === `/admin/users/${id}`, { timeout: 20000 }, target.id)
  await waitText(page, 'Staff member reactivated. A new invitation has been sent.')
  await shot(page, '06-reactivated')
  const row = await profile(target.id)
  assert(!row.deleted_at && row.full_name === `UI Back ${run}` && row.user_roles.map((r) => r.role).join() === 'reviewer', JSON.stringify(row))
  assert(mailbox.length === sent + 1, 'one invitation')
  await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  await waitText(page, `UI Back ${run}`)
})

await check('The reactivated employee opens the new invitation, sets a password on Set New Password, and signs in again', async () => {
  const message = mailbox.filter((item) => item.to === target.email).at(-1)
  assert(message?.html, 'no invitation captured')
  const link = message.html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replaceAll('&amp;', '&')
  assert(link, 'no set-password link in the email')
  const context = await browser.createBrowserContext()
  const invitee = await context.newPage()
  await invitee.goto(link, { waitUntil: 'networkidle2' })
  await invitee.waitForFunction(() => location.pathname === '/reset-password', { timeout: 20000 })
  const fresh = `E2e-${randomUUID()}`
  await invitee.waitForSelector('input[name="newPassword"]', { visible: true })
  await invitee.type('input[name="newPassword"]', fresh)
  await invitee.type('input[name="confirmPassword"]', fresh)
  await clickButton(invitee, 'Save Password')
  await waitText(invitee, 'Password Changed')
  await context.close()
  // Signing in with the new password works; the old one doesn't.
  const old = createClient(url, process.env.SUPABASE_ANON_KEY, options)
  assert((await old.auth.signInWithPassword({ email: target.email, password })).error, 'the old password still works')
  const context2 = await browser.createBrowserContext()
  const again = await context2.newPage()
  await again.goto(`${APP}/login`, { waitUntil: 'networkidle2' })
  await again.type('input[name="email"]', target.email)
  await again.type('input[name="password"]', fresh)
  await again.click('button[type="submit"]')
  await again.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 })
  await again.waitForSelector('header')
  assert((await sidebarHeader(again)).trim() === 'Hawkim', 'staff sidebar without permission badges')
  await context2.close()
})

await check('My Profile: has its description', async () => {
  await staffPage.goto(`${APP}/profile`, { waitUntil: 'networkidle2' })
  await waitText(staffPage, 'View your account details and change your password.')
})

await browser.close()
mock.close()
console.log(results.join('\n'))
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
