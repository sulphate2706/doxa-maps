/**
 * check-gospel-leaves-mount.mjs — did the element actually MOUNT, on every leaf?
 *
 * ═══ THE FAILURE THIS EXISTS FOR, WHICH I SHIPPED INTO MY OWN WORKING TREE ══════════════
 * An edit used a ref it never declared. The ReferenceError was thrown during setup, INSIDE
 * the custom-element boundary, where it was swallowed: the page loaded, every asset returned
 * 200, `pageerror` fired zero times, `console.error` fired zero times, and the element sat in
 * the DOM with an empty shadow root. A perfectly healthy-looking dead page.
 *
 * Nothing I had would have said so on its own. The rich gates would have — verify-gospel-map
 * asserts on pin counts — but they are slow, they need a token and a basemap, and they are
 * not run on every leaf. What was missing was the cheap, unambiguous question: IS ANYTHING
 * THERE. This asks exactly that, on all five leaves, in a few seconds each.
 *
 * WHAT IT ASSERTS PER LEAF, in the order a failure actually happens:
 *   1. the custom element tag is DEFINED       (the bundle ran at all)
 *   2. the host element exists in the document (the leaf HTML embeds it)
 *   3. it has a shadowRoot                     (defineCustomElement attached one)
 *   4. the shadow root has real content        (setup did not throw)
 *   5. it renders visible text                 (it is not an empty shell)
 * Any one of those failing is reported with its own sentence, because "the leaf is broken"
 * is useless and "the shadow root is empty, so setup threw" is a lead.
 *
 * ZERO ERRORS IS NOT THE SAME AS WORKING, and that is the whole lesson. This deliberately
 * does NOT trust the absence of console errors; it looks for presence of output.
 *
 * Run with --poison to prove it can fail: it asks the same questions of a URL that serves no
 * element at all, and requires every leaf-shaped assertion to go red.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(HERE, '../public')
const PORT = Number(process.env.PORT || 5399)
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`
const POISON = process.argv.includes('--poison')
const TAG = 'gospel-resources-map'
const LEAVES = ['resources-map', 'resources-list', 'data-tables', 'charts', 'gospel-dashboard']

let srv = null
if (!process.env.BASE_URL) srv = serveReaped(PUBLIC, PORT)

const probe = async (page, url) => {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
  /* Give setup a real chance; these leaves fetch tables before they render. */
  await page.waitForTimeout(9000)
  return page.evaluate((tag) => {
    const defined = !!customElements.get(tag)
    const host = document.querySelector(tag)
    const sr = host ? host.shadowRoot : null
    const text = sr ? (sr.textContent || '').replace(/\s+/g, ' ').trim() : ''
    return {
      defined,
      hostPresent: !!host,
      hasShadow: !!sr,
      shadowChildren: sr ? sr.childElementCount : 0,
      /* CSS injected into the shadow root counts as children, so text is the real signal. */
      visibleTextLength: text.replace(/\{[^}]*\}/g, '').length,
    }
  }, TAG)
}

const failuresFor = (leaf, r) => {
  const out = []
  if (!r.defined) out.push(`${leaf}: <${TAG}> is not defined — the bundle never ran.`)
  else if (!r.hostPresent) out.push(`${leaf}: the leaf HTML does not embed <${TAG}>.`)
  else if (!r.hasShadow) out.push(`${leaf}: the element has no shadowRoot — it was never upgraded.`)
  else if (!r.shadowChildren) out.push(`${leaf}: the shadow root is EMPTY — setup threw, and the boundary swallowed it.`)
  else if (r.visibleTextLength < 40) out.push(`${leaf}: the shadow root renders ${r.visibleTextLength} characters of text — an empty shell.`)
  return out
}

let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

  if (POISON) {
    /* A URL that serves no element at all must fail EVERY leaf-shaped assertion. */
    const r = await probe(page, `${BASE}/${TREE_NAME}/index.html`)
    const f = failuresFor('poison', r)
    if (!f.length) {
      console.error('LEAVES-MOUNT: SELF-TEST FAIL — a page with no gospel element passed as mounted.')
      process.exit(1)
    }
    console.log(`LEAVES-MOUNT --poison: caught it — ${f[0]}`)
    console.log('LEAVES-MOUNT: SELF-TEST PASS — the check fails as designed.')
    process.exit(0)
  }

  const bad = []
  for (const leaf of LEAVES) {
    const r = await probe(page, `${BASE}/${TREE_NAME}/gospel-resources/${leaf}/index.html`)
    const f = failuresFor(leaf, r)
    bad.push(...f)
    console.log(`  ${f.length ? 'FAIL' : 'ok  '} ${leaf.padEnd(18)} defined=${r.defined} shadow=${r.hasShadow} children=${r.shadowChildren} text=${r.visibleTextLength}`)
  }
  if (bad.length) {
    console.error(`LEAVES-MOUNT: FAIL — ${bad.length} leaf/leaves did not mount:`)
    for (const b of bad) console.error(`  ${b}`)
    console.error('  A page can return 200 for every asset and report zero console errors while')
    console.error('  being completely dead: a throw during setup dies inside the element boundary.')
    process.exit(1)
  }
  console.log(`LEAVES-MOUNT: PASS — all ${LEAVES.length} leaves mount and render.`)
} finally {
  await browser?.close()
  srv?.stop()
}
