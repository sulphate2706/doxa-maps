#!/usr/bin/env node
/**
 * check-legend-top-offset — the legend only reserves room for a toolbar that is actually drawn.
 *
 * THE DEFECT (2026-09-28): on Simple Research's Regions and Languages tabs under MapLibre, the
 * search bar is gone but the legend does not rise into the vacated space. The other tabs are fine.
 *
 * ★ THE TWO-TAB SPLIT WAS A PREDICATE, NOT A COINCIDENCE. With no geocoder the legend rises to 14px
 * unless showsFlyTools() is true, and that returns true for exactly 'doxa-regions', 'language-family'
 * and 'language-families' — the two reported tabs. It stops at 56px to avoid a MEASURED collision on
 * country-posters, where LegendTools renders at top:14px, the legend's own slot.
 *
 * ★ BUT showsFlyTools() DESCRIBES THE LEGEND TYPE, NOT WHETHER THE TOOLBAR EXISTS. Fly + Clusters are
 * leaf-only: the composite — which is what a reader calls "Simple Research" — passes legendTools:false,
 * so the toolbar is never drawn there and the 56px reserved a slot for nothing. A browser check measured it at
 * 1440x900 on main e1d0bc20: the band from the map's top edge (y 44) to the legend card (y 100) is 56px
 * of empty map on both tabs, no toolbar anywhere in the strip.
 *
 * So the offset must be keyed on the toolbar's PRESENCE. Keying it on the tab name would have fixed the
 * two reported tabs and reintroduced the country-posters collision the moment the tools were shown.
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'LEGEND-TOP-OFFSET'
const fails = []
const src = readFileSync(join(ROOT, 'plugin-designs/doxa-research-map/research-map.vue'), 'utf8')

const m = src.match(/const legendTopVar = computed\(\(\) => \{[\s\S]*?\n\}\)/)
if (!m) {
  fails.push('legendTopVar was renamed or restructured — this gate cannot find it and would pass blind.')
} else {
  const body = m[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (!/showsFlyTools\s*\(/.test(body)) {
    fails.push('legendTopVar no longer asks whether the legend TYPE allows fly tools, so raising the '
      + 'legend would print the toolbar across its header on the profiles that DO draw it '
      + '(the measured country-posters collision).')
  }
  if (!/showLegendTools/.test(body)) {
    fails.push('legendTopVar does not consult showLegendTools, so it reserves space for a toolbar that\n'
      + '      may never be drawn. That is the reported dead band on the Regions and Languages\n'
      + '      tabs: the composite passes legendTools:false and the 56px held a slot for nothing.\n'
      + '      Key the offset on the toolbar\'s PRESENCE, not on the legend type alone.')
  }
}
// The declaration must precede the reader: a lazy computed would resolve anyway, but this file has a
// TDZ history and check:setup-order exists because of it.
const iDecl = src.indexOf('const showLegendTools')
const iUse = src.indexOf('const legendTopVar')
if (iDecl > -1 && iUse > -1 && iDecl > iUse) {
  fails.push('showLegendTools is declared BELOW legendTopVar, which reads it.')
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — the legend's top offset is keyed on whether the toolbar is actually rendered, not on `
  + 'the legend type alone, so the dead band closes without reintroducing the measured collision.')
