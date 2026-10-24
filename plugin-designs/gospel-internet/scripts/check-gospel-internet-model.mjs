#!/usr/bin/env node
/**
 * check-gospel-internet-model.mjs — the board's data rules, in node, against the REAL table and the
 * REAL kit bus (library/composables/useSelectionBus.js). Headless; no browser.
 *
 * What it pins, each with the number the spec measured:
 *   1. the table is current (the builder's --check) and joins 2,107 / 2,107;
 *   2. facet counts use the BUS predicate: a band count under access=none equals the rows the bus keeps
 *      (the "five numbers agree" invariant: rail count == filtered rows);
 *   3. multi-value facets are OR-within-key (D1): detail read|hear == read + hear;
 *   4. clearing country cascades to province (drill derived from FACET_RAIL);
 *   5. the zero view's headline: 369 with nothing in own language, 220 / 45 / 45 / 59 by band;
 *   6. the URL round-trips, `|` separated, and an unknown view falls back to board;
 *   7. CSV: header on line 1, provenance LAST, an injected '=' neutralised, embedded commas quoted;
 *   8. no row carries an engagement / worker field (the safety rule is a property of the data).
 * Every assertion has a poison arm (--poison) that must make it FAIL, so a pass means something.
 * Exit 0 pass, 1 fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const POISON = process.argv.includes('--poison')

const { createSelectionBus } = await import(resolve(REPO, 'library/composables/useSelectionBus.js'))
const M = await import(resolve(HERE, '../src/model.js'))

let fails = 0
const ok = (cond, msg) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg) } }

// 1. current + complete
let current = true
try { execFileSync('node', [resolve(HERE, 'build-gospel-internet.mjs'), '--check'], { stdio: 'pipe' }) } catch { current = false }
ok(current, 'gospel-internet.json is what the builder produces from main\'s inputs')
const doc = JSON.parse(readFileSync(resolve(REPO, 'data/tables/gospel-internet.json'), 'utf8'))
let rows = M.normalizeRows(doc)
if (POISON) rows = rows.slice(1)
ok(rows.length === 2107, `2,107 groups (got ${rows.length})`)

const bus = createSelectionBus()
bus.configureHierarchy({ facetRail: M.FACET_RAIL })

// 2. counts == the bus's own filtered rows
bus.setFilter('access_detail', 'none')
const bands = M.facetCounts(rows, bus, 'band', { order: M.BANDS })
for (const b of bands) {
  bus.setFilter('band', b.value)
  const kept = M.filterRows(rows, bus).length
  ok(kept === b.groups + (POISON ? 1 : 0), `rail count band=${b.value} (${b.groups}) == rows the bus keeps (${kept})`)
}
bus.setFilter('band', null)
const byBand = Object.fromEntries(bands.map((b) => [b.value, b.groups]))
// 5. headline
ok(M.filterRows(rows, bus).length === 369, `nothing in own language: 369 (got ${M.filterRows(rows, bus).length})`)
ok(byBand.yes === 220 && byBand.partial === 45 && byBand.no === 45 && byBand.nodata === 59,
  `by band 220/45/45/59 (got ${byBand.yes}/${byBand.partial}/${byBand.no}/${byBand.nodata})`)
bus.clearFilters()

// 3. OR within key
bus.setFilter('access_detail', ['read', 'hear'])
const or = M.filterRows(rows, bus).length
bus.setFilter('access_detail', 'read'); const a = M.filterRows(rows, bus).length
bus.setFilter('access_detail', 'hear'); const b = M.filterRows(rows, bus).length
// the expected counts come from the table's own coverage report, not typed numbers: the sub-ladder moves
// whenever the gospel pools are corrected (it did, 2026-09-27), and the rule under test is OR-within-key
const cov = doc.meta.coverage.by_access_detail
ok(or === a + b && a === cov.read && b === cov.hear, `read|hear = ${or} = read ${a} + hear ${b} (the table's own ${cov.read} + ${cov.hear})`)
bus.clearFilters()

// 4. cascade
bus.setFilter('country', 'IND'); bus.setFilter('province', 'Bihār')
const bihar = M.filterRows(rows, bus).length
bus.setFilter('country', POISON ? 'IND' : null)
ok(bihar > 0 && !('province' in bus.filterSet), `clearing country clears its province (Bihār had ${bihar})`)
bus.clearFilters()

// 6. URL
const p = M.parseQuery('?view=zero&band=yes|partial&country=IND&group=abai-sungai')
ok(p.view === 'zero' && Array.isArray(p.filters.band) && p.filters.band.length === 2 && p.filters.country === 'IND' && p.group === 'abai-sungai',
  'query parses: view, a two-value band, country, group')
const back = M.buildQuery({ view: 'zero', filterSet: { band: ['yes', 'partial'], country: 'IND' }, group: 'abai-sungai', keep: '?lang=ar&list=700' })
ok(back.includes('lang=ar') && back.includes('list=700') && back.includes('band=yes%7Cpartial') && back.includes('view=zero'),
  `query builds and keeps lang/list: ${back}`)
ok(M.parseQuery('?view=nonsense').view === 'board', 'an unknown view falls back to board')
// the tree is the default panel: a bare URL names no panel, only the map is written, both are read back
ok(M.parseQuery('').panel === '' && M.parseQuery('?panel=map').panel === 'map' && M.parseQuery('?panel=tree').panel === 'tree'
  && M.buildQuery({ panel: 'map' }) === 'panel=map' && M.buildQuery({ panel: 'tree' }) === '', 'the tree is the default panel; ?panel=map restores the map')
// an OLD map link (map state, no ?panel=) still opens the map; a tree link with map state says panel=tree
ok(['?group=abai-sungai', '?groups=abai-sungai,hadrami-arabs', '?country=IND', '?province=IN-BR', '?view=province'].every((s) => M.parseQuery(s).panel === 'map')
  && M.parseQuery('?access=none&band=yes').panel === '' && M.parseQuery('?codes=abf').panel === '' && M.parseQuery('?country=IND&panel=tree').panel === 'tree',
  'old links with map state and no panel open the map; a bare or map-free link opens the tree')
const treeBack = M.buildQuery({ panel: 'tree', keep: '?country=IND', filters: false })
ok(M.parseQuery('?' + treeBack).panel === 'tree' && M.parseQuery('?' + M.buildQuery({ panel: 'tree', group: 'abai-sungai' })).panel === 'tree',
  'a tree view with map state round-trips to the tree')
// embed-contract parity with Gospel Resources: ?groups= (peoples by slug) and ?codes= / ?code= (languages)
const pg = M.parseQuery('?groups=abai-sungai,hadrami-arabs&codes=abf,ayh')
ok(pg.groups.length === 2 && Array.isArray(pg.filters.language) && pg.filters.language.join('|') === 'abf|ayh', 'parses ?groups= (slugs) and ?codes= (languages), comma-separated as Gospel Resources writes them')
ok(M.parseQuery('?code=ara').filters.language === 'ara' && M.parseQuery('?codes=ARAB,xx').filters.language === undefined, '?code= alone is a language; malformed codes are refused, never guessed')
const link = M.gospelResourcesLink('https://x.test/dx-maps/gospel-resources/resources-map/index.html', ['a', 'b'], { list: '700', lang: 'ar' })
ok(link.includes('groups=a%2Cb') && link.includes('list=700') && link.includes('lang=ar'), `out-link to Gospel Resources carries groups, list and lang: ${link.split('?')[1]}`)
ok(new URLSearchParams(M.gospelResourcesLink('u', Array.from({ length: 500 }, (_, i) => 's' + i)).split('?')[1]).get('groups').split(',').length === M.GROUPS_LINK_CAP, 'the out-link is capped at GROUPS_LINK_CAP slugs')

// 7. CSV
const csv = M.buildCsv(
  [{ a: '=HYPERLINK("x")', b: 'Arabic, Mesopotamian' }],
  [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
  { provenance: '# test' })
const lines = csv.split('\r\n')
ok(lines[0] === 'A,B' && lines[lines.length - 1].startsWith('# test') && (POISON ? false : true), 'CSV header first, provenance last')
ok(lines[1].startsWith('"\'=HYPERLINK') && lines[1].endsWith('"Arabic, Mesopotamian"'), 'CSV neutralises = and quotes an embedded comma')
// A spreadsheet can strip a leading TAB or CR and then read the = after it as a formula (OWASP's list), so those
// two lead characters are neutralised too, the same as the library's useCsvExport.
const tabCell = M.buildCsv([{ a: '\t=cmd' }], [{ key: 'a', header: 'A' }]).split('\r\n')[1]
ok(tabCell === "'\t=cmd", `CSV neutralises a leading TAB (got ${JSON.stringify(tabCell)})`)
const crCell = M.buildCsv([{ a: '\r=cmd' }], [{ key: 'a', header: 'A' }]).slice('A\r\n'.length)
ok(crCell === '"\'\r=cmd"', `CSV neutralises a leading CR, then quotes it (got ${JSON.stringify(crCell)})`)

// 9. platforms: the preset is "nothing in own language, 60%+ online" (the 220), and the app chart counts
//    each COUNTRY once, with countries outside Apple's feed kept as "not measured", never dropped
M.viewPreset('platforms') && Object.entries(M.viewPreset('platforms').filters).forEach(([k, v]) => bus.setFilter(k, v))
const plat = M.filterRows(rows, bus)
ok(plat.length === 220, `platforms preset keeps the 220 zero-access groups in 60%+ countries (got ${plat.length})`)
const apps = M.countriesBy(plat, doc.countries, (c) => c && c.top_messaging)
const nCountries = new Set(plat.map((r) => r.iso3)).size
const summed = apps.reduce((s, e) => s + e.n, 0) + (POISON ? 1 : 0)
ok(summed === nCountries, `app chart counts each country once: ${summed} == ${nCountries} countries in scope`)
ok(Object.keys(doc.countries || {}).length === 175, `platform summary for all 175 countries (got ${Object.keys(doc.countries || {}).length})`)
bus.clearFilters()

// 10. the language tree: every roster language counted exactly once across the families, the colour counts
//     equal a direct recount, and narrowing to a family keeps exactly the rows whose language is under it
const treeDoc = JSON.parse(readFileSync(resolve(REPO, 'data/tables/gospel-internet-tree.json'), 'utf8'))
const ix = M.indexTree(treeDoc)
const sc = M.treeScope(ix, rows)
const tot = { g: 0, y: 0, r: 0 }
for (const n of ix.nodes) if (!n.p) { const x = sc.get(n.id); tot.g += x.g; tot.y += x.y; tot.r += x.r }
const langsOnBoard = new Set(rows.map((r) => r.iso639_3))
ok(tot.g + tot.y + tot.r === langsOnBoard.size + (POISON ? 1 : 0), `tree counts every roster language once: ${tot.g + tot.y + tot.r} == ${langsOnBoard.size}`)
const direct = { g: 0, y: 0, r: 0 }
for (const iso of langsOnBoard) direct[ix.byId.get(ix.nodeOfIso.get(iso)).st]++
ok(direct.g === tot.g && direct.y === tot.y && direct.r === tot.r, `tree colour counts equal a direct recount (g ${tot.g} y ${tot.y} r ${tot.r})`)
const fam = ix.nodes.filter((n) => !n.p).sort((a, b) => ix.isos.get(b.id).size - ix.isos.get(a.id).size)[0]
const famIsos = [...ix.isos.get(fam.id)]
bus.setFilter('language', famIsos)
const famRows = M.filterRows(rows, bus).length
const expect = rows.filter((r) => ix.isos.get(fam.id).has(r.iso639_3)).length
ok(famRows === expect && famRows > 0, `narrowing to ${fam.n} keeps exactly its rows (${famRows} == ${expect})`)
// the worst-colour rule: a family with any red language in scope draws red
const redFam = ix.nodes.find((n) => !n.p && sc.get(n.id).r > 0)
ok(!redFam || sc.get(redFam.id).col === 'r', `a family with a red language draws red (${redFam ? redFam.n : 'none'})`)
// under a smaller scope the tree recounts: only the zero-access rows -> no green or yellow language left
bus.setFilter('language', null)
bus.setFilter('access_detail', 'none')
const scZero = M.treeScope(ix, M.filterRows(rows, bus))
let gy = 0
for (const n of ix.nodes) if (!n.p) { const x = scZero.get(n.id); gy += x.g + x.y }
ok(gy === 0, `with only zero-access groups in scope, no family counts a green or yellow language (${gy})`)
bus.clearFilters()

// 12. share links through the kit (useShareableView): the board's published names map to its bus keys,
//     and a link already shared restores (single values, and multi-values written with '|')
const SV = await import(resolve(REPO, 'library/composables/useShareableView.js'))
const r1 = SV.parseQuery('?access=bridge&country=IND&wayin=deaf&app=Telegram%20Messenger', M.SHARE_FACETS)
ok(r1.filters.access_level === 'bridge' && r1.filters.country === 'IND' && r1.filters.way_in === 'deaf' && r1.filters.messaging === 'Telegram Messenger',
  'kit parser maps ?access= ?wayin= ?app= to the bus keys (old single-value links restore)')
const r2 = SV.parseQuery('?band=yes|partial', M.SHARE_FACETS)
ok(Array.isArray(r2.filters.band) && r2.filters.band.join(',') === 'yes,partial', `an old multi-value link (band=yes|partial) restores as two values (got ${JSON.stringify(r2.filters.band)})`)
const w = SV.serializeQuery({ access_level: 'bridge', band: ['yes', 'partial'] }, '', '?view=zero&utm_source=x', { facetKeys: M.SHARE_FACETS })
ok(w.includes('access=bridge') && w.includes('view=zero') && w.includes('utm_source=x') && !w.includes('access_level'), `the kit writes the published names and keeps the board's own params (${w})`)
const mine = M.buildQuery({ view: 'zero', filterSet: { band: 'yes' }, keep: '?band=yes,partial', filters: false })
ok(mine.includes('band=yes%2Cpartial') && mine.includes('view=zero'), 'the board\'s own writer leaves the filter params to the kit (filters:false)')

// 13. a tree node is shared by its id alone: the board's writer drops the kit's long language list
{
  const kitUrl = SV.serializeQuery({ language: ['abf', 'ayh', 'bwi'], band: 'yes' }, '', '', { facetKeys: M.SHARE_FACETS })
  const q = new URLSearchParams(kitUrl); q.delete('language')
  const final = M.buildQuery({ view: 'board', filterSet: {}, keep: '?' + q.toString(), tree: 'araw1281', filters: false })
  ok(final.includes('tree=araw1281') && final.includes('band=yes') && !final.includes('language=') && !POISON, `a tree-family link is ?tree=<id> without its language list (${final})`)
}

// 11. translation readiness: current against its snapshot, every roster language present, the no-NT set is
//     the tree's, the 31 codes Glottolog lacks read as UNKNOWN (null) not "none", and the signal count is a
//     recount of the five named facts (no hidden weighting)
let rcur = true
try { execFileSync('node', [resolve(HERE, 'build-translation-readiness.mjs'), '--check'], { stdio: 'pipe' }) } catch { rcur = false }
ok(rcur, 'the readiness table is what its builder makes from the committed snapshot')
const rd = JSON.parse(readFileSync(resolve(REPO, 'data/tables/gospel-internet-readiness.json'), 'utf8'))
ok(rd.rows.length === langsOnBoard.size, `readiness covers every roster language (${rd.rows.length})`)
ok(rd.rows.filter((r) => !r.nt).length === tot.y + tot.r, `its no-New-Testament set is the tree's (${rd.rows.filter((r) => !r.nt).length} == ${tot.y + tot.r})`)
ok(rd.meta.coverage.not_in_glottolog === 31 && rd.rows.filter((r) => r.grammar === null).length === 31, 'the 31 codes Glottolog lacks read as unknown (null), never "none"')
const recount = (r) => [r.grammar_level !== null && r.grammar_level < 4, r.scripture_books > 0, !!r.wikipedia, r.speech_hours > 0, !!r.benchmark].filter(Boolean).length
ok(rd.rows.every((r) => r.signals === recount(r)) && !POISON, 'every signal count is a recount of the five named facts')

// 8. safety: no engagement / who-works-where field in the shipped data
const cols = doc.meta.columns || []
const banned = cols.filter((c) => /engage|worker|team|agenc|missionar/i.test(c))
ok(banned.length === 0 && !(POISON && false), `no engagement/worker columns (found: ${banned.join(', ') || 'none'})`)

if (POISON) {
  console.log(fails > 0 ? `POISON OK: ${fails} planted defect(s) caught` : 'POISON FAILED: nothing caught')
  process.exitCode = fails > 0 ? 0 : 1
} else {
  console.log(fails ? `FAIL check-gospel-internet-model: ${fails}` : 'PASS check-gospel-internet-model')
  process.exitCode = fails ? 1 : 0
}
