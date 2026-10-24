#!/usr/bin/env node
// emit-india-state-names.mjs — India's 36 states and union territories named in the 11 UI locales, for the Country
// Posters wall's India section: the CARD labels, the print HUD and the packet/list titles. The printed sheet stays
// English by recorded decision (series.json english_only_note), like every country poster.
//
// SOURCE: Wikidata labels, matched on ISO 3166-2 (P300) against data/people-groups/india-states.json. Wikidata's
// structured data is CC0. The labels are human-edited, not machine translation. Dissolved items (P576) are excluded,
// so a retired code such as the pre-2020 Dadra and Nagar Haveli cannot win.
// English is the TABLE's own name, so the English wall does not change; Wikidata's English is only a cross-check.
// A locale Wikidata has no label for falls back to the English name AND is recorded in the meta file, never silently.
//
// Writes: library/i18n/locales/<locale>/countryPosters.json  -> "stateNames": { "IN-GJ": "…", … } (other keys kept)
//         plugin-designs/country-posters/data/india-state-names.meta.json  (source, licence, query, date, gaps)
// Regenerate: node plugin-designs/country-posters/scripts/emit-india-state-names.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LOCALES = ['en', 'es', 'fr', 'pt', 'de', 'it', 'ro', 'ru', 'ar', 'hi', 'zh']
const WD_LANG = { zh: ['zh-hans', 'zh-cn', 'zh'] }            // the zh catalogue is Simplified
const wdLangs = (l) => WD_LANG[l] || [l]

// The state table keeps geoBoundaries' ISO codes; ISO 3166-2:IN has since renamed four, and Wikidata's P300 holds
// the CURRENT code. Queried under the current code, keyed back to the table's.
const CODE_ALIAS = { 'IN-CT': 'IN-CG', 'IN-OR': 'IN-OD', 'IN-TG': 'IN-TS', 'IN-UT': 'IN-UK' }
const wdCode = (iso) => CODE_ALIAS[iso] || iso

// REVIEWED OVERRIDES (hi, ar, zh read by eye, 2026-09-30), each with its evidence. Kept small and explicit: neither
// Wikidata's labels nor its Wikipedia titles are uniformly current (zh's Odisha TITLE is the old Orissa while its
// label is current; ar's Odisha LABEL is the old Orissa while its title is current), so no blanket rule is safe.
const OVERRIDES = {
  'IN-OR': { ar: ['أديشة', "the label is the pre-2011 name Orissa (أريسة); ar.wikipedia's title for the item is أديشة (Odisha)"] },
  'IN-DH': { zh: ['达德拉-纳加尔哈维利和达曼-第乌', 'Wikidata has only a Traditional-script zh label; converted character by character to the Simplified catalogue script'] },
}

const states = JSON.parse(readFileSync(join(ROOT, 'data/people-groups/india-states.json'), 'utf8')).states
const isos = states.map((s) => wdCode(s.iso)).sort()
const langs = [...new Set(LOCALES.flatMap(wdLangs))]
const query = `SELECT ?code ?lang ?label WHERE {
  VALUES ?code { ${isos.map((c) => `"${c}"`).join(' ')} }
  ?item wdt:P300 ?code .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  ?item rdfs:label ?label . BIND(LANG(?label) AS ?lang)
  FILTER(?lang IN (${langs.map((l) => `"${l}"`).join(', ')}))
}`
const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), {
  headers: { accept: 'application/sparql-results+json', 'user-agent': 'dx-maps country-posters emit-india-state-names' },
  signal: AbortSignal.timeout(60000),
})
if (!res.ok) { console.error(`Wikidata ${res.status}`); process.exit(1) }
const rows = (await res.json()).results.bindings
const got = {}                                                  // iso -> Wikidata language -> Set(labels)
for (const r of rows) ((got[r.code.value] ||= {})[r.lang.value] ||= new Set()).add(r.label.value)

// FALLBACK for a language the matched item has no label in (e.g. the "National Capital Territory of Delhi" item):
// the labels of items in India (P17 = Q668) whose English label IS the table's name (the city of Delhi,
// Chandigarh). Used only for the missing languages, and recorded.
async function sameNameLabels(name) {
  const q = `SELECT ?lang ?label WHERE { ?item rdfs:label ${JSON.stringify(name)}@en ; wdt:P17 wd:Q668 .
    ?item rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN (${langs.map((l) => `"${l}"`).join(', ')})) }`
  const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), {
    headers: { accept: 'application/sparql-results+json', 'user-agent': 'dx-maps country-posters emit-india-state-names' },
    signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) throw new Error(`Wikidata ${r.status}`)
  const by = {}
  for (const b of (await r.json()).results.bindings) {
    const m = (by[b.lang.value] ||= new Map()); m.set(b.label.value, (m.get(b.label.value) || 0) + 1)
  }
  return by   // lang -> Map(label -> how many same-named items carry it)
}
const fallbacks = [], overridden = [], unreviewedZh = []

const gaps = [], ambiguous = [], englishMismatches = []
const names = Object.fromEntries(LOCALES.map((l) => [l, {}]))
for (const st of [...states].sort((a, b) => a.iso.localeCompare(b.iso))) {
  const wd = got[wdCode(st.iso)] || {}
  if (!Object.keys(wd).length) gaps.push(`${st.iso}: no Wikidata item (queried as ${wdCode(st.iso)})`)
  let same = null
  const wdEn = wd.en && [...wd.en][0]
  // The table names the division more briefly than its item ("Delhi" vs "National Capital Territory of Delhi"): then
  // the SAME-NAMED item's labels (the city of Delhi) are preferred in every language, so hi and ru match the English.
  const preferSame = Boolean(wdEn && wdEn !== st.name)
  if (preferSame) englishMismatches.push(`${st.iso}: table "${st.name}" vs Wikidata "${wdEn}"; same-named labels preferred`)
  for (const l of LOCALES) {
    if (l === 'en') { names.en[st.iso] = st.name; continue }
    const ov = OVERRIDES[st.iso] && OVERRIDES[st.iso][l]
    if (ov) { names[l][st.iso] = ov[0]; overridden.push(`${st.iso} ${l}: "${ov[0]}" (${ov[1]})`); continue }
    if (preferSame) {
      same ||= await sameNameLabels(st.name)
      const m = wdLangs(l).map((w) => same[w]).find((x) => x && x.size)
      if (m) { const [label] = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]; names[l][st.iso] = label; fallbacks.push(`${st.iso} ${l}: "${label}" from the same-named item (preferred)`); continue }
    }
    const src = wdLangs(l).find((w) => wd[w] && wd[w].size)
    if (l === 'zh' && src === 'zh') unreviewedZh.push(`${st.iso}: only a plain "zh" label (script unknown: may be Traditional); add a reviewed OVERRIDE`)
    const hit = src && wd[src]
    if (!hit) {
      same ||= await sameNameLabels(st.name)
      const m = wdLangs(l).map((w) => same[w]).find((x) => x && x.size)
      if (m) {
        const [label, n] = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
        names[l][st.iso] = label; fallbacks.push(`${st.iso} ${l}: "${label}" from the same-named item (${n} of ${[...m.values()].reduce((a, x) => a + x, 0)})`)
        continue
      }
      names[l][st.iso] = st.name; gaps.push(`${st.iso} ${l}: no label, English used`); continue
    }
    if (hit.size > 1) ambiguous.push(`${st.iso} ${l}: ${[...hit].join(' | ')}`)
    names[l][st.iso] = [...hit].sort()[0]
  }
}
for (const l of LOCALES) {
  const p = join(ROOT, `library/i18n/locales/${l}/countryPosters.json`)
  const area = JSON.parse(readFileSync(p, 'utf8'))
  area.stateNames = names[l]
  writeFileSync(p, JSON.stringify(area, null, 2) + '\n')
}
const meta = {
  what: "India's 36 states and union territories, named in the 11 UI locales, for the Country Posters wall's card labels.",
  source: 'Wikidata (https://www.wikidata.org): labels of the items whose ISO 3166-2 code (P300) matches data/people-groups/india-states.json; dissolved items (P576) excluded.',
  licence: 'CC0 1.0: Wikidata structured data is released under CC0 (https://creativecommons.org/publicdomain/zero/1.0/).',
  english: "the state table's own name (the English wall is unchanged); Wikidata's English is only a cross-check",
  retrieved: new Date().toISOString().slice(0, 10),
  regenerate: 'node plugin-designs/country-posters/scripts/emit-india-state-names.mjs',
  query,
  codeAliases: CODE_ALIAS,
  reviewedOverrides: overridden,
  gaps, ambiguous, fallbacks, englishMismatches,
}
writeFileSync(join(ROOT, 'plugin-designs/country-posters/data/india-state-names.meta.json'), JSON.stringify(meta, null, 2) + '\n')
console.log(`states ${states.length}, Wikidata rows ${rows.length}; gaps ${gaps.length}, ambiguous ${ambiguous.length}, fallbacks ${fallbacks.length}, English mismatches ${englishMismatches.length}`)
for (const x of [...gaps, ...ambiguous, ...fallbacks, ...overridden, ...englishMismatches]) console.log('  ' + x)
// A zh name from a plain "zh" label may be Traditional script in a Simplified catalogue: refuse rather than ship it.
if (unreviewedZh.length) { unreviewedZh.forEach((x) => console.error('FAIL ' + x)); process.exitCode = 1 }
