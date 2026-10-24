#!/usr/bin/env node
/**
 * check-legend-logical-insets.mjs — the legend components position themselves with LOGICAL insets.
 *
 * WHY: the shared legend (.stl-panel, its reopen button, the detail buttons, the tree-guide hairlines) used
 * `left: 8px`. MapToolbar uses `inset-inline-end`, which mirrors under dir="rtl"; a physical `left` does not.
 * So in Arabic the controls moved left onto a legend that stayed left, on three production maps at once
 * (Simple Research, Prayer Progress, UPG-100; a browser survey at 52eeb0db). The fix is inset-inline-start /
 * inset-inline-end; this gate keeps a physical left/right from coming back.
 *
 * WHAT IT READS: every CSS declaration in library/components/legends/*.vue (comments stripped). A
 * declaration `left:` / `right:` / `padding-left|right:` / `margin-left|right:` fails unless it is:
 *   - a centring or full-width rule, which is symmetric under RTL (`left:50%`, `left:0` beside `right:0`);
 *   - a reset to auto (`left:auto`), which undoes rather than places;
 *   - listed in ALLOWED below with the reason it may stay physical.
 * Inline :style bindings computed in JS (the progress bar's popover) are not CSS declarations and are not read.
 *
 * --self-test poisons a copy of one rule and asserts the gate notices: a gate that cannot fail proves nothing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// ★ THE SHARED CHROME, NOT ONLY THE LEGENDS. This check began as a legends check, and that scope is
// exactly why three physical declarations survived in ShareButton — the share menu is chrome every
// production map renders, but it lives one directory away and was never read. A reader in Arabic
// does not know which folder a control came from. Audited 2026-09-29: ShareButton had padding-left
// on the step list and margin-right on both the tab spacing and the auto-spacer, so under `ar` the
// gap fell on the wrong side of every share tab.
const DIRS = [
  join(ROOT, 'library/components/legends'),
  join(ROOT, 'library/components/map-controls'),
]
// Files are addressed as "<dir-name>/<file>" so two directories cannot collide on a base name and so
// the ALLOWED keys below stay unambiguous.
const shortOf = (dir, f) => `${dir.split('/').pop()}/${f}`

// file -> substrings of declarations that may stay physical, each with its reason.
const ALLOWED = {
  'legends/LegendMobile.vue': [
    ['.mapboxgl-ctrl-attrib.mapboxgl-compact{margin-right', "the engine's own attribution control, which the engine places"],
  ],
  'legends/LegendProgressBar.vue': [
    ['.lpb-pop{', 'the popover is placed by JS (popLeft) over the bar segment it describes'],
  ],
}

const PHYSICAL = /(^|[;{\s])((?:padding|margin)-(?:left|right)|left|right)\s*:\s*([^;}]+)/g

function findings(file, src) {
  const out = []
  // ★ THE BACKTICK ARM USED TO MISS MOST OF A BIG SHADOW-CSS LITERAL, AND THAT IS HOW THREE PHYSICAL
  // DECLARATIONS HID IN ShareButton. `([^`]*\{[^`]*\}[^`]*)` matches a literal containing ONE brace
  // pair; a 600-line useShadowStyles(`…`) block has hundreds, so the scan captured 7 fragments
  // totalling 7,003 chars of a 629-line file and never saw .share-tab's margin-right at all. The
  // gate then reported PASS on a directory it was barely reading — the worst kind of green.
  // A <style> block is still matched as before; a template literal is now taken WHOLE, from its
  // opening backtick to its closing one, and only kept when it actually looks like CSS.
  const styles = []
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) styles.push(m[1])
  for (const m of src.matchAll(/`([\s\S]*?)`/g)) {
    const body = m[1]
    if (/\{[\s\S]*:[\s\S]*\}/.test(body)) styles.push(body)
  }
  const allowed = ALLOWED[file] || []
  for (const css of styles) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of clean.split('}')) {
      const [sel = '', body = ''] = rule.split('{')
      const decl = sel.trim() + '{' + body
      for (const m of body.matchAll(PHYSICAL)) {
        const prop = m[2], val = m[3].trim().replace(/!important$/, '').trim()
        if (val === 'auto') continue
        if ((prop === 'left' || prop === 'right') && /^50%$/.test(val)) continue
        if (prop === 'left' && val === '0' && /right\s*:\s*0\b/.test(body)) continue
        if (prop === 'right' && val === '0' && /left\s*:\s*0\b/.test(body)) continue
        if (allowed.some(([s]) => decl.replace(/\s+/g, '').includes(s.replace(/\s+/g, '')))) continue
        out.push(`${file}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 70)} { ${prop}: ${val} }`)
      }
    }
  }
  return out
}

function eachFile() {
  const out = []
  for (const dir of DIRS) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.vue')).sort()) out.push([dir, f])
  }
  return out
}

function run(read) {
  const all = []
  for (const [dir, f] of eachFile()) all.push(...findings(shortOf(dir, f), read(dir, f)))
  return all
}

const readReal = (dir, f) => readFileSync(join(dir, f), 'utf8')

if (process.argv.includes('--self-test')) {
  const poisoned = (dir, f) => {
    const s = readReal(dir, f)
    if (f === 'SemanticTreeLegend.vue') return s.replace('inset-inline-start: 8px; top: var(--stl-top', 'left: 8px; top: var(--stl-top')
    // ★ POISON THE NEW DIRECTORY TOO. The legends arm alone would still pass with map-controls
    // unscanned, so a self-test that only poisons a legend proves the check works on the half it
    // always covered. This one puts back the exact declaration the 2026-09-29 audit found live in
    // the share menu — if the widened scan ever silently narrows again, this fails.
    if (f === 'ShareButton.vue') return s.replace('margin-inline-end:20px;', 'margin-right:20px;')
    return s
  }
  const hit = run(poisoned)
  const legendCaught = hit.some((h) => h.includes('.stl-panel') && h.includes('left: 8px'))
  const controlCaught = hit.some((h) => h.includes('ShareButton.vue') && h.includes('margin-right'))
  if (!legendCaught) {
    console.error('LEGEND-LOGICAL-INSETS self-test: FAIL — a poisoned `.stl-panel { left: 8px }` was not caught')
    process.exit(1)
  }
  if (!controlCaught) {
    console.error('LEGEND-LOGICAL-INSETS self-test: FAIL — a poisoned `margin-right:20px` in ShareButton was not caught.\n' +
      '  That means map-controls/ is not being scanned, which is the exact gap that let three physical\n' +
      '  declarations live in the share menu until 2026-09-29.')
    process.exit(1)
  }
  console.log('LEGEND-LOGICAL-INSETS self-test: PASS — a physical inset is caught in BOTH scanned directories (legends and map-controls)')
  process.exit(0)
}

const bad = run(readReal)
if (bad.length) {
  console.error(`LEGEND-LOGICAL-INSETS: FAIL — ${bad.length} physical left/right declaration(s) in the legend components:`)
  for (const b of bad) console.error('  ✗ ' + b)
  console.error('\n  A physical inset does not mirror under dir="rtl" while the map controls (inset-inline-end) do,')
  console.error('  so in Arabic they overlap. Use inset-inline-start / inset-inline-end (padding-/margin-inline-*),')
  console.error('  or add the rule to ALLOWED in this file with the reason it must stay physical.')
  process.exit(1)
}
console.log('LEGEND-LOGICAL-INSETS: PASS — every legend inset is logical, symmetric, or allowed with a reason.')
