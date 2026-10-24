#!/usr/bin/env node
/**
 * check-shot-distinctness.mjs — two README slots must not show the same thing.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, 2026-09-21)
 * README displayed cap4-upg100-list-page1.png and -page2.png under the captions "List — page 1"
 * and "List — page 2". They were the SAME VIEW. The generator loaded the same URL twice and tried
 * to reach a "page 2" by scrolling to the bottom and clicking a Next control —
 *
 *   ★ NEITHER EXISTS. my-upg-100-list has NO pagination: no Next button, no pages. And
 *     window.scrollTo is a no-op because the map fills the viewport.
 *
 * Every attempt sat inside `try {} catch {}`, so the misses were SILENT and the shot reported OK.
 * The two PNGs differed by 0.16% — pure render noise — so they were NOT byte-identical and no
 * checksum comparison would have caught them either.
 *
 * ★ WHILE A REAL PROFILE WENT UNSHOT. The bundle ships THREE manifest-listed profiles
 * (upg-100-mfe, upg-100-list, poster-wall) and poster-wall had no screenshot anywhere. The slot
 * was faking a fourth view while a genuine one was missing — the same shape as the cap-5 studio
 * mislabel found the day before. A missing artifact wearing a plausible one.
 *
 * WHAT IT CHECKS, AND THE ONE LEGITIMATE EXCEPTION
 * Two shots of the SAME URL at the SAME VIEWPORT cannot differ except by noise, so that pair is
 * always a defect. But the same URL at a DIFFERENT viewport is a real, intended figure:
 * deploy2-mobile-spa shoots doxa-maps-spa at 390x844 to show the Capacitor mobile surface, while
 * cap5-doxa-maps-spa shoots it at 1440x900 (2880x1800 vs 1170x2532 on disk). So the key is
 * (url + viewport), not url alone — a url-only rule would have a false positive on day one and
 * get switched off.
 *
 * WHY THIS AND check:shots BOTH EXIST
 * check:shots proves a PNG is newer than the bundle it shows — freshness. This proves two slots
 * are not the same picture — distinctness. A duplicate can be perfectly fresh.
 *
 * NEGATIVE-TESTED: re-adding a second shot of upg-100-list at the default viewport makes this
 * FAIL naming both; removing it returns PASS. The real deploy2/cap5 pair does NOT trip it.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'internal', 'readme-shots.mjs')
const OUT = join(ROOT, 'documentation', 'readme-images')

if (!existsSync(SRC)) {
  console.log('SHOT-DISTINCTNESS: SKIP — readme-shots.mjs not present.')
  process.exit(0)
}

const src = readFileSync(SRC, 'utf8')

// Each `await shot('name', '/path', { ...opts })` — capture the opts blob so we can read `vp`.
const RE = /shot\(\s*'([^']+)'\s*,\s*(?:'([^']*)'|`([^`]*)`)\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g
const shots = []
for (const m of src.matchAll(RE)) {
  const [, name, quoted, templated, opts = ''] = m
  const path = quoted ?? templated   // '…' or `/${TREE_NAME}/…` — compared as written, so either form is consistent
  const vp = opts.match(/vp:\s*\{\s*width:\s*(\d+)\s*,\s*height:\s*(\d+)/)
  shots.push({ name, path, vp: vp ? `${vp[1]}x${vp[2]}` : 'default' })
}

// A matcher that finds almost nothing reads exactly like a clean pass — see check-quoted-scripts.
// FLOOR: every `await shot(` call must be parsed. If not, the matcher has drifted from the file (it did
// once: a codemod turned the paths into template literals and this gate saw 2 of 26), so the result is
// NOT MEASURED (exit 75), never a pass and never a product failure.
const CALLS = src.split('\n').filter((l, i, a) => /await shot\(/.test(l) && !/shot-floor: dynamic/.test(a[i - 1] || '')).length
console.log(`SHOT-DISTINCTNESS: ${shots.length} shot(s) declared.`)
if (shots.length !== CALLS) {
  console.error(`\nSHOT-DISTINCTNESS: NOT MEASURED — parsed ${shots.length} of ${CALLS} shot( calls in readme-shots.mjs.`)
  console.error('  The MATCHER is out of date with the file, not the shot list. Fix the regex, then re-run.')
  process.exit(75)
}

const bySignature = new Map()
for (const s of shots) {
  const key = `${s.path}  @${s.vp}`
  if (!bySignature.has(key)) bySignature.set(key, [])
  bySignature.get(key).push(s.name)
}

const collisions = [...bySignature.entries()].filter(([, names]) => names.length > 1)

// Report the same-url/different-viewport pairs as intentional, so they stay visible.
const sameUrlDiffVp = new Map()
for (const s of shots) {
  if (!sameUrlDiffVp.has(s.path)) sameUrlDiffVp.set(s.path, new Set())
  sameUrlDiffVp.get(s.path).add(s.vp)
}
for (const [path, vps] of sameUrlDiffVp) {
  if (vps.size > 1) console.log(`  i SAME URL, DIFFERENT VIEWPORTS (intended): ${path} @ ${[...vps].join(', ')}`)
}

if (collisions.length) {
  console.error(`\nSHOT-DISTINCTNESS: FAIL — ${collisions.length} slot pair(s) capture the SAME view:`)
  for (const [key, names] of collisions) {
    console.error(`  ✗ ${names.join(' and ')}\n      both load ${key}`)
  }
  console.error(
    '\n  Two shots of one URL at one viewport cannot differ except by render noise, so they are\n' +
    '  not byte-identical and a checksum will not catch them. If a slot is meant to show a\n' +
    '  DIFFERENT state, drive it with an assertion that FAILS when the control is absent —\n' +
    '  a click wrapped in try/catch makes a missing feature look like a successful shot.\n' +
    '  And check first whether the state exists at all: the original defect was a "page 2"\n' +
    '  for a list that has no pagination, while a real third profile went unshot.'
  )
  process.exit(1)
}

// Belt and braces: identical bytes are always wrong, whatever the declared opts say.
if (existsSync(OUT)) {
  const seen = new Map()
  for (const s of shots) {
    const p = join(OUT, s.name + '.png')
    if (!existsSync(p)) continue
    const sig = `${statSync(p).size}`
    if (!seen.has(sig)) seen.set(sig, [])
    seen.get(sig).push(s.name)
  }
  const sameSize = [...seen.values()].filter((v) => v.length > 1)
  for (const group of sameSize) {
    console.log(`  i identical file size (check by eye if unexpected): ${group.join(', ')}`)
  }
}

console.log('SHOT-DISTINCTNESS: PASS — every slot captures a distinct url+viewport.')
