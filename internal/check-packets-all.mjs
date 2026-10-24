#!/usr/bin/env node
// check-packets-all — run check-packet-render over EVERY generated packet.
//
// ★ WHY THIS WRAPPER EXISTS. check-packet-render takes a path, and with no path it
// SKIPs at exit 0 — deliberately, so a build is not failed on a file that may not have
// been generated. The consequence, measured 2026-09-24: the gate was in package.json,
// all 11 locale packets passed it, and it was in NEITHER gates:pre NOR gates:post. It
// only ever ran when a human remembered to type a filename. A gate nobody invokes
// protects nothing — the same "present but unwired" state the two i18n gates were in.
//
// So this sweeps the directory and gates the WHOLE SET. That matters beyond wiring:
// checking one hand-named packet proves one locale. The packet ships in 11, and the
// failures that actually occur are locale-specific — a script font that does not load,
// an RTL document laid out LTR, a translated page header whose word order breaks a
// parser. Those are invisible if the gate is pointed at laos.html and nothing else.
//
// SKIP (exit 0) only when the directory is genuinely absent or empty: packets are
// generated on demand and a clean checkout has none. A skip says so out loud, with the
// count, so "0 packets checked" can never read as "all packets passed".
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
// pathToFileURL, not a bare path: a dynamic import() of an absolute POSIX path works by luck on
// linux and throws ERR_UNSUPPORTED_ESM_URL_SCHEME the moment anyone runs this on windows.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
// Repo-relative, never an author's worktree: this gate lives in two repos and the
// packets are generated in the one that owns the poster scripts.
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const DIR = process.env.PACKET_DIR
  || resolve(REPO, 'library/scripts/posters/out/packets')

if (!existsSync(DIR)) {
  console.log(`PACKETS-ALL: SKIP — no packet directory at ${DIR}`)
  console.log('  Packets are generated on demand (node library/scripts/posters/packet.mjs);')
  console.log('  a clean checkout has none, so this is not a failure.')
  process.exit(0)
}

// ★ A STALE ARTIFACT IS NOT A DEFECT, and grading one as a defect is this gate's own recorded bug
// (BUG-PACKET-SWEEP-GRADED-AN-ACCIDENTAL-SET-OF-GITIGNORED-ARTIFACTS). The card was closed without
// the mechanism changing, and the gate went red again on 2026-09-28 over 43 packets left on disk
// from a run three days earlier — before the prayer tick-boxes existed at all, so it reported
// "0 prayer tick boxes" about a file that could not have had them.
//
// This whole directory is GITIGNORED (.gitignore:94 `library/scripts/*/out/**`), so nothing here
// ever reaches main or another agent: it is one developer's scratch. The gate already knows that an
// EMPTY directory is not a failure ("a clean checkout has none"); a directory of LEFTOVERS is the
// same fact wearing different clothes.
//
// So a packet older than the renderer that produces it is SKIPPED, loudly, rather than failed. The
// renderer's own mtime is the reference because that is what decides the shape a packet should have
// — comparing against "today" would re-fail every morning, and comparing against nothing is what
// produced this bug twice.
const RENDERER = resolve(HERE, '..', 'library/packet/packet-render.js')
const rendererMtime = existsSync(RENDERER) ? statSync(RENDERER).mtimeMs : 0
const all = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()
const stale = all.filter((f) => statSync(join(DIR, f)).mtimeMs < rendererMtime)
const files = all.filter((f) => !stale.includes(f))
if (stale.length) {
  console.log(`PACKETS-ALL: skipping ${stale.length} packet(s) older than the renderer — regenerate`)
  console.log(`  them (ONLY=<id> node library/scripts/posters/packet.mjs) or delete them; this`)
  console.log(`  directory is gitignored scratch, so a leftover is not a defect.`)
}
if (!files.length) {
  console.log(`PACKETS-ALL: SKIP — ${DIR} contains no .html packets newer than the renderer`)
  process.exit(0)
}

// ── HEADLESS PER-ZONE SECTION — runs BEFORE the browser delegation, and independently of it ──
// ★ WHY: the browser half runs only on the browser seat (exit 75 = NOT MEASURED elsewhere), so on
// every other machine this gate proved NOTHING about coverage. Earlier today exactly one zone of 28
// was printable and no gate said so. These assertions need no DOM: coverage is a file listing, the
// map page is markup, and a group count is a substring count. The browser half still owns the
// RENDERED layer; this half owns EXISTENCE, so a broken zone fails everywhere, loudly, by name.
{
  const failures = []
  const report = []
  // 1. COVERAGE: every zone the catalogue defines has a packet. The catalogue is the same
  // clusters.json the plugin ships; where this repo does not carry it (this gate lives in two
  // repos), coverage is skipped rather than guessed.
  const CLUSTERS = resolve(REPO, 'plugin-designs/my-upg-100-list/data/clusters.json')
  if (existsSync(CLUSTERS)) {
    const z = JSON.parse(readFileSync(CLUSTERS, 'utf8'))
    // ★ THE LEGEND'S 28, NOT THE THREE BUCKETS' 27: spreading lists/asia_lists/uncovered_lists drops
    // `deaf`, the one zone the legend shows as a single row, so this never required a Deaf packet.
    const { buildLegendNodes, leafZones } = await import(pathToFileURL(resolve(REPO, 'plugin-designs/my-upg-100-list/data/legend-tree.js')).href)
    const zones = leafZones(buildLegendNodes(z, { records: null })).map((l) => l.id)
    const have = new Set(all.map((f) => f.replace(/\.html$/, '')))
    // ★ COVERAGE IS ASSERTED WHERE ZONES WERE GENERATED. gates:pre's check:packet-offline writes the four
    // fixture-* packets into this directory, so after gates:pre it is never empty, and a tree that had
    // generated no zone failed here on all 28: gates:post was red on every landing, for nothing anyone
    // could fix. Fixtures exercise the renderer, not a zone. One zone packet here and all 28 are required.
    if (!zones.some((id) => have.has(id))) {
      console.log(`PACKETS-ALL (headless): coverage not asserted — no zone packet here, only ${all.length} fixture/variant packet(s)`)
      console.log('  ONLY=<zone> node library/scripts/posters/packet.mjs generates one; then every zone is required.')
    } else for (const id of zones) if (!have.has(id)) failures.push(`zone '${id}' has NO generated packet at all`)
  }
  // 2. PER PACKET: a non-empty map page and N > 0 groups. The map page is the FIRST sheet; without
  // the lifted poster it holds only the kicker/title/subtitle, so "contains an <img or <svg" is the
  // honest markup-level test for "the map is actually there" — the exact failure that made 28 of 28
  // packets print a blank page 1 when the posters directory was missing.
  for (const f of files) {
    const html = readFileSync(join(DIR, f), 'utf8')
    const firstSheet = html.slice(html.indexOf('class="sheet'), html.indexOf('class="sheet', html.indexOf('class="sheet') + 1))
    const hasMap = /<img|<svg/.test(firstSheet)
    // People are profile CARDS in the full packet and worksheet ROWS in the lightweight one.
    const groups = (html.match(/class="card"/g) || []).length + (html.match(/class="ws-row"/g) || []).length
    const sets = /sheet-sets/.test(html)
    // ★ THE TRIANGLE, asserted per zone because it went missing from ALL 28 packets once and
    // nothing failed: funnelPage omits when its data is null, and the builder that supplies that
    // data swallows errors into null. "Every packet lost one page" and "this packet has no data
    // for it" look identical from inside one packet — only the per-zone table tells them apart.
    const funnel = /funnel-title/.test(html)
    const zone = f.replace(/\.html$/, '')
    report.push(`${hasMap && funnel ? '✓' : '✗'} ${zone}  groups=${groups}  map=${hasMap ? 'yes' : 'NO'}  funnel=${funnel ? 'yes' : 'NO'}  sets=${sets ? 'yes' : 'no'}`)
    if (!hasMap) failures.push(`${zone}: page 1 has no map — the lifted poster is missing (bun run posters, then regenerate)`)
    if (!funnel) failures.push(`${zone}: no funnel page — its data builder swallows errors into null, so check the generator run, not just this file`)
    if (!(groups > 0)) failures.push(`${zone}: ZERO group rows — a packet of nobody`)
  }
  console.log(`PACKETS-ALL (headless): ${files.length} packet(s) checked`)
  for (const line of report) console.log('  ' + line)
  if (failures.length) {
    console.error(`PACKETS-ALL (headless): FAIL — ${failures.length} problem(s)`)
    for (const f of failures) console.error('  ✗ ' + f)
    process.exit(1)
  }
}

const gate = join(HERE, 'check-packet-render.mjs')

// ★ THE FUNNEL PAGE IS REQUIRED HERE, and this line is the half of the fix that was missing.
// check-packet-render gained --expect-funnel after a merge deleted the call site supplying the funnel
// data and every gate stayed green (2026-09-26). But a DECLARABLE expectation that
// nothing declares is not a closed hole — it is an invisible defect traded for a visible obligation.
// I said as much to regions and then owed the second half.
//
// ⚠ WHY IT CAN BE UNCONDITIONAL HERE. Every packet in out/ is produced by
// library/scripts/posters/packet.mjs, which always passes FUNNEL to buildPacket. So a packet in this
// directory WITHOUT page 2 was either generated before the funnel existed or generated by a caller
// that dropped the argument — and both are things this sweep should say out loud. Verified
// 2026-09-26 across all 16 packets in out/ (4 fixtures, the ar tibet, and all 11 laos locales
// regenerated): every one has page 2, so this requires a property the pipeline actually holds rather
// than one it aspires to.
// ⚠ ESCAPE HATCH, deliberately awkward to reach: PACKETS_ALL_NO_FUNNEL=1. If a legitimate host ever
// generates funnel-less packets, that is a real state and this flag records it — but it must be a
// decision someone takes, not a default that quietly tolerates a missing page.
const EXPECT_FUNNEL = process.env.PACKETS_ALL_NO_FUNNEL !== '1'
if (!EXPECT_FUNNEL) {
  console.log('PACKETS-ALL: ⚠ PACKETS_ALL_NO_FUNNEL=1 — page 2 is NOT required this run.')
}

// ⚠ THE UNCONDITIONAL ABOVE STOPPED BEING TRUE, and this is the correction. The comment says every
// packet comes from packet.mjs "which always passes FUNNEL" — that held until SERIES landed
// (2026-09-28). A `country` packet DROPS the funnel page deliberately: the funnel narrows every
// people group on earth down to THIS UPG-100 list, which is not a description of a country, and a
// page of true numbers about the wrong thing is worse than no page.
// So the expectation follows the SERIES that produced the packet, read from series.json rather than
// hardcoded here — adding a series with funnel:false must not require editing this gate.
// A packet whose series cannot be determined keeps the old unconditional expectation, because the
// safe default for "I do not know" is the stricter check.
const SERIES_PATH = resolve(HERE, '..', 'library/scripts/posters/series.json')
const SERIES_DEFS = existsSync(SERIES_PATH) ? JSON.parse(readFileSync(SERIES_PATH, 'utf8')) : {}
const NO_FUNNEL_MARKERS = Object.entries(SERIES_DEFS)
  .filter(([id, def]) => !id.startsWith('_') && def && def.funnel === false)
  .flatMap(([, def]) => (def.networks || []).map(([head]) => head).filter(Boolean))
/** True when this packet's own text identifies it as a series that has no funnel page. */
function expectsFunnel(html) {
  if (!NO_FUNNEL_MARKERS.length) return EXPECT_FUNNEL
  return !NO_FUNNEL_MARKERS.some((m) => html.includes(m)) && EXPECT_FUNNEL
}

// EX_TEMPFAIL. The runner's contract (internal/run-parallel.mjs:262): 75 is NOT MEASURED.
const NOT_MEASURED = 75
const failed = []
const unmeasured = []
for (const f of files) {
  const wantFunnel = expectsFunnel(readFileSync(join(DIR, f), 'utf8'))
  const args = wantFunnel ? [gate, join(DIR, f), '--expect-funnel'] : [gate, join(DIR, f)]
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' })
  // ★ THREE OUTCOMES, NOT TWO — and this gate had two. `ok = status === 0` turns exit 75 into a
  // FAIL, which is the exact trap run-parallel.mjs:262 exists to prevent: 75 (EX_TEMPFAIL) means the
  // gate COULD NOT LOOK, which is neither a pass nor a failure.
  // It surfaced the moment the browser guard landed (2026-09-28): check-packet-render now refuses to
  // launch outside the browser slot and exits 75, so this gate reported "5 packets FAILED, 0 passed"
  // about five packets it had never opened. A red build naming five innocent files is worse than an
  // honest "not measured" — someone would have gone looking for a rendering bug that does not exist.
  if (res.status === NOT_MEASURED) {
    unmeasured.push(f)
    console.log(`  ⊘ ${f}  (not measured — needs the browser slot)`)
    continue
  }
  const ok = res.status === 0
  console.log(`  ${ok ? '✓' : '✗'} ${f}`)
  if (!ok) {
    failed.push(f)
    // Print the failing gate's own reasons rather than a generic "it failed" —
    // the detail is what makes a red build actionable.
    const detail = `${res.stdout || ''}${res.stderr || ''}`
      .split('\n').filter((l) => l.trim().startsWith('-') || l.includes('FAIL'))
    for (const line of detail) console.log(`      ${line.trim()}`)
  }
}

// ★ SAY HOW MANY ZONES THIS ACTUALLY COVERED. "every generated packet renders" is true and reads
// like "every packet is fine" — but only the zones someone generated are ever here. MEASURED
// 2026-09-24: 11 packets, ALL of them the SAME zone (laos) in 11 locales, against 28 poster zones
// in out/posters. So the suite proved one zone's layout 11 times and had never rendered the other
// 27, any of which could carry a different data shape (fewer groups, a missing photo, an
// unresolvable map). A silent cap reads as full coverage; naming it is the difference between
// "verified" and "verified what happened to be lying around".
// NOT a failure — generating 28 zones x 11 locales means a network fetch per zone and ~100MB of
// artefacts, which is a deliberate trade, not an oversight. The gate's job here is to stop the
// PASS line from overclaiming.
const zoneOf = (f) => f.replace(/\.html$/, '').replace(/\.[a-z]{2}$/, '')
const zones = [...new Set(files.map(zoneOf))].sort()

// ★ THE DENOMINATOR NOW COMES FROM THE SAME PLACE THE NUMERATOR DOES.
//
// ⚠ IT DID NOT, AND THAT HID A BUG FOR THREE DAYS. This counted out/posters/*.html — POSTER files —
// while the numerator counts PACKET zones. Two different populations, printed either side of the word
// "of". out/posters is also itself GENERATED, so on a clean checkout the denominator was null and the
// shortfall warning silently vanished: the one line whose job was to stop an overclaim could not fire
// precisely when nothing had been rendered at all.
// MEASURED 2026-09-27: posters = 28, packet-able zones = 27, and the missing one was `deaf` — a legend
// row and a poster with NO reachable packet, because packet.mjs's allZones() looped three cluster keys
// and clusters.json carries zones in a fourth (deaf_lists, collapsed by legend-tree.js into one leaf).
// So "2 of 28" was not 26-to-go: it was 25-to-go plus one that could not be generated by any command.
// Fixed in packet.mjs (it now enumerates via leafZones, deaf included); this line stops the two sides
// from ever drifting again by reading the SAME seam rather than a directory listing of a side effect.
let totalZones = null
let zoneIds = null
try {
  const DATA = resolve(REPO, 'plugin-designs/my-upg-100-list/data')
  const clusters = JSON.parse(readFileSync(join(DATA, 'clusters.json'), 'utf8'))
  const { buildLegendNodes, leafZones } = await import(pathToFileURL(join(DATA, 'legend-tree.js')).href)
  zoneIds = leafZones(buildLegendNodes(clusters, { records: null })).map((z) => z.id).sort()
  totalZones = zoneIds.length
} catch (e) {
  // The denominator is a nicety and its absence must not fail the gate — but SAY so, because a
  // silently-absent denominator is exactly how the shortfall warning disappeared before.
  console.log(`  (zone total unavailable: ${e.message})`)
}

const looked = files.length - unmeasured.length
console.log(`\nPACKETS-ALL: ${looked} packet(s) checked, ${looked - failed.length} passed` +
  (unmeasured.length ? ` · ${unmeasured.length} NOT MEASURED (needs the browser slot)` : ''))
// ★ COUNT AND LIST FROM ONE SET, derived the same way. My first version printed
// `totalZones - zones.length` next to a list built by filtering zoneIds, and they disagreed on sight:
// "21 zone(s)" above a list of 26. zones[] holds every FILE stem, which includes things that are not
// zones at all — the four fixture-* packets and the `<zone>.frontier` ?list= variant — so it overcounts
// coverage against a real-zone denominator. Two numbers describing one quantity, computed two ways, is
// how a report contradicts itself in public; the derived list is now the single source and the count
// is just its length.
const covered = (zoneIds || []).filter((z) => zones.includes(z))
const missing = (zoneIds || []).filter((z) => !zones.includes(z))
const extras = zones.filter((z) => zoneIds && !zoneIds.includes(z))
console.log(`  zones covered : ${totalZones ? `${covered.length} of ${totalZones}` : zones.length}`
  + ` — ${(totalZones ? covered : zones).join(', ') || '(none)'}`)
// The fixture and ?list= packets are real coverage of the RENDERER and no coverage at all of a zone's
// data shape. Reported separately rather than folded into the numerator, which is what made the old
// line read "7 of 28" when only 2 real zones had ever been rendered.
if (extras.length) {
  console.log(`  also checked  : ${extras.length} non-zone packet(s) — ${extras.join(', ')}`)
  console.log('    (fixtures and ?list= variants: they exercise the renderer, not a zone\'s data shape)')
}
if (totalZones && missing.length) {
  // ★ NAME THE MISSING ZONES, do not just count them. "26 zone(s) have no packet" tells a reader the
  // size of the hole; it does not tell them what to type, so nobody ever closed it. The list is the
  // actionable form — and it is what surfaced `deaf` as unreachable rather than merely ungenerated.
  console.log(`  ⚠ ${missing.length} zone(s) have NO packet here and were not rendered by`)
  console.log(`    anything: ${missing.join(', ')}`)
  console.log('    Generate all of them (committed fixture, NO network):')
  console.log('      node internal/build-packet-fixtures.mjs   # the fixture zones')
  console.log('      ONLY=<zone> node library/scripts/posters/packet.mjs')
}
if (failed.length) {
  console.error(`PACKETS-ALL: FAIL — ${failed.length} packet(s): ${failed.join(', ')}`)
  process.exit(1)
}
// ⚠ ZERO FAILURES AND ZERO LOOKS ARE THE SAME `failed.length === 0`. Without this, a run that could
// not open a single packet prints "PASS — every generated packet renders", which is the most
// flattering possible lie about a measurement nobody took. Propagate 75 so the runner buckets the
// whole gate NOT MEASURED rather than green.
if (looked === 0 && unmeasured.length) {
  console.log(`PACKETS-ALL: NOT MEASURED — all ${unmeasured.length} packet(s) need the browser slot.`)
  console.log('  Run inside it:  internal/browser-slot.sh bun run check:packets-all')
  process.exit(NOT_MEASURED)
}
console.log(`PACKETS-ALL: PASS — every generated packet renders, across `
  + `${totalZones ? `${covered.length} of ${totalZones}` : zones.length} zone(s) and every locale `
  + `present.${missing.length ? ` This does NOT cover the ${missing.length} zone(s) named above.` : ''}`)
