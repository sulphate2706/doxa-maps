#!/usr/bin/env node
/**
 * refresh-legacy-resource-flags.mjs — re-derive the resource booleans in the two curated
 * tables from the pin index, so they stop contradicting the map beside them.
 *
 * THE PROBLEM. gaps-and-opportunities and people-group-resources predate everything this
 * flight added. Their curated columns — the bridge-language analysis, internet access,
 * messaging channels — are the reason they exist and are NOT touched here. But they also
 * carry resource booleans, and those had drifted into saying things the map disproves:
 *
 *   80 rows          heart_has_any=false while the index has a resource   (6M people)
 *   317 rows         "no scripture" while the index has TEXT Scripture
 *   5 rows           "no film" while the index has a film
 *   2,106 rows       has_audio = the string "unknown", written when no audio pool had been
 *                    searched. Faith Comes By Hearing has been searched since.
 *
 * WHY REFRESH RATHER THAN REBUILD. The bridge analysis cannot be regenerated from the pins —
 * it is curated work over a narrower, hand-checked set. Rebuilding would destroy it to fix a
 * few columns. So only the facts the index is authoritative for are rewritten, and the
 * fields DERIVED from them are recomputed in the same pass, because leaving `gap` or
 * `opportunity` stale would just move the contradiction one column to the right.
 *
 * has_audio STAYS THREE-STATE. true where FCBH publishes audio; "unknown" otherwise — never
 * false. GRN is the main audio pool and still answers 403 to everything, so "no audio exists"
 * is a claim this build cannot make.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const { codes } = JSON.parse(readFileSync(PINS, 'utf8'))

const v = (c) => codes[c] || null
const hasText = (c) => { const x = v(c); return !!(x && (x.s || (x.au && /text/.test(x.au.m || '')))) }
const hasFilm = (c) => { const x = v(c); return !!(x && x.f) }
const hasAudio = (c) => { const x = v(c); return !!(x && x.au && /audio/.test(x.au.m || '')) }
// Scripture Earth and GRN belong here like every other pool. Without them this predicate
// reported "nothing to change" while 122 curated rows — 8.9 million people — still said
// heart_has_any=false for groups the index can now reach. A reconciler that cannot see a
// source is not reconciling, it is confirming.
//
// `gap` and `opportunity` below are derived from this, so widening it moves them too — which
// is CORRECT: a group that can now hear the gospel in its own language is no longer a gap,
// and saying otherwise would send a team somewhere already reached.
const hasAny = (c) => { const x = v(c); return !!(x && (x.s || x.f || x.au || x.bv || x.se || x.ga || (x.d && x.d.length))) }

const load = (name) => JSON.parse(readFileSync(resolve(REPO, `data/tables/${name}.json`), 'utf8'))
const changed = {}
const bump = (k) => { changed[k] = (changed[k] || 0) + 1 }

// ── gaps-and-opportunities ────────────────────────────────────────────────────────────
{
  const j = load('gaps-and-opportunities')
  for (const r of j.rows || []) {
    const c = r.heart_iso639_3
    if (!c) continue
    const s = hasText(c), f = hasFilm(c), any = hasAny(c)
    if (r.heart_has_scripture !== s) { r.heart_has_scripture = s; bump('heart_has_scripture') }
    if (r.heart_has_film !== f) { r.heart_has_film = f; bump('heart_has_film') }
    if (r.heart_has_any !== any) { r.heart_has_any = any; bump('heart_has_any') }
    const b = r.bridge_iso639_3
    if (b) {
      const bs = hasText(b), bf = hasFilm(b)
      if (r.bridge_has_scripture !== bs) { r.bridge_has_scripture = bs; bump('bridge_has_scripture') }
      if (r.bridge_has_film !== bf) { r.bridge_has_film = bf; bump('bridge_has_film') }
    }
    // DERIVED FIELDS, RECOMPUTED FROM THE TABLE'S OWN DOCUMENTED DEFINITIONS — not from a
    // definition invented here. Each formula below was verified to reproduce the existing
    // column on all 2,106 rows before anything was rewritten, because a refresh that
    // silently redefines a curated column is worse than the drift it set out to fix. A
    // first attempt defined `gap` as simply !heart_has_any, which would have changed 416
    // rows and quietly discarded the "and no in-country bridge either" half of its meaning.
    //
    //   gap         nothing in the heart language AND no in-country bridge carries anything
    //   opportunity nothing in the heart language, but a bridge spoken by MORE THAN ONE
    //               group in the same country does have something
    //   aligned     an opportunity where the environment lines up too: internet yes/partial
    //               and a known channel
    const bridgeHas = !!(r.bridge_has_scripture || r.bridge_has_film)
    const gap = !any && !bridgeHas
    if (r.gap !== gap) { r.gap = gap; bump('gap') }
    const opp = !any && bridgeHas && (r.bridge_groups_in_country || 0) > 1
    if (r.opportunity !== opp) { r.opportunity = opp; bump('opportunity') }
    const net = r.internet_access === 'yes' || r.internet_access === 'partial'
    const aligned = opp && net && !!r.top_channel
    if (r.aligned !== aligned) { r.aligned = aligned; bump('aligned') }
    const status = any ? 'reached in heart language'
      : opp ? 'opportunity — bridge language has a resource'
      : 'gap — nothing found in heart or bridge language'
    if (r.status !== status) { r.status = status; bump('status') }
  }
  j.meta = { ...(j.meta || {}), resource_flags_refreshed: new Date().toISOString().slice(0, 10), resource_flags_source: 'data/tables/people-group-pins.json — the same index the map draws. Curated bridge, internet and channel columns are untouched.' }
  writeSnapshot(resolve(REPO, 'data/tables/gaps-and-opportunities.json'), `${JSON.stringify(j, null, 1)}\n`,
    (x) => (x.rows || []).length, 'gaps-and-opportunities rows')
}

// ── people-group-resources ────────────────────────────────────────────────────────────
{
  const j = load('people-group-resources')
  for (const r of j.rows || []) {
    const c = r.iso639_3
    if (!c) continue
    const s = hasText(c), f = hasFilm(c)
    if (r.has_scripture !== s) { r.has_scripture = s; bump('has_scripture') }
    if (r.has_film !== f) { r.has_film = f; bump('has_film') }
    if ('jesus_film' in r && r.jesus_film !== f) { r.jesus_film = f; bump('jesus_film') }
    // THREE-STATE, never false. See the header.
    const a = hasAudio(c) ? true : 'unknown'
    if (r.has_audio !== a) { r.has_audio = a; bump('has_audio') }
    // THE PAIR NOBODY WAS REFRESHING. These two columns say whether the group has anything
    // at all, and no pass had ever touched them — so 194 rows still read
    // any_resource_found=false for groups the index can now reach. They are a complementary
    // pair and must move together, or the table contradicts itself row by row.
    const any = hasAny(c)
    if (r.any_resource_found !== any) { r.any_resource_found = any; bump('any_resource_found') }
    if (r.no_resource_found !== !any) { r.no_resource_found = !any; bump('no_resource_found') }

    /* ═══ THE URLS, AND THIS TABLE IS SHIPPED ═════════════════════════════════════════════
     * The booleans were being refreshed while the LINKS beside them were not, and this table
     * is the map's "Resources by People Group" tab — a reader clicks these. Measured before
     * this pass: 2,294 URL cells, of which 1,412 were the retired
     * jesusfilm.org/watch/?languageId=<id> form. That form is IGNORED by the site — a real id
     * and a bogus one render the same generic library page — which is why the map migrated off
     * it onto Arclight shareUrls. The migration never reached here, so the tables page kept
     * offering links that go nowhere in particular, for a year's worth of builds.
     *
     * The index is authoritative for these two fields and its URLs are the verified ones, so
     * they are copied across. Only where the index HAS one: a curated URL is never blanked by
     * a pool that happens to have no entry. */
    const sUrl = (codes[c] || {}).s, fUrl = (codes[c] || {}).f
    if ('scripture_url' in r && sUrl && r.scripture_url !== sUrl) {
      if (/[?&]languageId=/.test(r.scripture_url || '')) bump('retired_form_replaced')
      r.scripture_url = sUrl; bump('scripture_url')
    }
    if ('film_url' in r && fUrl && r.film_url !== fUrl) {
      if (/[?&]languageId=/.test(r.film_url || '')) bump('retired_form_replaced')
      r.film_url = fUrl; bump('film_url')
    }
  }
  // THE POOL LIST IS A CLAIM TOO. This table still told readers GRN was "not included:
  // requires an API key" — false on both halves. GRN is included, 583 codes of it, and it
  // needed no key: their 5fish site resolves by ISO 639-3 and asks only for a crawl delay.
  // A caveat that names a pool as missing is exactly as misleading as a stale number when
  // the pool is in fact there.
  const notIncluded = (j.meta && j.meta.not_included) || []
  const grnRow = notIncluded.find((x) => x && x.id === 'grn')
  if (grnRow) {
    j.meta.not_included = notIncluded.filter((x) => !x || x.id !== 'grn')
    j.meta.grn_note =
      'Global Recordings Network IS included, via their 5fish site, which resolves by ISO ' +
      '639-3 and needs no API key — only the ten-second crawl delay their robots.txt asks ' +
      'for, so the sweep runs a batch at a time and part of the pool is still unread. It ' +
      'appears as gospel audio, never as Scripture: Words of Life is gospel messages and ' +
      'Bible stories, not a translation.'
    bump('not_included(grn)')
  }
  j.meta = { ...(j.meta || {}), resource_flags_refreshed: new Date().toISOString().slice(0, 10), has_audio_note: 'true where Faith Comes By Hearing publishes audio Scripture; "unknown" otherwise, never false. GRN is the other main audio pool and IS now searched, through their 5fish site, a batch at a time at the crawl delay they ask for — it appears as gospel audio rather than in this column, because Words of Life is gospel messages and Bible stories, not a translation.' }
  writeSnapshot(resolve(REPO, 'data/tables/people-group-resources.json'), `${JSON.stringify(j, null, 1)}\n`,
    (x) => (x.rows || []).length, 'people-group-resources rows')
}

// ── languages-by-country ──────────────────────────────────────────────────────────────
// The bridge view: one row per (country, language), ranked by prevalence, flagging which
// languages could carry a resource to groups that lack one. prevalence_rank,
// bridge_candidate and groups_speaking are curated over a narrower set and are untouched.
// Its resource flags had drifted the same way the other two tables had: 75 rows claiming
// the wrong thing about Scripture, 39 about whether the language carries anything at all.
// A bridge view whose resource flags are wrong recommends the wrong bridge.
{
  const j = load('languages-by-country')
  for (const r of j.rows || []) {
    const c = r.iso639_3
    if (!c) continue
    const s2 = hasText(c), f2 = hasFilm(c), any2 = hasAny(c)
    if (r.has_scripture !== s2) { r.has_scripture = s2; bump('lbc_has_scripture') }
    if (r.has_film !== f2) { r.has_film = f2; bump('lbc_has_film') }
    if ('carries_resource' in r && r.carries_resource !== any2) { r.carries_resource = any2; bump('lbc_carries_resource') }
    // full_bible stays as curated: the pin index knows a scope only for eBible rows, and
    // downgrading a curated "full Bible" on that basis would lose information, not fix it.
  }
  j.meta = { ...(j.meta || {}), resource_flags_refreshed: new Date().toISOString().slice(0, 10), resource_flags_source: 'data/tables/people-group-pins.json. prevalence_rank, bridge_candidate, groups_speaking and full_bible are curated and untouched.' }
  writeSnapshot(resolve(REPO, 'data/tables/languages-by-country.json'), `${JSON.stringify(j, null, 1)}\n`,
    (x) => (x.rows || []).length, 'languages-by-country rows')
}

console.log('REFRESH: fields corrected —')
for (const [k, n] of Object.entries(changed).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${n}`)
if (!Object.keys(changed).length) console.log('  (nothing to change)')
