#!/usr/bin/env node
/**
 * fetch-pray-index.mjs — the prayer link for a people group, from doxa.life's own list.
 *
 * WHY. This map's toast says "Tap a coloured dot — someone still needs prayer", and until
 * now tapping one offered no way to pray. Sibling plugins in this repo already link to
 * pray.doxa.life per group (see library/components/PeopleGroupDetail.vue), so the house
 * pattern and the URL shape already exist:
 *     https://pray.doxa.life/<slug>?source=doxalife&utm_source=agwm
 *
 * ═══ THIS IS THE ONE JOIN THAT IS NOT BY LANGUAGE ═══════════════════════════════════════
 * Every other source here keys on ISO 639-3, because a translation serves everyone who
 * speaks the language. Prayer does not work that way: you pray for a PEOPLE, in a place.
 * So this keys on (people-group name, country) — and that is a NAME join, which this map
 * refuses everywhere else because language names collide.
 *
 * It is allowed here only because the key was tested first, not assumed:
 *   - on the API side (name, country) is PERFECTLY unique — 2,107 entries, 2,107 distinct
 *     keys, 0 collisions;
 *   - on the pin side 12,379 pins give 12,369 distinct keys, so 10 pins are ambiguous.
 * Those 10 are SKIPPED rather than guessed. An ambiguous key would attach one group's
 * prayer page to another group with the same name in the same country, which is exactly
 * the failure the no-name-matching rule exists to prevent.
 *
 * ═══ A 200 FROM pray.doxa.life PROVES NOTHING ═══════════════════════════════════════════
 * It is the fourth host in this bundle that answers 200 with identical bytes for any URL:
 *     /abai-sungai              -> 200, 3,903 bytes
 *     /zzz-not-a-real-group     -> 200, 3,903 bytes
 * Rendered it does discriminate — a real slug titles the page "Abai Sungai - App" with
 * 1,863 characters of content, a bogus one titles it "Doxa.Life" with zero — but the
 * existence proof used here is the API listing itself: a slug exists exactly when
 * doxa.life publishes it. That is the publisher's own statement, and it costs one request
 * rather than 1,725 renders.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/pray-index.json')
const API = 'https://pray.doxa.life/api/people-groups/list'
const SITE = 'https://pray.doxa.life'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const key = (name, iso3) => `${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(iso3 || '').toUpperCase()}`

const res = await fetch(API, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90000) })
if (!res.ok) throw new Error(`pray list: HTTP ${res.status}`)
const posts = (await res.json()).posts || []
if (posts.length < 500) {
  console.error(`PRAY: ABORT — the list returned ${posts.length} entries; refusing to run on a truncated payload.`)
  process.exit(1)
}

// The API key must be unique, or the join is not a join. Checked, never assumed.
const seen = new Map()
let apiDup = 0
for (const p of posts) {
  const k = key(p.name, p.country_code && p.country_code.value)
  if (seen.has(k)) { apiDup++; continue }
  seen.set(k, p)
}
if (apiDup) console.warn(`PRAY: ${apiDup} duplicate (name, country) key(s) on the API side — those entries are skipped.`)

// Pin-side ambiguity: any key held by more than one pin is dropped entirely.
const pins = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))
const pinCount = {}
for (const [name, , , iso3] of pins.pins) {
  const k = key(name, iso3)
  pinCount[k] = (pinCount[k] || 0) + 1
}

const byKey = {}
let matched = 0, ambiguous = 0, unmatched = 0
for (const [k, p] of seen) {
  if (!pinCount[k]) { unmatched++; continue }
  if (pinCount[k] > 1) { ambiguous++; continue }
  byKey[k] = {
    u: `${SITE}/${encodeURIComponent(p.slug)}?source=doxalife&utm_source=agwm`,
    n: p.name,
    praying: Number(p.people_praying) || 0,
    committed: Number(p.people_committed) || 0,
  }
  matched++
}

writeSnapshot(
  OUT,
  `${JSON.stringify({
    _note: 'Prayer pages from doxa.life, keyed by (people-group name, country) — the ONE join here that is not by language, because you pray for a people in a place, not for a language. Ambiguous keys are dropped, never guessed. pray.doxa.life answers 200 with identical bytes for any slug, so existence comes from this API listing and never from the page.',
    source: API,
    site: SITE,
    generated: new Date().toISOString().slice(0, 10),
    counts: { api: posts.length, apiDuplicateKeys: apiDup, matched, ambiguousPinKeysDropped: ambiguous, noPinForEntry: unmatched },
    byKey,
  }, null, 1)}\n`,
  (j) => Object.keys(j.byKey || {}).length,
  'prayer links',
)
console.log(`PRAY: ${posts.length} entries -> ${matched} joined to a unique pin`)
console.log(`  skipped: ${ambiguous} ambiguous pin key(s), ${unmatched} entr(ies) with no pin here`)
