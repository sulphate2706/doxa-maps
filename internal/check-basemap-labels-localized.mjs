#!/usr/bin/env node
/**
 * check-basemap-labels-localized — the BASEMAP's place names follow the reader's language, on BOTH
 * engines (card BUILD-LOCALIZATION-SURVIVES-THE-PROVIDER-SWAP; the code under test is
 * library/maps/localize-labels.js, 319064a1 / 4839f879).
 *
 * USAGE:   node internal/check-basemap-labels-localized.mjs [--dir <tree root>] [--leaf bundle/profile]
 *          Serves THIS checkout's public/ on an OS-assigned port (so it cannot measure another tree),
 *          or --dir (used for the negative control: a tree whose bundle predates the fix).
 * Exit 0 = both engines localize · 1 = an engine does not · 2 = could not measure.
 *
 * WHAT IS READ — the RENDERED label, not our own guess at an expression:
 *   Mapbox    Standard keeps its labels in the IMPORTED basemap, invisible to a plain
 *             queryRenderedFeatures. The 'place-labels' featureset of the 'basemap' import returns
 *             each country label with the `name` the engine drew (setLanguage localizes it).
 *   MapLibre  queryRenderedFeatures returns each symbol's EVALUATED text-field, i.e. the text drawn.
 * WHAT IS ASSERTED, per engine, between ?lang=en and ?lang=ru on the same view (30°E 45°N, z3):
 *   Mapbox    known countries flip: Germany→Германия, Ukraine→Украина, Turkey→Турция, Egypt→Египет
 *             (at least two of them seen in both runs).
 *   MapLibre  for the country labels (identified by their name:en property), the ru run draws the
 *             feature's name:ru, and the en run does not. (English on MapLibre restores the style's
 *             ORIGINAL label, OSM's Latin name — 'Deutschland', not 'Germany' — so no English word
 *             is expected there; the flip to Cyrillic is the evidence.)
 *
 * NEGATIVE-TESTED 2026-09-25: the same leaf built from 319064a1's parent (before localize-labels
 * existed), served with --dir, FAILS on both engines.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIR = resolve(arg('--dir', resolve(ROOT, 'public')))
const LEAF = arg('--leaf', 'doxa-simple-map/doxa-simple-map')
const PAIRS = { Germany: 'Германия', Ukraine: 'Украина', Turkey: 'Турция', Egypt: 'Египет', Kazakhstan: 'Казахстан', Poland: 'Польша' }

const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', DIR, '--exit-with-parent'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 900))
const up = await fetch(`http://127.0.0.1:${port}/${TREE_NAME}/${LEAF}/index.html`).then((r) => r.ok).catch(() => false)
if (!up) { srv.kill(); console.log(`BASEMAP-LABELS: NOT MEASURED — could not serve ${DIR}`); process.exit(2) }

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
async function labels(provider, lang) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`http://127.0.0.1:${port}/${TREE_NAME}/${LEAF}/index.html?lang=${lang}${provider === 'maplibre' ? '&provider=maplibre' : ''}`, { waitUntil: 'networkidle' })
  const FIND = `(() => { const f = (r) => { for (const e of r.querySelectorAll('*')) { if (e.__doxaMap) return e.__doxaMap; if (e.shadowRoot) { const m = f(e.shadowRoot); if (m) return m } } return null }; return f(document) })()`
  let ok = false
  for (let i = 0; i < 60 && !ok; i++) { await page.waitForTimeout(500); ok = await page.evaluate(`(() => { const m = ${FIND}; return !!(m && m.isStyleLoaded && m.isStyleLoaded()) })()`).catch(() => false) }
  if (!ok) { await page.close(); return null }
  await page.evaluate(`(() => { const m = ${FIND}; m.jumpTo({ center: [30, 45], zoom: 3 }) })()`)
  await page.waitForTimeout(7000)
  const out = await page.evaluate(`(() => { const m = ${FIND}
    if (${JSON.stringify(provider)} === 'mapbox') {
      let fs = []; try { fs = m.queryRenderedFeatures({ target: { featuresetId: 'place-labels', importId: 'basemap' } }) } catch (e) { return { error: e.message } }
      return { names: fs.filter((f) => f.properties && f.properties.class === 'country').map((f) => f.properties.name) }
    }
    const text = (tf) => (tf && Array.isArray(tf.sections)) ? tf.sections.map((s) => s.text).join('') : (typeof tf === 'string' ? tf : '')
    const feats = m.queryRenderedFeatures().filter((f) => f.layer && f.layer.type === 'symbol' && /country/.test(f.layer.id) && f.properties['name:en'])
    return { countries: feats.map((f) => ({ en: f.properties['name:en'], ru: f.properties['name:ru'] || '', drawn: text(f.layer.layout && f.layer.layout['text-field']) })) }
  })()`)
  await page.close()
  return out
}

const results = []
for (const provider of ['mapbox', 'maplibre']) {
  const en = await labels(provider, 'en'), ru = await labels(provider, 'ru')
  if (!en || !ru || en.error || ru.error) { results.push({ provider, measured: false, why: (en && en.error) || (ru && ru.error) || 'map never finished its style' }); continue }
  if (provider === 'mapbox') {
    const seen = Object.keys(PAIRS).filter((k) => en.names.includes(k))
    const flipped = seen.filter((k) => ru.names.includes(PAIRS[k]))
    // MEASURED = the engine drew enough country labels to judge. Not "saw two known English names":
    // without localization Mapbox Standard draws a different default form, and that absence IS the
    // defect — the first version of this line reported the pre-fix build as NOT MEASURED instead of
    // FAIL (68 country labels drawn, none English), which would let the gate pass by abstaining.
    results.push({ provider, measured: en.names.length >= 5 && ru.names.length >= 5, ok: seen.length >= 2 && flipped.length === seen.length,
      detail: `en saw ${seen.join(', ') || '(none)'}; ru drew ${flipped.map((k) => PAIRS[k]).join(', ') || '(none of them)'} (${en.names.length}/${ru.names.length} country labels)` })
  } else {
    const byEn = (arr) => new Map(arr.map((c) => [c.en, c]))
    const E = byEn(en.countries), R = byEn(ru.countries)
    const common = [...R.keys()].filter((k) => E.has(k) && R.get(k).ru)
    const localized = common.filter((k) => R.get(k).drawn === R.get(k).ru && E.get(k).drawn !== R.get(k).ru)
    results.push({ provider, measured: common.length >= 2, ok: common.length >= 2 && localized.length === common.length,
      detail: `${localized.length}/${common.length} countries drawn in Russian under ru and not under en` + (common[0] ? ` — e.g. ${common[0]}: en "${E.get(common[0]).drawn}" → ru "${R.get(common[0]).drawn}"` : '') })
  }
}
await browser.close(); srv.kill()

for (const r of results) console.log(`  ${r.provider.padEnd(9)} ${!r.measured ? 'NOT MEASURED' : r.ok ? 'ok  ' : 'FAIL'}  ${r.detail || r.why}`)
if (results.some((r) => r.measured && !r.ok)) { console.log('BASEMAP-LABELS: FAIL — a basemap does not follow the reader\'s language on every engine.'); process.exit(1) }
if (results.some((r) => !r.measured)) { console.log('BASEMAP-LABELS: NOT MEASURED — an engine gave too few labels to judge.'); process.exit(2) }
console.log(`BASEMAP-LABELS: PASS — ${LEAF}'s basemap place names follow the reader's language on Mapbox AND MapLibre.`)
