<script setup>
/**
 * stack-demo.vue — Capability-4 composite demonstrating the shared StackLayout (scroll-stack).
 *
 * @element stack-demo
 * @description Groups TWO independent elements TOP-TO-BOTTOM so you can embed the pair on a page and
 *   SCROLL down through all of it (the page-flow model of a normal host page), instead of switching
 *   between them with tabs. Section 1 = the rich <research-dashboard-map> (facets + map + charts +
 *   table); section 2 = the cap-2 <people-groups-grid> (live pray.doxa.life). Each renders at its
 *   NATURAL height; the host page scrolls.
 *
 * This is the STACK counterpart to big-picture (which TABS/couples). Both reuse the shared library
 * layouts in library/layouts/. StackLayout mounts each section's `element` eagerly (all visible to
 * scroll) via the same element/src/attrs contract VerticalTabsLayout uses.
 */
import { computed } from 'vue'
import StackLayout from '@map/layouts/StackLayout.vue'
import { publishMapToken } from '@map/composables/useSharedMapToken.js'

// ★ THE HOST'S INLINE STYLE MUST NOT LAND ON OUR ROOT.
// This SFC is mounted AS a custom element, so a style attribute the HOST page puts on the tag falls
// through onto this component's root element. MEASURED 2026-09-25 with a host style of
// "display:flex; position:relative; height:100%": that exact string appeared verbatim on the inner
// root div of this component — the gallery sets one on every tab, and on the Prayer Walk Planner
// the same fallthrough collapsed the plugin to 76px. The element's own :host rules are the contract
// for how it sizes itself; a host styling the TAG is styling the box, not our internals.
defineOptions({ inheritAttrs: false })


// The two elements to stack. `src` is TREE-RELATIVE at build; the leaf pages resolve it against the
// bundle tree root. Both elements ship their own bundles in the same catalog.
// ── WHERE A SIBLING BUNDLE LIVES DEPENDS ON WHICH TREE IS SERVING ────────────────────────────
// A tree-relative src is resolved by the BROWSER against the document URL, so no attribute and no
// host can redirect it — which makes it correct in exactly one tree and a 404 in the other.
//   BUILT: this leaf is served two levels deep (doxa-maps/stack-demo/stack-demo/index.html), so a
//          sibling bundle is '../../<bundle>/<bundle>.js'.
//   DEV:   the dev server serves SOURCE, and a bundle's entry is '/plugin-designs/<bundle>/index.js'.
// MEASURED 2026-09-22 against the running dev server:
//     GET /plugin-designs/research-dashboard/index.js ........... 200
//     GET /research-dashboard/research-dashboard.js ............. 404   <- what '../../' resolves to
// So stack-demo took 2 x 404 and rendered empty sections in dev, with no console error and no failed
// mount — the sections simply never got their element. Confirmed PRE-EXISTING and reproducible on this
// bundle's own standalone leaf, independent of any composite that nests it.
//
// ★ THIS IS THE THIRD PLACE THIS EXACT DEFECT APPEARED. plugin-studio and doxa-maps-spa both carried
// hardcoded tree-relative paths and both were cured the same way: resolve at RUNTIME from something
// that knows which tree is serving, rather than baking one tree's shape into a string. Each instance
// was found separately, after the previous one was "fixed", because a literal '../..' looks correct
// in review and is invisible to a gate that only ever checks the built tree (check:composite-srcs
// PASSES on this file today, for precisely that reason).
//
// import.meta.env.DEV is statically replaced at build time, so the production branch is the only one
// that survives into the IIFE — the built output is byte-identical to the hardcoded form it replaces.
const bundleSrc = (bundle, file) =>
  import.meta.env.DEV ? `/plugin-designs/${bundle}/index.js` : `../../${bundle}/${file}.js`

// ★ THE HOST'S OWN profile-config. This demo declared no props, so a partner embedding it with
// <stack-demo profile-config='{"tk":"pk...."}'> had that token read by nobody and the nested
// dashboard reported "No Mapbox access token provided" on a page with no baked token to fall back
// on. Same defect the two shipped composites had; check:composite-embed-knobs names it.
const props = defineProps({
  profileConfig: { type: [String, Object], default: null },
})
const hostConfig = computed(() => {
  const raw = props.profileConfig
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return {} }
})
const hostToken = computed(() => {
  const tk = hostConfig.value?.tk
  return typeof tk === 'string' && tk ? tk : ''
})
if (hostToken.value) publishMapToken(hostToken.value)
const hostProvider = computed(() => {
  const p = hostConfig.value?.provider
  return p === 'maplibre' || p === 'mapbox' ? p : ''
})
// ★ AND THE HOST'S LANGUAGE, the third knob a host passes the same way. The children are mounted BY
// TAG, each with its own ProfileLoader / config reader, so the only thing missing was handing the
// locale down — check:host-locale-contract measured 0 Arabic characters with profile-config
// locale:"ar" against 2205 at ?lang=ar. Passed through as given; each child validates it.
const hostLocale = computed(() => {
  const l = hostConfig.value?.locale || hostConfig.value?.lang
  return typeof l === 'string' && l ? l : ''
})

const sections = computed(() => [
  {
    key: 'dashboard',
    title: 'Research Dashboard',
    sub: 'facets · map · charts · table (live)',
    element: 'research-dashboard-map',
    src: bundleSrc('research-dashboard', 'research-dashboard'),
    // ★ REQUIRED, and its absence was a live defect (found + fixed 2026-09-22). research-dashboard's
    // entry mounts ProfileLoader, which reads profile-config.profile to choose WHICH .vue to load.
    // With none, the element still mounted at its full 844px and still reported its tag — so every
    // structural check said "present" — while ProfileLoader rendered "missing or invalid
    // profile-config prop" where the dashboard should be. The grid section below was fine, which is
    // what made it survive: half the page worked.
    // Shape copied verbatim from this bundle's own generated leaf (its BASE_CONFIG), so the nested
    // and standalone mounts ask for the identical thing. Now gated by check:composite-srcs.
    attrs: {
      'profile-config': JSON.stringify({
        profile: 'research-dashboard',
        dataSource: 'pray-tools',
        instanceId: 'stack-demo-research-dashboard',
        // Spread only when the host supplied one, so the nested mount otherwise asks for exactly
        // what its standalone leaf asks for.
        ...(hostToken.value ? { tk: hostToken.value } : {}),
        ...(hostProvider.value ? { provider: hostProvider.value } : {}),
        ...(hostLocale.value ? { locale: hostLocale.value } : {}),
        assetsBase: '../../assets'
      })
    }
  },
  {
    key: 'grid',
    title: 'People Groups',
    sub: 'the full searchable list (live)',
    element: 'people-groups-grid',
    src: bundleSrc('people-groups-grid', 'people-groups-grid'),
    // The grid reads profile-config.locale itself (people-groups-grid.vue, cfg.locale). Only set
    // when the host gave one, so without it the grid mounts exactly as its standalone leaf does.
    ...(hostLocale.value ? { attrs: { 'profile-config': JSON.stringify({ locale: hostLocale.value }) } } : {})
  }
])
</script>

<template>
  <StackLayout title="Stacked view" :sections="sections">
    <template #meta>scroll ↓</template>
  </StackLayout>
</template>

<style>
/* stack-demo is a thin composition: the shell + its scroll behaviour live in the shared StackLayout
   (which self-injects its own shadow CSS). Nothing to add here beyond making the host fill width. */
:host { display:block; width:100%; }
</style>
