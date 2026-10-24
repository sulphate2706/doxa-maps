#!/usr/bin/env node
/**
 * check-host-floor.mjs — the profile floor is decided against the host WITHOUT disturbing live content.
 *
 * library/elements/hostFloor.js (used by ProfileLoader.vue) probes the host at mount, and after that re-probes ONLY
 * when the host may have changed kind, saving and restoring every scrolled descendant. The regression this pins:
 * the probe ran on EVERY host resize, collapsing the loader under live content; a scrolling child's scrollTop was
 * clamped to 0 and the embedded UPG-100 app flipped from Map back to its first view whenever a phone's URL bar
 * resized the host.
 *
 * A stub DOM models the layout that matters: the host's height from its mode and the loader's min-height, the
 * floor (100svh) as a number the test moves like a window resize, and a scrolled CHILD whose scrollTop clamps to 0
 * whenever the loader collapses.
 *   A. after mount, a content-sized host following a window resize, and a sized host that keeps its size, never
 *      write the loader's min-height nor move the child's scrollTop;
 *   B. a sized host (523 px) is filled: the floor goes off at mount;
 *   C. a host styled SHORTER than the floor after mount flips to sized ONCE, then stays;
 *   D. a host capped by max-height (600 < floor) is found at mount: 0 flips and 0 re-probes over 20 resizes;
 *   E. a max-height cap that arrives AFTER mount: at most 1 flip and 1 re-probe over 20 resizes, ends content-sized;
 *   F. a sized host restyled to height:auto with NO content gets the floor back;
 *   H. a sized host restyled to height:auto WITH in-flow content (420) gets the floor back: at most 1 flip over 20
 *      resizes, and the scrolled child keeps its scrollTop through the re-probe;
 *   G. an inline host is left alone after mount.
 * `--self-test`: the old per-resize probe (A), a missing capped latch (D/E re-probe in a loop), a missing re-check
 * of a sized host (H stays sized) and a missing scroll restore (H loses the child's scrollTop) must each FAIL.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'library/elements/hostFloor.js')
const asModule = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))

// mode: 'content' (height = max(content, min-height)), 'sized' (a fixed height), 'capped' (content-sized up to a cap)
function world({ mode = 'content', fixed = 523, cap = 600, content = 0, floor = 844, display = 'block' } = {}) {
  const w = { mode, fixed, cap, content, floor, display, writes: [], child: { scrollTop: 787 } }
  const attrs = new Set()
  const minPx = () => {
    const v = loader.style._min
    if (v === '' || v === undefined) return w.floor
    return parseFloat(v)
  }
  w.hostH = () => {
    if (w.mode === 'sized') return w.fixed
    const natural = Math.max(w.content, minPx())
    return w.mode === 'capped' ? Math.min(natural, w.cap) : natural
  }
  const loader = {
    style: {
      _min: '',
      get minHeight() { return this._min },
      set minHeight(v) {
        this._min = v; w.writes.push(v)
        if (v === '0px' && w.mode !== 'sized') w.child.scrollTop = 0   // the loader collapsed: the child clamps
      },
    },
    hasAttribute: (n) => attrs.has(n), setAttribute: (n) => attrs.add(n), removeAttribute: (n) => attrs.delete(n),
  }
  const host = { getBoundingClientRect: () => ({ height: w.hostH() }) }
  w.loader = loader; w.host = host
  w.style = (n) => (n === host ? { display: w.display, minHeight: '0px' } : { display: 'block', minHeight: (loader.style._min === '' ? w.floor : parseFloat(loader.style._min)) + 'px' })
  w.sized = () => attrs.has('data-host-sized')
  w.probes = () => w.writes.filter((v) => v === '100000px').length
  return w
}

async function audit(src) {
  const { createHostFloor } = await asModule(src)
  const fails = []
  let t = 0
  const make = (opts) => { const w = world(opts); w.f = createHostFloor(w.loader, w.host, { style: w.style, scrolled: () => (w.child.scrollTop ? [w.child] : []) }); return w }

  // A: content-sized host, a window resize moves the floor and the host with it
  { const w = make({ mode: 'content', content: 0 }); w.f.probeOnce(); w.child.scrollTop = 787; w.writes.length = 0
    for (const fl of [830, 760, 700, 844]) { w.floor = fl; w.f.follow() }
    if (w.child.scrollTop !== 787) fails.push(`A: a host resize after mount clamped a scrolled child (scrollTop 787 → ${w.child.scrollTop})`)
    if (w.writes.length) fails.push(`A: a host resize after mount wrote the loader's min-height (${w.writes.join(', ')})`)
    if (w.sized()) fails.push('A: a content-sized host was flipped to sized by a window resize') }
  { const w = make({ mode: 'sized', fixed: 523 }); w.f.probeOnce(); w.writes.length = 0; w.child.scrollTop = 300
    for (let i = 0; i < 4; i++) w.f.follow()
    if (w.writes.length || w.child.scrollTop !== 300) fails.push('A: a sized host\'s resize callbacks touched the loader') }
  // B
  { const w = make({ mode: 'sized', fixed: 523 }); w.f.probeOnce()
    if (!w.sized() || w.loader.style.minHeight !== '0px') fails.push('B: a sized host (523) is not filled (the floor stayed on)') }
  // C
  { const w = make({ mode: 'content' }); w.f.probeOnce(); let flips = 0, was = w.sized()
    w.mode = 'sized'; w.fixed = 600
    for (let i = 0; i < 10; i++) { t += 100; w.f.follow(); if (w.sized() !== was) { flips++; was = w.sized() } }
    if (!w.sized() || flips !== 1) fails.push(`C: a host sized after mount should flip to sized exactly once (flips ${flips}, sized ${w.sized()})`) }
  // D
  { const w = make({ mode: 'capped', cap: 600, content: 0 }); w.f.probeOnce(); let flips = 0, was = w.sized()
    for (let i = 0; i < 20; i++) { t += 50; w.f.follow(); if (w.sized() !== was) { flips++; was = w.sized() } }
    const probes = w.probes() - 1
    if (flips !== 0 || w.sized() || probes > 0) fails.push(`D: a max-height host flipped ${flips} time(s) / was re-probed ${probes} time(s) (it must be found at mount and left alone)`) }
  // E
  { const w = make({ mode: 'content', content: 0 }); w.f.probeOnce(); let flips = 0, was = w.sized(); const p0 = w.probes()
    w.mode = 'capped'; w.cap = 600
    for (let i = 0; i < 20; i++) { t += 50; w.f.follow(); if (w.sized() !== was) { flips++; was = w.sized() } }
    const probes = w.probes() - p0
    if (flips > 1 || w.sized() || probes > 1) fails.push(`E: a max-height cap that arrived after mount LOOPS or stays sized (flips ${flips}, re-probes ${probes}, sized ${w.sized()})`) }
  // H: sized → height:auto with in-flow content
  { const w = make({ mode: 'sized', fixed: 523 }); w.f.probeOnce(); w.child.scrollTop = 300; let flips = 0, was = w.sized()
    w.mode = 'content'; w.content = 420
    for (let i = 0; i < 20; i++) { t += 50; w.f.follow(); if (w.sized() !== was) { flips++; was = w.sized() } }
    if (w.sized()) fails.push('H: a sized host restyled to height:auto with content (420) stayed sized (the floor did not come back)')
    if (flips > 1) fails.push(`H: the sized → auto host flipped ${flips} times`)
    if (w.child.scrollTop !== 300) fails.push(`H: the re-probe moved a scrolled child (scrollTop 300 → ${w.child.scrollTop})`) }
  // F
  { const w = make({ mode: 'sized', fixed: 523 }); w.f.probeOnce(); w.mode = 'content'; w.content = 0; w.f.follow()
    // with the floor off and no content the host is 0 high; follow() must bring the floor back
    if (w.sized()) fails.push('F: a sized host that collapsed to 0 did not get the floor back') }
  // G
  { const w = make({ mode: 'content', display: 'inline' }); w.f.probeOnce(); w.writes.length = 0; w.floor = 700; w.f.follow()
    if (w.writes.length) fails.push('G: an inline host was acted on after mount') }
  return fails
}

const src = readFileSync(SRC, 'utf8')
if (process.argv.includes('--self-test')) {
  const poisons = [
    ['the old per-resize probe (follow() re-measures, no restore)', src.replace(/function follow\(\) \{/, 'function follow() { decide(); return;'), /^A: /],
    ['no latch for a capped host', src.replace('if (capped) { if (h + 1 >= f) capped = false }\n      else if', 'if'), /^[DE]: /],
    ['no re-check of a sized host', src.replace('if (lastH === null || Math.abs(h - lastH) >= 1) reprobe()', '/* no re-check */'), /^H: .*stayed sized/],
    ['no scroll restore in the re-probe', src.replace("for (const [e, top, left] of kept) { if (e.scrollTop !== top) e.scrollTop = top; if (e.scrollLeft !== left) e.scrollLeft = left }", ''), /^H: the re-probe moved/],
  ]
  let missed = 0
  for (const [name, poisoned, rx] of poisons) {
    if (poisoned === src) { console.log(`NOT MEASURED: the poison anchor for "${name}" moved`); process.exitCode = 75; continue }
    const f = await audit(poisoned); const hit = f.find((x) => rx.test(x))
    console.log(hit ? `✓ caught: ${name} -> ${hit}` : `✗ MISSED: ${name}`)
    if (!hit) missed++
  }
  if (missed) process.exitCode = 1
} else {
  const f = await audit(src)
  if (f.length) { for (const x of f) console.log('✗ ' + x); console.log(`FAIL check:host-floor (${f.length})`); process.exitCode = 1 }
  else console.log('PASS check:host-floor — probed at mount; after it, re-probed only on a change of kind and without moving a scrolled child; a window resize writes nothing; a sized host fills; late sizing flips once; a max-height cap never loops; a sized host restyled to auto (with or without content) gets the floor back; inline hosts are left alone')
}
