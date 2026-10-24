/**
 * useShadowStyles.js — Shadow DOM Style Injection
 *
 * Vue's defineCustomElement only injects styles from the ROOT component
 * into the Shadow DOM. Child components loaded via defineAsyncComponent
 * (import.meta.glob) have their <style> blocks silently dropped.
 *
 * This composable injects a child component's critical styles into the
 * shadow root so they actually take effect.
 *
 * Usage (in any child component):
 *   import { useShadowStyles } from '../composables/useShadowStyles.js'
 *
 *   // Call at setup() time — injects styles into shadow root on mount
 *   useShadowStyles(`
 *     .my-component { position: absolute; inset: 0; }
 *     .map-canvas   { position: absolute; inset: 0; }
 *   `)
 */

import { getCurrentInstance, onMounted } from 'vue'

/**
 * Injects a CSS string into the shadow root that contains this component.
 * Idempotent — uses a data-attribute key to avoid duplicate injection.
 *
 * @param {string} css      - Raw CSS text to inject
 * @param {string} [label]  - The <style> tag's KEY in its shadow root, not a debugging name: a second call
 *                            with the same label and different CSS OVERWRITES the first one's sheet. Use a
 *                            label no other call uses (the file's own name); a copied or forked component
 *                            must get a new one. Enforced by check:shadow-style-labels-unique.
 */
export function useShadowStyles(css, label) {
  // Captured in setup (onMounted's callback cannot see it reliably).
  const instance = getCurrentInstance()
  // A stable key: the label; else, under the dev server, the component's HMR id (so an edited stylesheet
  // REPLACES its old copy instead of piling up next to it); else a hash of the CSS (builds: unchanged).
  const key = label || (instance && instance.type && instance.type.__hmrId ? 'hmr-' + instance.type.__hmrId : hashCode(css))

  onMounted(() => {
    if (!instance) return

    // Walk up from the component's root element to find the shadow root
    const el = instance.proxy?.$el
    if (!el) return

    const root = el.getRootNode()
    if (!(root instanceof ShadowRoot)) return  // light DOM — no injection needed

    // Already injected: keep it — unless the CSS changed (a hot update), then replace its text. The early
    // return here used to keep the OLD CSS after an edit, under a label.
    // REDUCED MOTION, once per shadow root. A page's own prefers-reduced-motion reset never crosses a shadow
    // boundary, so every animating library component (legends, map controls, hints) slid and faded for
    // readers who asked for less motion (found first on ProgressBar; ten components carried
    // transitions with no guard). Injecting the reset here covers every component that styles itself
    // through this composable, including ones written later, without each having to remember.
    if (!root.querySelector('style[data-shadow-styles="reduced-motion"]')) {
      const rm = document.createElement('style')
      rm.setAttribute('data-shadow-styles', 'reduced-motion')
      rm.textContent = REDUCED_MOTION_CSS
      root.appendChild(rm)
    }
    const existing = root.querySelector(`style[data-shadow-styles="${key}"]`)
    if (existing) { if (existing.textContent !== css) existing.textContent = css; return }

    const style = document.createElement('style')
    style.setAttribute('data-shadow-styles', key)
    style.textContent = css
    root.appendChild(style)
  })
}

/** The reset every shadow root gets: motion becomes instant, state changes still apply. Exported for the gate. */
export const REDUCED_MOTION_CSS = `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`

/** Simple string hash for dedup key */
function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return 's' + Math.abs(hash).toString(36)
}
