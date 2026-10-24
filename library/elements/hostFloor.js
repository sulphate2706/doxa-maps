/**
 * hostFloor.js — whether a profile's viewport floor applies, decided against its HOST (library/ProfileLoader.vue).
 *
 * The loader floors every profile at min-height:100svh, for a host whose height comes from its CONTENT (the
 * scroll-page leaf; BUG-UPG100). A host that is SIZED from outside (DX Life's map slot: a definite height, overflow
 * hidden) must be filled exactly: there the floor made the map taller than its host and clipped its legend.
 *
 * ★ PROBED AT MOUNT; AFTER THAT, ONLY WHEN THE HOST CHANGES KIND, AND WITHOUT A TRACE. Which kind of host this is
 * cannot be read from CSS, so it is MEASURED: the floor at 0, then at a huge value; a sized host keeps its height,
 * a content-sized one grows (and one that stops growing below the floor is CAPPED, by max-height). At mount the
 * profile has not rendered, so that probe touches no reader state.
 * The regression this replaces: re-probing on EVERY host resize collapsed the loader under live content, clamped a
 * scrolling child's scrollTop, and the embedded UPG-100 app (its view follows its column's scroll) flipped from Map
 * back to its first view whenever a phone's URL bar resized the host. So after mount follow() re-probes ONLY when
 * the reading says the kind may have changed, and that re-probe saves every scrolled descendant and puts it back
 * before the frame paints:
 *   - floor on, host SHORTER than the floor: sized from outside (styled after mount), or capped. Re-probe decides;
 *     a capped host is latched until it reaches the floor again, so it is never re-probed in a loop;
 *   - floor off (sized), host CHANGED size: it may have stopped holding a size (restyled to height:auto, now
 *     following its content). Re-probe decides, and the floor comes back if so;
 *   - a window-height change on a content-sized host moves the host WITH the floor: no re-probe, nothing written.
 * check:host-floor pins all of this, with the old per-resize probe, a missing latch, a missing sized re-check and a
 * missing scroll restore as poisons.
 */
const scrolledUnder = (root) => {
  const out = []
  const walk = (r) => {
    for (const e of r.querySelectorAll ? r.querySelectorAll('*') : []) {
      if (e.scrollTop || e.scrollLeft) out.push(e)
      if (e.shadowRoot) walk(e.shadowRoot)
    }
  }
  walk(root)
  return out
}

export function createHostFloor(loader, host, { style = (n) => getComputedStyle(n), scrolled = () => scrolledUnder(loader) } = {}) {
  let capped = false, lastH = null
  const isSized = () => loader.hasAttribute('data-host-sized')
  const floorPx = () => parseFloat(style(loader).minHeight) || 0
  const hostH = () => host.getBoundingClientRect().height
  function set(sized) {
    loader.style.minHeight = sized ? '0px' : ''
    if (sized) loader.setAttribute('data-host-sized', '')
    else loader.removeAttribute('data-host-sized')
  }
  function decide() {
    loader.style.minHeight = '0px'
    const h0 = hostH()
    loader.style.minHeight = '100000px'
    const h1 = hostH()
    const sized = h0 > 0 && Math.abs(h1 - h0) < 1
    set(sized)
    const f = sized ? 0 : floorPx()
    capped = !sized && f > 0 && h1 + 1 < f       // grows with its content, but stops below the floor
  }
  /** At mount only, before the profile renders. */
  function probeOnce() { decide(); lastH = hostH() }
  /** After mount: the same decision, leaving every scrolled descendant where it was. */
  function reprobe() {
    const kept = scrolled().map((e) => [e, e.scrollTop, e.scrollLeft])
    decide()
    for (const [e, top, left] of kept) { if (e.scrollTop !== top) e.scrollTop = top; if (e.scrollLeft !== left) e.scrollLeft = left }
  }
  /** On every host resize: reads, and re-probes only when the host may have changed kind. */
  function follow() {
    const display = style(host).display
    if (display === 'inline' || display === 'contents') return   // no box of its own to read
    const h = hostH()
    if (isSized()) {
      if (lastH === null || Math.abs(h - lastH) >= 1) reprobe()
    } else {
      const f = floorPx()
      if (capped) { if (h + 1 >= f) capped = false }
      else if (f > 0 && h + 1 < f) reprobe()
    }
    lastH = hostH()
  }
  return { probeOnce, follow }
}

export default createHostFloor
