/**
 * findScrollportAncestor — the nearest ancestor that actually scrolls.
 *
 * Used to decide where a map should hand the wheel back to the page, and to scroll a selected row
 * into view without moving the whole document.
 *
 * ⚠ THE WALK CROSSES SHADOW BOUNDARIES, and that is the whole reason this is not a two-line
 * `closest()`. `parentElement` stops at a shadow root, so a plugin mounted in a custom element would
 * find no scrollport at all and conclude the page does not scroll — the ladder therefore steps
 * `parentElement` → `parentNode.host` → `parentNode`, which is what carries it out of one shadow
 * tree and into the next. A composite nests two.
 *
 * ⚠ "SCROLLS" MEANS BOTH: overflow allows it AND there is something to scroll. An element with
 * `overflow-y: auto` and no excess content is not a scrollport, and treating it as one stops the
 * search at the wrong node. The +4 tolerance keeps sub-pixel layout rounding from reading as scrollable.
 *
 * @param {Node} el  the node to search upward from
 * @returns {Element|null}
 */
export function findScrollportAncestor(el) {
  let node = el && el.parentNode
  while (node) {
    if (node.nodeType === 1) {
      const cs = getComputedStyle(node)
      if (/auto|scroll/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 4) return node
    }
    node = node.parentElement || node.parentNode?.host || (node.parentNode !== node ? node.parentNode : null)
    if (node && node.nodeType === 9) break
  }
  return null
}

export default findScrollportAncestor
