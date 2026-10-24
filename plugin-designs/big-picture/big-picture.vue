<script setup>
/**
 * big-picture.vue — Plugin: "Big Picture" (Capability-4 nested-elements-mfe).
 *
 * @description The Cat-4 composite that PAIRS the two real capability elements of the
 *              research page via **props + events** (the deploy-method-3 contract — no shared
 *              JS bus, no Pinia store; the parent is the only wire):
 *
 *                TOP  = <BpResearchHeader> (Cat-1) — the Unified Research Dashboard header.
 *                       Its hand-rolled search/select controls are GONE; it now uses the
 *                       SHARED <SearchBar> + FOUR shared <FilterDropdown>s (Region / Block /
 *                       People-Group / Religion). Emits `research-filter`
 *                       { query, wagfRegion, wagfBlock, rop1, religion } on change.
 *                BELOW= the REAL cap-2 <PeopleGroupsGrid> (plugin-designs/people-groups-grid),
 *                       the live pray.doxa.life people-groups grid, with its OWN controls
 *                       TURNED OFF (:show-search / :show-filters = false) so the header
 *                       drives it purely through props.
 *
 *              WIRING (the load-bearing proof):
 *                1. The header emits `research-filter` (@research-filter) → this parent stores
 *                   { query, wagfRegion, wagfBlock, rop1, religion } in reactive state.
 *                2. This parent passes that state DOWN to the grid as
 *                   :query / :wagf-region / :wagf-block / :rop1 / :religion props → the real
 *                   grid re-filters against its live data. (Header control → grid filter.)
 *                3. The grid emits `groups-filtered` { total, … } (@groups-filtered) → this
 *                   parent stores the total and passes it back UP into the header's :count prop.
 *              => Searching / picking a dropdown in the dashboard header filters the REAL
 *                 people-groups grid below it, and the header shows the live matched count.
 *                 Data down, events up.
 *
 *              Both inner elements stay INDIVIDUALLY embeddable: <bp-research-header> and the
 *              cap-2 <people-groups-grid> are also registered as standalone custom elements
 *              (see index.js) — one code path, two mount modes.
 *
 * @profile     big-picture
 * @bundle      big-picture
 * @element     bp-big-picture
 *
 * ★ @element MUST BE A BARE TAG — ONE VALID CSS SELECTOR, NOTHING ELSE.
 * It was previously prose: "bp-big-picture (this composite) + bp-research-header +
 * people-groups-grid (nested)". generate-tree copies @element VERBATIM into manifest.json, and
 * consumers feed that value straight to document.querySelector(). The prose threw
 * "SyntaxError: Failed to execute 'querySelector'", which embed-smoke's catch-all reported as
 * "mount timeout" — so a DATA defect in this comment masqueraded as a BROKEN PLUGIN, on the one
 * bundle that is tab-1 of the cap-5 SPA. big-picture mounts fine; only this string was invalid.
 * Every other bundle in the repo declares a single bare tag; this was the lone outlier.
 * The nested elements are documented above and in @composes — they do not belong in @element.
 *
 * Becomes tab-1 of the Cat-5 SPA.
 */
import { computed, reactive, ref, watch, watchEffect, onMounted, getCurrentInstance } from 'vue'
import { tStatic } from '@map/i18n/index.js'
import { SUPPORTED_LOCALES, RTL_LOCALES, setRuntimeLocale, getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import BpResearchHeader from './src/components/BpResearchHeader.vue'
// The REAL cap-2 grid — same component the standalone <people-groups-grid> ships (no fork).
import PeopleGroupsGrid from '../people-groups-grid/people-groups-grid.vue'

// ── profile-config prop (optional overrides) ─────────────────────────────────
const props = defineProps({
  profileConfig: { type: String, default: '' },
})
const config = computed(() => {
  if (!props.profileConfig) return {}
  try { return JSON.parse(props.profileConfig) || {} } catch { return {} }
})
const accent  = computed(() => config.value.accent || '#8b5cf6')
// ★ THE TITLE WAS THE LAST ENGLISH LITERAL IN THIS FILE, and it is the largest text on the element.
// Everything else here already reads the catalogue; this one fell back to a hardcoded string with no
// key at all, so a host asking for Arabic got an Arabic grid under an English headline. A host's own
// `title` still wins — that is what the config key is for — but an absent one now resolves through
// the catalogue rather than through a literal. The English wording is unchanged: this is the
// shepherd's standing rule that translating EXISTING wording is not a product decision.

// ★ THE LOCALE THE HOST ASKED FOR, AND THE ONE ELEMENT ON THE PAGE THAT CAN ACT ON IT.
// MEASURED with check:host-locale-contract: this leaf drew 0 Arabic characters for
// profile-config {"locale":"ar"} against 273 for the same page reached with ?lang=ar. Its siblings
// were fixed two different ways and neither applies here — this bundle's entry calls
// defineCustomElement(BigPicture) with no configureApp at all, so there is no i18n instance for
// provide-on-install to reach and no ProfileLoader anywhere beneath to drive one. Every string this
// element renders comes through tStatic (the grid's `t` proxy, the header's labels), and tStatic
// resolves the locale from the URL and the document — neither of which a host's profile-config
// touches. So the only thing missing was somebody to say which language this page is being read in.
const hostLang = computed(() => {
  const l = String(config.value.locale || config.value.lang || '').split('-')[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(l) ? l : ''
})
watchEffect(() => { if (hostLang.value) setRuntimeLocale(hostLang.value) })

// ★ THE LOCALE IS PASSED, NOT ASSUMED, AND THAT IS WHAT KEEPS THIS LIVE. tStatic resolves through
// getRuntimeLocale() at CALL time, but a computed only calls again when a REACTIVE dependency changes —
// and config.value does not change when the host switches language. So this heading resolved once and
// stayed in the boot language while everything around it moved (upg100 measured it; check:frozen-labels
// catches the shape). hostLang IS reactive, so reading it both re-runs this computed and tells tStatic
// which catalogue to read. useI18n is not an option here: this bundle installs no i18n (index.js), which
// is why the whole element reads through tStatic in the first place.
const heading = computed(() => config.value.title
  || tStatic('dashboard.bp_title', hostLang.value || undefined)
  || 'Big Picture — Unified Research Dashboard')

// ★ RTL IS A DIRECTION, NOT A TRANSLATION — the half this element was still missing.
// Its three sibling composites (dashboard-plus-grid, research-map-plus-grid) and the grid itself all
// reflect `dir` onto their custom-element host; this one did not, so a host asking for Arabic got
// Arabic WORDS in a left-to-right layout. That reads as a styling quirk rather than the bug it is,
// which is exactly why it outlived every locale fix around it.
//
// Set on the HOST rather than on .bp-root, deliberately: `dir` takes effect through the inherited
// CSS `direction`, and inheritance crosses shadow boundaries — so one attribute covers this
// element's own chrome AND both nested elements beneath it. Set and CLEARED, but only ever ours: a host
// page that already declares its own dir owns that decision.
const textDir = computed(() => {
  const l = hostLang.value || getRuntimeLocale() || detectLocale()
  return RTL_LOCALES.has(l) ? 'rtl' : 'ltr'
})
const _self = getCurrentInstance()
// ★ WE CLEAR ONLY THE DIRECTION WE SET. The line below used to be a one-way
// `if (rtl) setAttribute('dir','rtl')` with no else, so a reader who switched from an RTL locale to
// an LTR one (ar -> zh) kept a right-to-left layout for the rest of the session: Chinese laid out
// backwards, which reads as a broken page rather than a stale setting.
// The original reason for never clearing is still honoured, and is why this remembers rather than
// just removing: a host page that declares its OWN dir owns that decision, so the value found before
// we first wrote is restored verbatim, and removed only when there was none.
// ★ CAPTURED AT MOUNT, NOT AT FIRST WRITE. The capture used to sit inside the rtl branch, so it
// recorded whatever `dir` happened to be on the host the first time WE wrote — and if anything else
// had already set rtl by then, that value was recorded as "the page's own" and faithfully restored
// forever after. MEASURED on the Big Picture leaf: ar left rtl, and zh put rtl straight back.
// Reading it on the FIRST call instead, before any write of ours, is the only moment the attribute
// is certainly the page's and not ours.
let _hostDir = null
let _weSetDir = false
function reflectDir() {
  try {
    const host = _self?.proxy?.$el?.getRootNode?.()?.host
    if (!host || !host.setAttribute) return
    if (_hostDir === null) _hostDir = host.getAttribute('dir') || ''
    if (textDir.value === 'rtl') {
      host.setAttribute('dir', 'rtl')
      _weSetDir = true
    } else if (_weSetDir) {
      if (_hostDir) host.setAttribute('dir', _hostDir); else host.removeAttribute('dir')
      _weSetDir = false
    }
  } catch (_) { /* no host (SSR/tests) — nothing to reflect */ }
}
onMounted(reflectDir)
watch(textDir, reflectDir)

// The host's people-group LIST (library/lists/), handed to both children as the only key of their
// profile-config, so nothing else about them changes. Absent = the default list.
// ★ THE LOCALE TRAVELS WITH THE LIST (measured: big-picture rendered 31 Arabic text nodes
// through profile-config against 79 through ?lang=, and check:host-locale-contract measured 402
// against 888). This handed each child ONLY the list, so the one documented channel a partner has
// for asking a nested element to speak Arabic — its profile-config — arrived empty of any locale.
// setRuntimeLocale above covers everything that reads tStatic, which is why the headline and much
// of the chrome were already right; it does not cover a child that reads its own profile-config.
// Threading it costs nothing and is what ProfileLoader would have done had one existed beneath this
// composite, which is exactly the (C) failure mode: a composite that BAKES its children in has no
// ProfileLoader under it, so it must do that job itself.
// This is ONE identified gap, not a claim to have closed the whole 402/888 difference; a later pass
// re-measures.
const listConfig = computed(() => {
  const cfg = {}
  if (config.value.list) cfg.list = config.value.list
  // ⚠ THE SPELLING IS LOAD-BEARING AND THE TWO SIDES DO NOT MATCH BY NAME. This writes `lang`; the
  // grid's prop is `languageCode`. It works because people-groups-grid.vue accepts three spellings —
  // languageCode || locale || lang — and `lang` is the THIRD of them. Rename or "tidy" either side
  // without the other and a composed grid silently renders in the wrong language on a profile-config
  // embed, which is the exact failure 8b40f6c58 was written to fix and which no gate would catch:
  // ?lang= embeds keep working, so only a host passing profile-config sees it.
  if (hostLang.value) cfg.lang = hostLang.value
  return Object.keys(cfg).length ? JSON.stringify(cfg) : ''
})

const prayBaseUrl  = computed(() => config.value.prayBaseUrl  || '')
const languageCode = computed(() => config.value.languageCode || '')

// ── Cross-element wiring state (props/events, no shared bus) ──────────────────
// filter: set by the HEADER via its `research-filter` event, read by the GRID as props.
//         The FOUR real grid axes. Country is deliberately excluded: provisional, pending a
//         product decision.
const filter = reactive({ query: '', wagfRegion: '', wagfBlock: '', rop1: '', religion: '' })
// matched: set by the GRID via its `groups-filtered` event, read by the HEADER as :count.
const matched = ref(null)

function onResearchFilter(payload) {
  const d = payload && typeof payload === 'object' ? payload : {}
  filter.query      = d.query      || ''
  filter.wagfRegion = d.wagfRegion || ''
  filter.wagfBlock  = d.wagfBlock  || ''
  filter.rop1       = d.rop1       || ''
  filter.religion   = d.religion   || ''
}
function onGroupsFiltered(payload) {
  const d = payload && typeof payload === 'object' ? payload : {}
  matched.value = typeof d.total === 'number' ? d.total : null
}
</script>

<template>
  <div class="bp-root" :style="{ '--accent': accent }">
    <!-- TOP: the Cat-1 dashboard header (SHARED SearchBar + 4 FilterDropdowns). @research-filter
         is the events half of the contract — the header tells this parent what to filter by. -->
    <BpResearchHeader
      :title="heading"
      :accent="accent"
      :count="matched"
      :pray-base-url="prayBaseUrl"
      :language-code="languageCode"
      :profile-config="listConfig"
      @research-filter="onResearchFilter"
    />

    <!-- BELOW: the REAL cap-2 people-groups grid, its OWN controls TURNED OFF so it is driven
         entirely by the props this parent pushes down. @groups-filtered flows the live total
         back up into the header's count. -->
    <!-- show-total=false: the header above already shows "<N> shown" (bound to this same
         @groups-filtered total, see onGroupsFiltered), 139px above the grid's own "Total:"
         line. Measured live 2026-09-23: both rendered "2107 shown" / "Total: 2,107" — the exact
         same number twice, above the fold, which is the redundant-header shape the
         standing rule forbids: a hint lives in the EXISTING header, never in a second one. The grid
         keeps its own line when embedded ALONE, where it is the only total — same pattern
         already applied in dashboard-plus-grid.vue. -->
    <div class="bp-body">
      <PeopleGroupsGrid
        :query="filter.query"
        :wagf-region="filter.wagfRegion"
        :wagf-block="filter.wagfBlock"
        :rop1="filter.rop1"
        :religion="filter.religion"
        :show-search="false"
        :show-filters="false"
        :show-total="false"
        :pray-base-url="prayBaseUrl"
        :language-code="languageCode"
        :profile-config="listConfig"
        @groups-filtered="onGroupsFiltered"
      />
    </div>

    <!-- User-facing footer: an unreached-people-groups research dashboard. The Cap-4
         architecture note (header↔grid via props/events, no shared bus, tab-1 of the SPA)
         lives in this file's header block, not in the UI where an end user reads it. -->
    <footer class="bp-foot">
      {{ tStatic('dashboard.bp_subtitle') || "Search and filter the world's people groups · least-reached shown first" }}
    </footer>
  </div>
</template>

<style>
/* Self-size regardless of how a parent mounts us: a host that isn't a sized block makes
   .bp-root's height:100% resolve against nothing → 0-height collapse (the black-screen class).
   Declaring :host here means this element fills its slot even if the mounter forces no display
   (or the wrong one). See BUG-EMBEDDED-PLUGIN-STUDIO-BLACK-SCREEN-DISPLAY-BLOCK. */
:host { display: block; width: 100%; height: 100%; min-height: 480px; }
.bp-root {
  --bg: #f3f3f1; --line: #d1d4cd; --ink: #3b463d; --mut: #6d766e;
  display: flex; flex-direction: column;
  /* min-height:INHERIT, not 480px — the same fix as research-dashboard's .rd-shell. The floor keeps a
     host that supplies no height from collapsing this to nothing, which is worth keeping; stated as a
     constant it ALSO applied inside the gallery's height-bounded pane, where an element claiming
     height:100% and simultaneously refusing to be shorter than 480px is a contradiction the pane pays
     for. It grows past .dms-slot and .dms-pane's overflow-y:auto starts scrolling the whole plugin,
     tab strip included. Inheriting defers to :host: the gallery pins the element with an inline
     min-height:0 so this resolves to 0 and fills the pane, while a naive page keeps the guard.
     The 480px itself MOVED UP to :host rather than being deleted: :host had no floor, so inheriting
     from it would have quietly resolved to 0 everywhere and dropped the collapse guard the comment
     above calls load-bearing. On :host it is still a real floor for a naive mounter AND reachable by
     the shell's inline style, which is the whole point. */
  width: 100%; height: 100%; min-height: inherit; overflow: hidden;
  background: var(--bg); color: var(--ink); box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
.bp-body { flex: 1; min-height: 0; position: relative; overflow: auto; }
.bp-foot { flex: none; padding: 8px 12px; font-size: 11px; color: var(--mut); text-align: center;
  border-top: 1px solid var(--line); }
</style>
