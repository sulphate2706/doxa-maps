#!/usr/bin/env node
/**
 * check-frame-target — the language tree's framing constants, pinned with the reasons they exist.
 *
 * WHY THIS TEST EXISTS AT ALL. gospel-internet's maintainer inherited GiTree and had to read intent out
 * of structure: there is no "this took measuring" comment anywhere in that file. Asked which line they
 * would flag as load-bearing-but-arbitrary-looking, they named frame() and its four constants. Nobody
 * had written down what a 60 or an 8 was for, so the next refactor would have tidied them away.
 *
 * THE TWO BRANCH ASSERTIONS ARE THE POINT, more than the numbers:
 *   · REDUCED MOTION IS A DIFFERENT CALL. jumpTo, not easeTo with duration 0. Those are not the same
 *     instruction and the engines do not treat them as one, so a "simplification" to a single easeTo
 *     is a regression that no screenshot would show.
 *   · A SINGLE POINT IS NOT A TINY BOX. fitBounds on a degenerate extent zooms to nothing; a
 *     one-language family is an ordinary case. Collapsing the branches makes that family vanish.
 *
 * Pure input, pure output, no map — plus a recording fake to prove applyFrame issues the right CALL.
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { frameTarget, applyFrame } = await import(resolve(ROOT, 'library/charts/whiteboard/frame-target.js'))

const fails = []
const ok = (what, cond, detail = '') => { if (!cond) fails.push(`${what}${detail ? `\n      ${detail}` : ''}`) }

// ── nothing to frame must LEAVE THE CAMERA ALONE ────────────────────────────────────────────────
// Clearing a selection does not re-frame in GiTree (`if (id) frame(...)`), and this is the other half
// of that rule: a caller handed no coords gets no instruction, rather than a move to somewhere neutral.
ok('no coords -> no instruction', frameTarget([]) === null)
ok('null -> no instruction', frameTarget(null) === null)
ok('garbage coords -> no instruction, not a NaN camera', frameTarget([['x', null]]) === null)

// ── the two branches ────────────────────────────────────────────────────────────────────────────
const one = frameTarget([[10, 20]], { currentZoom: 3 })
ok('a single point CENTRES, it does not fit a degenerate box', one.kind === 'point')
ok('...at the point', JSON.stringify(one.center) === JSON.stringify([10, 20]))
ok('...at a floor zoom, never zooming OUT to frame one node', one.zoom === 6)
ok('...and keeps the reader in if they are already closer', frameTarget([[10, 20]], { currentZoom: 9 }).zoom === 9)
const many = frameTarget([[10, 20], [12, 24]])
ok('a real extent FITS', many.kind === 'bounds')
ok('...to the bounding box', JSON.stringify(many.bounds) === JSON.stringify([[10, 20], [12, 24]]))
// Coincident points are a real subtree shape, not a pathological one.
ok('coincident points take the point branch', frameTarget([[5, 5], [5, 5], [5, 5]]).kind === 'point')

// ── the constants, each asserted where its reason applies ───────────────────────────────────────
ok('padding 60 — the outermost nodes carry labels that extend past the point', many.padding === 60)
ok('maxZoom 8 — a two-language family must not fill the screen with its own neighbourhood gone', many.maxZoom === 8)
ok('duration 900 — a movement between two places, not a cut', many.duration === 900)

// ── ★ REDUCED MOTION IS A DIFFERENT CALL ────────────────────────────────────────────────────────
ok('reduced motion zeroes the duration (bounds)', frameTarget([[1, 2], [3, 4]], { reducedMotion: true }).duration === 0)
ok('reduced motion zeroes the duration (point)', frameTarget([[1, 2]], { reducedMotion: true }).duration === 0)
const calls = []
const fake = {
  easeTo: (a) => calls.push(['easeTo', a]), jumpTo: (a) => calls.push(['jumpTo', a]),
  fitBounds: (b, o) => calls.push(['fitBounds', b, o]),
}
applyFrame(fake, frameTarget([[1, 2]], { reducedMotion: true }))
ok('a reduced-motion POINT frame calls jumpTo — NOT easeTo with duration 0',
  calls.length === 1 && calls[0][0] === 'jumpTo', `called ${calls.map((c) => c[0]).join(', ') || 'nothing'}`)
calls.length = 0
applyFrame(fake, frameTarget([[1, 2]]))
ok('a normal POINT frame animates', calls.length === 1 && calls[0][0] === 'easeTo' && calls[0][1].duration === 900)
calls.length = 0
applyFrame(fake, frameTarget([[1, 2], [3, 4]], { reducedMotion: true }))
ok('a reduced-motion BOUNDS frame still uses fitBounds, at duration 0',
  calls.length === 1 && calls[0][0] === 'fitBounds' && calls[0][2].duration === 0)

// ── and a degenerate frame never breaks the board ───────────────────────────────────────────────
ok('a throwing map is survived, and says so', applyFrame({ fitBounds: () => { throw new Error('no') } },
  frameTarget([[1, 2], [3, 4]])) === false)
ok('no map, no crash', applyFrame(null, frameTarget([[1, 2]])) === false)
ok('no target, no call', applyFrame(fake, null) === false)

if (fails.length) {
  console.error('FRAME-TARGET: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('FRAME-TARGET: PASS — a single point centres rather than fitting a degenerate box, reduced motion JUMPS '
  + 'rather than animating for 0ms, and padding 60 / maxZoom 8 / duration 900 are pinned with their reasons.')
