/**
 * usePplrInstance.js — per-map "instance store" mediator.
 *
 * Ported verbatim from the upstream PPLR module
 * per QA building-round-1 R4 decision: take their legend and instance pattern
 * word-for-word, integrate into research-mfe.
 *
 * Implements the Mediator Pattern: each map cluster (one map + one geocoder +
 * one legend) gets its own scoped store. Components never call each other
 * directly — they read/write the store and watch its fields.
 *
 * The research-mfe ALSO has a Pinia mapStore. The SemanticTreeLegend's
 * internal code reads/writes this instance; research-map.vue bridges
 * instance.selection ↔ mapStore.selected{Family,Language,Dialect} so the
 * existing applyDimFilter + geocoder paths keep working unchanged.
 */

import { ref, provide, inject } from 'vue'

const KEY = 'pplrInstance'

/**
 * Create a new instance store for one map.
 * @param {string} instanceId  Stable id used for debugging/keying.
 * @returns {object} reactive store
 */
export function createPplrInstance(instanceId) {
  return {
    instanceId,

    // ── Selection (drives map filter + legend highlight) ────────────────────
    /** Currently selected tree node, or null. Shape: { id, label, kind, depth, filter, color, ...extras } */
    selection: ref(null),

    /** Active legend tab index (0-based — but Tab 1 = Generation 1 in user-facing labels) */
    activeTab: ref(0),

    /** Has anything ACTUALLY chosen a tab yet — a user click, a search, a pin?
     *
     * ★ WHY THIS EXISTS. activeTab starts at 0, and 0 is indistinguishable from "the user
     * picked tab 0". SemanticTreeLegend resolves its tab as
     * `instance ? instance.activeTab.value : localActiveTab.value`, so for every profile
     * that shares an instance store the `defaultTab` prop was DEAD — declared, passed,
     * seeding a local ref, and named in a watch fallback, yet never able to win.
     * MEASURED 2026-09-24: my-upg-100-list passes :default-tab="1" (the UPG-100 Lists tab)
     * and opened on Region at BOTH widths, which was the first complaint about this legend:
     * opening on Regions left the reader not knowing what to do.
     * A sentinel rather than a different initial value: changing activeTab's default would
     * move every other profile's landing tab as a side effect.
     */
    activeTabTouched: ref(false),

    /** Search-mode flag: true when geocoder text ≥ 2 chars */
    isSearching: ref(false),

    // ── Geocoder text (read by legend so it can dim itself, etc.) ────────────
    geocoderText: ref(''),

    // ── Pin-detail panel (clicked pin replaces legend with detail) ──────────
    /** Currently clicked pin properties, or null */
    pinDetail: ref(null),

    // ── Chrome theme — driven by the active basemap (light-v11 → 'light',
    // anything else → 'dark'). Legend/geocoder/detail-card read this and
    // apply [data-theme] CSS overrides so chrome matches the map underneath.
    theme: ref('dark'),
  }
}

/**
 * Provide the instance to descendants.
 * Call this in the profile (parent) component.
 */
export function provideInstance(instance) {
  provide(KEY, instance)
}

/**
 * Inject the instance in a child component.
 * Returns null if no instance was provided (component used standalone).
 */
export function useInstance() {
  return inject(KEY, null)
}

/**
 * Convenience: select a node, sync legend tab to its depth.
 */
export function selectNode(instance, node) {
  if (!instance) return
  if (!node) {
    instance.selection.value = null
    return
  }
  instance.selection.value = node
  if (typeof node.depth === 'number') {
    instance.activeTab.value = node.depth
    // A REAL choice — selecting a node moves the legend to that node's generation. Mark it,
    // so the profile's defaultTab stops applying from here on (see activeTabTouched above).
    instance.activeTabTouched.value = true
  }
}

/**
 * Convenience: clear all (selection + geocoder text + pin detail).
 */
export function clearAll(instance) {
  if (!instance) return
  instance.selection.value = null
  instance.geocoderText.value = ''
  instance.pinDetail.value = null
}
