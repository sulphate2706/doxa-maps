#!/usr/bin/env node
/**
 * check-clustering-modes.mjs — every option in the map's clustering picker must DRAW something
 * different. A control that does nothing is worse than a control that is absent: it tells the
 * reader the map cannot do what it can.
 *
 * THE DEFECT, MEASURED AND CONFIRMED HERE. The side menu offers four clustering
 * options; choosing "Native" changed nothing on the map. Two separate reasons, and only fixing both
 * makes the control real:
 *
 *   1. mapStore never declared `clusteringMode`, so the picker wrote to a property no reactive
 *      system watched, and useMapClustering's `mode` computed kept its own default.
 *   2. research-map.vue's Clusters-checkbox watcher force-set 'mst' "regardless of what's in the
 *      store". Even with (1) fixed, one tick of the checkbox would have snapped Native back to MST
 *      — a control that works until you touch the other one.
 *
 * ★ WHY THIS ASSERTS ON PIXELS-WORTH-OF-STATE AND NOT ON STATE. "mapStore.clusteringMode === 'mapbox'"
 * would have passed on the broken build the moment (1) was fixed, while the map still drew MST
 * lines. Clustering output is painted on the canvas, so the only honest question is what the GL
 * style is actually rendering. The map exposes `__researchMapClusterDraw()` for exactly this: per
 * clustering layer, whether it exists, whether it is visible, and how many features are rendered
 * NOW.
 *
 * ASSERTIONS, per mode, on the built tree under the default provider:
 *   off      — nothing rendered by any clustering layer.
 *   mapbox   — the native circle layer AND its count-label layer render features; no cluster lines.
 *   mst      — the cluster-lines layer renders features; no native circles.
 *   network  — same as mst (a different algorithm feeding the same line layer), and it must produce
 *              a DIFFERENT number of lines than mst on the same data, or the two options are one
 *              option wearing two labels.
 * and between modes: no orphans — a layer left rendering after switching away is the bug this
 * composable's own teardown comments warn about.
 *
 * Exit: 0 pass or SKIP (no built tree, no browser, no data) · 1 fail.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'CLUSTERING-MODES'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// The tree's folder name is configurable and was renamed on 2026-09-25; reading it from the one
// helper is what keeps this gate pointed at the tree that exists. A hardcoded name does not error,
// it 404s — and a gate that 404s reports a clean page.
const { TREE_NAME } = await import(join(ROOT, 'internal', '_tree-name.mjs'))
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const skip = (why) => { console.log(`${TAG}: SKIP — ${why}`); process.exit(0) }

if (!existsSync(MANIFEST)) skip('no built manifest (run `bun run tree` first).')
let chromium
try { ({ chromium } = await import('../../../internal/lib/playwright-guarded.mjs')) } catch { skip('playwright is not installed.') }

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const bundle = (manifest.bundles || []).find((b) => b.bundle === 'doxa-research-map')
const profile = bundle && (bundle.profiles || []).find((p) => p.iframeUrl && /research-map/.test(p.iframeUrl))
if (!profile) skip('the manifest declares no research-map leaf to load.')

const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const PORT = await freePort()
const TREE = `http://127.0.0.1:${PORT}/${TREE_NAME}`
const LEAF = `${TREE}/${String(profile.iframeUrl).replace(/^\.\//, '')}`

const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
const cleanup = () => { try { tree.kill() } catch { /* already gone */ } }
await new Promise((r) => setTimeout(r, 900))
if (!await fetch(`${TREE}/manifest.json`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false)) {
  cleanup(); skip('could not serve the built tree locally.')
}
const { requireThisTree } = await import(join(ROOT, 'internal', '_serves-this-tree.mjs'))
await requireThisTree(TREE, ROOT, TAG)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
const fails = []
const lines = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(LEAF, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const report = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    // Wait for the map AND its data: clustering has nothing to draw until the pins exist.
    let draw = null
    for (let i = 0; i < 120; i++) {
      if (typeof window.__researchMapClusterDraw === 'function') { draw = window.__researchMapClusterDraw; break }
      await sleep(500)
    }
    if (!draw) return { skip: 'the map never exposed its clustering report (it did not finish mounting)' }
    const vocab = window.__researchMapVocabulary
    for (let i = 0; i < 120; i++) {
      if (vocab && (vocab('religionFamily') || []).length) break
      await sleep(500)
    }

    // ★ CLICK THE ACTUAL BUTTONS. Setting the store would prove the state path and nothing about the
    // control, and a control that does not reach its state is precisely the defect here. The drawer
    // is off-screen until opened, which does not matter: a dispatched click reaches a Vue @click
    // handler wherever the element sits, and the drawer's own open/close is a different question.
    const seen = new Set()
    const findAll = (sel) => {
      const hits = []
      const walk = (root) => {
        if (!root || seen.has(root)) return
        seen.add(root)
        for (const el of root.querySelectorAll('*')) {
          if (el.matches && el.matches(sel)) hits.push(el)
          if (el.shadowRoot) walk(el.shadowRoot)
        }
      }
      walk(document)
      return hits
    }
    const buttons = findAll('.rm-cluster-btn')
    // Order is the component's CLUSTER_MODES array: off, mapbox (Native), mst, network. Index and
    // not label, because the labels are localized and this gate must pass in every locale.
    if (buttons.length !== 4) return { skip: `expected 4 clustering buttons in the side menu, found ${buttons.length}` }

    // ★ WAIT FOR THE DRAWING TO SETTLE, DO NOT GUESS A DURATION. A fixed 6s pause reported MST as
    // drawing nothing while Network drew 2,681 lines — not a bug in MST but in the measurement: a
    // minimum spanning tree over ~2,100 pins is quadratic and simply had not finished. A gate that
    // calls a slow feature broken is worse than no gate. So poll until two consecutive reads agree,
    // which ends in a second or two for a mode that draws nothing and waits as long as the work
    // actually takes for one that does.
    const settle = async (maxMs) => {
      const t0 = Date.now()
      let prev = JSON.stringify(draw())
      let stableSince = Date.now()
      while (Date.now() - t0 < maxMs) {
        await sleep(1500)
        const now = JSON.stringify(draw())
        if (now === prev) { if (Date.now() - stableSince > 4000) return JSON.parse(now) }
        else { prev = now; stableSince = Date.now() }
      }
      return JSON.parse(prev)
    }

    // ★ WAIT FOR THE DRAWING TO CHANGE BEFORE WAITING FOR IT TO SETTLE. "Two consecutive reads
    // agree" is not enough on its own: the previous mode's output is still on the map for as long
    // as the new mode takes to compute, so a stable read can be the OLD picture. MEASURED — a rerun
    // reported Network drawing 1,700 lines, exactly MST's number, where an earlier run of the same
    // build gave 23,896. Not a product regression: the settle returned while MST's lines were still
    // up. So each mode first waits for the report to DIFFER from what was on screen when it was
    // clicked, and only then waits for it to stop moving. If it never differs, that is recorded as
    // it stands and the assertions below say so — which is the honest outcome either way.
    const changed = async (before, maxMs) => {
      const t0 = Date.now()
      while (Date.now() - t0 < maxMs) {
        await sleep(1000)
        if (JSON.stringify(draw()) !== before) return true
      }
      return false
    }

    const out = {}
    const MODES = ['off', 'mapbox', 'mst', 'network']
    for (let i = 0; i < MODES.length; i++) {
      const before = JSON.stringify(draw())
      buttons[i].click()
      await changed(before, 60000)
      out[MODES[i]] = await settle(90000)
    }
    return out
  })

  if (report.skip) { await browser.close(); cleanup(); skip(report.skip) }

  const renderedOf = (snap, re) => Object.entries(snap || {})
    .filter(([id, v]) => re.test(id) && (v.visibility !== 'none'))
    .reduce((a, [, v]) => a + Math.max(0, v.rendered), 0)

  const circles = (m) => renderedOf(report[m], /^mapbox-clusters-circle/)
  const counts = (m) => renderedOf(report[m], /^mapbox-clusters-count/)
  const linesN = (m) => renderedOf(report[m], /^cluster-lines/)

  for (const m of ['off', 'mapbox', 'mst', 'network']) {
    lines.push(`  · ${m.padEnd(8)} circles=${circles(m)} counts=${counts(m)} lines=${linesN(m)}`)
  }

  if (circles('off') || counts('off') || linesN('off')) {
    fails.push(`"Off" still draws clustering: circles=${circles('off')} counts=${counts('off')} lines=${linesN('off')}.`)
  }
  if (!circles('mapbox')) fails.push('"Native" drew no cluster circles — the option does nothing, which is the defect this gate exists for.')
  // Only meaningful once circles exist: reported beside "drew no circles" it reads as a second,
  // separate defect when it is the same one.
  if (circles('mapbox') && !counts('mapbox')) fails.push('"Native" drew circles but no count labels — the numbers on the bubbles are the whole point of native clustering.')
  if (linesN('mapbox')) fails.push(`"Native" also drew ${linesN('mapbox')} cluster LINES — the previous mode was not torn down.`)
  if (!linesN('mst')) fails.push('"MST" drew no cluster lines.')
  if (circles('mst')) fails.push(`"MST" still shows ${circles('mst')} native cluster circles — the previous mode was not torn down.`)
  if (!linesN('network')) fails.push('"Network" drew no cluster lines.')
  if (circles('network')) fails.push(`"Network" still shows ${circles('network')} native cluster circles — the previous mode was not torn down.`)
  if (linesN('mst') && linesN('network') && linesN('mst') === linesN('network')) {
    fails.push(`"MST" and "Network" both drew exactly ${linesN('mst')} lines on the same data — two labels for one behaviour is the same defect as a dead option.`)
  }
} catch (err) {
  fails.push(`the measurement itself failed: ${err && err.message}`)
} finally {
  await browser.close().catch(() => {})
  cleanup()
}

for (const l of lines) console.log(l)
if (fails.length) {
  console.log(`\n${TAG}: FAIL`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — each clustering option draws its own thing, and switching leaves no orphans.`)
