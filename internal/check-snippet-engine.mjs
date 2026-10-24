#!/usr/bin/env node
/**
 * check-snippet-engine.mjs — the copy-paste snippet preloads the engine it will actually use.
 *
 * THE DEFECT (FIX-DEFAULT-EMBED-SNIPPET-PRELOADS-THE-MAPBOX-ENGINE). Every map profile's default snippet
 * began with a preload of api.mapbox.com's mapbox-gl.js, while the same snippet's profile-config said
 * provider "maplibre" — and since 2026-09-28 only an explicit provider "mapbox" selects Mapbox. So an
 * unedited paste downloaded the Mapbox engine on every view, never used it, and made a Mapbox request
 * from a keyless page. Its only guard was a comment asking the partner to delete the line.
 *
 * Reads the BUILT manifest (public/<tree>/manifest.json) and asserts, for every profile:
 *   a profile that DRAWS A MAP (isMap, or a composite whose bundle composes a map profile: the map is
 *                     its child, as in research-map-plus-grid and regions-mfe)
 *                     embed.script names no api.mapbox.com URL and preloads MapLibre (its script pin);
 *                     embed.scriptMapbox preloads the Mapbox engine AND sets "provider":"mapbox"
 *   any other profile embed.script names no api.mapbox.com URL, and there is no scriptMapbox
 * `--self-test` plants the old snippet, a variant that forgot its provider, and a map-drawing composite
 * stripped of its variant; each must fail.
 * Exit 0 pass · 1 fail · 2 no manifest.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { CDN } from '../library/constants/cdn.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const MAPBOX_HOST = 'api.mapbox.com'

// A profile DRAWS A MAP if it is one, or if it is a composite (nested-elements-mfe) whose bundle composes a
// map profile: research-map-plus-grid and regions-mfe have isMap false because their map is a child, and
// they draw on Mapbox when pasted with provider "mapbox". A bundle's plain leaves (type single) share its
// composes list but draw nothing, so the type is part of the rule. Same rule as generate-tree's composite pass.
export function drawsMapOf(manifest) {
  const isMap = new Map()
  for (const b of manifest.bundles || []) for (const p of b.profiles || []) isMap.set(`${b.bundle}/${p.profile}`, !!p.isMap)
  const reaches = (ref) => isMap.get(ref) || [...isMap].some(([k, v]) => v && k.startsWith(`${ref}/`))
  return (b, p) => !!p.isMap || (p.type === 'nested-elements-mfe' && (b.composes || []).some((r) => reaches(String(r))))
}

export function checkSnippets(manifest) {
  const errs = []
  let maps = 0
  const drawsMap = drawsMapOf(manifest)
  for (const b of manifest.bundles || []) {
    for (const p of b.profiles || []) {
      const id = `${b.bundle}/${p.profile}`
      const script = String(p.embed?.script || '')
      if (script.includes(MAPBOX_HOST)) errs.push(`${id}: the default snippet names ${MAPBOX_HOST} — an unedited paste would fetch an engine it never uses`)
      if (drawsMap(b, p)) {
        maps++
        if (!script.includes(CDN.maplibreGlJs.url)) errs.push(`${id}: the default snippet does not preload MapLibre, the engine it draws with`)
        const mb = String(p.embed?.scriptMapbox || '')
        if (!mb) errs.push(`${id}: no embed.scriptMapbox, so a host that chooses Mapbox has no snippet for it`)
        else {
          if (!mb.includes(CDN.mapboxGlJs.url)) errs.push(`${id}: scriptMapbox does not preload the Mapbox engine`)
          if (!mb.includes('"provider":"mapbox"')) errs.push(`${id}: scriptMapbox does not set "provider":"mapbox", so it would still draw with MapLibre`)
        }
      } else if (p.embed?.scriptMapbox) errs.push(`${id}: a non-map profile carries a Mapbox snippet`)
    }
  }
  return { errs, maps }
}

if (!existsSync(MANIFEST)) { console.error(`SNIPPET-ENGINE: no ${TREE_NAME}/manifest.json — build the tree first`); process.exit(2) }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

if (process.argv.includes('--self-test')) {
  const clone = () => JSON.parse(JSON.stringify(manifest))
  const firstMap = (m) => m.bundles.flatMap((b) => b.profiles).find((p) => p.isMap)
  const oldShape = clone(); { const p = firstMap(oldShape); p.embed.script = `<link rel="preload" as="script" href="${CDN.mapboxGlJs.url}">\n` + p.embed.script.replace(/<link rel="preload"[^\n]*\n/g, '') }
  const noProvider = clone(); { const p = firstMap(noProvider); p.embed.scriptMapbox = p.embed.scriptMapbox.replace('"provider":"mapbox"', '"provider":"maplibre"') }
  // A composite that draws its map through a child must carry the variant too: take it away from one.
  const composite = clone(); { const draws = drawsMapOf(composite); const hit = composite.bundles.flatMap((b) => b.profiles.map((p) => [b, p])).find(([b, p]) => !p.isMap && draws(b, p)); if (hit) delete hit[1].embed.scriptMapbox }
  const cases = [['the built tree passes', manifest, 0], ['the old Mapbox-preloading default fails', oldShape, 1], ['a Mapbox variant without its provider fails', noProvider, 1],
    ['a map-drawing composite without its Mapbox variant fails', composite, 1]]
  let ok = true
  for (const [name, m, want] of cases) {
    const n = checkSnippets(m).errs.length
    const pass = want === 0 ? n === 0 : n >= want
    if (!pass) ok = false
    console.log(`  ${pass ? '✓' : '✗'} ${name} -> ${n} error(s)`)
  }
  console.log(ok ? 'SNIPPET-ENGINE SELF-TEST: PASS' : 'SNIPPET-ENGINE SELF-TEST: FAIL')
  process.exit(ok ? 0 : 1)
}

const { errs, maps } = checkSnippets(manifest)
if (errs.length) {
  console.error(`SNIPPET-ENGINE: FAIL — ${errs.length} problem(s)`)
  for (const e of errs.slice(0, 20)) console.error('  ✗ ' + e)
  process.exit(1)
}
console.log(`SNIPPET-ENGINE: PASS — ${maps} map snippet(s) preload MapLibre and name no ${MAPBOX_HOST}; each has a Mapbox variant that sets its provider`)
