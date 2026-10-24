/**
 * pinHintFloor.js — the lowest point the pin-hint pill may reach (PinHint.vue's clampIntoView).
 *
 * The pill sits at the bottom of the map it belongs to. It is lifted only when something covers that
 * spot: the top of the phone legend sheet, the top of the map's licence credit, or, on an app-like page,
 * the bottom of the screen.
 *
 * ★ THE FOLD IS A FLOOR ONLY WHEN THE PAGE DOES NOT SCROLL. On a full-screen app page (a gallery pane,
 * a map leaf) the screen's bottom is the map's bottom, and a phone's browser bar can cover the last few
 * pixels, so the fold still counts there. On a page that SCROLLS (a partner home page with a map block in
 * it), the fold is only where the reader happens to be: a map whose bottom was below it on load lifted
 * the pill to mid-map, the settle timers and resize observers re-set it several times in the first
 * seconds, and a scroll never re-ran the clamp, so the pill hung mid-map and then dropped. There the
 * pill is placed once, at the map's bottom, whatever the scroll position.
 *
 * Pure (numbers in, a number out) so check:pin-hint-floor can prove both cases without a browser.
 */

/**
 * Does the map sit on a page that SCROLLS (a block in a longer page), as opposed to a full-screen app page?
 * Two ways a page scrolls: the document itself, or an INNER scroller around the map (a page that keeps html and
 * body at 100% and scrolls a container instead). The second is found by walking out from the pill (`fromEl`),
 * across shadow roots, for an ancestor with overflow-y auto/scroll/overlay whose content is taller than it.
 * On DX Life's /pray at 1440 the pill rode at the viewport's bottom until the map's own bottom came into view,
 * which is what a document-only test gives when the page scrolls an inner container.
 */
export function pageScrolls(doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null, fromEl = null) {
  try {
    const se = doc && (doc.scrollingElement || doc.documentElement)
    if (se && win && se.scrollHeight > win.innerHeight + 1) return true
    let el = fromEl
    for (let i = 0; el && i < 80; i++) {
      if (el.nodeType === 1 && win && typeof win.getComputedStyle === 'function') {
        const oy = win.getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) return true
      }
      const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null
      el = el.parentElement || (root && root !== el && root.host) || null
    }
    return false
  } catch (_) { return false }
}

/**
 * The floor in viewport pixels. Infinity means nothing below the pill's own spot is in the way.
 * @param {{ viewportH:number, scrolls:boolean, sheetTop?:number, creditTop?:number }} o
 */
export function pillFloor({ viewportH, scrolls, sheetTop = Infinity, creditTop = Infinity }) {
  const fold = scrolls ? Infinity : viewportH
  return Math.min(fold, sheetTop, creditTop)
}
