<script setup>
/**
 * regions-mfe.vue — the regions-dashboard NESTED-ELEMENTS MFE (the 2-tab Regions element).
 *
 * @description The composite: ONE element carrying the SELECT VIEW switcher
 *   over two panes — tab 1 "Regions List" (regions-list) and tab 2 "Region Dashboards"
 *   (region-dashboards). Clicking a region or a country on tab 1 swaps to tab 2 with that
 *   selection already applied.
 *
 * IMITATES upg-100-mfe.vue, does not reinvent it. That file is this repo's reference composite
 * and the sanctioned thing to copy. Same shape, tab for tab:
 *   • the pane-wrapper layout (buildPaneColumn + PANE_GRID_STYLES) supplies the scrolling column
 *   • the SAME View switcher in the header — now the SHARED library component ViewSelect.vue,
 *     which is that control extracted from upg-100-mfe rather than copied a third time
 *   • ONE shared instanceId across both panes, so the cross-pane selection event resolves here
 *   • paneHint:false, because the header switcher already says there is a second view
 *   • INHERITED_PAGE_KEYS forwarded explicitly (the cap-4 asset-path lesson from upg-100-mfe:
 *     a nested element has no leaf page of its own to hand it page-scoped config)
 *
 * THE TAB-1 -> TAB-2 WIRING. regions-list already dispatches 'region-selected' /
 * 'country-selected' as composed, bubbling CustomEvents — it was built to be nested. This
 * composite listens on its own stage, normalises the two payloads to { regionSlug, countrySlug },
 * re-broadcasts them on the scoped 'doxa-regions-dashboard:select' window event that tab 2
 * listens for, and scrolls to tab 2. That is the same seam upg-100-mfe uses for the poster
 * wall's 'show-on-map', and it keeps each pane under its own ProfileLoader/Pinia.
 */
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { usePaneConfig } from '@map/composables/usePaneConfig.js'
import { buildPaneColumn, PANE_GRID_STYLES } from '@map/layouts/pane-wrapper/pane-wrapper.js'
import { urlOwnerOf, ownAddress } from '@map/composables/useViewAddress.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { SHADOW_BOX_SIZING_RESET } from './src/shadowReset.js'
import ViewSelect from '@map/components/ViewSelect.vue'
import ShareButton from '@map/components/map-controls/ShareButton.vue'
// The header ⓘ ("What can this map do?"), Big Picture's header recipe: the map-control MapInfoButton in its HEADER
// form, whose control bridge hands the tab's MapInfo to it (tabInfo.js trigger:'control').
import MapInfoButton from '@map/components/map-controls/MapInfoButton.vue'
// The SELECT VIEW strip is one of the sanctioned additions, so DX-life has no equivalent
// markup to clone — and until now its labels were hardcoded English, making it the one piece
// of chrome that never localised (visible at locale=ar: the panes and every heading go RTL
// and Arabic while the tabs still read "Regions List").
//
// t() here uses the same literal-English-as-key convention as the rest of the port, and the
// shim FALLS BACK TO THE KEY, so today's rendering is byte-identical. Deliberately NO keys
// were added to the catalogues: (a) translating our own additions is not this agent's call,
// and (b) check:i18n-parity tracks a per-locale debt CEILING — it/ro/zh sit at exactly 94
// missing because DX-life translates 8 of our 11 locales — so English-only keys would push
// them to 97 and fail the gate. The moment someone adds these three strings to all locales,
// the strip localises with no code change here.
import { useRegionsI18n } from '@map/i18n/useRegionsI18n.js'

const { t }   = useRegionsI18n()
const cfg     = inject('profileConfig', ref(null))
const uiStore = inject('uiStore', null)
const isDark  = computed(() => !!uiStore?.isDark)

const TAG = 'regions-dashboard'
// One instanceId shared by BOTH panes, so the selection event scopes to THIS embed even when
// two Regions elements sit on the same page.
const instanceId = computed(() => cfg.value?.instanceId || 'regions-mfe')

const spec = computed(() => ({
  id: 'regions-mfe',
  tag: TAG,
  // pinHint:false reaches the PANES from here, not from their own meta.json. A child profile's
  // meta only configures its own LEAF page; nested in this composite each pane is handed the
  // config built below, and PinHint.vue reads pinHint off the INJECTED profileConfig. Without
  // this the coach-mark reappeared over the cloned map inside the composite while the leaf
  // pages were correctly clean — the same cap-4 inheritance gap assetsBase hit.
  config: { profile: 'regions-list', instanceId: instanceId.value, pinHint: false },
  panes: [
    { id: 'list',      label: t('Regions List'),      at: [0, 0], config: { profile: 'regions-list' } },
    { id: 'dashboard', label: t('Region Dashboards'), at: [1, 0], config: { profile: 'region-dashboards' } },
  ],
  // The View switcher lives in this element's own header, so the layout's "… below ↓" pill
  // would be a second, redundant control (same call upg-100-mfe makes).
  paneHint: false,
}))

const stage = ref(null)
const view  = ref('list')
let column = null
let offScroll = null
let offOwn = null
// The page address (useViewAddress): ?pane= is the open view, ?place= the region or country. On this composite's own
// leaf it owns the address and writes both, the dashboard's choice included (ownAddress). Nested in a shell it owns
// nothing; its writes go up as announcements and the shell writes them.
const owner = () => urlOwnerOf(cfg.value)

// PAGE-LEVEL config keys a pane INHERITS from the host page — see the BUG-UPG100MFE-ASSET-PATH
// note in upg-100-mfe.vue: a cap-4 composite nests children in THIS document, so anything the
// generator bakes once per page has to be forwarded explicitly or the child falls back to its
// own default. Forwarded by KEY LIST, never by spreading the whole host config, so a pane's own
// `profile` / `instanceId` cannot be overwritten by the host's — that is what makes a pane a
// distinct view at all (pane.config is spread last and always wins).
// ★ urlSync IS PAGE-SCOPED CONFIG AND MUST BE INHERITED. Landing the guard in
// region-dashboards.vue was necessary and NOT sufficient: a nested pane has no leaf page of its
// own, so it only sees what this composite forwards. Without `urlSync` in this list the panes read
// cfg.urlSync as undefined, the guard never fires, and a Regions nested in the Research Gallery
// goes on rewriting the HOST page's #anchor and tab title -- which is exactly what a browser measurement found
// after my fix landed. A guard you cannot reach is not a guard.
// It is the same lesson as the cap-4 asset-path one this file already records: page-scoped config
// has to be forwarded explicitly. Note the filter below keeps `false`, which is the value that
// matters here -- it rejects undefined, null and '' only.
// ★ 'provider' MUST travel. A composite that forwards the token but not the provider hands a
// partner who asked for MapLibre a Mapbox map in every nested pane -- the pane reads
// provider as undefined and falls back. Same shape of bug as the missing 'urlSync' here
// before it: the inner map cannot honour a key the shell never passed down.
// ★ 'tokenUrl' and 'dataSource' added 2026-09-26. A universal-props RE-MEASURE (main
// dee9f9c9) named the first: tokenUrl "is absent from the INHERITED_PAGE_KEYS of country-posters-mfe,
// upg-100-mfe and regions-mfe". Measuring what that costs HERE, honestly: it is LATENT, not a live
// token failure. This composite IS mounted under a ProfileLoader, and that loader already watches
// config.tokenUrl, fetches it, and publishes the answer PAGE-WIDE (ProfileLoader.vue:130-134), which
// every pane reads through useSharedMapToken. So the panes do get a token today. What they do NOT get
// is the URL, so a pane can never RE-ask the token service on its own -- it is stuck with whatever the
// page published. Forwarding the key costs one word and removes the asymmetry.
// ★ 'dataSource' is a SECOND gap of the same shape, and it is NOT latent. The matrix's own
// embedder table lists it ("dataSource | wrong/partial data | Regions uses pray-tools"), nothing
// pins it in spec.config or either pane.config, and nothing publishes it page-wide the way the token
// is published. So a partner setting dataSource on <regions-mfe> had it silently dropped and both
// panes fell back to sources.json activeSource. Of the four keys that table documents, assetsBase was
// already here, tk is covered by the page-wide publish, profile is deliberately NOT inherited (see
// below), and this was the one genuinely missing.
const INHERITED_PAGE_KEYS = ['assetsBase', 'apiBaseUrl', 'prayBaseUrl', 'tokenUrl', 'dataSource', 'locale', 'lang', 'languageCode', 'isDark', 'qa', 'pinHint', 'urlSync', 'provider', 'list']

// ★ SPLIT OUT SO IT CAN BE RE-EVALUATED. This reads cfg.value and spec.value, so calling it again
// after the outer profile-config changes yields the NEW pane config. It used to be inline in
// paneElement, which ran once per pane in onMounted and never again -- that is the whole defect:
// the pane is handed a JSON STRING, so a later locale change reached this element and stopped.
// stage is the element the panes are appended UNDER, in the same tree as them -- contains() does
// not cross a shadow boundary, so the host must not be the custom element itself.
const paneConfig = usePaneConfig(() => stage.value)

function paneConfigFor(pane) {
  const host = cfg.value || {}
  const inherited = {}
  for (const k of INHERITED_PAGE_KEYS) {
    if (host[k] !== undefined && host[k] !== null && host[k] !== '') inherited[k] = host[k]
  }
  if (inherited.locale === undefined && inherited.lang !== undefined) inherited.locale = inherited.lang
  return { ...inherited, ...spec.value.config, ...pane.config }
}

function paneElement(pane) {
  const el = document.createElement(TAG)
  el.setAttribute('profile-config', JSON.stringify(paneConfigFor(pane)))
  return el
}

function go(id, changes) {
  view.value = id
  column?.scrollTo(id, { changes })
}

// ── tab 1 -> tab 2: forward the selection, then swap the visible pane ───────
const SELECT_EVENT = 'doxa-regions-dashboard:select'

function forwardSelection(detail) {
  window.dispatchEvent(new CustomEvent(SELECT_EVENT, {
    detail: { ...detail, instanceId: instanceId.value },
  }))
  // ONE address write for the click: the dashboard pane AND its subject, so Back returns to the list in one step.
  // The dashboard's own write of the same subject then finds it already there and writes nothing.
  go('dashboard', { place: detail.countrySlug || detail.regionSlug || '' })
}

// A region heading (or its "See X dashboard" link) was clicked on tab 1.
function onRegionSelected(e) {
  const d = e?.detail || {}
  forwardSelection({ regionSlug: d.slug || '', countrySlug: '' })
}

// A country row was clicked on tab 1 — carry BOTH slugs so tab 2 can show the country in the
// context of its region rather than as one lone bar.
function onCountrySelected(e) {
  const d = e?.detail || {}
  forwardSelection({ regionSlug: d.region?.slug || '', countrySlug: d.slug || '' })
}

onMounted(() => {
  if (!stage.value) return
  column = buildPaneColumn(spec.value, { host: stage.value, address: { owner } })
  if (!column) return
  offOwn = ownAddress(stage.value, owner)
  for (const pane of column.panes) {
    if (!pane.config) continue
    const el = paneElement(pane)
    column.mountEl(pane.id)?.appendChild(el)
    // Keep this pane's profile-config in step with the outer element's for the rest of the session.
    paneConfig.register(el, () => paneConfigFor(pane))
  }
  // Tabs are a readout as well as a control — follow the user's scroll.
  offScroll = column.onScroll(() => {
    const cur = column.current()
    if (cur && cur !== view.value) view.value = cur
  })
  // regions-list's events are composed+bubbling, so they surface on this stage; listening HERE
  // rather than on window keeps two Regions embeds on one page from hearing each other.
  stage.value.addEventListener('region-selected', onRegionSelected)
  stage.value.addEventListener('country-selected', onCountrySelected)
})

onBeforeUnmount(() => {
  stage.value?.removeEventListener('region-selected', onRegionSelected)
  stage.value?.removeEventListener('country-selected', onCountrySelected)
  offScroll?.()
  offOwn?.()
  column?.destroy()
  column = null
})

// Share the WHOLE MFE: this composite profile's own leaf page, TREE-RELATIVE.
const SHARE_EMBED_PATH = 'regions-dashboard/regions-mfe/index.html'

// NO BACKTICKS inside this CSS string, including in comments — one terminates the JS template
// literal and the build stops compiling (house style).
useShadowStyles(SHADOW_BOX_SIZING_RESET + PANE_GRID_STYLES + '\n' +
  // SELF-SIZE. Every layer inside is absolute/height:100% (.rmfe -> .pane-col -> .pane), so the
  // chain resolves to ZERO unless the HOST itself is sized — the "elements are not embedding"
  // failure upg-100-mfe documents. Declaring :host makes this fill whatever slot it is mounted
  // into, in every deploy method.
  ':host{ display:block; position:relative; width:100%; height:100%; min-height:420px; }' +
  // Material LIGHT palette only — no dark mode, no prefers-color-scheme override.
  '.rmfe{ --ui-bg:#ffffff; --ui-bg-elevated:#f3f3f1; --ui-bg-accented:#f3f3f1;' +
  '  --ui-border:#d1d4cd; --ui-text:#3b463d; --ui-text-muted:#6d766e; --ui-primary:#92b195;' +
  '  --header:56px;' +
  '  position:absolute; inset:0; display:flex; flex-direction:column; min-height:0;' +
  '  background:var(--ui-bg); color:var(--ui-text);' +
  '  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif; }' +
  // Header: same height/border as the shell; switcher centred, share at the right.
  '.rmfe .hdr{ flex:0 0 var(--header); height:var(--header); position:relative;' +
  '  display:flex; align-items:center; justify-content:flex-end; padding:0 12px;' +
  '  background:var(--ui-bg); border-bottom:1px solid var(--ui-border); }' +
  // POSITIONING is the caller's job — ViewSelect ships its own metrics but no placement, so the
  // absolute centring lives here exactly as it does in the shell and in upg-100-mfe.
  '.rmfe .hdr .viewsel{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }' +
  // ★ HEADER BUTTONS, Big Picture's recipe (design rule, 2026-09-30): the ⓘ and Share as rounded squares at the
  // vertical tabs' radius, side by side at the header's end. The SHAPE comes from each button's
  // shape="rounded-square" prop (--vtl-radius); this header only sizes them to 28 px and keeps a 44 px tap target.
  '.rmfe .hdr .hdr-btns{ display:inline-flex; align-items:center; gap:8px; flex:0 0 auto; }' +
  '.rmfe .hdr .hdr-btns .mcb{ --map-btn-size:28px; position:relative; }' +
  '.rmfe .hdr .hdr-btns .mcb svg{ width:16px; height:16px; }' +
  '.rmfe .hdr .hdr-btns .mcb::after{ content:""; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:44px; height:44px; }' +
  // ON A PHONE the centred view switcher (about 290 px at 390) leaves no room for two buttons at one end, so the
  // ⓘ takes the header's START edge, where the floating ⓘ sat before; Share keeps the end.
  '@media (max-width: 600px){ .rmfe .hdr .hdr-btns > :first-child{ position:absolute; inset-inline-start:12px; top:50%; transform:translateY(-50%); } }' +
  // Stage: the pane-wrapper column mounts here (its .pane-col is absolute).
  '.rmfe .stage{ position:relative; flex:1 1 auto; min-height:0; }' +
  '.pane > .pane-mount > *{ position:absolute; inset:0; width:100%; height:100%; display:block; }',
  'regions-mfe'
)
</script>

<template>
  <div class="rmfe">
    <header class="hdr">
      <ViewSelect
        :views="spec.panes"
        :current="view"
        :legend="t('Select View')"
        :label="t('Views')"
        @select="go"
      />
      <div class="hdr-btns" data-header-btns>
        <MapInfoButton :is-dark="isDark" shape="rounded-square" />
        <ShareButton :is-dark="isDark" :embed-path="SHARE_EMBED_PATH" shape="rounded-square" />
      </div>
    </header>
    <div class="stage" ref="stage"></div>
  </div>
</template>
