#!/usr/bin/env node
/**
 * check-upg-map-data-painted — the UPG-100 map must have OUR DATA on it, not just a basemap.
 *
 * THE DEFECT THIS CATCHES. Reported 2026-09-24: the map's polygons, its colours and its pins were
 * not showing up. Nothing in the gate suite could answer that. verify-map-paint asserts a live
 * GL context, zero console errors and that Mapbox emitted attribution — every one of which is TRUE
 * of a perfectly-painted basemap carrying none of our zones, polygons or pins. "The map engine
 * booted and tiles are loading" and "my data is on it" are two different properties, and only the
 * first one was ever measured.
 *
 * ★ WHY THIS READS A STATUS STRING INSTEAD OF INSPECTING THE MAP. Both obvious approaches are
 * wrong, and I shipped one of them before measuring:
 *   - COUNTING DOM MARKERS returns 0 on a healthy map. Mapbox draws these pins as GL geometry
 *     inside the canvas; there is no .mapboxgl-marker element to count. I carried "markers: 0"
 *     across three probes as proof of breakage. It was proof of a wrong selector.
 *   - SAMPLING THE CANVAS returns an empty buffer. A WebGL drawing buffer is cleared after
 *     compositing, so drawImage/getImageData see alpha 0 everywhere. Measured: 0 of 13362 sampled
 *     pixels had any alpha at all, on a map visibly full of colour.
 * The profile already computes the exact numbers, at the moment the layers are added, and prints
 * them: upg-100-list.vue:1849 writes `N polys · R/T zones · P pins` into .upg-status. That is the
 * product's own count of what it put on the map — authoritative in a way a proxy cannot be. The
 * loop's standing rule is that a number printed but not asserted on is decoration; these three
 * were printed by the product and asserted on by nothing.
 *
 * ⚠ IT ASSERTS THE ZONE RATIO, NOT JUST PRESENCE. "27/27 zones" and "1/27 zones" both contain
 * polygons, and only one of them is the product. A threshold on the ratio is what separates
 * "some data arrived" from "the data arrived".
 *
 * Usage: node internal/check-upg-map-data-painted.mjs [url ...]
 *   Defaults to the LOCAL tree. Pass live URLs explicitly to audit what is published — the two
 *   diverge, and conflating them cost a whole tick of wrong diagnoses.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BASE = process.env.BASE || `http://127.0.0.1:4173/${TREE_NAME}`
const DEFAULT = [
  'my-upg-100-list/upg-100-list/index.html',
  'my-upg-100-list/upg-100-mfe/index.html',
]
const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT.map((p) => BASE.replace(/\/$/, '') + '/' + p)

// Floors, not exact counts: the dataset grows, and a gate that hardcodes today's totals fails on
// every data refresh and teaches people to edit the expectation rather than read it. These are
// "clearly the real thing" thresholds — measured 2026-09-24 at 195 polys / 27 of 27 zones /
// 2107 pins, so each floor sits far below the real value and far above a broken one.
const MIN_POLYS = 50
const MIN_PINS = 500
const MIN_ZONE_RATIO = 0.9

let reachable = false
try { const r = await fetch(urls[0], { signal: AbortSignal.timeout(5000) }); reachable = r.ok } catch { /* precondition */ }
if (!reachable) {
  // NOT MEASURED, exit 75 — never exit 0. Through browser-slot.sh this line once read
  // "SKIP — nothing served at /tmp/doxa-maps-browser-gate.lock/…" (the slot had overwritten BASE)
  // and EXITED 0, so a wave counted a gate that measured nothing as green.
  console.log(`UPG-MAP-DATA: NOT MEASURED — nothing served at ${urls[0]}.`)
  console.log(`  Serve THIS checkout (internal/serve-strict.mjs on your own port) and pass BASE=http://127.0.0.1:<port>/${TREE_NAME}`)
  process.exit(75)
}

// ★ "ANSWERS 200" AND "IS SERVING THIS BUILD" ARE DIFFERENT QUESTIONS. This gate reads the counter
// the profile writes when it adds its layers — a number that means nothing unless you know WHICH
// build produced it. Pointed at a stale server it would report someone else's polygons as proof
// that this checkout works.
// See _serves-this-tree.mjs (bundler-2, BUG-BROWSER-GATES-CAN-MEASURE-ANOTHER-WORKTREES-TREE):
// :4173 on this box was once held by a different worktree and a gate reported three confident runs
// about code nobody had changed.
// ⚠ NOT MEASURED, exit 75 — the repo's EX_TEMPFAIL for "not measured" (a9550858), which the wave
// runner reports as ⊘. It was exit 2 here, a code nothing else in the repo reads that way.
// This check is also what makes the :4173 default safe: another agent's tree there is refused.
const TREE_BASE = String(urls[0]).split(`/${TREE_NAME}/`)[0]
const treeCheck = await servesThisTree(TREE_BASE, ROOT)
if (!treeCheck.ok) {
  console.error('UPG-MAP-DATA: NOT MEASURED — the server is not serving this checkout.')
  console.error(`  ${treeCheck.why}`)
  console.error('  The polygon and pin counts below would describe someone else\'s build.')
  process.exit(75)
}

const WALK = `(root) => { const o = []; const rec = (r) => { for (const e of r.querySelectorAll('*')) { o.push(e); if (e.shadowRoot) rec(e.shadowRoot) } }; rec(root); return o }`

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })

async function measure(url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const cssWarn = []
  page.on('console', (m) => { if (/missing CSS declarations/i.test(m.text())) cssWarn.push(1) })
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  } catch (e) {
    await page.close()
    return { url, error: String(e.message).slice(0, 80) }
  }
  // The counts are written when the layers land, which is after tiles and after the data fetch.
  await page.waitForTimeout(18000)
  const out = await page.evaluate(`(() => {
    const all = (${WALK})(document)
    const el = all.find((e) => /\\bupg-status\\b/.test((e.className || '').toString()))
    const text = el ? (el.textContent || '').trim() : null
    if (!text) return { text: null }
    // "195 polys · 27/27 zones · 2107 pins"
    const m = text.match(/(\\d+)\\s*polys?\\s*·\\s*(\\d+)\\/(\\d+)\\s*zones?\\s*·\\s*(\\d+)\\s*pins?/i)
    if (!m) return { text }
    return { text, polys: +m[1], zonesResolved: +m[2], zonesTotal: +m[3], pins: +m[4] }
  })()`)
  await page.close()
  return { url, cssWarn: cssWarn.length, ...out }
}

const results = []
try {
  for (const u of urls) results.push(await measure(u))
} finally {
  await browser.close()
}

console.log('UPG-MAP-DATA')
const fails = []
for (const r of results) {
  const name = r.url.split(`/${TREE_NAME}/`)[1] || r.url
  if (r.error) { fails.push(`${name}: navigation failed — ${r.error}`); console.log(`  ${name} — ERROR`); continue }
  if (!r.text) {
    // A MISSING STATUS LINE IS A FAILURE, NOT A SKIP. If the element never rendered its own
    // counter, nothing here can vouch for the map, and silently passing is the false green this
    // gate exists to remove.
    fails.push(`${name}: no .upg-status counter rendered — the element did not reach the point `
      + 'where it reports what it painted')
    console.log(`  ${name} — no status line`)
    continue
  }
  if (r.polys === undefined) {
    fails.push(`${name}: .upg-status reads "${r.text}" — not the expected "N polys · R/T zones · P pins"`)
    console.log(`  ${name} — unparsed: ${r.text}`)
    continue
  }
  const ratio = r.zonesTotal ? r.zonesResolved / r.zonesTotal : 0
  console.log(`  ${name} — ${r.polys} polys · ${r.zonesResolved}/${r.zonesTotal} zones `
    + `· ${r.pins} pins${r.cssWarn ? ' · ⚠ engine CSS warning' : ''}`)
  if (r.polys < MIN_POLYS) fails.push(`${name}: ${r.polys} polygons, expected at least ${MIN_POLYS} — the zone shapes are not on the map`)
  if (r.pins < MIN_PINS) fails.push(`${name}: ${r.pins} pins, expected at least ${MIN_PINS} — the people-group dots are not on the map`)
  if (ratio < MIN_ZONE_RATIO) {
    fails.push(`${name}: only ${r.zonesResolved} of ${r.zonesTotal} zones resolved to geometry `
      + `(${Math.round(ratio * 100)}%) — polygons are present but most zones paint nothing, which `
      + 'looks like a working map with holes in it')
  }
}

if (fails.length) {
  console.error(`\nUPG-MAP-DATA: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  This gate reads the counter the profile itself writes when it adds its layers')
  console.error('  (upg-100-list.vue:1849). A basemap paints perfectly with none of this on it, so')
  console.error('  every other map gate can stay green while the reader sees an empty world.')
  process.exit(1)
}
console.log(`\nUPG-MAP-DATA: PASS — ${results.length} leaf/leaves carry their polygons, zones and pins.`)
