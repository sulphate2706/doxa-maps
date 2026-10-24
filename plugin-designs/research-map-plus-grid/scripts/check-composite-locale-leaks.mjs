#!/usr/bin/env node
/**
 * check-composite-locale-leaks.mjs — a composite rendered in a non-English locale must not show a
 * string the catalogue already translates.
 *
 * WHY THIS REPLACES THE PREVIOUS SWEEP, AND WHY THE PREVIOUS SWEEP PASSED A BROKEN TREE.
 * The old method split every rendered string into "third-party", "DATA" and "CHROME" and counted
 * only the third bucket. That split is a GUESS, and it guessed wrong in exactly the place the
 * defect lived: single words like 'Region', 'Prayer', 'Country', 'Language' read as data — they are
 * plausible values as well as plausible labels — so 28 distinct leaks on Big Picture and 41 on
 * Simple Research scored as zero. An independent verifier found them on the same tree the sweep had
 * just called clean.
 *
 * ★ THE CRITERION IS NOT A CATEGORY, IT IS A LOOKUP. A rendered string is a LEAK when:
 *
 *     the English catalogue holds that exact string as a value, AND
 *     this locale's catalogue holds a DIFFERENT value for that same key, AND
 *     the page still renders the English one.
 *
 * No judgement about what kind of word it is. If the translation exists and the reader is not
 * getting it, that is the defect, whatever the word looks like. A data value that merely coincides
 * with a catalogue entry is the only false positive this can produce, and it is one we WANT to see:
 * a coincidence worth suppressing is worth suppressing by name, in this file, with a reason.
 *
 * WHERE THE DEFECT ACTUALLY IS. Not in the library components — they translate. The English is
 * hardcoded at the CALL SITE, passed down as a prop that no lookup ever touches:
 *
 *     <FilterDropdown :label="'Prayer'">     research-dashboard/.../DashboardResearchFilters.vue
 *
 * A component that is perfectly localized renders English because it was handed English.
 *
 * Exit: 0 pass or SKIP (no built tree, no browser, no data) · 1 fail.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from '../../../internal/_tree-name.mjs'

const TAG = 'COMPOSITE-LOCALE-LEAKS'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const LOCALES_DIR = join(ROOT, 'library', 'i18n', 'locales')
const skip = (why) => { console.log(`${TAG}: SKIP — ${why}`); process.exit(0) }

if (!existsSync(MANIFEST)) skip('no built manifest (run `bun run tree` first).')
if (!existsSync(LOCALES_DIR)) skip('no locale catalogues to compare against.')
let chromium
try { ({ chromium } = await import('../../../internal/lib/playwright-guarded.mjs')) } catch { skip('playwright is not installed.') }

// The composites in this lane. Both, always: the two share the grid and half the chrome, and a fix
// proved on one has repeatedly been stale on the other.
const COMPOSITES = ['research-map-plus-grid', 'dashboard-plus-grid']
const LOCALES = (process.env.LEAK_LOCALES || 'ar').split(',').map((s) => s.trim()).filter(Boolean)

// ── the catalogues, flattened to key -> value ────────────────────────────────────────────────────
const flatten = (obj, prefix, out) => {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else if (typeof v === 'string') out[key] = v
  }
  return out
}
const catalogue = (locale) => {
  const dir = join(LOCALES_DIR, locale)
  if (!existsSync(dir)) return null
  const out = {}
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    flatten(JSON.parse(readFileSync(join(dir, f), 'utf8')), f.replace(/\.json$/, ''), out)
  }
  return out
}
const EN = catalogue('en')
if (!EN) skip('no English catalogue to compare against.')

// English value -> the keys that carry it. A word like 'Region' is usually several keys; ONE key
// with a real translation is enough to make rendering the English a leak.
const byEnglish = new Map()
for (const [key, val] of Object.entries(EN)) {
  const v = String(val).trim()
  if (!v) continue
  if (!byEnglish.has(v)) byEnglish.set(v, [])
  byEnglish.get(v).push(key)
}

// ── the two things a catalogue lookup CANNOT tell apart, suppressed BY NAME with a reason ───────
// The criterion asks "does the catalogue translate this string", and for two kinds of text that
// question is the wrong one. Each entry here is a surface, not a string: suppressing a WORD would
// hide the next real leak that happens to use it, while suppressing a surface says exactly which
// element is not ours to translate and why.
const SUPPRESS = [
  { where: /^(canvas|button|a|div)\.(mapboxgl|maplibregl)-/, why: "vendor chrome — mapbox-gl/maplibre-gl render these themselves ('Map', 'Clear', 'Toggle attribution'); we pass the geocoder its placeholder and have no hook for the rest" },
  { where: /^div\.rd-td$/, why: 'a table DATA cell — the row value as the API returned it, not chrome. "Unengaged" here is a datum that happens to match controls.unengaged' },
  { where: /^span\.fr-lbl$/, why: 'a facet-rail VALUE (region names, affinity blocs, religion families as the data spells them) — the rail\'s own headings are chrome and are not in this class' },
]

// ── serve the built tree ─────────────────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const leafOf = (bundle) => {
  const b = (manifest.bundles || []).find((x) => x.bundle === bundle)
  const p = b && (b.profiles || []).find((p) => p.iframeUrl)
  return p ? String(p.iframeUrl).replace(/^\.\//, '') : null
}
const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const PORT = await freePort()
const TREE = `http://127.0.0.1:${PORT}/${TREE_NAME}`
const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
const cleanup = () => { try { tree.kill() } catch { /* already gone */ } }
await new Promise((r) => setTimeout(r, 900))
if (!await fetch(`${TREE}/manifest.json`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false)) {
  cleanup(); skip('could not serve the built tree locally.')
}
const { requireThisTree } = await import(join(ROOT, 'internal', '_serves-this-tree.mjs'))
await requireThisTree(TREE, ROOT, TAG)

// ── collect every rendered string, shadow roots included ─────────────────────────────────────────
const COLLECT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await sleep(12000)                                  // let both halves fetch and render
  const found = new Map()
  const note = (text, el) => {
    const t = String(text || '').replace(/\\s+/g, ' ').trim()
    if (!t || t.length > 120) return
    const where = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '')
    if (!found.has(t)) found.set(t, { count: 0, where })
    found.get(t).count++
  }
  const seen = new Set()
  const walk = (root) => {
    if (!root || seen.has(root)) return
    seen.add(root)
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot)
      // Only a node's OWN text: taking textContent would report every ancestor as carrying the
      // string too, and one leak would score as a dozen.
      for (const n of el.childNodes) {
        if (n.nodeType === 3) note(n.nodeValue, el)
      }
      for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
        const v = el.getAttribute && el.getAttribute(a)
        if (v) note(v, el)
      }
    }
  }
  walk(document)
  return [...found.entries()].map(([text, m]) => ({ text, count: m.count, where: m.where }))
})()`

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
const report = []
let totalDistinct = 0
try {
  for (const locale of LOCALES) {
    const LOC = catalogue(locale)
    if (!LOC) { report.push({ locale, skip: 'no catalogue' }); continue }
    for (const bundle of COMPOSITES) {
      const leaf = leafOf(bundle)
      if (!leaf) { report.push({ locale, bundle, skip: 'no leaf in the manifest' }); continue }
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.goto(`${TREE}/${leaf}?lang=${locale}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const strings = await page.evaluate(COLLECT)
      await page.close()

      const leaks = []
      const suppressed = []
      for (const s of strings) {
        const keys = byEnglish.get(s.text)
        if (!keys) continue
        // Translated somewhere for this locale? One key is enough — and the translation must differ
        // from the English, or there is nothing for the reader to be missing.
        const translated = keys.filter((k) => LOC[k] && String(LOC[k]).trim() && String(LOC[k]).trim() !== s.text)
        if (!translated.length) continue
        const muted = SUPPRESS.find((r) => r.where.test(s.where))
        if (muted) { suppressed.push({ ...s, why: muted.why }); continue }
        leaks.push({ ...s, keys: translated.slice(0, 2) })
      }
      if (process.env.LEAK_DUMP) {
        console.log(`--- ${bundle} [${locale}] all ${strings.length} rendered strings ---`)
        for (const s of strings) console.log(`    ${s.where}  |  ${s.text}`)
      }
      leaks.sort((a, b) => b.count - a.count)
      totalDistinct += leaks.length
      report.push({ locale, bundle, leaks, suppressed, scanned: strings.length })
    }
  }
} catch (err) {
  cleanup(); await browser.close().catch(() => {})
  console.log(`${TAG}: FAIL — the measurement itself failed: ${err && err.message}`)
  process.exit(1)
} finally {
  await browser.close().catch(() => {})
  cleanup()
}

for (const r of report) {
  if (r.skip) { console.log(`  · ${r.locale} ${r.bundle || ''} — SKIPPED (${r.skip})`); continue }
  const n = r.leaks.length
  const instances = r.leaks.reduce((a, l) => a + l.count, 0)
  console.log(`  ${n ? '✗' : '✓'} ${r.bundle} [${r.locale}] — ${n} distinct leak(s), ${instances} instance(s), of ${r.scanned} rendered string(s)`)
  for (const l of r.leaks.slice(0, 12)) {
    console.log(`      '${l.text}'  ×${l.count}  ${l.where}  → ${l.keys.join(', ')}`)
  }
  if (n > 12) console.log(`      … and ${n - 12} more`)
  for (const m of r.suppressed || []) console.log(`      (not counted) '${m.text}' ×${m.count} ${m.where} — ${m.why}`)
}

if (totalDistinct) {
  console.log(`\n${TAG}: FAIL — ${totalDistinct} string(s) render in English on a page asked for another locale, and the catalogue has a translation for every one of them.`)
  console.log('  The library components translate; the English is hardcoded at the CALL SITE and')
  console.log('  handed down as a prop (e.g. FilterDropdown :label="\'Prayer\'").')
  process.exit(1)
}
console.log(`${TAG}: PASS — nothing the catalogue translates is rendering in English.`)
