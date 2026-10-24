#!/usr/bin/env node
/**
 * check-host-locale-contract — a HOST that passes profile-config.locale gets that language.
 *
 * THE CONTRACT. `profile-config.locale` is how a host page (the Nuxt site, a WordPress embed) tells
 * an element which language to speak — ProfileLoader.vue reads it and drives the element's i18n. It
 * does that through `inject('appI18n', null)`: a bundle whose index.js never `app.provide('appI18n')`
 * hands ProfileLoader a null, the watchEffect does nothing, and the host's locale is SILENTLY
 * IGNORED — no error, just English. Found in source 2026-09-25 in six bundles; this gate is what keeps
 * the durable fix (createAppI18n's install provides appI18n itself) from quietly regressing.
 *
 * HOW, per leaf of every profile in the manifest (public/doxa-maps/<bundle>/<profile>/index.html):
 *   HOST  the leaf page with ONE change — "locale":"ar" added to its BASE_CONFIG (the object it passes
 *         as profile-config). No ?lang=, and the page keeps its baked <html lang="en">, so the ONLY
 *         route to Arabic is the host contract under test.
 *   REF   the same leaf with ?lang=ar (read by detectLocale when the instance is created — a different
 *         path that does not depend on appI18n being provided). It answers "does this page HAVE
 *         Arabic chrome to show?", so a page with no translatable text is reported n/a, not failed.
 *   Arabic-script characters (U+0600–U+06FF) are counted over every text node and the placeholder /
 *   aria-label / title attributes, through every shadow root, once the count stops changing.
 * VERDICT per leaf: HOST ≥ half of REF → ok · otherwise FAIL · REF < MIN → n/a (nothing to judge),
 *   unless HOST ≥ MIN: then the contract holds and it is ?lang= the page ignores (ok, noted host-only).
 * SETTLE: network idle (capped at 20 s), then the count must hold for 3 s. Measured 2026-09-25: a
 *   shorter settle read the control at 76 in one run and 2054 in the next.
 * TODAY (2026-09-25, before upg100's createAppI18n fix): 18 leaves FAIL — every composite among them.
 * POSITIVE CONTROL: regions-dashboard/regions-list (provides appI18n) must be ok, or the whole run is
 * NOT MEASURED — a harness that cannot see Arabic there cannot say anything about the rest.
 *
 * USAGE  node internal/check-host-locale-contract.mjs [--dir <tree root>] [--only bundle/profile,…]
 *        Serves THIS checkout's public/ on an OS-assigned port, or --dir (another commit's tree, for the
 *        before/after). Run through internal/browser-slot.sh. A FULL run loads every leaf twice and
 *        passed the slot's 900 s default three times, so this gate declares its own limit, which the
 *        wrapper reads from this header:
 *        @browser-slot-max-hold 2700
 * EXIT   0 every judged leaf enters the host's locale · 1 one does not · 75 not measured.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIR = resolve(arg('--dir', resolve(ROOT, 'public')))
const ONLY = arg('--only', '') ? new Set(arg('--only', '').split(',')) : null
const CONTROL = 'regions-dashboard/regions-list'
const MIN = 20            // Arabic characters a page must show under ?lang=ar before it can be judged
const CONCURRENCY = 3

const manifestPath = join(DIR, TREE_NAME, 'manifest.json')
if (!existsSync(manifestPath)) { console.log(`HOST-LOCALE: NOT MEASURED — no ${manifestPath}`); process.exit(75) }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const leaves = []
for (const b of manifest.bundles || []) for (const p of b.profiles || []) {
  const id = `${b.bundle}/${p.profile}`
  if (ONLY && !ONLY.has(id) && id !== CONTROL) continue
  if (existsSync(join(DIR, TREE_NAME, id, 'index.html'))) leaves.push(id)
}
if (!leaves.includes(CONTROL)) { console.log(`HOST-LOCALE: NOT MEASURED — the control ${CONTROL} is not in this tree`); process.exit(75) }

const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', DIR, '--exit-with-parent'], { stdio: 'ignore' })
const stop = () => { try { srv.kill() } catch { /* already gone */ } }
let up = false
for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 150)); up = await fetch(`http://127.0.0.1:${port}/${TREE_NAME}/manifest.json`).then((r) => r.ok).catch(() => false) }
if (!up) { stop(); console.log(`HOST-LOCALE: NOT MEASURED — could not serve ${DIR}`); process.exit(75) }

const COUNT = `(() => {
  let n = 0; const AR = /[\\u0600-\\u06FF]/g
  const add = (s) => { if (s) { const m = String(s).match(AR); if (m) n += m.length } }
  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let node = tw.currentNode; node; node = tw.nextNode()) {
      if (node.nodeType === 3) { add(node.nodeValue); continue }
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue
      for (const a of ['placeholder', 'aria-label', 'title']) add(node.getAttribute && node.getAttribute(a))
      if (node.shadowRoot) walk(node.shadowRoot)
    }
  }
  walk(document); return n
})()`

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
async function measure(id, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const url = `http://127.0.0.1:${port}/${TREE_NAME}/${id}/index.html${mode === 'ref' ? '?lang=ar' : ''}`
  let injected = mode === 'ref'
  if (mode === 'host') {
    await page.route(url, async (route) => {
      const res = await route.fetch()
      const html = await res.text()
      const out = html.replace(/var BASE_CONFIG = \{/, 'var BASE_CONFIG = {"locale":"ar",')
      injected = out !== html
      await route.fulfill({ response: res, body: out })
    })
  }
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    // SETTLE. A first version stopped after three equal reads 500 ms apart and read the control at 76
    // Arabic characters in one run and 2054 in another: regions-list's feed takes over a second, and
    // the page sat still (in English placeholders) until it arrived. So: wait for the network to go
    // quiet (capped — a map streams tiles for ever), then require the count to hold for 3 s.
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    let last = -1, same = 0, n = 0
    for (let i = 0; i < 60 && same < 6; i++) {
      await page.waitForTimeout(500)
      n = await page.evaluate(COUNT).catch(() => 0)
      same = n === last ? same + 1 : 0; last = n
    }
    return { n, injected }
  } catch (e) { return { n: null, injected, error: String(e.message || e).split('\n')[0] } }
  finally { await ctx.close() }
}

const rows = []
async function judge(id) {
  const host = await measure(id, 'host'), ref = await measure(id, 'ref')
  let verdict, why = host.error || ref.error || (!host.injected ? 'no BASE_CONFIG in the page' : '')
  if (!host.injected) verdict = 'unmeasured'                     // the page has no BASE_CONFIG to set
  else if (host.n === null || ref.n === null) verdict = 'unmeasured'
  // ?lang=ar showed no Arabic but the host path did: the page is translatable and the CONTRACT holds;
  // it is ?lang= that page ignores — a different defect, reported, not failed here.
  else if (ref.n < MIN && host.n >= MIN) { verdict = 'ok'; why = 'host-only: this page ignores ?lang=' }
  else if (ref.n < MIN) verdict = 'n/a'
  else verdict = host.n >= ref.n / 2 ? 'ok' : 'FAIL'
  rows.push({ id, host: host.n, ref: ref.n, verdict, why })
}
// The control runs ALONE first, so it is never starved by three maps loading beside it.
await judge(CONTROL)
const queue = leaves.filter((l) => l !== CONTROL)
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await judge(queue.shift()) }))
await browser.close(); stop()

rows.sort((a, b) => (a.id === CONTROL ? -1 : b.id === CONTROL ? 1 : a.id.localeCompare(b.id)))
console.log(`HOST-LOCALE: profile-config.locale="ar" (HOST) vs ?lang=ar (REF), Arabic-script characters drawn, ${DIR}`)
for (const r of rows) console.log(`  ${r.verdict.padEnd(10)} ${r.id.padEnd(48)} host ${String(r.host ?? '—').padStart(5)}  ref ${String(r.ref ?? '—').padStart(5)}${r.id === CONTROL ? '   ← positive control' : ''}${r.why ? '  ' + r.why : ''}`)

const control = rows.find((r) => r.id === CONTROL)
if (!control || control.verdict !== 'ok') {
  console.log(`HOST-LOCALE: NOT MEASURED — the positive control ${CONTROL} did not enter Arabic (host ${control && control.host}, ref ${control && control.ref}); this harness cannot judge the rest.`)
  process.exit(75)
}
const fails = rows.filter((r) => r.verdict === 'FAIL'), un = rows.filter((r) => r.verdict === 'unmeasured'), na = rows.filter((r) => r.verdict === 'n/a')
if (fails.length) {
  console.log(`HOST-LOCALE: FAIL — ${fails.length} leaf/leaves ignore the host's profile-config.locale although they can speak Arabic: ${fails.map((r) => r.id).join(', ')}`)
  console.log('  The usual cause: the bundle never provides appI18n, so ProfileLoader\'s inject(\'appI18n\') is null.')
  process.exit(1)
}
if (un.length) { console.log(`HOST-LOCALE: NOT MEASURED — ${un.length} leaf/leaves could not be read: ${un.map((r) => r.id).join(', ')}`); process.exit(75) }
console.log(`HOST-LOCALE: PASS — ${rows.length - na.length} leaves enter the host's locale; ${na.length} have no Arabic chrome to judge (n/a).`)
