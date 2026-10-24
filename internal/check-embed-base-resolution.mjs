#!/usr/bin/env node
/**
 * check-embed-base-resolution — the shared URL resolver, pinned by arithmetic.
 *
 * THE DEFECT THIS CATCHES, and it reached the live site. resolveAssetsBase() computed
 * `<treeRoot>/../assets` — one path segment too high. MEASURED 2026-09-25 by publishing to the
 * live catalog and reverting:
 *   leaf  .../doxa-maps/my-upg-100-list/upg-100-list/index.html + '../../assets'
 *                                  -> /plugin-assets/doxa-maps/assets   200   what the leaf means
 *   code  root '/plugin-assets/doxa-maps' + '/../assets'
 *                                  -> /plugin-assets/assets             404   what it returned
 * The UPG-100 map went from "195 polys · 27/27 zones · 2107 pins" to
 * "⚠ boundary fetch 404 world-adm0.geojson" — a basemap with none of our data on it.
 *
 * ★ WHY NOTHING CAUGHT IT. Three reasons, each worth knowing on its own:
 *   1. IT IS INVISIBLE LOCALLY. The dev web-root has BOTH public/assets (a sibling) and
 *      public/doxa-maps/assets (inside the tree), each holding the boundaries — so the wrong
 *      sibling path RESOLVES on 127.0.0.1. The catalog publishes app/doxa-maps only; there is no
 *      sibling to find. No local run can tell the two answers apart.
 *   2. THE BYTE GATES PASSED. check:published and check:catalog-currency both went GREEN on the
 *      bad publish — 22 of 22 bundles byte-identical, 22 current / 0 stale. They prove the bytes
 *      match; they do not prove the page works.
 *   3. NO GATE REFERENCED THE FUNCTION AT ALL, while 10+ profiles across 6 bundles call it.
 *
 * ⚠ IT IS PURE ARITHMETIC, deliberately — no browser, no network, no served tree. The defect was
 * a path calculation, so the check is a path calculation: it runs in milliseconds and cannot be
 * SKIPped by an absent server, which is how a gate quietly stops covering anything.
 *
 * ⚠ AND IT ASSERTS THE LEAF'S OWN MEANING AS THE ORACLE. The generated leaf writes
 * assetsBase '../../assets' from <tree>/<bundle>/<profile>/, which resolves to <tree>/assets. That
 * is not an opinion about where assets belong — it is what the HTML already says, so the resolver
 * agreeing with it is the property. The previous comment claimed the pool was a SIBLING of the
 * tree and justified the off-by-one in prose, which is how it survived review.
 *
 * Usage: node internal/check-embed-base-resolution.mjs
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const MOD = pathToFileURL(resolve(REPO, 'library/utils/embedBase.js')).href

let resolveAssetsBase
try {
  ({ resolveAssetsBase } = await import(MOD))
} catch (e) {
  console.error(`EMBED-BASE: FAIL — cannot import ${MOD}: ${String(e.message).slice(0, 90)}`)
  process.exit(1)
}

// Each case pairs a tree root with the URL a LEAF under it would resolve '../../assets' to.
// The leaf's own arithmetic is the oracle — computed here rather than hardcoded, so the
// expectation cannot drift from what the generated HTML actually means.
const TREES = [
  ['live catalog', `https://maps.example.org/plugin-assets/${TREE_NAME}`],
  ['dev tree', `http://127.0.0.1:4173/${TREE_NAME}`],
  ['doxa.life drop-in', `https://doxa.life/js/doxa-maps-build/${TREE_NAME}`],
  ['deep subpath', `https://cdn.example.org/a/b/c/${TREE_NAME}`],
]

const fails = []
console.log('EMBED-BASE')

for (const [name, root] of TREES) {
  // What a leaf at <tree>/<bundle>/<profile>/index.html means by '../../assets':
  const leaf = `${root}/some-bundle/some-profile/index.html`
  const oracle = new URL('../../assets', leaf).href.replace(/\/+$/, '')
  const got = resolveAssetsBase({ treeBase: root })
  const ok = got === oracle
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(18)} ${got}`)
  if (!ok) {
    fails.push(`${name}: resolver returned ${got}, but a leaf's own '../../assets' means ${oracle}`)
  }
}

// The explicit rungs of the ladder must still win — a fix to the derived path must not swallow
// a host-supplied answer, which is the regression a narrow fix would introduce.
const LADDER = [
  ['absolute assetsBase wins', { assetsBase: 'https://cdn.example.org/a', treeBase: 'https://x.test/t' },
    'https://cdn.example.org/a'],
  ['root-relative assetsBase wins', { assetsBase: '/shared/assets', treeBase: 'https://x.test/t' },
    '/shared/assets'],
  ['trailing slash stripped', { assetsBase: 'https://cdn.example.org/a/' },
    'https://cdn.example.org/a'],
  ['no base at all falls back', {}, './assets'],
]
for (const [name, cfg, want] of LADDER) {
  const got = resolveAssetsBase(cfg)
  const ok = got === want
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(30)} ${got}`)
  if (!ok) fails.push(`${name}: returned ${got}, expected ${want}`)
}

if (fails.length) {
  console.error(`\nEMBED-BASE: FAIL — ${fails.length} resolution(s) wrong.`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  This resolver is called by 10+ profiles across 6 bundles, and a wrong answer')
  console.error('  does not fail loudly — it fetches a 404 and the map paints a basemap with none')
  console.error('  of our data on it. It is also INVISIBLE LOCALLY: the dev web-root has assets')
  console.error('  both inside and beside the tree, so a wrong path still resolves on 127.0.0.1.')
  process.exit(1)
}
console.log(`\nEMBED-BASE: PASS — ${TREES.length} tree root(s) resolve to the same place a leaf's own `
  + `'../../assets' means, and all ${LADDER.length} ladder rung(s) behave.`)
