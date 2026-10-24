#!/usr/bin/env node
/**
 * check-map-menu-anchor — a map control menu must always have an anchor, so it can never fall to its
 * static position off the edge of the page.
 *
 * THE DEFECT (2026-09-28, mobile): the share/embed menu opens OFF-SCREEN to the right on Cities
 * with Internet and Gospel Resources, while Simple Research and Prayer Progress are correct.
 *
 * ★ THE SPLIT WAS AN ALLOWLIST, NOT A PLUGIN DIFFERENCE. MapControlMenu resolved its containing area
 * with `closest('.dsm-map-area, .rm-map-area, .dm-map-area, [data-map-area]')` — three hardcoded plugin
 * class names. doxa-simple-map and research-map are on that list; everyone else resolved `|| null`, and
 * place() answers a null area with an EMPTY STYLE, leaving `.mcm{position:absolute}` at its STATIC
 * position: below-and-right of a button already at the top right. The two maps that worked were the two
 * that happened to be named in a string literal in another component.
 *
 * MEASURED: cities-internet, gospel-resources, key-cities and upg-neighbor carry NO map-area class and
 * no data-map-area. Two were reported; the allowlist made it four. A gate that only checked the
 * two reported would have passed the other two.
 *
 * SO THIS ASSERTS THE PROPERTY, NOT THE LIST: whatever a plugin calls its map area, the menu resolves
 * SOMETHING to anchor against. The fallback is the toolbar's own offsetParent — the containing block the
 * menu is absolutely positioned against — which is correct by definition rather than by registration.
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'MAP-MENU-ANCHOR'
const fails = []
const F = join(ROOT, 'library/components/map-controls/MapControlMenu.vue')
const src = readFileSync(F, 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// 1. the area resolution must not be able to produce null from a real toolbar element.
const m = code.match(/host\.value\s*=\s*([^\n]+)/)
if (!m) {
  fails.push('the area resolution moved — this gate cannot find `host.value = …` and would pass blind.')
} else {
  let expr = m[1]
  // The resolution may live in a named function (resolveHost(), shareable pages P3: a standalone Share button
  // re-resolves at open time). Then judge THAT function's body, and fail if it cannot be found.
  const fn = expr.match(/^\s*(\w+)\(\)/)
  if (fn) {
    const body = code.match(new RegExp('function\\s+' + fn[1] + '\\s*\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}'))
    // every return that resolves a named area must carry its structural fallback on the SAME expression
    // a same-line comment is not a fallback: strip `//…` before testing each return
    const rets = body ? [...body[1].matchAll(/return\s+([^\n]*closest\([^\n]*)/g)].map((r) => r[1].replace(/\s*\/\/.*$/, '')) : []
    expr = rets.length && rets.every((r) => /offsetParent|parentElement|document\.body/.test(r)) ? rets.join(' ;; ') : (rets.find((r) => !/offsetParent|parentElement|document\.body/.test(r)) || '')
    if (!body) fails.push(`the area resolution calls ${fn[1]}(), and this gate cannot find that function to read it.`)
    else if (!rets.length) fails.push(`${fn[1]}() returns no named-area resolution, so this gate would pass blind.`)
  }
  if (!/offsetParent|parentElement|document\.body/.test(expr)) {
    fails.push('MapControlMenu resolves its anchor from a class allowlist with no structural fallback:\n'
      + `      ${expr.trim()}\n`
      + '      A plugin whose map area is not named in that list gets a null area, place() returns an\n'
      + '      EMPTY style, and the menu renders at its static position — off the page. That is the\n'
      + '      reported mobile bug, and it is decided by a string literal rather than by geometry.')
  }
}

// 2. place() must still bail safely when there is genuinely no toolbar (SSR, an unmounted menu).
if (!/if\s*\(\s*!tb\s*\|\|\s*!area\s*\)/.test(code)) {
  fails.push('place() no longer guards a missing toolbar/area; it must still return rather than throw.')
}

// 3. and the named-area behaviour must be PREFERRED, not replaced: a map menu must still be bounded by
//    the map's own walls where one is declared, or it can overflow a real map.
if (!/closest\(\s*AREA\s*\)/.test(code)) {
  fails.push('the named map area is no longer preferred — a menu must be bounded by a real map\'s walls '
    + 'where one is declared, and only fall back to the offset parent when none is.')
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — a named map area is preferred, and a plugin that declares none still resolves an `
  + 'anchor structurally, so the menu cannot fall back to its static off-page position.')
