#!/usr/bin/env node
/**
 * check-shell-header — a header-off shell has ONE way to its tabs and ONE language menu, in the right
 * place for the width, and a language pick ASKS the host page first. Headless (Vite SSR, no browser).
 *
 * THE DESIGN (_qa-cycle/studio-organize/MOBILE-SHELL-HEADER-DESIGN.md): on a phone, a header-off shell
 * (the Research Gallery, Posterverse) gets a 44px bar with ☰ at the start and a #phone-end slot at the
 * end; on a desktop, a #rail-end slot at the bottom of the rail. The shell fills both with
 * library/components/ShellLanguageMenu.vue, whose pick dispatches ONE cancelable
 * `doxa-language-request` on the host element: cancelled → the host changes the language, the shell
 * does not; not cancelled → the shell switches, and writes ?lang= only on a page the tree generated.
 *
 * ASSERTS, on the REAL components:
 *   1. VerticalTabsLayout renders the phone bar ONLY when narrow AND header-off, #rail-end ONLY when
 *      wide AND header-off (all four combinations), and never the old floating corner circle.
 *   2. one pick dispatches exactly ONE doxa-language-request, detail.language = the code, and
 *      cancelable, composed and bubbles all true.
 *   3. a host that cancels → the menu emits no 'switch' and shows the current language again.
 *   4. nobody cancels → the menu emits 'switch' once, and ?lang= is written only when
 *      window.MAP_OWNS_PAGE === true.
 *   5. parity: every SWITCHER_LANGUAGES code has a library/i18n/locales/<code>/ catalogue, and the
 *      menu always lists the current language (fixture: de, which the switcher hides).
 * --self-test plants each defect in a temporary copy and must see every one refused.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VTL = 'library/layouts/VerticalTabsLayout.vue'
const MENU = 'library/components/ShellLanguageMenu.vue'
const REQ = 'library/utils/languageRequest.js'
const LANGS = 'library/layouts/app-wrapper-material/languages.js'

const { createServer } = await import('vite')
const { default: vue } = await import('@vitejs/plugin-vue')
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [vue()],
  resolve: { alias: { '@map': join(ROOT, 'library') } } })
const { createSSRApp, h, reactive } = await import('vue')
const { renderToString } = await import('vue/server-renderer')

// A stand-in window for the ?lang= arm: records replaceState calls, owns the page or not.
function fakeWindow(owns) {
  const calls = []
  return { calls, MAP_OWNS_PAGE: owns, location: { href: 'https://example.test/leaf/index.html?tab=x' },
    history: { state: null, replaceState: (_s, _t, url) => calls.push(url) } }
}
// A stand-in DOM for the pick: the select sits in a shadow root whose host is an EventTarget.
function fakeSelect(value, host) { return { value, getRootNode: () => ({ host }) } }

async function audit({ vtl = VTL, menu = MENU, langs = LANGS } = {}) {
  const bad = []
  const fail = (what, detail) => bad.push(detail ? `${what} — ${detail}` : what)

  // 1. where the bar and the rail-end render. The layout's chrome strings come through tStatic, whose
  // locale detection reads <html lang>; SSR has no document, so the render gets a one-field stand-in.
  if (typeof globalThis.document === 'undefined') globalThis.document = { documentElement: { lang: 'en' } }
  const Layout = (await server.ssrLoadModule('/' + vtl)).default
  // shellMode (resolved into data.mode at mount): BOTH modes get the one top bar on a phone (☰ at the start, the
  // language at the end); web mode's bar takes no camera inset (.is-web). No corner circle in either mode
  // (a corner ☰ with no header was rejected on a real phone). The drawer is shut, as on a phone at load.
  for (const mode of ['app', 'web']) for (const narrow of [true, false]) for (const header of [true, false]) {
    // A copy of the real layout whose data says `narrow` and `mode` (in a browser mounted() reads them from
    // matchMedia and the host, which SSR never runs). A copy, not `extends`: the render function is not inherited.
    const Comp = { ...Layout, data() { return { ...Layout.data.call(this, this), narrow, mode, navOpen: !narrow } } }
    const app = createSSRApp({ render: () => h(Comp, { header, items: [{ key: 'a', label: 'A' }], active: 'a' }, {
      'phone-end': () => h('i', { class: 'probe-phone-end' }),
      'rail-end': () => h('i', { class: 'probe-rail-end' }) }) })
    const html = (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')   // template comments are not markup
    const tag = `mode=${mode} narrow=${narrow} header=${header}`
    // The bar's class list, in whatever order Vue renders it (a bound class can come first).
    const pbar = (html.match(/<div class="([^"]*\bvtl-pbar\b[^"]*)"/) || [])[1] || null
    const phoneNoHeader = narrow && !header
    const wantBar = phoneNoHeader, wantRail = !narrow && !header
    if (!!pbar !== wantBar) fail(`the phone bar ${wantBar ? 'is missing' : 'renders'} at ${tag}`)
    if (/probe-phone-end/.test(html) !== wantBar) fail(`#phone-end ${wantBar ? 'is not filled' : 'renders'} at ${tag}`)
    if (wantBar && /\bis-web\b/.test(pbar || '') !== (mode === 'web')) fail(`the bar ${mode === 'web' ? 'keeps the camera inset in web mode (.is-web missing)' : 'drops the camera inset in app mode'} at ${tag}`)
    if (/class="vtl-rail-end"/.test(html) !== wantRail || /probe-rail-end/.test(html) !== wantRail) fail(`#rail-end ${wantRail ? 'is missing' : 'renders'} at ${tag}`)
    if (wantBar && !/class="vtl-phone-menu"[^>]*aria-expanded=/.test(html)) fail(`the bar's ☰ has no aria-expanded at ${tag}`)
    if (/vtl-fab|--map-fab-|vtl-drawer-end/.test(html)) fail(`a corner ☰ (or its --map-fab-* footprint, or the drawer-foot language) renders at ${tag}`)
    if (wantBar !== /has-phone-bar/.test(html)) fail(`the phone bar's grid row (.has-phone-bar) ${wantBar ? 'is missing' : 'is set'} at ${tag}`)
  }

  // 2-4. the pick, through the menu's REAL handler (its <script setup> bindings; no DOM needed)
  const Menu = (await server.ssrLoadModule('/' + menu)).default
  // The menu's setup, run INSIDE an SSR render so its compiled wrapper finds the SSR context; in dev mode a
  // <script setup> returns its bindings, so the gate calls the component's real onPick and options.
  const mount = async (current) => {
    const emitted = []; let b = null
    const Probe = { setup() { b = Menu.setup(reactive({ current, collapsed: false }), { emit: (e, ...a) => emitted.push([e, ...a]), expose: () => {}, attrs: {}, slots: {} }); return () => null } }
    await renderToString(createSSRApp(Probe))
    if (!b || typeof b.onPick !== 'function') throw new Error('ShellLanguageMenu setup did not return its bindings (onPick)')
    return { b, emitted }
  }
  const run = async ({ cancel, owns }) => {
    const host = new EventTarget(); const seen = []
    host.addEventListener('doxa-language-request', (e) => { seen.push(e); if (cancel) e.preventDefault() })
    host.addEventListener('language-change', (e) => seen.push(e))
    const win = fakeWindow(owns); const had = globalThis.window; globalThis.window = win
    const { b, emitted } = await mount('en'); const sel = fakeSelect('ar', host)
    try { b.onPick({ target: sel }) } finally { if (had === undefined) delete globalThis.window; else globalThis.window = had }
    return { seen, emitted, sel, win }
  }
  const up = await run({ cancel: false, owns: true })
  const reqs = up.seen.filter((e) => e.type === 'doxa-language-request')
  if (up.seen.length !== 1 || reqs.length !== 1) fail('one pick must dispatch exactly ONE doxa-language-request', `saw ${up.seen.map((e) => e.type).join(', ') || 'none'}`)
  const e = reqs[0]
  if (e && !(e.detail && e.detail.language === 'ar')) fail('the event must carry detail.language', JSON.stringify(e.detail))
  if (e && !(e.cancelable && e.composed && e.bubbles)) fail('the event must be cancelable, composed and bubbling', `cancelable=${e.cancelable} composed=${e.composed} bubbles=${e.bubbles}`)
  if (up.emitted.filter(([n]) => n === 'switch').length !== 1 || (up.emitted[0] || [])[1] !== 'ar') fail('an uncancelled pick must emit switch("ar") once', JSON.stringify(up.emitted))
  if (!(up.win.calls.length === 1 && /[?&]lang=ar\b/.test(up.win.calls[0]) && /[?&]tab=x\b/.test(up.win.calls[0]))) fail('an uncancelled pick on a tree-owned page must write ?lang= (keeping the query)', JSON.stringify(up.win.calls))
  const notOwned = await run({ cancel: false, owns: undefined })
  if (notOwned.win.calls.length) fail('?lang= was written on a page the tree does not own (MAP_OWNS_PAGE unset)', JSON.stringify(notOwned.win.calls))
  const cancelled = await run({ cancel: true, owns: true })
  if (cancelled.emitted.some(([n]) => n === 'switch')) fail('a cancelled request must NOT switch the shell', JSON.stringify(cancelled.emitted))
  if (cancelled.win.calls.length) fail('a cancelled request must not write ?lang=', JSON.stringify(cancelled.win.calls))
  if (cancelled.sel.value !== 'en') fail('after a cancel the menu must show the current language again', cancelled.sel.value)

  // 5. parity + the current language
  const L = await server.ssrLoadModule('/' + langs)
  const missing = L.SWITCHER_LANGUAGES.map((l) => l.code).filter((c) => !existsSync(join(ROOT, 'library/i18n/locales', c)))
  if (missing.length) fail('a switcher language has no catalogue', missing.join(', '))
  const de = (await mount('de')).b.options
  const codes = (de && de.value ? de.value : []).map((l) => l.code)
  if (!codes.includes('de')) fail('the menu must list the current language even when the switcher hides it (de)', codes.join(' '))
  const en = (await mount('en')).b.options
  if ((en && en.value ? en.value : []).map((l) => l.code).join() !== L.SWITCHER_LANGUAGES.map((l) => l.code).join()) fail('with a listed language current, the menu must be exactly the switcher list')
  return bad
}

// ── --self-test: each defect planted in a temporary copy must be refused ─────────────────────────────
function plant(rel, suffix, edit, redirect = []) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  let out = edit(src)
  if (out === src) throw new Error(`poison "${suffix}" did not change ${rel}`)
  for (const [from, to] of redirect) out = out.split(from).join(to)
  const dot = rel.lastIndexOf('.'); const tmp = rel.slice(0, rel.lastIndexOf('/') + 1) + `.tmp-shellhdr-${suffix}` + rel.slice(dot)
  writeFileSync(join(ROOT, tmp), out); PLANTED.push(tmp); return tmp
}
const PLANTED = []   // every temporary copy, removed in finally whatever happens
const POISONS = [
  { name: 'the bar also shows with a header', files: () => ({ vtl: plant(VTL, 'bar-header', (s) => s.replace('phoneBarShown() { return this.narrow && !this.header }', 'phoneBarShown() { return this.narrow }')) }) },
  { name: 'the rail-end also shows on a phone', files: () => ({ vtl: plant(VTL, 'rail-phone', (s) => s.replace('railEndShown() { return !this.narrow && !this.header }', 'railEndShown() { return !this.header }')) }) },
  { name: 'web mode drops the header (no bar)', files: () => ({ vtl: plant(VTL, 'webnobar', (s) => s.replace('phoneBarShown() { return this.narrow && !this.header }', "phoneBarShown() { return this.narrow && !this.header && this.mode === 'app' }")) }) },
  { name: 'web mode keeps the camera inset', files: () => ({ vtl: plant(VTL, 'webinset', (s) => s.replace(" :class=\"{ 'is-web': mode === 'web' }\"", '')) }) },
  { name: 'the corner circle is back', files: () => ({ vtl: plant(VTL, 'fab', (s) => s.replace('<div v-if="phoneBarShown" class="vtl-pbar"', '<button v-if="phoneBarShown" class="vtl-fab">☰</button><div v-if="phoneBarShown" class="vtl-pbar"')) }) },
  { name: 'the event is not cancelable', files: () => { const r = plant(REQ, 'nocancel', (s) => s.replace('bubbles: true, composed: true, cancelable: true', 'bubbles: true, composed: true')); return { menu: plant(MENU, 'm-nocancel', (s) => s + ' ', [['../utils/languageRequest.js', '../utils/' + r.split('/').pop()]]) } } },
  { name: 'the event does not leave the shadow root', files: () => { const r = plant(REQ, 'nocomposed', (s) => s.replace('bubbles: true, composed: true, cancelable: true', 'bubbles: true, cancelable: true')); return { menu: plant(MENU, 'm-nocomposed', (s) => s + ' ', [['../utils/languageRequest.js', '../utils/' + r.split('/').pop()]]) } } },
  { name: 'the detail is Vue-shaped (an array)', files: () => { const r = plant(REQ, 'arr', (s) => s.replace('detail: { language: code }', 'detail: [{ language: code }]')); return { menu: plant(MENU, 'm-arr', (s) => s + ' ', [['../utils/languageRequest.js', '../utils/' + r.split('/').pop()]]) } } },
  { name: 'a second event is fired', files: () => ({ menu: plant(MENU, 'twice', (s) => s.replace("  if (requestLanguage(sel, code)) {", "  sel.getRootNode().host.dispatchEvent(new CustomEvent('language-change', { detail: { language: code } }))\n  if (requestLanguage(sel, code)) {")) }) },
  { name: 'a cancelled pick still switches', files: () => ({ menu: plant(MENU, 'ignorecancel', (s) => s.replace('  if (requestLanguage(sel, code)) {', '  if (requestLanguage(sel, code) || true) {')) }) },
  { name: '?lang= is written on any page', files: () => { const r = plant(REQ, 'anypage', (s) => s.replace('win.MAP_OWNS_PAGE !== true || ', '')); return { menu: plant(MENU, 'm-anypage', (s) => s + ' ', [['../utils/languageRequest.js', '../utils/' + r.split('/').pop()]]) } } },
  { name: 'the hidden current language is dropped', files: () => ({ menu: plant(MENU, 'nocurrent', (s) => s.replace('    if (cur) list.push(cur)', '    if (cur && !cur.hideFromSwitcher) list.push(cur)')) }) },
  { name: 'a switcher language has no catalogue', files: () => ({ langs: plant(LANGS, 'xx', (s) => s.replace("{ code: 'ru', name: 'Russian',", "{ code: 'xx', name: 'Nowhere', nativeName: 'Nowhere', flag: '' },\n  { code: 'ru', name: 'Russian',")) }) },
]

let exit = 0
try {
  if (process.argv.includes('--self-test')) {
    let caught = 0
    for (const p of POISONS) {
      try {
        const bad = await audit(p.files())
        if (bad.length) { caught++; console.log(`  ${p.name}: caught (${bad[0].slice(0, 90)})`) }
        else { console.log(`  ${p.name}: NOT CAUGHT`); exit = 1 }
      } finally {
        while (PLANTED.length) rmSync(join(ROOT, PLANTED.pop()), { force: true })
      }
    }
    console.log(exit ? `SHELL-HEADER SELF-TEST: FAIL — ${POISONS.length - caught} of ${POISONS.length} defects passed.` : `SHELL-HEADER SELF-TEST: PASS — all ${POISONS.length} planted defects refused.`)
  } else {
    const bad = await audit()
    if (bad.length) { exit = 1; console.log(`SHELL-HEADER: FAIL — ${bad.length} problem(s)`); for (const b of bad) console.log('  ✗ ' + b) }
    else console.log('SHELL-HEADER: PASS — one top bar on a narrow header-off layout in both modes (web: no camera inset), never a corner circle; #rail-end only on a wide one; one cancelable composed doxa-language-request per pick; cancelled → no switch; ?lang= only on tree-owned pages; the switcher has catalogues and the current language is always listed.')
  }
} finally {
  while (PLANTED.length) rmSync(join(ROOT, PLANTED.pop()), { force: true })
  await server.close()
}
process.exit(exit)
