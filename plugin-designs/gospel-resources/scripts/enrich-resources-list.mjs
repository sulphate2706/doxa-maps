#!/usr/bin/env node
/**
 * enrich-resources-list.mjs — add the pools resources.json predates to the list profile.
 *
 * resources-list.vue BUNDLES ./data/resources.json at build time, so it did not benefit
 * from the Door43 and catalogue passes that reached the map. Checked before writing, and
 * the gap is narrower than it looks: 120 of its 862 languages already carry a scripture
 * link in resources[], and those are exactly the 120 the enriched index has — nothing to
 * correct there. What is genuinely missing is Door43: 49 of these languages have a
 * published Open Bible Stories or Bible repo that the list never offered.
 *
 * SCOPE IS DELIBERATE AND LEFT ALONE. resources.json covers the curated 862-language DX
 * set, not all 2,684 languages the map now knows. That is this profile's subject, not a
 * staleness bug, so this script ADDS links to existing rows and never adds rows.
 *
 * linksFor() in the profile reads resources[] and film_url and guards on the URL itself,
 * so an entry appended here renders as a real anchor with no UI change. Titles say what
 * the resource IS — "Open Bible Stories" is 50 illustrated narratives, never "Scripture".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const LIST = resolve(HERE, '../data/resources.json')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')

const doc = JSON.parse(readFileSync(LIST, 'utf8'))
const { codes } = JSON.parse(readFileSync(PINS, 'utf8'))
let addedD43 = 0, addedFilm = 0, touched = 0
for (const l of doc.languages || []) {
  const c = codes[l.iso639_3]
  if (!c) continue
  let changed = false
  // Idempotent: drop what a previous run of THIS script added, then re-add from the
  // current index. Appending only by URL would leave a stale title in place after the
  // index learns to disambiguate two same-named entries.
  if (Array.isArray(l.resources)) {
    const before = l.resources.length
    l.resources = l.resources.filter((r) => r.source !== 'Door43')
    if (l.resources.length !== before) changed = true
  }
  for (const d of c.d || []) {
    const list = (l.resources ||= [])
    if (list.some((r) => r.url === d.u)) continue
    list.push({ url: d.u, title: d.s, source: 'Door43' })
    addedD43++; changed = true
  }
  // Guard on the URL, matching linksFor's own rule: a flag without a URL would render an
  // anchor to nowhere.
  if (!l.film_url && c.f) { l.film_url = c.f; addedFilm++; changed = true }
  if (changed) touched++
}
doc.stats = { ...(doc.stats || {}), enriched: new Date().toISOString().slice(0, 10), door43_links_added: addedD43, film_links_added: addedFilm }
writeFileSync(LIST, JSON.stringify(doc))
console.log(`languages touched ${touched}  door43 links +${addedD43}  film links +${addedFilm}`)
