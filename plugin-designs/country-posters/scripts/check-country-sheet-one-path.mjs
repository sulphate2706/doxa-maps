#!/usr/bin/env node
// check:country-sheet-one-path — a country's map sheet is drawn through ONE path, so one country
// cannot print two different posters.
//
// WHY: two callers draw a country sheet (the Country Posters wall and the Regions tab's regions-list).
// Each once had its own wrapper around generateCountrySheet, and they drifted twice: the Regions tab
// printed a country in flat teal while the wall printed it in its region's hue, and the Regions tab
// printed India's packet page 1 as "map 1 of 0" while the wall said "map 1 of 1". Both now go through
// @map/packet/countrySheet.js (makeCountrySheet + seriesFor).
//
// ARM A (structure, over the TREE): every plugin file whose CODE (parsed, so comments cannot count)
// names generateCountrySheet is a violation; every caller of makeCountrySheet passes `countries`, so
// its "map N of M" is computed from the same list; and at least the two known callers are found (a
// census that finds fewer is NOT MEASURED, never a pass).
// ARM B (behaviour, over the real library/data/country-posters.json): seriesFor gives named answers:
// India (sheet null) is 1 of 1, every 3x3 country is N of the 3x3 tier with no repeated N, a code
// absent from the data gets no series.
//
// Exit 0 pass, 1 fail, 75 not measured. `--self-test` plants each defect and requires its arm to fail.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc, babelParse } from '@vue/compiler-sfc'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PD = join(ROOT, 'plugin-designs')
const KNOWN_CALLERS = ['plugin-designs/country-posters/country-poster-wall.vue']
// The Regions list may draw a country sheet itself OR delegate to <dxm-poster-section> (whose library type draws it).
// If it still calls makeCountrySheet it must pass arms F and G like the wall; either way the library type must.
const REGIONS_LIST = 'plugin-designs/regions-dashboard/regions-list.vue'
const COUNTRY_TYPE = 'library/components/poster/types/countryPosterType.js'
// ARM H: the library 'country' type (the element's caller) withholds like the wall: rows reject with the sentence,
// a withheld poster's card shows the sentence.
export function armH(typeSrc) {
  const fails = []
  if (!/makeCountrySheet\(/.test(typeSrc)) fails.push(`${COUNTRY_TYPE}: no longer draws through makeCountrySheet`)
  if (!/rowsWithheld\(c\) \? Promise\.reject\(keyedError\('messages\.countryPosterTooMany'/.test(typeSrc)) fails.push(`${COUNTRY_TYPE}: withheld ROWS are not withheld (the element would print India's list)`)
  if (!/posterWithheld\(c\) \|\|[^?]*\? t\('messages\.countryPosterTooMany'\)/.test(typeSrc)) fails.push(`${COUNTRY_TYPE}: a withheld POSTER's card does not show the sentence`)
  return fails
}
// India's states and union territories draw through their own ONE path; inside this plugin only that helper may
// call the generator directly.
const STATE_HELPER = 'plugin-designs/country-posters/src/indiaStateSheet.js'
const STATE_CALLER = 'plugin-designs/country-posters/country-poster-wall.vue'

function scriptsOf(file, src) {
  if (!file.endsWith('.vue')) return [src]
  const { descriptor, errors } = parseSfc(src, { filename: file })
  if (errors.length) throw new Error(`${file}: SFC parse error: ${errors[0].message || errors[0]}`)
  return [descriptor.script, descriptor.scriptSetup].filter(Boolean).map((b) => b.content)
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}

// -> { names: Set of identifier names used in code, makeCalls: [{ hasCountries }] }
function codeFacts(file, src) {
  const names = new Set()
  const makeCalls = []
  for (const code of scriptsOf(file, src)) {
    const ast = babelParse(code, { sourceType: 'module', plugins: ['typescript'] })
    walk(ast.program, (n) => {
      if (n.type === 'Identifier') names.add(n.name)
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'makeCountrySheet') {
        const arg = n.arguments[0]
        const hasCountries = !!(arg && arg.type === 'ObjectExpression'
          && arg.properties.some((p) => p.key && (p.key.name === 'countries' || p.key.value === 'countries')))
        makeCalls.push({ hasCountries })
      }
    })
  }
  return { names, makeCalls }
}

function listSources(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) listSources(p, out)
    else if (/\.(vue|js|mjs)$/.test(e) && !/\/scripts\//.test(p)) out.push(p)
  }
  return out
}

// ARM A over a { relPath: source } map. Returns failure strings; `callers` gets the files that call makeCountrySheet.
export function armA(files, callers = []) {
  const fails = []
  for (const [rel, src] of Object.entries(files)) {
    if (!/generateCountrySheet|makeCountrySheet|generateSheet|makeIndiaStateSheet/.test(src)) continue   // a text prefilter; the parse decides
    const { names, makeCalls } = codeFacts(rel, src)
    if (names.has('generateCountrySheet')) fails.push(`${rel}: draws a country sheet directly (generateCountrySheet in code); use makeCountrySheet from @map/packet/countrySheet.js`)
    if (rel.startsWith('plugin-designs/country-posters/') && rel !== STATE_HELPER && names.has('generateSheet')) fails.push(`${rel}: calls generateSheet directly; a state sheet goes through makeIndiaStateSheet (${STATE_HELPER})`)
    if (rel === STATE_CALLER && names.has('makeIndiaStateSheet')) callers.push(`${rel}#state`)
    if (makeCalls.length) callers.push(rel)
    makeCalls.forEach((c, i) => { if (!c.hasCountries) fails.push(`${rel}: makeCountrySheet call #${i + 1} passes no \`countries\`, so its "map N of M" is not the wall's`) })
  }
  return fails
}

// ARM B: named expectations for seriesFor over the real data.
export function armB(seriesFor, countries, sheetFormatFor = null) {
  const fails = []
  const by = (iso) => countries.find((c) => c.iso3 === iso)
  const ind = by('IND')
  const s = ind && seriesFor(countries, ind)
  // THE LARGE-SHEET FORMAT RULE: India prints 60x96 ONLY (any request but a packet page gets it); a packet page stays a
  // page; any other country gets exactly what it asked for.
  if (sheetFormatFor) {
    const want = [[ind, '60x96', '60x96'], [ind, '66x66', '60x96'], [ind, '36x60', '60x96'], [ind, 'letter', '60x96'], [ind, '3x4', '60x96'], [ind, 'packet', 'packet'],
      [by('NPL'), '3x3', '3x3'], [by('NPL'), 'letter', 'letter'], [by('CHN'), '3x4', '3x4'], [by('NPL'), '66x66', '66x66']]
    for (const [item, ask, exp] of want) { const got = sheetFormatFor(item, ask); if (got !== exp) fails.push(`sheetFormatFor(${item?.iso3}, ${ask}) = ${got}, expected ${exp}`) }
  }
  const oversized = countries.filter((c) => (c.sheet ?? null) === null)
  if (oversized.length > 1) fails.push(`${oversized.length} countries have no sheet size (${oversized.map((c) => c.iso3).join(', ')}): they now share ONE oversized series, so India prints "map 1 of ${oversized.length}". Decide that deliberately, then update this expectation.`)
  if (!ind) fails.push('India is missing from country-posters.json')
  else if (!s || s.index !== 1 || s.totalLists !== 1 || s.totalGroups !== ind.count) fails.push(`India (sheet ${JSON.stringify(ind.sheet)}) should be map 1 of 1 with ${ind.count} groups; got ${JSON.stringify(s)}`)
  const t3 = countries.filter((c) => c.sheet === '3x3')
  const seen = new Set()
  for (const c of t3) {
    const r = seriesFor(countries, c)
    if (!r || r.totalLists !== t3.length || r.index < 1 || r.index > t3.length) { fails.push(`${c.iso3} (3x3) should be N of ${t3.length}; got ${JSON.stringify(r)}`); break }
    seen.add(r.index)
  }
  if (seen.size && seen.size !== t3.length) fails.push(`3x3 tier: ${seen.size} distinct indexes for ${t3.length} countries`)
  const absent = seriesFor(countries, { id: 'country-zzz', iso3: 'ZZZ', label: 'ZZZ', count: 3 })
  if (absent !== undefined) fails.push(`a country absent from the data should get no series; got ${JSON.stringify(absent)}`)
  if (seriesFor(null, ind) !== undefined) fails.push('seriesFor with no list should return undefined')
  return fails
}

// ARM C: the state posters over the SERVED table and the renderer's own ADM1 file (named expectations).
export function armC(H, states, adm1Ind) {
  const fails = []
  const before = JSON.stringify((adm1Ind.features || []).map((f) => f.properties && f.properties.listId))   // BEFORE any call
  const withGroups = H.statesWithPosters(states)
  const zero = (states || []).filter((st) => !st.count).map((st) => st.name)
  if ((states || []).length !== 36) fails.push(`the state table has ${(states || []).length} divisions, expected 36 (28 states + 8 union territories)`)
  if (withGroups.length + zero.length !== (states || []).length) fails.push('every division is either postered or named as having none')
  const idx = withGroups.map((st) => (H.stateSeries(states, st) || {}).index)
  if (new Set(idx).size !== withGroups.length || Math.min(...idx) !== 1 || Math.max(...idx) !== withGroups.length) fails.push(`state series indexes are not 1..${withGroups.length}, unique: ${idx.join(',')}`)
  const noShape = withGroups.filter((st) => !H.stateGeometry(H.stateZone(st, '#000'), adm1Ind, st.shapeName)).map((st) => st.name)
  if (noShape.length) fails.push(`states with people groups but no outline in gb-IND-ADM1.geojson (their poster would not draw): ${noShape.join(', ')}`)
  withGroups.forEach((st) => H.stateGeometry(H.stateZone(st, '#000'), adm1Ind, st.shapeName))
  if (JSON.stringify((adm1Ind.features || []).map((f) => f.properties && f.properties.listId)) !== before) fails.push('stateGeometry mutated the shared ADM1 collection')
  return fails
}

// ARM D: the state cards' localized names cover EXACTLY the table's divisions in every locale (a runtime-built key,
// `countryPosters.stateNames.${iso}`, that the i18n call-site gates cannot see), English is the table's own name, and
// the generated names carry their source licence.
const NAME_LOCALES = ['en', 'es', 'fr', 'pt', 'de', 'it', 'ro', 'ru', 'ar', 'hi', 'zh']
export function armD(states, areas, meta) {
  const fails = []
  const want = new Set((states || []).map((st) => st.iso))
  for (const l of NAME_LOCALES) {
    const names = (areas[l] && areas[l].stateNames) || {}
    const have = new Set(Object.keys(names))
    const missing = [...want].filter((x) => !have.has(x)), extra = [...have].filter((x) => !want.has(x))
    const empty = Object.entries(names).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k)
    if (missing.length || extra.length || empty.length) fails.push(`${l} countryPosters.stateNames: missing [${missing}] extra [${extra}] empty [${empty}]`)
  }
  const en = (areas.en && areas.en.stateNames) || {}
  const drift = (states || []).filter((st) => en[st.iso] !== st.name).map((st) => st.iso)
  if (drift.length) fails.push(`English state names differ from the table's: ${drift.join(', ')} (re-run emit-india-state-names.mjs)`)
  if (!meta || !/CC0/.test(String(meta.licence || ''))) fails.push('india-state-names.meta.json must record the source licence (CC0)')
  return fails
}

// ARM F — A DESKTOP-ONLY CARD ON A PHONE (India): in EACH caller (the wall, the Regions list) its rows REJECT with
// poster.phoneLimitAll before any record is fetched, never resolve [] (the print path reads [] as "that list has no
// people groups to print", on a card that has 855), and the card shows the same full-block notice.
export function armF(srcs) {
  const fails = []
  for (const [name, src] of Object.entries(srcs)) {
    if (!/phoneBlocked\((?:c|item)\) \? (?:desktopOnly\(\)|Promise\.reject\(keyedError\('poster\.phoneLimitAll')/.test(src)) fails.push(`${name}: a phone-blocked card's rows do not reject with poster.phoneLimitAll`)
    if (/phoneBlocked\((?:c|item)\) \? Promise\.resolve\(\[\]\)/.test(src)) fails.push(`${name}: a phone-blocked card's rows resolve [] (printed as "no people groups")`)
    if (/desktopOnly\(\)/.test(src) && !/const desktopOnly = \(\) => Promise\.reject\(keyedError\('poster\.phoneLimitAll'/.test(src)) fails.push(`${name}: desktopOnly() does not reject with poster.phoneLimitAll`)
    if (!/phoneBlocked\(c\) \? t(?:Key)?\('poster\.phoneLimitAll'\)/.test(src)) fails.push(`${name}: a phone-blocked card does not show poster.phoneLimitAll`)
  }
  return fails
}

// ARM E: India is its OWN section, FIRST, counted ONCE. The India country card, the state cards and the none-listed
// cards group together; the section's total is India's own count (not the card sum, which counts 855 twice); on that
// true total it outranks every regional section. PosterWall's default (no sectionTotal) must still be the card sum.
// ARM G — WHAT OF A WHOLE COUNTRY IS WITHHELD (countrySheet.js WITHHELD), and the PREVIEW guard. India:
//  (a) BY DEFAULT (every public host: DX Life, the research landing, any embed) its whole-country POSTER is withheld
//      (the sentence; largeSheet() null) and its ROWS are withheld;
//  (b) only in a PREVIEW context (the Vite dev server: the Plugin Studio on the pilot) the poster prints, 60x96 ONLY; its rows stay withheld. A state card is never withheld.
// Each caller shows the sentence for a withheld POSTER and rejects the rows for withheld ROWS; Country Posters' India
// tab exists only under the preview flag.
export async function armG(cs, srcs, mfeSrc = '') {
  const fails = []
  const ind = { id: 'country-ind', iso3: 'IND', label: 'India' }
  // (a) by default: outside the Vite dev server (here: no import.meta.env.DEV) the preview is shut EVEN IF a page or a
  // console sets the global; (b) an open preview (passed explicitly) prints the poster at 66x66.
  const was = globalThis.DXM_PREVIEW_UNRELEASED
  try {
    globalThis.DXM_PREVIEW_UNRELEASED = true
    if (cs.previewUnreleased()) fails.push('(a) the preview opens outside the dev server from a global alone: a page/console could print the withheld poster from production')
    if (!cs.posterWithheld(ind) || cs.largeSheet(ind)) fails.push("(a) India's whole-country poster is NOT withheld by default: it would ship to every host")
  } finally { if (was === undefined) delete globalThis.DXM_PREVIEW_UNRELEASED; else globalThis.DXM_PREVIEW_UNRELEASED = was }
  if (!cs.rowsWithheld(ind)) fails.push("India's rows are not withheld: its list/packet/cards (~1,000 pages) would print")
  // (b) the open preview itself is proved under Vite (import.meta.env.DEV true) by check:poster-section; here, the size:
  const big = cs.LARGE_SHEETS && cs.LARGE_SHEETS.IND
  if (!big || big.format !== '60x96' || big.formats.join() !== '60x96') fails.push(`India's whole-country poster is not 60x96 ONLY (${big && big.formats})`)
  if (cs.posterWithheld.length > 1 || cs.largeSheet.length > 1) fails.push('posterWithheld()/largeSheet() take a second argument again: a production caller could open the withheld poster')
  if (cs.sheetWithheld(ind) !== cs.posterWithheld(ind)) fails.push('sheetWithheld() no longer means the poster')
  if (cs.rowsWithheld({ iso3: 'IND', indiaState: true, id: 'india-state-gujarat' })) fails.push('an India STATE card has withheld rows (only the whole country may)')
  for (const [name, src] of Object.entries(srcs)) {
    if (!/posterWithheld\((?:c|item)\) \? t(?:Key)?\('messages\.countryPosterTooMany'\)/.test(src)) fails.push(`${name}: a withheld POSTER's card does not show messages.countryPosterTooMany`)
    if (!/rowsWithheld\((?:c|item)\) \? (?:withheld\(\)|Promise\.reject\(keyedError\('messages\.countryPosterTooMany')/.test(src)) fails.push(`${name}: withheld ROWS are not withheld (its list/packet/cards would print)`)
    if (/sheetWithheld\(/.test(src)) fails.push(`${name}: still reads sheetWithheld() (ambiguous: poster or rows?)`)
  }
  if (mfeSrc && !/\.\.\.\(import\.meta\.env && import\.meta\.env\.DEV && globalThis\.DXM_PREVIEW_UNRELEASED === true && previewOptedIn\(\) \? \[INDIA_PANE\] : \[\]\)/.test(mfeSrc)) fails.push('country-posters-mfe: the India tab is not gated on the DEV-only preview read AND the explicit opt-in (previewOptedIn())')
  // the BUILT tree never mentions the flag (every read is compiled away)
  try {
    const pub = join(ROOT, 'public/dx-maps')
    for (const b of readdirSync(pub)) { const f = join(pub, b, `${b}.js`); if (existsSync(f) && readFileSync(f, 'utf8').includes('DXM_PREVIEW_UNRELEASED')) fails.push(`the built ${b}.js mentions DXM_PREVIEW_UNRELEASED (a preview read survived the build)`) }
  } catch (_) { /* no built tree here */ }
  return fails
}

export function armE(countries, states, wallSrc, posterWallSrc, H) {
  const fails = []
  if (!/:section-total=/.test(wallSrc)) fails.push('country-poster-wall.vue does not pass :section-total, so India is counted twice')
  if (!/String\(c\.iso3[^)]*\)\.toUpperCase\(\) === 'IND'/.test(wallSrc)) fails.push("the wall's isIndia() no longer puts India's country card in the India section")
  if (!/props\.sectionTotal \? props\.sectionTotal\(name, items\) : items\.reduce\(\(n, x\) => n \+ \(x\.count \|\| 0\), 0\)/.test(posterWallSrc)) fails.push("PosterWall's default section total is no longer the card sum (every other wall would change)")
  const ind = countries.find((c) => c.iso3 === 'IND')
  const stateCards = [...H.statesWithPosters(states).map((st) => ({ count: st.count, indiaState: true })), ...states.filter((st) => !st.count).map(() => ({ count: 0, indiaState: true }))]
  const groups = new Map()
  for (const c of [...countries, ...stateCards]) {
    const g = c.indiaState || c.iso3 === 'IND' ? 'India' : (c.region || 'Other')
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c)
  }
  const total = (g, items) => (g === 'India' ? ind.count : items.reduce((n, x) => n + (x.count || 0), 0))
  const order = [...groups].map(([g, items]) => [g, total(g, items)]).sort((a, b) => b[1] - a[1])
  if (order[0][0] !== 'India') fails.push(`India is not the first section: ${order.slice(0, 3).map(([g, t]) => `${g} ${t}`).join(', ')}`)
  if (order.find(([g]) => g === 'India')[1] !== ind.count) fails.push(`the India section counts ${order.find(([g]) => g === 'India')[1]}, not India's ${ind.count}`)
  return { fails, order }
}

async function main() {
  const selfTest = process.argv.includes('--self-test')
  const CS = await import(join(ROOT, 'library/packet/countrySheet.js'))
  const { seriesFor, sheetFormatFor } = CS
  const data = JSON.parse(readFileSync(join(ROOT, 'library/data/country-posters.json'), 'utf8'))
  const countries = data.countries || []
  if (countries.length < 170) { console.log(`NOT MEASURED: country-posters.json parsed ${countries.length} countries (floor 170)`); process.exitCode = 75; return }

  const H = await import(join(ROOT, STATE_HELPER))
  const states = JSON.parse(readFileSync(join(ROOT, 'public/dx-maps/assets/people-groups/india-states.json'), 'utf8')).states || []
  const adm1Ind = JSON.parse(readFileSync(join(ROOT, 'public/dx-maps/assets/boundaries/gb-IND-ADM1.geojson'), 'utf8'))
  if (states.length < 30 || (adm1Ind.features || []).length < 30) { console.log(`NOT MEASURED: state table ${states.length} / ADM1 ${(adm1Ind.features || []).length} features (floor 30)`); process.exitCode = 75; return }

  const areas = Object.fromEntries(NAME_LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, `library/i18n/locales/${l}/countryPosters.json`), 'utf8'))]))
  const meta = JSON.parse(readFileSync(join(ROOT, 'plugin-designs/country-posters/data/india-state-names.meta.json'), 'utf8'))

  const files = {}
  for (const p of listSources(PD)) files[relative(ROOT, p)] = readFileSync(p, 'utf8')

  const REG = readFileSync(join(ROOT, 'plugin-designs/regions-dashboard/regions-list.vue'), 'utf8')
  const MFE = readFileSync(join(ROOT, 'plugin-designs/country-posters/country-posters-mfe.vue'), 'utf8')
  const TYPE = readFileSync(join(ROOT, COUNTRY_TYPE), 'utf8')
  const regIsCaller = /makeCountrySheet\(/.test(REG)
  const lists = (wallSrc, regSrc = REG) => (regIsCaller ? { wall: wallSrc, regions: regSrc } : { wall: wallSrc })
  if (selfTest) {
    const wall = KNOWN_CALLERS[0]
    const cases = [
      ['direct generateCountrySheet call', () => armA({ ...files, [wall]: files[wall].replace('<script setup>', "<script setup>\nimport { generateCountrySheet } from '@map/packet/posterSheets.js'\ngenerateCountrySheet({})") })],
      ['makeCountrySheet without countries', () => armA({ ...files, [wall]: files[wall].replace(/countries: data\.countries \|\| \[\],/, '') })],
      ['India skipped (the old guard)', () => armB((l, it) => (!it || !it.sheet ? undefined : seriesFor(l, it)), countries)],
      ['absent code given a position', () => armB((l, it) => seriesFor(l, it) || { index: 1, totalLists: 1, totalGroups: 0 }, countries)],
      ['a second no-sheet country joins India', () => armB(seriesFor, countries.map((c) => (c.iso3 === 'CHN' ? { ...c, sheet: null } : c)))],
      ['the wall calls generateSheet directly', () => armA({ ...files, [wall]: files[wall].replace('<script setup>', "<script setup>\nimport { generateSheet } from '@map/packet/posterSheets.js'\ngenerateSheet({})") })],
      ['a state with groups loses its outline', () => armC(H, states.map((st) => (st.id === 'india-gj' ? { ...st, shapeName: 'Nowhere' } : st)), adm1Ind)],
      ['a division silently dropped', () => armC(H, states.filter((st) => st.id !== 'india-mz'), adm1Ind)],
      ['the wall stops passing sectionTotal (India counted twice)', () => armE(countries, states, files[wall].replace(':section-total=', ':x-section-total='), readFileSync(join(ROOT, 'library/components/poster/PosterWall.vue'), 'utf8'), H).fails],
      ['India country card left in Asia', () => armE(countries, states, files[wall].replace("=== 'IND'", "=== 'XXX'"), readFileSync(join(ROOT, 'library/components/poster/PosterWall.vue'), 'utf8'), H).fails],
      ['India offered 66x66 again', () => armB(seriesFor, countries, (it, f) => (it?.iso3 === 'IND' && f === '66x66' ? '66x66' : sheetFormatFor(it, f)))],
      ['a packet page becomes a large sheet', () => armB(seriesFor, countries, (it, f) => (it?.iso3 === 'IND' ? '60x96' : f))],
      ['the wall resolves [] for a phone-blocked card', () => armF({ wall: files[wall].replace("const desktopOnly = () => Promise.reject(keyedError('poster.phoneLimitAll'", "const desktopOnly = () => Promise.resolve([]) || (keyedError('poster.phoneLimitAll'"), regions: REG })],
      // Only while the Regions list draws its own sheets (regIsCaller): a list that delegates to <dxm-poster-section> has
      // no phone-block code of its own to poison, and lists() leaves it out of arm F, so this case would read as MISSED.
      ...(regIsCaller ? [['the Regions list resolves [] for a phone-blocked card', () => armF(lists(files[wall], REG.replace("phoneBlocked(item) ? Promise.reject(keyedError('poster.phoneLimitAll'", "phoneBlocked(item) ? Promise.resolve([]) || (keyedError('poster.phoneLimitAll'")))]] : []),
      ['a locale loses a state name', () => armD(states, { ...areas, ro: { ...areas.ro, stateNames: Object.fromEntries(Object.entries(areas.ro.stateNames).filter(([k]) => k !== 'IN-GJ')) } }, meta)],
      ['the names lose their licence line', () => armD(states, areas, { ...meta, licence: '' })],
      ['India\'s poster released by default', async () => armG({ ...CS, posterWithheld: () => false, largeSheet: () => CS.LARGE_SHEETS.IND }, lists(files[wall]), MFE)],
      ['an opener argument comes back', async () => armG({ ...CS, posterWithheld: (it, open) => CS.posterWithheld(it) }, lists(files[wall]), MFE)],
      ['the preview read without DEV (a global opens production)', async () => armG({ ...CS, previewUnreleased: () => globalThis.DXM_PREVIEW_UNRELEASED === true }, lists(files[wall]), MFE)],
      ['India\'s rows un-withheld', async () => armG({ ...CS, rowsWithheld: () => false }, lists(files[wall]), MFE)],
      ['the India tab shown without the preview flag', async () => armG(CS, lists(files[wall]), MFE.replace('...(import.meta.env && import.meta.env.DEV && globalThis.DXM_PREVIEW_UNRELEASED === true && previewOptedIn() ? [INDIA_PANE] : []),', 'INDIA_PANE,'))],
      ['the India tab shown on the pilot by dev mode alone', async () => armG(CS, lists(files[wall]), MFE.replace(' && previewOptedIn() ? [INDIA_PANE]', ' ? [INDIA_PANE]'))],
      ['the wall prints the list of a country whose rows are withheld', async () => armG(CS, lists(files[wall].replace('rowsWithheld(c) ? withheld() : ', '')))],
      ['the library type prints withheld rows', () => armH(TYPE.replace('rowsWithheld(c) ? ', 'false ? '))],
      ['the library type shows a withheld poster', () => armH(TYPE.replace('posterWithheld(c) ||', 'false ||'))],
      ['a helper that mutates the shared ADM1', () => armC({ ...H, stateGeometry: (z, a, n) => { (a.features || []).forEach((f) => { if (f.properties.shapeName === n) f.properties.listId = z.id }); return H.stateGeometry(z, a, n) } }, states, JSON.parse(JSON.stringify(adm1Ind)))],
    ]
    let bad = 0
    if (!regIsCaller) console.log('n/a       the Regions list resolves [] for a phone-blocked card (the list delegates to <dxm-poster-section>; its withholding is arm H, the library type)')
    for (const [name, run] of cases) {
      const f = await run()
      console.log(`${f.length ? '✓ caught' : '✗ MISSED'}  ${name}${f.length ? ` -> ${f[0]}` : ''}`)
      if (!f.length) bad++
    }
    // The negative control: a comment naming the forbidden call must NOT fail.
    const commented = armA({ ...files, [wall]: files[wall].replace('<script setup>', '<script setup>\n// generateCountrySheet(x) is not called here') })
    console.log(`${commented.length ? '✗ FALSE RED' : '✓ ignored'}  a comment naming generateCountrySheet`)
    if (commented.length) bad++
    process.exitCode = bad ? 1 : 0
    return
  }

  const callers = []
  const E = armE(countries, states, files['plugin-designs/country-posters/country-poster-wall.vue'], readFileSync(join(ROOT, 'library/components/poster/PosterWall.vue'), 'utf8'), H)
  const G = [...await armG(CS, lists(files['plugin-designs/country-posters/country-poster-wall.vue']), MFE), ...armH(TYPE)]
  const fails = [...armA(files, callers), ...armB(seriesFor, countries, sheetFormatFor), ...armC(H, states, adm1Ind), ...G, ...E.fails, ...armD(states, areas, meta), ...armF(lists(files['plugin-designs/country-posters/country-poster-wall.vue']))]
  const missing = [...KNOWN_CALLERS, `${STATE_CALLER}#state`].filter((k) => !callers.includes(k))
  if (missing.length) fails.push(`known callers not found calling makeCountrySheet: ${missing.join(', ')}`)
  if (fails.length) { fails.forEach((f) => console.log(`FAIL ${f}`)); process.exitCode = 1; return }
  const ind = seriesFor(countries, countries.find((c) => c.iso3 === 'IND'))
  console.log(`PASS check:country-sheet-one-path — ${Object.keys(files).length} plugin sources parsed-or-skipped, makeCountrySheet callers: ${callers.join(', ')}; seriesFor over ${countries.length} countries (India ${ind.index} of ${ind.totalLists}); ${H.statesWithPosters(states).length} state posters, series 1..${H.statesWithPosters(states).length}, every outline found; sections ${E.order.slice(0, 3).map(([g, t]) => `${g} ${t}`).join(' > ')}; state names in ${NAME_LOCALES.length} locales x ${states.length}`)
}

main().catch((e) => { console.error(`FAIL ${e.stack || e}`); process.exitCode = 1 })
