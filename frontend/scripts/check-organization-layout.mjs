// Local browser regression check for the actual chart/CSS, using test fixtures.
// No Supabase requests or app data; no browser dependency is installed.
// Run: node scripts/check-organization-layout.mjs [output-directory]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = fileURLToPath(new URL('../', import.meta.url))
const browserPath = process.env.HAWKIM_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
assert(browserPath, 'Set HAWKIM_TEST_BROWSER to an installed Chromium browser')
const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(resolve(tmpdir(), 'hawkim-org-layout-'))
mkdirSync(output, { recursive: true })
const profile = mkdtempSync(resolve(tmpdir(), 'hawkim-org-browser-'))
const server = await createServer({ root, appType: 'custom', server: { host: '127.0.0.1', port: 0 } })
let browser
let connection
let closeBrowser
try {
  await server.listen()
  const { OrganizationChart } = await server.ssrLoadModule('/src/components/admin/OrganizationChart.tsx')
  const divisions = [
    { id: 'a', name: 'Clinical Research & Development' }, { id: 'b', name: 'Regulatory & Drug Safety' },
    { id: 'c', name: 'Quality & Compliance' }, { id: 'd', name: 'Corporate Services & Operations' },
  ]
  const departments = Array.from({ length: 9 }, (_, index) => ({
    id: `department-${index}`, name: index === 5 ? 'Legal & Governance' : `Department ${index + 1}`, divisionId: divisions[index % 4].id,
    employees: Array.from({ length: index === 0 ? 18 : 1 }, (_, member) => ({
      id: `employee-${index}-${member}`, name: member === 0 ? 'LongUnbrokenEmployeeNameForOverflowVerification' : `Employee fixture ${member}`,
      initials: 'EF', position: member === 0 ? 'Stored position with a longer descriptive title' : null, permissions: ['author', 'reviewer'],
    })),
  }))
  const renderChart = (hierarchy) => renderToStaticMarkup(createElement(OrganizationChart, { hierarchy }))
  const html = (chart) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/components/admin/organizationChart.css"></head><body class="bg-offwhite"><aside aria-hidden="true" class="fixed inset-y-0 left-0 hidden w-64 bg-maroon lg:block wide:w-72 ultra:w-80"></aside><div class="lg:pl-64 wide:pl-72 ultra:pl-80"><main class="px-4 py-8 sm:px-6 lg:px-10 lg:py-10"><div class="mx-auto w-full max-w-[90rem]"><h1 class="text-2xl sm:text-3xl">Organizational Structure</h1>${chart}</div></main></div></body></html>`
  const standard = html(renderChart({ organization: null, divisions, departments }))
  const fallback = html(renderChart({ organization: null, divisions: [], departments }))
  const extraBranch = html(renderChart({ organization: null, divisions, departments: [...departments, { id: 'unassigned', name: 'Unassigned Department', divisionId: null, employees: [] }] }))
  server.middlewares.use((request, response, next) => {
    const page = { '/__org_layout': standard, '/__org_fallback': fallback, '/__org_extra': extraBranch }[request.url]
    if (!page) return next()
    response.setHeader('Content-Type', 'text/html'); response.end(page)
  })
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 20000)
    browser.once('error', reject)
    browser.stderr.on('data', (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
    })
  })
  connection = new WebSocket(endpoint)
  await new Promise((resolveOpen, reject) => { connection.onopen = resolveOpen; connection.onerror = reject })
  let nextId = 0
  const pending = new Map()
  connection.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  }
  const command = (method, params = {}, sessionId) => new Promise((resolveCommand, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 20000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolveCommand(message.result)
    })
    connection.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  closeBrowser = () => command('Browser.close')
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => command(method, params, sessionId)
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await send('Page.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  for (const path of ['/__org_layout', '/__org_fallback', '/__org_extra']) {
    await send('Page.navigate', { url: origin + path })
    // Wait for all CSS (including Tailwind compilation), without relying on network timing.
    await evaluate(`new Promise(resolve => { const ready = () => document.readyState === 'complete' && document.querySelector('.org-chart') && getComputedStyle(document.querySelector('.org-branches')).display === 'grid'; const poll = () => ready() ? resolve(true) : setTimeout(poll, 30); poll(); })`)
    for (const width of [320, 375, 768, 1024, 1280, 1366, 1440, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
      for (const expanded of [false, true]) {
        await evaluate(`document.querySelectorAll('details').forEach(item => item.open = ${expanded}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
        const measurement = await evaluate(`(() => {
          const chart = document.querySelector('.org-chart');
          const grid = document.querySelector('.org-branches');
          const headers = [...document.querySelectorAll('.org-division-header')];
          return { page: document.documentElement.scrollWidth, viewport: innerWidth, chart: chart.scrollWidth, available: chart.clientWidth,
            columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
            heights: headers.map(item => item.getBoundingClientRect().height),
            matchingInitials: [...chart.querySelectorAll('details li')].every(item => getComputedStyle(item.querySelector('[aria-hidden="true"]')).color === getComputedStyle(item.querySelector('p')).color),
            clipped: [...chart.querySelectorAll('*')].filter(item => !item.classList.contains('sr-only') && item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1).map(item => item.className),
            open: document.querySelectorAll('details[open]').length };
        })()`)
        assert(measurement.page <= width, `${path} ${width}: page overflow ${JSON.stringify(measurement)}`)
        assert(measurement.chart <= measurement.available, `${path} ${width}: chart overflow`)
        assert.deepEqual(measurement.clipped, [], `${path} ${width}: descendant overflow`)
        assert(measurement.matchingInitials, 'Avatar initials and employee names must share the same color')
        assert.equal(measurement.open, expanded ? (path === '/__org_extra' ? 10 : 9) : 0)
        if (path === '/__org_layout' && width >= 1280) {
          assert.equal(measurement.columns, 4)
          assert.equal(new Set(measurement.heights).size, 1, 'Division headers must have equal heights')
        }
        if (path === '/__org_layout' && expanded && [375, 1366].includes(width)) {
          const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
          writeFileSync(resolve(output, `organization-${width}.png`), Buffer.from(screenshot.data, 'base64'))
        }
      }
      console.log(`PASS ${path} at ${width}px: collapsed/expanded, no overflow`)
    }
  }
  // Exercise the native disclosure with actual browser mouse and keyboard input.
  await evaluate("document.querySelectorAll('details').forEach(item => item.open = false)")
  await evaluate("document.querySelector('summary').scrollIntoView({block: 'center'})")
  const point = await evaluate("(() => { const r = document.querySelector('summary').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()")
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  assert.equal(await evaluate("document.querySelector('details').open"), true)
  await evaluate("document.querySelectorAll('summary')[1].focus()")
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await evaluate("document.querySelectorAll('details[open]').length"), 2)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await evaluate("document.querySelectorAll('details[open]').length"), 1)
  console.log(`PASS mouse/keyboard disclosure; screenshots: ${output}`)
} finally {
  if (closeBrowser && connection?.readyState === WebSocket.OPEN) await closeBrowser().catch(() => {})
  connection?.close()
  if (browser && browser.exitCode === null) {
    await new Promise(resolveExit => {
      const timer = setTimeout(() => browser.kill(), 3000)
      browser.once('exit', () => { clearTimeout(timer); resolveExit() })
    })
  }
  await server.close()
  // Only this script's newly created temporary browser profile is removed.
  assert(profile.startsWith(resolve(tmpdir(), 'hawkim-org-browser-')))
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
  catch { console.warn(`Browser profile remains locked; temporary files retained at ${profile}`) }
}
