// Browser end-to-end test of Manage Organization → Admins (Super Admin and Admin): real Chrome through
// the UI, against a REAL LOCAL Supabase stack, its Edge Functions and the local dev server, plus direct
// API calls that bypass the UI. Disposable data only; refuses anything but localhost.
//
//   supabase start && supabase functions serve --env-file <file with SNDR_API_KEY=any, SNDR_API_URL=unreachable>
//   (frontend) VITE_SUPABASE_URL=<local API URL> VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key> npx vite --port 5189
//   npm install puppeteer-core in any folder (it isn't a project dependency), then:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... HAWKIM_APP_URL=http://127.0.0.1:5189 \
//   HAWKIM_DB_CONTAINER=<the local stack's supabase_db_… container> PUPPETEER_CORE_DIR=<that folder> \
//   CHROME_PATH=<chrome executable> node supabase/tests/admins.browser.local.mjs
//
// The Super Admin of the fixture is set as the database owner (docker exec psql), as only the owner can;
// everything else goes through the API exactly as the app does.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const puppeteerPath = createRequire(`${process.env.PUPPETEER_CORE_DIR ?? '.'}/`).resolve('puppeteer-core')
const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href)
const url = process.env.SUPABASE_URL
const APP = process.env.HAWKIM_APP_URL ?? 'http://127.0.0.1:5189'
const container = process.env.HAWKIM_DB_CONTAINER ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? '') || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(APP) || !/^supabase_db_/.test(container)) {
  console.error('Refusing to run: the Supabase stack, its database container and the app must all be local.')
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
const ownerSql = (sql) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: sql, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString().trim()
const superAdminId = () => ownerSql('select user_id from public.super_admin;')

// ---------- fixtures ----------
const password = `E2e-${randomUUID()}`
async function person(key, roles, department = null, position = null) {
  const email = `ad-${key}-${run}@test.invalid`
  const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
  // Created with a department, as the database requires until the Admin role exists, then cleared for Admins.
  await ok(service.from('profiles').insert({ id: user.id, full_name: `Admins ${key} ${run}`, email, initials: 'AD', department_id: department ?? 'quality-assurance', position: position ?? 'Manager', phone: '+966500000001' }), `profile ${key}`)
  if (roles.length) await ok(service.from('user_roles').insert(roles.map((role) => ({ user_id: user.id, role }))), `roles ${key}`)
  if (!department) await ok(service.from('profiles').update({ department_id: null, position: null }).eq('id', user.id), `no department ${key}`)
  return { id: user.id, email, name: `Admins ${key} ${run}` }
}
const superAdmin = await person('super', ['admin'])
const regular = await person('regular', ['admin'])
const staff = await person('staff', ['author'], 'regulatory-affairs', 'QA Specialist')
ownerSql(`insert into public.super_admin (user_id) values ('${superAdmin.id}') on conflict (singleton) do update set user_id = excluded.user_id;`)
const profile = async (id) => ok(service.from('profiles').select('full_name, email, phone, deleted_at, user_roles(role)').eq('id', id).single(), 'read profile')
async function apiAs(email) {
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options)
  await ok(client.auth.signInWithPassword({ email, password }), `sign in ${email}`)
  return client
}

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] })
async function signIn(email, width = 1280) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width, height: 900 })
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(90000)
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('input[name="email"]', { visible: true })
  await page.type('input[name="email"]', email)
  await page.type('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => location.pathname !== '/login')
  await page.waitForSelector('header')
  return page
}
const waitText = (page, value, timeout = 15000) => page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value)
const pathname = (page) => page.evaluate(() => location.pathname)
async function fill(page, name, value) {
  const input = await page.waitForSelector(`input[name="${name}"]`, { visible: true, timeout: 15000 })
  await input.click({ clickCount: 3 })
  await page.keyboard.press('Backspace')
  await input.type(value)
}
async function clickText(page, label, tag = '*') {
  const element = await page.waitForSelector(`::-p-xpath(//${tag}[normalize-space(.)="${label}"])`, { visible: true, timeout: 30000 })
  await element.click()
}
const nextTick = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))
// The desktop sidebar's Manage Organization button and its list.
const group = (page) => page.evaluate(() => {
  const button = [...document.querySelectorAll('aside button[aria-expanded], .lg\\:block button[aria-expanded]')].find((b) => b.textContent.includes('Manage Organization'))
  if (!button) return null
  const list = document.getElementById(button.getAttribute('aria-controls'))
  const current = document.querySelector('.lg\\:block a[aria-current="page"]')
  return { expanded: button.getAttribute('aria-expanded'), hidden: list?.hidden, links: [...list.querySelectorAll('a')].map((a) => a.textContent.trim()), current: current?.getAttribute('href') ?? null }
})
const groupButton = (page) => page.waitForSelector('::-p-xpath(//div[contains(@class,"lg:block")]//button[@aria-expanded and contains(normalize-space(.),"Manage Organization")])')
const hasButton = (page, label) => page.evaluate((l) => !!document.querySelector(`[aria-label="${l}"]`) || [...document.querySelectorAll('button, a')].some((e) => e.textContent.trim() === l), label)

// ---------- 1. Sidebar ----------
const sa = await signIn(superAdmin.email)
await check('Manage Organization is open on Divisions & Departments, with exactly its three pages', async () => {
  await sa.goto(`${APP}/admin/departments`, { waitUntil: 'networkidle2' })
  const state = await group(sa)
  assert(state, 'no group')
  assert(state.expanded === 'true' && state.hidden === false, `expected open, got ${JSON.stringify(state)}`)
  assert(JSON.stringify(state.links) === JSON.stringify(['Divisions & Departments', 'Staff', 'Admins']), `links ${state.links}`)
  assert(state.current === '/admin/departments', `current ${state.current}`)
})
await check('clicking it closes and opens it, and so do Enter and Space', async () => {
  const button = await groupButton(sa)
  await button.click(); await nextTick()
  let state = await group(sa)
  assert(state.expanded === 'false' && state.hidden === true, `after click: ${JSON.stringify(state)}`)
  assert(await pathname(sa) === '/admin/departments', 'the group is not a page')
  await button.click(); await nextTick()
  state = await group(sa)
  assert(state.expanded === 'true' && state.hidden === false, `after 2nd click: ${JSON.stringify(state)}`)
  await button.focus(); await sa.keyboard.press('Enter'); await nextTick()
  assert((await group(sa)).expanded === 'false', 'Enter closes')
  await sa.keyboard.press('Space'); await nextTick()
  assert((await group(sa)).expanded === 'true', 'Space opens')
})
await check('Admins opens from the group and stays highlighted after a refresh', async () => {
  await (await sa.waitForSelector('::-p-xpath(//div[contains(@class,"lg:block")]//a[normalize-space(.)="Admins"])')).click()
  await sa.waitForFunction(() => location.pathname === '/admin/admins')
  await waitText(sa, 'Super Admin')
  await sa.reload({ waitUntil: 'networkidle2' })
  await waitText(sa, 'Super Admin')
  const state = await group(sa)
  assert(state.expanded === 'true' && state.current === '/admin/admins', JSON.stringify(state))
})
await check('it is closed on other pages after a refresh', async () => {
  await sa.goto(`${APP}/admin/regulations`, { waitUntil: 'networkidle2' })
  const state = await group(sa)
  assert(state.expanded === 'false' && state.hidden === true, JSON.stringify(state))
})

// ---------- 2. List ----------
await check('the list shows administrators only, with the Super Admin badge, and Delete only on regular Admins', async () => {
  await sa.goto(`${APP}/admin/admins`, { waitUntil: 'networkidle2' })
  await waitText(sa, regular.name)
  const body = await sa.evaluate(() => document.body.innerText)
  assert(!body.includes(staff.name), 'staff listed')
  assert(await hasButton(sa, `Delete ${regular.name}`), 'no Delete on a regular Admin')
  assert(!(await hasButton(sa, `Delete ${superAdmin.name}`)), 'Delete on the Super Admin')
  const badge = await sa.evaluate((name) => [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(name))?.innerText.includes('Super Admin'), superAdmin.name)
  assert(badge, 'no Super Admin badge on its row')
})
await check('search finds by email', async () => {
  await fill(sa, 'search', regular.email)
  await nextTick()
  const rows = await sa.evaluate(() => [...document.querySelectorAll('tbody tr')].map((tr) => tr.innerText))
  assert(rows.length === 1 && rows[0].includes(regular.name), JSON.stringify(rows))
})

// ---------- 3. Add Admin ----------
let added = null
await check('Add Admin creates a real regular Admin through add-user', async () => {
  await sa.goto(`${APP}/admin/admins/new`, { waitUntil: 'networkidle2' })
  assert(!(await sa.$('input[type="checkbox"]')) && !(await sa.$('select')), 'a role can be chosen')
  await fill(sa, 'name', `Admins added ${run}`)
  await fill(sa, 'email', `ad-added-${run}@test.invalid`)
  await fill(sa, 'phone', '+966512340000')
  await clickText(sa, 'Add Admin', 'button')
  await sa.waitForFunction(() => /^\/admin\/admins\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 30000 })
  await waitText(sa, 'Admin added')
  const id = (await pathname(sa)).split('/').pop()
  const saved = await profile(id)
  assert(saved.user_roles.map((r) => r.role).join() === 'admin', `roles ${JSON.stringify(saved.user_roles)}`)
  assert(superAdminId() === superAdmin.id, 'Add Admin moved the Super Admin')
  added = { id, email: `ad-added-${run}@test.invalid`, name: `Admins added ${run}` }
  await ok(service.auth.admin.updateUserById(id, { password }), 'set password')
})
await check('Add Admin refuses an email that is taken, without adding anyone', async () => {
  await sa.goto(`${APP}/admin/admins/new`, { waitUntil: 'networkidle2' })
  await fill(sa, 'name', 'Duplicate')
  await fill(sa, 'email', regular.email)
  await fill(sa, 'phone', '+966512340001')
  await clickText(sa, 'Add Admin', 'button')
  await waitText(sa, 'already has a Hawkim account')
  assert(await pathname(sa) === '/admin/admins/new', 'left the form')
})

// ---------- 4. Edit Admin ----------
await check('Edit Admin saves name and email (with the sign-in account) and keeps the role', async () => {
  await sa.goto(`${APP}/admin/admins/${added.id}/edit`, { waitUntil: 'networkidle2' })
  await fill(sa, 'name', `Admins renamed ${run}`)
  await fill(sa, 'email', `ad-renamed-${run}@test.invalid`)
  await clickText(sa, 'Save Changes', 'button')
  await waitText(sa, 'Changes saved.', 30000)
  const saved = await profile(added.id)
  assert(saved.full_name === `Admins renamed ${run}` && saved.email === `ad-renamed-${run}@test.invalid`, JSON.stringify(saved))
  const { user } = await ok(service.auth.admin.getUserById(added.id), 'read account')
  assert(user.email === `ad-renamed-${run}@test.invalid`, `sign-in email ${user.email}`)
  assert(saved.user_roles.map((r) => r.role).join() === 'admin', 'role changed')
  added.email = `ad-renamed-${run}@test.invalid`
  added.name = `Admins renamed ${run}`
})
await check('leaving Edit Admin with unsaved changes asks first', async () => {
  await fill(sa, 'phone', '+966512349999')
  await clickText(sa, 'Cancel', 'a')
  await waitText(sa, 'Discard unsaved changes?')
  await clickText(sa, 'Keep Editing', 'button')
  await nextTick()
  assert((await pathname(sa)).endsWith('/edit'), 'left without asking')
})

// ---------- 5. Direct API calls a regular Admin might craft ----------
const regularApi = await apiAs(added.email)
await check('a regular Admin cannot delete, transfer, edit the Super Admin or make staff an Admin through the API', async () => {
  const refusals = [
    [await regularApi.rpc('delete_admin', { p_user_id: regular.id }), '42501', 'super-admin-required'],
    [await regularApi.rpc('transfer_super_admin', { p_recipient: added.id }), '42501', 'super-admin-required'],
    [await regularApi.rpc('update_admin', { p_user_id: superAdmin.id, p_full_name: 'Hijacked', p_phone: '+966512345699' }), '42501', 'super-admin-protected'],
    [await regularApi.rpc('set_user_email', { p_user_id: superAdmin.id, p_email: 'evil@test.invalid', p_apply: false }), '42501', 'super-admin-protected'],
    [await regularApi.rpc('save_user', { p_user_id: staff.id, p_full_name: staff.name, p_phone: '+966500000001', p_position: 'QA Specialist', p_department_id: 'regulatory-affairs', p_roles: ['admin'], p_expected_department_id: 'regulatory-affairs', p_expected_roles: ['author'] }), '23514', 'admin-managed-separately'],
  ]
  for (const [response, code, hint] of refusals) {
    assert(response.error?.code === code && response.error?.hint === hint, `expected ${code}/${hint}, got ${JSON.stringify(response.error)}`)
  }
  const email = await regularApi.functions.invoke('update-user-email', { body: { userId: superAdmin.id, email: 'evil@test.invalid' } })
  assert(email.error, 'update-user-email accepted')
  const { user } = await ok(service.auth.admin.getUserById(superAdmin.id), 'read account')
  assert(user.email === superAdmin.email, 'the Super Admin sign-in email changed')
  assert((await profile(superAdmin.id)).full_name === superAdmin.name, 'the Super Admin was renamed')
  assert(superAdminId() === superAdmin.id, 'the Super Admin moved')
  // …while ordinary admin work still succeeds.
  await ok(regularApi.rpc('update_admin', { p_user_id: regular.id, p_full_name: regular.name, p_phone: '+966500000002' }), 'edit a regular Admin')
})

// ---------- 6. Regular Admin in the UI ----------
const ra = await signIn(added.email)
await check('a regular Admin sees no Delete, and no Edit on the Super Admin', async () => {
  await ra.goto(`${APP}/admin/admins`, { waitUntil: 'networkidle2' })
  await waitText(ra, superAdmin.name)
  assert(!(await ra.evaluate(() => !!document.querySelector('[aria-label^="Delete "]'))), 'a Delete control')
  assert(!(await hasButton(ra, `Edit ${superAdmin.name}`)), 'Edit on the Super Admin')
  assert(await hasButton(ra, `Edit ${regular.name}`), 'no Edit on a regular Admin')
})
await check("a regular Admin gets an explanation instead of the Super Admin's Edit form", async () => {
  await ra.goto(`${APP}/admin/admins/${superAdmin.id}/edit`, { waitUntil: 'networkidle2' })
  await waitText(ra, 'Only the Super Admin can edit')
  assert(!(await ra.$('form')), 'form shown')
  await ra.goto(`${APP}/admin/admins/${regular.id}`, { waitUntil: 'networkidle2' })
  await waitText(ra, regular.name)
  assert(!(await hasButton(ra, 'Make Super Admin')), 'Make Super Admin shown')
})
await check('Staff no longer lists administrators, and keeps working for a regular Admin', async () => {
  await ra.goto(`${APP}/admin/users`, { waitUntil: 'networkidle2' })
  await waitText(ra, staff.name)
  const body = await ra.evaluate(() => document.body.innerText)
  assert(!body.includes(regular.name) && !body.includes(superAdmin.name), 'admins listed on Staff')
})

// ---------- 7. Make Super Admin ----------
await check('Cancel in Transfer Super Admin Role? changes nothing', async () => {
  await sa.goto(`${APP}/admin/admins/${regular.id}`, { waitUntil: 'networkidle2' })
  await clickText(sa, 'Make Super Admin', 'button')
  await waitText(sa, 'Transfer Super Admin Role?')
  await waitText(sa, `Are you sure you want to make ${regular.name} the new Super Admin?`)
  await waitText(sa, 'This change will take effect immediately.')
  await clickText(sa, 'Cancel', 'button')
  await nextTick()
  assert(superAdminId() === superAdmin.id, 'Cancel transferred')
})
await check('Confirm Transfer moves the role at once; the page drops the elevated actions', async () => {
  await clickText(sa, 'Make Super Admin', 'button')
  await clickText(sa, 'Confirm Transfer', 'button')
  await waitText(sa, 'is now the Super Admin', 30000)
  assert(superAdminId() === regular.id, `Super Admin is ${superAdminId()}`)
  assert(ownerSql('select count(*) from public.super_admin;') === '1', 'not exactly one')
  assert(!(await hasButton(sa, 'Make Super Admin')) && !(await hasButton(sa, `Delete ${regular.name}`)), 'still shows elevated actions')
  const audit = ownerSql(`select details->>'previousSuperAdminId' || ',' || (details->>'newSuperAdminId') from public.organization_management_audit where action = 'transfer-super-admin' order by id desc limit 1;`)
  assert(audit === `${superAdmin.id},${regular.id}`, `audit ${audit}`)
})
await check("the former Super Admin's open session can no longer delete or transfer", async () => {
  const former = await apiAs(superAdmin.email)
  const del = await former.rpc('delete_admin', { p_user_id: added.id })
  const again = await former.rpc('transfer_super_admin', { p_recipient: added.id })
  assert(del.error?.hint === 'super-admin-required' && again.error?.hint === 'super-admin-required', JSON.stringify([del.error, again.error]))
  assert((await profile(added.id)).deleted_at === null, 'deleted anyway')
})

// ---------- 8. Delete Admin ----------
const next = await signIn(regular.email)
await check('the new Super Admin deletes the former one after confirming', async () => {
  await next.goto(`${APP}/admin/admins`, { waitUntil: 'networkidle2' })
  await waitText(next, superAdmin.name)
  await (await next.waitForSelector(`[aria-label="Delete ${superAdmin.name}"]`)).click()
  await waitText(next, 'Delete Admin?')
  await waitText(next, superAdmin.email)
  await clickText(next, 'Delete', 'button')
  await waitText(next, `${superAdmin.name} deleted.`, 30000)
  const saved = await profile(superAdmin.id)
  assert(saved.deleted_at, 'not deleted')
  assert(saved.full_name === superAdmin.name, 'history lost the name')
})

// ---------- 9. Small screens ----------
await check('Admins fits a phone screen without horizontal scrolling', async () => {
  const phone = await signIn(regular.email, 390)
  await phone.goto(`${APP}/admin/admins`, { waitUntil: 'networkidle2' })
  await waitText(phone, regular.name)
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert(overflow <= 0, `overflows by ${overflow}px`)
  await (await phone.waitForSelector('button[aria-label="Open menu"]')).click()
  await phone.waitForSelector('::-p-xpath(//dialog//button[@aria-expanded="true" and contains(normalize-space(.),"Manage Organization")])', { timeout: 10000 })
})

await browser.close()
console.log(results.join('\n'))
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
