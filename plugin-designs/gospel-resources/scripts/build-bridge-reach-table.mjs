/**
 * build-bridge-reach-table.mjs — how far does ONE language reach?
 *
 * WHY THIS TABLE EXISTS. Every other surface here answers "who has nothing" and then, group by
 * group, "what is the way in for THIS one". A mobiliser with a budget is asking the inverse
 * question and had nowhere to ask it: if I resource ONE language, how many peoples does that
 * reach? Measured over the 369 groups with nothing of their own, the answer is that THIRTY-TWO
 * languages cover all of them — SUN alone is the way in for 93 Deaf groups across 93 countries,
 * Mandarin for 36, Indonesian for 28, Akha for 33. That is a different shape of decision from a
 * list of 369, and it is the one a sending church or a translation agency actually makes.
 *
 * ⚠ A WAY IN IS NOT THE GOSPEL IN SOMEONE'S OWN LANGUAGE, and aggregating makes that easier to
 * forget, not harder. Every row says so: the groups counted here still have NOTHING of their own,
 * and this table ranks the second-best answer. It is a bridge, and the word travels with it.
 *
 * ⚠ THREE KINDS OF WAY IN, COUNTED APART. A CURATED bridge is a language the analysis has checked
 * for those groups; a CANDIDATE is computed from published CLDR data about what a country speaks,
 * which is a fact about the country and not about these people; SIGNED is SUN, which is a
 * constructed signed language and has to be learned. Summing them into one "reach" number would
 * flatten a checked answer into a plausible one.
 *
 * No new link enters the map here: the resources shown for a bridge language are the ones the pin
 * index already carries for that ISO code, which the verification record has already proved.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/bridge-language-reach.json')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))

const access = T('doxa-gospel-access.json').rows || []
const pins = T('people-group-pins.json')
const codes = pins.codes || {}
const sun = pins.sun || {}

const zero = access.filter((r) => r.access === 'nothing found')
if (zero.length < 100) {
  console.error(`BRIDGE-REACH: REFUSING TO WRITE — only ${zero.length} group(s) with nothing found; the access table changed shape.`)
  process.exit(1)
}

const agg = new Map()
let noWayIn = 0
for (const r of zero) {
  /* The SAME precedence every other surface uses: a curated bridge outranks a computed candidate,
     and a Deaf group is never offered a spoken one. */
  let code, name, kind
  if (r.bridge_iso639_3) { code = r.bridge_iso639_3; name = r.bridge_language; kind = 'curated' }
  else if (r.bridge_candidate_iso) { code = r.bridge_candidate_iso; name = r.bridge_candidate; kind = 'candidate' }
  else if (r.deaf_bridge) { code = 'SUN'; name = r.deaf_bridge; kind = 'signed' }
  else { noWayIn++; continue }
  const key = `${kind}|${code}`
  if (!agg.has(key)) agg.set(key, { code, language: name, kind, groups: 0, people: 0, countries: new Set(), nobody_praying: 0, biggest: [], reached: new Set(), slugs: new Set() })
  const a = agg.get(key)
  a.groups++
  a.people += r.population || 0
  a.countries.add(r.country)
  if (!(r.people_praying || 0)) a.nobody_praying++
  a.biggest.push([r.population || 0, r.people_group])
  /* The OWN languages of the groups this bridge reaches — the map's ?codes= filter joins on
     exactly that, so the row can put those peoples on the map instead of describing them. */
  if (/^[a-z]{3}$/.test(String(r.iso639_3 || ''))) a.reached.add(r.iso639_3)
  /* The PEOPLES themselves, by doxa.life's slug — what ?groups= takes. The access table has no
     slug column, so it is read off the prayer URL, which doxa.life's own API built from that slug.
     Measured before relying on it: all 369 of these rows carry a pray_url. Never constructed from
     the name — a slug this build invented could name somebody else's people. */
  const slug = String(r.pray_url || '').split('/').pop().split('?')[0]
  if (slug) a.slugs.add(slug)
}

const c = (code) => codes[code] || {}
/* How many Doxa groups the map will actually draw for a set of language codes — counted from the
   same pin rows the map draws, so this number cannot drift from what the reader sees. */
const pinRows = pins.pins || []
const allByCode = (set) => pinRows.reduce((n, p) => n + (set.has(p[4]) ? 1 : 0), 0)
const rows = [...agg.values()].map((a) => ({
  language: a.language,
  iso639_3: a.code === 'SUN' ? '' : a.code,
  way_in: a.kind === 'curated' ? 'bridge — checked for these groups'
    : a.kind === 'candidate' ? 'bridge — computed from what the country speaks'
    : 'bridge — a constructed signed language, learned',
  groups_with_nothing: a.groups,
  people_with_nothing: a.people,
  countries: a.countries.size,
  nobody_praying: a.nobody_praying,
  largest: a.biggest.sort((x, y) => y[0] - x[0]).slice(0, 3).map(([, n]) => n).join('; '),
  /* The bridge's OWN resources, from the index, so a reader can act in one click rather than
     going to look the language up. SUN's are the ones its own verified block carries. */
  scripture_url: a.code === 'SUN' ? (sun.scripture?.u || '') : (c(a.code).s || ''),
  film_url: a.code === 'SUN' ? '' : (c(a.code).f || ''),
  training_url: a.code === 'SUN' ? '' : (c(a.code).z || ''),
  still_nothing_of_their_own: true,
  /* ═══ FROM THE TABLE BACK TO THE MAP, EXACTLY THESE PEOPLES ════════════════════════════════
   * First written with ?codes=, which filters by LANGUAGE, and it contradicted its own row:
   * Mandarin's 36 groups speak 30 codes and 55 Doxa groups speak those 30, so a 36-group row drew
   * 55 pins (Akha 33 drew 57, SUN 93 drew 116). The extra groups are real and also have nothing —
   * they belong to a different row. Rather than relabel the column to excuse the mismatch, the map
   * learned ?groups=, which names the peoples by doxa.life's own slug. Row and map now agree by
   * construction, and `map_shows_groups` is computed from the same roster the map draws so the
   * claim stays falsifiable rather than assumed.
   *
   * The field is named *_url because that is what makes DataTable render it as a link — a naming
   * convention, not a type declaration, worth knowing before renaming it. */
  map_url: a.slugs.size ? `../resources-map/index.html?groups=${[...a.slugs].sort().join(',')}` : '',
  their_languages: a.reached.size,
  map_shows_groups: a.slugs.size,
})).sort((x, y) => y.people_with_nothing - x.people_with_nothing)

if (noWayIn) console.log(`note: ${noWayIn} group(s) with nothing have no way in recorded — they are absent from this table, not counted as zero`)

writeSnapshot(
  OUT,
  `${JSON.stringify({
    meta: {
      title: 'One language, how many peoples — the way in, ranked by reach',
      why: 'Every other surface answers "what is the way in for THIS group". A mobiliser with a ' +
        'budget asks the inverse: if I resource ONE language, how many peoples does it reach? ' +
        `${rows.length} languages are the way in to all ${zero.length} groups with nothing of their own.`,
      generated: new Date().toISOString().slice(0, 10),
      grain: 'one row per (way-in kind, language); a language offered both as a checked bridge and as a computed candidate appears once per kind, because those are different claims',
      groups_with_nothing: zero.length,
      groups_with_no_way_in: noWayIn,
      a_bridge_is_not_their_own_language: 'Every group counted here still has NOTHING in its own ' +
        'language. This table ranks the second-best answer, and the word bridge travels with every row.',
      three_kinds: 'CURATED — checked for those groups. CANDIDATE — computed from published CLDR ' +
        'data about what the country speaks, which is a fact about the country and not about these ' +
        'people. SIGNED — SUN, a constructed signed language that has to be learned. Never summed.',
      the_map_link_names_the_peoples: 'The link uses ?groups=<slug list>, which filters the map by ' +
        'PEOPLE GROUP, so it shows exactly the groups this row counts. Written first with ?codes=, ' +
        'which filters by language, it drew 55 pins for Mandarin\'s 36-group row and 57 for Akha\'s ' +
        '33 — those extra groups also have nothing but belong to a different row. The map gained the ' +
        'per-group filter rather than the column gaining an excuse.',
      links: 'No new link enters the map here. A bridge language\'s resources are the ones the pin ' +
        'index already carries for that ISO code, already proved by the verification record.',
    },
    columns: [
      { title: 'Language', field: 'language', type: 'string' },
      { title: 'Code', field: 'iso639_3', type: 'string' },
      { title: 'Kind of way in', field: 'way_in', type: 'string' },
      { title: 'Groups with nothing', field: 'groups_with_nothing', type: 'number' },
      { title: 'People with nothing', field: 'people_with_nothing', type: 'number' },
      { title: 'Countries', field: 'countries', type: 'number' },
      { title: 'Nobody praying', field: 'nobody_praying', type: 'number' },
      { title: 'Largest groups', field: 'largest', type: 'string' },
      { title: 'Scripture in this language', field: 'scripture_url', type: 'link' },
      { title: 'Film in this language', field: 'film_url', type: 'link' },
      { title: 'Training', field: 'training_url', type: 'link' },
      { title: 'Languages they speak', field: 'their_languages', type: 'number' },
      { title: 'Groups the map link shows', field: 'map_shows_groups', type: 'number' },
      { title: 'These peoples on the map', field: 'map_url', type: 'link' },
    ],
    rows,
  }, null, 1)}\n`,
  (j) => (j.rows || []).length,
  'bridge language row(s)',
)
console.log(`bridge-language-reach: ${rows.length} language(s) reach ${zero.length} group(s) with nothing`)
console.log(`  by kind: ${['curated', 'candidate', 'signed'].map((k) => `${k} ${rows.filter((r) => r.way_in.includes(k === 'curated' ? 'checked for' : k === 'candidate' ? 'computed' : 'signed')).length}`).join(', ')}`)
console.log(`  widest: ${rows.slice(0, 3).map((r) => `${r.language} ${r.groups_with_nothing} groups / ${r.people_with_nothing.toLocaleString('en-US')} people`).join(' | ')}`)
console.log(`wrote ${OUT}`)
