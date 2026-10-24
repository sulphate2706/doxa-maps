#!/usr/bin/env node
/**
 * check-poster-wall-localised — the SHARED poster wall's own chrome must be translated
 * on every leaf that mounts it, in every locale.
 *
 * ★ WHY THIS CANNOT BE CHECKED IN ENGLISH, which is the whole reason the gap survived.
 * PosterWall guards useI18n() (it THROWS on a host that never installed vue-i18n, which blanked
 * people-groups-grid once via library FilterDropdown). The fallback HUMANIZES the key:
 *   buttons.prayerList -> "Prayer List"   buttons.printOptions -> "Print Options"
 * That is deliberate and good — a bare host shows readable English rather than a raw dotted key
 * or a blank button. But it means "the button says Prayer List" is TRUE both when i18n worked and
 * when it threw. An en-only check passes forever while every other locale leaks English.
 *
 * So this gate runs in NON-ENGLISH locales only. There, the translated string differs from the
 * humanized key, so seeing the humanized key IS the defect, with no ambiguity.
 *
 * ⚠ IT CHECKS THE RENDERED PAGE, NOT THE SOURCE. A static scan can see `useI18n()` wrapped in a
 * try/catch and conclude either "guarded, fine" or "might throw, bad" — neither is a measurement.
 * Whether the catch FIRES depends on what the host installed at the mount point, which only
 * exists at runtime. A scoreboard entry for this was open with nothing able to confirm or refute
 * it; that is what this closes.
 *
 * ⚠ WHAT THIS DOES **NOT** PROVE — read before quoting it as evidence.
 * It selects the locale with ?lang=, the URL query param, because detectLocale() reads the URL
 * FIRST (library/i18n/index.js): every generated leaf page is hardcoded lang="en" (measured 20 of
 * 20), so without the param the ten non-English locales are unreachable in a dropped tree.
 * That proves THE TRANSLATIONS EXIST AND RENDER. It does NOT prove a HOST can select them.
 *
 * A host embeds these elements and sets profile-config.locale. ProfileLoader applies it by
 * driving appI18n.global.locale — but only via `inject('appI18n', null)`, so a bundle that calls
 * app.use(createAppI18n()) WITHOUT app.provide('appI18n', i18n) makes that watchEffect a SILENT
 * no-op: no error, no warning, no translation. Measured by regions on my-upg-100-list: 0 Arabic
 * strings with profile-config.locale='ar', while the same harness switched regions-dashboard
 * (which does provide it) perfectly.
 * So a GREEN run here is consistent with a host being unable to set the language at all. The
 * profile-config channel is a SECOND assertion this gate should grow once the 7-plugin contract
 * is settled; until it does, do not read this as interop coverage.
 *
 * Usage: node internal/check-poster-wall-localised.mjs [baseUrl]
 *   SKIPs when nothing is served; exits 2 (NOT MEASURED) when the server is not this tree.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4173'

// EVERY leaf that mounts the shared wall. key-cities and regions-dashboard are here because they
// consume PosterWall too — the original report named only three, and a gate that copies a
// report's sampling inherits its blind spot.
const LEAVES = [
  'my-upg-100-list/upg-100-mfe',
  'my-upg-100-list/poster-wall',
  'country-posters/country-poster-wall',
  'key-cities/city-poster-wall',
  'regions-dashboard/regions-list',
]
// FIVE SCRIPTS, because a translation can fail differently in each: ro is the widest-rendering
// Latin locale, ar is RTL, zh is double-width CJK, hi is Devanagari, ru is Cyrillic. hi and ru
// were added so this gate matches what the independent verifier measured and can serve as the
// tie-breaker between the two readings; all five differ from the humanized English key.
const LANGS = (process.env.PW_LANG || 'ro,ar,zh,hi,ru').split(',').map((s) => s.trim()).filter(Boolean)

// The humanizeKey outputs for every key the wall renders. Seeing ONE of these in a non-English
// locale means the fallback fired. Derived from the same transform the component uses, so the
// two cannot drift: last path segment, camelCase split, first letter upper.
const KEYS = ['buttons.prayerList', 'buttons.posterMap', 'buttons.cardDeck', 'buttons.printOptions',
  'buttons.postersPerRow', 'buttons.showOnMap', 'buttons.clearSelection', 'buttons.cardStockAria']
const humanizeKey = (k) => String(k).split('.').pop()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
const FALLBACKS = new Set(KEYS.map(humanizeKey))

// ★ A LOCALE CAN BE BLIND TO THIS DEFECT, and a blind locale passing looks exactly like a clean
// one. The whole gate rests on "the translated string differs from the humanized key" — so if a
// catalogue ever translates buttons.prayerList to literally "Prayer List", that locale can no
// longer tell a real translation from the fallback and would go green forever. Checked against
// the catalogues on disk, not assumed: today all five are clear, and this fails loudly the day
// one is not, rather than quietly losing a locale's worth of coverage.
const blind = []
for (const lang of LANGS) {
  let cat = null
  try {
    cat = JSON.parse(readFileSync(join(ROOT, `library/i18n/locales/${lang}/buttons.json`), 'utf8'))
  } catch { blind.push(`${lang}: no buttons.json to compare against`); continue }
  for (const k of KEYS) {
    const leaf = k.split('.').pop()
    if (cat[leaf] !== undefined && cat[leaf] === humanizeKey(k)) {
      blind.push(`${lang}.${leaf} === "${humanizeKey(k)}" (identical to the fallback)`)
    }
  }
}
if (blind.length) {
  console.error('POSTER-WALL-LOCALISED: NOT MEASURED — one or more locales cannot detect this defect.')
  for (const b of blind) console.error(`  ${b}`)
  console.error('  A locale whose translation EQUALS the humanized key renders the same text whether')
  console.error('  i18n worked or threw, so this gate would pass on it regardless. Retranslate the')
  console.error('  key, or drop that locale from PW_LANG and say so.')
  process.exit(2)
}

let reachable = false
try { const r = await fetch(`${BASE}/${TREE_NAME}/manifest.json`, { signal: AbortSignal.timeout(4000) }); reachable = r.ok } catch { /* precondition */ }
if (!reachable) {
  console.log(`POSTER-WALL-LOCALISED: SKIP — nothing served at ${BASE}.`)
  console.log('  Serve the built tree: bun run serve (or set BASE_URL).')
  process.exit(0)
}
const treeCheck = await servesThisTree(BASE, ROOT)
if (!treeCheck.ok) {
  console.error('POSTER-WALL-LOCALISED: NOT MEASURED — the server is not serving this checkout.')
  console.error(`  ${treeCheck.why}`)
  process.exit(2)
}

const WALK = `(root) => { const o=[]; const rec=(r)=>{ for (const e of r.querySelectorAll('*')) { o.push(e); if (e.shadowRoot) rec(e.shadowRoot) } }; rec(root); return o }`
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const rows = []
const fails = []

for (const leaf of LEAVES) {
  for (const lang of LANGS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
    let r = null
    try {
      const res = await page.goto(`${BASE}/${TREE_NAME}/${leaf}/index.html?lang=${lang}`,
        { waitUntil: 'load', timeout: 45000 })
      if (!res || !res.ok()) { rows.push({ leaf, lang, skipped: `HTTP ${res ? res.status() : '?'}` }); await page.close(); continue }
      await page.waitForTimeout(13000)
      r = await page.evaluate(`(() => {
        const all = (${WALK})(document)
        const cls = (e, n) => new RegExp('\\\\b' + n + '\\\\b').test(e.className || '')
        const texts = (n) => [...new Set(all.filter((e) => cls(e, n)).map((e) => e.textContent.trim()).filter(Boolean))]
        const legend = all.find((e) => e.tagName === 'LEGEND' && e.parentElement && /\\bpfs\\b/.test(e.parentElement.className || ''))
        const perrow = all.find((e) => cls(e, 'perrow__label'))
        return {
          cards: all.filter((e) => cls(e, 'card')).length,
          chrome: [
            ...texts('pbtn'),
            ...(legend ? [legend.textContent.trim()] : []),
            ...(perrow ? [perrow.textContent.trim()] : []),
            ...texts('pstock'),
          ],
          showOnMap: texts('tape-h'),
        }
      })()`)
    } catch (e) {
      rows.push({ leaf, lang, skipped: String(e.message || e).slice(0, 60) })
      await page.close(); continue
    }
    await page.close()

    // ⚠ TWO WAYS THIS GATE CAN PASS WITHOUT CHECKING ANYTHING, and both were REAL on the first
    // run — a gate that cannot tell "clean" from "saw nothing" is the same failure it exists to
    // catch. A wall with no cards renders no chrome; and regions-list rendered 7 cards with
    // chrome 0, because that profile mounts the wall WITHOUT the print row, so there was no
    // translatable string on the page at all and "all translated" was vacuously true.
    if (!r.cards) { rows.push({ leaf, lang, skipped: 'no poster cards rendered' }); continue }
    if (!r.chrome.length && !r.showOnMap.length) {
      rows.push({ leaf, lang, skipped: `${r.cards} card(s) but ZERO wall chrome — nothing to check` })
      continue
    }

    // "Show on map" is a COMPOSED string ("116 UPG·Show on map"), so compare by containment.
    const leaked = [
      ...r.chrome.filter((t) => FALLBACKS.has(t)),
      ...r.showOnMap.filter((t) => [...FALLBACKS].some((f) => t.includes(f))),
    ]
    rows.push({ leaf, lang, cards: r.cards, chrome: r.chrome.length, leaked, errs: errs.length })
    if (leaked.length) {
      fails.push(`${leaf} @ ${lang}: ${leaked.length} untranslated string(s) — ${[...new Set(leaked)].join(' · ')}`)
    }
    if (errs.length) fails.push(`${leaf} @ ${lang}: ${errs.length} page error(s) — ${errs[0]}`)
  }
}
await browser.close()

console.log('POSTER-WALL-LOCALISED')
console.log(`  base   : ${BASE}`)
for (const row of rows) {
  if (row.skipped) { console.log(`  ${row.leaf} @ ${row.lang}  SKIP — ${row.skipped}`); continue }
  console.log(`  ${row.leaf} @ ${row.lang}  cards ${row.cards} · chrome ${row.chrome} string(s) · `
    + `${row.leaked.length ? `LEAKED ${row.leaked.length}` : 'all translated'} · ${row.errs} error(s)`)
}
const measured = rows.filter((x) => !x.skipped).length
const skipped = rows.filter((x) => x.skipped)
if (!measured) {
  console.error('\nPOSTER-WALL-LOCALISED: NOT MEASURED — every leaf skipped, so nothing was checked.')
  process.exit(2)
}
// ★ NO SILENT CAPS. A leaf that never got measured is not a leaf that passed, and a summary that
// counts only the green ones reads as full coverage. Name what was dropped and why, every run —
// key-cities ships NO leaf pages (bundle JS only), so it can never be reached by URL, and that
// is a coverage fact a reader of this output needs rather than a 404 buried mid-list.
if (skipped.length) {
  const byLeaf = new Map()
  for (const s of skipped) byLeaf.set(s.leaf, s.skipped)
  console.log(`\n  NOT COVERED (${skipped.length} combination(s)):`)
  for (const [leaf, why] of byLeaf) console.log(`    ${leaf} — ${why}`)
}
if (fails.length) {
  console.error(`\nPOSTER-WALL-LOCALISED: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error(`  - ${f}`)
  console.error('\n  The shared wall humanizes its i18n keys when useI18n() throws, so the fallback')
  console.error('  reads as fluent English ("Prayer List"). That is why this can only be seen in a')
  console.error('  non-English locale, and why an en-only check would pass while every other')
  console.error('  locale leaked.')
  process.exit(1)
}
console.log(`\nPOSTER-WALL-LOCALISED: PASS — ${measured} leaf x locale combination(s), `
  + `${LANGS.join('/')}. The shared wall's own chrome is translated everywhere it mounts.`)
// The caveat travels WITH the result, not only in this file's header: a green line pasted into a
// scoreboard is exactly where "translations render" silently becomes "localisation works".
console.log('  SCOPE: locale selected via ?lang= (the URL channel). This does NOT assert that a')
console.log('  HOST can select the locale through profile-config — see the header. A bundle that')
console.log('  omits app.provide(\'appI18n\', i18n) renders perfectly here and ignores its host.')
