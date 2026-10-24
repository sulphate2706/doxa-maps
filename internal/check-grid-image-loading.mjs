#!/usr/bin/env node
/**
 * check-grid-image-loading — the people-group cards must not fetch 24 photos during boot.
 *
 * THE MEASUREMENT (SR-LOAD on 21ebb4f26): a cold load of Simple Research downloaded 24
 * people-group photos, 5.3 MB, DURING BOOT — competing with the map engine and the API data on the
 * same connection. Nothing was wrong with any single image; there was simply no instruction about
 * WHEN to fetch them, so the browser fetched them all at once.
 *
 * ★ WHY A GATE AND NOT JUST THE FIX. This component is being MERGED with the regions list right now
 * (a settled decision, built by the regions plugin), and a merge rewrites markup. Four attributes on
 * one <img> are exactly the kind of thing that survives a review and not a rewrite — and losing them
 * is invisible: the page still works, it just costs 5.3 MB again on every cold load.
 *
 * ★ AND IT ASSERTS THE FIRST ROW IS EAGER, which is the half a naive "add loading=lazy everywhere"
 * would get wrong. Lazy-loading what the reader is already looking at trades a visible flash of empty
 * cards for bytes nobody saves.
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'GRID-IMAGE-LOADING'
const F = 'plugin-designs/people-groups-grid/people-groups-grid.vue'
const fails = []
const src = readFileSync(join(ROOT, F), 'utf8')

const m = src.match(/<img\b[^>]*class="uupg__image"[^>]*>/s)
if (!m) {
  fails.push(`${F}: the card image element was not found — it was renamed or restructured, and this `
    + 'gate would pass while checking nothing. Re-point it before trusting a green run.')
} else {
  const tag = m[0]
  if (!/:loading=/.test(tag)) {
    fails.push('the card image has no loading attribute, so every photo is fetched during boot — '
      + 'a cold load measured 24 of them, 5.3 MB, competing with the map and the API data.')
  }
  if (!/decoding="async"/.test(tag)) fails.push('the card image does not decode off the main thread (decoding="async").')
  if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
    fails.push('the card image states no intrinsic size, so the box is unreserved before the '
      + 'stylesheet applies. (.uupg__image\'s aspect-ratio holds it afterwards; these cover the gap.)')
  }
  if (!/:fetchpriority=/.test(tag)) fails.push('off-screen images are not de-prioritised (fetchpriority).')
  // ★ the first row must be EAGER — a bare loading="lazy" would pass every check above and be wrong.
  if (/loading="lazy"/.test(tag) && !/:loading=/.test(tag)) {
    fails.push('the card image is UNCONDITIONALLY lazy, so the row the reader is already looking at '
      + 'loads late. The first row must stay eager.')
  }
  if (!/EAGER_IMAGES/.test(tag)) {
    fails.push('the eager/lazy split is not keyed on EAGER_IMAGES, so nothing ties it to the column count.')
  }
}
// and the constant must exist and be a plausible first-row ceiling
const c = src.match(/const EAGER_IMAGES\s*=\s*(\d+)/)
if (!c) fails.push('EAGER_IMAGES is gone; the first-row exemption has no source.')
else if (Number(c[1]) < 3 || Number(c[1]) > 8) {
  fails.push(`EAGER_IMAGES is ${c[1]} — the grid is repeat(auto-fill, minmax(240px, 1fr)), 1 column on a `
    + 'phone and 3-5 on a desktop, so a first-row ceiling outside 3..8 is either short (a visible '
    + 'lazy-load in view) or so generous it undoes the saving.')
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — card photos past the first row load lazily, at low priority, decoded off the main `
  + 'thread, with their box reserved; the first row stays eager.')
