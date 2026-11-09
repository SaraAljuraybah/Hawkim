// Browser end-to-end test of Staff Management (Tasks 7–16): real Chrome through the UI, against a REAL
// LOCAL Supabase stack and the local dev server. Disposable data only; refuses anything but localhost.
//
//   supabase start && supabase functions serve --env-file <file with SNDR_API_KEY=any, SNDR_API_URL=unreachable>
//   (frontend) VITE_SUPABASE_URL=<local API URL> VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key> npx vite --port 5179
//   npm install puppeteer-core in any folder (it isn't a project dependency), then:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   PUPPETEER_CORE_DIR=<that folder> CHROME_PATH=<chrome executable> node supabase/tests/staff_management.browser.local.mjs
//
// Covers Tasks 7–16 in the UI (wording, search, required fields, +9665 phone, Edit Staff saving to the
// database, unsaved changes on Cancel / sidebar / Back / reload, email change through Auth, System
// Admin without organizational fields, the top bar) and the department transfer restriction.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const puppeteerPath = createRequire(`${process.env.PUPPETEER_CORE_DIR ?? '.'}/`).resolve('puppeteer-core')
const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href)
const url = process.env.SUPABASE_URL
const APP = process.env.HAWKIM_APP_URL ?? 'http://127.0.0.1:5179'
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

// ---------- fixtures ----------
const password = `E2e-${randomUUID()}`
async function person(key, department, roles, position = 'QA Specialist') {
  const email = `ui-${key}-${run}@test.invalid`
  const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
  await ok(service.from('profiles').insert({ id: user.id, full_name: `UI ${key} ${run}`, email, initials: 'UI', department_id: department, position, phone: '+966500000001' }), `profile ${key}`)
  if (roles.length) await ok(service.from('user_roles').insert(roles.map((role) => ({ user_id: user.id, role }))), `roles ${key}`)
  return { id: user.id, email, name: `UI ${key} ${run}` }
}
const RA = 'regulatory-affairs'
const admin = await person('admin', 'quality-assurance', ['admin'], 'IT Manager')
// A System Admin without a department signs in too.
await ok(service.from('profiles').update({ department_id: null, position: null }).eq('id', admin.id), 'admin without a department')
const blocked = await person('blocked', RA, ['author'])
const mover = await person('mover', RA, ['author'])
const employee = await person('employee', RA, ['author'], 'QA Specialist')
// The blocked author has a draft SOP (created through the real RPC).
{
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options)
  await ok(client.auth.signInWithPassword({ email: blocked.email, password }), 'sign in blocked')
  const path = `${blocked.id}/${randomUUID()}.pdf`
  await ok(client.storage.from('sop-files').upload(path, new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' }), 'upload')
  await ok(client.rpc('create_sop', { p_title: `UI draft ${run}`, p_description: '', p_department_id: RA, p_storage_path: path, p_file_name: 'a.pdf' }), 'create_sop')
}
// A target department in another division (or none) than Regulatory Affairs.
const departments = await ok(service.from('departments').select('id, name, division_id, division:divisions(name)').is('removed_at', null), 'departments')
const ra = departments.find((d) => d.id === RA)
const target = departments.find((d) => d.id !== RA && d.id !== 'quality-assurance' && d.id !== 'pharmacovigilance')
const divisionLabel = (d) => d.division?.name ?? 'No Division'
const profile = async (id) => ok(service.from('profiles').select('full_name, email, phone, position, department_id').eq('id', id).single(), 'read profile')

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] })
async function signIn(email) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(90000)
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('input[name="email"]', { visible: true })
  await page.type('input[name="email"]', email)
  await page.type('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => location.pathname !== '/login')
  await page.waitForSelector('header')
  return page
}
const text = (page) => page.evaluate(() => document.body.innerText)
const waitText = (page, value, timeout = 10000) => page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value)
const pathname = (page) => page.evaluate(() => location.pathname)
async function fill(page, name, value) {
  const input = await page.waitForSelector(`input[name="${name}"]`, { visible: true, timeout: 15000 })
  await input.click({ clickCount: 3 })
  await page.keyboard.press('Backspace')
  await input.type(value)
}
async function choose(page, name, label) {
  await page.waitForSelector(`input[name="${name}"]`, { visible: true, timeout: 15000 })
  await page.click(`input[name="${name}"]`, { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.type(`input[name="${name}"]`, label)
  const option = await page.waitForSelector(`::-p-xpath(//li[@role="option" and normalize-space(.)="${label}"])`, { timeout: 5000 })
  await option.click()
}
const dialogOpen = (page) => page.evaluate(() => [...document.querySelectorAll('dialog')].some((d) => d.open && d.innerText.includes('Discard unsaved changes?')))
async function clickText(page, label, tag = '*') {
  const element = await page.waitForSelector(`::-p-xpath(//${tag}[normalize-space(.)="${label}"])`, { visible: true, timeout: 30000 })
  await element.click()
}
const editPath = (id) => `${APP}/admin/users/${id}/edit`
const nextTick = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- the tests ----------
const page = await signIn(admin.email)
// Leaving with unsaved changes on purpose (goto) answers the browser's own question with Leave;
// the reload check below takes over to answer it with Stay.
let unloadAnswer = 'accept'
let unloadSeen = null
page.on('dialog', async (dialog) => {
  unloadSeen = dialog.type()
  if (unloadAnswer === 'accept') await dialog.accept(); else await dialog.dismiss()
})

await check('A System Admin without a department signs in to the admin portal; top bar shows only the role', async () => {
  assert((await pathname(page)).startsWith('/admin'), `landed on ${await pathname(page)}`)
  await page.waitForSelector('header')
  await waitText(page, 'Administrator')
  const header = await page.$eval('header', (h) => h.innerText)
  assert(header.includes('Administrator') && !header.includes('IT Manager'), `header: ${header}`)
})

await check('Tasks 7, 8, 16: Staff list title, no description, placeholder, search by name/email/division/department', async () => {
  await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  assert(await (await page.waitForSelector('h1')).evaluate((h) => h.textContent) === 'Staff', 'title')
  const body = await text(page)
  assert(!body.includes('Manage who can use Hawkim and what they can do.'), 'description still shown')
  assert(!/\bUsers?\b/.test(body), 'Users wording on the page')
  assert(await page.$eval('input[name="search"]', (i) => i.placeholder) === 'Search by staff name, email, division, department', 'placeholder')
  // "No Division" is a label, not a division name: only a real division is searched.
  for (const query of [mover.name, mover.email, ra.name, ...(ra.division ? [ra.division.name] : [])]) {
    await fill(page, 'search', query)
    await nextTick(250)
    assert((await text(page)).includes(mover.name), `"${query}" doesn't find the staff member`)
  }
  await fill(page, 'search', `nobody-${run}`)
  await waitText(page, 'No staff found.')
})

await check('Task 11: Edit Staff opens from Staff Details, prefilled with the saved details', async () => {
  await page.goto(`${APP}/admin/users/${mover.id}`, { waitUntil: 'networkidle2' })
  await clickText(page, 'Edit Staff', 'a')
  await page.waitForSelector('input[name="phone"]')
  assert(await pathname(page) === `/admin/users/${mover.id}/edit`, 'not on the edit page')
  assert(await page.$eval('input[name="name"]', (i) => i.value) === mover.name, 'name not prefilled')
  assert(await page.$eval('input[name="phone"]', (i) => i.value) === '+966500000001', 'phone not prefilled')
})

await check('Tasks 9, 13: phone required and only +9665XXXXXXXX; the valid change is saved in the database', async () => {
  await fill(page, 'phone', '')
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Enter a phone number.')
  await fill(page, 'phone', '0512345678')
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Enter a Saudi mobile number as +9665 followed by 8 digits, e.g. +966512345678.')
  assert((await profile(mover.id)).phone === '+966500000001', 'an invalid phone was saved')
  await fill(page, 'phone', '+966511112222')
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Changes saved.')
  assert((await profile(mover.id)).phone === '+966511112222', 'phone not saved')
})

await check('Task 10: email and position are required; a bad email is refused', async () => {
  await fill(page, 'email', 'not-an-email')
  await fill(page, 'position', '')
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Enter a valid email address, e.g. name@example.com.')
  await waitText(page, "Enter the staff member's position.")
  await page.goto(editPath(mover.id), { waitUntil: 'networkidle2' }) // nothing was saved: no question
})

await check('Task 12: Cancel asks; Keep Editing keeps the changes; a sidebar link asks; Discard Changes leaves without saving', async () => {
  await page.waitForSelector('input[name="name"]')
  await fill(page, 'name', `${mover.name} changed`)
  await clickText(page, 'Cancel', 'a')
  await page.waitForFunction(() => [...document.querySelectorAll('dialog')].some((d) => d.open))
  assert(await dialogOpen(page), 'no question on Cancel')
  const dialogText = await page.$eval('dialog[open]', (d) => d.innerText)
  assert(dialogText.includes('You have unsaved changes. Are you sure you want to leave without saving?') && dialogText.includes('Keep Editing') && dialogText.includes('Discard Changes'), dialogText)
  await clickText(page, 'Keep Editing', 'button')
  await nextTick()
  assert(await pathname(page) === `/admin/users/${mover.id}/edit`, 'left the page')
  assert(await page.$eval('input[name="name"]', (i) => i.value) === `${mover.name} changed`, 'changes lost')
  await page.click('nav a[href="/admin/users"]')
  await page.waitForFunction(() => [...document.querySelectorAll('dialog')].some((d) => d.open))
  await clickText(page, 'Discard Changes', 'button')
  await page.waitForFunction(() => location.pathname === '/admin/users')
  assert((await profile(mover.id)).full_name === mover.name, 'discarded changes were saved')
})

await check('Task 12: browser Back asks too, and reload/close is held by the browser\'s own confirmation', async () => {
  // Opened inside the app (Staff Details → Edit Staff), so Back stays in the app.
  await page.goto(`${APP}/admin/users/${mover.id}`, { waitUntil: 'networkidle2' })
  await clickText(page, 'Edit Staff', 'a')
  await page.waitForFunction((p) => location.pathname === p, {}, `/admin/users/${mover.id}/edit`)
  await fill(page, 'position', 'Changed Position')
  await page.goBack().catch(() => {})
  await page.waitForFunction(() => [...document.querySelectorAll('dialog')].some((d) => d.open), { timeout: 5000 })
  await clickText(page, 'Keep Editing', 'button')
  await nextTick()
  assert(await pathname(page) === `/admin/users/${mover.id}/edit`, 'Back left the page')
  assert(await page.$eval('input[name="position"]', (i) => i.value) === 'Changed Position', 'changes lost after Back')
  unloadAnswer = 'dismiss'
  unloadSeen = null
  await page.reload({ timeout: 3000 }).catch(() => {})
  await nextTick(800)
  unloadAnswer = 'accept'
  assert(unloadSeen === 'beforeunload', `no beforeunload confirmation (${unloadSeen})`)
  assert(await page.$eval('input[name="position"]', (i) => i.value) === 'Changed Position', 'reload discarded the changes')
})

await check('Task 12: after a successful save, leaving asks nothing', async () => {
  await fill(page, 'position', 'QA Lead')
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Changes saved.')
  await page.click('nav a[href="/admin/users"]')
  await page.waitForFunction(() => location.pathname === '/admin/users', { timeout: 5000 })
  assert(!(await dialogOpen(page)), 'asked after saving')
  assert((await profile(mover.id)).position === 'QA Lead', 'position not saved')
})

await check('Transfer blocked: an author with a draft SOP can\'t move; nothing is saved', async () => {
  await page.goto(editPath(blocked.id), { waitUntil: 'networkidle2' })
  await choose(page, 'division', divisionLabel(target))
  await choose(page, 'department', target.name)
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Department Transfer Not Allowed')
  const body = await text(page)
  assert(body.includes('This staff member has incomplete SOP responsibilities. All assigned SOP work must be completed before transferring them to another department.'), 'message')
  assert(body.includes('Blocking: 1 SOP in progress.'), 'count')
  assert((await profile(blocked.id)).department_id === RA, 'moved anyway')
})

await check('Transfer allowed for staff without SOP work, and saved in the database', async () => {
  await page.goto(editPath(mover.id), { waitUntil: 'networkidle2' })
  await choose(page, 'division', divisionLabel(target))
  await choose(page, 'department', target.name)
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Changes saved.')
  assert((await profile(mover.id)).department_id === target.id, 'not moved')
})

await check('Task 11: a new email is saved to the profile and the sign-in account; they sign in with it', async () => {
  const next = `ui-mover-new-${run}@test.invalid`
  await page.goto(editPath(mover.id), { waitUntil: 'networkidle2' })
  await fill(page, 'email', next)
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Changes saved.')
  assert((await profile(mover.id)).email === next, 'profile email')
  const account = await ok(service.auth.admin.getUserById(mover.id), 'account')
  assert(account.user.email === next, 'sign-in email')
  await page.reload({ waitUntil: 'networkidle2' })
  assert(await (await page.waitForSelector('input[name="email"]')).evaluate((i) => i.value) === next, 'not kept after reload')
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options)
  await ok(client.auth.signInWithPassword({ email: next, password }), 'sign in with the new email')
})

let newAdminId
await check('Task 15: Add Staff hides Division, Department and Position for Admin, and creates a System Admin without them', async () => {
  await page.goto(`${APP}/admin/users/new`, { waitUntil: 'networkidle2' })
  assert(await (await page.waitForSelector('h1')).evaluate((h) => h.textContent) === 'Add Staff', 'title')
  assert(await page.$('input[name="department"]'), 'staff fields missing for staff')
  await page.type('input[name="name"]', `UI New Admin ${run}`)
  await page.type('input[name="email"]', `ui-newadmin-${run}@test.invalid`)
  await page.type('input[name="phone"]', '+966544445555')
  await page.click('input[name="permissions"][value="admin"]')
  await nextTick(200)
  for (const name of ['division', 'department', 'position']) assert(!(await page.$(`input[name="${name}"]`)), `${name} still shown`)
  await clickText(page, 'Add Staff', 'button')
  await page.waitForFunction(() => /^\/admin\/users\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 })
  newAdminId = (await pathname(page)).split('/').pop()
  const row = await profile(newAdminId)
  assert(row.department_id === null && row.position === null, `stored ${JSON.stringify(row)}`)
  const labels = await page.$$eval('dt', (dts) => dts.map((dt) => dt.textContent))
  assert(!labels.includes('Division') && !labels.includes('Department') && !labels.includes('Position'), `details show ${labels}`)
})

await check('Task 15: editing a System Admin shows no organizational fields and saves', async () => {
  await page.goto(editPath(newAdminId), { waitUntil: 'networkidle2' })
  for (const name of ['division', 'department', 'position']) assert(!(await page.$(`input[name="${name}"]`)), `${name} shown`)
  await fill(page, 'phone', '+966544446666')
  await clickText(page, 'Save Changes', 'button')
  await waitText(page, 'Changes saved.')
  const row = await profile(newAdminId)
  assert(row.phone === '+966544446666' && row.department_id === null, JSON.stringify(row))
})

await check('Task 14: the staff top bar shows "Position | Department" on one line', async () => {
  const staffPage = await signIn(employee.email)
  for (const width of [1280, 820]) {
    await staffPage.setViewport({ width, height: 900 })
    await nextTick(300)
    const layout = await staffPage.evaluate(() => {
      const line = [...document.querySelectorAll('header div')].find((d) => d.className.includes('hidden items-center') && d.className.includes('sm:flex'))
      if (!line) return null
      const parts = [...line.children].map((child) => child.getBoundingClientRect())
      return { text: line.innerText.replace(/\s+/g, ' ').trim(), tops: parts.map((r) => Math.round(r.top + r.height / 2)) }
    })
    assert(layout, 'no Position | Department line')
    // The department switcher's screen-reader label ("SOP Directory:") is part of innerText.
    assert(/^QA Specialist \| (SOP Directory: )?Regulatory Affairs/.test(layout.text), `text "${layout.text}"`)
    assert(Math.max(...layout.tops) - Math.min(...layout.tops) <= 2, `stacked at ${width}px: ${layout.tops}`)
  }
})

await browser.close()
console.log(results.join('\n'))
console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} browser checks passed`)
process.exit(failed ? 1 : 0)
