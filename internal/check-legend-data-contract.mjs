#!/usr/bin/env node
/**
 * check-legend-data-contract — nobody may read a key off useLegendData that it does not return.
 *
 * WHY A WHOLE-CLASS CHECK AND NOT A ONE-LINE FIX. useLegendData returns
 * { items, columns, title, activeFilter, setFilter, totalCount, totalPopulation, progress, fmtPop,
 * fmtCount }. There is no `rows`. Two plugins independently read `legend.rows` anyway, and because
 * JavaScript answers `undefined` rather than complaining, each failure wore a different costume:
 *
 *   - countries-map: Export poster THREW (NE-17, fixed in d6916e05e)
 *   - research-map: provide('legendRows', legend.rows) provided undefined; the poster fallback
 *     `legend?.rows?.value || []` could only ever be []; and the packet's legend slot was
 *     `rows: legend?.rows?.value || []` with no second source, so that poster printed NO legend at
 *     all — useMapPoster skips the slot when the row list is empty.
 *
 * The empty legend was the expensive one, because it looks like a layout or data problem and is
 * really a misspelt key resolving quietly to undefined. One line per plugin would have fixed the two
 * known cases and left the next one to be found by whoever next opened a blank poster.
 *
 * The returned key set is READ FROM THE COMPOSABLE, not restated here, so adding a key to it does
 * not require editing this file — and removing one immediately names every consumer that breaks.
 *
 * ★ IT DOES NOT STRIP BLOCK COMMENTS, AND THAT IS DELIBERATE. The obvious way to ignore comments is
 * one global regex replacing every block comment with nothing. On these files that DELETES REAL
 * CODE: a slash-star sequence inside an ordinary string — a glob path, a URL — opens a comment the
 * author never wrote, and the replace then runs from there to the next genuine block-comment
 * terminator, taking every line between with it. Written that way, this check reported "no consumers
 * at all" while both consumers sat plainly in the files, because the very lines it was looking for
 * had been erased before it looked. Comments are skipped per LINE instead, which cannot swallow code
 * it does not understand.
 *
 * (Writing that regex out in this comment closed this block early and broke the file's parse, which
 * is the same trap one layer up: a comment describing a terminator must not contain one.)
 *
 * Headless, no browser, no dependencies. Exit 0 pass · 1 fail.
 */
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSABLE = 'library/composables/legends/useLegendData.js'
const fails = []

// ── what it actually returns ──────────────────────────────────────────────────
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line)
/** Is column `col` of `line` inside a quoted span? Quotes toggle; a backslash escapes the next char. */
function inString(line, col) {
  let quote = null
  for (let i = 0; i < col && i < line.length; i++) {
    const c = line[i]
    if (c === '\\') { i++; continue }
    if (quote) { if (c === quote) quote = null }
    else if (c === '"' || c === "'" || c === '`') quote = c
  }
  return quote !== null
}
const csrc = readFileSync(resolve(ROOT, COMPOSABLE), 'utf8')
// the composable's own top-level return: the LAST `return {` in the file, which is the one that
// closes useLegendData itself rather than a computed's early exit.
const lastReturn = csrc.lastIndexOf('return {')
if (lastReturn < 0) { console.error('LEGEND-DATA-CONTRACT: FAIL\n  ✗ could not find useLegendData\'s return object'); process.exit(1) }
const block = csrc.slice(lastReturn + 'return {'.length, csrc.indexOf('}', lastReturn))
const RETURNED = new Set(
  block.split(',').map((t) => t.split(':')[0].trim()).filter((t) => /^[A-Za-z_$][\w$]*$/.test(t))
)
if (RETURNED.size < 5) { console.error(`LEGEND-DATA-CONTRACT: FAIL\n  ✗ parsed only ${RETURNED.size} returned keys; the parse is wrong, not the code`); process.exit(1) }
if (RETURNED.has('rows')) fails.push('useLegendData now returns `rows` — this check\'s premise changed; re-read it before trusting the result')

// ── every consumer ────────────────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'public') continue
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(e)) out.push(p)
  }
  return out
}
const files = [...walk(resolve(ROOT, 'library')), ...walk(resolve(ROOT, 'plugin-designs'))]
let consumers = 0

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  if (!/useLegendData\s*\(/.test(raw)) continue
  if (file.endsWith('useLegendData.js')) continue
  const src = raw
  const bind = src.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useLegendData\s*\(/)
  if (!bind) continue
  consumers++
  const name = bind[1]
  const rel = relative(ROOT, file)
  const useRe = new RegExp(String.raw`\b${name}\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)`, 'g')
  const bad = new Map()
  let m
  while ((m = useRe.exec(src))) {
    const key = m[1]
    if (RETURNED.has(key)) continue
    // Comments legitimately discuss the old spelling (this fix is documented in both plugins), so a
    // match on a comment line is ignored — per line, never by deleting spans of the file.
    const before = src.slice(0, m.index)
    const line = before.split('\n').length
    const lineText = src.split('\n')[line - 1] || ''
    if (isCommentLine(lineText)) continue
    // ★ AND NOT INSIDE A STRING. t('legend.colLabel.religion') is an i18n KEY that happens to be
    // spelled like a property access on this very binding, and every such key was reported as a
    // violation on the first run. A translation key is not a read.
    if (inString(lineText, m.index - (before.lastIndexOf('\n') + 1))) continue
    if (!bad.has(key)) bad.set(key, [])
    bad.get(key).push(line)
  }
  for (const [key, lines] of bad) {
    fails.push(`${rel}: reads \`${name}.${key}\`, which useLegendData does not return ` +
      `(line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})\n` +
      `      it returns: ${[...RETURNED].join(', ')}\n` +
      `      JavaScript answers undefined here, so this fails as a blank legend or an empty array, not as an error`)
  }
}

if (!consumers) fails.push('found no useLegendData consumers at all — the scan is broken, not the code')

// ── THE SHARED BRIDGE'S CALLERS MUST SUPPLY EVERY DEPENDENCY ───────────────────────────────────
// ★ WHAT A SHARED COMPOSABLE NEWLY MAKES POSSIBLE. useLegendMapBridge reaches for nothing — map,
// activeTab, countryOutline, regionIdle, mapFly, pplrInstance and mapId are all passed in. That is
// what lets a second dashboard adopt it, and it is also a new way to be wrong: a caller that omits
// one gets `undefined` at the first call, not at import, so the legend simply stops highlighting
// and nobody sees an error. Asserted on the CALL, for every caller.
//
// ⚠ AND THE CALL MUST FOLLOW ITS DEPENDENCIES. The four functions it replaces were hoisted function
// declarations, so they ran fine above `const countryOutline = ...`. A composable call is not
// hoisted; placed too early it reads undefined and the same silence follows.
{
  const BRIDGE_DEPS = ['map', 'activeTab', 'countryOutline', 'regionIdle', 'mapFly', 'pplrInstance', 'mapId']
  const callers = ['plugin-designs/doxa-research-map/research-map.vue',
                   'plugin-designs/country-posters/countries-map.vue']
  for (const path of callers) {
    let src
    try { src = readFileSync(resolve(ROOT, path), 'utf8') } catch { fails.push(`${path} is missing — a bridge caller moved`); continue }
    if (!src.includes('useLegendMapBridge')) { fails.push(`${path} no longer uses useLegendMapBridge — the twins have diverged again`); continue }
    const call = /useLegendMapBridge\(\{([\s\S]{0,400}?)\}\)/.exec(src)
    if (!call) { fails.push(`${path}: useLegendMapBridge is imported but never called`); continue }
    for (const dep of BRIDGE_DEPS) {
      if (!new RegExp(`\\b${dep}\\b`).test(call[1])) {
        fails.push(`${path}: useLegendMapBridge() is missing \`${dep}\` — it reads undefined at the first call, so the legend stops working with no error`)
      }
    }
    const at = src.indexOf('useLegendMapBridge({')
    for (const dep of ['countryOutline', 'pplrInstance']) {
      const decl = src.indexOf(`const ${dep} =`)
      if (decl >= 0 && decl > at) {
        fails.push(`${path}: useLegendMapBridge() is called before \`${dep}\` is declared — a composable call is not hoisted the way the functions it replaced were`)
      }
    }
  }
}

if (fails.length) {
  console.error('LEGEND-DATA-CONTRACT: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`LEGEND-DATA-CONTRACT: PASS — ${consumers} consumer(s) read only keys useLegendData returns (${[...RETURNED].join(', ')}).`)
