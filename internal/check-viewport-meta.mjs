#!/usr/bin/env node
/**
 * check-viewport-meta.mjs — every generated page must declare a viewport, because without one
 * EVERY mobile measurement in this repo is silently a desktop measurement.
 *
 * ★ WHY THIS GATE EXISTS, AND WHY IT IS NOT A STYLE RULE. A browser told to use a 390px viewport
 * still lays the page out at the 980px "desktop fallback" unless the document carries
 * <meta name="viewport">. MEASURED here, Chromium, isMobile:true, viewport 390x844:
 *
 *     without the meta:  window.innerWidth = 980   (body 964px)
 *     with the meta:     window.innerWidth = 390   (body 374px)
 *
 * So a page missing the tag does not fail, does not warn, and does not look broken to a probe.
 * It quietly reports desktop numbers under a mobile label. That is the worst shape a defect can
 * take: a green check that measured the wrong thing. It was found the expensive way — a full set
 * of "390" runs against hand-written host pages turned out to be 980px layouts, so the mobile
 * conclusions drawn from them described a viewport no phone has.
 *
 * ★ WHAT THIS GUARDS THAT THE OTHER GATES CANNOT. Three gates read window.innerWidth, but none
 * compares it to the width it asked for, so all three would pass at 980 while claiming 390. The
 * generator currently writes the tag at every call site, which is exactly why this is worth
 * pinning: the tag is correct today, invisible when removed, and expensive to miss.
 *
 * THE CHECK IS ON THE BUILT ARTIFACT, not on the generator source. A template that contains the
 * right string proves nothing about the HTML that shipped — only the shipped file does. No server
 * is needed: this is a property of the bytes on disk.
 *
 * Escape hatch: a page that genuinely must render at a fixed desktop width may carry the comment
 * `viewport-meta-ok:` followed by a reason on the same line.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const ALLOW = /viewport-meta-ok:/

// width=device-width is the part that actually defeats the 980px fallback. A tag that sets only
// initial-scale still lays out at 980, so matching the bare tag name would make this gate
// unfalsifiable against the very bug it guards.
const META_RE = /<meta[^>]+name=["']viewport["'][^>]*>/i
const DEVICE_WIDTH_RE = /content=["'][^"']*width\s*=\s*device-width/i

function htmlFiles(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) htmlFiles(p, out)
    else if (e.endsWith('.html')) out.push(p)
  }
  return out
}

// ★ A FIXED-SIZE PRINT SHEET IS NOT A RESPONSIVE PAGE, and demanding width=device-width of one
// would be wrong rather than merely noisy. MEASURED: the 28 files under assets/posters/ are paper
// canvases — `.stage{width:1500px;height:2000px}` — drawn at an absolute size and then scaled for
// print. They have no mobile layout to get wrong, so they have nothing for this gate to protect.
// Keyed on the STATED property (a fixed-px stage) rather than on the directory name, so a poster
// that moves keeps its exemption and an app page that lands in that folder does not inherit one.
const PRINT_SHEET_RE = /\.stage\s*\{[^}]*\bwidth\s*:\s*\d{3,}px/i

/** @returns {null | {why: string}} null when the page is fine */
export function auditHtml(html) {
  if (ALLOW.test(html)) return null
  if (PRINT_SHEET_RE.test(html)) return null
  const tag = html.match(META_RE)
  if (!tag) return { why: 'no <meta name="viewport"> — lays out at 980px, so every mobile measurement of this page is a desktop measurement' }
  if (!DEVICE_WIDTH_RE.test(tag[0])) return { why: `viewport meta without width=device-width, which does NOT defeat the 980px fallback: ${tag[0].trim()}` }
  return null
}

if (process.env.VIEWPORT_META_SELFTEST === '1') {
  const good = '<head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>'
  const cases = [
    ['missing entirely', '<head><title>x</title></head>', true],
    ['present and correct', good, false],
    ['single quotes + spacing', "<meta name='viewport' content='width = device-width'>", false],
    ['uppercase tag', '<META NAME="VIEWPORT" CONTENT="width=device-width">', false],
    // The mutation that matters: the tag is THERE but useless. A gate matching only the tag name
    // would call this a pass, and the page would still lay out at 980.
    ['initial-scale only (the silent one)', '<meta name="viewport" content="initial-scale=1.0">', true],
    ['escape hatch honoured', '<!-- viewport-meta-ok: fixed-width print sheet --><head></head>', false],
    // The print-sheet exemption must be earned by a fixed-px stage, not by being HTML that
    // happens to mention a stage. Otherwise it becomes a blanket excuse and the gate is theatre.
    ['print sheet exempt', '<style>.stage{width:1500px;height:2000px}</style>', false],
    ['responsive stage NOT exempt', '<style>.stage{width:100%}</style>', true],
  ]
  let bad = 0
  for (const [name, html, shouldFail] of cases) {
    const got = auditHtml(html) !== null
    const ok = got === shouldFail
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} — expected ${shouldFail ? 'fail' : 'pass'}, got ${got ? 'fail' : 'pass'}`)
  }
  console.log(bad ? `SELFTEST: ${bad} case(s) wrong` : `SELFTEST: ${cases.length}/${cases.length} ok`)
  process.exit(bad ? 1 : 0)
}

const files = htmlFiles(PUBLIC)
if (!files.length) {
  console.error('VIEWPORT-META: NOT MEASURED — no .html under public/. Build the tree first (bun run tree).')
  console.error('  Reporting a pass here would mean "I checked nothing", which is the failure this gate exists to prevent.')
  process.exit(2)
}

const bad = []
for (const f of files) {
  const hit = auditHtml(readFileSync(f, 'utf8'))
  if (hit) bad.push([relative(ROOT, f), hit.why])
}

if (bad.length) {
  console.error(`VIEWPORT-META: FAIL — ${bad.length} of ${files.length} generated page(s) would lay out at 980px:\n`)
  for (const [f, why] of bad) console.error(`  ${f}\n      ${why}`)
  console.error('\nEvery "390" or "768" number taken against these pages describes a 980px desktop layout.')
  console.error('Fix the generator call site that writes this page; do not edit the built file.')
  process.exit(1)
}

console.log(`VIEWPORT-META: PASS — ${files.length} generated page(s) all declare width=device-width.`)
