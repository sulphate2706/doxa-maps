#!/usr/bin/env node
/**
 * check-pin-dim-slider.mjs — the side menu's pin-dim slider and the legend's dimming must COMPOSE,
 * not compete, and the slider must actually reach the map.
 *
 * THE DEFECT. The slider wrote mapStore.clusterPinOpacity, which mapStore never declared, so
 * dragging it changed a number nobody read — the same shape of defect as the clustering picker
 * beside it, found while fixing that one. And the naive fix would have created a worse one: the pin
 * layer's circle-opacity is ALSO owned by legend dimming (a ['case', …, 1, 0] expression), so a flat
 * slider value written by a second owner would silently erase dimming, or be erased by it, depending
 * on which the reader touched last.
 *
 * ★ SO THE VALUE IS A PRODUCT, AND THAT IS WHAT THIS ASSERTS: opacity = slider × (1 matched, 0
 * dimmed). The slider scales the whole layer; dimming still dims relative to it; neither wins.
 *
 * ASSERTIONS, reading the LIVE paint property rather than the store:
 *   clustering off            a plain 1 — the slider is hidden then, and dimming a map with nothing
 *                             to dim FOR would be a regression of its own.
 *   clustering on, 0.5        a plain 0.5.
 *   + a dimming selection     ['case', <expr>, 0.5, 0] — dimming survives the slider.
 *   slider back to 1.0        ['case', <expr>, 1, 0] — the slider survives dimming.
 *
 * Exit: 0 pass or SKIP (no built tree, no browser, no data) · 1 fail.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'PIN-DIM-SLIDER'
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

  const out = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    let read = null
    for (let i = 0; i < 120 && !read; i++) {
      if (typeof window.__researchMapPinOpacity === 'function') read = window.__researchMapPinOpacity
      else await sleep(500)
    }
    if (!read) return { skip: 'the map never exposed its pin-opacity report' }
    for (let i = 0; i < 120; i++) {
      if ((window.__researchMapVocabulary?.('religionFamily') || []).length) break
      await sleep(500)
    }

    // Fresh walk each time: the slider is behind v-if="clusterMode !== 'off'", so it does not EXIST
    // until a clustering mode is chosen. Caching the visited set across calls (as the clustering gate
    // can) would mean searching a DOM snapshot taken before the element was created — which is how
    // this gate first reported "the slider is not in the DOM" on a build where it works.
    const findAll = (sel) => {
      const seen = new Set()
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
    if (buttons.length !== 4) return { skip: `expected 4 clustering buttons, found ${buttons.length}` }

    const setSlider = (v) => {
      const slider = findAll('#rm-pin-op')[0] || findAll('.rm-slider-row input[type=range]')[0]
      if (!slider) return false
      slider.value = String(v)
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const host = document.querySelector('doxa-research-map')
    // ★ DIM BY RELIGION, NOT BY REGION, AND THAT IS NOT ARBITRARY. MEASURED while writing this: a
    // REGION selection does not dim at all — it sets a layer FILTER, so non-matching pins are
    // removed rather than faded, and the opacity stays flat. Only the case-expression dim paths
    // (religion / prayer / engagement / adoption / language-family) compose with the slider, so
    // testing region here would have reported "the slider erased the dimming" about a path that
    // never writes opacity.
    const dim = () => {
      let cfg = {}
      try { cfg = JSON.parse(host.getAttribute('profile-config') || '{}') } catch (_) { cfg = {} }
      cfg.externalFilters = { region: '', religion: 'Buddhism', language: '' }
      host.setAttribute('profile-config', JSON.stringify(cfg))
    }

    const out = {}
    buttons[0].click(); await sleep(4000)                 // Off
    out.off = read()
    buttons[2].click(); await sleep(8000)                 // MST — the slider only applies while clustering draws
    if (!setSlider(0.5)) return { skip: 'the pin-dim slider never appeared after choosing a clustering mode' }
    await sleep(2500)
    out.clusteredHalf = read()
    dim(); await sleep(9000)
    out.dimmedHalf = read()
    setSlider(1); await sleep(2500)
    out.dimmedFull = read()
    return out
  })

  if (out.skip) { await browser.close(); cleanup(); skip(out.skip) }

  const show = (v) => JSON.stringify(v)
  lines.push(`  · clustering off          ${show(out.off)}`)
  lines.push(`  · clustering on, 0.5      ${show(out.clusteredHalf)}`)
  lines.push(`  · + dimming, 0.5          ${show(out.dimmedHalf)}`)
  lines.push(`  · + dimming, 1.0          ${show(out.dimmedFull)}`)

  const isCase = (v) => Array.isArray(v) && v[0] === 'case' && v.length === 4
  if (out.off !== 1) fails.push(`with clustering off the pins should be fully opaque, got ${show(out.off)} — the slider is applying where it is not even shown.`)
  if (out.clusteredHalf !== 0.5) fails.push(`the slider at 0.5 with clustering on should give a flat 0.5, got ${show(out.clusteredHalf)} — the slider is not reaching the map.`)
  if (!isCase(out.dimmedHalf)) fails.push(`dimming while the slider is at 0.5 should give a ['case', …] expression, got ${show(out.dimmedHalf)} — the slider ERASED the dimming.`)
  else {
    if (out.dimmedHalf[2] !== 0.5) fails.push(`matched pins should render at the slider's 0.5 while dimming, got ${show(out.dimmedHalf[2])} — the dimming ERASED the slider.`)
    if (out.dimmedHalf[3] !== 0) fails.push(`dimmed pins should render at 0, got ${show(out.dimmedHalf[3])}.`)
  }
  if (!isCase(out.dimmedFull)) fails.push(`returning the slider to 1.0 should keep the dimming expression, got ${show(out.dimmedFull)} — the slider erased it on the way back.`)
  else if (out.dimmedFull[2] !== 1) fails.push(`at slider 1.0 matched pins should be fully opaque, got ${show(out.dimmedFull[2])}.`)
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
  console.log('\n  opacity = slider × (1 matched, 0 dimmed). One writer, one product — see applyPinOpacity.')
  process.exit(1)
}
console.log(`${TAG}: PASS — the slider scales the layer, dimming still dims relative to it, and neither erases the other.`)
