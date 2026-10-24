/**
 * useEdgeScrollAffordance — the gray "you can scroll past this" edge strips.
 *
 * WHY THIS EXISTS AS ITS OWN COMPOSABLE
 * A pane that captures pointer input traps the page scroll. A Mapbox canvas does
 * it, but so does a tree-node/whiteboard pane, a big table, or any scrollable
 * child — the problem is a SCROLL-CAPTURING CHILD, not a map. This logic used to
 * live inside `useMapInstance`, which meant only map panes could have it. It is
 * lifted here unchanged so ANY pane can opt in.
 *
 * WHAT IT DOES
 * `.map-scroll-edge` strips (left + right, `pointer-events:auto`,
 * `touch-action:pan-y`) are always-present INVISIBLE hit-boxes. `pan-y` IS the
 * mechanism: a vertical drag on a strip scrolls the PAGE natively while the
 * capturing child keeps the centre. This paints the visible affordance so the
 * user can discover them. The gray indicator (a 36px gradient at the very page
 * edge) appears when:
 *   • you SCROLL — on the PRIMARY side only, which is the RIGHT edge on BOTH
 *     desktop and mobile;
 *   • you HOVER a strip (desktop) or TOUCH one (mobile) — on THAT strip, so
 *     either edge can be summoned where you reach for it. A HOVERED strip is
 *     pinned: it never auto-hides (even while you scroll) until you leave it.
 *
 * RIGHT is the primary side on EVERY form factor (since 2026-07-30): people
 * expect a scrollbar on the right, and a scroll hint that moves between edges
 * depending on device is the one thing it must not do. An earlier version flipped
 * to LEFT on mobile for thumb reach; consistency won. Both strips stay summonable
 * by hover/touch, so the left edge still works when you reach for it.
 *
 * Visibility toggles via OPACITY (not a background swap) so it fades rather than
 * hard-flashes, and the hit-box stays live the whole time.
 *
 * HISTORY worth keeping: `cooperativeGestures` (the two-finger-to-zoom
 * requirement) was REMOVED 2026-06-24 so one-finger interaction works normally —
 * this affordance is the single-finger page-scroll escape that replaced it.
 * Desktop click+drag-to-scroll was also removed then; on desktop the strip is a
 * hover indicator only.
 *
 * @param {HTMLElement|null} wrapper  element CONTAINING the .map-scroll-edge strips
 * @param {Object} [opts]
 * @param {boolean} [opts.enabled=true]  feature flag — false is a no-op returning a no-op detach
 * @returns {() => void} detach — removes every listener and hides the strips
 *
 * @example
 *   const detach = useEdgeScrollAffordance(wrapperEl)
 *   onBeforeUnmount(detach)
 */

const GRAY   = 'rgba(120, 128, 134, 0.28)'
const GRAY_W = '36px'
const NOOP   = () => {}

export function useEdgeScrollAffordance(wrapper, opts = {}) {
  const { enabled = true } = opts
  if (!enabled || !wrapper) return NOOP

  const edges = Array.from(wrapper.querySelectorAll('.map-scroll-edge'))
  if (!edges.length) return NOOP

  const isLeftStrip = (e) => e.classList.contains('map-scroll-edge--left')

  // Pre-paint each strip's gradient once; show/hide via opacity (faded).
  for (const e of edges) {
    e.style.background = `linear-gradient(${isLeftStrip(e) ? 'to right' : 'to left'}, ${GRAY} ${GRAY_W}, transparent ${GRAY_W})`
    e.style.opacity = '0'
    e.style.transition = 'opacity 0.16s ease'
    e.style.userSelect = 'none'
    e.style.webkitUserSelect = 'none'
  }

  const show = (e) => { e.style.opacity = '1' }
  const hide = (e) => { e.style.opacity = '0' }

  // Primary side: RIGHT on BOTH desktop and mobile (since 2026-07-30).
  // It used to flip to LEFT on mobile on a thumb-reach argument, but that made the
  // affordance appear on a different edge depending on device — the one place a
  // scroll hint must be predictable. People expect a scrollbar on the right, and
  // consistency across form factors beats the ergonomic micro-optimisation.
  // Both strips remain summonable by hover/touch, so the left edge still works.
  const primaryStrip = () => edges.find(e => !isLeftStrip(e)) || null

  const hovered = new Set()    // strips under the cursor — NEVER auto-hidden
  let touchingStrip = false    // a strip is being touched (mobile) — page-scroll flash defers to it
  let hideTimer = null

  // Hide every strip EXCEPT ones the mouse is over. A hovered strip must never
  // vanish — scrolling while hovered used to hide it, and you had to leave and
  // re-enter to get it back.
  const hideIdle = () => { for (const e of edges) if (!hovered.has(e)) hide(e) }

  // Scroll flash on the PRIMARY side, 250ms sliding hide.
  const flashPrimary = () => {
    const p = primaryStrip(); if (!p) return
    show(p)
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(hideIdle, 250)
  }

  // Wheel is desktop-shaped input, but the gate is no longer needed now that both
  // form factors flash the SAME (right) strip — a wheel event on a touch laptop
  // should light it too.
  const onWheel = () => flashPrimary()
  const onWrapTouchMove = (ev) => {
    // A one-finger drag on the CONTENT flashes the primary (right) side. A drag
    // that STARTS on an edge strip is handled by that strip's own
    // touchstart (lights that side, not the primary) — so skip it here.
    if (!(ev.touches && ev.touches.length === 1)) return
    const t = ev.target
    if (t && t.classList && t.classList.contains('map-scroll-edge')) return
    flashPrimary()
  }
  const onWrapTouchEnd = () => { if (hideTimer) clearTimeout(hideTimer); hideIdle() }

  wrapper.addEventListener('wheel', onWheel, { passive: true })
  wrapper.addEventListener('touchmove', onWrapTouchMove, { passive: true })
  wrapper.addEventListener('touchend', onWrapTouchEnd, { passive: true })
  wrapper.addEventListener('touchcancel', onWrapTouchEnd, { passive: true })

  // PARENT-PAGE scroll also flashes the indicator, so the affordance appears
  // whenever the user scrolls the HOST page — not only when interacting with the
  // pane content — teaching that the edges ARE scroll handles. Skipped while a
  // strip is being touched (that strip's own touchstart already lit it, and the
  // touch-drag is what scrolled the page). Note: relies on the page scrolling
  // `window`; hosts that scroll an inner container would need that element instead.
  const onPageScroll = () => { if (!touchingStrip) flashPrimary() }
  if (typeof window !== 'undefined') window.addEventListener('scroll', onPageScroll, { passive: true })

  // Per-strip: HOVER (desktop) pins+lights that strip until you leave it; TOUCH
  // (mobile) lights it while pressed.
  const stripCleanups = []
  for (const e of edges) {
    const onEnter  = () => { hovered.add(e); show(e) }
    const onLeave  = () => { hovered.delete(e); hide(e) }
    const onTStart = () => { touchingStrip = true; show(e) }
    const onTEnd   = () => { touchingStrip = false; hide(e) }
    e.addEventListener('mouseenter', onEnter)
    e.addEventListener('mouseleave', onLeave)
    e.addEventListener('touchstart', onTStart, { passive: true })
    e.addEventListener('touchend', onTEnd, { passive: true })
    stripCleanups.push(() => {
      e.removeEventListener('mouseenter', onEnter)
      e.removeEventListener('mouseleave', onLeave)
      e.removeEventListener('touchstart', onTStart)
      e.removeEventListener('touchend', onTEnd)
    })
  }

  return function detach() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    wrapper.removeEventListener('wheel', onWheel)
    wrapper.removeEventListener('touchmove', onWrapTouchMove)
    wrapper.removeEventListener('touchend', onWrapTouchEnd)
    wrapper.removeEventListener('touchcancel', onWrapTouchEnd)
    if (typeof window !== 'undefined') window.removeEventListener('scroll', onPageScroll)
    for (const c of stripCleanups) c()
    for (const e of edges) hide(e)
  }
}
