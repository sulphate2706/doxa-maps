/**
 * plugin-studio / index.js — Bundle entry (Capability-5 nested-mfe-spa / app-shell).
 *
 * ONE folder -> ONE bundle -> ONE custom element: <plugin-studio>.
 *
 * <plugin-studio> is the DEVELOPER STUDIO of the whole DX-maps system: a vertical-tab layout whose
 * sidebar is the composability ladder grouped by CAPABILITY (5 -> 1); each row nests that element
 * (token-free elements mounted directly by their real tag; map elements nested as their own SPA in
 * a lazy iframe) with its embed snippet. It is the spot to SEE every plugin element work and review
 * it. See plugin-studio.vue for the full why.
 *
 * ★ WHY AN ELEMENT (not an index.html page): every plugin in this system is a compiled Vue custom
 *   element so it supports all five deployment methods and can compose. The studio is a plugin, so
 *   it is a real element too. A page could only be iframed and could never be nested as a tab of
 *   another cap-5 shell.
 *
 * ★ ONE-SHOT-DEFINE SAFETY: the ONLY tag this bundle registers is <plugin-studio>. It NEVER
 *   imports another plugin's components and NEVER re-registers a tag another bundle owns. The
 *   nested elements register their own tags when THEIR IIFE loads (direct-mount rows) or run in
 *   their own document (iframe rows). So loading this bundle beside any other can never collide.
 *
 * ★ TREE BASE: to find each element's built .js / leaf page + the manifest, the shell needs the
 *   built tree's root URL. We derive it HERE, at IIFE load, from this script's own URL
 *   (.../doxa-maps/plugin-studio/plugin-studio.js) -> two levels up = the tree root. Provided to
 *   the Vue app; a host can override with tree-base="" or profile-config.treeBase.
 *
 * Usage from a host page (direct-JS, deploy-method-3):
 *   <script src="/doxa-maps/plugin-studio/plugin-studio.js"></script>
 *   <plugin-studio></plugin-studio>
 *   <!-- or pin the tree explicitly: -->
 *   <plugin-studio tree-base="https://your-host/doxa-maps"></plugin-studio>
 */

import { defineCustomElement } from 'vue'
import PluginStudio from './plugin-studio.vue'
import { deriveTreeBase } from '@map/utils/embedScript.js'

// Capture the running <script>'s own URL synchronously at IIFE load, BEFORE any async runs, so
// document.currentScript is still this bundle's tag. Derive the tree root = two levels up
// (.../doxa-maps/plugin-studio/plugin-studio.js -> .../doxa-maps/). Guarded for non-browser.
const TREE_BASE = deriveTreeBase()

const PluginStudioElement = defineCustomElement(PluginStudio, {
  configureApp(app) {
    // Hand the derived tree root to the component (props/attrs still override it).
    app.provide('psTreeBase', TREE_BASE)
  }
})

if (typeof customElements !== 'undefined' && !customElements.get('plugin-studio')) {
  customElements.define('plugin-studio', PluginStudioElement)
}

export default PluginStudioElement
