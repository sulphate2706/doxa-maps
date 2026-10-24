#!/usr/bin/env node
/**
 * check-studio-every-plugin — open EVERY plugin in the plugin studio and fail on any that is broken.
 *
 * USAGE:   bun run check:studio-all -- --url http://localhost:5299/            (dev server)
 *          bun run check:studio-all -- --url http://localhost:5478/index.html  (built tree, serve-strict)
 * Graded by EXIT CODE: 0 = every plugin mounted with content, 1 = at least one failed.
 *
 * ★ WHY THIS EXISTS WHEN smoke:studio ALREADY DOES. smoke:studio samples 4 tabs by index. On
 *   2026-09-25 a first-run sweep of all 35 found people-groups-grid rendering 2 DOM nodes and a page
 *   error — standalone, in the studio and inside two composites — and 13 plugins mounting with
 *   their data 404ing on a fresh clone. The sample had passed. A plugin the gift ships must be
 *   checked, not sampled; this takes ~2 minutes.
 *
 * WHAT FAILS A PLUGIN (each measured on a real defect, none guessed):
 *   - the studio's own error overlay ("Could not load …") — the element never registered
 *   - a page error while that plugin was active (the i18n crash above)
 *   - a failed request (4xx/5xx) while it was active — a data file that is missing is a plugin
 *     that looks empty. Mapbox tile/event hosts are excluded: a URL-restricted token 403s there
 *     and that is a deployment setting, not a plugin defect.
 *   - a mount with almost nothing in it (< 8 elements and < 50 characters): the blank grid was 2.
 *
 * --url is REQUIRED. Several gates here hardcode :5173, and a drifted dev server made them measure
 * another worktree's tree — so this one refuses to guess.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const i = process.argv.indexOf('--url')
const URL_ = i > -1 ? process.argv[i + 1] : ''
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(URL_, ROOT, 'STUDIO-EVERY-PLUGIN')
if (!URL_) {
  console.error('check-studio-every-plugin: pass --url <studio page>, e.g. --url http://localhost:5299/')
  process.exit(2)
}
const PER_PLUGIN_MS = Number(process.env.STUDIO_ALL_WAIT_MS || 16000)
const IGNORE_HOSTS = /(^|\.)(api\.mapbox\.com|events\.mapbox\.com|tiles\.mapbox\.com)$/

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
let current = '(page load)'
const seen = {}
const note = (kind, v) => { const s = (seen[current] = seen[current] || { errors: [], failed: [] }); s[kind].push(v) }
// Keep the top of the STACK, not just the message: a message like "reading 'getRootNode'" names no
// caller, and the owner cannot fix it without knowing which call site threw (asked 2026-09-25).
page.on('pageerror', (e) => {
  const frames = String(e.stack || '').split('\n').slice(1, 5).map((l) => l.trim().replace(/https?:\/\/[^/]+/, '').replace(/\?v=[0-9a-f]+/, '')).join(' <- ')
  note('errors', String(e.message || e).slice(0, 160) + (frames ? '  [' + frames + ']' : ''))
})
page.on('response', (r) => {
  if (r.status() < 400) return
  let host = ''
  try { host = new URL(r.url()).hostname } catch (_) { /* keep '' */ }
  if (IGNORE_HOSTS.test(host)) return
  note('failed', r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 100))
})

await page.goto(URL_, { waitUntil: 'networkidle' })
try {
  await page.waitForFunction(() => {
    const s = document.querySelector('plugin-studio')
    return !!(s && s.shadowRoot && s.shadowRoot.querySelector('.st-row[aria-level="2"]'))
  }, null, { timeout: 30000 })
} catch (_) {
  console.error('STUDIO-ALL: FAIL — no <plugin-studio> with a plugin tree at ' + URL_)
  await browser.close(); process.exit(1)
}

// Every PLUGIN row (aria-level 2 = a plugin in its capability section; deeper rows are parts that
// open one of these same plugins, and level 1 is a section header).
const rows = await page.evaluate(() => [...document.querySelector('plugin-studio').shadowRoot
  .querySelectorAll('.st-row[aria-level="2"]')].map((r) => r.querySelector('.st-label').textContent.trim() + ' <' + r.querySelector('.st-desc').textContent.trim() + '>'))

const results = []
for (let n = 0; n < rows.length; n++) {
  current = rows[n]
  await page.evaluate((n) => document.querySelector('plugin-studio').shadowRoot.querySelectorAll('.st-row[aria-level="2"]')[n].click(), n)
  let r = null
  const deadline = Date.now() + PER_PLUGIN_MS
  // Poll until the pane has real content, errors, or time runs out — a fixed sleep would either be
  // too slow for the whole run or too short for a map.
  while (Date.now() < deadline) {
    await page.waitForTimeout(400)
    r = await page.evaluate(() => {
      const s = document.querySelector('plugin-studio').shadowRoot
      const pane = [...s.querySelectorAll('.ps-pane')].find((x) => !x.hidden)
      const hint = pane && pane.querySelector('.ps-hint')
      const host = pane && pane.querySelector('.ps-slot') && pane.querySelector('.ps-slot').children[0]
      let nodes = 0
      const walk = (root) => { for (const e of root.querySelectorAll('*')) { nodes++; if (e.shadowRoot) walk(e.shadowRoot) } }
      if (host) walk(host.shadowRoot || host)
      const text = host ? ((host.shadowRoot || host).textContent || '').replace(/\s+/g, ' ').trim().length : 0
      return { hint: hint ? hint.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : '', nodes, text }
    })
    if (r.hint.startsWith('Could not') || r.nodes > 40) break
  }
  const s = seen[current] || { errors: [], failed: [] }
  const why = []
  if (r.hint && !r.hint.startsWith('Loading')) why.push(r.hint)
  if (r.nodes < 8 && r.text < 50) why.push('mounted almost nothing (' + r.nodes + ' elements)')
  if (s.errors.length) why.push('page error: ' + [...new Set(s.errors)].join(' / '))
  if (s.failed.length) why.push('failed requests: ' + [...new Set(s.failed)].slice(0, 3).join(' , '))
  results.push({ row: current, nodes: r.nodes, why })
}
await browser.close()

const bad = results.filter((x) => x.why.length)
for (const x of results) console.log((x.why.length ? 'FAIL ' : 'ok   ') + x.row.padEnd(60) + (x.why.length ? '  ' + x.why.join(' | ') : '  ' + x.nodes + ' elements'))
const loadErr = seen['(page load)']
if (loadErr && (loadErr.errors.length || loadErr.failed.length)) console.log('page load: ' + [...loadErr.errors, ...loadErr.failed].slice(0, 4).join(' | '))
console.log(bad.length
  ? 'STUDIO-ALL: FAIL — ' + bad.length + ' of ' + results.length + ' plugins broken at ' + URL_
  : 'STUDIO-ALL: PASS — all ' + results.length + ' plugins mounted with content, no page errors, no failed requests, at ' + URL_)
process.exit(bad.length ? 1 : 0)
