/**
 * hostElement — the custom element a component is mounted inside.
 *
 * ★ WHY THIS IS A LIBRARY FUNCTION AND NOT FIVE LINES IN EACH PLUGIN. Every plugin ships through
 * Vue's `defineCustomElement`, which mounts into a SHADOW ROOT, and a composite nests two of them
 * (`<research-map-plus-grid>` contains `<doxa-research-map>`). So the element a component can see
 * with `$el` is inside the shadow tree, and the thing a host page can style, measure or address is
 * the ROOT NODE'S HOST — one hop out. Code that forgets the hop silently operates on the wrong node.
 *
 * That mistake is the one this codebase makes most often, and it is invisible when you make it: a
 * `document.querySelector` for a node inside a shadow root returns null on a perfectly working
 * build, which reads as "the feature is broken" rather than "the query was wrong". Three identical
 * copies of this logic were three chances to write the wrong version of it.
 *
 * ⚠ `getRootNode()` is guarded because it does not exist on every node type this can be handed
 * (a detached vnode el, a text node), and because a CLOSED shadow root returns no host — in both
 * cases the element itself is the honest answer, not a throw.
 *
 * @param {object} inst  a Vue internal instance (`getCurrentInstance()`)
 * @returns {Element|null|undefined} the custom element host, or the component's own root element
 */
export function hostElement(inst) {
  const root = inst?.vnode?.el || inst?.proxy?.$el
  try { const rn = root && root.getRootNode && root.getRootNode(); if (rn && rn.host) return rn.host } catch (_) {}
  return root
}

export default hostElement
