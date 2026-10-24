#!/usr/bin/env node
/**
 * check-nav-reachable-mobile.mjs — on a phone, SOMETHING on screen must open the tab rail.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, found 2026-09-22 by resizing the cap-5 SPA to 414px).
 * VerticalTabsLayout renders its drawer toggle inside `<header v-if="header">`. The cap-5 DX-Maps
 * SPA runs header-OFF by default (the no-stacked-headers rule for embedding). At mobile
 * width the rail becomes an off-canvas drawer at translateX(-100%) with navOpen=false. So: the
 * drawer was off screen, the header holding the toggle did not exist, and the only other control
 * (.vtl-collapse) lives INSIDE the drawer — measured off screen at x:-244.
 *
 * Net effect: EVERY TAB EXCEPT THE ONE THAT HAPPENED TO OPEN WAS UNREACHABLE on a phone. Nothing
 * errored. The app painted. One tab worked. It simply could not be navigated.
 *
 * ★ WHY A SOURCE GREP CANNOT ANSWER THIS, and why the existing a11y gate does not either.
 * `check:a11y-button-names` asserts every button has an ACCESSIBLE NAME. That is a different
 * property and neither implies the other: the off-canvas collapse button had a perfectly good name
 * while sitting at x:-244, and a nameless button can be perfectly on screen. This gate asks the
 * question that one does not — CAN ANYONE ACTUALLY PRESS IT — and only a real layout can answer,
 * because reachability is geometry (transform, overflow, safe-area, z-order), not markup.
 *
 * ★ IT IS AN INTERSECTION BUG, which is why no single-configuration test caught it. Header-off is
 * correct. An off-canvas mobile drawer is correct. The defect lives only in their overlap. So this
 * gate checks the INTERSECTION directly: narrow viewport x each cap-5 shell as it actually ships.
 *
 * WHAT IT CHECKS, per cap-5 leaf, at a phone viewport:
 *   1. the rail is either already on screen, or
 *   2. at least one control that opens it is on screen AND has a non-empty accessible name, and
 *   3. pressing that control actually brings the rail on screen (the control is not merely present).
 * Assertion 3 is the load-bearing one: a present-but-inert opener is the same dead end wearing a
 * disguise, and asserting only presence is how the original bug survived a "verified" card.
 *
 * NEGATIVE-TESTED: forcing the opener off screen (or removing it) makes this FAIL naming the leaf;
 * restoring returns PASS. Zero cap-5 leaves found FAILS (vacuous guard).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const BASE = process.env.BASE || `http://127.0.0.1:4173/${TREE_NAME}/`

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees of this repo run on one machine and
// a default port belongs to whichever server started first — measured 2026-09-24, :4173 was another
// worktree's, and browser gates reported confidently on a build nobody here had touched. Exit 75
// (EX_TEMPFAIL) rather than 1: pointing at the wrong tree is a precondition, not a product defect,
// and the wave runner already reports 75 as ⊘ instead of ✗.
await requireThisTree(BASE, ROOT, 'NAV-REACHABLE-MOBILE')
// 414x896 = iPhone-class portrait, comfortably inside the layout's 760px breakpoint.
const VIEWPORT = { width: Number(process.env.W || 414), height: Number(process.env.H || 896) }

if (!existsSync(MANIFEST)) {
  console.log('NAV-REACHABLE: SKIP — no manifest.json (nothing built).')
  console.log('  Run `bun run build` first. An absent tree is not evidence either way.')
  process.exit(0)
}

const mf = JSON.parse(readFileSync(MANIFEST, 'utf8'))

// Only shells with a tab rail can have this defect: cap-5 (nested-mfe-spa). Derived from the BUILT
// manifest's declared type, not a hardcoded bundle list, so a new cap-5 is covered automatically.
const targets = []
for (const b of mf.bundles || []) {
  for (const p of b.profiles || []) {
    if (p.type === 'nested-mfe-spa') targets.push({ bundle: b.bundle, profile: p.profile })
  }
}

// Vacuous guard: "0 shells" must never read as "0 problems" — this repo ships two.
const MIN_SHELLS = 2
if (targets.length < MIN_SHELLS) {
  console.error(`NAV-REACHABLE: FAIL — found only ${targets.length} cap-5 shell(s) (expected >= ${MIN_SHELLS}).`)
  console.error('  The manifest is truncated or the type key changed. Refusing to pass vacuously.')
  process.exit(1)
}

let tk = ''
try {
  const r = await fetch('https://doxa.life/api/maps/token', { signal: AbortSignal.timeout(8000) })
  if (r.ok) tk = (await r.json()).token || ''
} catch { /* navigation chrome does not need a map token */ }

const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
const browser = await chromium.launch({ headless: true, args: GL })

// Runs INSIDE the page. Shadow DOM does not pierce, so every lookup is a deep walk with a seen-Set.
const PROBE = () => {
  const seen = new Set(); const all = []
  ;(function w(n) {
    if (!n || seen.has(n)) return; seen.add(n)
    if (n.tagName) all.push(n)
    if (n.shadowRoot) w(n.shadowRoot)
    for (const c of (n.children || [])) w(c)
  })(document.body)

  const cls = (n) => (n.className || '').toString()
  const onScreen = (n) => {
    const r = n.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const st = getComputedStyle(n)
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false
    // Fully outside the viewport in any direction = unreachable by touch.
    return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight
  }
  const name = (n) =>
    (n.getAttribute('aria-label') || n.getAttribute('title') || (n.textContent || '').trim()).slice(0, 40)

  const rail = all.find(n => /vtl-nav/.test(cls(n)))
  if (!rail) return { noRail: true }

  // Any control that can bring the rail on screen. All are legitimate: the header toggle when a
  // header exists; with none, the phone bar's ☰ (.vtl-phone-menu, app mode) or the corner ☰ (.vtl-fab,
  // web mode: a host page with its own site header).
  const openers = all
    .filter(n => n.tagName === 'BUTTON' && /vtl-menu|vtl-phone-menu|vtl-fab/.test(cls(n)))
    .map(n => ({ kind: /vtl-phone-menu/.test(cls(n)) ? 'phone-bar' : /vtl-fab/.test(cls(n)) ? 'corner' : 'header-menu', on: onScreen(n), name: name(n) }))

  return {
    railOnScreen: onScreen(rail),
    railX: Math.round(rail.getBoundingClientRect().x),
    openers,
    hasHeader: all.some(n => /vtl-top/.test(cls(n))),
  }
}

const failures = []
let checked = 0

for (const t of targets) {
  const page = await browser.newPage({ viewport: VIEWPORT })
  if (tk) await page.addInitScript(v => { window.MAP_TOKEN = v }, tk)
  const url = `${BASE}${t.bundle}/${t.profile}/index.html?cb=${Date.now()}`
            + (tk ? `&tk=${encodeURIComponent(tk)}` : '')
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  } catch {
    failures.push({ ...t, why: 'leaf did not load' }); await page.close(); continue
  }
  await page.waitForTimeout(3500)
  checked++

  const before = await page.evaluate(PROBE)

  if (before.noRail) { await page.close(); failures.push({ ...t, why: 'no .vtl-nav rail found in this shell' }); continue }
  if (before.railOnScreen) { await page.close(); continue }        // rail already visible: nothing to open

  const usable = (before.openers || []).filter(o => o.on)
  if (!usable.length) {
    failures.push({
      ...t,
      why: `rail is off screen (x:${before.railX}) and NO opener is on screen`,
      detail: `header:${before.hasHeader ? 'yes' : 'no'} · openers found: ` +
              ((before.openers || []).map(o => `${o.kind}(onScreen:${o.on})`).join(', ') || 'none'),
    })
    await page.close(); continue
  }
  const unnamed = usable.filter(o => !o.name)
  if (unnamed.length === usable.length) {
    failures.push({ ...t, why: 'the only on-screen opener has no accessible name' })
    await page.close(); continue
  }

  // ASSERTION 3 — press it and require the rail to actually arrive. Presence is not function.
  const after = await page.evaluate(() => {
    const seen = new Set(); const all = []
    ;(function w(n) {
      if (!n || seen.has(n)) return; seen.add(n)
      if (n.tagName) all.push(n)
      if (n.shadowRoot) w(n.shadowRoot)
      for (const c of (n.children || [])) w(c)
    })(document.body)
    const cls = (n) => (n.className || '').toString()
    const btn = all.find(n => n.tagName === 'BUTTON' && /vtl-menu|vtl-phone-menu|vtl-fab/.test(cls(n)) &&
                              n.getBoundingClientRect().width > 0)
    if (!btn) return { clicked: false }
    btn.click()
    return new Promise(res => setTimeout(() => {
      const s2 = new Set(); let rail = null
      ;(function w(n) {
        if (!n || s2.has(n)) return; s2.add(n)
        if (n.tagName && /vtl-nav/.test((n.className || '').toString()) && !rail) rail = n
        if (n.shadowRoot) w(n.shadowRoot)
        for (const c of (n.children || [])) w(c)
      })(document.body)
      const r = rail ? rail.getBoundingClientRect() : null
      res({ clicked: true, railX: r ? Math.round(r.x) : null, railOnScreen: !!r && r.x >= 0 && r.width > 0 })
    }, 600))
  })

  if (!after.clicked || !after.railOnScreen) {
    failures.push({
      ...t,
      why: `an opener is on screen but pressing it did NOT bring the rail in (rail x:${after.railX})`,
      detail: 'a present-but-inert opener is the same dead end wearing a disguise',
    })
  }
  await page.close()
}

await browser.close()

console.log(`NAV-REACHABLE: ${checked} cap-5 shell(s) checked at ${VIEWPORT.width}x${VIEWPORT.height}.`)

if (failures.length) {
  console.error(`\nNAV-REACHABLE: FAIL — ${failures.length} shell(s) cannot reach their tab rail on a phone:`)
  for (const f of failures) {
    console.error(`  ✗ ${f.bundle}/${f.profile}\n      ${f.why}`)
    if (f.detail) console.error(`      ${f.detail}`)
  }
  console.error(
    '\n  On a phone the rail is an off-canvas drawer, so a shell needs ONE on-screen control that\n' +
    '  opens it. The toggle inside <header v-if="header"> does not exist when a shell runs header-off,\n' +
    '  and the collapse control lives inside the drawer itself. Without a reachable opener every tab\n' +
    '  but the one that happened to open is unreachable — silently, with no error.'
  )
  process.exit(1)
}

console.log('NAV-REACHABLE: PASS — every cap-5 shell can reach its tab rail on a phone.')
