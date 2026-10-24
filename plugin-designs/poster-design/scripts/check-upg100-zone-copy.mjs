#!/usr/bin/env node
/**
 * check:upg100-zone-copy — library/packet/upg100Zones/ is UPG100's zone-poster code, copied so Poster Design (and any
 * page) can draw a UPG100 zone poster from the library. Two modes, chosen by what is on the tree:
 *
 *   COPY      while UPG100's originals (plugin-designs/my-upg-100-list/data/<file>) exist: every library file equals
 *             its original with ONLY the import specifiers normalised (the copy's library paths are shorter), and
 *             clusters.json byte for byte. A changed literal, a renamed variable, any edit in a function body FAILS:
 *             change both, or change the plugin and copy it again.
 *   ONE-PATH  once UPG100 has switched to the library copy and deleted its originals: no plugin file may define the
 *             zone functions again (one definition, one owner), as check:country-sheet-one-path does for countries.
 *   Half the originals present = FAIL (a switch left halfway).
 *
 * --self-test: a one-character edit inside a function body, a changed clusters.json and a missing copy each FAIL; a
 * change to an import specifier alone PASSES (the normalisation is no wider than the specifiers).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LIB = join(ROOT, 'library/packet/upg100Zones')
const PLUGIN = join(ROOT, 'plugin-designs/my-upg-100-list')
const FILES = ['zone-sheet-print.js', 'zone-sheet.js', 'legend-tree.js', 'selector-evaluator.js', 'zone-geometry.js', 'zones-for-list.js', 'clusters.json']
const DEFINES = /export\s+(?:async\s+)?function\s+(makeZoneSheet|upg100Zones|assignPins|seriesFacts|resolveZoneGeometry|zonesForList|buildLegendNodes)\b/

// Only the quoted specifier of a static import/export-from, a dynamic import() or a bare import is replaced.
export const normalise = (s) => s
  .replace(/(\bfrom\s*)(['"])[^'"\n]+\2/g, '$1$2§$2')
  .replace(/(\bimport\(\s*)(['"])[^'"\n]+\2/g, '$1$2§$2')
  .replace(/(^\s*import\s*)(['"])[^'"\n]+\2/gm, '$1$2§$2')

export function arms(read) {
  const fails = []
  const originals = FILES.filter((f) => read('plugin', f) != null)
  if (originals.length && originals.length < FILES.length) fails.push(`half switched: UPG100 still has ${originals.join(', ')} but not ${FILES.filter((f) => !originals.includes(f)).join(', ')}`)
  for (const f of FILES) if (read('lib', f) == null) fails.push(`the library copy has no ${f}`)
  if (originals.length === FILES.length) {
    for (const f of FILES) {
      const a = read('plugin', f), b = read('lib', f)
      if (b == null) continue
      const same = f.endsWith('.json') ? a === b : normalise(a) === normalise(b)
      if (!same) fails.push(`${f}: the library copy differs from UPG100's original beyond its import paths (change both, or copy again)`)
    }
    return { mode: 'COPY', fails }
  }
  if (!originals.length) {
    for (const f of read('pluginFiles')) { const m = (read('pluginAbs', f) || '').match(DEFINES); if (m) fails.push(`one path: ${f} defines ${m[1]} again; the library copy is the only one`) }
    return { mode: 'ONE-PATH', fails }
  }
  return { mode: 'HALF', fails }
}

const disk = (overrides = {}) => (where, f) => {
  const key = `${where}:${f}`
  if (key in overrides) return overrides[key]
  if (where === 'pluginFiles') {
    const out = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (!/node_modules|assets/.test(e.name)) walk(p) } else if (/\.(m?js|vue)$/.test(e.name)) out.push(p) } }
    walk(PLUGIN); return out
  }
  const p = where === 'pluginAbs' ? f : join(where === 'lib' ? LIB : join(PLUGIN, 'data'), f)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

if (process.argv.includes('--self-test')) {
  const real = disk()
  const body = real('lib', 'zone-sheet.js')
  const at = body.indexOf('return ', body.indexOf('export function upg100Zones'))
  const spec = real('lib', 'zone-sheet-print.js')
  const cases = [
    ['a one-character edit inside a function body', { 'lib:zone-sheet.js': body.slice(0, at) + 'return  ' + body.slice(at + 7) }, true],
    ['a changed clusters.json', { 'lib:clusters.json': real('lib', 'clusters.json').replace('"id"', '"id "') }, true],
    ['a missing copy', { 'lib:selector-evaluator.js': null }, true],
    // ONE-PATH (after UPG100 switches): no originals, and a plugin file that defines the zone code again must fail
    ['one path: a plugin file defining makeZoneSheet again', { ...Object.fromEntries(FILES.map((f) => [`plugin:${f}`, null])), 'pluginFiles:undefined': ['/fake/again.js'], 'pluginAbs:/fake/again.js': 'export function makeZoneSheet() {}' }, true],
    ['one path: no originals and no second definition', { ...Object.fromEntries(FILES.map((f) => [`plugin:${f}`, null])), 'pluginFiles:undefined': [] }, false],
    ['half switched: some originals deleted', { 'plugin:zone-geometry.js': null }, true],
    ['an import specifier changed alone', { 'lib:zone-sheet-print.js': spec.replace("from './zone-sheet.js'", "from './zone-sheet.js?v=2'") }, false],
  ]
  let ok = true
  for (const [name, ov, shouldFail] of cases) {
    const { fails } = arms(disk(ov))
    const good = shouldFail ? fails.length > 0 : fails.length === 0
    console.log(`  ${good ? '✓' : '✗'} ${name}: ${fails.length ? 'FAILS' : 'passes'} (${shouldFail ? 'must fail' : 'must pass'})${fails[0] ? ' -> ' + fails[0] : ''}`)
    if (!good) ok = false
  }
  console.log(ok ? 'UPG100-ZONE-COPY SELF-TEST: PASS' : 'UPG100-ZONE-COPY SELF-TEST: FAIL'); process.exit(ok ? 0 : 1)
}
const { mode, fails } = arms(disk())
if (fails.length) { console.log(`UPG100-ZONE-COPY: FAIL (${mode}, ${fails.length})`); fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1) }
console.log(`UPG100-ZONE-COPY: PASS (${mode}) — the ${FILES.length} files of library/packet/upg100Zones/ ${mode === 'COPY' ? "equal UPG100's originals beyond their import paths" : 'are the only definition of the zone code'}.`)
