/**
 * plugin-designs/doxa-simple-map/index.js
 *
 * Bundle entry — registers the doxa-simple-map web component.
 *
 * ★ ITS TAG IS <dxm-simple-map>, DX Maps' own name. A host page can define the older generic names first
 * (DX Life's own /js/doxa-simple-map.js defines <doxa-map> and <doxa-simple-map>), and the first definition
 * wins, so under those names a page could be drawing the host's element instead of this one. The older names
 * are defined only when the host asks: a `data-legacy-tags` attribute on this bundle's <script>, or
 * window.DXM_LEGACY_TAGS = true before it loads. Each name gets its own class (one class under two tags is
 * undefined behaviour).
 *
 * Usage:
 *   <script src="<tree>/doxa-simple-map/doxa-simple-map.js"></script>
 *   <dxm-simple-map profile-config='{"profile":"doxa-simple-map","tk":"MAPBOX_PUBLIC_TOKEN"}'></dxm-simple-map>
 * An existing embed that still writes <doxa-map> or <doxa-simple-map> adds `data-legacy-tags` to its <script>.
 *
 * The profile-config attribute is parsed by ProfileLoader (in @map).
 * `profile` must match a .vue file in this bundle's folder.
 *
 * Profile registry — Q3 contract from the migration plan: ProfileLoader lives
 * inside @map, so it cannot use import.meta.glob to reach into a
 * bundle's folder. The bundle MUST evaluate import.meta.glob('./*.vue')
 * locally and hand the result to the loader via app.provide('profileModules').
 *
 * Mapbox RTL text plugin: registered ONCE at module init (before any map
 * constructs), lazy-loads when Arabic/Hebrew text appears on the basemap.
 */

import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerStrategies } from '@map/colors/_registry.js'

// Read NOW, at evaluation time: document.currentScript is null once this script has run.
const LEGACY_TAGS = (() => {
  try {
    if (typeof window !== 'undefined' && window.DXM_LEGACY_TAGS === true) return true
    const s = typeof document !== 'undefined' ? document.currentScript : null
    return Boolean(s && typeof s.hasAttribute === 'function' && s.hasAttribute('data-legacy-tags'))
  } catch (_) { return false }
})()

// ─── Bundle-private profile registry ─────────────────────────────────────────
// import.meta.glob is evaluated by Vite at build time relative to THIS file —
// so it captures only this bundle's profiles. Handed to ProfileLoader via
// app.provide('profileModules', ...) below.
const profileModules = import.meta.glob('./*.vue')

// ─── Bundle-private color strategies ─────────────────────────────────────────
// Same seam as profileModules, for colors. Any `<name>.js` a contributor drops in
// this bundle's `src/colors/` folder is merged OVER the shared library set
// (same mode key = override; new key = profile-private). This bundle inlines its own
// copy of the registry (IIFE build), so registering here affects THIS bundle only.
// No-op today: doxa-simple-map ships no local strategies (empty glob).
registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

/**
 * Build a fresh defineCustomElement-wrapped class.
 *
 * Vue's defineCustomElement returns a class that gets registered with
 * customElements.define exactly once per tag name. Reusing a single class
 * across two tags is undefined behavior, so we call defineCustomElement TWICE
 * with the same component to produce two independent classes.
 *
 * Each instance gets its own Pinia + its own i18n via configureApp — that
 * isolation is important when multiple <doxa-map> embeds share a page.
 */
function buildDoxaMapElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Install i18n AND hand the instance to ProfileLoader by reference. The
      // defineCustomElement root cannot use useI18n() (see ProfileLoader.vue);
      // it drives locale through this provided instance instead.
      // Hand the bundle's profile registry to ProfileLoader (Q3 contract).
      // ProfileLoader inject('profileModules')s this — see ProfileLoader.vue.
  },
})
}

const DxmSimpleMapElement = buildDoxaMapElement()

// ─── Register the tag ────────────────────────────────────────────────────────
// The guard keeps a second load of this bundle quiet. The FIRST define in this file is the profile's
// element: internal/generate-tree.mjs reads it into the manifest, the leaf pages and the gallery.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('dxm-simple-map')) customElements.define('dxm-simple-map', DxmSimpleMapElement)
  // The older generic names, ONLY when the host asked (see the header). Never on by default.
  if (LEGACY_TAGS) {
    for (const legacy of ['doxa-map', 'doxa-simple-map']) {
      if (!customElements.get(legacy)) customElements.define(legacy, buildDoxaMapElement())
    }
  }
}

export default DxmSimpleMapElement
