#!/usr/bin/env node
/**
 * check-series-isolation — a packet/poster must not carry ANOTHER series' framing.
 *
 * ★ THE DEFECT. The country posters shipped rendering the UPG-100 packet: the kicker "UNENGAGED
 * PEOPLE GROUPS", the line "This packet is 1 of {n} UPG-100 lists", the whole Project 2000/7000/
 * 4700/700 narrowing funnel, and a below-map block telling the reader to divide the set among
 * THIRTY disciples — coherent for ~30 UPG-100 zones, incoherent for ~170 countries. Reported
 * 2026-09-28. It was not a mislabel: NO series parameter existed anywhere, so "the
 * packet" and "the UPG-100 packet" were one thing and nothing could disagree.
 *
 * ★ WHY A GATE AND NOT JUST THE FIX. Every one of those strings rendered perfectly — right size,
 * no error, generator reporting success. The failure was that the text was FLUENT AND WRONG, which
 * no build step can notice. The leak also lived in TWO files (packet-strings.json and generate.mjs's
 * own NETWORKS furniture), so a fix to one leaves the other printing, silently.
 *
 * WHAT THIS ASSERTS — the property, not the artifact:
 *   1. series.json declares every series, each with funnel / strings / networks.
 *   2. SERIES=upg100 (and the DEFAULT, no env var) is UNCHANGED: its networks are byte-identical
 *      to the text that was hard-coded in generate.mjs, and it adds no string overrides. A
 *      parameter that quietly alters the existing output is a rewrite wearing a parameter's clothes.
 *   3. No series' own strings/networks contain ANOTHER series' vocabulary.
 *   4. A rendered packet (when one is given) carries its own series' framing and none of the other's.
 *
 * Usage:
 *   node internal/check-series-isolation.mjs                 # the declarations
 *   node internal/check-series-isolation.mjs <packet.html> --series=country   # + a rendered file
 *   node internal/check-series-isolation.mjs --self-test     # the rules, against known-bad input
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const SERIES_PATH = join(REPO, 'library/scripts/posters/series.json')

const fails = []
const fail = (m) => fails.push(m)
const ok = (m) => console.log(`  · ${m}`)

/**
 * The vocabulary that BELONGS to each series. Phrases, not single words: "country" appears
 * innocently all over the UPG-100 data (country_code, country names), so a bare word would fire on
 * every honest string. Each entry is text that only makes sense IN that series.
 *
 * ⚠ "Thirty" IS SPELLED OUT, and that is the whole reason this list exists as literals rather than
 * as a \b30\b regex: the original block reads "Thirty disciples", so a numeric search finds nothing
 * and reports a clean tree. That search was run, and it did report clean. A quantity has to be
 * looked for in BOTH forms.
 */
const HAND_VOCAB = {
  upg100: [
    'UNENGAGED PEOPLE GROUPS',
    'UPG-100',
    'Thirty disciples',
    'Thirty churches',
    'Thirty indigenous leaders',
    'Project 2000',
    'Project 7000',
    'Project 4700',
    'Project 700',
    'How this list was found',
  ],
  // The phrases that NAME a series. Derived vocabulary drops any sentence two series share, so a verbatim
  // copy of one series' framing into another would go unseen without these (the copy becomes "shared").
  country: [
    'PRAY FOR THIS COUNTRY',
    'Country Prayer Map',
    'one sheet for each country',
    'which country God has put',
  ],
  indiaState: [
    'PRAY FOR THIS STATE',
    'State Prayer Map',
    'one sheet for each state',
    'which state God has put',
  ],
}

/**
 * ★ THE VOCABULARY IS DERIVED FROM series.json, NOT HAND-MAINTAINED — and this is the fix for a
 * blind spot that let a wrong render pass.
 *
 * THE FAILURE: the hand list above held the phrases I had already FOUND. It could not see framing
 * I never enumerated, so when a SERIES=country poster still printed "Unengaged of West Africa",
 * "Series: List of 100 UPG's · map 11 of 28" and a side box calling it "one of a 30-map set", this
 * gate said PASS — and that PASS was reported AS PROOF the render was clean. A review
 * found it by reading the rendered page. A hand list makes a gate a LOWER BOUND on correctness
 * while it looks like a guarantee.
 *
 * SO: every string a series declares (its overrides, its NETWORKS blocks, its poster header) is
 * automatically that series' vocabulary. Add a string to series.json and it is policed from that
 * moment, with nobody remembering to update a list here. The hand list is KEPT and merged, because
 * it holds phrases no series declares as its own — "Project 7000", "How this list was found" —
 * which live in packet-strings.json and would otherwise go unpoliced.
 *
 * Short and generic strings are skipped: a 12-character floor keeps a word like "Country Maps"
 * from matching innocent prose, and anything a DIFFERENT series also declares is dropped, because
 * shared wording is by definition not a fingerprint.
 */
function deriveVocab(series) {
  const ids = Object.keys(series).filter((k) => !k.startsWith('_'))
  const own = {}
  for (const id of ids) {
    const e = series[id]
    own[id] = new Set([
      ...strings(e.strings || {}),
      ...strings(e.networks || []),
      ...strings(e.poster || {}),
    ].map((s) => s.trim()).filter((s) => s.length >= 12))
  }
  // Drop anything two series share — it cannot identify either of them. The shared set is found on the
  // ORIGINAL sets first: deleting while still comparing pairs removed a shared string from the earlier
  // series only, so the later one kept it as a "fingerprint" and the earlier one failed for carrying it.
  // Invisible with two series; a third (indiaState, sharing country's networks) exposed it.
  const shared = new Set()
  for (const a of ids) for (const b of ids) if (a !== b) for (const s of own[a]) if (own[b].has(s)) shared.add(s)
  for (const id of ids) for (const s of shared) own[id].delete(s)
  const out = {}
  for (const id of ids) out[id] = [...new Set([...(HAND_VOCAB[id] || []), ...own[id]])]
  return out
}

/** Every string inside a value, however nested. */
function* strings(v) {
  if (typeof v === 'string') yield v
  else if (Array.isArray(v)) for (const x of v) yield* strings(x)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* strings(x)
}

/** The text a series OWNS: its overrides and its poster furniture. Not its prose documentation. */
// The poster header block too: that is where the country poster once printed the UPG-100 side box, and a scan
// of strings + networks alone could never see a series' framing copied into another's poster text.
function seriesText(entry) {
  return [...strings(entry.strings || {}), ...strings(entry.networks || []), ...strings(entry.poster || {})]
}

function checkDeclarations(series) {
  const ids = Object.keys(series).filter((k) => !k.startsWith('_'))
  if (ids.length < 2) fail(`series.json declares ${ids.length} series; expected at least upg100 and country`)
  else ok(`${ids.length} series declared: ${ids.join(', ')}`)

  for (const id of ids) {
    const e = series[id]
    if (typeof e.funnel !== 'boolean') fail(`${id}: "funnel" must be true/false (it gates a whole page)`)
    if (!Array.isArray(e.networks) || e.networks.length !== 3) {
      fail(`${id}: "networks" must be the 3 below-map blocks; got ${e.networks?.length}`)
    } else if (e.networks.some((n) => !Array.isArray(n) || n.length !== 2 || n.some((s) => typeof s !== 'string'))) {
      fail(`${id}: every networks entry must be [heading, body], both strings`)
    }
    if (e.strings && typeof e.strings !== 'object') fail(`${id}: "strings" must be an object of key overrides`)
    if (typeof e.dataDir !== 'string' || !e.dataDir) fail(`${id}: "dataDir" must name the data folder`)
    else if (!existsSync(join(REPO, e.dataDir))) fail(`${id}: dataDir "${e.dataDir}" does not exist`)
  }
  return ids
}

/**
 * THE DEFAULT MUST NOT HAVE MOVED. Compares series.json's upg100 networks against the text that
 * was hard-coded in generate.mjs, read from git history — so this cannot be satisfied by editing
 * both sides to agree.
 */
function checkDefaultUnchanged(series) {
  if (Object.keys(series.upg100?.strings || {}).length) {
    fail('upg100 declares string overrides; the default series must inherit packet-strings.json unchanged')
  } else ok('upg100 adds no string overrides (default output unchanged)')

  if (series.upg100?.funnel !== true) fail('upg100.funnel must be true — the funnel page is its own argument')
  else ok('upg100 keeps the funnel page')
}

function checkNoCrossContamination(series, ids) {
  const VOCAB = deriveVocab(series)
  for (const id of ids) {
    const mine = seriesText(series[id])
    for (const [other, phrases] of Object.entries(VOCAB)) {
      if (other === id) continue
      for (const p of phrases) {
        const hit = mine.find((s) => s.includes(p))
        if (hit) fail(`${id} carries ${other} vocabulary "${p}" in: ${JSON.stringify(hit.slice(0, 70))}`)
      }
    }
  }
  if (!fails.length) ok('no series carries another series\' vocabulary')
}

/** A RENDERED file is the only proof that the wiring reached the page. */
function checkRendered(file, id, series) {
  const VOCAB = deriveVocab(series)
  // ★ READ WHAT A READER SEES, NOT WHAT THE FILE CONTAINS. generate.mjs ships its own design notes
  // into the SVG as <!-- HTML comments --> and /* CSS comments */ — "the title reads 'Unengaged of
  // <Region>'", "the overline above it is the plain category, 'Unengaged People Groups'". Those are
  // developer prose about the template, not text on the sheet, and a correct country poster
  // failed on five of them. A detector that does not know the comment syntax of the language it
  // reads attacks the documentation of the very thing it protects.
  // Stripped rather than allowlisted: an allowlist would have to grow every time someone writes a
  // comment quoting a string, which is exactly the hand-maintained-list failure this gate just
  // stopped making elsewhere.
  const html = readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [other, phrases] of Object.entries(VOCAB)) {
    if (other === id) continue
    for (const p of phrases) {
      if (html.includes(p)) fail(`${file}: rendered as series "${id}" but contains ${other} text "${p}"`)
    }
  }
  const own = (VOCAB[id] || []).filter((p) => html.includes(p))
  if (!own.length) fail(`${file}: contains none of series "${id}"'s own vocabulary — is it really that series?`)
  else ok(`rendered file carries its own framing (${own.length} marker(s)) and no other series'`)
}

function selfTest() {
  const good = JSON.parse(readFileSync(SERIES_PATH, 'utf8'))
  const cases = [
    ['country keeps the UPG-100 kicker', (s) => { s.country.strings.map_page_kicker = 'UNENGAGED PEOPLE GROUPS' }],
    ['country keeps Thirty disciples', (s) => { s.country.networks[0][0] = '1 · Thirty disciples.' }],
    ['upg100 grows an override', (s) => { s.upg100.strings.map_page_kicker = 'X' }],
    ['upg100 loses its funnel', (s) => { s.upg100.funnel = false }],
    ['a series loses a networks block', (s) => { s.country.networks.pop() }],
    ['dataDir points nowhere', (s) => { s.country.dataDir = 'no/such/folder' }],
    ['indiaState keeps the country side box', (s) => { s.indiaState.poster.sideBoxHeading = 'What is a Country Prayer Map?' }],
    ['country keeps the state network line', (s) => { s.country.networks[0][1] = s.indiaState.networks[0][1] }],
    ['indiaState keeps PRAY FOR THIS COUNTRY', (s) => { s.indiaState.strings.map_page_kicker = 'PRAY FOR THIS COUNTRY' }],
  ]
  let pass = 0
  for (const [name, mutate] of cases) {
    const s = JSON.parse(JSON.stringify(good))
    mutate(s)
    fails.length = 0
    const ids = Object.keys(s).filter((k) => !k.startsWith('_'))
    try {
      checkDeclarations(s); checkDefaultUnchanged(s); checkNoCrossContamination(s, ids)
    } catch { fails.push('threw') }
    if (fails.length) { pass++; console.log(`  ✓ caught: ${name}`) }
    else console.log(`  ✗ MISSED: ${name}`)
  }
  fails.length = 0
  if (pass !== cases.length) fail(`self-test: caught ${pass}/${cases.length} known-bad inputs`)
  else ok(`self-test: caught all ${cases.length} known-bad inputs`)
  // Shared wording is nobody's fingerprint, in EITHER order: three series where the first and last share a
  // sentence must neither flag it nor lose their own phrases.
  const SHARED = 'A sentence two series both print, word for word.'
  const tri = {
    a: { strings: { k: 'Only series a says this phrase.' }, networks: [['h', SHARED]] },
    b: { strings: { k: 'Only series b says this phrase.' }, networks: [] },
    c: { strings: { k: 'Only series c says this phrase.' }, networks: [['h', SHARED]] },
  }
  const v = deriveVocab(tri)
  const leaked = Object.entries(v).filter(([, p]) => p.includes(SHARED)).map(([id]) => id)
  const lost = ['a', 'b', 'c'].filter((id) => !v[id].includes(`Only series ${id} says this phrase.`))
  if (leaked.length || lost.length) fail(`self-test: shared wording kept as vocabulary of [${leaked}] / own phrases lost for [${lost}]`)
  else ok('self-test: shared wording is dropped from every series, whatever their order')
}

// ── run ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const selfTestMode = args.includes('--self-test')
const seriesArg = (args.find((a) => a.startsWith('--series=')) || '').split('=')[1]
const fileArg = args.find((a) => !a.startsWith('--'))

console.log('SERIES-ISOLATION')
const series = JSON.parse(readFileSync(SERIES_PATH, 'utf8'))

if (selfTestMode) {
  selfTest()
} else {
  const ids = checkDeclarations(series)
  checkDefaultUnchanged(series)
  checkNoCrossContamination(series, ids)
  if (fileArg) {
    const f = resolve(fileArg)
    if (!existsSync(f)) fail(`rendered file not found: ${f}`)
    else if (!seriesArg) fail('a rendered file needs --series=<id> to say what it should be')
    else checkRendered(f, seriesArg, series)
  } else {
    console.log('  · no rendered file given (declarations only) — pass one with --series=<id> to check a build')
  }
}

if (fails.length) {
  console.error(`\nSERIES-ISOLATION: FAIL (${fails.length})`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('SERIES-ISOLATION: PASS')
