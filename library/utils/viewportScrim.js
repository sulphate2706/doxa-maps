/**
 * viewportScrim.js — make a `position:fixed` full-screen SCRIM actually cover the VIEWPORT,
 * in every host, including one that has captured the fixed containing block.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
 * A modal scrim is written `position:fixed; inset:0` on the assumption that fixed coordinates are
 * viewport coordinates. That holds only while NOTHING in the ancestor chain establishes a
 * containing block for fixed descendants. VerticalTabsLayout — the cap-5 shell every plugin is
 * hosted in as a tab — sets `contain:layout` on .vtl-content, so inside the studio the SAME scrim
 * stretches to the CONTENT PANE instead. MEASURED 2026-09-22 at a 1280x900 viewport, probe
 * inserted into each component's real parent chain in the running studio:
 *
 *     upg poster-wall .modal-scrim ......... 1024x793 @ (256,107)
 *     PosterWall .modal-scrim .............. 1024x793 @ (256,107)
 *     DataTable .dt-scrim .................. 1024x793 @ (256,107)
 *     SemanticTreeLegend / LegendTools ..... 1024x793 @ (256,107)
 *     ...all captured by: div.vtl-content [contain:layout]
 *
 * 256 is the rail width and 107 the header height. The scrim still LOOKS like a modal — it dims
 * the pane it sits in — while leaving the rail and header UNCOVERED AND CLICKABLE behind it. That
 * is why this reads as cosmetic and is not: a modal that does not capture input is not modal.
 *
 * ── WHY NOT THE OBVIOUS FIXES ─────────────────────────────────────────────────────────────────
 * ✗ Drop `contain` from the layout. It is load-bearing for a different reason (it stops a rail
 *   collapse from reflowing a heavy mounted map) and removing it trades this bug for that one.
 *   Identical reasoning to FilterDropdown.fixedOrigin() — the fix belongs where the ASSUMPTION
 *   lives, not where the containment does.
 * ✗ width:100vw; height:100vh. MEASURED: fixes the SIZE but NOT the offset — the box still starts
 *   at (256,64), so it overflows off-screen right and bottom while the rail stays uncovered. A
 *   viewport-sized scrim in the wrong place is still the wrong scrim.
 * ✗ <Teleport to="body">. These components render INSIDE SHADOW ROOTS (measured: .dt-wrap's root
 *   is a ShadowRoot whose host is <cities-internet-map>). Teleporting to document.body leaves the
 *   shadow-scoped CSS behind and the modal renders UNSTYLED.
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────────────────────────
 * Do not ASSUME the containing block is the viewport — MEASURE it, exactly as fixedOrigin() does,
 * then subtract it and size to the viewport. Verified to produce 0,0 1280x900 inside the captured
 * pane. Correct in EVERY host, including hosts that do not exist yet: when nothing captures, the
 * measured origin is (0,0) and the style collapses to plain inset:0.
 *
 * ── SHADOW-DOM NOTE (a false reassurance this replaces) ───────────────────────────────────────
 * poster-wall.vue carried a comment saying "position:fixed inside a shadow root is still
 * viewport-relative, so this covers the whole app". The premise is TRUE and IRRELEVANT: a shadow
 * boundary scopes STYLES and SELECTORS, it does not create a containing block. What creates one is
 * transform / filter / perspective / backdrop-filter / will-change of those — or contain:layout|
 * paint|strict|content on an ancestor, which is exactly what the shell sets. Reasoning about the
 * shadow boundary answers a question nobody asked and hides the one that matters.
 *
 * USAGE (in any component that owns a fixed full-screen scrim):
 *     import { useViewportScrim } from '<path>/library/utils/viewportScrim.js'
 *     const { scrimRef, scrimStyle } = useViewportScrim(someOpenRef)
 *     <div v-if="open" ref="scrimRef" :style="scrimStyle" class="modal-scrim">
 * Keep the class: it still carries background, z-index, display/centring. Only the GEOMETRY moves
 * into the inline style, because only the geometry depends on the host.
 */
import { ref, shallowRef, watch, onBeforeUnmount } from 'vue'

/**
 * Measure the origin a `position:fixed` box inside `el` is laid out from.
 *
 * Reads the offset from a probe that is ITSELF position:fixed at 0,0: whatever it reports as its
 * client rect IS the origin this element's fixed coordinates will be measured from. offsetParent
 * walking is unreliable through shadow roots, so we measure rather than traverse.
 *
 * The probe MUST be inserted into the same parent as the real scrim so it shares the scrim's
 * ancestor chain, and therefore its containing block. A probe appended to document.body would
 * report the viewport even when the scrim is captured — confirming the assumption instead of
 * testing it.
 */
export function measureFixedOrigin(el) {
  const parent = el?.parentElement || el
  if (!parent || !parent.ownerDocument) return { x: 0, y: 0 }
  const probe = parent.ownerDocument.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;opacity:0'
  parent.appendChild(probe)
  const r = probe.getBoundingClientRect()
  probe.remove()
  return { x: r.left, y: r.top }
}

/**
 * The geometry half of a full-viewport scrim, as an inline style object.
 * Re-measured whenever the scrim opens and on resize — the rail can collapse while a modal is up,
 * which moves the pane origin without remounting anything.
 *
 * @param {import('vue').Ref} openRef  truthy while the scrim is rendered
 * @returns {{ scrimRef: import('vue').Ref, scrimStyle: import('vue').Ref<object> }}
 */
export function useViewportScrim(openRef) {
  const scrimRef = ref(null)
  const scrimStyle = shallowRef({ position: 'fixed', inset: '0' })

  const remeasure = () => {
    const el = scrimRef.value
    if (!el) return
    const o = measureFixedOrigin(el)
    // ★ NO `inset` KEY HERE. `inset` is a SHORTHAND for top/right/bottom/left; listing it beside
    // the longhands in one style object lets it win on serialization order and SILENTLY DROP them.
    // Measured exactly that: the element rendered `position:fixed; inset:auto; width:100vw;
    // height:100vh` — right size (1280x900), wrong place (287,895), because top/left never made it
    // into the inline style. Setting right/bottom to auto expresses "anchor by top/left only"
    // without ever naming the shorthand.
    // No capture (o is 0,0): this collapses to a box at 0,0 sized to the viewport — i.e. exactly
    // what inset:0 meant in the first place.
    // PIXELS FROM A MEASUREMENT rather than vw/vh: documentElement.clientWidth/Height is the
    // laid-out viewport box and excludes any classic scrollbar gutter, which is what a scrim
    // should cover. (Both forms measured identically once box-sizing was fixed below — the
    // 1324x944 reading that first looked like a unit problem was padding, not units.)
    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null)
    const vw = doc?.documentElement?.clientWidth || 0
    const vh = doc?.documentElement?.clientHeight || 0
    scrimStyle.value = {
      position: 'fixed',
      top: `${-o.y}px`,
      left: `${-o.x}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${vw}px`,
      height: `${vh}px`,
      // ★ REQUIRED, because box-sizing is NOT inherited into a shadow root from the host page's
      // reset (poster-wall.vue's own CSS says so at .tape). Several scrims carry padding — the upg
      // .modal-scrim has padding:22px to inset its dialog — so under the default content-box the
      // border box became width+44 x height+44: MEASURED 1324x944 for an explicit 1280px/900px.
      // inset:0 never exposed this because pinning all four edges sizes the BORDER box directly;
      // switching to width/height is what made box-sizing start to matter.
      boxSizing: 'border-box',
    }
  }

  // Measure AFTER the scrim is in the DOM — its own ancestors are what we are measuring.
  // TWO frames, not one: PosterDialog renders its backdrop inside a <transition>, so on the first
  // frame the element can be present but not yet laid out at its final place. Measuring once gave
  // a stale origin there. The second pass is idempotent when the first was already right, so this
  // costs nothing in the common case and removes a per-component timing assumption.
  watch(openRef, (v) => {
    if (!v) return
    requestAnimationFrame(() => { remeasure(); requestAnimationFrame(remeasure) })
  }, { flush: 'post' })

  const onResize = () => { if (openRef.value) remeasure() }
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
  onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener('resize', onResize) })

  return { scrimRef, scrimStyle }
}
