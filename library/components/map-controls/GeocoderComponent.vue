<!--
  GeocoderComponent.vue — Mapbox Geocoder search bar as a self-contained Vue component.

  Handles:
  • Injecting the Mapbox Geocoder CSS stylesheet into the Shadow DOM root
    (so styles aren't blocked by the custom element boundary).
  • Creating the MapboxGeocoder control and either adding it to the provided
    map (default map-control mode) or mounting it into this component's own
    container (`standalone` mode — search-only, no map required).
  • Supplementing Mapbox's forward-geocoder results with DOXA people-group,
    country, language and religion matches via `useEntitySearch` (passed as
    the `localGeocoder` option — see Mapbox "custom-geocoder" example).
    Each DOXA row is rendered with a labeled category tag by the custom
    `render` callback (renderSuggestion).
  • Forwarding geocoder events (`result`, `clear`, `error`) as Vue emits so
    parent components can react (e.g. fly to result, filter pins, log analytics).
  • Emitting a dedicated `people-group-result` event when the selected result
    is a DOXA people group, and an `aggregate-result` event when it is a DOXA
    aggregate (bloc / cluster / country / region / family / language / dialect
    / religion), so the parent can open the PG popup or dim + fit the member set.
  • Removing the control cleanly on unmount to avoid memory leaks.

  Service logic extension point:
  • Listen to the `result` emit to run your own search enrichment, filter data,
    or highlight a region.
  • Replace/wrap the geocoder creation logic inside onMounted to swap in a
    different search provider (e.g. Pelias, Google Places) while keeping the
    same component API.
  • Use the default `<slot />` to render additional UI below the search input
    (e.g. recent searches, filter chips, alternate search tabs).

  Props:
    mapInstance   — live mapboxgl.Map instance. Required in the default
                    (map-control) mode; OPTIONAL in `standalone` mode.
    accessToken   — Mapbox public access token string (required)
    isDark        — mirrors app theme; adds 'geocoder-dark' class for CSS cascade
    standalone    — mount the input into this component's own container instead
                    of map.addControl(); search-only (no flyTo), results drive
                    the bus. Default false.
    placeholder   — optional explicit input placeholder; when omitted, falls
                    back to the i18n key `search.placeholder` (locale-aware)
    dataSourceId  — optional data-source id the local geocoder searches;
                    default "" = auto (first populated source in dataStore)
    activeContext — active search context ('people-groups' | 'language' |
                    'regions' | 'religion' | ''); mirrors the active legend tab
                    so the tab-relevant category is surfaced first

  Emits:
    result(event)              — a Mapbox geocoder result was selected
    people-group-result(pg)    — a DOXA people-group result was selected;
                                 payload is a GeoJSON-Feature-like wrapper
                                 { type, properties, geometry } around the
                                 normalized PG record
    aggregate-result(payload)  — a DOXA aggregate result was selected; payload
                                 carries { kind, label, count, memberIds,
                                 bounds, center, ... , properties } (see the
                                 emit site for the full field list)
    clear                      — the search input was cleared
    error(event)               — geocoder encountered an error

  Exposes:
    geocoder       — the raw MapboxGeocoder instance (for advanced usage)
-->
<script setup>
import { CDN, pinElement } from '@map/constants/cdn.js'
import { ref, shallowRef, onMounted, onBeforeUnmount, computed, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEntitySearch } from '../../composables/useSearch.js'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

// The Mapbox and MapLibre geocoders emit identical DOM under different class
// prefixes (.mapboxgl-ctrl-geocoder* vs .maplibregl-ctrl-geocoder*). dualEngine
// duplicates every rule for both so one skin covers whichever engine is active.
function dualEngine(css) {
  return css + css.replace(/mapboxgl/g, 'maplibregl')
}

// iOS Safari auto-zooms the page whenever a text input with computed
// font-size < 16px receives focus, and the "Done" keyboard button re-fires
// the same zoom on blur. We override the Mapbox geocoder input to 16px in
// the shadow root so the auto-zoom never triggers. 16px is the documented
// threshold; setting it explicitly here also stops the page from getting
// stuck zoomed-in on devices that disallow pinch-zoom recovery.
useShadowStyles(dualEngine(
  '.mapboxgl-ctrl-geocoder--input,'
  + '.mapboxgl-ctrl-geocoder input[type="text"],'
  + '.mapboxgl-ctrl-geocoder input[type="search"]'
  + '{font-size:16px !important;line-height:1.3;}'),
  'geocoder-ios-zoom-fix'
)

// Hide the Mapbox geocoder's loading spinner. It renders in the right-side icon
// slot but is NOT vertically centered with the clear (×) button, so it reads as a
// visual glitch while a query is in flight. The local search is fast enough that
// the spinner adds no value (coder: "the loading indicator needs to not show up").
useShadowStyles(dualEngine(
  '.mapboxgl-ctrl-geocoder--icon-loading{display:none !important;}'),
  'geocoder-hide-loading'
)

// All search bars = EXACTLY 35px tall, desktop AND mobile. The stock
// geocoder CSS sizes its input to 36px on desktop and ~50px below 640px; this single
// breakpoint-free injection pins BOTH the outer pill and its input to exactly 35px.
// `box-sizing:border-box` + zeroed vertical padding guarantee 35px (not 35.99px) — the
// padding can't add to the box. line-height:35px centers the single-line text; the
// search icon is re-centered for the shorter box (the clear/× button is already centered
// at top:50% by each profile's base rule). Shared here so every profile inherits it —
// this REPLACES the per-profile @media mobile-height hack (bug-searchbar-mobile-height).
useShadowStyles(dualEngine(
  '.mapboxgl-ctrl-geocoder{height:35px!important;min-height:35px!important;box-sizing:border-box!important;}'
  + '.mapboxgl-ctrl-geocoder--input{height:35px!important;min-height:35px!important;box-sizing:border-box!important;'
  + 'padding-top:0!important;padding-bottom:0!important;line-height:35px!important;}'
  + '.mapboxgl-ctrl-geocoder--icon-search{top:50%!important;transform:translateY(-50%)!important;margin-top:0!important;inset-inline-start:7px!important;}'),
  'geocoder-height-35'
)

// ── THE SKIN — one search bar for every map ───────────────────────────────────
// This component previously shipped BEHAVIOUR only: it set the `geocoder-dark`
// class but defined no rules for it, so each profile painted its own pill. That is
// how the look drifted — research-map used the DOXA sage palette while another
// profile invented a near-black fill with a mint border: same component, two
// appearances. Anything a profile CAN restyle, a profile will eventually restyle
// differently.
//
// So the skin lives HERE and every instance inherits it. Profiles keep only
// genuinely per-map choices (e.g. the pill's WIDTH, which depends on that map's
// layout); they must not re-declare colour, radius, shadow or focus ring.
//
// Palette is research-map's — the reference implementation.
useShadowStyles(dualEngine(
  // FILL — the pill always fills whatever container it is placed in, and the
  // container is what a profile sizes. This is the shared search-bar CONTRACT, not
  // a per-map preference: every map wants the pill to fill its slot. Sizing the
  // PILL directly instead (what one profile did) means it can never fill the
  // available space, which is how one map ended up visibly narrower than the rest.
    '.mapboxgl-ctrl-geocoder{width:100%!important;max-width:100%!important;min-width:0!important;}'
  // MOBILE — go nearly edge-to-edge. Also shared: a phone has no room for a dead
  // side margin, and a profile that simply forgets this rule (as one did) silently
  // renders its DESKTOP width on mobile.
  // MOBILE — the band becomes a header strip across the top of the map that HOLDS the pill:
  // the strip spans the full width, its padding insets the pill, so the pill reads as sitting
  // IN a header rather than floating edge-to-edge. Desktop keeps the bare positioned slot.
  + '@media(max-width:767px){.dg-search-band{top:0!important;left:0!important;right:0!important;'
  + 'width:100%!important;max-width:none!important;margin:0!important;box-sizing:border-box!important;'
  + 'padding:9px 14px!important;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.10);}'
  + '.dg-search-band--dark{background:#3b463d;box-shadow:0 1px 4px rgba(0,0,0,0.35);}'
  + '.dg-search-band .mapboxgl-ctrl,.dg-search-band .maplibregl-ctrl{margin:0!important;float:none!important;}}'
  // Light (default): rounded white pill + soft shadow.
  + '.mapboxgl-ctrl-geocoder{border-radius:999px!important;background:#fff;'
  + 'box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;transition:box-shadow .12s,border-color .12s;}'
  + '.mapboxgl-ctrl-geocoder:focus-within{box-shadow:0 2px 8px rgba(0,0,0,0.15),0 0 0 3px rgba(59,70,61,0.18)!important;}'
  + '.mapboxgl-ctrl-geocoder--input{border-radius:999px!important;font-size:13px!important;}'
  + '.mapboxgl-ctrl-geocoder--input::placeholder{font-size:12px!important;}'
  // Clear (×) button: hidden until there is text, then vertically centred.
  + '.mapboxgl-ctrl-geocoder--button{display:none!important;top:50%!important;bottom:auto!important;'
  + 'transform:translateY(-50%)!important;margin:0!important;padding:0!important;width:24px!important;'
  + 'height:24px!important;background:transparent!important;border:none!important;box-shadow:none!important;}'
  + '.mapboxgl-ctrl-geocoder:has(.mapboxgl-ctrl-geocoder--input:not(:placeholder-shown)) .mapboxgl-ctrl-geocoder--button{display:block!important;}'
  + '.mapboxgl-ctrl-geocoder--button .mapboxgl-ctrl-geocoder--icon-close{position:absolute!important;'
  + 'top:50%!important;left:50%!important;transform:translate(-50%,-50%)!important;margin:0!important;'
  + 'width:16px!important;height:16px!important;}'
  // Suggestions dropdown: above the legend, scrollable, never taller than the map.
  + '.mapboxgl-ctrl-geocoder--suggestions,.mapboxgl-ctrl-geocoder .suggestions{z-index:1200!important;'
  + 'position:absolute;max-height:60vh!important;overflow-y:auto!important;}'
  // Dark. Both hooks are honoured: `geocoder-dark` (set by this component from the
  // isDark prop) and `.dsm-dark` (a profile-level ancestor class), so a map gets the
  // dark pill whichever way it drives theme.
  + '.geocoder-dark.mapboxgl-ctrl-geocoder,.dsm-dark .mapboxgl-ctrl-geocoder{background:#4e594f!important;'
  + 'border:1px solid rgba(255,255,255,0.14)!important;box-shadow:0 2px 8px rgba(0,0,0,0.4)!important;}'
  + '.geocoder-dark.mapboxgl-ctrl-geocoder:focus-within,.dsm-dark .mapboxgl-ctrl-geocoder:focus-within{'
  + 'box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 0 3px rgba(115,161,127,0.22)!important;}'
  + '.geocoder-dark .mapboxgl-ctrl-geocoder--input,.dsm-dark .mapboxgl-ctrl-geocoder--input{'
  + 'color:#F3F3F1!important;background:transparent!important;}'
  + '.geocoder-dark .mapboxgl-ctrl-geocoder--input::placeholder,.dsm-dark .mapboxgl-ctrl-geocoder--input::placeholder{'
  + 'color:rgba(243,243,241,0.65)!important;}'
  + '.geocoder-dark .mapboxgl-ctrl-geocoder--icon,.dsm-dark .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--icon{'
  + 'fill:rgba(243,243,241,0.75)!important;}'
  + '.geocoder-dark .mapboxgl-ctrl-geocoder--button,.dsm-dark .mapboxgl-ctrl-geocoder--button{background:transparent!important;}')
  + '/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,\n   and no generated leaf ships one anyway (measured: 0 across the whole tree). Additive only. */\n@media (prefers-reduced-motion: reduce) {\n  .geo-root, .mapboxgl-ctrl-geocoder, .maplibregl-ctrl-geocoder { transition: none !important; animation: none !important; }\n}\n',
  'geocoder-skin'
)

const { t, locale } = useI18n()

const props = defineProps({
  // Required in the default (map-control) mode; OPTIONAL in standalone mode
  // (the dashboard header search bars are search-only → bus, no map flyTo).
  // The onMounted guard enforces "map mode needs a map"; map profiles always
  // pass a live instance, so their behavior is unchanged.
  mapInstance:  { type: Object,  required: false, default: null },
  accessToken:  { type: String,  required: true },
  /**
   * Map engine: 'mapbox' (default — MapboxGeocoder) | 'maplibre'
   * (MaplibreGeocoder + a Mapbox REST forwardGeocode, so place search still
   * works on a MapLibre map). The local people-group geocoder is shared.
   */
  provider:     { type: String,  default: 'mapbox' },
  isDark:       { type: Boolean, default: false },
  /**
   * When true, render the geocoder input into THIS component's own container
   * element (header) via the geocoder's standalone `addTo()` mount, instead of
   * `map.addControl()`. Map profiles leave this false (default) → unchanged
   * `addControl` behavior. Standalone bars don't require a `mapInstance`.
   */
  standalone:   { type: Boolean, default: false },
  /**
   * Optional explicit placeholder. If omitted, falls back to the i18n key
   * `search.placeholder` — translated per active locale.
   */
  placeholder:  { type: String,  default: '' },
  /**
   * Optional data source id the local-geocoder should search.
   * Defaults to "auto" (first populated source in dataStore.sources).
   */
  dataSourceId: { type: String,  default: '' },
  /**
   * Active search context — one of 'people-groups' | 'language' | 'regions' |
   * 'religion' (or '' for the default order). Mirrors the active legend tab so
   * the unified search surfaces the tab-relevant category first while still
   * matching every category (Round 16). Read live by useEntitySearch on each
   * keystroke, so changing tabs needs no geocoder rebuild.
   */
  activeContext: { type: String, default: '' }
})

// Effective placeholder: explicit prop > i18n default
// PLACE SEARCH IS MAPBOX'S. Under MapLibre without a real (pk.…) token no Mapbox call is made at all, and the
// box SAYS so instead of silently returning no places; people-group, language, religion and country search
// are local and keep working. With a token, places come from Mapbox geocoding, on either engine (documented
// in documentation/how-to.md). A keyless place geocoder is a separate decision.
const hasPlaceToken = computed(() => /^pk\./.test(String(props.accessToken || '')))
const effectivePlaceholder = computed(() => props.placeholder ||
  (props.provider === 'maplibre' && !hasPlaceToken.value ? t('search.placeholderNoPlaces') : t('search.placeholder')))

const emit = defineEmits(['result', 'people-group-result', 'aggregate-result', 'clear', 'error'])

// ── HTML escape for user-supplied text — the `render` option below injects
//    strings via innerHTML so every dynamic value must be escaped. --------
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c])
}
// Unwraps {value, label} objects the same way our popup does.
function strLabel(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return v.label || v.value || ''
  return String(v)
}

// ── Category tags (Round 16 — replace emoji prefixes with clear labels) ───────
// place_type → i18n key under `search.kinds`. The tag is a small labeled pill
// (with a matching title for a11y/tooltip) so each result's category is
// unambiguous — e.g. "Deaf" can appear as an Affinity Block, a Cluster AND a
// People Group; the tag disambiguates what a bare name + emoji used to.
const KIND_TAG_KEY = {
  'people-group':         'people',
  'doxa-people-group':    'peopleGroup',
  'doxa-affinity-bloc':   'bloc',
  'doxa-cluster':         'cluster',
  'doxa-country':         'country',
  'doxa-region':          'region',
  'doxa-language-family': 'family',
  'doxa-language':        'languageKind',
  'doxa-dialect':         'dialect',
  'doxa-religion':        'religionKind',
}
function kindTag(placeType) {
  const key = KIND_TAG_KEY[placeType]
  if (!key) return ''
  const label = t('search.kinds.' + key)
  return `<span class="dg-tag" title="${esc(label)}">${esc(label)}</span>`
}

/**
 * Custom row renderer for suggestions. Receives a Carmen-GeoJSON feature
 * and returns an HTML string that Mapbox injects into the suggestion `<a>`.
 *
 * Layout (Round 16 — no emoji; a labeled category tag leads every row):
 *
 *   People-group pin — shows the 2-4 valid indicators (only the ones present):
 *     [People] <bold Name>
 *        Place: <country>   Language: <lang>   Religion: <religion>
 *
 *   DOXA aggregate (bloc / cluster / PG / country / region / family / language
 *   / dialect / religion):
 *     [Affinity Block] <label>  <count>
 */
function renderSuggestion(item) {
  if (!item) return ''
  const types = item.place_type || []

  // Section dividers — rendered as non-interactive labels.
  // CSS (.dg-section-header-item) makes the parent <li> non-clickable.
  if (types.includes('doxa-section-header')) {
    const label = esc(item.properties?.headerLabel || item.text || '')
    return `<div class="dg-section-header-item">${label}</div>`
  }

  if (types.includes('people-group')) {
    const props = item.properties || {}
    const name     = strLabel(props.name) || strLabel(props.displayName) || strLabel(item.text) || ''
    const country  = strLabel(props.countryName) || strLabel(props.country) || strLabel(props.countryIso) || ''
    const language = strLabel(props.language) || strLabel(props.primaryLanguage) || strLabel(props.languageFamily) || ''
    const religion = strLabel(props.religionName) || strLabel(props.religion) || ''

    // The 2-4 indicator combo: People (always — it's the pin) + only the valid
    // ones of Place / Language / Religion. Bold labels mirror the placeholder
    // text word-for-word (Place / Language / Religion).
    const placeLabel    = t('search.labels.place')
    const languageLabel = t('search.labels.language')
    const religionLabel = t('search.labels.religion')

    const meta = []
    if (country)  meta.push(`<span class="dg-field"><strong>${esc(placeLabel)}</strong> ${esc(country)}</span>`)
    if (language) meta.push(`<span class="dg-field"><strong>${esc(languageLabel)}</strong> ${esc(language)}</span>`)
    if (religion) meta.push(`<span class="dg-field"><strong>${esc(religionLabel)}</strong> ${esc(religion)}</span>`)

    return (
      `<div class="dg-main">${kindTag('people-group')}<strong>${esc(name)}</strong></div>` +
      (meta.length ? `<div class="dg-meta">${meta.join('')}</div>` : '')
    )
  }

  // DOXA aggregate — labeled category tag + clean label + member count. Built
  // from properties (not place_name) so the tag carries the tier and we drop
  // the old "(Cluster)/(PG)" suffix the emoji layout needed for disambiguation.
  const aggType = types.find((tp) => tp.startsWith('doxa-'))
  if (aggType) {
    const props = item.properties || {}
    const label = esc(strLabel(props.label) || item.text || '')
    const count = Number(props.count) || 0
    const countHtml = count ? ` <span class="dg-count">${count}</span>` : ''
    return `<div class="dg-main">${kindTag(aggType)}<span class="dg-agg-label">${label}</span>${countHtml}</div>`
  }

  // Native Mapbox remote result — keep its default rendering style.
  return `<div class="dg-main">${esc(item.place_name || item.text || '')}</div>`
}

// ── DOXA local geocoder ───────────────────────────────────────────────────────
// Inject the dataStore provided by the ProfileLoader / app-profile and build
// a search function that Mapbox's `localGeocoder` option will invoke for
// every keystroke. We read the store non-reactively (inject returns the
// store instance directly) — the composable re-computes its index when the
// underlying features change.
const dataStore = inject('dataStore', null)
const mapStore  = inject('mapStore',  null)
// uiStore holds the prayer / engagement / adoption / religion legend filters,
// which live outside mapStore. Needed so a search result can clear them too
// (otherwise filter ∩ result = zero pins → blank map).
const uiStore   = inject('uiStore',   null)

// getActiveFilter is a closure over the live mapStore so each search call
// reads the current selection without re-creating the geocoder instance.
function getActiveFilter() {
  if (!mapStore) return null
  if (mapStore.selectedFamily)   return { kind: 'family',   key: mapStore.selectedFamily }
  if (mapStore.selectedLanguage) return { kind: 'language', key: mapStore.selectedLanguage }
  return null
}

const { search: doxaLocalGeocoder } = useEntitySearch({
  dataStore,
  dataSourceId: props.dataSourceId || undefined,
  getActiveFilter,
  // Read live so a tab switch re-orders results without rebuilding the geocoder.
  getActiveContext: () => props.activeContext || null
})

// Exposed so a parent can call geocoder.value.query('...') or add custom filters
// shallowRef: the geocoder instance is a Mapbox control (it holds the map and is handed
// to map.addControl) — a deep ref() would wrap it in Vue's reactive Proxy and every call
// Mapbox or we make through it would pay the Proxy traps. Only the .value swap is reactive.
const geocoder = shallowRef(null)

// Standalone-mode mount target (the header). Only rendered when `standalone` is true.
const standaloneContainer = ref(null)

// ── CSS injection ─────────────────────────────────────────────────────────────
// The geocoder stylesheet must live inside the shadow root; injecting it into
// the document head has no effect because the widget renders inside a
// ShadowRoot. We target the closest ShadowRoot of the map container.
const GEOCODER_CSS = {
  mapbox:   CDN.mapboxGeocoderCss.url,
  maplibre: CDN.maplibreGeocoderCss.url,
}
// MaplibreGeocoder ships as a CDN global (UMD). Mapbox's is preloaded via
// index.html; MapLibre's is injected on demand so a profile can flip provider
// with no host change.
const MAPLIBRE_GEOCODER_JS = CDN.maplibreGeocoderJs.url   // exact version + SRI: library/constants/cdn.js
// Same version the generated leaf pages preload, so an on-demand load and a preload cannot end up
// on two different geocoders.
const MAPBOX_GEOCODER_JS = CDN.mapboxGeocoderJs.url

function injectGeocoderCSS(shadowRoot, prov) {
  const HREF = GEOCODER_CSS[prov] || GEOCODER_CSS.mapbox
  if (shadowRoot.querySelector(`link[href="${HREF}"]`)) return  // already injected
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = HREF
  pinElement(link, HREF)
  shadowRoot.prepend(link)
}

/** Load the MaplibreGeocoder UMD global on demand (idempotent). */
/**
 * Load a geocoder UMD bundle that the HOST PAGE did not preload.
 *
 * ★ WHY MAPBOX NEEDS THIS TOO (2026-09-23 — the search bar missing from a nested map).
 * MapboxGeocoder was documented as "preloaded via index.html", and for a LEAF page that is true.
 * It is NOT true for a COMPOSITE leaf: generate-tree classifies that page as token-free and emits
 * no geocoder script, while the composite goes on to nest a REAL map inside itself. MEASURED on the
 * built tree — mapbox-gl-geocoder references per page: research-map leaf 2, research-map-plus-grid
 * leaf 0. onMounted then hit `typeof MapboxGeocoder === 'undefined'` and RETURNED SILENTLY: no
 * throw, no console error, no DOM. The search bar was simply absent, which reads exactly like a
 * styling or token problem and is neither. (The repo tracks the classifier half of this as
 * BUG-COMPOSITE-LEAVES-ARE-TOKEN-FREE-BUT-NEST-REAL-MAPS; this is the runtime half, and it fixes
 * every already-generated page without regenerating any of them.)
 *
 * Deliberately the SAME shape the maplibre path already used — one loader, two callers — rather
 * than a second bespoke mechanism next to a working one.
 */
async function ensureGeocoderScript(src, globalName) {
  if (typeof window !== 'undefined' && window[globalName]) return
  if (typeof document === 'undefined') return
  const existing = document.querySelector(`script[src="${src}"]`)
  if (existing) {
    if (window[globalName]) return
    await new Promise(resolve => {
      existing.addEventListener('load',  resolve, { once: true })
      existing.addEventListener('error', resolve, { once: true })
    })
    return
  }
  await new Promise((resolve) => {
    const el = document.createElement('script')
    el.src = src
    pinElement(el, src)
    el.async = true
    // Resolve on error too: a blocked CDN must leave the map usable and the bar absent, which is
    // what happened before this existed — never a hang or an unhandled rejection.
    el.addEventListener('load',  resolve, { once: true })
    el.addEventListener('error', resolve, { once: true })
    document.head.appendChild(el)
  })
}

/**
 * The deepest focused element, following shadow roots all the way down.
 * document.activeElement stops at the outermost host; each nested custom element
 * needs another hop before you reach the real <input>.
 */
function deepActiveElement(root = document) {
  let el = root.activeElement
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement
  return el
}

/**
 * Give the vendor geocoder's keydown handler the element the user is actually
 * typing into, however deeply the map is composed. See the call site for the
 * measured before/after. Only the event's `target` is substituted; everything
 * else (keyCode, metaKey, preventDefault) passes straight through, and if the
 * deep lookup finds nothing typable the original event is used untouched, so
 * the vendor's own empty-input handling still runs.
 */
function patchNestedShadowKeydown(instance) {
  const original = instance?._onKeyDown
  if (typeof original !== 'function') return
  instance._onKeyDown = function (ev) {
    const deep = deepActiveElement()
    // `original` is called with an explicit receiver: the vendor binds this
    // method in its constructor, but the MapLibre build does not, and an
    // unbound call lands on `this === undefined` inside the handler (measured:
    // "Cannot read properties of undefined (reading '_hideGeolocateButton')",
    // which swallowed the keystroke AND the query).
    if (!deep || deep === ev.target || typeof deep.value !== 'string') return original.call(instance, ev)
    return original.call(instance, new Proxy(ev, {
      get(target, key) {
        if (key === 'target' || key === 'srcElement') return deep
        const v = Reflect.get(target, key)
        return typeof v === 'function' ? v.bind(target) : v
      },
    }))
  }
}

async function ensureMapboxGeocoder() {
  await ensureGeocoderScript(MAPBOX_GEOCODER_JS, 'MapboxGeocoder')
}

async function ensureMaplibreGeocoder() {
  if (typeof window !== 'undefined' && window.MaplibreGeocoder) return
  if (typeof document === 'undefined') return
  const existing = document.querySelector(`script[src="${MAPLIBRE_GEOCODER_JS}"]`)
  if (existing) {
    if (window.MaplibreGeocoder) return
    await new Promise(resolve => {
      existing.addEventListener('load',  resolve, { once: true })
      existing.addEventListener('error', resolve, { once: true })
    })
    return
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = MAPLIBRE_GEOCODER_JS
    s.async = false
    s.addEventListener('load',  resolve, { once: true })
    s.addEventListener('error', () => reject(new Error('[GeocoderComponent] Failed to load MapLibre geocoder')), { once: true })
    document.head.appendChild(s)
  })
}

/**
 * Builds a MaplibreGeocoder `geocoderApi.forwardGeocode` backed by the Mapbox
 * Geocoding REST API — so place search still works on a MapLibre map (hybrid:
 * MapLibre basemap + Mapbox geocoding). Returns Carmen GeoJSON, which the
 * geocoder consumes directly. Empty result (no token / network error) leaves the
 * local people-group search fully functional.
 */
function makeMapboxForwardGeocode(token, getLang) {
  return async (config) => {
    const empty = { features: [] }
    // No REAL token (none, or the snippet's YOUR_MAPBOX_TOKEN placeholder): no request to Mapbox at all.
    if (!/^pk\./.test(String(token || '')) || !config?.query) return empty
    try {
      const lang = Array.isArray(config.language) ? config.language[0] : (config.language || getLang() || 'en')
      const params = new URLSearchParams({
        access_token: token,
        autocomplete: 'true',
        limit:        String(config.limit || 5),
      })
      if (lang) params.set('language', lang)
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(config.query)}.json?${params.toString()}`
      const res = await fetch(url)
      if (!res.ok) return empty
      const geojson = await res.json()
      return (geojson && Array.isArray(geojson.features)) ? geojson : empty
    } catch (e) {
      return empty
    }
  }
}

// ── Geocoder lifecycle ────────────────────────────────────────────────────────
onMounted(async () => {
  const isMaplibre = props.provider === 'maplibre'

  // Ensure the right geocoder global is present. Mapbox's is preloaded via
  // index.html; MapLibre's is injected on demand.
  if (isMaplibre) {
    await ensureMaplibreGeocoder()
    if (typeof MaplibreGeocoder === 'undefined') {
      console.error('[GeocoderComponent] MaplibreGeocoder global unavailable.')
      return
    }
  } else if (typeof MapboxGeocoder === 'undefined') {
    // The host page did not preload it (a composite leaf does not) — fetch it rather than vanish.
    await ensureMapboxGeocoder()
    if (typeof MapboxGeocoder === 'undefined') {
      console.error('[GeocoderComponent] MapboxGeocoder global unavailable.')
      return
    }
  }

  const map = props.mapInstance
  // Map mode requires a live map; standalone (header search bars) does not.
  if (!props.standalone && !map) {
    return
  }

  // Inject CSS into the shadow root. In standalone mode the root is resolved from
  // our own container element; in map mode from the map container (unchanged).
  const shadowRoot = props.standalone
    ? standaloneContainer.value?.getRootNode?.()
    : map.getContainer?.()?.getRootNode?.()
  if (shadowRoot instanceof ShadowRoot) {
    injectGeocoderCSS(shadowRoot, props.provider)
  }

  // Create geocoder instance.
  //
  // `localGeocoder` is the Mapbox plugin's extension point for supplementing
  // the hosted forward-geocoder results with client-side matches. The callback
  // must return an array of Carmen-GeoJSON features — see
  //   https://github.com/mapbox/carmen/blob/master/carmen-geojson.md
  // Our `doxaLocalGeocoder` returns people-group + country + language +
  // religion matches from the DOXA dataset. Mapbox renders them in the
  // same suggestions dropdown, visually distinguished by the labeled
  // category tag the `render` callback (renderSuggestion) prepends.
  //
  // `localGeocoderOnly` is intentionally LEFT OUT — we want BOTH sources
  // (place results AND DOXA records) visible in the suggestions list.
  //
  // Shared options — the two geocoders share almost the entire option surface;
  // only the constructor shape + the geocoding backend differ (see below).
  const sharedOpts = {
    marker:         false,
    // Standalone (header) bars are search-only: results drive the selection bus,
    // not a map flyTo — so disable flyTo (no map). Map-control mode keeps the
    // default flyTo (byte-identical: !standalone === true).
    flyTo:          !props.standalone,
    // v5 defaults trackProximity:true, which makes onAdd() read map.getZoom()/
    // getBounds() at mount — a map-less standalone bar has no such map, so disable
    // it (else onAdd throws on the stub map and the input never attaches). Map
    // mode keeps the default (byte-identical: !standalone === true).
    trackProximity: !props.standalone,
    placeholder:    effectivePlaceholder.value,
    // Localize remote place results AND the geocoder's own UI strings. Mapbox
    // accepts ISO-639-1 codes; the active i18n locale is set once at mount from
    // profile-config.lang (default 'en'). See loc-002.
    language:       locale.value || 'en',
    localGeocoder:  doxaLocalGeocoder,
    // Raise suggestion limit well above the default (5) so a query like "India"
    // can surface many people-groups. CSS caps the dropdown height + overflow.
    limit:          20,
    zoom:           6,
    // Custom row renderer — injects structured, bold-labeled metadata for DOXA
    // results. See renderSuggestion() above.
    render:         renderSuggestion,
  }

  if (isMaplibre) {
    // MapLibre map + Mapbox geocoding (hybrid). forwardGeocode hits the Mapbox
    // REST API with the same public token; the local people-group search is
    // unchanged. Requires the geocoderApi as the FIRST constructor arg.
    // eslint-disable-next-line no-undef
    const gl = typeof maplibregl !== 'undefined' ? maplibregl : undefined
    const geocoderApi = { forwardGeocode: makeMapboxForwardGeocode(props.accessToken, () => locale.value) }
    // eslint-disable-next-line no-undef
    geocoder.value = new MaplibreGeocoder(geocoderApi, {
      ...sharedOpts,
      maplibregl: gl,
      showResultsWhileTyping: true,
      reverseGeocode: false,
    })
  } else {
    // eslint-disable-next-line no-undef
    geocoder.value = new MapboxGeocoder({
      accessToken: props.accessToken,
      mapboxgl:    mapboxgl,   // CDN global — same reference used by the map instance
      ...sharedOpts,
    })
  }

  // ── Nested-shadow-DOM keystroke fix (BUG-RESEARCH-MAP-SEARCH-DELETES-INPUT) ──
  // mapbox-gl-geocoder unwraps exactly ONE shadow level to find the element you
  // are typing into:
  //     var e = t.target && t.target.shadowRoot ? t.target.shadowRoot.activeElement : t.target
  // and if that element has no `.value` it decides the box is empty and calls
  // clear(), which wipes the input.
  //
  // Its handler is debounced, so it reads `event.target` AFTER dispatch has
  // finished — and by then the target has been retargeted to the OUTERMOST host.
  // One level of unwrapping is therefore exactly right for a map mounted one
  // custom element deep, and exactly wrong for a map mounted inside another
  // one. MEASURED, same build, same keystroke:
  //   doxa-research-map (1 deep)  target=DOXA-RESEARCH-MAP  -> shadowRoot.activeElement = the input     -> _geocode("Bhu")
  //   research-map-plus-grid (2)  target=RESEARCH-MAP-PLUS-GRID -> shadowRoot.activeElement = <doxa-research-map> -> clear()
  // That is the whole defect: every keystroke in a composed map was deleted.
  //
  // Walk the activeElement chain to the BOTTOM instead of one step, and hand the
  // vendor an event whose target is that element. Composing deeper cannot break
  // it again, and at one level deep it resolves to the same input as before, so
  // the standalone map's behaviour is unchanged.
  patchNestedShadowKeydown(geocoder.value)

  // Forward geocoder events as Vue emits. When a DOXA people-group result
  // is chosen we additionally emit `people-group-result` carrying the
  // original normalized record so the parent can open the popup /
  // selectedPin highlight while Mapbox handles the flyTo.
  geocoder.value.on('result', (e) => {
    const f = e?.result
    if (!f) return

    // Section headers are non-selectable visual dividers — swallow the event.
    if (f.place_type?.includes('doxa-section-header')) return

    // A chosen search result must not stay hidden behind a still-active legend
    // filter — the filter and result intersect to zero pins (the blank-map bug,
    // Clear every legend selection that has NO "within selection"
    // UX: region, resource, affinity-bloc, dialect (mapStore) + prayer /
    // engagement / adoption / religion (uiStore). Map selections are mutually
    // exclusive, so assign state directly — the select*(null) actions cross-clear
    // family/language, which would defeat the two-section UX handled below.
    if (mapStore) {
      mapStore.selectedRegion        = null
      mapStore.selectedResource      = null
      mapStore.selectedAffinityBlock = null
      mapStore.selectedDialect       = null
    }
    if (uiStore) {
      uiStore.setPrayerFilter?.(null)
      uiStore.setEngagementFilter?.(null)
      uiStore.setAdoptionFilter?.(null)
      uiStore.setReligionFilter?.(null)
    }

    // Family / language DO have a two-section UX: a "Within [selection]" result
    // keeps the filter, an "All DOXA Data" result (tagged _allDataSection) clears
    // it (QA R1 A2 Option B). Only clear them in the latter case.
    if (f.properties?._allDataSection && mapStore) {
      mapStore.selectedFamily   = null
      mapStore.selectedLanguage = null
    }

    emit('result', e)
    if (f.place_type?.includes('people-group') && f.feature) {
      // Wrap in a GeoJSON-Feature-like shape (properties + geometry) to match
      // what pin-click handlers pass to uiStore.selectPeopleGroup.
      emit('people-group-result', {
        type: 'Feature',
        properties: f.properties || f.feature,
        geometry: f.geometry || { type: 'Point', coordinates: f.center }
      })
    } else if (
      f.place_type?.includes('doxa-country')         ||
      f.place_type?.includes('doxa-region')          ||
      f.place_type?.includes('doxa-language-family') ||
      f.place_type?.includes('doxa-language')        ||
      f.place_type?.includes('doxa-dialect')         ||
      f.place_type?.includes('doxa-religion')        ||
      f.place_type?.includes('doxa-affinity-bloc')   ||
      f.place_type?.includes('doxa-cluster')         ||
      f.place_type?.includes('doxa-people-group')
    ) {
      // DOXA aggregate (country / language-family / language / dialect / religion).
      // Parent handler dims non-matching pins and fitBounds on the member set,
      // and for family/language/dialect kinds also drives the legend tab + selection.
      emit('aggregate-result', {
        kind:            f.place_type[0].replace(/^doxa-/, ''),
        label:           f.properties?.label || f.text,
        count:           f.properties?.count || 0,
        memberIds:       f.properties?.memberIds || [],
        bounds:          f.properties?.bounds || null,
        center:          f.center,
        originalLabels:  f.properties?.originalLabels || null,
        familyDerived:   f.properties?.familyDerived || '',
        baseLang:        f.properties?.baseLang || '',
        dialectLabel:    f.properties?.dialectLabel || '',
        slug:            f.properties?.slug || null,
        id:              f.id || null,
        // Affinity-tier codes — needed by research-map's onGeocoderAggregateResult
        // to build the synthetic tree node for legend dim + selection.
        blocCode:        f.properties?.blocCode || '',
        blocLabel:       f.properties?.blocLabel || '',
        clusterCode:     f.properties?.clusterCode || '',
        clusterLabel:    f.properties?.clusterLabel || '',
        peopleGroupCode: f.properties?.peopleGroupCode || '',
        properties:      f.properties || null   // full bag for forward-compat
      })
    }
  })
  geocoder.value.on('clear',  ()   => emit('clear'))
  geocoder.value.on('error',  (e)  => emit('error', e))

  if (props.standalone) {
    // Standalone (header) mount — shadow-DOM safe. We CANNOT use addTo(): its
    // in-document guard (document.body.contains) does NOT pierce the custom
    // element's shadow root, so it throws "Element provided to #addTo() exists,
    // but is not in the DOM". onAdd() has no such guard — it builds and returns
    // the widget DOM, which we append into our shadow container ourselves.
    // onAdd(map) wires map listeners only behind `if (this._map)` guards; with a
    // no-op stub map (or a real one if provided) + flyTo:false this is a pure
    // search box whose results drive the bus.
    if (standaloneContainer.value) {
      // Minimal no-op map: covers every method onAdd()/the geocoder's internals
      // may touch when there is no real map (with flyTo + trackProximity off, none
      // of these do anything meaningful — they just must not be undefined).
      const stubMap = {
        on() {}, off() {}, fire() {},
        getContainer: () => standaloneContainer.value,
        getZoom: () => 0, getCenter: () => ({ lng: 0, lat: 0 }),
        getBounds: () => null, flyTo() {}, fitBounds() {},
        addControl() {}, removeControl() {}, hasControl: () => false,
      }
      try {
        const el = geocoder.value.onAdd(props.mapInstance || stubMap)
        if (el) standaloneContainer.value.appendChild(el)
      } catch (e) {
        // Degrade to no bar rather than crash the host dashboard.
        emit('error', e)
      }
    }
  } else {
    map.addControl(geocoder.value, 'top-left')
    tagSearchBand()
  }
})

// THE SEARCH BAND — the control container the engine creates for the 'top-left' slot is the
// search bar's own row. Tagging it with a class of ours (instead of styling the engine's
// .mapboxgl-ctrl-top-left directly) gives the band one owner and one name, so a profile never
// has to know how the engine names its corners. On phones the band becomes a header strip that
// holds the pill (see the 'geocoder-band' styles); on desktop it stays a bare positioned slot.
function tagSearchBand() {
  const el = geocoder.value?.container?.parentElement
  if (!el) return
  el.classList.add('dg-search-band')
  el.classList.toggle('dg-search-band--dark', !!props.isDark)
}
watch(() => props.isDark, () => tagSearchBand())

// Mapbox Geocoder sets `placeholder` once at construction; it has no public
// updater method. Watch the effective placeholder and patch the DOM input
// directly so the per-map prop can change as the user switches profile tabs.
watch(effectivePlaceholder, (next) => {
  const inst = geocoder.value
  if (!inst) return
  const inputEl = inst._inputEl || inst.container?.querySelector?.('input.mapboxgl-ctrl-geocoder--input')
  if (inputEl) {
    inputEl.placeholder = next
    inputEl.setAttribute('placeholder', next)
  }
  // Also stash on the instance so any internal reads pick it up.
  if (inst.options) inst.options.placeholder = next
})

// Locale can change at runtime via the LanguageSelector control (loc-005).
// MapboxGeocoder reads `language` only at construction and has no public
// updater, so patch the stashed option directly — the next forward query then
// localizes remote results to the new locale without a costly geocoder rebuild.
watch(locale, (next) => {
  const inst = geocoder.value
  if (inst?.options) inst.options.language = next || 'en'
})

onBeforeUnmount(() => {
  if (!geocoder.value) return
  try {
    if (props.standalone) {
      // Standalone teardown: the geocoder's own onRemove() detaches its DOM + listeners.
      geocoder.value.onRemove?.()
    } else if (props.mapInstance) {
      props.mapInstance.removeControl(geocoder.value)
    }
  } catch (e) {
    // Map may already be destroyed; ignore
  }
  geocoder.value = null
})

defineExpose({ geocoder })
</script>

<!--
  Default (map-control) mode renders no DOM of its own — the geocoder widget is
  injected directly into the map container by addControl(); only the <slot /> is
  rendered (a future extension point for sibling search UI). Standalone mode
  renders a single container <div> and the geocoder input is appended into it via
  addTo(), so the bar can live in a header (e.g. the dashboard search bars).
-->
<template>
  <div v-if="standalone" ref="standaloneContainer" class="dg-standalone-geocoder"></div>
  <slot v-else />
</template>
