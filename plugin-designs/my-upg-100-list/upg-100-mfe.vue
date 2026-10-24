<script setup>
/**
 * upg-100-mfe.vue — the my-upg-100-list NESTED-ELEMENTS MFE.
 *
 * @description The standalone, shareable and embeddable composite of the my-upg-100-list family — it nests the map
 *   and the poster wall as its own elements rather than reimplementing either.
 *
 * IMITATES THE SHELL, does not reinvent it. This profile is the standalone,
 * shareable/embeddable version of what app-wrapper-material already does for
 * 'upg-100-list': it composes the bundle's two sibling elements — the UPG-100
 * map (`upg-100-list`) and the poster wall (`poster-wall`) — as PANES using the
 * SAME pane-wrapper layout the shell nests (buildPaneColumn + PANE_GRID_STYLES),
 * and the SAME View switcher the shell shows in its header — now the shared
 * components/ViewSelect.vue, which is that control extracted from this file so
 * regions-dashboard could reuse it instead of copying it a third time.
 *
 * Copied conventions (see layouts/app-wrapper-material/index.html, 'upg-100-list'):
 *   • panes: { id:'list', label:'Prayer Resources', at:[0,0], config:{ profile:'poster-wall' } }
 *            and { id:'map', label:'Map', at:[1,0] } — RESOURCES FIRST; see the note
 *            on `panes` below for why the familiar view is the on-ramp to the map.
 *   • per-pane element config = { ...spec.config, ...pane.config } — same tag, same
 *     bundle, different `profile`; one download serves both panes.
 *   • ONE shared instanceId for both panes (as the shell does) so the poster wall's
 *     scoped 'doxa-upg-100-list:show-on-map' event can address this map.
 *   • Motion contract is the layout's: vertical neighbours are ONE scrollable page,
 *     scroll-snap between them; the View tabs call column.scrollTo(id) and stay in
 *     sync with column.current() on scroll.
 *
 * Why nested ELEMENTS (not importing the sibling .vue files): each profile runs
 * under its own ProfileLoader (own Pinia / stores). Mounting the bundle's own
 * custom element per pane keeps that isolation intact — see ProfileLoader.vue.
 *
 * Share: one Share button whose embed-path is THIS profile's leaf page, so the
 * whole MFE (both panes) is what gets shared/embedded.
 */
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { buildPaneColumn, PANE_GRID_STYLES } from '@map/layouts/pane-wrapper/pane-wrapper.js'
import { urlOwnerOf, ownAddress } from '@map/composables/useViewAddress.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import ViewSelect from '@map/components/ViewSelect.vue'
import ShareButton from '@map/components/map-controls/ShareButton.vue'
// The header ⓘ, in Big Picture's header-button form (DashboardTopBar): MapInfoButton answers the tab's MapInfo
// through the control bridge (tabInfo 'upg-100' trigger:'control'), which then keeps its floating ⓘ off.
import MapInfoButton from '@map/components/map-controls/MapInfoButton.vue'

// ★ THE SHELL'S OWN CHROME WAS ENGLISH IN EVERY LOCALE. Measured at ?lang=ar:
// 'Select View', 'Prayer Resources' and 'Map' rendering in English while the poster wall's own
// buttons inside the panes translated correctly — because the panes each install i18n and this
// wrapper never did. The chrome a reader sees FIRST was the untranslated part.
//
// ⚠ GUARDED, like every other useI18n() call in this codebase: it THROWS on a host that has not
// installed vue-i18n, and this component is mounted by hosts we do not control. useOptionalT holds
// that guard once — host i18n first, then tStatic, then the key — instead of a hand-rolled copy here.
// No namespace: callers pass FULL keys here, exactly as the raw useI18n().t they used to get.
//
// ★ ONE BEHAVIOUR GAIN FROM WAVE 3c, stated rather than smuggled (4c05e589): the old
// i18n path was the bare useI18n().t, so on a host WITH i18n a missing key rendered the raw dotted key.
// It now falls through to the catalogue instead.
//
// ★ AND THE humanizeKey FALLBACK IS GONE — the one deliberate departure from 4c05e589, which kept it.
// It rendered a key's last segment title-cased, so a bare host showed "Select View": fine in English
// and simply WRONG for every other reader, because it is derived from the identifier and cannot be
// translated. Worse, it AGREED with en on these four keys (they are named after the words), so it
// looked correct forever while every non-English reader silently got English. tStatic honours the
// reader's locale and still ends at English.
// The four keys this file uses (tabs.map / prayerResources / selectView / views) are present in all
// ELEVEN locales, 0 gaps, enumerated 2026-09-27 — nothing here was relying on the fallback.
// A product decision (2026-09-27), under the standing goal that the
// production maps be localized; it changes what seven vue-i18n-less bundles render, which is not a
// decision a migration gets to make for itself.
const t = useOptionalT('')

const cfg     = inject('profileConfig', ref(null))
// P2: the pane in view is part of the address (?pane=), written by whoever owns this page (urlOwnerOf).
const owner   = () => urlOwnerOf(cfg.value)
const tk      = inject('mapboxToken', ref(''))
const uiStore = inject('uiStore', null)
const isDark  = computed(() => !!uiStore?.isDark)

const TAG = 'my-upg-100-list-map'
// One instanceId shared by BOTH panes — exactly as the shell's registry does
// ('wrapper-upg-100' for map and list) so cross-pane events resolve to this app.
const instanceId = computed(() => cfg.value?.instanceId || 'upg-100-mfe')

// The PROFILES-registry-shaped spec this layout consumes (ids/labels copied verbatim).
const spec = computed(() => ({
  id: 'upg-100-mfe',
  tag: TAG,
  // ⚠ dataSource IS PASSED ONLY WHEN THE PARTNER SETS IT — no hardcoded default here. This read
  // `cfg.value?.dataSource || 'pray-tools'`, which is a composite-level constant standing in FRONT of the
  // pane's own lookup: ProfileLoader.vue:142 resolves
  //     config.dataSource || sourcesConfig.activeSource || 'doxa-csv'
  // and sources.json's activeSource is 'pray-tools' today, so the two AGREE and this is a no-op refactor
  // (verified from source, not assumed).
  // It matters anyway, for two reasons. (a) The day activeSource changes, these panes would silently keep
  // using 'pray-tools' while every other consumer moved — a divergence nothing would report. (b) The
  // comment at ProfileLoader.vue:135-141 records this EXACT bug already happening once: a host embedding
  // without profile-config.dataSource fell through to 'doxa-csv', whose relative CSV path 404s off a CDN
  // origin, so the map loaded and no data fetch fired. `activeSource` was inserted to fix that, and a
  // hardcoded constant in front of it re-opens the hole it closed.
  // Regions hit the mirror image (a partner's dataSource silently DROPPED, f0aa5ab3); mine overrode a
  // partner's SILENCE. Same class — the composite deciding for the panes — opposite direction.
  config: {
    profile: 'upg-100-list',
    // profile and instanceId ARE this composite's own config, deliberately: the panes ARE profile
    // 'upg-100-list', and both share one instanceId so cross-pane events resolve to the same app.
    // Regions' gate forbids them in INHERITED_PAGE_KEYS (inherited FROM THE HOST), not here.
    instanceId: instanceId.value,
    ...(cfg.value?.dataSource ? { dataSource: cfg.value.dataSource } : {}),
  },
  // RESOURCES FIRST, MAP SECOND (2026-09-23). By default the first tab is not the
  // map; it is the prayer resources — that pane
  // already explains what a UPG-100 list IS at the top and shows the posters, so it
  // needs no explanation; a choropleth of zones does. Generalised as a design
  // principle: a map need not be primary. A list or a grid can be the
  // primary view, with the map secondary and reached as a transition from it.
  //
  // ORDER LIVES IN `at[0]`, NOT IN THIS ARRAY'S ORDER. buildPaneColumn SORTS by
  // at[0] (pane-wrapper.js), while ViewSelect renders this array VERBATIM. Swapping
  // only one of the two desynchronises the tab strip from the scroll column — the
  // strip would read "Prayer Resources | Map" while scroll position 0 still held the
  // map. Both are swapped here, and `view` below is initialised from the same sort.
  // Labels through t(). `spec` is a computed, so switching locale re-labels the tab strip
  // rather than needing a remount — which is the behaviour the locale switcher assumes.
  panes: [
    { id: 'list', label: t('tabs.prayerResources'), at: [0, 0], config: { profile: 'poster-wall' } },
    { id: 'map',  label: t('tabs.map'),             at: [1, 0], config: { profile: 'upg-100-list' } },
  ],
  // The View switcher lives in this element's own header, so the layout's
  // "… below ↓" pill would be a second, redundant control (the shell's rule since 2026-08-01).
  paneHint: false,
}))

const stage  = ref(null)
// DERIVED from the pane order, never a hardcoded id. This was `ref('map')`, which
// silently became wrong the moment the panes were reordered: the column scrolled to
// the resources pane while the strip still painted "Map" as pressed. Sorting by
// at[0] here is the SAME rule buildPaneColumn applies, so the pressed tab and the
// pane at scroll-position 0 cannot disagree.
const firstPaneId = computed(() => {
  const col = spec.value.panes
    .filter(p => (p.at?.[1] ?? 0) === 0)
    .sort((a, b) => (a.at?.[0] ?? 0) - (b.at?.[0] ?? 0))
  return col[0]?.id || 'list'
})
const viewRaw = ref(null)
// Until the column exists, the active view IS the first pane — so the strip paints a
// pressed tab on the very first render rather than flashing with nothing selected.
const view = computed({
  get: () => viewRaw.value || firstPaneId.value,
  set: (v) => { viewRaw.value = v },
})
let column   = null
let offScroll = null
let offOwn    = null   // P2: ownAddress's undo, called on unmount
// The mounted custom element per pane id. Kept because a cross-pane action has to reach the
// TARGET PANE'S ELEMENT: upg-100-list listens for 'doxa:select-zone' on itself rather than on
// window, precisely so two embeds on one page do not cross-talk — which means the shell has to
// know which element it mounted. Cleared on unmount with everything else.
const paneEls = {}

// PAGE-LEVEL config keys a pane INHERITS from the host page.
//
// A cap-4 composite nests its children as custom elements in THIS document, so there is no
// inner leaf page to hand them the page-scoped values an iframe child would have received
// from its own generated index.html. Anything the generator bakes ONCE PER PAGE — where
// assets are served from, which backend to call, the theme — has to be forwarded explicitly
// or the child silently falls back to its own default.
//
// BUG-UPG100MFE-ASSET-PATH-DEPTH-404S (2026-09-20): `assetsBase` was not forwarded. The
// generator emitted the CORRECT value ("../../assets", identical to every sibling leaf), but
// the poster-wall pane never saw it and fell back to its own './assets' default — which
// resolves against the LEAF directory, so all 27 previews requested
// upg-100-mfe/assets/previews/<slug>.webp and 404'd. The depth calculation was never wrong;
// the value simply never reached the consumer.
//
// Forwarded by KEY LIST, not by spreading the whole host config: a pane's own `profile` /
// `instanceId` must NOT be overwritten by the host's, which is what makes a pane a distinct
// view at all. Anything a pane declares still wins (pane.config is spread last).
// ★ 'provider' MUST travel. A composite that forwards the token but not the provider hands a
// partner who asked for MapLibre a Mapbox map in every nested pane -- the pane reads
// provider as undefined and falls back. Same shape of bug as the missing 'urlSync' here
// before it: the inner map cannot honour a key the shell never passed down.
// ⚠ tokenUrl IS FORWARDED EXPLICITLY. The panes already RECEIVE a token in practice — the outer
// ProfileLoader fetches profile-config.tokenUrl and publishes a page-wide shared token — so this was
// working by a side effect of something else rather than by this contract. The
// universal-props change (2026-09-26) flagged it for exactly that reason: a prop that arrives because a
// neighbour happens to publish it is not forwarded, it is lucky, and it breaks silently the day the
// neighbour stops. Naming it here makes the panes' token a consequence of this list.
const INHERITED_PAGE_KEYS = ['assetsBase', 'apiBaseUrl', 'tokenUrl', 'locale', 'lang', 'isDark', 'qa', 'provider', 'list']

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
  // ★ NO "TAP A COLOURED DOT" COACH-MARK ON THIS PROFILE, AT ALL (2026-09-27).
  // ProfileLoader mounts PinHint by default and self-gates it on a map <canvas> existing, which is a
  // sound gate for the question it asks ("is there a map here?") and the WRONG question for this
  // profile. UPG-100's map is a POSTER PREVIEW: the reader is looking at what will be printed, and there
  // is no per-dot detail to open. So the pill invites a gesture that does nothing, and on the phone the
  // reported screenshots show it over a page with no coloured dots on it at all.
  // ⚠ THIS SUPERSEDES THE inert WORK FOR THIS PROFILE, and that is worth saying plainly rather than
  // quietly leaving both in: PILLRISK was "the pill shows over the posters", and I fixed WHERE it shows.
  // It should not show HERE, full stop — a narrower and more correct claim
  // than the earlier one. The inert signal stays because it is still right for its own reasons (a stacked pane
  // should not be in tab order or the a11y tree, and the PinHint change serves profiles that DO
  // want the pill), but it is no longer what keeps this pill off this app.
  // Opt-out via the contract that already existed — ProfileLoader.vue:150 reads
  // `config.pinHint !== false` — so this is a config value from my side, not a library change.
  pcfg.pinHint = false
  if (tk.value) pcfg.tk = tk.value
  el.setAttribute('profile-config', JSON.stringify(pcfg))
  return el
}

// ★ TELL THE INVISIBLE PANE THAT IT IS INVISIBLE. `inert` on every pane except the active one.
//
// THE DEFECT, reported from use and traced by repo (PILLRISK, 2026-09-27): PinHint's "Tap a
// coloured dot" pill appeared OVER the Prayer Resources posters on a phone. Its IntersectionObserver
// was working correctly — that is the point. The panes are `position:absolute; inset:0` in one
// scroll-snap column, so the map pane is STACKED BEHIND the active view at full size: 100% of its
// geometry is inside the viewport while none of it is visible. An IntersectionObserver measures
// INTERSECTION, not OCCLUSION, and no amount of tuning it can distinguish those two states. The
// missing information was never geometric — only the composite knows which pane the reader chose.
//
// ⚠ inert, NOT display:none OR v-show, and this is the constraint that decides the whole approach:
// hiding the pane would tear down the live map. A MapLibre/Mapbox canvas in a zero-size container
// loses its size and re-initialises on the way back, which is exactly the cold-start path that had to
// be verified in row 52. inert leaves the pane mounted, painted and warm; it only declares it non-interactive
// — and, unlike aria-hidden, also removes it from tab order and the accessibility tree, so a keyboard
// user cannot tab into a map they cannot see. (The library contract: PinHint walks up through
// shadow roots for inert/hidden/aria-hidden and watches that chain with a MutationObserver, so no event
// is needed and switching views brings the pill straight back.)
//
// ★ CORRECT AT EVERY VIEWPORT, not just the phone. pane-wrapper renders ONE column with
// `scroll-snap-type: y mandatory` and `.pane { height: 100% }`, so exactly one pane fills the stage on
// any width — there is no side-by-side mode in v1 whose second pane would be wrongly marked. Verified
// in pane-wrapper.js:56-59 + :101 rather than assumed from the phone report.
function markActivePane(activeId) {
  if (!column) return
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
  // Immediately, not on the scroll callback: scrollTo is SMOOTH, so onScroll's 120ms debounce fires
  // only after the animation settles. Waiting for it would leave the pill visible over the posters for
  // the length of the scroll — a shorter version of the same bug.
  markActivePane(id)
}

// Cross-pane action (shell seam): the poster wall dispatches a scoped window event
// when a card's "Show on map" is clicked. The pane owner scrolls to the map pane AND
// tells the map WHICH zone to isolate.
//
// ★ SCROLLING WAS ONLY HALF THE HANDOFF, and the missing half was invisible because the
// visible part worked: go('map') moved the reader to the map, so the action looked like it
// had happened, while the map still showed all 27 zones. The requirement is that
// Show on map behaves as if that result had been searched in
// the search bar — i.e. ISOLATED, not merely scrolled to.
//
// The map half was already built and waiting: upg-100-list.vue listens for 'doxa:select-zone'
// ON ITS OWN ELEMENT (not on window, so several embeds never cross-talk) and routes it through
// onLegendSelect — the same path a legend row tap and the search bar use. So the shell owes it
// exactly one re-dispatch, onto the element it mounted, and nothing here re-implements
// selection. detail.listId carries the zone, or null to un-isolate, which is what the wall
// already sends for its green toggle.
function onShowOnMap(e) {
  const d = e?.detail || {}
  if (d.instanceId && d.instanceId !== instanceId.value) return
  go('map')
  // ★ RECORD THE REQUEST, THEN ANNOUNCE IT — in that order, and the order is the fix.
  // The comment that used to sit here called the miss "the degradation we want": a pane that had
  // not mounted got nothing, and the scroll still happened. What that actually cost, measured
  // — the FIRST "Show on map" did nothing at all, and only a SECOND click, after the map had
  // loaded, selected the zone. A control the user must press twice reads as broken.
  //
  // An element dispatch has no replay, so it can only reach a listener that already exists. An
  // ATTRIBUTE is state: it survives custom-element upgrade, it is readable whenever the pane
  // finally gets there, and it is still readable if the pane's data arrives later still. So the
  // selection is written down first and the event is kept purely as the live path for a map that
  // is already up. Both triggers end in the same applySelectZone() inside the pane, so there is one
  // apply path with two triggers rather than two ways to select.
  const zoneId = d.listId ?? null
  if (paneEls.map) {
    if (zoneId) paneEls.map.setAttribute('select-zone', String(zoneId))
    else paneEls.map.removeAttribute('select-zone')
    paneEls.map.dispatchEvent(new CustomEvent('doxa:select-zone', { detail: { listId: zoneId } }))
  }
}

onMounted(() => {
  if (!stage.value) return
  column = buildPaneColumn(spec.value, { host: stage.value, address: { owner } })
  if (!column) return
  offOwn = ownAddress(stage.value, owner)
  for (const pane of column.panes) {
    if (!pane.config) continue
    const el = paneElement(pane)
    paneEls[pane.id] = el
    column.mountEl(pane.id)?.appendChild(el)
  }
  // ★ THE FRESH-LOAD CASE, which is the one actually reported. Without this the panes carry no
  // inert attribute at all until the reader touches the switcher, so the pill is over the posters on
  // ARRIVAL — before any view change has happened. A signal that only fires on transitions never
  // describes the initial state.
  markActivePane(column.current())

  // Tabs are a readout as well as a control — follow the user's scroll.
  offScroll = column.onScroll(() => {
    const cur = column.current()
    if (cur && cur !== view.value) view.value = cur
    // Unconditionally, NOT inside the `cur !== view.value` guard above: go() has already set view.value
    // before this fires, so a switcher-driven scroll takes the early exit and would skip the marking. A
    // scroll-driven one needs it and a switcher-driven one is idempotent, so doing it always is both
    // cheaper to reason about and the only version that is correct on both paths.
    if (cur) markActivePane(cur)
  })
  window.addEventListener('doxa-upg-100-list:show-on-map', onShowOnMap)
})

onBeforeUnmount(() => {
  window.removeEventListener('doxa-upg-100-list:show-on-map', onShowOnMap)
  offScroll?.()
  offOwn?.()
  offOwn = null
  column?.destroy()
  column = null
  // Drop the element references with the column that owned them — holding a detached custom
  // element after unmount is a leak, and a stale one would be dispatched into on remount.
  for (const k of Object.keys(paneEls)) delete paneEls[k]
})

// Share the WHOLE MFE: this composite profile's own leaf page, TREE-RELATIVE
// (<bundle>/<profile>/index.html) — ShareButton joins it to the served tree root.
const SHARE_EMBED_PATH = 'my-upg-100-list/upg-100-mfe/index.html'

// Child components' <style> blocks are dropped by defineCustomElement, so ALL CSS
// goes through useShadowStyles: the layout's grid styles + this element's chrome.
useShadowStyles(PANE_GRID_STYLES + `
/* SELF-SIZE (BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT). Every layer inside this element is
   position:absolute / height:100% (.upgmfe -> .pane-col -> .pane), so the whole chain resolves to
   ZERO unless the HOST itself is sized. The standalone leaf page papered over it with a page-level
   rule, but inside a tab layout no such rule exists -> the header rendered and every pane collapsed
   to 0, which is the "elements are not embedding" report. Declaring :host here makes the element
   fill whatever slot it is mounted into, in every deploy method. */
:host{ display:block; width:100%; height:100%; min-height:420px; }
/* ── palette: DX-life material light ── */
.upgmfe{
  --ui-bg:#ffffff; --ui-bg-elevated:#f3f3f1; --ui-bg-accented:#f3f3f1;
  --ui-border:#d1d4cd; --ui-text:#3b463d; --ui-text-muted:#6d766e; --ui-primary:#92b195;
  --header:56px;
  position:absolute; inset:0; display:flex; flex-direction:column; min-height:0;
  background:var(--ui-bg); color:var(--ui-text);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
}
/* NO AUTO-DARK. The DX design pattern is material LIGHT (decided 2026-09-20): a system set to dark
   mode must NOT flip this element. The prefers-color-scheme:dark override that used to live here is
   removed deliberately — the light palette above is the only theme. */
/* ── header: same height/border as the shell; switcher centred; share at right ── */
.upgmfe .hdr{
  flex:0 0 var(--header); height:var(--header); position:relative;
  display:flex; align-items:center; justify-content:flex-end; padding:0 12px;
  background:var(--ui-bg); border-bottom:1px solid var(--ui-border);
}
/* ── Select View fieldset ──
   The control's own metrics now live in the SHARED library component
   (components/ViewSelect.vue) — this file used to carry a hand-copied second
   implementation of the shell's .viewsel/.seg rules. Only the PLACEMENT stays
   here, because centring in this particular header is this layout's decision,
   not the control's. */
.viewsel{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
}
/* The header buttons, Big Picture's .rd-header-btns metrics. On a phone the centred switcher and two buttons
   do not share the row (the ⓘ would sit on "Map"), so there the switcher moves to the start and the buttons
   keep the end. */
.upgmfe .hdr-btns{ display:inline-flex; align-items:center; gap:8px; flex:0 0 auto; }
@media (max-width:480px){ .viewsel{ position:static; transform:none; margin-inline-end:auto; } }
/* ── stage: the pane-wrapper column mounts here (its .pane-col is absolute) ── */
.upgmfe .stage{ position:relative; flex:1 1 auto; min-height:0; }
/* the live custom element fills its pane */
.pane > .pane-mount > *{ position:absolute; inset:0; width:100%; height:100%; display:block; }
`, 'upg-100-mfe')
</script>

<template>
  <div class="upgmfe">
    <header class="hdr">
      <ViewSelect
        :views="spec.panes"
        :current="view"
        :legend="t('tabs.selectView')"
        :label="t('tabs.views')"
        @select="go"
      />
      <!-- HEADER BUTTONS (design rule, 2026-09-30), Big Picture's form: a rounded-square ⓘ to the LEFT of a
           rounded-square Share, the vertical tabs' radius. The ⓘ renders only once the tab's MapInfo answers it. -->
      <div class="hdr-btns">
        <MapInfoButton :is-dark="isDark" shape="rounded-square" />
        <ShareButton :is-dark="isDark" :embed-path="SHARE_EMBED_PATH" shape="rounded-square" />
      </div>
    </header>
    <div class="stage" ref="stage"></div>
  </div>
</template>
