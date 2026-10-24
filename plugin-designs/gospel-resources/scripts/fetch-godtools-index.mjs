#!/usr/bin/env node
/**
 * fetch-godtools-index.mjs — Cru's gospel presentations, keyed by ISO 639-3.
 *
 * WHAT THIS ADDS THAT NOTHING ELSE HERE DOES. Every other pool on this map is Scripture,
 * film, Bible video or discipleship training. None of them is a GOSPEL PRESENTATION — the
 * short, translated thing a person actually opens with someone. Cru publishes those, in the
 * same organisation that makes the JESUS Film, so the doctrine question is already settled
 * the same way the brief settles it for the film.
 *
 * IT CLOSES NO GAP, AND THAT IS STATED UP FRONT. All 98 languages that join a people group
 * here already have something. This is depth, not coverage, and it is not counted toward
 * any tier.
 *
 * ═══ godtools.org IS A PARKED DOMAIN ════════════════════════════════════════════════════
 * The obvious host answers 200 to everything with a 114-byte body. Rendered, every URL —
 * including /zz/nosuchtool-xyzzy — shows "godtools.org is parked free, courtesy of
 * GoDaddy.com". The app is real; that domain is not its home.
 *
 * The real web front-end is knowgod.com, and it does serve per-language tracts:
 *     knowgod.com/en/kgp  -> "Knowing God Personally — These four points explain..."
 *     knowgod.com/sw/kgp  -> "Kumjua Mungu Kibinafsi — Pointi hizi nne zinaelezea..."
 *     knowgod.com/zz/...  -> "Failed to load the book."
 * But only ONCE RENDERED. By fetch it is a uniform 3,864-byte shell for every URL, valid or
 * not, so status and size prove nothing — the same trap as jesusfilm's old ?languageId= and
 * live.bible.is.
 *
 * ═══ SO EXISTENCE COMES FROM CRU'S OWN API, NOT FROM THE PAGE ═══════════════════════════
 * mobile-content-api.cru.org gives each RESOURCE a `latest-translations` list and each
 * LANGUAGE a `translations` list, both of translation ids. A (language, tool) pair exists
 * exactly when those two sets intersect. Checked against the browser: en/kgp and sw/kgp both
 * intersect and both render real localised text; a language outside the list has no entry at
 * all. That is an existence proof from the publisher, not a guess about a shell.
 *
 * ONE TOOL PER LANGUAGE, most-preferred first, so a language gets one link rather than nine.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/godtools-index.json')
const API = 'https://mobile-content-api.cru.org'
const SITE = 'https://knowgod.com'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Preference order. These are Cru's gospel presentations; the lessons and survey/"emoji"
 * tools are discipleship or ice-breaker material and are not what this column is for.
 * A tool is only ever included if it appears here, so a new tool cannot arrive unscreened.
 */
const TOOLS = [
  ['kgp', 'Knowing God Personally'],
  ['fourlaws', 'Four Spiritual Laws'],
  ['honorrestored', 'Honor Restored'],
  ['fantasticfacts', 'Four Fantastic Facts'],
  ['satisfied', 'Satisfied?'],
  ['connectingwithgod', 'Connecting With God'],
]

const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`)
  return r.json()
}

const langs = (await get('/languages')).data || []
const res = (await get('/resources')).data || []
if (langs.length < 50 || res.length < 10) {
  console.error(`GODTOOLS: ABORT — got ${langs.length} languages and ${res.length} resources; refusing to run on a truncated payload.`)
  process.exit(1)
}

// ISO 639-1 -> 639-3 from SIL's own table, the same mapping the Door43 fetcher uses.
const isoRes = await fetch('https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3.tab', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
if (!isoRes.ok) throw new Error(`iso-639-3.tab: HTTP ${isoRes.status}`)
const P1 = {}
for (const line of (await isoRes.text()).trim().split('\n').slice(1)) {
  const f = line.split('\t')
  if ((f[0] || '').trim().length === 3 && (f[3] || '').trim().length === 2) P1[f[3].trim()] = f[0].trim()
}

const toolSets = new Map()
for (const [abbr] of TOOLS) {
  const r = res.find((x) => x.attributes && x.attributes.abbreviation === abbr)
  if (!r) continue
  toolSets.set(abbr, new Set(((r.relationships['latest-translations'] || {}).data || []).map((x) => x.id)))
}

const isSpecial = (c) => c === 'und' || c === 'mul' || c === 'mis' || c === 'zxx' || (c >= 'qaa' && c <= 'qtz')
const codes = {}
let noIso = 0, noTool = 0
for (const l of langs) {
  const raw = String(l.attributes.code || '').trim()
  const base = raw.split('-')[0]
  const iso = base.length === 3 ? base : P1[base]
  if (!iso || isSpecial(iso)) { noIso++; continue }
  const mine = new Set(((l.relationships.translations || {}).data || []).map((x) => x.id))
  let picked = null
  for (const [abbr, title] of TOOLS) {
    const set = toolSets.get(abbr)
    if (set && [...mine].some((id) => set.has(id))) { picked = { abbr, title }; break }
  }
  if (!picked) { noTool++; continue }
  // First language wins a code: 'zh-Hans' and 'zh-Hant' both map to cmn and one link is enough.
  if (codes[iso]) continue
  codes[iso] = { u: `${SITE}/${raw}/${picked.abbr}`, n: picked.title, ln: l.attributes.name || '', locale: raw, tool: picked.abbr }
}

writeSnapshot(
  OUT,
  `${JSON.stringify({
    _note: 'Cru gospel presentations (GodTools) on knowgod.com, keyed by ISO 639-3. godtools.org is a PARKED DOMAIN. knowgod.com is a client-rendered shell that answers 200 with identical bytes for any URL, so existence is proved from Cru\'s own API by intersecting a resource\'s latest-translations with a language\'s translations — never from the page.',
    source: `${API}/languages + ${API}/resources`,
    site: SITE,
    generated: new Date().toISOString().slice(0, 10),
    tools_allowed: TOOLS.map(([a, t]) => `${a} (${t})`),
    counts: { languages: langs.length, resources: res.length, codes: Object.keys(codes).length, noIso, noTool },
    codes,
  }, null, 1)}\n`,
  (j) => Object.keys(j.codes || {}).length,
  'GodTools ISO 639-3 codes',
)
console.log(`GODTOOLS: ${langs.length} languages, ${res.length} tools -> ${Object.keys(codes).length} ISO 639-3 codes`)
console.log(`  skipped: ${noIso} with no ISO 639-3 mapping, ${noTool} with none of the allowed gospel presentations`)
