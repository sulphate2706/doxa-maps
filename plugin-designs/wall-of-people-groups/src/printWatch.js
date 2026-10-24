/**
 * printWatch.js — counts a print frame's photos while they load, and how many could not load.
 *
 * The frame prints on its own 'load' (library/composables/printInPlace.js), and 'load' waits for every
 * photo, so this never decides WHEN to print: it only reports. The HD poster loads up to 2,107 photos
 * (132 MB), which can take minutes on a slow connection, so the reader sees a count instead of a busy
 * button. A photo that could not load is complete but has no pixels, and prints as a grey box, so the
 * caller says how many rather than printing silently incomplete.
 */

/** { n, total, failed } for the frame's images right now, or null when the frame cannot be read. */
export function countImages(win) {
  let imgs = null
  try { imgs = win.document.images } catch (_) { return null }
  if (!imgs) return null
  let n = 0, failed = 0
  for (const im of imgs) if (im.complete) { n++; if (!im.naturalWidth) failed++ }
  return { n, total: imgs.length, failed }
}

/**
 * Calls onProgress(count) now and every `every` ms while the frame loads, then onDone(count) exactly once:
 * at the frame's 'load', at `ceilingMs` for a load that never ends (the frame's own ceiling in
 * printInPlace.js), or with null as soon as the frame is gone (closed). Returns stop(), which ends the
 * watch without a count.
 */
export function watchPrintFrame(win, { onProgress = () => {}, onDone = () => {}, every = 500, ceilingMs = 600000 } = {}) {
  let iv = null, cap = null, over = false
  const finish = (c) => { if (over) return; over = true; clearInterval(iv); clearTimeout(cap); onDone(c) }
  // A frame removed before its 'load' (an older printInPlace dropped it 60 s after creation) never fires
  // 'load': end the watch then, rather than holding the busy button until the ceiling.
  const tick = () => { if (win.closed) return finish(null); const c = countImages(win); if (c && c.total) onProgress(c) }
  tick()
  if (over) return () => {}
  iv = setInterval(tick, every)
  cap = setTimeout(() => finish(countImages(win)), ceilingMs)
  try { win.addEventListener('load', () => finish(countImages(win)), { once: true }) } catch (_) { finish(null) }
  return () => finish(null)
}
