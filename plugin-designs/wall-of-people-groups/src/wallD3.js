/**
 * wallD3.js — the Wall's d3, pinned, integrity-checked and kept OFF the host page's window.
 *
 * CRITIC-9 / CRITIC-5 (the critic fact-check): the Wall loaded `d3@7` (a floating range, no SRI)
 * as a script tag, so it (a) could change underneath every partner without notice and (b) became
 * `window.d3`, overwriting a host page's own d3, or, if the host already had one, the Wall ran on
 * whatever version the host shipped. Now: one exact version, `integrity` + `crossorigin`, and the
 * library is captured into this module and the host's `window.d3` put back exactly as it was. The
 * loader itself is shared with pplr-data-maps: library/utils/loadPinnedUmd.js.
 */
import { CDN } from '@map/constants/cdn.js'
import { loadPinnedUmd } from '@map/utils/loadPinnedUmd.js'

let lib = null

/** The Wall's own d3 (null until ensureD3() has resolved). */
export function wallD3() { return lib }

/** d3 7.9.0, pinned with SRI, kept off the host's window.d3 (library/utils/loadPinnedUmd.js). */
export function ensureD3() {
  if (lib) return Promise.resolve(lib)
  return loadPinnedUmd(CDN.d3, 'd3').then((d3) => (lib = d3))
}
