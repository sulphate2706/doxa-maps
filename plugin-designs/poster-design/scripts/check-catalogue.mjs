#!/usr/bin/env node
/**
 * check-catalogue.mjs (check:poster-design-catalogue): Poster Design's configuration catalogue
 * (plugin-designs/poster-design/src/templates.js) says only true things about the library.
 *
 *   1. SHEET_FORMATS has exactly the formats poster-render.js FORMATS defines, at the same pixel size.
 *      The generator is served as a pinned asset, not bundled, so the catalogue cannot import the table;
 *      this is what keeps the two from drifting.
 *   2. Every configuration name is unique and shaped like a name (lowercase words, dots, dashes, digits):
 *      a name is what a person hands an agent, so two cards must never share one.
 *   3. The card entries are exactly card-render.js STOCK, one per stock.
 *   4. Every catalogue key an entry names (labelKey, missing, the family keys) exists in the English
 *      posterDesign catalogue.
 *   5. Every sample country (the default and each format's own) exists in the country data and can be drawn (has
 *      geometry, a sheet tier), unless the shared path WITHHOLDS it (countrySheet.js sheetWithheld): that card shows
 *      the sentence instead of a drawing, so it is never drawn here.
 *   6. PLUGIN DESIGNS: every "posterDesign" block in plugin-designs/<plugin>/<profile>.meta.json is valid
 *      (src/pluginDesigns.js blockProblems: family, name, size, mobileFriendly, optional labelKey / instance), its
 *      labelKey exists in the English catalogue, and its instance is a preset of that profile.
 *   7. Names are unique across templates.js AND every plugin's blocks.
 *   8. THE NAMES LEDGER (src/catalogue-names.json): every name ever shipped. A ledger name that no longer exists
 *      (renamed or removed) FAILS: a name is what people hand an agent, so it must keep working (a retired size stays
 *      as a legacy entry, as templates.js does). A new name passes and is reported, to be added to the ledger.
 * A catalogue that lists nothing FAILS (vacuous guard). --self-test: an invalid block, a name clash, a renamed
 * ledger name, a block naming a missing preset, and a sample that exists but cannot be drawn (India with withholding
 * off) must each FAIL, and the documented example block must PASS.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const failures = []
const fail = (m) => failures.push(m)

const { createServer } = await import('vite')
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@map': join(ROOT, 'library') } },
})
let cat, STOCK, PD, sheetWithheld
try {
  ;({ sheetWithheld } = await server.ssrLoadModule('/library/packet/countrySheet.js'))
  cat = await server.ssrLoadModule('/plugin-designs/poster-design/src/templates.js')
  PD = await server.ssrLoadModule('/plugin-designs/poster-design/src/pluginDesigns.js')
  ;({ STOCK } = await server.ssrLoadModule('/library/packet/card-render.js'))
} finally { await server.close() }

const configs = cat.listConfigurations()
if (!configs.length) fail('vacuous: listConfigurations() returned nothing')

// 1. formats against the generator's own table
const src = readFileSync(join(ROOT, 'library/packet/poster-render.js'), 'utf8')
const block = (src.match(/const FORMATS = \{([\s\S]*?)\n\};?/) || [])[1]
if (!block) fail('poster-render.js: could not find "const FORMATS = {"; update this check')
else {
  const found = {}
  for (const m of block.matchAll(/^\s*'?([\w]+)'?\s*:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)/gm)) found[m[1]] = [Number(m[2]), Number(m[3])]
  const names = Object.keys(found)
  if (names.length < 3) fail(`poster-render.js FORMATS: parsed only ${names.length} format(s) (${names.join(', ')}); the parser no longer matches`)
  for (const k of names) {
    const mine = cat.SHEET_FORMATS[k]
    if (!mine) fail(`FORMATS has '${k}' and the catalogue does not`)
    else if (mine.px[0] !== found[k][0] || mine.px[1] !== found[k][1]) fail(`'${k}': catalogue says ${mine.px.join('×')}, FORMATS says ${found[k].join('×')}`)
  }
  for (const k of Object.keys(cat.SHEET_FORMATS)) if (!found[k]) fail(`the catalogue has format '${k}', which FORMATS does not`)
}

// 2. names
for (const c of configs) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(c.name)) fail(`'${c.name}' is not a configuration name (words joined by . or -)`)
}

// 3. stocks
const stockNames = configs.filter((c) => c.family === 'cards').map((c) => c.settings.stock).sort()
const want = Object.keys(STOCK).sort()
if (JSON.stringify(stockNames) !== JSON.stringify(want)) fail(`card configurations ${JSON.stringify(stockNames)} are not card-render STOCK ${JSON.stringify(want)}`)

// 4. keys exist in English
const en = JSON.parse(readFileSync(join(ROOT, 'library/i18n/locales/en/posterDesign.json'), 'utf8'))
// any catalogue key, in any area: "<area>.<path>" in library/i18n/locales/en/<area>.json
const enKey = (key) => {
  const [area, ...parts] = String(key).split('.')
  const file = join(ROOT, `library/i18n/locales/en/${area}.json`)
  if (!parts.length || !existsSync(file)) return false
  let o = JSON.parse(readFileSync(file, 'utf8'))
  for (const p of parts) { if (!o || typeof o !== 'object' || !(p in o)) return false; o = o[p] }
  return typeof o === 'string'
}
const has = (key) => {
  const parts = String(key).split('.')
  if (parts.shift() !== 'posterDesign') return false
  let o = en
  for (const p of parts) { if (!o || typeof o !== 'object' || !(p in o)) return false; o = o[p] }
  return typeof o === 'string'
}
const keys = [...configs.flatMap((c) => [c.labelKey, c.missing].filter(Boolean)), ...Object.values(cat.FAMILY_KEYS)]
for (const k of keys) if (!has(k)) fail(`catalogue key '${k}' is not in en/posterDesign.json`)
for (const c of configs) if (!cat.FAMILY_KEYS[c.family]) fail(`'${c.name}' has family '${c.family}', which has no heading key`)

// 5. the samples
const data = JSON.parse(readFileSync(join(ROOT, 'library/data/country-posters.json'), 'utf8'))
const samples = [...new Set([cat.SAMPLE_COUNTRY_ID, ...configs.map((c) => c.sample).filter(Boolean)])]
// A UPG100 zone sample (a template with `plugin: 'my-upg-100-list'`) is one of the zones in the library copy's catalogue.
const ZONE_IDS = (() => { try { const z = JSON.parse(readFileSync(join(ROOT, 'library/packet/upg100Zones/clusters.json'), 'utf8')); return new Set(['lists', 'asia_lists', 'uncovered_lists'].flatMap((k) => (z[k] || []).map((x) => x.id))) } catch { return new Set() } })()
function sampleArm(ids, countries, withheld) {
  const fs = []
  for (const id of ids) {
    if (ZONE_IDS.has(id)) continue   // a real UPG100 zone (drawn from the library copy)
    const s = countries.find((c) => c.id === id)
    if (!s) fs.push(`5: sample '${id}' is not in library/data/country-posters.json`)
    else if (withheld(s)) continue   // its card shows the withheld sentence; it is never drawn here
    else if (!s.hasGeometry || !s.sheet || s.unsupportedReason) fs.push(`5: sample '${s.id}' cannot be drawn (hasGeometry ${s.hasGeometry}, sheet ${s.sheet})`)
  }
  return fs
}
sampleArm(samples, data.countries || [], sheetWithheld).forEach(fail)

// 6-8: plugin designs, unique names, the ledger. Gathered once, judged by one function, so --self-test poisons the
// same function the real run uses.
function gatherBlocks() {
  const out = []
  const base = join(ROOT, 'plugin-designs')
  for (const plugin of readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const f of readdirSync(join(base, plugin)).filter((x) => x.endsWith('.meta.json'))) {
      let meta
      try { meta = JSON.parse(readFileSync(join(base, plugin, f), 'utf8')) } catch { continue }
      if (meta.posterDesign === undefined) continue
      const profile = f.replace(/\.meta\.json$/, '')
      const inst = readdirSync(join(base, plugin)).find((x) => x.endsWith('.instances.json'))
      const presets = inst ? ((JSON.parse(readFileSync(join(base, plugin, inst), 'utf8')).instances) || []).map((i) => i.id) : []
      const blocks = PD.blocksOf(meta.posterDesign)
      if (!blocks.length) out.push({ where: `${plugin}/${f}`, block: meta.posterDesign, presets })
      for (const block of blocks) out.push({ where: `${plugin}/${profile}.meta.json`, block, presets })
    }
  }
  return out
}
function designArms({ names, blocks, ledger, drawnFor = new Map() }) {
  const fs = []
  for (const { where, block, presets } of blocks) {
    const probs = PD.blockProblems(block)
    for (const p of probs) fs.push(`6: ${where} posterDesign ${p}`)
    if (probs.length) continue
    if (block.labelKey && !enKey(block.labelKey)) fs.push(`6: ${where} labelKey '${block.labelKey}' is not in the English catalogue`)
    if (block.instance && !presets.includes(block.instance)) fs.push(`6: ${where} instance '${block.instance}' is not one of its presets`)
  }
  // A template that DRAWS a plugin's design (`plugin: '<dir>'`) carries that plugin's own name, so the same name in that
  // plugin's block is the same design, counted once. Anywhere else a repeated name is a clash.
  const seen = new Set(names)
  for (const n of names.filter((x, i) => names.indexOf(x) !== i)) fs.push(`7: two templates are named '${n}'`)
  for (const b of blocks.filter((x) => !PD.blockProblems(x.block).length)) {
    const n = b.block.name, plugin = String(b.where).split('/')[0]
    if (seen.has(n) && drawnFor.get(n) !== plugin) fs.push(`7: two designs are named '${n}'`)
    seen.add(n)
  }
  for (const n of ledger) if (!seen.has(n)) fs.push(`8: '${n}' is in the names ledger and no longer exists: a shipped name is never renamed or removed (keep it, as a legacy entry if retired)`)
  return { fails: fs, fresh: [...seen].filter((n) => !ledger.includes(n)) }
}
const LEDGER_FILE = join(ROOT, 'plugin-designs/poster-design/src/catalogue-names.json')
const ledger = existsSync(LEDGER_FILE) ? JSON.parse(readFileSync(LEDGER_FILE, 'utf8')).names || [] : []
if (!ledger.length) fail('8: the names ledger (src/catalogue-names.json) is missing or empty')
const blocks = gatherBlocks()
const real = { names: configs.map((c) => c.name), blocks, ledger, drawnFor: new Map(configs.filter((c) => c.plugin).map((c) => [c.name, c.plugin])) }

if (process.argv.includes('--self-test')) {
  const example = { family: 'regionPoster', name: 'region-poster.66x66', size: '66x66', mobileFriendly: true }
  const B = (block, presets = []) => ({ where: 'fixture/fixture.meta.json', block, presets })
  const cases = [
    ['an invalid block (mobileFriendly missing)', { ...real, blocks: [...blocks, B({ family: 'regionPoster', name: 'region-poster.x', size: '66x66' })] }, /^6: .*mobileFriendly/],
    ['a name clash with templates.js', { ...real, blocks: [...blocks, B({ ...example, name: real.names[0] })] }, /^7: /],
    ['a renamed ledger name', { ...real, names: real.names.map((n, i) => (i === 0 ? `${n}-renamed` : n)) }, /^8: /],
    ['another plugin reusing a name a template draws for UPG100', { ...real, blocks: [...blocks, B({ ...example, name: 'upg100-territory-poster.3x3' })] }, /^7: /],
    ['a block naming a preset that does not exist', { ...real, blocks: [...blocks, B({ ...example, instance: 'nowhere' }, ['africa'])] }, /^6: .*instance/],
  ]
  let ok = true
  for (const [name, input, rx] of cases) {
    const { fails } = designArms(input); const hit = fails.find((f) => rx.test(f))
    console.log(hit ? `  ✓ caught: ${name} -> ${hit}` : `  ✗ MISSED: ${name}`)
    if (!hit) ok = false
  }
  // a sample that exists but cannot be drawn: India, once nothing withholds it
  const und = sampleArm(samples, data.countries || [], () => false).find((f) => /cannot be drawn/.test(f))
  console.log(und ? `  ✓ caught: a sample that exists but cannot be drawn (withholding off) -> ${und}` : '  ✗ MISSED: a sample that exists but cannot be drawn')
  if (!und) ok = false
  const good = designArms({ ...real, blocks: [...blocks, B(example)] })
  console.log(good.fails.length ? `  ✗ the documented example block FAILS: ${good.fails[0]}` : '  ✓ the documented example block passes')
  if (good.fails.length) ok = false
  console.log(ok ? 'POSTER-DESIGN-CATALOGUE SELF-TEST: PASS' : 'POSTER-DESIGN-CATALOGUE SELF-TEST: FAIL')
  process.exit(ok ? 0 : 1)
}
const judged = designArms(real)
judged.fails.forEach(fail)

if (failures.length) {
  console.error(`POSTER-DESIGN-CATALOGUE: FAIL (${failures.length})\n  - ${failures.join('\n  - ')}`)
  process.exitCode = 1
} else {
  console.log(`POSTER-DESIGN-CATALOGUE: PASS — ${configs.length} configurations, ${Object.keys(cat.SHEET_FORMATS).length} sheet formats matching poster-render FORMATS, ${want.length} card stocks from STOCK, ${keys.length} catalogue keys present, samples ${samples.join(', ')} drawable or withheld; ${blocks.length} plugin design block(s) valid; ${ledger.length} ledger names all present${judged.fresh.length ? `; NEW (add to src/catalogue-names.json): ${judged.fresh.join(', ')}` : ''}`)
}
