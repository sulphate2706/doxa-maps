#!/usr/bin/env node
/**
 * check-embedded-rtl — an RTL locale must turn the PLUGIN right-to-left, and must NEVER
 * turn the PARTNER'S PAGE right-to-left.
 *
 * ⚠ THE TWO DEFECTS BELOW WERE FIXED. This section is HISTORY, kept because it explains what the
 * check asserts and why — not a description of the code today. Read it in the past tense; verified
 * against main 2026-09-28.
 *
 * WHAT USED TO BE WRONG, both in one block (library/i18n/index.js, createAppI18n):
 *  1. TIMING. It reflected RTL at CONSTRUCTION time from detectLocale(), which reads only the URL
 *     and <html lang>. A locale arriving later through profile-config — the channel a HOST uses —
 *     never reached it, so Arabic text rendered inside a left-to-right layout. Measured at the time:
 *     htmlDir null on every host-channel run, including leaves whose chrome was fully Arabic.
 *  2. TARGET. It wrote document.documentElement.dir unconditionally. An EMBEDDED widget doing that
 *     flips the partner's WHOLE PAGE. The comment of the day worried about the host ("a WordPress
 *     RTL theme owns that decision") but guarded only against CLEARING dir, not against setting it.
 *
 * HOW THEY WERE FIXED, and where to look before believing either is still live:
 *  - (2) library/i18n/index.js guards the documentElement write with
 *    `const ownsPage = window.MAP_OWNS_PAGE === true`, so only a page the plugin OWNS gets <html
 *    dir>/<html lang>. An embed cannot touch the partner's page. (lang travels with dir there: an
 *    owned page that flipped to rtl while keeping lang="en" had a screen reader speak Arabic in an
 *    English voice.)
 *  - (1) direction on the plugin's own root is ProfileLoader's job, not this block's:
 *    ProfileLoader.vue computes dirAttr from effectiveLocale and binds :dir="dirAttr" on
 *    .profile-loader (see its :208 and :285). effectiveLocale is `lang.value || appI18n locale ||
 *    'en'`, and lang.value IS the profile-config channel — so a host-supplied locale does flip the
 *    embedded root.
 *
 * ★ A STALE HEADER IS A TRAP, WHICH IS WHY THIS ONE IS DATED. Written in the present tense, this
 * block read as a live defect long after both were fixed, and cost a reader a wrong bug report:
 * the header was cited as current instead of the code being read. A gate's header is evidence of
 * what WAS true when it was written. If you are about to act on one, check the source it names.
 *
 * SO WHAT THIS CHECK ASSERTS, which has not changed: direction belongs on the plugin's OWN element,
 * driven by the locale ProfileLoader actually applies; <html dir> stays only where the plugin owns
 * the page (a standalone leaf). It reads .profile-loader inside the shadow root for the plugin's
 * own direction, and records partnerHtmlDir separately, because for an embed that one must stay
 * unset.
 *
 * ⚠ THE HOST PAGE IS ON A DIFFERENT ORIGIN, deliberately: same-origin would let a bug pass that
 * only bites a real partner. The tree is served on one port, the partner page on another.
 *
 * Usage: node internal/check-embedded-rtl.mjs [baseUrl]
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { createServer } from 'node:http'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// ⚠ FILTER FLAGS OUT OF THE POSITIONAL. `--emit` was consumed as the baseUrl and the gate
// reported "SKIP — nothing served at --emit". Exactly the bug I hit on check-leaf-english-leaks
// last week; the same shape, in a different file, three days apart.
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--'))
  || process.env.BASE_URL || 'http://127.0.0.1:4173'
const HOST_PORT = Number(process.env.RTL_HOST_PORT || 47393)
// ★ --emit WRITES THE PARTNER PAGE TO DISK INSTEAD OF MEASURING IT.
// Under the Playwright policy (2026-09-25) only the browser seat runs a browser, so this check's
// result now has to be produced by someone else's eyes. But the partner page only ever existed
// INSIDE this process — two createServer calls on ephemeral ports — so "open a partner page at a
// foreign origin" was not a thing anyone could actually do. NEEDS-EYES rows 3, 4 and 6 name a
// runnable probe or an exact URL; row 7 (mine) named a construct that lived in my own memory.
// --emit closes that: it writes a self-contained page plus a two-line serve recipe, so the item
// is reproducible by whoever has the browser.
const EMIT = process.argv.includes('--emit')

let reachable = false
try { const r = await fetch(`${BASE}/${TREE_NAME}/manifest.json`, { signal: AbortSignal.timeout(4000) }); reachable = r.ok } catch { /* precondition */ }
if (!reachable) { console.log(`EMBEDDED-RTL: SKIP — nothing served at ${BASE}.`); process.exit(0) }
const treeCheck = await servesThisTree(BASE, ROOT)
if (!treeCheck.ok) { console.error(`EMBEDDED-RTL: NOT MEASURED — ${treeCheck.why}`); process.exit(2) }

// A PARTNER PAGE on a foreign origin: its own <html dir> is LTR and must stay that way.
// ⚠ BOTH CHANNELS. profile-config is how a HOST sets the language; ?lang= on the partner's OWN
// url is how a READER does, and detectLocale() reads the URL FIRST. They reach the
// document-direction code by different routes, so a check that drives only one proves nothing
// about the other — which is why the URL case exists as a row here rather than as a variant of
// the config one. The emit writes a fixture per row, so this array IS the needs-eyes inventory.
const CASES = [
  { id: 'my-upg-100-list', tag: 'my-upg-100-list-map', profile: 'upg-100-mfe' },
  { id: 'my-upg-100-list', tag: 'my-upg-100-list-map', profile: 'poster-wall' },
  { id: 'my-upg-100-list', tag: 'my-upg-100-list-map', profile: 'poster-wall', urlLang: 'ar' },
]
const TREE_PORT = Number(process.env.RTL_TREE_PORT || 47395)
const TREE = `http://127.0.0.1:${TREE_PORT}`
// ⚠ THE URL CASE MUST NOT ALSO SET locale IN profile-config. The two channels reach the
// document-dir code by different routes and the whole point of the ?lang= case is to exercise the
// URL one alone. Emitting all three files byte-identical (measured: 1114 bytes each) would hand a
// reader a page that cannot distinguish them — and would let the config channel supply the locale
// while the reader believed the URL had.
const hostHtml = (c) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>partner</title>
<style>html,body{margin:0}#w{height:900px}</style></head>
<body><h1 id="partner-heading">Partner page</h1><div id="w"></div>
<!-- A REAL PARTNER EMBED SETS THIS. The generated leaf pages bake window.MAP_APP_API_URL, and
     without it every data fetch resolves same-origin against the partner and fails, so the wall
     renders zero cards and the locale has nothing to translate. The first run of this gate
     omitted it and reported "never mounted" — a harness gap, not the RTL defect. -->
<script>window.MAP_APP_API_URL = "https://pray.doxa.life";<\/script>
<script src="${TREE}/${TREE_NAME}/${c.id}/${c.id}.js" crossorigin="anonymous"><\/script>
<script>
  var el = document.createElement(${JSON.stringify(c.tag)});
  el.setAttribute('profile-config', JSON.stringify({ profile: ${JSON.stringify(c.profile)}${c.urlLang ? '' : ", locale: 'ar'"},
    assetsBase: ${JSON.stringify(TREE + `/${TREE_NAME}/assets`)} }));
  el.style.cssText = 'display:block;width:100%;height:900px';
  document.getElementById('w').appendChild(el);
<\/script></body></html>`

// ⚠ THE TREE NEEDS CORS HEADERS OR THE SCRIPT NEVER LOADS. A partner embed uses
// crossorigin="anonymous" (SRI requires it), so the browser demands
// Access-Control-Allow-Origin from the tree's origin. `bun run serve` does not send it, and the
// first runs of this gate reported "the element never mounted" — which was MY HARNESS, not the
// product: a real CDN sends the header. So proxy the tree through our own CORS-enabled port.
const proxy = createServer(async (req, res) => {
  try {
    const up = await fetch(BASE + req.url)
    const body = Buffer.from(await up.arrayBuffer())
    res.writeHead(up.status, {
      'content-type': up.headers.get('content-type') || 'application/octet-stream',
      'access-control-allow-origin': '*',
    })
    res.end(body)
  } catch { res.writeHead(502); res.end('upstream') }
})
await new Promise((r) => proxy.listen(TREE_PORT, '127.0.0.1', r))

const srv = createServer((req, res) => {
  const which = (req.url || '').replace(/^\/+/, '').split('?')[0] || '0'
  const c = CASES[Number(which)] || CASES[0]
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(hostHtml(c))
})
await new Promise((r) => srv.listen(HOST_PORT, '127.0.0.1', r))

if (EMIT) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  // ⚠ documentation/, NOT _qa-cycle/. _qa-cycle is GITIGNORED (.gitignore:113), so pages written
  // there cannot travel to whoever has the browser — which is the entire point of emitting them.
  // documentation/ is tracked and already carries README-embed-example.md, so a partner-embed
  // fixture belongs beside it.
  const outDir = resolve(ROOT, 'documentation/needs-eyes')
  mkdirSync(outDir, { recursive: true })
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    const name = `partner-${c.profile}${c.urlLang ? `-lang-${c.urlLang}` : ''}.html`
    writeFileSync(resolve(outDir, name), hostHtml(c))
    console.log(`  wrote documentation/needs-eyes/${name}`
      + `${c.urlLang ? `   open it WITH ?lang=${c.urlLang}` : ''}`)
  }
  console.log('\n  HOW TO USE (two terminals, and the ORIGINS MUST DIFFER — same-origin hides the bug):')
  console.log(`    1) serve the tree WITH CORS on ${TREE_PORT}:`)
  console.log(`       npx http-server public -p ${TREE_PORT} --cors -s`)
  console.log(`    2) serve this folder on ${HOST_PORT}:`)
  console.log(`       npx http-server documentation/needs-eyes -p ${HOST_PORT} -s`)
  console.log(`    3) open http://127.0.0.1:${HOST_PORT}/partner-poster-wall-lang-ar.html?lang=ar`)
  console.log('\n  WHAT TO LOOK AT: the partner page\'s own heading, "Partner page", must stay')
  console.log('  LEFT-aligned and its <html dir> unset — while the plugin below it mirrors RTL.')
  console.log('  If the heading jumps to the right, the embed flipped its host and this FAILED.')
  process.exit(0)
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const WALK = `(root)=>{const o=[];const rec=(r)=>{for(const e of r.querySelectorAll('*')){o.push(e);if(e.shadowRoot)rec(e.shadowRoot)}};rec(root);return o}`
const rows = []
const fails = []

for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i]
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  await page.goto(`http://127.0.0.1:${HOST_PORT}/${i}`, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(17000)
  const r = await page.evaluate(`(() => {
    const all = (${WALK})(document)
    const host = document.querySelector('${c.tag}')
    const sr = host && host.shadowRoot
    const root = sr && sr.querySelector('.profile-loader')
    const dirOf = (e) => { if (!e) return null
      const own = e.getAttribute && e.getAttribute('dir'); if (own) return own
      try { return getComputedStyle(e).direction } catch { return null } }
    const arabic = (s) => (String(s).match(/[\\u0600-\\u06FF]/g) || []).length
    const chromeText = all.filter((e) => /\\b(pbtn|tape-h|seg|wall-h|wall-tag)\\b/.test(e.className || '')
                                      || e.tagName === 'LEGEND')
      .map((e) => (e.textContent || '').trim()).join(' ')
    return {
      partnerHtmlDir: document.documentElement.getAttribute('dir'),
      partnerBodyDir: getComputedStyle(document.body).direction,
      partnerHeadingDir: getComputedStyle(document.getElementById('partner-heading')).direction,
      elementDir: dirOf(host),
      pluginRootDir: dirOf(root),
      arabicChrome: arabic(chromeText),
      mounted: !!sr,
    }
  })()`)
  await page.close()
  rows.push({ profile: c.profile, ...r, errs: errs.length })

  if (!r.mounted) { fails.push(`${c.profile}: the element never mounted — nothing to judge`); continue }
  // The element must not be judged on a page where the locale never took effect.
  if (!r.arabicChrome) { fails.push(`${c.profile}: 0 Arabic chrome — the locale did not apply, so direction cannot be assessed`); continue }
  if (r.partnerHtmlDir === 'rtl' || r.partnerBodyDir === 'rtl' || r.partnerHeadingDir === 'rtl') {
    fails.push(`${c.profile}: THE PARTNER'S PAGE WENT RTL (html=${r.partnerHtmlDir}, body=${r.partnerBodyDir}, heading=${r.partnerHeadingDir}) — an embedded widget must never flip its host`)
  }
  if (r.pluginRootDir !== 'rtl' && r.elementDir !== 'rtl') {
    fails.push(`${c.profile}: the plugin did NOT go RTL (element=${r.elementDir}, root=${r.pluginRootDir}) while its chrome is Arabic (${r.arabicChrome} chars)`)
  }
  if (errs.length) fails.push(`${c.profile}: ${errs.length} page error(s) — ${errs[0]}`)
}
await browser.close(); srv.close(); proxy.close()

console.log('EMBEDDED-RTL')
console.log(`  tree   : ${BASE}`)
console.log(`  partner: http://127.0.0.1:${HOST_PORT} (foreign origin, <html lang="en"> no dir)`)
for (const r of rows) {
  console.log(`  ${r.profile}  element dir ${r.elementDir ?? '-'} · plugin root ${r.pluginRootDir ?? '-'} · `
    + `partner html ${r.partnerHtmlDir ?? 'unset'} / body ${r.partnerBodyDir} · arabic ${r.arabicChrome} · ${r.errs} err`)
}
if (fails.length) {
  console.error(`\nEMBEDDED-RTL: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nEMBEDDED-RTL: PASS — the plugin goes RTL and the partner page does not.')
