#!/usr/bin/env node
/**
 * check-map-unmount-mid-init — a map whose pane is removed WHILE it is still initialising must not throw.
 *
 * USAGE:   node internal/check-map-unmount-mid-init.mjs --url http://localhost:5299/
 * Graded by EXIT CODE: 0 = no map threw, 1 = a map threw, 2 = UNMEASURED (the race was not staged).
 *
 * ★ THE DEFECT (found by check:studio-all, 1 run in 4, 2026-09-25):
 *     Cannot read properties of null (reading 'getRootNode')
 *       at ensureEngineCSS (library/composables/useMapInstance.js)
 *       <- initializeMap (library/composables/useMapInstance.js)
 *       <- DashboardMapPanel.vue
 *   initializeMap is async. If its component unmounts during an await (a studio tab switch, a
 *   composite swapping a view), Vue nulls the container ref, and the next line dereferenced it.
 *
 * ★ WHY 1-IN-N IS NOT PROOF, AND HOW THIS MAKES IT DETERMINISTIC. The window is the time the engine
 *   script takes to load, so whether a tab switch lands inside it is luck. This gate removes the
 *   luck: it HOLDS the engine script request, opens a map plugin (its initializeMap suspends on the
 *   held script), switches the studio to a non-map plugin (which destroys the map pane — map rows are
 *   torn down on deactivate), and only then releases the script. Every run lands in the window.
 *   Negative-tested: fails every run on the unguarded composable, passes on the guarded one.
 *
 * It refuses to pass vacuously: if the script was never requested (preloaded) or the pane was not
 * actually removed before release, the race was not staged and it exits 2, not 0.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const i = process.argv.indexOf('--url')
const BASE = (i > -1 ? process.argv[i + 1] : '').replace(/#.*$/, '')
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(BASE, ROOT, 'MAP-UNMOUNT-MID-INIT')
if (!BASE) { console.error('check-map-unmount-mid-init: pass --url <studio page>'); process.exit(2) }

// Production map plugins that go through useMapInstance, opened by their studio key.
const CASES = [
  { key: 'doxa-research-map/research-map', tag: 'doxa-research-map' },
  { key: 'gospel-resources/gospel-dashboard', tag: 'gospel-resources-map' },
  { key: 'doxa-simple-map/doxa-simple-map', tag: 'doxa-map' }
]
const AWAY = 'doxa-vision-card'   // a non-map plugin to switch to

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
let failed = 0, unmeasured = 0
for (const c of CASES) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160) + '  [' + String(e.stack || '').split('\n').slice(1, 3).map((l) => l.trim().replace(/https?:\/\/[^/]+/, '')).join(' <- ') + ']'))
  page.on('console', (m) => { if (m.type() === 'error' && /useMapInstance|getRootNode|ZERO dimensions/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)) })

  let release = null, held = false
  const heldNow = new Promise((resolve) => {
    page.route(/mapbox-gl\.js(\?|$)/, async (route) => {
      held = true
      resolve()
      await new Promise((r) => { release = r })
      await route.continue()
    })
  })

  await page.goto(BASE + '#/' + c.key, { waitUntil: 'domcontentloaded' })
  const got = await Promise.race([heldNow.then(() => true), new Promise((r) => setTimeout(() => r(false), 30000))])
  if (!got) { console.log('UNMEASURED ' + c.key + ' — the engine script was never requested (preloaded?)'); unmeasured++; await page.close(); continue }

  // Switch away while initializeMap is suspended on the held script.
  await page.waitForFunction(() => {
    const s = document.querySelector('plugin-studio')
    return !!(s && s.shadowRoot && s.shadowRoot.querySelector('.st-row[aria-level="2"]'))
  }, null, { timeout: 30000 })
  await page.evaluate((away) => {
    const rows = [...document.querySelector('plugin-studio').shadowRoot.querySelectorAll('.st-row[aria-level="2"]')]
    const r = rows.find((x) => x.querySelector('.st-label').textContent.trim() === away)
    if (r) r.click()
  }, AWAY)
  await page.waitForTimeout(600)
  const stillMounted = await page.evaluate((tag) => !!document.querySelector('plugin-studio').shadowRoot.querySelector('.ps-slot ' + tag), c.tag)
  if (stillMounted) { console.log('UNMEASURED ' + c.key + ' — its pane was not removed before the script was released'); unmeasured++; release(); await page.close(); continue }

  release()
  await page.waitForTimeout(4000)
  if (!held) unmeasured++
  if (errors.length) { failed++; console.log('FAIL ' + c.key + '\n     ' + [...new Set(errors)].join('\n     ')) }
  else console.log('ok   ' + c.key + ' — unmounted mid-initialise, released the engine, no error')
  await page.close()
}
await browser.close()
if (failed) { console.log('MAP-UNMOUNT-MID-INIT: FAIL — ' + failed + ' of ' + CASES.length + ' maps threw after unmounting mid-initialise'); process.exit(1) }
if (unmeasured) { console.log('MAP-UNMOUNT-MID-INIT: UNMEASURED — ' + unmeasured + ' case(s) did not stage the race'); process.exit(2) }
console.log('MAP-UNMOUNT-MID-INIT: PASS — ' + CASES.length + ' maps unmounted mid-initialise without an error')
