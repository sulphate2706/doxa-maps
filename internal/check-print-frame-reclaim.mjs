#!/usr/bin/env node
/**
 * check-print-frame-reclaim — a print frame is kept until it has printed, and reclaimed after. Headless,
 * with fake timers and a fake frame, so "61 s" and "10 minutes" take no time at all.
 *
 * THE DEFECT THIS GUARDS (2026-09-29). openPrintFrame's autoprint prints on the frame's 'load', which
 * waits for every image. It also removed the frame 60 s after CREATION, loaded or not. The Wall's
 * poster loads 939 photos (132 MB), so on a connection below about 18 Mbps the frame was gone before
 * 'load': no print dialog, and nothing to say so. printImageBlob revoked its object URL on the same
 * clock, which blanks an image that has not loaded yet.
 *
 * ASSERTS, for openPrintFrame's frame AND printImageBlob's object URL:
 *   1. a frame whose 'load' arrives at 61 s is still there (so it prints), and is reclaimed 60 s later;
 *   2. a frame that never loads is reclaimed at the ceiling (10 minutes), and not before;
 *   3. afterprint reclaims at once.
 * `--impl=<path>` runs the same assertions against another copy of printInPlace.js; the copy before
 * this fix must FAIL arms 1 and 2 (the two-sided proof).
 * EXIT 0 pass · 1 fail
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const implArg = process.argv.find((a) => a.startsWith('--impl='))
const IMPL = implArg ? resolve(implArg.slice(7)) : resolve(ROOT, 'library/composables/printInPlace.js')

// ── fake timers: a clock that only moves when the test says so ────────────────────────────────────
let now = 0, seq = 0
const timers = new Map()
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id }
globalThis.clearTimeout = (id) => { timers.delete(id) }
function advanceTo(t) {
  for (;;) {
    let next = null
    for (const [id, x] of timers) if (x.at <= t && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x]
    if (!next) break
    timers.delete(next[0]); now = next[1].at; next[1].fn()
  }
  now = t
}
function reset() { now = 0; timers.clear() }

// ── a fake frame: records what was written, and whether it is still in the page ───────────────────
let frame = null
const body = { appendChild: (f) => { f.parentNode = body } }
globalThis.document = {
  body,
  createElement: () => {
    const listeners = {}
    frame = {
      parentNode: null, style: {}, html: '',
      setAttribute() {}, remove() { this.parentNode = null },
      contentDocument: { open() {}, write(s) { frame.html += s }, close() {} },
      contentWindow: { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) } },
      fire(type) { for (const fn of listeners[type] || []) fn() },
    }
    return frame
  },
}
const revoked = []
globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u) => revoked.push([u, now]) }
const attached = () => !!(frame && frame.parentNode)

const { openPrintFrame, printImageBlob } = await import(pathToFileURL(IMPL).href)
const fails = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) fails.push(what) }

// ── openPrintFrame ─────────────────────────────────────────────────────────────────────────────────
reset(); openPrintFrame('<img src="x.jpg">', { autoprint: true })
check(frame.html.includes('window.print()'), 'autoprint writes its print-on-load bootstrap (control)')
advanceTo(61000)
check(attached(), "frame: a 'load' that arrives at 61 s finds the frame still there, so the poster prints")
frame.fire('load'); advanceTo(61000 + 59999)
check(attached(), "frame: kept for 60 s after its 'load' (the dialog is up)")
advanceTo(61000 + 60000)
check(!attached(), "frame: reclaimed 60 s after its 'load'")

reset(); openPrintFrame('<img src="x.jpg">', { autoprint: true })
advanceTo(599999)
check(attached(), 'frame: a load that never ends is not reclaimed before the ceiling')
advanceTo(600000)
check(!attached(), 'frame: a load that never ends is reclaimed at the 10-minute ceiling')

reset(); openPrintFrame('<img src="x.jpg">', { autoprint: true })
advanceTo(1000); frame.fire('load'); advanceTo(2000); frame.fire('afterprint'); advanceTo(2000)
check(!attached(), 'frame: afterprint reclaims it at once')

// ── printImageBlob's object URL ────────────────────────────────────────────────────────────────────
reset(); revoked.length = 0; printImageBlob({ size: 1 })
advanceTo(61000)
check(!revoked.length, "object URL: not revoked before a 'load' that arrives at 61 s (the preview would be blank)")
frame.fire('load'); advanceTo(61000 + 60000)
check(revoked.length === 1 && revoked[0][1] === 121000, "object URL: revoked 60 s after the frame's 'load'")

reset(); revoked.length = 0; printImageBlob({ size: 1 })
advanceTo(599999)
check(!revoked.length, 'object URL: a load that never ends keeps it until the ceiling')
advanceTo(600000)
check(revoked.length === 1, 'object URL: revoked at the 10-minute ceiling')

reset(); revoked.length = 0; printImageBlob({ size: 1 })
advanceTo(500); frame.fire('load'); frame.fire('afterprint'); advanceTo(500)
check(revoked.length >= 1 && revoked[0][1] === 500, 'object URL: afterprint revokes it at once')

if (fails.length) { console.log(`PRINT-FRAME-RECLAIM: FAIL — ${fails.length} case(s)  [${IMPL.replace(ROOT + '/', '')}]`); process.exit(1) }
console.log('PRINT-FRAME-RECLAIM: PASS — a print frame waits for its load however long it takes, is reclaimed 60 s after it, at afterprint, or at the 10-minute ceiling; its object URL follows the same clock.')
