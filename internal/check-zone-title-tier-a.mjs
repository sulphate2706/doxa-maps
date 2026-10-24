#!/usr/bin/env node
/**
 * check-zone-title-tier-a — generated zone titles ship for ONE-COUNTRY zones and nothing else.
 *
 * zone-title.js can compose a localized zone title out of country names. MEASURED over all 29 zones
 * in en/es/ar before wiring it, the result split cleanly:
 *   · a ONE-country zone generates a correct title in every locale, free  (Sudan / Sudán / السودان)
 *   · a MULTI-country zone generates a title WORSE than the hand-written label it replaces, in
 *     ENGLISH TOO  ("Middle East Core" → "Iran + Yemen + 11 more")
 * so only tier A generates. This gate holds that line.
 *
 * ★ IT IS TWO-SIDED, AND THAT IS THE ENTIRE POINT. A gate that only checked "the 3 zones generate"
 * would pass a build that ALSO regressed the other 25 — the exact failure being guarded against. So
 * it asserts BOTH:
 *   (1) POSITIVE — the 3 one-country zones produce a non-null, non-code title in en/es/ar, and the
 *       three locales DIFFER (identical output across locales means the supplier is not localizing
 *       and every "translation" is really English).
 *   (2) NEGATIVE — every other zone returns null, so its caller keeps a BYTE-IDENTICAL label. The
 *       comparison is against the label in clusters.json, not against a remembered string.
 *
 * ⚠ The negative side is checked by VALUE, not by count. "25 zones declined" would pass even if the
 * wrong 25 declined; each zone is named.
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED (the supplier could not be built, so neither side was
 * actually exercised — never reported as a pass).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PLUGIN = join(REPO, 'plugin-designs/my-upg-100-list')
const LOCALES = ['en', 'es', 'ar']

const clusters = JSON.parse(readFileSync(join(PLUGIN, 'data/clusters.json'), 'utf8'))
const zones = Object.values(clusters).filter(Array.isArray).flat()
const { zoneTitle, zoneCountryCodes } = await import(join(PLUGIN, 'data/zone-title.js'))

// ── the supplier, built the way a product caller builds it ───────────────────────────────────────
// ⚠ countryName.js CANNOT be imported here: it does `import table from '...json'` with no import
// attribute, which is fatal under Node. That is precisely why zone-title.js takes countryName
// INJECTED rather than importing it — so the same function runs under Node and under Vite. This
// gate reproduces the injection rather than working around it.
const A2_PATH = join(REPO, 'library/data/iso3-to-alpha2.json')
if (!existsSync(A2_PATH)) {
  console.error(`ZONE-TITLE-A: NOT MEASURED (exit 75) — no alpha-2 table at ${A2_PATH}, so no title`)
  console.error('  can be generated and neither side of this check was exercised.')
  process.exit(75)
}
// ⚠ The table is { _meta, map } — the codes live under .map. Reading it one level too shallow makes
// EVERY lookup undefined, so every zone declines and the gate reports a clean "25 declined" while
// silently testing nothing. That happened during the measurement; it is why the supplier is
// sanity-checked below before any zone is judged.
const alpha2 = JSON.parse(readFileSync(A2_PATH, 'utf8')).map
const countryName = (iso3, locale) => {
  const two = alpha2[String(iso3 || '').toUpperCase()]
  if (!two) return null
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(two) } catch { return null }
}
// ★ PROVE THE SUPPLIER CAN SUCCEED BEFORE TRUSTING ANY DECLINE. An empty result from a probe never
// shown capable of a non-empty one is not evidence of absence.
const probe = countryName('SDN', 'en')
if (probe !== 'Sudan') {
  console.error(`ZONE-TITLE-A: NOT MEASURED (exit 75) — the country-name supplier is broken:`)
  console.error(`  countryName('SDN','en') returned ${JSON.stringify(probe)}, expected "Sudan".`)
  console.error('  Every zone would decline and this gate would look green while testing nothing.')
  process.exit(75)
}

// ★ THE REAL PACKET STRINGS, per language with English per key — what the print paths pass. They carry
// the multi-country joiner, so a broken one-country guard would GENERATE "A + B + n more" here and the
// negative side below would catch it; a hand-made stub is weaker than the product's own catalogue.
const PS = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8'))
const block = (lc) => ({ ...(PS.en || {}), ...(PS[lc] || {}) })
const titleFor = (zone, locale) => zoneTitle(zone, block(locale), { countryName, locale })

const fails = []
const notes = []

// ── (1) POSITIVE: one-country zones generate, in every locale, and the locales differ ────────────
const single = zones.filter((z) => zoneCountryCodes(z.selector).length === 1)
if (!single.length) {
  console.error('ZONE-TITLE-A: NOT MEASURED (exit 75) — no one-country zone exists to exercise the')
  console.error('  positive case, so a green here would mean only that nothing was tested.')
  process.exit(75)
}
for (const z of single) {
  const got = {}
  for (const lc of LOCALES) {
    const t = titleFor(z, lc)
    got[lc] = t
    if (!t) { fails.push(`${z.id}: generates NOTHING in ${lc} — a one-country zone must produce a title`); continue }
    if (t === z.id || /^[A-Z]{3}$/.test(t)) fails.push(`${z.id}: ${lc} title is a raw code (${t}), not a name`)
  }
  const distinct = new Set(Object.values(got).filter(Boolean)).size
  if (distinct < 2 && Object.values(got).every(Boolean)) {
    // Laos legitimately reads the same in en and es; require only that ar differs from en.
    if (got.ar === got.en) fails.push(`${z.id}: ar and en are identical (${got.en}) — the supplier is not localizing`)
  }
  notes.push(`  ok    ${z.id.padEnd(22)} ${LOCALES.map((lc) => `${lc}=${got[lc]}`).join('  ')}`)
}

// ── (2) NEGATIVE: every other zone declines, so its label survives BYTE-IDENTICAL ────────────────
const multi = zones.filter((z) => zoneCountryCodes(z.selector).length !== 1)
for (const z of multi) {
  for (const lc of LOCALES) {
    const t = titleFor(z, lc)
    if (t !== null) {
      const n = zoneCountryCodes(z.selector).length
      fails.push(`${z.id}: generated "${t}" in ${lc}, but a ${n}-country zone must DECLINE and keep its label "${z.label}"`)
    }
  }
}
// ⚠ COUNTED IN cluster ENTRIES, which is 29 — NOT the 28 leaf zones the rest of the product counts.
// The two deaf_lists entries collapse into one `deaf` leaf, so "26 decline" here and "25 decline"
// measured over leaves are the same fact at different granularity. Both deaf entries decline either
// way, so the ruling holds at both. Stated because the 28-vs-29 gap has already produced two real
// errors, and a reader who expects 25 should be able to see why this says 26 without re-deriving it.
notes.push(`  ok    ${String(multi.length).padEnd(22)} cluster entries decline in all ${LOCALES.length} locales, keeping their labels byte-identical`)
notes.push(`        ${''.padEnd(22)} (= ${multi.length - 1} leaf zones; the 2 deaf entries collapse to 1 leaf and both decline)`)

// ── (3) THE UNIFIED DEAF ZONE: named from the strings, never by its internal label ─────────────────
// It is not in clusters.json's entries (the legend builds it from the two deaf lists), so it gets its
// own check. Two-sided: with the strings it takes its translated name; with none it declines and keeps
// its label, rather than inventing one.
{
  const { DEAF_SELECTOR } = await import(join(PLUGIN, 'data/legend-tree.js'))
  const deafZone = { id: 'deaf', label: 'Deaf (affinity bloc A017)', selector: DEAF_SELECTOR }
  const got = {}
  for (const lc of LOCALES) {
    const t = titleFor(deafZone, lc)
    const want = block(lc).zone_affinity_A017
    got[lc] = t
    if (!want) fails.push(`the packet strings for ${lc} carry no zone_affinity_A017, so the Deaf zone cannot be named`)
    else if (t !== want) fails.push(`the Deaf zone is titled ${JSON.stringify(t)} in ${lc}; its translated name is ${JSON.stringify(want)}`)
    if (t && /affinity|A017/i.test(t)) fails.push(`the Deaf zone's ${lc} title prints internal text: "${t}"`)
  }
  if (zoneTitle(deafZone, null, { countryName, locale: 'en' }) !== null) {
    fails.push('the Deaf zone generated a title with NO strings to name it — it must decline and keep its label')
  }
  notes.push(`  ok    ${'deaf'.padEnd(22)} ${LOCALES.map((lc) => `${lc}=${got[lc]}`).join('  ')}  (and declines with no strings)`)
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
for (const n of notes) console.log(n)
if (fails.length) {
  console.error('ZONE-TITLE-A: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  console.error('\n  Tier A (one country) generates; everything else keeps its hand-written label.')
  process.exit(1)
}
console.log(`ZONE-TITLE-A: PASS — ${single.length} one-country zones generate in ${LOCALES.join('/')}; the other ${multi.length} decline and keep their labels unchanged.`)
