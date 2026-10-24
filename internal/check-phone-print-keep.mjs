#!/usr/bin/env node
/**
 * check-phone-print-keep.mjs — on a phone, the in-page print document outlives afterprint, so a saved PDF is the preview.
 *
 * THE DEFECT (2026-10-02, on a phone): UPG 100 → Print prayer packet. The print preview showed all 11 pages; "Save as
 * PDF" saved the WEBSITE (one letter page with the host page's title). On a phone printDocument mounts the document into
 * the page (#dxm-print-root plus a print-only style) and calls window.print(). It dropped both at afterprint, but
 * Android Chrome's print() does not block, afterprint fires once the PREVIEW is built, and the saved file is rendered
 * later, after the reader taps Save, from the page as it is then.
 *
 * A timeline on fake timers and a stub DOM, with an Android user agent (Playwright cannot reproduce Android's print
 * pipeline; a real phone is the real check):
 *   A. after print() and afterprint, the document and its print style are still mounted 30 s on (the Save render);
 *   B. it goes once the reader is BACK: the page shown again after being hidden, the window focused again after
 *      losing focus, or a touch after print(), then BACK_GRACE_MS later, not before;
 *   C. a late print (needs-tap): the Print tap itself does not count as being back, so the document is still
 *      mounted through the dialog;
 *   D. a reader who never comes back: dropped at FRAME_CEILING_MS, not before;
 *   E. printImageBlob: its object URL is NOT revoked at afterprint, and is revoked when the document goes;
 *   F. a new print replaces the previous document (one root mounted, and the previous one released);
 *   G. the desktop path is the frame, as before (printDocument's first line, verbatim);
 *   H. a touch AFTER the first TOUCH_SETTLE_MS, then the print UI opening (the page hidden, or the window blurred):
 *      the pending drop is cancelled, so the document is still mounted well past BACK_GRACE_MS in the UI, and goes
 *      after the next "back" (a measured hole in the first cut, found on a second read);
 *   I. a touch in the first TOUCH_SETTLE_MS after print() (a double tap while the preview builds) is not "back".
 * `--impl=<path>` runs the timeline against another copy (the pilot's, before this fix, fails A and E: the cause).
 * `--self-test`: the old drop at afterprint, no release when the reader is back, the listeners armed at mount (so the
 * Print tap drops it), no grace, printImageBlob revoking at afterprint, no ceiling, no cancel when the page goes away
 * again during the grace, and no touch settle window must each FAIL.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const implArg = process.argv.find((a) => a.startsWith('--impl='))
const SRC = implArg ? implArg.slice(7) : join(ROOT, 'library/composables/printInPlace.js')
const ROOT_ID = 'dxm-print-root'

// ── fake timers ─────────────────────────────────────────────────────────────────────────────────
let now = 0, seq = 0
const timers = new Map()
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id }
globalThis.clearTimeout = (id) => { timers.delete(id) }
function advance(ms) {
  const t = now + ms
  for (;;) {
    let next = null
    for (const [id, x] of timers) if (x.at <= t && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x]
    if (!next) break
    timers.delete(next[0]); now = next[1].at; next[1].fn()
  }
  now = t
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// ── a stub DOM: just what mountPrintRoot touches ────────────────────────────────────────────────────
function events() {
  const L = new Map()
  return {
    addEventListener(t, f) { if (!L.has(t)) L.set(t, []); L.get(t).push(f) },
    removeEventListener(t, f) { const a = L.get(t); if (a && a.indexOf(f) >= 0) a.splice(a.indexOf(f), 1) },
    fire(t) { for (const f of [...(L.get(t) || [])]) f({ type: t }) },
  }
}
function node(tag) {
  const n = {
    tag, id: '', attrs: {}, children: [], parent: null, textContent: '', style: {}, ...events(),
    setAttribute(k, v) { this.attrs[k] = String(v) }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    appendChild(c) { c.parent = this; this.children.push(c); return c },
    append(...cs) { for (const c of cs) this.appendChild(c) },
    remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null } },
    querySelectorAll() { return [] },
  }
  return n
}
let revoked = []
function world({ android = true, active = true } = {}) {
  now = 0; seq = 0; timers.clear(); revoked = []
  const body = node('body'), head = node('head')
  const doc = {
    body, head, visibilityState: 'visible', ...events(),
    createElement: (t) => node(t), importNode: (n) => n,
    getElementById: (id) => [...body.children, ...head.children].find((n) => n.id === id) || null,
    querySelectorAll: () => [...body.children.filter((n) => n.id === ROOT_ID), ...head.children.filter((n) => 'data-dxm-print' in n.attrs)],
  }
  globalThis.document = doc
  globalThis.window = { ...events(), prints: [], print() { this.prints.push(mounted()) } }
  globalThis.DOMParser = class { parseFromString() { return { querySelectorAll: (s) => (s === 'style' ? [{ textContent: '@page{size:letter portrait;margin:0}' }] : []), documentElement: { getAttribute: () => null }, body: { childNodes: [node('div')] } } } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    userAgent: android ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    userActivation: { isActive: active }, maxTouchPoints: android ? 5 : 0 } })
  globalThis.URL.createObjectURL = () => 'blob:stub/1'
  globalThis.URL.revokeObjectURL = (u) => { revoked.push([u, now]) }
}
const mounted = () => Boolean(document.body.children.find((n) => n.id === ROOT_ID)) && Boolean(document.head.children.find((n) => 'data-dxm-print' in n.attrs))
const rootCount = () => document.body.children.filter((n) => n.id === ROOT_ID).length
let bust = 0
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src + `\n// ${++bust}`).toString('base64'))

async function audit(src) {
  const fails = []
  const sample = await load(src)
  const FRAME_CEILING_MS = sample.FRAME_CEILING_MS || 600000, BACK_GRACE_MS = sample.BACK_GRACE_MS || 0, TOUCH_SETTLE_MS = sample.TOUCH_SETTLE_MS || 0
  if (!sample.FRAME_CEILING_MS || !sample.BACK_GRACE_MS || !sample.TOUCH_SETTLE_MS) fails.push('G: printInPlace.js does not export FRAME_CEILING_MS, BACK_GRACE_MS and TOUCH_SETTLE_MS (the timeline runs on, with 0 for each missing one)')
  const HTML = '<!doctype html><html><head><style>@page{size:letter portrait}</style></head><body><div>packet</div></body></html>'

  // A + B (hidden → visible)
  { world(); const m = await load(src); const how = await m.printDocument(HTML)
    if (how !== 'page' || window.prints.length !== 1 || !window.prints[0]) fails.push(`A: a phone print did not print the mounted document (returned ${how}, prints ${JSON.stringify(window.prints)})`)
    window.fire('afterprint'); advance(30000)
    if (!mounted()) fails.push('A: the print document was gone 30 s after afterprint; a PDF saved then is the bare page')
    document.visibilityState = 'hidden'; document.fire('visibilitychange'); advance(20000)
    if (!mounted()) fails.push('B: the document went while the page was hidden (the print dialog was still up)')
    document.visibilityState = 'visible'; document.fire('visibilitychange'); advance(BACK_GRACE_MS - 1)
    if (!mounted()) fails.push('B: the document went at once when the page was shown again (no grace for a job still rendering)')
    advance(2)
    if (mounted()) fails.push('B: the document stayed after the reader was back on the page (shown again) and the grace')
  }
  // B (blur → focus) and B (a touch after print)
  { world(); const m = await load(src); await m.printDocument(HTML); window.fire('afterprint'); window.fire('blur'); advance(10000)
    if (!mounted()) fails.push('B: the document went while the window had lost focus')
    window.fire('focus'); advance(BACK_GRACE_MS + 1)
    if (mounted()) fails.push('B: the document stayed after the window was focused again (back on the page)') }
  { world(); const m = await load(src); await m.printDocument(HTML); window.fire('afterprint'); advance(TOUCH_SETTLE_MS + 3000); window.fire('pointerdown'); advance(BACK_GRACE_MS + 1)
    if (mounted()) fails.push('B: the document stayed after the page was touched again') }
  // C: a late print (the tap's activation expired): the Print tap is not "back"
  { world({ active: false }); const m = await load(src); let printNow = null
    const how = await m.printDocument(HTML, { onNeedsTap: (p) => { printNow = p } })
    if (how !== 'needs-tap' || !printNow) fails.push(`C: an expired tap did not hand out printNow (returned ${how})`)
    else {
      // the reader taps Print a few seconds after the document is ready, then spends longer than the grace in the dialog
      advance(TOUCH_SETTLE_MS + 3000); window.fire('pointerdown'); printNow(); window.fire('afterprint'); advance(BACK_GRACE_MS + 20000)
      if (window.prints.length !== 1 || !window.prints[0]) fails.push('C: printNow did not print the mounted document')
      if (!mounted()) fails.push(`C: the Print tap counted as being back: the document was gone ${(BACK_GRACE_MS + 20000) / 1000} s into the dialog`)
    } }
  // D: never back
  { world(); const m = await load(src); await m.printDocument(HTML); window.fire('afterprint'); advance(FRAME_CEILING_MS - 1)
    if (!mounted()) fails.push('D: the document went before the ceiling with the reader never back')
    advance(2)
    if (mounted()) fails.push('D: the document outlived FRAME_CEILING_MS') }
  // E: printImageBlob's object URL
  { world(); const m = await load(src); m.printImageBlob({ size: 1 }, { title: 'poster' }); await flush()
    window.fire('afterprint'); advance(30000)
    if (revoked.length) fails.push(`E: printImageBlob revoked its object URL at ${revoked[0][1]} ms, before the reader was back (a saved PDF has no image)`)
    if (!mounted()) fails.push('E: printImageBlob\'s document was gone 30 s after afterprint')
    window.fire('pointerdown'); advance(BACK_GRACE_MS + 1)
    if (revoked.length !== 1) fails.push(`E: printImageBlob's object URL was revoked ${revoked.length} time(s) after the reader was back (expected once)`) }
  // F: a new print replaces the previous one
  { world(); const m = await load(src); let first = 0
    await m.printDocument(HTML, { onRelease: () => { first++ } }); window.fire('afterprint'); await m.printDocument(HTML)
    if (rootCount() !== 1) fails.push(`F: ${rootCount()} print roots mounted after a second print (expected 1)`)
    if (first !== 1) fails.push(`F: the first print's onRelease ran ${first} time(s) when a second print replaced it (expected 1)`) }
  // H: a touch after the settle window, then the print UI opens: away again cancels the pending drop
  for (const via of ['hidden', 'blur']) {
    world(); const m = await load(src); await m.printDocument(HTML); advance(TOUCH_SETTLE_MS + 500); window.fire('pointerdown'); advance(500)
    if (via === 'hidden') { document.visibilityState = 'hidden'; document.fire('visibilitychange') } else window.fire('blur')
    window.fire('afterprint'); advance(BACK_GRACE_MS + 20000)
    if (!mounted()) fails.push(`H: a touch, then the print UI (${via}): the grace the touch started was not cancelled, and the document went while the reader was still in the UI (a PDF saved then is the bare page)`)
    else {
      if (via === 'hidden') { document.visibilityState = 'visible'; document.fire('visibilitychange') } else window.fire('focus')
      advance(BACK_GRACE_MS + 1)
      if (mounted()) fails.push(`H: after the print UI (${via}) closed, the document stayed past the grace (the next "back" did not count)`)
    }
  }
  // I: a touch in the settle window (no hide, no blur: an in-page sheet) is not "back"
  { world(); const m = await load(src); await m.printDocument(HTML); advance(Math.max(1, TOUCH_SETTLE_MS - 1500)); window.fire('pointerdown'); advance(BACK_GRACE_MS + 30000)
    if (!mounted()) fails.push('I: a touch right after print() (a double tap while the preview builds) counted as being back, and the document went with the dialog still up') }
  // G: desktop unchanged (the frame path)
  if (!src.includes("if (!isPhonePrint()) return openPrintFrame(html, { autoprint: true }) ? 'frame' : 'blocked'")) fails.push('G: printDocument\'s desktop path is no longer the frame, verbatim')
  return fails
}

const src = readFileSync(SRC, 'utf8')
if (process.argv.includes('--self-test')) {
  const MOUNT_END = '  ceiling = setTimeout(drop, FRAME_CEILING_MS)\n  currentJob = job\n'
  const poisons = [
    ['the old drop at afterprint', src.replace(MOUNT_END, "  window.addEventListener('afterprint', () => setTimeout(drop, 0))\n" + MOUNT_END), /^A: /],
    ['no release when the reader is back', src.replace('const back = () => { if (leaving) return; leaving = true; clearTimeout(ceiling); ceiling = setTimeout(drop, BACK_GRACE_MS) }', 'const back = () => {}'), /^B: the document stayed/],
    ['the listeners armed at mount (the Print tap drops it)', src.replace(MOUNT_END, '  ceiling = setTimeout(drop, FRAME_CEILING_MS)\n  job.printing()\n  currentJob = job\n'), /^C: the Print tap counted/],
    ['no grace once the reader is back', src.replace('ceiling = setTimeout(drop, BACK_GRACE_MS) }', 'drop() }'), /^B: the document went at once/],
    ['printImageBlob revoking at afterprint', src.replace("    const release = () => { try { URL.revokeObjectURL(url) } catch { /* gone */ } }\n", "    const release = () => { try { URL.revokeObjectURL(url) } catch { /* gone */ } }\n    window.addEventListener('afterprint', () => setTimeout(release, 0))\n"), /^E: printImageBlob revoked/],
    ['no ceiling', src.replace(MOUNT_END, '  currentJob = job\n'), /^D: the document outlived/],
    ['no cancel when the page goes away again', src.replace('const awayAgain = () => { away = true; if (leaving) { leaving = false; clearTimeout(ceiling); ceiling = setTimeout(drop, FRAME_CEILING_MS) } }', 'const awayAgain = () => { away = true }'), /^H: a touch, then the print UI/],
    ['no touch settle window', src.replace('const onTouch = () => { if (!settling) back() }', 'const onTouch = () => back()'), /^I: /],
  ]
  let missed = 0
  for (const [name, poisoned, rx] of poisons) {
    if (poisoned === src) { console.log(`NOT MEASURED: the poison anchor for "${name}" moved`); process.exitCode = 75; continue }
    const f = await audit(poisoned); const hit = f.find((x) => rx.test(x))
    console.log(hit ? `✓ caught: ${name} -> ${hit}` : `✗ MISSED: ${name}${f.length ? ` (failed instead: ${f[0]})` : ''}`)
    if (!hit) missed++
  }
  if (missed) process.exitCode = 1
} else {
  const f = await audit(src)
  if (f.length) { for (const x of f) console.log('✗ ' + x); console.log(`FAIL check:phone-print-keep (${f.length})`); process.exitCode = 1 }
  else console.log('PASS check:phone-print-keep — on a phone the print document (and printImageBlob\'s image) outlives afterprint, so a PDF saved after the preview is the document; it goes once the reader is back (shown, focused or touched again) plus a grace, or at the ceiling; the Print tap of a late print and a touch right after print() do not count; going away again cancels a pending drop; a new print replaces it; desktop prints through the frame as before')
}
