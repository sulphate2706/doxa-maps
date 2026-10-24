/**
 * posterverse / index.js — bundle entry (capability 5, nested-mfe-spa / app shell).
 *
 * ONE folder -> ONE bundle -> ONE custom element: <posterverse-app>. (A custom-element name needs a
 * hyphen, so the tag cannot be the bare folder name.)
 *
 * It registers only its own tag. It never imports another plugin's components and never re-registers a
 * tag another bundle owns: each nested poster plugin registers its own tag when its script loads.
 *
 * TREE BASE: to find each nested plugin's script, the shell needs the built tree's root URL. It is
 * derived HERE, at IIFE load, from this script's own URL (.../<tree>/posterverse/posterverse.js, two
 * levels up), so the element self-locates wherever the tree is served. A host can override it with
 * the tree-base="" attribute or profile-config.treeBase.
 *
 * Usage from a host page:
 *   <script src="/dx-maps/posterverse/posterverse.js"></script>
 *   <posterverse-app></posterverse-app>
 */

import { defineCustomElement } from 'vue'
import Posterverse from './posterverse.vue'
import { deriveTreeBase } from '@map/utils/embedScript.js'

// Captured synchronously at IIFE load, while document.currentScript is still this bundle's tag.
const TREE_BASE = deriveTreeBase()

const PosterverseElement = defineCustomElement(Posterverse, {
  configureApp(app) {
    app.provide('pvTreeBase', TREE_BASE)
  }
})

if (typeof customElements !== 'undefined' && !customElements.get('posterverse-app')) {
  customElements.define('posterverse-app', PosterverseElement)
}

export default PosterverseElement
