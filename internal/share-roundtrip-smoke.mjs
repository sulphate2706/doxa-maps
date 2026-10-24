#!/usr/bin/env node
/**
 * share-roundtrip-smoke.mjs — prove a map's Share button emits a URL that actually
 * reopens THE SAME MAP.
 *
 * WHY: REQ-1 — share links must work wherever the tree is hosted: the plugin gallery,
 * doxa.life, any CDN. A share URL is the one artefact a partner pastes into an email or
 * a website builder, and it fails SILENTLY: a hardcoded path 404s on a different host, a
 * dev server's SPA fallback answers 200 text/html for a path nobody serves, a host shell
 * drops the #/deep-link and reopens its DEFAULT map instead of the one shared. None of
 * that is visible from inside the popover. This gate closes the loop — it must be able to
 * FAIL and it must SAY WHY, so every failure is a builder-cycle backlog item with evidence.
 *
 * HOW: for each target host page (a FRESH Playwright page, 1440x900):
 *   1. open it and wait until a WebGL canvas exists deep in the mounted element's shadow
 *      tree (nested MFEs are searched through every shadow root) → else
 *      'map never rendered on host page';
 *   2. deep-find the Share trigger (the MapControlButton whose title is the i18n string
 *      buttons.shareEmbed — "Share & embed" — or any [title*="Share"]/[aria-label*="Share"]),
 *      click it, wait for .share-pop, read .share-url-text, switch to the "Add to Your
 *      Website" tab and read the embed code in .share-code-box;
 *   3. GET the share URL from Node (status + content-type recorded) → non-2xx or not
 *      text/html → 'share URL does not resolve';
 *   4. open the share URL in a NEW page, wait for a canvas anywhere in the document, record
 *      the top-level custom element that hosts it → no canvas → 'share URL opened but no map
 *      rendered'; a different tag than the host's → 'share URL reopened <x>, not <y>' (this
 *      is the check that catches SPA fallbacks and hash-stripping — both render *a* map);
 *   5. record {host, tag, shareUrl, status, contentType, iframeSnippetHasUrl, reopened:{tag,
 *      canvas}, pass, why, ms} and print one line.
 * Browser: Firefox by default (house rule: never Google Chrome; --browser chromium uses
 * Playwright's bundled Chromium). Shared helpers live in internal/lib/browser.mjs.
 *
 * Usage:  node internal/share-roundtrip-smoke.mjs --url <host page URL> [--url ...]
 *           [--tag <custom-element tag expected on both ends>] [--wait 12000]
 *           [--json <out.json>] [--browser firefox|chromium]
 *         --tag pairs with --url by position (one --tag per --url); a single --tag applies
 *           to every --url; with no --tag the tag the HOST page actually mounted is expected
 *           on the reopened page (the usual case for a site with several map pages).
 *         node internal/share-roundtrip-smoke.mjs --plugin-gallery [http://localhost:5174]
 *           [--grep <substr>]   → every element with a canvas from GET <base>/__plugin-gallery/
 *           registry.json, opened by deep link <base>/#/<bundle>/<profile>[/<instance>]
 * Exit:   0 all pass · 1 any fail (list printed) · 2 usage / no targets / registry unreachable
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')
import { launch, deepEvaluate, TELEMETRY } from './lib/browser.mjs'

const TOOL = 'share-smoke'
const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const argAll = (k) => args.flatMap((a, i) => a === k && args[i + 1] ? [args[i + 1]] : [])
const has = (k) => args.includes(k)
const URLS = argAll('--url')
const TAGS = argAll('--tag')
// One tag per URL (positional), one tag for all, or none → expect whatever the host mounted.
if (TAGS.length > 1 && TAGS.length !== URLS.length) { console.error(`[share-smoke] ${TAGS.length} --tag for ${URLS.length} --url — give one per --url, one for all, or none`); process.exit(2) }
const tagFor = (i) => TAGS.length === URLS.length ? TAGS[i] : (TAGS[0] || null)
const WAIT = Number(argOf('--wait', 12000))
const JSON_OUT = argOf('--json', '')
const BROWSER = argOf('--browser', 'firefox')
const GREP = argOf('--grep', '')
const GALLERY = has('--plugin-gallery')
  ? String((() => { const v = args[args.indexOf('--plugin-gallery') + 1]; return v && !v.startsWith('--') ? v : 'http://localhost:5174' })()).replace(/\/+$/, '')
  : null
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
if (GALLERY) await __devGuard(GALLERY, __ROOT, 'SHARE-ROUNDTRIP')

if (!URLS.length && !GALLERY) {
  console.error(`[${TOOL}] usage: --url <host page URL> [--url ...] [--tag <tag>] | --plugin-gallery [base]   (see header)`)
  process.exit(2)
}

// The Share trigger's tooltip comes from i18n; read the English source so the gate tracks it.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let SHARE_TITLE = 'Share & embed'
try { SHARE_TITLE = JSON.parse(readFileSync(join(ROOT, 'library/i18n/locales/en/buttons.json'), 'utf8')).shareEmbed || SHARE_TITLE } catch { /* keep the fallback */ }

// ── targets ───────────────────────────────────────────────────────────────────
const targets = URLS.map((u, i) => ({ label: u, host: u, tag: tagFor(i) }))
if (GALLERY) {
  const regRes = await fetch(`${GALLERY}/__plugin-gallery/registry.json`).catch(() => null)
  if (!regRes || !regRes.ok) { console.error(`[${TOOL}] cannot read ${GALLERY}/__plugin-gallery/registry.json — is \`bun x vite\` running?`); process.exit(2) }
  const registry = await regRes.json()
  for (const b of registry) for (const it of b.items) {
    // The gallery's deep-link key: <bundle>/<profile>, plus /<id> for a preset instance.
    const key = `${b.bundle}/${it.profile}${it.type === 'parameterized' ? `/${it.id}` : ''}`
    if (GREP && !key.includes(GREP) && !String(it.label).includes(GREP)) continue
    // Same heuristic as plugin-gallery-smoke: map profiles + composites carry a canvas (and a
    // Share button); lists/tables/charts/poster walls are DOM-only and have nothing to share.
    const hasCanvas = (/map/i.test(it.profile) && !/list|table|chart|wall|dashboard/i.test(it.profile))
      || it.type === 'nested-elements-mfe' || it.type === 'nested-mfe-spa'
    if (!hasCanvas) continue
    targets.push({ label: key, host: `${GALLERY}/#/${key.split('/').map(encodeURIComponent).join('/')}`, tag: b.tag, type: it.type, profile: it.profile })
  }
}
if (!targets.length) { console.error(`[${TOOL}] no targets`); process.exit(2) }
console.log(`[${TOOL}] ${targets.length} target(s) · trigger title "${SHARE_TITLE}" · browser ${BROWSER}`)

const browser = await launch(BROWSER, { label: TOOL })

/**
 * ★ PRECONDITION: CAN THIS ENGINE RENDER A MAP AT ALL? (2026-09-21)
 *
 * This suite reported "no Share button found (buttons present: Dismiss hint)" under Firefox while
 * Chromium passed on the identical page. The recorded hypothesis was that Firefox's deepFind
 * resolved only the outermost shadow root. ★ MEASURED AND DISPROVED: both engines find exactly
 * ONE shadow host at depth 0 — shadow traversal is identical. The real difference is WEBGL:
 *
 *     chromium: webglSupported true  · 157 elements in shadow · toolbar present · glContext true
 *     firefox : webglSupported FALSE ·  31 elements in shadow · toolbar ABSENT · glContext false
 *               console: "[doxa-simple-map] Map failed to initialize"
 *
 * Confirmed as an ENVIRONMENT property, not a page one: Firefox returns null from getContext on a
 * BLANK page here, and firefoxUserPrefs (webgl.force-enabled, webgl.forbid-software, …) does not
 * change it — there is no software GL path for Firefox on this box. Chromium only works because
 * launch() passes SwiftShader args.
 *
 * So without WebGL the map never initialises, the MapToolbar that HOSTS the Share button is never
 * rendered, and the suite blames the product for an engine limitation. Rather than silently
 * defaulting away from the house rule (never Google Chrome), this ABORTS with the
 * measurement and the exact command that works. A suite that cannot render a map must not report
 * on map sharing at all — that is the difference between a failure and a false failure.
 */
{
  const probe = await browser.newPage()
  await probe.goto('about:blank')
  const gl = await probe.evaluate(() => {
    try {
      const c = document.createElement('canvas')
      return !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch { return false }
  })
  await probe.close()
  if (!gl) {
    console.error(`[${TOOL}] ABORT — ${BROWSER} has NO WebGL in this environment.`)
    console.error(`[${TOOL}]   Every map would fail to initialise, so the toolbar that hosts the`)
    console.error(`[${TOOL}]   Share button is never rendered and this suite would report a`)
    console.error(`[${TOOL}]   FALSE FAILURE against working code.`)
    console.error(`[${TOOL}]   Verified on a BLANK page, so it is the engine/box, not the product;`)
    console.error(`[${TOOL}]   firefoxUserPrefs for software WebGL do not change it here.`)
    console.error(`[${TOOL}]   Re-run with Playwright's bundled Chromium (NOT Google Chrome):`)
    console.error(`[${TOOL}]     node internal/share-roundtrip-smoke.mjs --browser chromium …`)
    await browser.close()
    process.exit(2)
  }
}

// ── page-side probes (each receives deepFind bound by deepEvaluate) ───────────
// Outermost custom element hosting `node` — walk up through every shadow boundary.
const PROBE_CANVAS = (deepFind) => {
  const topHost = (n) => { let top = null; while (n) { const root = n.getRootNode(); if (root && root.host) { top = root.host; n = root.host } else break } return top ? top.tagName.toLowerCase() : null }
  const canvas = deepFind(document, 'canvas')
  const err = deepFind(document, '.profile-error')
  const st = deepFind(document, '[role="alert"], [class*="status"], [class*="error"]')
  return {
    canvas: !!canvas, tag: canvas ? topHost(canvas) : null,
    errorCard: err ? err.textContent.trim().slice(0, 160) : null,
    statusText: st && st.textContent.trim() ? st.textContent.trim().slice(0, 160) : null,
    title: document.title, url: location.href,
    galleryShell: !!document.querySelector('#slot'), hostHasMapbox: typeof window.mapboxgl !== 'undefined'
  }
}

async function pollCanvas(page, wait) {
  const deadline = Date.now() + wait
  let s = null
  while (Date.now() < deadline) {
    s = await deepEvaluate(page, PROBE_CANVAS)
    if (s.canvas || s.errorCard) return s
    await page.waitForTimeout(400)
  }
  return s
}

/**
 * ★ CARRY A TOKEN IF ONE IS OFFERED (2026-09-21) — the third gate found missing this wiring, after
 * verify-5-capabilities (which had it) and verify-map-paint (which did not).
 *
 * Without it this suite CANNOT PASS while the /api/maps/token outage stands, whatever browser it
 * uses: no token → no map → no MapToolbar → "no Share button".
 *
 * ★ BOTH CHANNELS ARE NEEDED, AND I MEASURED WHICH — my first attempt set only window.MAP_TOKEN,
 * assuming a page-scoped global would survive into the reopened page. It does not work at all for
 * a TOP-LEVEL element:
 *     ?tk= only   → mounted, gl true, 157 elements
 *     global only → NOT MOUNTED
 *     both        → mounted, gl true, 157 elements
 * `?tk=` feeds the top-level element's profile-config; window.MAP_TOKEN is read by NESTED children
 * of a composite. So seedToken sets the global (for composites) and the caller appends ?tk= to the
 * URL it controls.
 *
 * ★ THE SHARE ROUND TRIP REMAINS HONESTLY UNTESTABLE WHILE THE ENDPOINT IS DOWN. The share URL
 * deliberately strips query params — a share link must be pasteable — so the reopened page has no
 * ?tk= and cannot mount. That is not something a test harness may paper over: the only real fix is
 * the token endpoint, which is provisional, pending a product decision. Documented rather than worked around.
 *
 * Unset, behaviour is unchanged — a real token-plumbing break still shows up.
 *   MAPBOX_TOKEN=$(curl -s <endpoint> | jq -r .token) node internal/share-roundtrip-smoke.mjs …
 */
const MAPBOX_TOKEN = (process.env.MAPBOX_TOKEN || '').trim()
async function seedToken(page) {
  if (MAPBOX_TOKEN) await page.addInitScript((t) => { window.MAP_TOKEN = t }, MAPBOX_TOKEN)
}
/** Append ?tk= for a TOP-LEVEL element, which reads profile-config rather than the global. */
const withToken = (u) => (MAPBOX_TOKEN ? u + (u.includes('?') ? '&' : '?') + 'tk=' + encodeURIComponent(MAPBOX_TOKEN) : u)

function wirePage(page, sink) {
  page.on('console', m => { if (m.type() === 'error' && !TELEMETRY.test(m.text())) sink.consoleErrors.push(m.text().slice(0, 240)) })
  page.on('pageerror', e => sink.pageErrors.push(String(e.message || e).slice(0, 240)))
  page.on('response', res => {
    const u = res.url()
    if (!/\.(geo)?json(\?|$)/i.test(u) || TELEMETRY.test(u)) return
    const ct = res.headers()['content-type'] || ''
    if (res.status() >= 400) sink.dataProblems.push(`${res.status()} ${u}`)
    else if (/text\/html/i.test(ct)) sink.dataProblems.push(`HTML instead of JSON ← ${u}`)
  })
}

const evidence = (sink, s) => {
  const bits = []
  if (s?.errorCard) bits.push(`ProfileLoader error: ${s.errorCard}`)
  if (s?.statusText) bits.push(`profile status: "${s.statusText}"`)
  if (s && s.hostHasMapbox === false) bits.push('window.mapboxgl UNDEFINED on the page')
  if (sink.pageErrors.length) bits.push(`page error: ${sink.pageErrors[0]}`)
  if (sink.dataProblems.length) bits.push(`data: ${sink.dataProblems[0]}${sink.dataProblems.length > 1 ? ` (+${sink.dataProblems.length - 1} more)` : ''}`)
  return bits.length ? ' — ' + bits.join(' · ') : ''
}

// ── one target ─────────────────────────────────────────────────────────────────
async function check(t) {
  const t0 = Date.now()
  const hostSink = { consoleErrors: [], pageErrors: [], dataProblems: [] }
  const reSink = { consoleErrors: [], pageErrors: [], dataProblems: [] }
  const r = {
    label: t.label, host: t.host, tag: t.tag, hostTag: null, shareUrl: null, status: null, contentType: null,
    resolvedUrl: null, iframeSnippetHasUrl: null, embedSnippet: null,
    reopened: { tag: null, canvas: false, url: null, title: null, galleryShell: false, ...reSink },
    pass: false, why: '', ms: 0, hostErrors: hostSink
  }
  const problems = []
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await seedToken(page)
  wirePage(page, hostSink)
  let page2 = null
  try {
    // 1. host page renders the map
    // Token on the HOST url only. The SHARE url is navigated verbatim on purpose — appending a
    // token there would fake the very thing under test (that a pasted link reopens a working map).
    await page.goto(withToken(t.host), { waitUntil: 'load', timeout: 60000 })
    const hs = await pollCanvas(page, WAIT)
    r.hostTag = hs?.tag ?? null
    if (!hs?.canvas) { problems.push('map never rendered on host page' + evidence(hostSink, hs)); throw 'stop' }
    if (t.tag && r.hostTag !== t.tag) problems.push(`host page mounted <${r.hostTag}>, expected <${t.tag}>`)
    const expectTag = t.tag || r.hostTag

    // 2. open the Share popover, read URL + embed code. The toolbar that carries the Share
    //    button mounts AFTER the map (profiles gate it on appReady/mapRef), so the trigger is
    //    polled for up to `wait` ms — not probed once.
    const share = await deepEvaluate(page, async (deepFind, cfg) => {
      const sleep = (ms) => new Promise(res => setTimeout(res, ms))
      const until = async (fn, ms) => { const d = Date.now() + ms; let v = fn(); while (!v && Date.now() < d) { await sleep(150); v = fn() } return v }
      const sels = [`button[title="${cfg.title.replace(/"/g, '\\"')}"]`, '[title*="Share" i]', '[aria-label*="Share" i]']
      const find = () => { for (const s of sels) { const el = deepFind(document, s); if (el) return { el, s } } return null }
      const hit = await until(find, cfg.wait)
      if (!hit) {
        // Evidence: which buttons DID mount, so "no Share button" says what was there. The
        // map's own buttons live in shadow roots — list those first, the host page's after.
        const deep = [], light = []
        const walk = (root, sink) => { for (const el of root.querySelectorAll('button')) { const t = el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent.trim(); if (t) sink.push(t.slice(0, 32)) } for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, deep) }
        walk(document, light)
        const buttons = [...new Set([...deep.map(t => `${t} (in map)`), ...light.map(t => `${t} (host page)`)])].slice(0, 12)
        return { trigger: null, tried: sels, buttons, mapButtons: deep.length }
      }
      const trig = hit.el, matched = hit.s
      trig.click()
      const pop = await until(() => deepFind(document, '.share-pop'), 4000)
      if (!pop) return { trigger: matched, pop: false }
      const urlEl = await until(() => deepFind(pop, '.share-url-text'), 2000)
      const url = urlEl ? urlEl.textContent.trim() : ''
      const tab = [...pop.querySelectorAll('.share-tab')].find(b => /add to your website/i.test(b.textContent)) || pop.querySelectorAll('.share-tab')[1]
      let code = ''
      if (tab) { tab.click(); const box = await until(() => deepFind(pop, '.share-code-box'), 2000); code = box ? box.textContent.trim() : '' }
      return { trigger: matched, pop: true, url, code, tabFound: !!tab }
    }, { title: SHARE_TITLE, wait: WAIT })
    if (!share.trigger) {
      const gap = share.mapButtons === 0 ? ' — the map mounted NO buttons of its own (no toolbar/ShareButton in this profile?)' : ''
      problems.push(`no Share button found within ${WAIT}ms${gap} (looked for ${share.tried.join(', ')}; buttons present: ${share.buttons.length ? share.buttons.map(b => `"${b}"`).join(', ') : 'none'})`)
      throw 'stop'
    }
    if (!share.pop) { problems.push(`Share button (${share.trigger}) clicked but the popover (.share-pop) never opened`); throw 'stop' }
    r.shareUrl = share.url || null
    r.embedSnippet = share.code || null
    if (!r.shareUrl) { problems.push('popover opened but .share-url-text is empty'); throw 'stop' }
    if (!share.tabFound) problems.push('"Add to Your Website" tab not found')
    else if (!share.code) problems.push('embed tab opened but .share-code-box is empty')
    else { r.iframeSnippetHasUrl = share.code.includes(r.shareUrl); if (!r.iframeSnippetHasUrl) problems.push('embed snippet does not contain the share URL') }

    // 3. does the share URL resolve?
    let abs
    try { abs = new URL(r.shareUrl) } catch { problems.push(`share URL is not an absolute URL: "${r.shareUrl}"`); throw 'stop' }
    let res = null
    try { res = await fetch(abs, { redirect: 'follow', headers: { accept: 'text/html,*/*' }, signal: AbortSignal.timeout(15000) }) } catch (e) { problems.push(`share URL does not resolve — fetch failed: ${String(e.cause?.message || e.message || e).slice(0, 120)}`); throw 'stop' }
    r.status = res.status; r.contentType = res.headers.get('content-type') || ''; r.resolvedUrl = res.url
    await res.arrayBuffer().catch(() => null)
    if (res.status < 200 || res.status >= 300) { problems.push(`share URL does not resolve (HTTP ${res.status})`); throw 'stop' }
    if (!/text\/html/i.test(r.contentType)) { problems.push(`share URL does not resolve as a page (content-type "${r.contentType || 'none'}")`); throw 'stop' }

    // 4. reopen it — fresh page, fresh context — does THE SAME map render?
    page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await seedToken(page2)          // the share URL strips query params BY DESIGN — see seedToken
    wirePage(page2, reSink)
    try { await page2.goto(r.shareUrl, { waitUntil: 'load', timeout: 60000 }) } catch (e) { problems.push(`share URL opened but the page failed to load: ${String(e.message || e).slice(0, 160)}`); throw 'stop' }
    const rs = await pollCanvas(page2, WAIT)
    Object.assign(r.reopened, { tag: rs?.tag ?? null, canvas: !!rs?.canvas, url: rs?.url ?? null, title: rs?.title ?? null, galleryShell: !!rs?.galleryShell })
    if (!rs?.canvas) { problems.push(`share URL opened but no map rendered (page title "${rs?.title ?? ''}")` + evidence(reSink, rs)); throw 'stop' }
    if (expectTag && rs.tag !== expectTag) {
      let why = `share URL reopened <${rs.tag}>, not <${expectTag}> — the link does not identify this map`
      if (rs.galleryShell) why += ' (landed on the plugin gallery shell, which mounts its default first element)'
      else if (rs.title) why += ` (page title "${rs.title}")`
      problems.push(why)
    }
  } catch (e) {
    if (e !== 'stop') problems.push('exception: ' + String(e.message || e).slice(0, 200))
  } finally {
    await page.close().catch(() => {})
    if (page2) await page2.close().catch(() => {})
  }
  r.ms = Date.now() - t0
  r.pass = problems.length === 0
  r.why = problems.join(' · ')
  return r
}

// ── run (sequential: memory / WebGL-context budget) ──────────────────────────
const results = []
for (const t of targets) {
  const r = await check(t)
  results.push(r)
  const http = r.status ? ` [${r.status} ${(r.contentType || '').split(';')[0] || '?'}]` : ''
  const re = r.reopened.tag || r.reopened.canvas ? `  reopened:<${r.reopened.tag ?? '?'}> canvas:${r.reopened.canvas ? 'y' : 'n'}` : ''
  console.log(`${r.pass ? '✓' : '✗'} ${r.label}  share→ ${r.shareUrl ?? '(none)'}${http}${re}  ${r.ms}ms${r.pass ? '' : '\n      ' + r.why}`)
}
await browser.close()

const failed = results.filter(r => !r.pass)
console.log(`\n[${TOOL}] ${results.length - failed.length}/${results.length} pass · ${failed.length} fail`)
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ tool: TOOL, generatedAt: new Date().toISOString(), browser: BROWSER, wait: WAIT, shareTitle: SHARE_TITLE, results }, null, 2)); console.log(`[${TOOL}] report → ${JSON_OUT}`) }
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(`  ✗ ${f.label} — ${f.why}`)); process.exit(1) }
