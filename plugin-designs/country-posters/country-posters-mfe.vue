<script setup>
/**
 * country-posters-mfe.vue — Country Posters as a TWO-TAB element.
 *
 * @element country-posters-map
 * @description Country Posters as ONE two-tab element — the countries map and the printable
 * poster wall behind a single view switcher, structured like the UPG-100 list. The switcher is
 * the library's shared ViewSelect, not a third hand-rolled copy.
 *
 * Country Posters has two tabs, structured like the
 * UPG-100 list.
 *
 * ★ THE CONTROL IS SHARED, NOT COPIED. That is the whole point of the card: this
 * is the THIRD place the SELECT VIEW switcher is needed, and it uses the library's
 * ViewSelect.vue — the same component upg-100-mfe and regions-mfe render. A third
 * hand-rolled copy is exactly what library/components/ViewSelect.vue was extracted
 * to prevent (its own header records that a fourth divergent copy is not what the
 * library is for).
 *
 * SAME SHAPE AS upg-100-mfe, deliberately — index.js already says this bundle is
 * "the same shape as my-upg-100-list", and copying its structure is what makes the
 * two elements behave identically for a reader who moves between them:
 *   • the pane-wrapper layout (buildPaneColumn + PANE_GRID_STYLES)
 *   • each pane keeps its own ProfileLoader/Pinia
 *   • one ShareButton in the header, per the recorded share policy
 *     (check:share-policy) — the MAP pane must not grow a second one
 *
 * LIST FIRST, MAP SECOND. The principle already applied in upg-100-mfe: a map need
 * not be the primary view — a list or a grid can be, with the map secondary and
 * reached as a transition from it. The poster wall
 * is the concrete artefact a newcomer can act on; the map is where it is placed.
 */
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { buildPaneColumn, PANE_GRID_STYLES } from '@map/layouts/pane-wrapper/pane-wrapper.js'
import { urlOwnerOf, ownAddress } from '@map/composables/useViewAddress.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import ViewSelect from '@map/components/ViewSelect.vue'
import { countryName } from '@map/utils/countryName.js'
import { previewOptedIn } from '@map/packet/countrySheet.js'
import { getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import ShareButton from '@map/components/map-controls/ShareButton.vue'
import { useI18n } from 'vue-i18n'
import enTabs from '@map/i18n/locales/en/tabs.json'

// The pane labels are the chrome a reader sees FIRST, and they were English literals while the
// panes inside translated (the upg-100-mfe finding). GUARDED: useI18n() throws on a host that never
// installed vue-i18n, so the English catalog is the fallback, never a blank or a dotted key.
let t = (k) => enTabs[String(k).replace(/^tabs\./, '')] || String(k)
try { const i18n = useI18n(); t = (k) => { const v = i18n.t(k); return v === k ? (enTabs[String(k).replace(/^tabs\./, '')] || k) : v } } catch (_) { /* no i18n on this host */ }

const cfg     = inject('profileConfig', ref(null))
const uiStore = inject('uiStore', null)
const isDark  = computed(() => !!uiStore?.isDark)

const TAG = 'country-posters-map'
// One instanceId shared by BOTH panes, so a scoped cross-pane event addresses THIS
// embed even when two Country Posters elements sit on the same page.
const instanceId = computed(() => cfg.value?.instanceId || 'country-posters-mfe')
// The map pane needs the Mapbox token the host page was given; the wall does not.
const tk = computed(() => cfg.value?.tk || '')

const spec = computed(() => ({
  id: 'country-posters-mfe',
  tag: TAG,
  // pinHint:false reaches the PANES from here, not from their own meta. A child's
  // meta configures only its own LEAF page; nested in this composite each pane is
  // handed the config built below, and PinHint.vue reads pinHint off the INJECTED
  // profileConfig — so without this the coach-mark reappears over the cloned map.
  config: { profile: 'country-poster-wall', instanceId: instanceId.value, pinHint: false },
  // ORDER LIVES IN at[0], NOT IN THIS ARRAY'S ORDER. buildPaneColumn SORTS by at[0]
  // while ViewSelect renders this array VERBATIM, so the two must agree or the tab
  // strip desynchronises from the scroll column.
  panes: [
    { id: 'wall', label: t('tabs.countryPosters'), at: [0, 0], config: { profile: 'country-poster-wall' } },
    // the same DEV-gated read as countrySheet.js previewUnreleased() (dev server AND the explicit opt-in), INLINE so
    // every build drops the pane entirely
    ...(import.meta.env && import.meta.env.DEV && globalThis.DXM_PREVIEW_UNRELEASED === true && previewOptedIn() ? [INDIA_PANE] : []),
    { id: 'map',  label: t('tabs.map'),             at: [2, 0], config: { profile: 'countries-map' } },
  ],
  // The switcher lives in this element's own header, so the layout's "… below ↓"
  // pill would be a second, redundant control (same call upg-100-mfe makes).
  paneHint: false,
}))

// INDIA: the whole-India poster (66x66 by default) on its own tab, the same wall filtered to India, labelled with
// India's own name in the reader's language (Intl). Shown ONLY in an opted-in preview (countrySheet.js
// previewUnreleased(): the pilot's dev server AND ?preview=india or localStorage 'dxm-preview'), because the poster is
// not released; everywhere else (the pilot without the opt-in included) the tab is absent and India's card keeps the
// withheld sentence.
const INDIA_PANE = { id: 'india', label: countryName('IND', getRuntimeLocale() || detectLocale() || 'en') || 'India', at: [1, 0], config: { profile: 'country-poster-wall', countries: ['IND'] } }

const stage = ref(null)
// DERIVED from the pane order, never a hardcoded id — the same trap upg-100-mfe
// records: `ref('map')` silently became wrong the moment the panes were reordered.
const firstPaneId = computed(() => {
  const col = spec.value.panes
    .filter((p) => (p.at?.[1] ?? 0) === 0)
    .sort((a, b) => (a.at?.[0] ?? 0) - (b.at?.[0] ?? 0))
  return col[0]?.id || 'wall'
})
const viewRaw = ref(null)
const view = computed({
  get: () => viewRaw.value || firstPaneId.value,
  set: (v) => { viewRaw.value = v },
})
let column = null
let offScroll = null
let offOwn = null
// The page address (useViewAddress): ?pane= is the open view ('map'; the first pane is the default and never written).
// On this composite's own leaf it owns the address (ownAddress); nested in a shell it announces and the shell writes.
// The India pane exists only in an opted-in preview, so ?pane=india names nothing anywhere else.
const owner = () => urlOwnerOf(cfg.value)

// PAGE-LEVEL config keys a pane INHERITS from the host page. A cap-4 composite
// nests children as custom elements in THIS document, so anything the generator
// bakes once per page (where assets are served from, which backend, the theme) has
// to be forwarded explicitly or the child falls back to its own default — the
// BUG-UPG100MFE-ASSET-PATH-DEPTH-404S failure, where every preview 404'd because
// assetsBase never reached the consumer.
// Forwarded by KEY LIST, never by spreading the whole host config, so a pane's own
// `profile`/`instanceId` cannot be overwritten (pane.config is spread last).
// ★ 'provider' MUST travel. A composite that forwards the token but not the provider hands a
// partner who asked for MapLibre a Mapbox map in every nested pane -- the pane reads
// provider as undefined and falls back. Same shape of bug as the missing 'urlSync' here
// before it: the inner map cannot honour a key the shell never passed down.
// ★ 'dataSource' and 'tokenUrl' added 2026-09-26 (the same gap regions fixed in f0aa5ab3).
// dataSource is LIVE: countries-map reads it from its own profile-config (inject('dataSource'),
// countries-map.vue:392/622), nothing pinned it in spec.config or pane.config, and nothing publishes it
// page-wide, so a partner's dataSource on <country-posters-mfe> was dropped and the map fell back to
// sources.json's activeSource. tokenUrl is LATENT: the outer ProfileLoader fetches it and publishes
// the token page-wide, so the panes get a token today, but not the URL to re-ask it themselves.
// ★ The MAP's own view keys travel too (C11b ONE-CONFIG-HALF-WIRED, 2026-09-28): countries-map reads
// style / lightPreset / search / center / zoom / pitch / bearing / minZoom from its profile-config, and
// none of them was forwarded, so a partner who set a basemap, a night look, "no search" or a start view
// on <country-posters-mfe> got a working map at the DEFAULTS: it looked right and ignored them. The wall
// ignores these keys; pane.config still spreads last, so a pane's own profile/instanceId always wins.
const INHERITED_PAGE_KEYS = ['assetsBase', 'apiBaseUrl', 'prayBaseUrl', 'tokenUrl', 'dataSource', 'locale', 'lang', 'isDark', 'qa', 'provider', 'list',
  'style', 'lightPreset', 'search', 'center', 'zoom', 'pitch', 'bearing', 'minZoom']

function paneElement(pane) {
  const el = document.createElement(TAG)
  const host = cfg.value || {}
  const inherited = {}
  for (const k of INHERITED_PAGE_KEYS) {
    if (host[k] !== undefined && host[k] !== null && host[k] !== '') inherited[k] = host[k]
  }
  // `lang` is the alias the page may carry; children read `locale`.
  if (inherited.locale === undefined && inherited.lang !== undefined) inherited.locale = inherited.lang
  const pcfg = { ...inherited, ...spec.value.config, ...pane.config }
  if (tk.value) pcfg.tk = tk.value
  el.setAttribute('profile-config', JSON.stringify(pcfg))
  return el
}

// `inert` on every pane except the active one: the same contract as upg-100-mfe (4642e78d). The panes
// are stacked in one scroll-snap column, so the hidden pane is still full-size geometry; inert tells
// PosterWall (67e9ede5) the wall is out of view so it forgets its shown card, and a second
// "Show on map" after Map -> back SHOWS the country again instead of toggling it off.
// inert, not display:none: hiding would tear down the live map.
function markActivePane(activeId) {
  if (!column || !activeId) return
  for (const pane of column.panes) {
    const el = column.mountEl(pane.id)
    if (!el) continue
    if (pane.id === activeId) el.removeAttribute('inert')
    else el.setAttribute('inert', '')
  }
}

function go(id) {
  view.value = id
  column?.scrollTo(id)
  markActivePane(id)   // now, not after the smooth scroll settles
}

// ── tab 1 -> tab 2 (shell seam) ─────────────────────────────────────────────
// country-poster-wall already dispatches this scoped window event when a card's
// "Show on map" is clicked — country-poster-wall.vue:78 sets event-name. Until now
// ONLY the app shell listened (app-wrapper-material/index.html), so the action did
// nothing in a dropped embed or a nested composite: the event fired into a document
// with no handler. Owning it here is what makes the two tabs one element rather
// than two pages that happen to share a bundle.
// Pane elements by id, so the map pane can be addressed after mount.
const paneEls = {}

const SHOW_ON_MAP = 'doxa-country-posters:show-on-map'
function onShowOnMap(e) {
  const d = e?.detail || {}
  if (d.instanceId && d.instanceId !== instanceId.value) return
  go('map')
  // ★ THE FORWARDING THAT WAS NEVER WRITTEN. This handler used to end at go('map'), so the tab
  // changed and the map was never told anything at all -- measured exactly: "the camera
  // stays at world view, nothing selected". It is not a timing bug and no amount of waiting fixes
  // it; the link simply did not exist.
  //
  // Same shape as upg-100's: RECORD the request as an attribute, then announce it by event.
  // An attribute is state, so it survives custom-element upgrade and is still readable when the
  // map pane finally gets there (and when its style finishes loading later still); the event is
  // only the live path for a map that is already up. Both end in one applySelectCountry() inside
  // the pane, so there is one apply path with two triggers.
  //
  // The attribute carries the country ID, not its geometry: countries-map resolves the id against
  // the same library/data/country-posters.json the wall renders from, so the bbox has exactly one
  // source of truth rather than being copied through an attribute.
  // An Indian state's card (the state table's ids are 'india-<code>') shows India: this map draws countries,
  // not states, so framing the country is the honest answer rather than a world view with nothing selected.
  const listId = d.listId ?? null
  const countryId = typeof listId === 'string' && listId.startsWith('india-') ? 'country-ind' : listId
  const el = paneEls.map
  if (!el) return
  if (countryId) el.setAttribute('select-country', String(countryId))
  else el.removeAttribute('select-country')
  el.dispatchEvent(new CustomEvent('doxa:select-country', { detail: { countryId } }))
}

onMounted(() => {
  if (!stage.value) return
  column = buildPaneColumn(spec.value, { host: stage.value, address: { owner } })
  if (!column) return
  offOwn = ownAddress(stage.value, owner)
  for (const pane of column.panes) {
    if (!pane.config) continue
    // ★ KEEP THE ELEMENT. It used to be created and dropped on the same line, so there was no
    // handle to address the map pane with later -- which is part of why "Show on map" could only
    // ever switch tabs here. upg-100-mfe already retained its pane elements; this matches it.
    const el = paneElement(pane)
    paneEls[pane.id] = el
    column.mountEl(pane.id)?.appendChild(el)
  }
  // Tabs are a readout as well as a control — follow the user's scroll.
  markActivePane(column.current() || view.value)   // the fresh-load state, before any switch
  offScroll = column.onScroll(() => {
    const cur = column.current()
    if (cur && cur !== view.value) view.value = cur
    if (cur) markActivePane(cur)   // always: a switcher-driven scroll already set view.value
  })
  window.addEventListener(SHOW_ON_MAP, onShowOnMap)
  // profile-config `view` opens a chosen pane ("map" or "wall"), so an embed can start on the map.
  const opening = cfg.value?.view
  if (opening && opening !== firstPaneId.value && spec.value.panes.some((p) => p.id === opening)) go(opening)
})

onBeforeUnmount(() => {
  window.removeEventListener(SHOW_ON_MAP, onShowOnMap)
  offScroll?.()
  offOwn?.()
  column?.destroy()
  column = null
})

// Share the WHOLE MFE: this composite profile's own leaf page, TREE-RELATIVE
// (<bundle>/<profile>/index.html) — ShareButton joins it to the served tree root.
// ★ Sharing the COMPOSITE, not a child, is the BUG-SHARE-FROM-CAP4-COMPOSITE bug
// this pattern already paid for once.
const SHARE_EMBED_PATH = 'country-posters/country-posters-mfe/index.html'

// Child components' <style> blocks are dropped by defineCustomElement, so ALL CSS
// goes through useShadowStyles: the layout's grid styles + this element's chrome.
useShadowStyles(PANE_GRID_STYLES + `
/* SELF-SIZE (BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT). Every layer inside this element is
   position:absolute / height:100%, so the whole chain resolves to ZERO unless the HOST is
   sized. A standalone leaf page papers over it with a page-level rule; inside a tab layout
   no such rule exists and every pane collapses to 0 — the "elements are not embedding"
   report. Declaring :host makes the element fill its slot in every deploy method. */
:host{ display:block; width:100%; height:100%; min-height:420px; }
/* ── palette: DX-life material light. NO AUTO-DARK (decided 2026-09-20): a system set to
   dark mode must not flip this element. ── */
.cpmfe{
  --ui-bg:#ffffff; --ui-bg-elevated:#f3f3f1; --ui-bg-accented:#f3f3f1;
  --ui-border:#d1d4cd; --ui-text:#3b463d; --ui-text-muted:#6d766e; --ui-primary:#92b195;
  --header:56px;
  position:absolute; inset:0; display:flex; flex-direction:column; min-height:0;
  background:var(--ui-bg); color:var(--ui-text);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
}
.cpmfe .hdr{
  flex:0 0 var(--header); height:var(--header); position:relative;
  display:flex; align-items:center; justify-content:flex-end; padding:0 12px;
  background:var(--ui-bg); border-bottom:1px solid var(--ui-border);
}
/* Only the PLACEMENT lives here — the control's metrics are the shared component's. */
.viewsel{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
.cpmfe .stage{ position:relative; flex:1 1 auto; min-height:0; }
.pane > .pane-mount > *{ position:absolute; inset:0; width:100%; height:100%; display:block; }
`, 'country-posters-mfe')
</script>

<template>
  <div class="cpmfe">
    <header class="hdr">
      <ViewSelect
        :views="spec.panes"
        :current="view"
        :legend="t('tabs.selectView')"
        :label="t('tabs.views')"
        @select="go"
      />
      <ShareButton :is-dark="isDark" :embed-path="SHARE_EMBED_PATH" shape="rounded-square" />
    </header>
    <div class="stage" ref="stage"></div>
  </div>
</template>
