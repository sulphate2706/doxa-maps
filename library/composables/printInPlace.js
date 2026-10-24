/**
 * printInPlace.js — SHARED (@map/composables/printInPlace.js).
 *
 * ★ THE ONE print mechanism, graduated VERBATIM from my-upg-100-list/poster-wall.vue
 * openPrintWindow() (commit e957cbe "Print the poster in place, on a portrait sheet") on the
 * ruling that killed the pop-up path: print must happen IN PLACE — no new browser
 * window, no pop-up blocker, the dialog rises over the page the user is looking at.
 *
 * WHY IT GRADUATES (library high bar: reusable + parameterized, 2+ consumers): the
 * prayer-walk-planner's print still used window.open(), and that is not just the rejected UX --
 * it is AGENT-HOSTILE. window.open() without a user gesture is pop-up-blocked, so
 * PrayerWalkPlanner.print() called from an agent (an agent can also create polygons and
 * trigger the print function) silently did nothing. An iframe cannot be blocked
 * and needs no gesture, which is what makes the same call work for a human click AND an agent.
 *
 * Mechanics preserved from the poster-wall original, each for a measured reason:
 *   - OFF-SCREEN 1x1, not display:none — a display:none iframe does not lay out in every
 *     engine, and a zero-height layout can print a blank first page.
 *   - autoprint appends the print bootstrap AFTER the caller's markup so it runs once the
 *     document is parsed (matches <img onload> timing).
 *   - afterprint, or 60 s after the frame has LOADED, reclaims the frame, so repeated prints never
 *     leak nodes. A 10-minute ceiling reclaims a frame whose load never ends.
 *
 * Returns the frame's contentWindow, or null when the host is sandboxed/detached (caller
 * keeps its own fallback).
 */

export function openPrintFrame(bodyHtml, { autoprint = false } = {}) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  if (!doc) { frame.remove(); return null }
  doc.open()
  doc.write(bodyHtml)
  if (autoprint) {
    doc.write(
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},150)})</' + 'script>')
  }
  doc.close()

  // ★ THE 60 s CLOCK STARTS AT 'load', NOT AT CREATION (2026-09-29). autoprint prints on 'load', which
  // waits for every image in the frame. The Wall's poster loads 939 photos (132 MB), so below about
  // 18 Mbps its 'load' came after 60 s, and the frame had already been removed: no dialog and no
  // message. afterprint still drops the frame at once; FRAME_CEILING_MS reclaims one that never loads.
  let ceiling = null
  const drop = () => { clearTimeout(ceiling); if (frame.parentNode) frame.remove() }
  ceiling = setTimeout(drop, FRAME_CEILING_MS)
  try {
    const win = frame.contentWindow
    win.addEventListener('afterprint', () => setTimeout(drop, 0))
    win.addEventListener('load', () => setTimeout(drop, FRAME_KEEP_MS), { once: true })
  } catch { setTimeout(drop, FRAME_KEEP_MS) /* cross-doc guard: no events to wait for */ }

  return frame.contentWindow
}

/**
 * ★ PHONES PRINT THE PAGE, NOT A FRAME (2026-09-30). openPrintFrame prints INSIDE a hidden iframe, and phone
 * browsers do not honour that: Chromium runs its whole print flow for the top-level frame only, and iOS Safari
 * previews a hidden iframe blank, prints the parent page instead, or ignores the call. Reported on a phone: the
 * poster, the prayer list and the card deck, and no print dialog ever opened.
 *
 * printDocument() is openPrintFrame(html, { autoprint: true }) everywhere EXCEPT a phone or tablet, byte for byte
 * as before. On a phone it mounts the document into THIS page, under a print-only stylesheet that hides every
 * other child of <body> (the host page and the gallery around the map included), and calls the page's own
 * window.print().
 *
 * A PHONE PRINT NEEDS A RECENT TAP. When preparing the document took long enough for the tap's activation to
 * expire (navigator.userActivation.isActive is false, e.g. after rasterising a poster), onNeedsTap(printNow,
 * cancel) hands the caller a printNow to call from a FRESH tap (a "Print" button) instead of a print() the browser
 * may ignore, and a cancel that removes the document if the reader walks away. A caller without its own progress UI
 * passes none and gets the shared Print bar (showTapToPrint).
 *
 * ★ ON A PHONE, AFTERPRINT IS NOT THE END OF THE PRINT (2026-10-02). Android Chrome's window.print() does not block,
 * and afterprint fires once the PREVIEW is built; the file "Save as PDF" writes is rendered later, after the reader
 * taps Save, from the page as it is THEN. The document used to be dropped at afterprint, so the preview showed a
 * packet's 11 pages and the saved PDF was the bare host page (one letter page with the page's own title). The
 * document is now kept until the reader is BACK on the page (mountPrintRoot says how), and onRelease is called then.
 *
 * @returns Promise<'frame' | 'page' | 'needs-tap' | 'blocked'>
 */
export async function printDocument(html, { onNeedsTap = null, imageWaitMs = 20000, labels = null, onRelease = null } = {}) {
  if (!isPhonePrint()) return openPrintFrame(html, { autoprint: true }) ? 'frame' : 'blocked'
  const job = mountPrintRoot(html, { onRelease })
  if (!job) return 'blocked'
  await job.imagesLoaded(imageWaitMs)
  const act = typeof navigator !== 'undefined' ? navigator.userActivation : null
  if (act && act.isActive === false) {
    const printNow = () => { if (job.live()) { job.printing(); window.print() } }
    if (typeof onNeedsTap === 'function') onNeedsTap(printNow, job.drop)
    else showTapToPrint(printNow, job.drop, labels || {})
    return 'needs-tap'
  }
  job.printing()
  window.print()
  return 'page'
}

/**
 * A phone or tablet: the engines whose print flow ignores a subframe. Detected by PLATFORM, because what differs is
 * the platform's print pipeline, which no feature test can see. iPadOS reports a Mac, so a Mac with touch points
 * counts as an iPad; a touchscreen laptop (Windows, ChromeOS) prints through the desktop pipeline and keeps the frame.
 */
export function isPhonePrint() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

/**
 * ★ THE SHARED PRINT BAR, for a caller with no progress UI of its own (the map's poster dialog, research-map, the
 * gospel tree, the prayer-walk planner, the wall of people groups). A small bar fixed at the bottom of the page with
 * one Print button (44 px) and a close, labelled by the CALLER (labels: { print, close }, from its own translator:
 * this file stays free of the i18n module, because gates load it in plain node and as a blob module); it sits outside
 * the print document, so it never prints. The poster wall shows the same button inside its own HUD instead (onNeedsTap).
 */
export const TAP_ID = 'dxm-print-tap'
function showTapToPrint(printNow, cancel, labels = {}) {
  if (typeof document === 'undefined' || !document.body) { printNow(); return }
  const old = document.getElementById(TAP_ID); if (old) old.remove()
  const bar = document.createElement('div')
  bar.id = TAP_ID
  bar.setAttribute('role', 'dialog')
  bar.setAttribute('aria-live', 'polite')
  bar.style.cssText = 'position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);'
    + 'z-index:2147483647;display:flex;gap:8px;align-items:center;padding:8px;border-radius:14px;background:#fff;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.25);font:16px/1.2 system-ui,sans-serif'
  const go = document.createElement('button')
  go.type = 'button'
  go.textContent = labels.print || 'Print'
  go.style.cssText = 'min-height:44px;min-width:96px;padding:0 18px;border:0;border-radius:10px;background:#3b463d;color:#fff;font:inherit;font-weight:600'
  const x = document.createElement('button')
  x.type = 'button'
  x.textContent = '\u00d7'
  x.setAttribute('aria-label', labels.close || 'Close')
  x.style.cssText = 'min-height:44px;min-width:44px;border:0;border-radius:10px;background:#eef0ec;color:#3b463d;font:inherit;font-size:22px'
  go.addEventListener('click', () => { bar.remove(); printNow() })
  x.addEventListener('click', () => { bar.remove(); cancel() })
  bar.append(go, x)
  document.body.appendChild(bar)
}

/** The id of the one in-page print document; a new print replaces the previous one. */
export const PRINT_ROOT_ID = 'dxm-print-root'
let currentJob = null

function mountPrintRoot(html, { onRelease = null } = {}) {
  if (typeof document === 'undefined' || !document.body || typeof DOMParser === 'undefined') return null
  if (currentJob) currentJob.drop()
  // EVERY BUNDLE CARRIES ITS OWN COPY OF THIS FILE, so currentJob only knows this bundle's root: a root (and its
  // print style) left by another map on the page is removed here too, or two documents would print together.
  for (const el of document.querySelectorAll('#' + PRINT_ROOT_ID + ', style[data-dxm-print]')) el.remove()
  const src = new DOMParser().parseFromString(String(html), 'text/html')
  const sel = '#' + PRINT_ROOT_ID
  // The document's own CSS applies in PRINT only, so it can never restyle the page on screen. Its html/body rules
  // reach the real html/body, as they did inside the frame. The resets come FIRST so the document's own rules win
  // over them; the !important ones undo a host's scroll lock (overflow:hidden would clip every page after the first).
  const css = [...src.querySelectorAll('style')].map((el) => el.textContent).join('\n')
  const style = document.createElement('style')
  style.setAttribute('data-dxm-print', '')
  style.textContent =
    `@media screen{${sel}{display:none!important}}`
    + '@media print{html,body{margin:0;padding:0;background:#fff}'
    + 'html:root,html:root body{overflow:visible!important;max-height:none!important}'
    + `html:root body>*:not(${sel}){display:none!important}${sel}{display:block!important}}`
    + `@media print{${css}}`
  const root = document.createElement('div')
  root.id = PRINT_ROOT_ID
  for (const a of ['lang', 'dir']) { const v = src.documentElement.getAttribute(a); if (v) root.setAttribute(a, v) }
  for (const n of [...src.body.childNodes]) root.appendChild(document.importNode(n, true))
  // A lazy image inside a display:none root would never load, and would print blank.
  for (const img of root.querySelectorAll('img')) img.loading = 'eager'
  document.head.appendChild(style)
  document.body.appendChild(root)

  // ★ KEPT UNTIL THE READER IS BACK, never dropped at afterprint (printDocument says why). From the moment print() is
  // called (printing(), not at mount: the Print tap that starts a late print must not count), the reader is back when
  // the page is shown again after being hidden, the window is focused again after losing focus, or the page is
  // touched (the system print UI covers the page, so a touch there means it has gone). A touch in the first
  // TOUCH_SETTLE_MS after print() does not count (a double tap while the preview builds). It goes BACK_GRACE_MS after
  // that, since a slow phone can still be writing the file after its dialog closes; if the page goes AWAY again during
  // the grace (the print UI opened after an early touch), the pending drop is cancelled and the next "back" counts. A
  // new print replaces it, a cancelled one drops it, and FRAME_CEILING_MS is the ceiling. On screen it is display:none,
  // so keeping it shows nothing.
  let ceiling = null, settle = null, armed = false, away = false, leaving = false, settling = false
  const back = () => { if (leaving) return; leaving = true; clearTimeout(ceiling); ceiling = setTimeout(drop, BACK_GRACE_MS) }
  const awayAgain = () => { away = true; if (leaving) { leaving = false; clearTimeout(ceiling); ceiling = setTimeout(drop, FRAME_CEILING_MS) } }
  const onVisibility = () => { if (document.visibilityState === 'hidden') awayAgain(); else if (away) back() }
  const onBlur = () => { awayAgain() }
  const onFocus = () => { if (away) back() }
  const onTouch = () => { if (!settling) back() }
  const job = {
    live: () => currentJob === job,
    drop,
    printing: () => {
      if (armed) return
      armed = true
      settling = true
      settle = setTimeout(() => { settling = false }, TOUCH_SETTLE_MS)
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onFocus)
      window.addEventListener('pointerdown', onTouch, true)
    },
    imagesLoaded: (ms) => {
      const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete)
      if (!pending.length) return Promise.resolve()
      const loads = pending.map((img) => new Promise((res) => {
        img.addEventListener('load', res, { once: true })
        img.addEventListener('error', res, { once: true })
      }))
      return Promise.race([Promise.all(loads), new Promise((res) => setTimeout(res, ms))])
    },
  }
  function drop() {
    clearTimeout(ceiling)
    clearTimeout(settle)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pointerdown', onTouch, true)
    root.remove()
    style.remove()
    if (currentJob === job) currentJob = null
    if (onRelease) { const done = onRelease; onRelease = null; try { done() } catch { /* the caller's own clean-up */ } }
  }
  ceiling = setTimeout(drop, FRAME_CEILING_MS)
  currentJob = job
  return job
}

/** How long a print frame (and printImageBlob's object URL) is kept after the frame has loaded. */
export const FRAME_KEEP_MS = 60000
/** The absolute ceiling for a print frame whose load never ends. */
export const FRAME_CEILING_MS = 600000
/** A phone's in-page print document goes this long after the reader is back on the page (mountPrintRoot). */
export const BACK_GRACE_MS = 60000
/** A touch this soon after print() is not the reader coming back (a double tap while the preview builds). */
export const TOUCH_SETTLE_MS = 2000

/**
 * Print a rendered poster IMAGE, at its real paper size, through the same in-place frame.
 *
 * ★ THE RULE (2026-09-28): an "Export poster" button opens the PRINT DIALOG with a preview.
 * It never hands over a file. Simple Research was rendering a PNG and calling a download helper, so
 * the reader got doxa-prayer-poster.png in their downloads folder and no preview, no paper size, and
 * no way to print it without opening it somewhere else first. The dialog IS the preview: the sheet the
 * browser shows is the poster, at the size the spec asked for.
 *
 * @page carries the spec's own inches so the preview is not letter-shaped by default — a 8.5x11
 * poster previewed on A4 is a different document from the one that was rendered. margin:0 because the
 * renderer already composed the margins into the image; a second set would scale the poster down.
 *
 * The object URL is revoked on afterprint AND on the frame's own clock (60 s after it has loaded, or
 * the ceiling), since afterprint does not fire in every engine when the dialog is dismissed. Revoking
 * before the image has loaded would blank the preview, which is why that clock starts at 'load'.
 *
 * Returns true when the dialog was opened, false when the host blocked the frame — the caller decides
 * what to do about it, because a silent no-op is exactly the failure this replaced.
 */
export function printImageBlob(blob, { widthIn = 8.5, heightIn = 11, title = '', alt = '', onNeedsTap = null, labels = null } = {}) {
  if (!blob || typeof URL === 'undefined' || !URL.createObjectURL) return false
  const url = URL.createObjectURL(blob)
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // The image is sized by the PAGE, not by its pixels: object-fit keeps a poster rendered at any DPI
  // on its own sheet without cropping. The <img> also gates the print — openPrintFrame's bootstrap
  // waits for load, which is what keeps the first page from printing blank.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>`
    + `<style>@page{size:${widthIn}in ${heightIn}in;margin:0}`
    + 'html,body{margin:0;padding:0;background:#fff}'
    + 'img{display:block;width:100%;height:100%;object-fit:contain}</style></head>'
    + `<body><img src="${url}" alt="${esc(alt || title)}"></body></html>`
  // A PHONE PRINTS THE PAGE (printDocument). The object URL lives as long as the in-page document does: until the
  // reader is back on the page, a new print or the ceiling, NEVER afterprint (a saved PDF is rendered after it).
  if (isPhonePrint()) {
    const release = () => { try { URL.revokeObjectURL(url) } catch { /* gone */ } }
    printDocument(html, { onNeedsTap, labels, onRelease: release }).then((how) => { if (how === 'blocked') release() }, release)
    return true
  }
  const win = openPrintFrame(html, { autoprint: true })
  if (!win) { URL.revokeObjectURL(url); return false }
  let ceiling = null
  const revoke = () => { clearTimeout(ceiling); try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
  ceiling = setTimeout(revoke, FRAME_CEILING_MS)
  try {
    win.addEventListener('afterprint', () => setTimeout(revoke, 0))
    win.addEventListener('load', () => setTimeout(revoke, FRAME_KEEP_MS), { once: true })
  } catch { setTimeout(revoke, FRAME_KEEP_MS) /* cross-doc guard */ }
  return true
}

/**
 * Print THIS page (not a frame) once the things it draws have finished drawing, with a busy state
 * the whole time — the ONE shared version of a pattern that exists five times in this repo today
 * (upg-100-list.vue c54a11d5a, four in exp's plugins 786a83461, PeopleGroupsWall.printWall).
 *
 * ★ WHY A HELPER RATHER THAN THE FIVE COPIES: they agree on the easy half (set a flag, print, clear
 * the flag) and each invents the hard half — what "ready" means, and what happens when ready never
 * arrives. The hard half is the one that strands a reader.
 *
 * ★ THE TIMEOUT PRINTS. It does not reject and it does not cancel. A reader who clicked Print and
 * waited has asked for paper; a slow tile server is a reason to print a plainer map, not a reason to
 * produce nothing. The return value says which happened so a caller can say so if it wants.
 *
 * ★ onBusy IS CALLED IN A finally. Every path clears it: a wait that rejects, a print that throws,
 * a dialog dismissed instantly, a host with no window.print at all. A busy state that can outlive
 * its own operation is worse than no busy state, because the page looks broken rather than slow.
 *
 * @param waitFor   promises to settle before printing. Rejections are swallowed on purpose: a map
 *                  that failed to report readiness must not also cost the reader their printout.
 * @param onBusy    (busy: boolean) => void — drives the caller's own indicator.
 * @param timeoutMs ceiling on the wait. 0 or negative prints immediately.
 * @returns 'ready' | 'timeout' | 'no-print' — what actually happened.
 */
export async function printWhenReady({ waitFor = [], onBusy = null, timeoutMs = 8000 } = {}) {
  const busy = (v) => { try { if (onBusy) onBusy(v) } catch { /* a caller's indicator must not break printing */ } }
  busy(true)
  let outcome = 'ready'
  let timer = null
  try {
    const waits = (Array.isArray(waitFor) ? waitFor : [waitFor]).filter(Boolean)
    if (waits.length && timeoutMs > 0) {
      // Settled, not all: one waiter that rejects should not skip the others or the print.
      const settled = Promise.allSettled(waits).then(() => 'ready')
      const expired = new Promise((res) => { timer = setTimeout(() => res('timeout'), timeoutMs) })
      outcome = await Promise.race([settled, expired])
    }
    if (typeof window === 'undefined' || typeof window.print !== 'function') return (outcome = 'no-print')
    window.print()
    return outcome
  } finally {
    if (timer) clearTimeout(timer)
    busy(false)
  }
}
