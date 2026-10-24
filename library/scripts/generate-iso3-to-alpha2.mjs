#!/usr/bin/env node
// generate-iso3-to-alpha2.mjs — `bun run gen:iso3-to-alpha2`. Offline, no network, no dependency.
//
// Writes library/data/iso3-to-alpha2.json: the alpha-2 code for each of the 242 alpha-3 codes in
// library/data/countries.json, so a country NAME can be localized. Intl.DisplayNames('region') takes
// alpha-2 or UN M49 only -- it does NOT accept alpha-3 -- and our data speaks alpha-3 throughout, so
// without this join every country name is stuck in English.
//
// ★ THIS IS NOT THE RESEARCH MAP. library/scripts/research/out/iso3-to-iso2.json is a different file
// with a different job: the 176-country spine that drives the data FETCHES. Expanding that one changes
// what gets fetched, which is a product decision about data scope and must not
// happen as a side effect of adding country names. This map drives no fetch. The two are deliberately
// not interchangeable, which is why they have different names, different shapes and this paragraph.
//
// ★ IT GRADES ITS OWN OUTPUT AND EXITS NON-ZERO. A generator that writes whatever it derived is a
// generator that will one day write a hole. Coverage, injectivity and the single documented exception
// are asserted here, so a bad refresh of the vendored CLDR cannot land quietly.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.DOXA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => JSON.parse(readFileSync(join(REPO, p), 'utf8'))

const VENDOR = 'library/vendor/cldr/codeMappings.json'
const OUT = 'library/data/iso3-to-alpha2.json'

// ── the one exception, and why it is not a fudge ─────────────────────────────────────────────────
// Kosovo has NO ISO 3166-1 assignment, so CLDR's codeMappings cannot carry it and no amount of
// re-downloading will add it. XK is the USER-ASSIGNED code the EU, the IMF, Unicode's own CLDR
// locale data (sr_Cyrl_XK) and every major platform settled on. It is recorded here as a named
// exception with its reason rather than patched into the vendored file, so the vendored bytes stay
// exactly upstream's and the deviation stays visible to the next reader.
const EXCEPTIONS = {
  KOS: { alpha2: 'XK', why: 'Kosovo has no ISO 3166-1 assignment; XK is the user-assigned code CLDR itself uses in locale ids (sr_Cyrl_XK).' },
}

const cldr = read(VENDOR).supplemental.codeMappings
const countries = read('library/data/countries.json')

// CLDR is keyed by alpha-2 with an _alpha3 inside; we need the inverse.
const byAlpha3 = new Map()
const cldrCollisions = []
for (const [alpha2, v] of Object.entries(cldr)) {
  const a3 = v && v._alpha3
  if (!a3) continue
  if (byAlpha3.has(a3)) cldrCollisions.push(`${a3} claimed by ${byAlpha3.get(a3)} and ${alpha2}`)
  else byAlpha3.set(a3, alpha2)
}

const map = {}
const missing = []
for (const { value: iso3, label } of countries) {
  const fromCldr = byAlpha3.get(iso3)
  const exc = EXCEPTIONS[iso3]
  if (fromCldr) map[iso3] = fromCldr
  else if (exc) map[iso3] = exc.alpha2
  else missing.push(`${iso3} (${label})`)
}

// ── assertions: the generator refuses to ship a map it cannot defend ────────────────────────────
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

ok(countries.length === 242, `the country list holds 242 codes (found ${countries.length})`)
ok(missing.length === 0, missing.length
  ? `${missing.length} code(s) have NO alpha-2 and no documented exception: ${missing.join(', ')}`
  : 'every code resolved, via CLDR or a documented exception')

const seen = new Map()
const dupes = []
for (const [iso3, a2] of Object.entries(map)) {
  if (seen.has(a2)) dupes.push(`${a2} claimed by ${seen.get(a2)} and ${iso3}`)
  else seen.set(a2, iso3)
}
ok(dupes.length === 0, dupes.length
  ? `alpha-2 collisions -- at least one country would take another's name: ${dupes.join('; ')}`
  : `all ${Object.keys(map).length} codes map to a DISTINCT alpha-2`)

ok(Object.entries(map).every(([, a2]) => /^[A-Z]{2}$/.test(a2)), 'every alpha-2 is two uppercase letters')

// Every exception must still BE one. If CLDR ever assigns KOS, this fires and the entry should go.
for (const [iso3, e] of Object.entries(EXCEPTIONS)) {
  ok(!byAlpha3.has(iso3),
    `the ${iso3} exception is still needed -- CLDR ${byAlpha3.has(iso3) ? `now assigns it ${byAlpha3.get(iso3)}, so DELETE the exception` : 'still has no assignment for it'}`)
}

// ── cross-check the research map rather than touching it ────────────────────────────────────────
// CLDR is an independent source for the 176 values that map already ships. Disagreements are reported,
// never written: that file drives fetches and is not this generator's to edit.
let disagreements = 0
try {
  const research = read('library/scripts/research/out/iso3-to-iso2.json')
  for (const [iso3, a2] of Object.entries(research)) {
    const c = byAlpha3.get(iso3)
    if (c && c !== a2) { console.log(`  FAIL - research map says ${iso3} -> ${a2}, CLDR says ${c}`); disagreements++ }
  }
  ok(disagreements === 0,
    `CLDR agrees with all ${Object.keys(research).length} values in the research spine map (reported, never rewritten -- that file drives fetches)`)
} catch (e) {
  console.log(`  note - research map not readable here (${e.code || e.message}); cross-check skipped`)
}

if (fails) {
  console.log(`\nISO3-TO-ALPHA2: ${fails} FAIL(s) — nothing written`)
  process.exit(1)
}

const cldrVersion = '48.2.2'   // keep in step with library/vendor/cldr/README.md
writeFileSync(join(REPO, OUT), JSON.stringify({
  _meta: {
    generated_by: 'library/scripts/generate-iso3-to-alpha2.mjs (bun run gen:iso3-to-alpha2)',
    purpose: 'alpha-3 -> alpha-2 so Intl.DisplayNames can produce a LOCALIZED country name. Drives no data fetch.',
    not_to_be_confused_with: 'library/scripts/research/out/iso3-to-iso2.json — the 176-country research spine that DOES drive fetches',
    source: `CLDR cldr-core ${cldrVersion}, vendored at ${VENDOR} (Unicode-3.0)`,
    countries: Object.keys(map).length,
    exceptions: Object.fromEntries(Object.entries(EXCEPTIONS).map(([k, v]) => [k, `${v.alpha2} — ${v.why}`])),
  },
  map,
}, null, 2) + '\n')

console.log(`\nISO3-TO-ALPHA2: wrote ${OUT} — ${Object.keys(map).length} countries, ${Object.keys(EXCEPTIONS).length} documented exception(s)`)
