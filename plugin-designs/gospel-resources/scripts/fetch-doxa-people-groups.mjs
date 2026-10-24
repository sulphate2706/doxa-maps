/**
 * fetch-doxa-people-groups.mjs — the 2,107 people groups DOXA actually prays for.
 *
 * ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════════════════
 * This map was built on the full 12,379-pin people-groups dataset, and the reading
 * of it was blunt and correct: it is MISLEADING for the job it is meant to do. Doxa does not
 * work 12,379 groups. They work the ~2,100 on pray.doxa.life, and a map that shows every
 * group on earth buries the ones they can actually reach — and paints countries by a gap
 * that is not theirs.
 *
 * ═══ THE MEASUREMENT THAT SETTLES THE COLOUR ARGUMENT ═══════════════════════════════════
 * Measured 2026-09-25 against the live API:
 *   2,107 Doxa people groups across 175 countries
 *   India 855 · China 154 · Sudan 105 · Brazil 103 · Laos 95
 *   BUT 106 of those 175 countries hold only ONE OR TWO Doxa groups
 *   and the United States holds THREE — Coquille, Pequots, Umpqua
 * The old choropleth paints a country by the PERCENTAGE of its groups with nothing found.
 * Over a denominator of three, one group without a resource is 33% and the whole United
 * States turns amber. That is the "mainly yellow map" complaint, and it is not a palette
 * problem underneath — it is a statistic that means nothing at n=3 being drawn as if it
 * meant something. A prettier ramp over the same arithmetic would be a prettier lie.
 *
 * ═══ WHAT THIS DOES AND DOES NOT KEEP ═══════════════════════════════════════════════════
 * Nothing found for the other 10,000 groups is thrown away — every index, every verified
 * link and every sweep result stays exactly where it is in data/tables/. This file adds the
 * DOXA ROSTER as its own table so the map can be narrowed to it without losing the research
 * behind it. The wider tables remain the record; the map stops being the place they are
 * dumped.
 *
 * ═══ THE JOIN, AND WHAT IT COSTS ════════════════════════════════════════════════════════
 * The API carries no coordinates and no ISO 639-3 code, so both come from the pin index by
 * (name, country) — the same key scripts/fetch-pray-index.mjs already uses, and the one join
 * on this map that is deliberately not by language, because you pray for a people in a
 * place. Measured: 1,724 of 2,107 match a pin and EVERY ONE of those carries a language
 * code. 383 do not match and are recorded with `mapped: false` rather than dropped — they
 * are Doxa's groups whether or not this build can place them, and a roster that silently
 * loses 18% of them would be its own kind of lie.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const OUT = resolve(REPO, 'data/tables/doxa-people-groups.json')
const API = 'https://pray.doxa.life/api/people-groups/list'
const SITE = 'https://pray.doxa.life'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const res = await fetch(API, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90000) })
if (!res.ok) {
  console.error(`DOXA-PG: ABORT — the roster API answered HTTP ${res.status}. Refusing to write a partial roster.`)
  process.exit(1)
}
const { posts } = await res.json()
if (!Array.isArray(posts) || posts.length < 1000) {
  console.error(`DOXA-PG: ABORT — the roster came back with ${posts?.length ?? 0} entries. That is not the roster.`)
  process.exit(1)
}

const { codes, pins } = JSON.parse(readFileSync(PINS, 'utf8'))
const DETAIL = resolve(REPO, 'data/tables/doxa-detail.json')
let detail = {}
try { detail = JSON.parse(readFileSync(DETAIL, 'utf8')).bySlug || {} } catch {
  console.error('DOXA-PG: ABORT — no doxa-detail.json. Run scripts/fetch-doxa-detail.mjs first;')
  console.error('  without it this build would fall back to guessing a language from a name.')
  process.exit(1)
}
/* Tier by CODE, from this build's own research. Many groups share a language, so the first
   tier seen for a code is the tier for that language — which is what a tier means. */
const tierByCode = {}
for (const p of pins) if (p[4] && tierByCode[p[4]] === undefined) tierByCode[p[4]] = p[6]
/**
 * ═══ THE NAME JOIN IS GONE, AND THAT IS THE POINT ═══════════════════════════════════════
 *
 * This file used to get coordinates and a language code by matching the group's NAME against
 * the pin dataset — exact first, then the same words in another order. It worked for 1,822 of
 * 2,107 and left 285 unplaceable AND unsearchable: no code means no key to look them up by in
 * any pool, so the access table could only report them as "not searched".
 *
 * Doxa's own per-group endpoint carries both. scripts/fetch-doxa-detail.mjs reads it, and
 * this build now takes the language and the coordinates from THERE. A name match was always
 * a guess wearing a join's clothes — Akha in Laos sat next to Akha Jipea, Akha Jaweuy and
 * Akha Piso in the pins, and any pick among them would have invented a language for a people.
 * The publisher saying "this group speaks ahk" ends the guessing rather than improving it.
 *
 * The pin dataset is still read, for one thing only: the TIER, which is this build's own
 * finding about what that language has. It is looked up by the code Doxa gave, never by name.
 */
const val = (f) => (f && typeof f === 'object' ? f.value : f) || ''
const lab = (f) => (f && typeof f === 'object' ? f.label : f) || ''

let mapped = 0, unmapped = 0, noCode = 0
const rows = posts.map((q) => {
  const iso3 = val(q.country_code)
  const d = detail[q.slug] || null
  const code = d?.iso639_3 || ''
  const placed = !!(d && d.lat != null && d.lng != null)
  if (placed) mapped++; else unmapped++
  if (!code) noCode++
  const c = code ? codes[code] : null
  return {
    name: q.name,
    slug: q.slug,
    pray_url: `${SITE}/${q.slug}?source=doxalife`,
    iso3,
    country: lab(q.country_code),
    region: lab(q.wagf_region),
    block: lab(q.wagf_block),
    rop1: lab(q.rop1),
    religion: lab(q.religion),
    population: Number(q.population) || 0,
    people_praying: Number(q.people_praying) || 0,
    people_committed: Number(q.people_committed) || 0,
    adopted_by_churches: Number(q.adopted_by_churches) || 0,
    /* From Doxa's own record, not from a name match. */
    mapped: placed,
    matched_by: placed ? 'doxa detail' : '',
    lat: d?.lat ?? null,
    lng: d?.lng ?? null,
    iso639_3: code,
    language: d?.language || (c ? c.l || '' : ''),
    tier: code ? (tierByCode[code] ?? 0) : null,
    /* IMB's own view, carried alongside rather than merged into ours. */
    imb_total_resources: d?.imb?.total ?? null,
    engagement: d?.engagement || '',
  }
})

const byCountry = {}
for (const r of rows) byCountry[r.iso3] = (byCountry[r.iso3] || 0) + 1
const thin = Object.values(byCountry).filter((n) => n <= 2).length

writeSnapshot(
  OUT,
  `${JSON.stringify({
    _note:
      'The people groups DOXA prays for, from pray.doxa.life. THIS is what the gospel map ' +
      'draws — not the full 12,379-group dataset, which stays in people-group-pins.json as ' +
      'the research record. mapped:false means the roster carries them but this build has no ' +
      'coordinates for them yet; they are kept, never dropped.',
    source: API,
    generated: new Date().toISOString().slice(0, 10),
    counts: {
      groups: rows.length,
      countries: Object.keys(byCountry).length,
      mapped,
      unmapped,
      withoutLanguageCode: noCode,
      countriesWithTwoOrFewer: thin,
    },
    rows,
  }, null, 1)}\n`,
  (j) => (j.rows || []).length,
  'Doxa people group(s)',
)
console.log(`DOXA-PG: ${rows.length} group(s) across ${Object.keys(byCountry).length} countries`)
console.log(`  placed from Doxa's own coordinates: ${mapped}   without coordinates: ${unmapped}`)
console.log(`  without a language code: ${noCode}`)
console.log(`  countries holding 2 or fewer Doxa groups: ${thin} — a percentage over that denominator is not a measurement`)
console.log(`wrote ${OUT}`)
