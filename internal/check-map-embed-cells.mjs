#!/usr/bin/env node
/**
 * check-map-embed-cells — measure the PRODUCTION-MATRIX embed cells B (iframe) and C (script embed)
 * for each production map, on a genuinely FOREIGN origin: the built tree on 127.0.0.1:<port>, a
 * stand-in partner page on localhost:<other port>. Starts both servers itself; needs a built tree.
 *
 * USAGE:   node internal/check-map-embed-cells.mjs [--only bundle/profile,bundle/profile] [--cell B|C]
 * Graded by EXIT CODE: 0 all measured cells pass · 1 a cell failed · 2 nothing could be measured.
 *
 * B · iframe:  the partner page iframes the map's own leaf page. PASS = the frame renders real content
 *              (deep element count), and the HOST is untouched: its URL, title and scroll position.
 * C · script:  the partner page pastes the manifest's own embed snippet, with ITS OWN token. PASS = the
 *              element renders, no page error, no failed request to the tree's origin, and every
 *              api.mapbox.com request carries the HOST's token.
 *
 * ★ HOW C PROVES THE HOST'S TOKEN IS USED. Handing the partner page the tree's own baked token proves
 *   nothing — a bundle that ignored the host and fell back to its baked key would pass. So the host
 *   passes a DISTINCT, well-formed pk token that exists nowhere in the tree. Every api.mapbox.com
 *   request is intercepted: it must carry that host token (else FAIL: the map used another key), and
 *   is then forwarded with the real token so the map can still paint. A map drawn with zero Mapbox
 *   requests is fine for maps that need none; that is reported, not failed.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
// Default: the seven Research Gallery maps (doxa-maps-spa.meta.json `composes`).
const DEFAULT = JSON.parse(readFileSync(join(ROOT, 'plugin-designs/doxa-maps-spa/doxa-maps-spa.meta.json'), 'utf8')).composes
const ONLY = (argOf('--only', '') ? argOf('--only', '').split(',') : DEFAULT).map((s) => s.trim()).filter(Boolean)
const CELLS = argOf('--cell', '') ? [argOf('--cell', '').toUpperCase()] : ['B', 'C']

const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(MANIFEST)) { console.log('MAP-EMBED-CELLS: SKIP — no built tree'); process.exit(2) }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

const bakedToken = (() => {
  for (const b of manifest.bundles || []) for (const p of b.profiles || []) {
    if (!p.iframeUrl) continue
    const leaf = join(ROOT, 'public', TREE_NAME, String(p.iframeUrl).replace(/^\.\//, ''))
    if (!existsSync(leaf)) continue
    const m = readFileSync(leaf, 'utf8').match(/BAKED_TOKEN\s*=\s*"(pk\.[^"]+)"/)
    if (m) return m[1]
  }
  return ''
})()
// A well-formed pk token that exists nowhere in the tree (Mapbox GL parses the middle segment).
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const HOST_TOKEN = 'pk.' + b64({ u: 'partnerhost', a: 'embedprobe' }) + '.hostpartnerprobe'

const targets = []
for (const ref of ONLY) {
  const [bundle, profile] = ref.split('/')
  const b = (manifest.bundles || []).find((x) => x.bundle === bundle)
  const p = b && (b.profiles || []).find((x) => x.profile === profile)
  if (!b || !p) { targets.push({ ref, missing: true }); continue }
  const defined = b.elements || []
  const element = defined.includes(p.element) ? p.element : (defined[0] || p.element)
  targets.push({ ref, bundle, profile, element, iframeUrl: p.iframeUrl, snippet: (p.embed && p.embed.script) || '' })
}

const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => ok(port)) }) })
const TREE_PORT = await freePort()
const HOST_PORT = await freePort()
const TREE = `http://127.0.0.1:${TREE_PORT}/${TREE_NAME}`
let pageHtml = '<!doctype html><title>host</title><body>nothing</body>'
const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(TREE_PORT), '--exit-with-parent'], { cwd: ROOT, stdio: 'ignore' })
const host = createServer((_, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(pageHtml) }).listen(HOST_PORT, 'localhost')
const cleanup = () => { try { tree.kill() } catch (_) {} try { host.close() } catch (_) {} }
await new Promise((r) => setTimeout(r, 900))
if (!(await fetch(`${TREE}/manifest.json`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false))) {
  cleanup(); console.log('MAP-EMBED-CELLS: SKIP — could not serve the built tree'); process.exit(2)
}
const HOST = `http://localhost:${HOST_PORT}/partner.html`

const deepCount = `(() => { let n = 0, c = 0; const w = (r) => { for (const e of r.querySelectorAll('*')) { n++; if (e.tagName === 'CANVAS') c++; if (e.shadowRoot) w(e.shadowRoot) } }; w(document); return { n, c } })()`

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const rows = []
for (const t of targets) {
  if (t.missing) { rows.push({ ref: t.ref, cell: '-', ok: false, why: 'not in the built manifest' }); continue }
  for (const cell of CELLS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const errors = [], treeFails = [], mapboxTokens = new Set()
    let mapboxReqs = 0   // ANY api.mapbox.com request, with or without a token — see the vacuity check below
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 140)))
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(`http://127.0.0.1:${TREE_PORT}/`)) treeFails.push(r.status() + ' ' + r.url().replace(`http://127.0.0.1:${TREE_PORT}`, '').slice(0, 90)) })
    await ctx.route(/^https:\/\/api\.mapbox\.com\//, async (route) => {
      const u = new URL(route.request().url())
      mapboxReqs++
      const tok = u.searchParams.get('access_token')
      if (tok) { mapboxTokens.add(tok === HOST_TOKEN ? 'HOST' : tok === bakedToken ? 'BAKED' : 'OTHER'); if (tok === HOST_TOKEN) u.searchParams.set('access_token', bakedToken) }
      await route.continue({ url: u.toString() })
    })

    let res
    if (cell === 'B') {
      const src = `${TREE}/${String(t.iframeUrl).replace(/^\.\//, '')}`
      pageHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Partner page</title></head><body style="margin:0;font:16px sans-serif">
<h1 style="margin:16px">A partner's own page</h1><iframe id="f" src="${src}" width="100%" height="640" style="border:0"></iframe>
<div style="height:1400px;padding:16px">Partner content below the map.</div></body></html>`
      await page.goto(HOST, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(14000)
      const frame = page.frames().find((f) => f.url().startsWith(`http://127.0.0.1:${TREE_PORT}/`))
      const inside = frame ? await frame.evaluate(deepCount).catch(() => ({ n: 0, c: 0 })) : { n: 0, c: 0 }
      const hostState = await page.evaluate(() => ({ url: location.href, title: document.title, y: Math.round(scrollY) }))
      const why = []
      if (!frame) why.push('iframe never loaded the leaf')
      if (inside.n < 40) why.push('frame rendered almost nothing (' + inside.n + ' elements)')
      if (hostState.url !== HOST) why.push('host URL changed to ' + hostState.url)
      if (hostState.title !== 'Partner page') why.push('host title changed to "' + hostState.title + '"')
      if (hostState.y !== 0) why.push('host scrolled to y=' + hostState.y)
      if (treeFails.length) why.push('failed tree requests: ' + [...new Set(treeFails)].slice(0, 3).join(' , '))
      res = { why, detail: inside.n + ' elements, ' + inside.c + ' canvas in frame; host url/title/scroll unchanged' }
    } else {
      if (!t.snippet) { rows.push({ ref: t.ref, cell, ok: false, why: 'manifest has no script embed snippet' }); await ctx.close(); continue }
      // The manifest's own snippet, made absolute to the tree, with the HOST's token.
      let snip = t.snippet.replace(/src="\.\//g, `src="${TREE}/`).replace(/YOUR_MAPBOX_TOKEN/g, HOST_TOKEN)
      snip = snip.replace(/("tk"\s*:\s*")[^"]*(")/g, `$1${HOST_TOKEN}$2`)
      // ★ ASK FOR MAPBOX EXPLICITLY. This cell exists to prove the HOST's token reaches Mapbox, and
      // it used to get there by filling tk — a token selected the engine. Since 2026-09-28 it does
      // not: auto is always MapLibre and the published snippet pins "provider":"maplibre". Left
      // alone, this cell would load MapLibre, make zero api.mapbox.com requests, and PASS while
      // measuring nothing, because the token assertion below only fires on a request that happens.
      snip = snip.replace(/("provider"\s*:\s*")[^"]*(")/g, '$1mapbox$2')
      pageHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Partner page</title></head><body style="margin:0;font:16px sans-serif">
<h1 style="margin:16px">A partner's own page</h1><div style="position:relative;height:640px">${snip}</div>
<div style="height:600px;padding:16px">Partner content below the map.</div></body></html>`
      await page.goto(HOST, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(14000)
      const st = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(t.element)}); if (!el) return { present: false }
        const d = ${deepCount}; return { present: true, defined: !!customElements.get(${JSON.stringify(t.element)}), n: d.n, c: d.c, h: Math.round(el.getBoundingClientRect().height) } })()`)
      const why = []
      if (!st.present) why.push('snippet did not put <' + t.element + '> on the page')
      else {
        if (!st.defined) why.push('<' + t.element + '> never registered')
        if (st.n < 40) why.push('rendered almost nothing (' + st.n + ' elements)')
        if (st.h < 100) why.push('element is ' + st.h + 'px tall')
      }
      if (mapboxTokens.has('BAKED') || mapboxTokens.has('OTHER')) why.push('Mapbox requests used a token other than the HOST\'s: ' + [...mapboxTokens].join(', '))
      // ★ VACUITY IS A FAILURE, NOT A PASS. Every other check here is of the form "no request used
      // the wrong token", which is trivially satisfied by making no requests at all. If this cell
      // asks for Mapbox and Mapbox is never contacted, the cell proved nothing and must say so.
      if (!mapboxReqs) why.push('asked for the Mapbox engine and made ZERO api.mapbox.com requests — this cell measured nothing')
      if (treeFails.length) why.push('failed tree requests: ' + [...new Set(treeFails)].slice(0, 3).join(' , '))
      if (errors.length) why.push('page error: ' + [...new Set(errors)].slice(0, 2).join(' / '))
      res = { why, detail: st.n + ' elements, ' + st.c + ' canvas, ' + st.h + 'px; Mapbox token(s): ' + ([...mapboxTokens].join(',') || 'none requested') }
    }
    rows.push({ ref: t.ref, cell, ok: !res.why.length, why: res.why.join(' | '), detail: res.detail })
    await ctx.close()
  }
}
await browser.close(); cleanup()

for (const r of rows) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.cell + '  ' + r.ref.padEnd(46) + (r.ok ? r.detail : r.why))
const bad = rows.filter((r) => !r.ok)
console.log(bad.length ? `MAP-EMBED-CELLS: FAIL — ${bad.length} of ${rows.length} cell(s)` : `MAP-EMBED-CELLS: PASS — ${rows.length} cell(s) on a foreign origin`)
process.exit(bad.length ? 1 : 0)
