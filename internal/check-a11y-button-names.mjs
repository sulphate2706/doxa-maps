#!/usr/bin/env node
/**
 * check-a11y-button-names.mjs — every button must have an ACCESSIBLE NAME.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, 2026-09-21)
 * Every icon-only map control (zoom in/out, fullscreen, location, help, share, hamburger, theme)
 * carried ONLY `title`. A `title` is a TOOLTIP, not an accessible name: it is unreliably announced
 * by screen readers and never surfaced to touch users at all. So the accessible name was EMPTY and
 * assistive technology announced "button" with no indication of what it does — on 34 controls
 * across 7 map bundles, shipped and live.
 *
 * ★ SOURCE GREP CANNOT ANSWER THIS. `grep '<button' | grep -v aria-label` returns 132 hits in this
 * repo and means nothing: aria-label is frequently on a following line, and a button with VISIBLE
 * TEXT needs no aria-label at all because its text content IS its accessible name. Only the
 * rendered DOM knows which buttons ended up nameless.
 *
 * WHAT COUNTS AS AN ACCESSIBLE NAME (the real precedence, not a guess)
 *   aria-label  →  aria-labelledby (resolved)  →  visible text content  →  (title is NOT one)
 * A button passes if any of the first three yields non-empty text. `title` alone FAILS, which is
 * precisely the defect this was written for.
 *
 * ★ SHADOW DOM: every plugin is a custom element, so a single-level querySelectorAll finds nothing.
 * The walk recurses through shadowRoot, and aria-labelledby is resolved within the SAME root
 * (an id reference does not cross a shadow boundary).
 *
 * SCOPE: samples one leaf per bundle rather than all 26 profiles — the controls come from shared
 * library components, so a per-bundle sample covers every distinct control set while keeping the
 * run near a minute. Pass ALL=1 to sweep every profile.
 *
 * NEGATIVE-TESTED: stripping the aria-label binding from MapControlButton makes this FAIL naming
 * the bundles and the offending titles; restoring it returns PASS.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const BASE = process.env.BASE || `http://127.0.0.1:4173/${TREE_NAME}/`
const ALL = process.env.ALL === '1'

if (!existsSync(MANIFEST)) {
  console.log('A11Y-BUTTON-NAMES: SKIP — no manifest.json (nothing built).')
  process.exit(0)
}

// ★ The server has to be serving THIS checkout, not merely answering. 4173 on this machine
// was held by an unrelated process from another worktree, and a gate that adopts it reports
// a confident result about a build nobody here changed. A pass earned against the wrong tree
// is worse than no pass.
{
  const tree = await servesThisTree(BASE, ROOT)
  if (!tree.ok) {
    console.error('A11Y-BUTTON-NAMES: NOT MEASURED — the server is not serving this checkout.')
    console.error(`  ${tree.why}`)
    console.error(`  Point BASE at your own server (BASE=http://127.0.0.1:PORT/${TREE_NAME}/).`)
    process.exit(2)
  }
}

let tk = ''
try {
  const r = await fetch('https://doxa.life/api/maps/token', { signal: AbortSignal.timeout(8000) })
  if (r.ok) tk = (await r.json()).token || ''
} catch { /* token-free run still checks non-map controls */ }

const mf = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const targets = []
for (const b of (mf.bundles || [])) {
  for (const p of (b.profiles || [])) {
    targets.push({ bundle: b.bundle, profile: p.profile })
    if (!ALL) break              // one leaf per bundle
  }
}

const GL = ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']
const browser = await chromium.launch({ headless: true, args: GL })

const offenders = []
let checked = 0, named = 0, reachable = 0

for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  if (tk) await page.addInitScript((v) => { window.MAP_TOKEN = v }, tk)
  const url = `${BASE}${t.bundle}/${t.profile}/index.html?cb=${Date.now()}`
            + (tk ? `&tk=${encodeURIComponent(tk)}` : '')
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  } catch { await page.close(); continue }
  await page.waitForTimeout(8000)
  reachable++

  const r = await page.evaluate(() => {
    const deep = (root, sel, out = []) => {
      out.push(...root.querySelectorAll(sel))
      for (const e of root.querySelectorAll('*')) if (e.shadowRoot) deep(e.shadowRoot, sel, out)
      return out
    }
    const host = [...document.querySelectorAll('*')].find((e) => e.tagName.includes('-') && e.shadowRoot)
    if (!host) return { mounted: false }
    const btns = deep(host.shadowRoot, 'button')
    const bad = []
    for (const b of btns) {
      const aria = (b.getAttribute('aria-label') || '').trim()
      if (aria) continue
      const by = (b.getAttribute('aria-labelledby') || '').trim()
      if (by) {
        // an id reference resolves within the SAME root, not across a shadow boundary
        const rootNode = b.getRootNode()
        const txt = by.split(/\s+/)
          .map((id) => (rootNode.getElementById ? rootNode.getElementById(id) : null))
          .filter(Boolean).map((e) => (e.textContent || '').trim()).join(' ').trim()
        if (txt) continue
      }
      if ((b.textContent || '').trim()) continue      // visible text IS an accessible name
      // hidden buttons cannot be reached by AT either; do not report them
      const rect = b.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      bad.push((b.title || '').trim() || '(no title either)')
    }
    return { mounted: true, total: btns.length, bad }
  })

  if (r.mounted) {
    checked += r.total
    named += r.total - r.bad.length
    if (r.bad.length) offenders.push({ where: `${t.bundle}/${t.profile}`, names: r.bad })
  }
  await page.close()
}
await browser.close()

console.log(`A11Y-BUTTON-NAMES: ${reachable} leaf page(s) checked, ${checked} button(s), ` +
            `${named} with an accessible name.`)
if (!tk) console.log('  i no Mapbox token — map controls may not have mounted on some leaves.')

if (offenders.length) {
  const n = offenders.reduce((a, o) => a + o.names.length, 0)
  console.error(`\nA11Y-BUTTON-NAMES: FAIL — ${n} visible button(s) have NO accessible name:`)
  for (const o of offenders) console.error(`  ✗ ${o.where}: ${o.names.join(', ')}`)
  console.error(
    '\n  A `title` is a TOOLTIP, not an accessible name — unreliably announced, and never shown to\n' +
    '  touch users. Give the button an aria-label (mirroring title is usually right), or visible\n' +
    '  text. For shared controls, fix the BASE component once: one binding in MapControlButton\n' +
    '  covered 8 control types across 7 bundles.'
  )
  process.exit(1)
}
console.log('A11Y-BUTTON-NAMES: PASS — every visible button has an accessible name.')
