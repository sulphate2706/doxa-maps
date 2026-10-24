#!/usr/bin/env node
/**
 * build-resource-links-table.mjs — the RESOURCE table: one row per (language x resource),
 * every row carrying a real URL.
 *
 * WHY THIS GRAIN. Every other table here is keyed by PEOPLE GROUP, which answers "who has
 * nothing". This one is keyed by the RESOURCE, which answers the other question a mobiliser
 * actually asks: "what exists, what is it called, and where do I open it." A group-grained
 * table cannot answer that without repeating the same JESUS Film link across 40 rows.
 *
 * DEDUPLICATED BY (url, language). 12,379 pins collapse onto a few hundred distinct
 * resources; the reach columns (groups, speakers, countries) are AGGREGATED across the pins
 * that share the language, so one row says how many people that single link actually serves.
 *
 * `resource_url` is named for the suffix DataTable keys on — /_url$/ makes it a real
 * clickable link rather than printed text. That is a contract with the shared component,
 * not a naming preference.
 *
 * EVERY URL IS COPIED, NEVER CONSTRUCTED. Rows come from people-group-pins.json, whose own
 * links come from the resources table and the Door43 snapshot. This script invents nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const OUT = resolve(REPO, 'data/tables/gospel-resource-links.json')

const pins = JSON.parse(readFileSync(PINS, 'utf8'))
const { codes, pins: rows } = pins

// reach per language, measured off the pins rather than assumed
const reach = {}
for (const [name, , , iso3, code, pop] of rows) {
  if (!code) continue
  const r = reach[code] || (reach[code] = { groups: 0, speakers: 0, countries: new Set(), sample: [] })
  r.groups++
  r.speakers += pop || 0
  if (iso3) r.countries.add(iso3)
  if (r.sample.length < 3) r.sample.push(name)
}

// Every publication domain that can appear, named. 'other' is a fallback that should stay
// empty: 258 rows landed in it when png.bible was missing here, which tells a reader nothing
// about where the link goes and hides an unscreened domain if one ever slips into the index.
const SOURCE = (u) =>
  /ebible\.org/i.test(u) ? 'eBible.org'
  : /png\.bible/i.test(u) ? 'PNG.Bible'
  : /alkitab\.pw/i.test(u) ? 'eBible.org (mirror)'
  : /jesusfilm|arc\.gt/i.test(u) ? 'JESUS Film'
  : /door43/i.test(u) ? 'Door43 (unfoldingWord)'
  : /zume\.training/i.test(u) ? 'Zume Training'
  : /bible\.is/i.test(u) ? 'Faith Comes By Hearing'
  : /knowgod\.com/i.test(u) ? 'Cru (GodTools)'
  : /scriptureearth\.org/i.test(u) ? 'Scripture Earth (SIL)'
  : /fivefish\.org|globalrecordings\.net/i.test(u) ? 'Global Recordings Network'
  : 'other'

const out = []
for (const [code, c] of Object.entries(codes)) {
  // A language with a published resource is listed EVEN IF no people group on this map
  // names it as their primary language. 377 such languages carrying 506 real resources
  // were being dropped silently by a table titled "every link" — Ahirani has Scripture,
  // a film and Open Bible Stories; Pahari Mahasui has Scripture, a film and five Door43
  // resources. Their reach columns read 0, which is the true answer to "how many groups
  // on THIS map speak it", not a reason to hide the resource from someone searching for
  // that language.
  const r = reach[code] || { groups: 0, speakers: 0, countries: new Set(), sample: [] }
  const add = (name, type, url, scope = '') => {
    if (!url) return
    out.push({
      resource: name,
      type,
      scope,
      source: SOURCE(url),
      language: c.l || '',
      iso639_3: code,
      people_groups: r.groups,
      speakers: r.speakers,
      countries: r.countries.size,
      example_group: r.sample[0] || '—',
      // ISO3 country codes this language is spoken in, space-joined. Carried so the table
      // can be filtered to a COUNTRY from a map click without loading the 679KB pin table
      // just to resolve which languages a country contains.
      country_codes: [...r.countries].sort().join(' '),
      resource_url: url,
    })
  }
  // The real translation name, where the catalogue knows it. "Scripture in this language"
  // was the same string on all 1,237 rows and hid the one thing worth reading: "Ahirani
  // Matthew and Mark" is two Gospels, "Bhadrawahi Bible" is a Bible.
  add(c.sv || 'Scripture in this language', 'Scripture', c.s, c.ss || '')
  add('JESUS Film', 'Film', c.f)
  for (const d of c.d || []) {
    // "Open Bible Stories" stays labelled as STORIES. It is 50 illustrated narratives
    // drawn from the canon, not a translation, and the type column must not blur that.
    // A Door43 entry filed under "Bible" can be 27 NT books; its scope comes from the
    // book list, not the subject label.
    add(d.s, /^Open Bible Stories/.test(d.s) ? 'Bible Stories' : 'Scripture', d.u, d.sc || '')
  }
  // Its own type. Zume is a discipleship COURSE, not a translation and not a film, and
  // filing it under Scripture would overstate what a reader gets by following the link.
  // Audio Scripture gets its own type: it IS Scripture, but a reader choosing a link needs
  // to know they are getting a recording to listen to, not a text to read.
  // Typed by what the fileset actually carries. A text-only fileset is not audio, and
  // calling it that would send someone looking for a recording that is not there.
  if (c.au) {
    const media = String(c.au.m || 'audio')
    add(c.au.n || 'Scripture', /audio/.test(media) ? 'Audio Scripture' : 'Scripture',
      c.au.u, media === 'audio' ? 'Listen in a browser' : `In a browser — ${media}`)
  }
  // Bible video is its own type. Filing it under Film would put an Old Testament narrative
  // beside the JESUS Film as though they answered the same need.
  if (c.bv) add(c.bv.n || 'Bible video', 'Bible video', c.bv.u, c.bv.sc || '')
  // Its own type. A tract is not Scripture and not a course — it is the thing you open a
  // conversation with, and a reader choosing a link needs to know which of those they get.
  if (c.gp) add(c.gp.n || 'Gospel presentation', 'Gospel presentation', c.gp.u, 'Read in this language')
  // Scripture Earth is typed as Scripture because that is what it is — SIL and its
  // translation partners publishing the text in this language. The scope column names the
  // FORMATS actually held, since a worker needs to know whether they are being sent to a
  // PDF, to recorded audio, or to an app before they set out.
  // Gospel audio is its own type. It is NOT Scripture — "Words of Life" is gospel messages
  // and Bible stories with songs — and for a language with no writing it may be the only
  // form the gospel can take, so it must be findable rather than folded into another row.
  if (c.ga) add(c.ga.n ? `Words of Life — ${c.ga.n}` : 'Gospel audio', 'Gospel audio', c.ga.u, 'Listen in this language')
  if (c.se) {
    const SE_KIND = { PDF: 'PDF', audio: 'audio', sab: 'app', study: 'study notes', viewer: 'read online' }
    const kinds = (c.se.k || []).map((k) => SE_KIND[k] || k).join(', ')
    add('Scripture Earth', 'Scripture', c.se.u, kinds)
  }
  add('Zume Training', 'Discipleship training', c.z, 'Course in this language')
  // The approximate match ships too, with the qualification IN THE SCOPE COLUMN. Leaving
  // it out would make the table disagree with the map for these languages, and a reader
  // who filters the table to Pashto would be told there is no training when there is.
  if (c.za) add('Zume Training', 'Discipleship training', c.za.u, `Course in ${c.za.l} — variety not stated`)
}
// biggest reach first — the link that serves the most people is the one to open.
out.sort((a, b) => b.speakers - a.speakers || a.language.localeCompare(b.language))

const langCount = new Set(out.map((r) => r.iso639_3)).size
// people groups reachable by at least one of these links — counted once per group, not per row
const reachedGroups = [...new Set(out.map((r) => r.iso639_3))].reduce((n, c) => n + (reach[c]?.groups || 0), 0)

// Stated where a reader of the table sees it. "How much Scripture exists" is the question
// under every other number here, and it was only visible by sorting a column.
const scopeCounts = out.reduce((m, r) => (r.scope ? ((m[r.scope] = (m[r.scope] || 0) + 1), m) : m), {})
const SCOPE_LINE = Object.entries(scopeCounts).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${v} ${k}`).join(' · ') +
  `. Scope is counted from each publication's own book list, never from its subject label — a Door43 entry filed under "Bible" can be 27 New Testament books.`

const zeroReach = out.filter((r) => (r.people_groups || 0) === 0)
const zeroReachRows = zeroReach.length
const zeroReachCodes = new Set(zeroReach.map((r) => r.iso639_3)).size

const doc = {
  meta: {
    title: 'Gospel Resources — every link, and who it reaches',
    grain: 'one row per language x resource; reach columns aggregate the people groups speaking that language',
    country_filter_scope: `A COUNTRY filter matches on the countries where a people group on this map speaks the language. The ${zeroReachRows} zero-reach rows therefore never match one — no group here names those languages — so filter by language or ISO code to find them. They are not attributed to a country on the basis of a "primary country" field, because the only alpha-2/alpha-3 mapping available in this repo disagrees with itself on 18 countries and cannot resolve many of the ${zeroReachCodes} codes involved; a wrong country attribution would point a real link at the wrong field.`,
    zero_reach_rows: 'A row with 0 people groups is a REAL published resource in a language that no people group on this map names as its primary language. It is listed because the table is every link, not every link that happens to have a pin — someone searching for that language still needs to find it.',
    the_finding: `${out.length} real, openable resources across ${langCount} languages, together reaching ${reachedGroups.toLocaleString()} people groups on the map. Every URL here was copied from a checked pool, never constructed.`,
    scope_breakdown: SCOPE_LINE,
    // DERIVED FROM THE ROWS, never hardcoded. The hardcoded version named three pools long
    // after five were being shipped, and on the dashboard it sat directly UNDER rows reading
    // "Audio Scripture", "Bible video", "Zume Training" and "Gospel presentation" — a
    // caveat contradicting the table above it on the same screen. A list written by hand
    // goes stale the next time a pool is added; one counted off the rows cannot.
    pools_caveat: `Pools checked: ${[...new Set(out.map((r) => r.source))].sort().join(', ')}. ` +
      'NOT checked: GRN audio (403 to every request, including its own robots.txt), api.bible, ' +
      'the Digital Bible Library and Progress Bible — all need a credential or an agreement. ' +
      'An absence here is absence from the pools checked, never proof that nothing exists.',
    // COMPUTED, never baked. These read 506 rows and 168 codes for months while the true
    // figures grew to 1,038 and 492 — every source added rows for languages no pin speaks,
    // and a sentence that counts something must be recounted when the something changes.
    stories_are_not_scripture: 'Open Bible Stories is 50 illustrated narratives drawn from the canon. It is typed as Bible Stories, never as Scripture, because telling a reader they have a translation when they have a story set is the error that matters most.',
    doctrine_boundary: 'Only sources publishing the 66-book canon are included. Watchtower/JW, Seventh-day Adventist, LDS and other added-canon publishers are excluded by rule, not by oversight.',
    no_believer_data: 'This table describes PUBLISHED RESOURCES only. It carries no church, believer or meeting-point data and must never gain any.',
  },
  columns: [
    { title: 'Resource', field: 'resource', type: 'string' },
    { title: 'Type', field: 'type', type: 'string' },
    // How MUCH Scripture, kept in its own column so Type stays a clean three-value filter.
    { title: 'Scope', field: 'scope', type: 'string' },
    { title: 'Source', field: 'source', type: 'string' },
    { title: 'Language', field: 'language', type: 'string' },
    { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
    { title: 'People groups', field: 'people_groups', type: 'number' },
    { title: 'Speakers', field: 'speakers', type: 'number' },
    { title: 'Countries', field: 'countries', type: 'number' },
    { title: 'Example group', field: 'example_group', type: 'string' },
    { title: 'Open', field: 'resource_url', type: 'string' },
  ],
  rows: out,
}
writeFileSync(OUT, JSON.stringify(doc))
const byType = out.reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + 1), m), {})
console.log(`rows ${out.length}  languages ${new Set(out.map((r) => r.iso639_3)).size}`)
console.log('by type:', JSON.stringify(byType))
console.log('by source:', JSON.stringify(out.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {})))
console.log(`wrote ${OUT}`)
