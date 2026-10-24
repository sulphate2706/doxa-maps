/**
 * plugin-designs/template-bundle/index.js
 *
 * Bundle entry — the minimal, copy-me reference for a MULTI-PROFILE bundle.
 *
 * Folder name = bundle name. This folder builds to exactly one output file:
 *   ../../../public/js/template-bundle.js
 *
 * Both profiles in this bundle live as FLAT .vue files DIRECTLY in this folder
 * (template-map-a.vue, template-map-b.vue) — there is NO profiles/ subfolder.
 * That is the whole convention: one folder = one bundle, each `*.vue` in it = one
 * profile, all compiled into the single template-bundle.js.
 *
 * Usage from a host page:
 *   <script src="/dx-maps/template-bundle/template-bundle.js"></script>
 *   <template-bundle profile-config='{"profile":"template-map-a"}'></template-bundle>
 *   <template-bundle profile-config='{"profile":"template-map-b"}'></template-bundle>
 *
 * `profile` must match a .vue filename in THIS folder (without the .vue).
 */

import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerStrategies } from '@map/colors/_registry.js'

// ─── Bundle-private profile registry ─────────────────────────────────────────
// import.meta.glob is evaluated by Vite at build time relative to THIS file, so
// it captures only THIS bundle's profiles. The glob is './*.vue' (flat) — it
// matches template-map-a.vue and template-map-b.vue sitting right here. A
// profiles/ subfolder would NOT be picked up by this glob; the design is flat.
// ProfileLoader (in @map) cannot run this glob itself — it lives in a different
// folder — so the bundle hands the result over via app.provide('profileModules').
const profileModules = import.meta.glob('./*.vue')

// ─── Bundle-private color strategies (the copy-me reference) ─────────────────
// The SAME seam as profileModules, for colors. Any `<name>.js` in this bundle's
// `src/colors/` folder is merged OVER the shared library set at init: a file
// whose derived mode matches a shared one OVERRIDES it; a new mode ADDS a private
// strategy. This bundle inlines its own registry copy (IIFE build), so this affects
// THIS bundle only — it can't leak into another map. This template ships
// `src/colors/example-mode.js` so you have a working pattern to copy. The glob is
// `*.js`, so `src/colors/colors.json` (plain color VALUES) is ignored by design.
registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))

// ─── Register the custom element ─────────────────────────────────────────────
// One tag per bundle, named after the bundle. The guard prevents an
// "already registered" error if the IIFE is ever loaded twice on one page.
const TemplateBundleElement = defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
    // Install i18n AND hand the instance to ProfileLoader by reference. The
    // defineCustomElement root cannot use useI18n() (see ProfileLoader.vue);
    // it drives locale through this provided instance instead.
  },
})

if (typeof customElements !== 'undefined' && !customElements.get('template-bundle')) {
  customElements.define('template-bundle', TemplateBundleElement)
}

export default TemplateBundleElement
