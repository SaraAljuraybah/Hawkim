// Browser end-to-end test of the 2026-11-20 changes: real Chrome through the UI, against a REAL LOCAL Supabase
// stack and the local dev server. Disposable data only; refuses anything but localhost.
//
//   supabase start && supabase functions serve --env-file <file>   (see README.md in this folder)
//   (frontend) VITE_SUPABASE_URL=<local API URL> VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key> npx vite --port 5179
//   npm install puppeteer-core in any folder (it isn't a project dependency), then:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   PUPPETEER_CORE_DIR=<that folder> CHROME_PATH=<chrome executable> node supabase/tests/default_departments_requests.browser.local.mjs
//
// A new organization (Request Hawkim) with an Author, and a second organization:
//   - Divisions and Departments: the default departments' Delete is disabled with its reason; Edit keeps the name
//     read-only and saves the description and division;
//   - SFDA Regulatory Requirements and the SOP page without a guideline;
//   - Check Compliance: the missing-guideline dialog (no check starts), Submit a Request prefilled, submitted and
//     saved; the processing dialog (OK only);
//   - My Requests after a reload and a new session; the Admin's Requests list, Approve, and the decision after a
//     reload; the other organization never sees the request; the Author cancels a pending request.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { localPeople, owner, lit } from './local_people.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const puppeteerPath = createRequire(`${process.env.PUPPETEER_CORE_DIR ?? '.'}/`).resolve('puppeteer-core')
const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href)
const url = process.env.SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const APP = process.env.HAWKIM_APP_URL ?? 'http://127.0.0.1:5179'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(APP)) {
  console.error('Refusing to run: the Supabase stack and the app must both be local.')
  process.exit(2)
}
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const run = randomUUID().slice(0, 6)
const people = localPeople({ url, anonKey, service, options, run, prefix: 'ui-ddr' })
const db = owner()
const results = []
let failed = 0
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message.split('\n')[0]}`) }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
async function ok(promise, what) { const { data, error } = await promise; if (error) throw new Error(`${what}: ${error.message}`); return data }

// ---------- fixtures ----------
const a = await people.newOrganization('a')
const b = await people.newOrganization('b')
const authorEmail = `ui-ddr-author-${run}@test.invalid`
const authorPassword = `E2e-${randomUUID()}`
{
  const { user } = await ok(service.auth.admin.createUser({ email: authorEmail, password: authorPassword, email_confirm: true }), 'author account')
  await ok(a.admin.client.rpc('add_user', { p_user_id: user.id, p_email: authorEmail, p_full_name: `UI DDR Author ${run}`, p_phone: '+966500000000',
    p_position: 'Officer', p_department_id: a.departments.PV, p_roles: ['author'] }), 'add the author')
}
const author = { email: authorEmail, password: authorPassword }
const authorClient = createClient(url, anonKey, options)
await ok(authorClient.auth.signInWithPassword(author), 'author signs in (API)')
const authorId = (await authorClient.auth.getUser()).data.user.id
const sopTitle = `UI DDR SOP ${run}`
const sopId = await (async () => {
  const path = `${a.id}/${authorId}/${randomUUID()}.pdf`
  await ok(authorClient.storage.from('sop-files').upload(path, new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' }), 'upload')
  return ok(authorClient.rpc('create_sop', { p_title: sopTitle, p_description: '', p_department_id: a.departments.PV, p_storage_path: path, p_file_name: 'a.pdf' }), 'create_sop')
})()
const divisionName = `UI DDR Division ${run}`
const division = await ok(a.admin.client.rpc('save_division', { p_id: null, p_name: divisionName, p_description: 'About', p_email: 'div@hawkim.test' }), 'division')

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] })
async function signIn({ email, password }) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(60000)
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
const waitText = (page, value, timeout = 15000) => page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value)
const pathname = (page) => page.evaluate(() => location.pathname + location.search)
const nextTick = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))
async function clickText(page, label, tag = '*') {
  const element = await page.waitForSelector(`::-p-xpath(//${tag}[normalize-space(.)="${label}"])`, { visible: true })
  await element.click()
}
/** The open <dialog>'s title, text and buttons (null when none is open). */
const openDialog = (page) => page.evaluate(() => {
  const dialog = [...document.querySelectorAll('dialog')].find((d) => d.open)
  return dialog ? { text: dialog.innerText, buttons: [...dialog.querySelectorAll('button')].map((b) => b.innerText.trim()) } : null
})
async function dialogButton(page, label) {
  const button = await page.waitForSelector(`::-p-xpath(//dialog[@open]//button[normalize-space(.)="${label}"])`, { visible: true })
  await button.click()
}
const goto = (page, path) => page.goto(`${APP}${path}`, { waitUntil: 'networkidle2' })
const checks = () => db.rows(`select id from public.compliance_checks where sop_id = ${lit(sopId)}`)

try {
  const admin = await signIn(a.admin)

  // ---------- Divisions and Departments ----------
  await check('Divisions and Departments: the default departments\' Delete is disabled, with the reason; Edit stays available', async () => {
    await goto(admin, '/admin/departments')
    for (const name of ['Pharmacovigilance', 'Quality Assurance']) {
      await admin.click('input[name="organizationSearch"]', { clickCount: 3 })
      await admin.keyboard.press('Backspace')
      await admin.type('input[name="organizationSearch"]', name)
      const del = await admin.waitForSelector(`button[aria-label="Delete ${name}"]`, { visible: true })
      assert(await del.evaluate((b) => b.getAttribute('aria-disabled')) === 'true', `${name}: Delete isn't disabled`)
      const reason = await del.evaluate((b) => document.getElementById(b.getAttribute('aria-describedby') ?? '')?.innerText ?? '')
      assert(reason === 'This is a default department and cannot be deleted.', `${name}: reason "${reason}"`)
      await del.click()
      await nextTick()
      assert(!(await openDialog(admin)), `${name}: a delete dialog opened`)
      const edit = await admin.$(`button[aria-label="Edit ${name}"]`)
      assert(edit && await edit.evaluate((b) => b.getAttribute('aria-disabled')) !== 'true', `${name}: Edit isn't available`)
    }
  })

  await check('Edit Department: a default department\'s name is read-only; its description and division are saved', async () => {
    await goto(admin, `/admin/departments/${encodeURIComponent(a.departments.PV)}/edit`)
    const name = await admin.waitForSelector('input[name="name"]', { visible: true })
    assert(await name.evaluate((i) => i.readOnly && i.value === 'Pharmacovigilance'), 'name is not read-only')
    await waitText(admin, 'The name of a default department cannot be changed.')
    await name.type('X')
    assert(await name.evaluate((i) => i.value) === 'Pharmacovigilance', 'the name could be typed into')
    await admin.select('select[name="division"]', division)
    await admin.click('textarea[name="description"]', { clickCount: 3 })
    await admin.keyboard.press('Backspace')
    await admin.type('textarea[name="description"]', `Drug safety ${run}`)
    await admin.click('input[name="email"]', { clickCount: 3 })
    await admin.keyboard.press('Backspace')
    await admin.type('input[name="email"]', 'pv@hawkim.test')
    await admin.click('button[type="submit"]')
    await admin.waitForFunction(() => !location.pathname.endsWith('/edit'))
    const row = await db.row(`select name, description, division_id, email, system_key, removed_at from public.departments where id = ${lit(a.departments.PV)}`)
    assert(row.name === 'Pharmacovigilance' && row.description === `Drug safety ${run}` && row.division_id === division && row.email === 'pv@hawkim.test'
      && row.system_key === 'pharmacovigilance' && !row.removed_at, `saved: ${JSON.stringify(row)}`)
  })

  await check('SFDA Regulatory Requirements: no version, no Current badge, an action to add the first one', async () => {
    await goto(admin, '/admin/regulations')
    await waitText(admin, 'Your organization has no regulatory guideline yet.')
    const body = await text(admin)
    assert(body.includes('Add the First Version') && body.includes('No versions have been added yet.'), 'empty state')
    assert(!/\bCurrent\b(?! Version)/.test(body.replace('Current Version', '')), `a Current badge: ${body.slice(0, 400)}`)
    assert(!body.includes('GVP Version 4.0'), 'a sample version is shown')
  })

  // ---------- The Author: Check Compliance without a guideline ----------
  const writer = await signIn(author)
  await check('the SOP page says there is no guideline (no sample version); Check Compliance shows the missing-guideline dialog', async () => {
    await goto(writer, `/my-sops/${sopId}`)
    await waitText(writer, 'Your organization has no regulatory guideline yet.')
    assert(!(await text(writer)).includes('SFDA GVP'), 'a sample GVP version is shown')
    assert((await text(writer)).includes('Add SOP'), 'uploading isn\'t available')
    await clickText(writer, 'Compliance Check for Current Version', 'button')
    await writer.waitForSelector('dialog[open]', { visible: true })
    const dialog = await openDialog(writer)
    assert(dialog.text.includes('No Regulatory Guidelines Available') && dialog.text.includes('submit a request to your administrator'), dialog.text)
    assert(JSON.stringify(dialog.buttons) === JSON.stringify(['Cancel', 'Submit a Request']), `buttons ${dialog.buttons}`)
    assert(!(await checks()).length, 'a check was started')
    await dialogButton(writer, 'Cancel')
    await nextTick()
    assert(!(await openDialog(writer)), 'Cancel didn\'t close it')
    assert((await pathname(writer)) === `/my-sops/${sopId}`, 'left the SOP')
    assert(!(await checks()).length, 'a check was started')
  })

  const requestTitle = `Request to Add a Regulatory Guideline`
  await check('Submit a Request opens the form prefilled; nothing is sent until the Author submits; it is saved', async () => {
    await clickText(writer, 'Compliance Check for Current Version', 'button')
    await dialogButton(writer, 'Submit a Request')
    await writer.waitForFunction(() => location.pathname === '/requests/new')
    assert((await pathname(writer)).includes('type=regulatory-guideline-addition'), await pathname(writer))
    await writer.waitForSelector('select[name="type"]')
    assert(await writer.$eval('select[name="type"]', (s) => s.value) === 'regulatory-guideline-addition', 'type not chosen')
    assert(await writer.$eval('input[name="title"]', (i) => i.value) === requestTitle, 'title not filled in')
    const description = await writer.$eval('textarea[name="description"]', (t) => t.value)
    assert(description.includes('no regulatory guideline available') && description.includes(sopTitle), description)
    assert(!(await writer.$('select[name="department"]')), 'a Department field')
    assert(!(await text(writer)).includes('Attachments'), 'an attachments field')
    assert(!(await db.rows(`select id from public.user_requests where requester_id = ${lit(authorId)}`)).length, 'sent before submitting')
    // The Author can change the text before sending.
    await writer.$eval('textarea[name="description"]', (t) => { t.focus(); t.setSelectionRange(t.value.length, t.value.length) })
    await writer.keyboard.type(` (${run})`)
    await clickText(writer, 'Submit Request', 'button')
    await waitText(writer, 'Request Submitted')
    const rows = await db.rows(`select type, title, description, status, organization_id from public.user_requests where requester_id = ${lit(authorId)}`)
    assert(rows.length === 1 && rows[0].type === 'regulatory-guideline-addition' && rows[0].title === requestTitle && rows[0].status === 'pending'
      && rows[0].organization_id === a.id && rows[0].description.endsWith(`(${run})`), JSON.stringify(rows))
    await clickText(writer, `Back to ${sopTitle}`)
    await writer.waitForFunction((id) => location.pathname === `/my-sops/${id}`, {}, sopId)
  })

  await check('while a guideline is being processed: the processing dialog, OK only, no check starts', async () => {
    const draft = randomUUID()
    await db.run(`insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
      processing_status, organization_id) values (${lit(draft)}, 'UI GVP', '1.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp.pdf',
      ${lit(`${a.id}/files/${draft}.pdf`)}, 1, ${lit(a.admin.id)}, 'processing', ${lit(a.id)});`)
    try {
      await goto(writer, `/my-sops/${sopId}`)
      await clickText(writer, 'Compliance Check for Current Version', 'button')
      await writer.waitForSelector('dialog[open]', { visible: true })
      const dialog = await openDialog(writer)
      assert(dialog.text.includes('Regulatory Guideline Processing') && !dialog.text.includes('No Regulatory Guidelines Available'), dialog.text)
      assert(JSON.stringify(dialog.buttons) === JSON.stringify(['OK']), `buttons ${dialog.buttons}`)
      await dialogButton(writer, 'OK')
      await nextTick()
      assert(!(await openDialog(writer)), 'OK didn\'t close it')
      assert(!(await checks()).length, 'a check was started')
    } finally {
      await db.run(`delete from public.guideline_version_drafts where id = ${lit(draft)};`)
    }
  })

  await check('My Requests shows it after a reload and in a new session (type, title, date, Pending)', async () => {
    await goto(writer, '/requests')
    await waitText(writer, requestTitle)
    await writer.reload({ waitUntil: 'networkidle2' })
    await waitText(writer, requestTitle)
    const fresh = await signIn(author)
    await goto(fresh, '/requests')
    await waitText(fresh, requestTitle)
    const body = await text(fresh)
    assert(body.includes('Regulatory Guideline Addition') && body.includes('Pending'), body.slice(0, 600))
    await fresh.browserContext().close()
  })

  await check('another organization\'s Admin never sees it', async () => {
    const other = await signIn(b.admin)
    await goto(other, '/admin/requests')
    await clickText(other, 'All', 'button')
    await nextTick(1500)
    assert(!(await text(other)).includes(requestTitle), 'B sees A\'s request')
    await other.browserContext().close()
  })

  await check('the Admin sees it in Requests, approves it, and the decision stays after a reload; no guideline is added', async () => {
    await goto(admin, '/admin/requests')
    await waitText(admin, requestTitle)
    await clickText(admin, requestTitle, 'a')
    await waitText(admin, 'Approving only records your decision.')
    const page = await text(admin)
    assert(page.includes('Regulatory Guideline Addition') && page.includes(`UI DDR Author ${run}`), page.slice(0, 600))
    await clickText(admin, 'Approve', 'button')
    await dialogButton(admin, 'Approve')
    await waitText(admin, 'Request approved.')
    await admin.reload({ waitUntil: 'networkidle2' })
    await waitText(admin, 'Approved by')
    assert((await db.row(`select status from public.user_requests where requester_id = ${lit(authorId)} and title = ${lit(requestTitle)}`)).status === 'approved', 'not saved')
    assert(!(await db.rows(`select id from public.guideline_versions where organization_id = ${lit(a.id)}`)).length, 'a guideline was added')
  })

  await check('the Author sees it approved, and cancels another pending request from My Requests', async () => {
    await ok(authorClient.rpc('submit_user_request', { p_type: 'regulatory-guideline-addition', p_title: `To cancel ${run}`, p_description: 'Not needed' }), 'second request')
    await goto(writer, '/requests')
    await waitText(writer, `To cancel ${run}`)
    assert((await text(writer)).includes('Approved'), 'the approval isn\'t shown')
    const cancel = await writer.waitForSelector(`::-p-xpath(//li[.//p[normalize-space(.)="To cancel ${run}"]]//button[normalize-space(.)="Cancel Request"])`, { visible: true })
    await cancel.click()
    await dialogButton(writer, 'Cancel Request')
    await writer.waitForFunction((t) => !document.querySelector('li')?.innerText.includes(t) || document.body.innerText.includes('Cancelled'), {}, `To cancel ${run}`)
    await nextTick(1000)
    assert((await db.row(`select status from public.user_requests where title = ${lit(`To cancel ${run}`)}`)).status === 'cancelled', 'not cancelled')
  })

  // ---------- An organization with a published guideline: the check runs as before ----------
  await check('MedCare (a current guideline): Check Compliance starts a real check, with no dialog', async () => {
    const medcare = await people.person('medcare-author', 'pharmacovigilance', ['author'])
    const path = `${medcare.organizationId}/${medcare.id}/${randomUUID()}.pdf`
    await ok(medcare.client.storage.from('sop-files').upload(path, new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' }), 'upload')
    const id = await ok(medcare.client.rpc('create_sop', { p_title: `UI DDR MedCare ${run}`, p_description: '', p_department_id: 'pharmacovigilance',
      p_storage_path: path, p_file_name: 'a.pdf' }), 'create_sop')
    const page = await signIn(medcare)
    await goto(page, `/my-sops/${id}`)
    await waitText(page, 'Compliance Check for Current Version')
    assert(!(await text(page)).includes('Your organization has no regulatory guideline yet.'), 'the empty state is shown')
    await clickText(page, 'Compliance Check for Current Version', 'button')
    await waitText(page, 'Compliance check started.')
    assert(!(await openDialog(page)), 'a dialog opened')
    const started = await db.rows(`select c.guideline_version_id, g.organization_id from public.compliance_checks c
      join public.guideline_versions g on g.id = c.guideline_version_id where c.sop_id = ${lit(id)}`)
    assert(started.length === 1 && started[0].organization_id === medcare.organizationId, `checks: ${JSON.stringify(started)}`)
    await page.browserContext().close()
  })
} finally {
  await browser.close()
  for (const line of results) console.log(line)
  console.log(`${results.length - failed} passed, ${failed} failed`)
}
process.exit(failed ? 1 : 0)
