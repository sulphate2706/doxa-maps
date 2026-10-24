#!/usr/bin/env bun
/**
 * check-poster-browser-equiv — a map sheet GENERATED IN THE BROWSER is byte-identical to the one the Node
 * generator writes, given the same records.
 *
 * WHY. The print standard generates sheets at the click with the SAME drawing code the Node script runs
 * (library/packet/poster-render.js). What can still drift is the FEED: the boundaries fetched from the
 * served tree, the zone/pin assignment, the name table, the series facts, the date. A difference there
 * prints a different poster depending on where it was made, and nothing else would notice.
 *
 * ★ IT CALLS WHAT THE BROWSER CALLS. The first version rebuilt the feed itself and so could not see a
 * defect in the real entry points: generateCountrySheet passed no province boundaries, and a country
 * beside India or China printed without them — while this gate, feeding them by hand, stayed green. So:
 *   · a UPG-100 zone through makeZoneSheet (data/zone-sheet-print.js), the packet's page 1 (the full letter poster), an India
 *     zone so the ADM1 path runs;
 *   · a country through generateCountrySheet, NEPAL, which sits between India and China;
 * both fetching the served boundaries exactly as the page does (file:// here, the asset URL there).
 *
 * Node side: the target file is deleted first (a stale sheet from an earlier run is never compared), and
 * the generator runs with a CLEAN environment (only what this check sets). If the offline records cache
 * is absent the check cannot run: NOT MEASURED (75). If it is present and the Node generator fails or
 * writes nothing, that is a FAILURE — a broken driver must not read as "not measured".
 */
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const REPO = new URL('..', import.meta.url).pathname
const P = join(REPO, 'library/scripts/posters')
const CACHE = join(P, 'out/_records.json')
// ★ A COMMITTED FIXTURE SO THIS GATE CAN MEASURE ON A FRESH CHECKOUT. out/_records.json is
// gitignored (library/scripts/*/out/**) and is written only by `generate.mjs` against a live API,
// so on CI and on any box without credentials this gate exited 75 EVERY run — chained in gates:pre
// and inert. The runner reported that honestly as NOT MEASURED rather than as a pass, but an
// identical ⊘ every run is indistinguishable from an unwired gate.
// AN EQUIVALENCE CHECK NEEDS THE SAME INPUT ON BOTH SIDES, NOT FRESH INPUT, so a fixed fixture
// loses nothing it was measuring. The fixture is the 124 PUBLIC records the two arms actually
// consume — Nepal's 34 (the country arm) and the 90 slugs the Gujarat zone selects (the zone arm) —
// carrying the same fields the served maps show.
// VERIFIED against the full 2,106-record cache: identical zone pins IN THE SAME ORDER, identical
// Nepal set, count 90, pop 3,164,770, series {2209, 28, 1}. Record ORDER is load-bearing (it drives
// draw and label order), so the fixture keeps the cache's order and is deliberately not sorted.
// NAMED equiv-*, NOT records-*: internal/build-packet-fixtures.mjs walks this directory for
// /^records-.*\.json$/ and builds EVERY match as a packet against one fixed zone (Tibet), so that
// shape is the only variable. A records-* file with no Tibet groups therefore fails that build by
// construction — which is exactly what this fixture did until it was renamed. Two different kinds
// of fixture share one directory; the prefix is what keeps them apart.
const FIXTURE = join(P, 'fixtures/equiv-records-npl-ind.json')
const SOURCE = existsSync(CACHE) ? CACHE : FIXTURE
const ASSETS = join(REPO, 'public/dx-maps/assets')
const DATE = '2026-09-29'
// ★ THIS GATE WRITES NOTHING SHARED. generate.mjs's default out/ is gitignored but SHARED, and
// check:zone-census counts the sheets in out/posters/ to decide whether every selectable zone has
// one. Running the generator here for a byte comparison left asia-india-gujarat.packet.html and
// country-npl.html behind, and zone-census read those two as a half-finished poster build: it went
// from NOT MEASURED to FAIL, naming 28 zones with no poster. A checker must not change what the
// next checker measures, so the generator is pointed at a private temp dir that is removed below.
const WORK = mkdtempSync(join(tmpdir(), 'equiv-'))
// Registered on 'exit' rather than written at the end: this gate exits 1 on a mismatch and 75 on a
// missing precondition, so a trailing cleanup line would be skipped on exactly the runs that ran the
// generator. 'exit' fires for all of them, and for a throw.
process.on('exit', () => { try { rmSync(WORK, { recursive: true, force: true }) } catch { /* best effort */ } })
if (!existsSync(SOURCE)) {
  console.log('POSTER-BROWSER-EQUIV: NOT MEASURED (exit 75) — no records to measure with: neither the offline cache')
  console.log('  (library/scripts/posters/out/_records.json) nor the committed fixture (library/scripts/posters/fixtures/).')
  process.exit(75)
}
if (!existsSync(join(ASSETS, 'boundaries/world-adm0.geojson'))) {
  console.log('POSTER-BROWSER-EQUIV: NOT MEASURED (exit 75) — the served boundaries are not in the tree (public/dx-maps/assets/boundaries); build the tree first.')
  process.exit(75)
}

let failed = false
// ★ THE SERVED GENERATOR IS THE SOURCE. Browsers import the copy at <assets>/lib/poster-render.js (the tree
// serves it, so no bundle carries it); Node runs library/packet/poster-render.js. If they differ, "the same
// generator" is no longer true and the byte comparison below would be between two programs.
{
  const served = join(ASSETS, 'lib/poster-render.js')
  const same = existsSync(served) && readFileSync(served, 'utf8') === readFileSync(join(REPO, 'library/packet/poster-render.js'), 'utf8')
  console.log(`  ${same ? 'ok ' : '✗  '} the served generator (assets/lib/poster-render.js) is byte-identical to its source`)
  if (!same) failed = true
}
function nodeSheet(env, file) {
  const out = join(WORK, 'posters', file)
  rmSync(out, { force: true })
  const r = spawnSync('node', ['generate.mjs'], { cwd: P, encoding: 'utf8', timeout: 240000,
    // RECORDS_FILE is SOURCE, the very file the browser arm read. Feeding the two sides from the
    // same records is what makes this an equivalence check rather than two independent renders —
    // and it is what lets the Node side run at all without a live API having written the cache.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, OFFLINE: '1', VITE_API_BASE_URL: 'http://offline.invalid', POSTER_DATE: DATE, RECORDS_FILE: SOURCE, OUT_DIR: WORK, ...env } })
  if (r.status !== 0 || !existsSync(out)) {
    console.log(`  ✗  the Node generator did not write ${file} (exit ${r.status})\n${(r.stderr || r.stdout || '').slice(-400)}`)
    failed = true
    return null
  }
  return readFileSync(out, 'utf8')
}
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const records = json(SOURCE)
// SAY WHICH INPUT WAS MEASURED. The full cache widens coverage to all 175 countries where it
// exists; the fixture is the floor that makes the gate mean something everywhere else. A reader
// comparing two runs has to know which one produced the numbers below.
console.log(`POSTER-BROWSER-EQUIV: measuring with ${SOURCE === CACHE ? 'the offline cache out/_records.json' : 'the committed fixture fixtures/equiv-records-npl-ind.json'} — ${records.length} record(s).`)
const assetsBase = pathToFileURL(ASSETS).href
const results = []

{ // a UPG-100 zone, through the helper every UPG-100 surface prints with
  const { makeZoneSheet } = await import(join(REPO, 'plugin-designs/my-upg-100-list/data/zone-sheet-print.js'))
  const zoneSheet = makeZoneSheet({ allRecords: async () => records, assetsBase: () => assetsBase, profileConfig: null, date: DATE })
  const id = 'asia-india-gujarat'
  // The UPG-100 packet's page 1 is the FULL letter poster (zone-sheet-print answers 'packet' with it), so the
  // Node side is the letter format without SPARSE.
  results.push({ what: `${id} (packet page 1 = the full letter poster, makeZoneSheet)`, browser: await zoneSheet({ id }, 'packet'), node: nodeSheet({ FORMAT: 'letter', ONLY: id }, `${id}.letter.html`) })
}
{ // a country, through the function the country wall calls — Nepal, between India and China
  const { generateCountrySheet } = await import(join(REPO, 'library/packet/posterSheets.js'))
  const { ISO3_NAME } = await import(join(REPO, 'library/data/iso3-name.js'))
  const tier = json(join(REPO, 'library/data/country-posters.json')).countries.filter((c) => c.sheet === '3x3')
  const c = tier.find((x) => x.id === 'country-npl')
  const recs = records.filter((r) => String(r.country_code).toUpperCase() === c.iso3)
  const series = { totalGroups: tier.reduce((a, x) => a + (x.count || 0), 0), totalLists: tier.length, index: tier.indexOf(c) + 1 }
  results.push({ what: `${c.id} (3x3 poster, generateCountrySheet)`,
    browser: await generateCountrySheet({ country: c, records: recs, assetsBase, ISO3_NAME, format: '3x3', series, date: DATE }),
    // SPARSE on the Node side because a POSTER is generated with SPARSE=1 -- that is how the `posters`
    // script builds every stored thumbnail, and how the browser now draws a poster at the click. This
    // gate used to compare the dense layout with the dense layout, so it passed while every stored
    // thumbnail showed the SPARSE header and every print showed the dense one: a check that agreed
    // with itself and with nothing a reader saw. The packet case above stays dense on both sides,
    // because packet pages are built without SPARSE.
    node: nodeSheet({ COUNTRIES: '1', FORMAT: '3x3', SHEET: '3x3', SPARSE: '1', ONLY: c.id }, `${c.id}.html`) })
}

for (const r of results) {
  if (r.node == null) continue
  const same = r.browser === r.node && r.browser.length > 1000
  if (!same) failed = true
  console.log(`  ${same ? 'ok ' : '✗  '} ${r.what.padEnd(46)} browser ${r.browser.length} bytes · node ${r.node.length} bytes`)
}
if (failed) { console.log('POSTER-BROWSER-EQUIV: FAIL — the browser feed and the Node generator do not draw the same sheet'); process.exit(1) }
console.log('POSTER-BROWSER-EQUIV: PASS — the sheets the browser generates (makeZoneSheet, generateCountrySheet) are byte-identical to the Node generator\'s')
