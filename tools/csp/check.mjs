#!/usr/bin/env node
/**
 * CSP check against the real thing.
 *
 * The Content-Security-Policy lives in `client/nginx.conf`, and nothing in the
 * normal loop ever meets it: unit tests read files, the E2E suite runs against
 * the Vite dev server, and Vite sends no such header. A wrong policy therefore
 * passes every build and fails only the served page, in production.
 *
 * `client/src/test/csp.test.ts` pins the policy to the app (no inline script, no
 * remote origin, no eval). What it cannot answer is whether the built client
 * actually runs behind the header nginx sends. This does: it brings up the
 * production-style stack, loads the page in a real browser, and creates a room.
 * The waiting room only appears after a WebSocket round trip, so reaching it is
 * the proof that connect-src lets the one connection the game is made of
 * through. Console errors, failed requests and securitypolicyviolation events
 * are all collected on the way.
 *
 * Usage (from repo root):
 *   node tools/csp/check.mjs                 # up --build, check, down
 *   node tools/csp/check.mjs --keep          # leave the stack running
 *   node tools/csp/check.mjs --url=http://localhost:3000/   # check what is already up
 *
 * Playwright is resolved from e2e/node_modules (already installed for the E2E
 * suite) so this adds no dependency to the client.
 */
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const PORT = Number(args.port ?? 3000)
const URL_ = typeof args.url === 'string' ? args.url : `http://localhost:${PORT}/`
/** With --url the stack is somebody else's to manage. */
const OWN_STACK = typeof args.url !== 'string'
const KEEP = Boolean(args.keep)

function compose(...argv) {
  const r = spawnSync('docker', ['compose', ...argv], { cwd: ROOT, stdio: 'inherit', shell: false })
  if (r.status !== 0) {
    throw new Error(`docker compose ${argv.join(' ')} failed (${r.status ?? r.error?.message})`)
  }
}

/**
 * Bring the stack up, and treat the SPA answering as the readiness signal
 * rather than the exit of `docker compose up -d`. The two are not the same: on
 * Docker Desktop for Windows the start phase can sit there for minutes after
 * the containers exist, and the page is serving long before it returns. This
 * still fails loudly if compose itself errors out.
 */
async function bringUp(url, timeoutMs = 300_000) {
  const child = spawn('docker', ['compose', 'up', '--build', '-d'], { cwd: ROOT, stdio: 'inherit' })
  let composeError = null
  child.on('exit', code => {
    if (code !== 0) composeError = new Error(`docker compose up exited ${code}`)
  })
  try {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        if ((await fetch(url, { redirect: 'manual' })).ok) return
      } catch {
        // not up yet
      }
      if (composeError) throw composeError
      if (Date.now() > deadline) throw new Error(`${url} never answered`)
      await new Promise(r => setTimeout(r, 1000))
    }
  } finally {
    child.kill()
  }
}

async function check(url) {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  const problems = []
  page.on('console', m => {
    const t = m.text()
    // Chromium reports a blocked resource as a console error ("Refused to …"),
    // which is the only trace some violations leave.
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(t)) {
      problems.push(`[console.${m.type()}] ${t}`)
    }
  })
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', r => problems.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`))
  page.on('websocket', ws => ws.on('socketerror', e => problems.push(`[websocket] ${e}`)))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      ;(window.__CSP__ ??= []).push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`)
    })
  })

  const sockets = []
  page.on('websocket', ws => sockets.push(ws.url()))

  const res = await page.goto(url, { waitUntil: 'networkidle' })
  const headers = res.headers()
  for (const name of [
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ]) {
    if (!headers[name]) problems.push(`missing header: ${name} (is nginx serving client/nginx.conf?)`)
  }

  // Creating a room is the first thing that needs the socket.
  await page.getByRole('button', { name: /New table|Nouvelle table/ }).click()
  await page.getByPlaceholder(/Your name|Ton pseudo/i).fill('CspProbe')
  await page.getByRole('button', { name: /Open the table|Ouvrir la table/ }).click()

  let reachedWaitingRoom = true
  try {
    await page.getByText(/The table|La table/i).first().waitFor({ timeout: 10_000 })
  } catch {
    reachedWaitingRoom = false
    problems.push('never reached the waiting room: the WebSocket round trip did not complete')
    problems.push('page text: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400))
  }

  // Self-hosted via @fontsource, so font-src 'self' has to be enough.
  const fontsLoaded = await page.evaluate(() => document.fonts.size)
  problems.push(...(await page.evaluate(() => window.__CSP__ ?? [])))

  const report = {
    url,
    title: await page.title(),
    csp: headers['content-security-policy'],
    sockets,
    reachedWaitingRoom,
    fontsLoaded,
    problems,
  }
  await browser.close()
  return report
}

let status = 0
try {
  if (OWN_STACK) {
    console.log(`› docker compose up --build -d, then waiting for ${URL_}`)
    await bringUp(URL_)
  }
  const report = await check(URL_)
  console.log(JSON.stringify(report, null, 2))
  status = report.problems.length || !report.reachedWaitingRoom ? 1 : 0
  console.log(status ? '\n✗ the policy blocks something' : '\n✓ clean under the served CSP')
} catch (err) {
  console.error(err.message)
  status = 1
} finally {
  if (OWN_STACK && !KEEP) compose('down')
}
process.exit(status)
