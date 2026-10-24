<script setup>
/**
 * gospel-dashboard.vue — Capability-4 composite: the gospel map above its own tables.
 *
 * @element gospel-resources-map
 *
 * ★ THE TAG IS THE BUNDLE'S, NOT THE PROFILE'S. This said gospel-resources-dashboard, a tag
 * nothing defines: index.js registers exactly one element and every profile is selected
 * through its profile-config, which is why all five generated leaves embed
 * <gospel-resources-map>. The manifest reads this line, so it published an element name a
 * consumer could copy into a page and get nothing at all — invisible in dev, where the leaf
 * HTML is what gets loaded, and only findable on a built tree.
 * @description The gospel map and its tables as one scrolling element: 12,379 people-group pins with the real Scripture, film and Bible-story links for each group's own language, above every resource with its URL and the 1,613 groups where nothing was found, exportable as CSV.
 *
 * WHY A COMPOSITE AND NOT A THIRD DATASET. The ask was for "a gospel resources
 * dashboard if possible", and the two halves already existed as separate profiles that a
 * reader had to know to visit separately: the map answers "where", the tables answer
 * "what exactly, and give me the list". Neither is improved by being rebuilt; they are
 * improved by being in one place.
 *
 * IMPORTED DIRECTLY, like dashboard-plus-grid, not injected at runtime like stack-demo.
 * Both children live in THIS bundle, so composing them adds no second script to load and
 * no cross-bundle version skew — the tables a reader scrolls to are built from the same
 * pin index the map above them is drawing.
 *
 * NO TOP BAR: StackLayout omits its own header when neither `title` nor #meta is used, so
 * the composite shows only the children's own chrome. A second header here would repeat
 * the map's legend and push the map down for nothing — the same defect the
 * dashboard-plus-grid header notes were written about.
 *
 * THE MAP KEEPS ITS OWN HEIGHT. It is absolutely positioned inside its section rather
 * than height:auto, because a map with no height renders a zero-pixel canvas that reads
 * as "the map did not load" — which is the failure this repo has diagnosed falsely more
 * than once.
 */
import StackLayout from '@map/layouts/StackLayout.vue'
import ResourcesMap from './resources-map.vue'
import DataTables from './data-tables.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { ref, provide } from 'vue'

// ═══ THE TWO HALVES TALK TO EACH OTHER ═══════════════════════════════════════════════
// "Every resource in <language>" is a LINK to the standalone tables page, which is right
// when the map is alone. Inside this composite the tables are already on screen, directly
// below, so following that link navigated AWAY from the dashboard — the filter applied
// correctly (6 of 6,498 for German) but the map was gone and the composite destroyed.
// Measured: the URL changed from gospel-dashboard/index.html to data-tables/index.html.
//
// Provided rather than propped because the two children are separate profiles that must
// each still work standalone: a child that finds nothing injected keeps its old behaviour
// exactly, so nothing changes for resources-map or data-tables on their own pages.
const composedFilter = ref(null)
provide('composedFilter', composedFilter)

const sections = [
  { key: 'map', title: '' },
  { key: 'tables', title: '' },
]

useShadowStyles(
  ':host{display:block;width:100%}' +
  // The map is absolutely positioned inside its own profile, so its section needs a real
  // height to render into. 80svh rather than a fixed px: on a phone a 600px map leaves no
  // room for anything else, and svh follows the visible viewport rather than the
  // URL-bar-inclusive one.
  // THE MAP keeps a real height because it is absolutely positioned inside its own
  // profile: a map with no height renders a zero-pixel canvas that reads as "the map did
  // not load", a false diagnosis this repo has paid for more than once. 80svh rather than
  // a fixed px — on a phone a 600px map leaves no room for anything beneath it.
  '.gd-map{position:relative;width:100%;height:80svh;min-height:420px}' +
  '.gd-tables{position:relative;width:100%;background:#f3f3f1}' +
  // ★ THE TABLES MUST FLOW, NOT FILL. data-tables is .gt{position:absolute;inset:0}, built
  // to fill a positioned parent when it is the whole page. Stacked, that gives it no
  // intrinsic height, so the section collapsed and the host clamped to exactly 100dvh:
  // MEASURED docScrollHeight 900 against clientHeight 900, scrollTo and a real wheel
  // gesture both moving 0px. The tables were in the DOM and unreachable, which is the
  // worst of both — rendered, counted by a probe, and invisible to a person.
  // Made static here so the section takes its natural height and the PAGE scrolls. One
  // scroll container, not a scroller inside a scroller: this repo has already fixed the
  // nested-scroll version of this twice.
  '.gd-tables .gt{position:static;inset:auto;height:auto;overflow:visible}'
)
</script>

<template>
  <StackLayout :sections="sections">
    <template #section-map>
      <div class="gd-map"><ResourcesMap /></div>
    </template>
    <template #section-tables>
      <div class="gd-tables"><DataTables /></div>
    </template>
  </StackLayout>
</template>

<style>
:host { display:block; width:100%; }
</style>
