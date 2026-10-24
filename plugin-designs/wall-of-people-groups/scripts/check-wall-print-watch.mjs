#!/usr/bin/env node
/**
 * check-wall-print-watch — the Wall's HD poster print never prints silently incomplete. Headless.
 *
 * The print frame prints on its own 'load', which waits for every photo (library printInPlace.js);
 * src/printWatch.js reports while it waits. This asserts, with fake timers and a fake frame whose images
 * load over fake time, that the watch:
 *   - counts the photos as they load (the button's "Preparing the poster: n of 2,107 photos");
 *   - counts the ones that could not load (complete, no pixels), which the toast then names;
 *   - finishes exactly once, at 'load', or at the 10-minute ceiling for a load that never ends;
 *   - ends at once when the frame is gone, so the busy button never outlives it.
 * Two-sided: each rule is removed from a copy of printWatch.js (written to the OS temp folder, never into
 * the tree), and every copy must fail at least one arm.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = join(ROOT, 'plugin-designs/wall-of-people-groups/src/printWatch.js')
const TMP = mkdtempSync(join(tmpdir(), 'wall-print-watch-'))

// fake timers
let now = 0, seq = 0
const timers = new Map()
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id }
globalThis.clearTimeout = (id) => timers.delete(id)
globalThis.setInterval = (fn, ms) => { const id = ++seq; const t = { at: now + ms, fn, every: ms }; timers.set(id, t); return id }
globalThis.clearInterval = (id) => timers.delete(id)
function advanceTo(t) {
  for (;;) {
    let next = null
    for (const [id, x] of timers) if (x.at <= t && (!next || x.at < next[1].at)) next = [id, x]
    if (!next) break
    const [id, x] = next; now = x.at
    if (x.every) x.at += x.every; else timers.delete(id)
    x.fn()
  }
  now = t
}
function fakeWin(n) {
  const images = Array.from({ length: n }, () => ({ complete: false, naturalWidth: 0 }))
  const on = {}
  return { images, document: { images }, addEventListener: (type, fn) => { on[type] = fn }, fire: (type) => on[type] && on[type]() }
}
const settle = (win, k, fail = 0) => { for (let i = 0; i < k; i++) { win.images[i].complete = true; win.images[i].naturalWidth = i < fail ? 0 : 320 } }

async function arms(mod) {
  const out = []
  const ok = (c, what) => { if (!c) out.push(what) }
  // A. all load: progress climbs, onDone once at 'load' with 0 failed
  { now = 0; timers.clear(); const w = fakeWin(10), seen = [], done = []
    mod.watchPrintFrame(w, { onProgress: (c) => seen.push(c.n), onDone: (c) => done.push(c) })
    settle(w, 4); advanceTo(600); settle(w, 10); advanceTo(1200); w.fire('load'); advanceTo(700000)
    ok(seen[0] === 0 && seen.includes(4) && seen.includes(10), `progress counts the photos as they load (saw ${seen.join(',')})`)
    ok(done.length === 1 && done[0] && done[0].n === 10 && done[0].total === 10 && done[0].failed === 0, 'onDone once at load: 10 of 10, 0 failed') }
  // B. some fail: complete with no pixels are counted as failed
  { now = 0; timers.clear(); const w = fakeWin(10), done = []
    mod.watchPrintFrame(w, { onDone: (c) => done.push(c) })
    settle(w, 10, 3); advanceTo(1000); w.fire('load')
    ok(done.length === 1 && done[0] && done[0].failed === 3, `3 photos that could not load are counted (got ${done[0] && done[0].failed})`) }
  // C. a load that never ends: onDone once, at the ceiling
  { now = 0; timers.clear(); const w = fakeWin(10), done = []
    mod.watchPrintFrame(w, { onDone: (c) => done.push([now, c]) })
    settle(w, 6); advanceTo(599999)
    ok(done.length === 0, 'no onDone before the ceiling while the frame is still loading')
    advanceTo(600000)
    ok(done.length === 1 && done[0][0] === 600000 && done[0][1].n === 6, 'onDone once at the 10-minute ceiling, with the count so far') }
  // D. the frame is removed before its load: the watch ends at the next tick, not at the ceiling
  { now = 0; timers.clear(); const w = fakeWin(10), done = []
    mod.watchPrintFrame(w, { onDone: (c) => done.push([now, c]) })
    advanceTo(60000); w.closed = true; advanceTo(61000)
    ok(done.length === 1 && done[0][0] <= 61000 && done[0][1] === null, `a frame that is gone ends the watch within a tick (ended at ${done[0] ? done[0][0] : 'never'})`) }
  return out
}

let fails = []
const real = await import(pathToFileURL(SRC).href)
fails = await arms(real)
for (const f of fails) console.log('  FAIL  ' + f)

// planted defects: each must make at least one arm fail
const src = readFileSync(SRC, 'utf8')
const PLANTS = [
  ['failed photos are not counted', 'if (!im.naturalWidth) failed++', ''],
  ['no ceiling: a load that never ends never finishes', 'cap = setTimeout(() => finish(countImages(win)), ceilingMs)', 'cap = null'],
  ['no progress while loading', 'iv = setInterval(tick, every)', 'iv = null'],
  ['a removed frame holds the watch until the ceiling', 'if (win.closed) return finish(null); ', ''],
]
let planted = 0
for (const [name, from, to] of PLANTS) {
  if (!src.includes(from)) { fails.push(`SELF-TEST: the planted defect "${name}" no longer matches the source`); continue }
  const p = join(TMP, `printWatch.planted-${planted}.mjs`)   // printWatch.js imports nothing, so it runs from anywhere
  writeFileSync(p, src.replace(from, to))
  try { const bad = await arms(await import(pathToFileURL(p).href)); if (!bad.length) fails.push(`SELF-TEST: the planted defect "${name}" was not caught`); else planted++ }
  finally { rmSync(p, { force: true }) }
}
rmSync(TMP, { recursive: true, force: true })
if (fails.length) { console.log(`WALL-PRINT-WATCH: FAIL — ${fails.length}`); for (const f of fails) console.log('  - ' + f); process.exit(1) }
console.log(`WALL-PRINT-WATCH: PASS — the print counts its photos while they load, counts the ones that could not load, and finishes at load or at the ceiling; ${planted} planted defects each caught.`)
