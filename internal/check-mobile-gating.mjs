#!/usr/bin/env node
/**
 * check-mobile-gating.mjs — one phone flag per map, and every surface follows it (SPEC-MOBILE-FLAG).
 *
 * A map declares how it behaves on a narrow screen ONCE, in <profile>.meta.json:
 *   "mobile": "desktop-only"     blocked on a phone (the Gallery disables its row; the leaf shows why)
 *   "mobile": "larger-screens"   opens on a phone, under a dismissible notice
 *   absent                       phone-ready
 * generate-tree carries it into the manifest and the leaf page's BASE_CONFIG; the Research Gallery
 * derives its rules from the manifest; ProfileLoader shows the leaf's notice. This fails if:
 *   (a) a meta.json declares a value outside that vocabulary (a typo must not read as phone-ready);
 *   (b) a flagged profile's leaf page does not carry the flag, or a leaf carries one its meta dropped;
 *   (c) the Gallery hard-codes an id set again, stops deriving from the manifest, or stops failing
 *       closed on a phone before the manifest lands (its baked first tab would mount there);
 *   (d) dashboard-plus-grid stops being desktop-only — the migration must not soften that gate;
 *   (e) a locale loses one of the notice sentences, or the desktop-only one stops naming the map;
 *   (f) ProfileLoader stops mounting the notice, or the rule stops staying quiet inside the Gallery;
 *   (g) a flagged profile's element is mounted by neither ProfileLoader nor its own useScreenGate —
 *       dashboard-plus-grid defines its element without ProfileLoader, so its leaf carried
 *       "desktop-only" and mounted the map on a phone anyway (measured at 390px).
 * `--self-test` plants one bad case per rule and proves each can fail before a pass is trusted.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MOBILE } from './profile-meta.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPA = join(ROOT, 'plugin-designs/doxa-maps-spa/doxa-maps-spa.vue')
const STRINGS = join(ROOT, 'plugin-designs/doxa-maps-spa/src/strings.js')
const LOADER = join(ROOT, 'library/ProfileLoader.vue')
const GATE = join(ROOT, 'library/composables/useScreenGate.js')
const SPA_KEYS = ['mobileNotBuilt', 'dismiss']
const LIB_KEYS = ['largerScreenNotice', 'desktopOnlyNotice', 'noticeDismiss']

export function checkGating({ metas, leaves, spaSrc, spaLocales, libLocales, loaderSrc, gateSrc, mounts }) {
  const errs = []
  // (a) the vocabulary
  for (const m of metas) {
    if (m.mobile !== undefined && !MOBILE.includes(m.mobile)) errs.push(`${m.bundle}/${m.profile}.meta.json: mobile "${m.mobile}" is not one of ${MOBILE.join(' | ')}`)
  }
  // (b) the leaf pages carry exactly what the metas declare
  for (const m of metas) {
    const key = `${m.bundle}/${m.profile}`
    if (!(key in leaves)) continue                        // no leaf page in this tree: nothing to carry
    const got = leaves[key] ? leaves[key].mobile : undefined
    const want = MOBILE.includes(m.mobile) ? m.mobile : undefined
    if (got !== want) errs.push(`${key}: the leaf page says mobile ${JSON.stringify(got)}, its meta.json says ${JSON.stringify(want)} (regenerate the tree)`)
  }
  // (c) the Gallery derives, and fails closed
  if (/const (DESKTOP_ONLY|MOBILE_NOTICE) = new Set\(/.test(spaSrc)) errs.push('the Gallery hard-codes a DESKTOP_ONLY / MOBILE_NOTICE id set again; the flag lives in meta.json')
  if (!/this\.mobileFlags = mobileFlagsFromManifest\(m\)/.test(spaSrc)) errs.push('applyManifest no longer records the flags from the manifest')
  if (!/isDesktopOnly\(id\)\s*\{\s*return this\.narrow && this\.mobileFlagOf\(id\) === 'desktop-only'/.test(spaSrc)) errs.push("isDesktopOnly no longer reads narrow + the 'desktop-only' flag")
  if (!/showsMobileNotice\(id\)\s*\{\s*return this\.narrow && this\.mobileFlagOf\(id\) === 'larger-screens'/.test(spaSrc)) errs.push("showsMobileNotice no longer reads narrow + the 'larger-screens' flag")
  if (!/if \(this\.narrow && this\.mobileFlags === null\) return/.test(spaSrc)) errs.push('select() no longer waits for the flags on a phone: the baked first tab would mount before the manifest says it is desktop-only')
  if (!/v-if="showsMobileNotice\(t\.id\)"[^>]*role="status"/.test(spaSrc)) errs.push('the pane notice (showsMobileNotice, role=status) is not rendered')
  if (!/data-doxa-gallery=""/.test(spaSrc)) errs.push('Gallery panes no longer carry data-doxa-gallery: a map inside would show a second notice')
  // (d) the one gate the migration must not soften
  const dpg = metas.find((m) => m.bundle === 'dashboard-plus-grid' && m.profile === 'dashboard-plus-grid')
  if (!dpg || dpg.mobile !== 'desktop-only') errs.push('dashboard-plus-grid is no longer "mobile": "desktop-only" (Big Picture is blocked on phones)')
  // (e) the sentences
  for (const [loc, t] of Object.entries(spaLocales || {})) {
    for (const k of SPA_KEYS) if (!t || !String(t[k] || '').trim()) errs.push(`Gallery strings ${loc}: missing ${k}`)
  }
  if (Object.keys(spaLocales || {}).length < 11) errs.push(`Gallery strings: ${Object.keys(spaLocales || {}).length} locales, expected 11`)
  for (const [loc, t] of Object.entries(libLocales || {})) {
    for (const k of LIB_KEYS) if (!t || !String(t[k] || '').trim()) errs.push(`library messages ${loc}: missing ${k}`)
    if (t && t.desktopOnlyNotice && !t.desktopOnlyNotice.includes('{label}')) errs.push(`library messages ${loc}: desktopOnlyNotice does not name the map ({label})`)
  }
  if (Object.keys(libLocales || {}).length < 11) errs.push(`library messages: ${Object.keys(libLocales || {}).length} locales, expected 11`)
  // (f) the leaf's own notice
  if (!/<LargerScreenNotice v-else-if="blockedOnThisScreen"/.test(loaderSrc)) errs.push('ProfileLoader no longer replaces a desktop-only profile with the notice on a phone')
  if (!/<LargerScreenNotice v-if="adviseOnThisScreen"/.test(loaderSrc)) errs.push('ProfileLoader no longer shows the larger-screens notice')
  if (!/useScreenGate\(config\)/.test(loaderSrc)) errs.push('ProfileLoader no longer applies the phone rule (useScreenGate)')
  if (!/hasAttribute\('data-doxa-gallery'\)/.test(gateSrc)) errs.push('the phone rule no longer stays quiet inside the Gallery (data-doxa-gallery)')
  // (g) every flagged profile's element actually applies the rule
  for (const m of metas) {
    if (!MOBILE.includes(m.mobile)) continue
    const how = mounts[`${m.bundle}/${m.profile}`] || {}
    if (!how.viaLoader && !how.ownGate) errs.push(`${m.bundle}/${m.profile} is flagged "${m.mobile}" but its element mounts through neither ProfileLoader nor useScreenGate — the leaf would carry the flag and ignore it`)
  }
  return errs
}

function readMetas() {
  const out = []
  const base = join(ROOT, 'plugin-designs')
  for (const bundle of readdirSync(base)) {
    let files = []
    try { files = readdirSync(join(base, bundle)).filter((f) => f.endsWith('.meta.json')) } catch { continue }
    for (const f of files) {
      try {
        const meta = JSON.parse(readFileSync(join(base, bundle, f), 'utf8'))
        out.push({ bundle, profile: f.replace(/\.meta\.json$/, ''), mobile: meta.mobile })
      } catch { /* an unreadable meta is other gates' business */ }
    }
  }
  return out
}

// A leaf page's BASE_CONFIG, or null when the page has none. Keyed "bundle/profile"; only pages that exist.
function readLeaves(metas) {
  const out = {}
  for (const m of metas) {
    const page = join(ROOT, 'public', TREE_NAME, m.bundle, m.profile, 'index.html')
    if (!existsSync(page)) continue
    const hit = readFileSync(page, 'utf8').match(/var BASE_CONFIG = (\{.*?\});/)
    try { out[`${m.bundle}/${m.profile}`] = hit ? JSON.parse(hit[1]) : null } catch { out[`${m.bundle}/${m.profile}`] = null }
  }
  return out
}

async function readSpaLocales() {
  const mod = await import(pathToFileURL(STRINGS).href)
  return Object.values(mod).find((v) => v && typeof v === 'object' && v.en) || {}
}

function readLibLocales() {
  const out = {}
  const base = join(ROOT, 'library/i18n/locales')
  for (const lc of readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    try { out[lc] = JSON.parse(readFileSync(join(base, lc, 'messages.json'), 'utf8')) } catch { out[lc] = null }
  }
  return out
}

// How each profile's element is mounted: through ProfileLoader (the bundle's index.js), or by a root that
// calls useScreenGate itself (the profile's own .vue).
function readMounts(metas) {
  const out = {}
  for (const m of metas) {
    const dir = join(ROOT, 'plugin-designs', m.bundle)
    let entry = '', own = ''
    try { entry = readFileSync(join(dir, 'index.js'), 'utf8') } catch { /* no entry */ }
    try { own = readFileSync(join(dir, `${m.profile}.vue`), 'utf8') } catch { /* no single-file profile */ }
    // An IMPORT, not a mention: dashboard-plus-grid's index.js names ProfileLoader in a comment, and a
    // word match counted that as mounting through it.
    out[`${m.bundle}/${m.profile}`] = {
      viaLoader: /^\s*import\s[^;]*\b(?:ProfileLoader|defineMapElement)\b/m.test(entry),
      ownGate: /^\s*import\s[^;]*\buseScreenGate\b/m.test(own) && /\buseScreenGate\(/.test(own),
    }
  }
  return out
}

const metas = readMetas()
const real = {
  metas,
  leaves: readLeaves(metas),
  spaSrc: readFileSync(SPA, 'utf8'),
  spaLocales: await readSpaLocales(),
  libLocales: readLibLocales(),
  loaderSrc: readFileSync(LOADER, 'utf8'),
  gateSrc: readFileSync(GATE, 'utf8'),
  mounts: readMounts(metas),
}

if (process.argv.includes('--self-test')) {
  const flagged = real.metas.find((m) => m.mobile && `${m.bundle}/${m.profile}` in real.leaves)
  const withMeta = (fn) => ({ ...real, metas: real.metas.map((m) => fn({ ...m })) })
  const cases = [
    ['a clean tree passes', real, 0],
    ['(a) a typo in the vocabulary', withMeta((m) => (m.bundle === 'gospel-internet' && m.profile === 'board' ? { ...m, mobile: 'larger-screen' } : m)), 1],
    ['(b) a flagged leaf page without the flag', flagged ? { ...real, leaves: { ...real.leaves, [`${flagged.bundle}/${flagged.profile}`]: {} } } : null, 1],
    ['(b) a leaf page carrying a flag its meta dropped', flagged ? withMeta((m) => (m === flagged || (m.bundle === flagged.bundle && m.profile === flagged.profile) ? { ...m, mobile: undefined } : m)) : null, 1],
    ['(c) the id set comes back', { ...real, spaSrc: real.spaSrc + "\nconst DESKTOP_ONLY = new Set(['dashboard-plus-grid'])" }, 1],
    ['(c) select() stops waiting for the flags', { ...real, spaSrc: real.spaSrc.replace('if (this.narrow && this.mobileFlags === null) return', '') }, 1],
    ['(c) the pane notice is removed', { ...real, spaSrc: real.spaSrc.replace('v-if="showsMobileNotice(t.id)"', 'v-if="false"') }, 1],
    ['(d) Big Picture is softened', withMeta((m) => (m.bundle === 'dashboard-plus-grid' ? { ...m, mobile: 'larger-screens' } : m)), 1],
    ['(e) a locale loses the notice', { ...real, libLocales: { ...real.libLocales, ar: { ...real.libLocales.ar, largerScreenNotice: '' } } }, 1],
    ['(e) the desktop-only sentence stops naming the map', { ...real, libLocales: { ...real.libLocales, zh: { ...real.libLocales.zh, desktopOnlyNotice: '仅支持桌面端' } } }, 1],
    ['(f) ProfileLoader stops blocking', { ...real, loaderSrc: real.loaderSrc.replace('v-else-if="blockedOnThisScreen"', 'v-else-if="false"') }, 1],
    ['(g) a flagged composite drops its own gate', { ...real, mounts: { ...real.mounts, 'dashboard-plus-grid/dashboard-plus-grid': { viaLoader: false, ownGate: false } } }, 1],
  ]
  let ok = true
  for (const [name, input, want] of cases) {
    if (!input) { console.log(`  - ${name}: no flagged leaf page in this tree to plant it on`); ok = false; continue }
    const n = checkGating(input).length
    const pass = want === 0 ? n === 0 : n >= want
    if (!pass) ok = false
    console.log(`  ${pass ? '✓' : '✗'} ${name} -> ${n} error(s) (want ${want === 0 ? 0 : '≥' + want})`)
  }
  console.log(ok ? 'MOBILE-GATING SELF-TEST: PASS — every rule proven able to fail' : 'MOBILE-GATING SELF-TEST: FAIL')
  process.exit(ok ? 0 : 1)
}

const errs = checkGating(real)
if (errs.length) {
  console.error('MOBILE-GATING: FAIL\n' + errs.map((e) => '  ✗ ' + e).join('\n'))
  process.exit(1)
}
const list = (flag) => real.metas.filter((m) => m.mobile === flag).map((m) => `${m.bundle}/${m.profile}`).join(', ') || '(none)'
console.log(`MOBILE-GATING: PASS — desktop-only: ${list('desktop-only')} · larger-screens: ${list('larger-screens')} · leaf pages carry the flags · 11 locales`)
