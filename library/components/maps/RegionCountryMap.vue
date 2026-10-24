<script setup>
/**
 * RegionCountryMap.vue — DX-life's CountryMap, rebuilt on the dx-maps map library.
 *
 * @description The map RegionDetail.vue:72-86 and CountryDetail.vue:47-61 both render: the focus
 *   countries filled and outlined, every people group plotted, the ones INSIDE the focus coloured
 *   and the surrounding ones muted so a viewer sees the area's groups in their neighbourhood.
 *
 * WHAT IS CLONED AND WHAT IS OURS. The LAYERS are DX-life's, expression for expression, from
 * root-dx-life/doxa-life/app/components/public/CountryMap.vue:186-240 -- the country-boundaries
 * fill at 0.12 opacity, the 2px outline, the worldview filter, the prayer/inCountry colour cases,
 * the circle-sort-key that draws better-covered pins on top, the zoom-interpolated radius, the
 * 0.75 opacity on neighbours. Their colours too (CountryMap.vue:64-71).
 *
 * The MACHINERY is ours. Theirs does `(await import('mapbox-gl')).default` and `new mapboxgl.Map`
 * directly; that is a Nuxt page component with a document of its own. We are a custom element in a
 * shadow root, where three things break and useMapInstance already solves all three: Mapbox's
 * `container: 'id'` cannot cross a shadow boundary, its CSS <link> loads async and a map that
 * initialises first gets a 0-height canvas, and the wordmark duplicates once per instance on a
 * page composing several maps. So this takes the engine, the CSS timing, the resize and the token
 * from @map/composables/useMapInstance.js and supplies only the layers.
 *
 * POINTS COME FROM THE PARENT, not a second fetch. Theirs re-fetches the whole people-groups list
 * inside the map component (CountryMap.vue:91-93). region-dashboards.vue has already fetched every
 * record to build its rollup, so passing them down keeps ONE request per element and guarantees
 * the map and the figures above it describe the same data.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
// ★ THE ENGINE RESOLVER NOW LIVES IN library/, ONCE, AND NOTHING IS LEFT HERE. This started as a
// local glFor.js copied from pplr-data-maps, then became one expression delegating to
// useMapProvider's isMapboxMap; useMapProvider now exports engineFor(map), which is stricter than
// that expression — it instance-tests BOTH engines instead of inferring the second from the first — so
// the expression is gone too. Three implementations were compared before swapping (the deleted
// copy, the interim expression, and this) and they decide identically in every engine combination —
// checked against mapbox-only, maplibre-only and both-globals-present before the swap.
import { engineFor, projectionOf, setProjectionOn } from '@map/composables/useMapProvider.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
// The region palette comes from the shared strategy, never from a table in here:
// check:one-palette exists because a private palette in a consumer is what once made two
// surfaces disagree about what a colour meant.
import { applyColor as regionColorExpression, PALETTE as REGION_PALETTE, getColor as regionColorFor } from '@map/colors/wagf-region.js'
// ★ THIS FILE HAD NO t() AT ALL. Its legend rendered four hardcoded English strings on a page
// whose every other word is translated into eleven languages, and three of those four were
// ALREADY in the catalogue — translated for the Prayer Coverage card and hardcoded here.
// Their CountryMap.vue calls t() for the same strings (:268-272).
import { useRegionsI18n } from '@map/i18n/useRegionsI18n.js'
import { joinBase } from '@map/composables/joinBase.js'


const { t, locale } = useRegionsI18n()
const emit = defineEmits(['pick-country'])
const props = defineProps({
  // ISO-3 codes to highlight, e.g. ['IND'] for a country or every code in a region.
  countryCodes: { type: Array, default: () => [] },
  // Every people group we know about: { name, slug, code, lng, lat, committed, country, population }.
  points: { type: Array, default: () => [] },
  // HOW to colour the pins. Three modes, and only one of them is ours:
  //   'prayer'     — DX-life's color-by-prayer, what RegionDetail passes
  //   'in-country' — DX-life's default, what CountryDetail passes (in-country vs surrounding)
  //   'region'     — OURS, and only for the no-selection chooser: paints every pin by its WAGF
  //                  region so the seven read AS regions on load. Never used on a cloned page.
  colorMode: { type: String, default: 'in-country' },
  // Chooser only: lift one region's pins and recede the rest, on legend hover.
  highlightRegion: { type: String, default: '' },
  // Chooser only: a pin click selects, instead of opening their popup.
  selectOnPinClick: { type: Boolean, default: false },
  center: { type: Array, default: () => [20, 10] },
  zoom: { type: Number, default: 2 },
  // [[west, south], [east, north]] — takes precedence over center/zoom, as theirs does.
  bounds: { type: Array, default: null },
  // Their popup's two buttons (CountryMap.vue:156-158): Pray -> prayBaseUrl/<slug>?source=doxalife,
  // Full Profile -> researchUrl<slug>.
  prayBaseUrl: { type: String, default: 'https://pray.doxa.life' },
  researchUrl: { type: String, default: 'https://doxa.life/research/' },
})

// The token ladder: ProfileLoader provides it (the same seam every map bundle uses). A nested
// element has no leaf page of its own, which is what check:nested-token exists to police.
const profileConfig = inject('profileConfig', ref(null))
// Which engine is live. Derived ONCE: addLayers() branches on it in three places, and three
// separate resolveMapProvider() calls is three chances for them to disagree.
const isMaplibreProvider = resolveMapProvider(profileConfig) === 'maplibre'
const mapboxToken = inject('mapboxToken', ref(''))
const tokenValue = computed(() => (typeof mapboxToken === 'string' ? mapboxToken : mapboxToken?.value) || '')

// CountryMap.vue:64-71, resolved. brand = --color-brand (#3b463d) fill + outline; inCountry =
// green-100, brighter than the outline so pins read against the fill; muted = --color-brand-lighter;
// the three prayer colours are the Prayer Coverage card's own; outside = --color-brand-secondary-dark,
// warm grey, so neighbours do not compete with the dark "no one praying" pins.
const C = {
  brand: '#3b463d',
  muted: '#6d766e',
  inCountry: '#73A17F',
  prayerFull: '#92b195',
  prayerPartial: '#f0c64a',
  prayerNone: '#4e594f',
  outside: '#a59d92',
}
const FULL_PRAYER_COVERAGE_COUNT = 100

const mapContainer = ref(null)
const mapFailed = ref(false)

const geojson = computed(() => {
  const focus = new Set(props.countryCodes)
  return {
    type: 'FeatureCollection',
    features: props.points
      .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        // JSON primitives only — Mapbox feature properties cannot hold nested objects.
        properties: {
          name: p.name || '', slug: p.slug || '', country: p.country || '',
          inCountry: focus.has(p.code), committed: Number(p.committed) || 0,
          region: p.region || '', code: p.code || '',
          population: Number(p.population) || 0,
          // Their popup's four (CountryMap.vue:107-115). Primitives only, as their own comment says.
          rop1: p.rop1 || '', religion: p.religion || '',
          description: p.description || '', imageUrl: p.imageUrl || '',
        },
      })),
  }
})

// Their fitBoundsOptions, one constant so the constructor path and fitTheirWay cannot drift apart.
const FIT_OPTS = { padding: 40, maxZoom: 6 }   // CountryMap.vue:179, verbatim

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  // A STRING, not the ref -- useMapInstance calls accessToken.startsWith('pk.') directly, so a
  // ref reaches it as an object and the map dies with "t.startsWith is not a function". Every
  // other bundle passes `.value` here (doxa-simple-map.vue:485); measured the hard way.
  // An empty value is fine: the composable then falls through to window.MAP_TOKEN, which is the
  // rung the generated leaf page sets -- that IS the token ladder.
  accessToken: tokenValue.value,
  style: 'mapbox://styles/mapbox/light-v11',   // theirs, CountryMap.vue:174
  // ★ A NULL CENTER MUST NOT REACH THE CONSTRUCTOR. Vue applies a prop default only for undefined,
  // so a host passing an explicit null replaces the [20, 10] default with null, and the engine's
  // LngLat.convert(null) THROWS before a style or a tile is requested - the map never starts, and
  // the failure reads as "a map-token or connection problem", which blames the wrong thing.
  // `bounds` below already had this guard; center did not. MEASURED on the drop-in element, 12 of
  // 12 cases dead with 0 requests to the tile host.
  center: props.center || undefined,
  zoom: props.zoom,
  maxZoom: 12,
  // THEIR CONSTRUCTOR FORM (CountryMap.vue:179), for the case where the box is already known at
  // mount. Mapbox honours `bounds` only in the constructor, and the dashboard usually mounts its
  // one map BEFORE the fetch resolves, so this covers the deep-link case and fitTheirWay() below
  // covers the normal one. Both land the same camera on purpose.
  bounds: props.bounds || undefined,
  fitBoundsOptions: FIT_OPTS,
  // THE SHARED EDGE-SCROLL STRIPS, on by decision. This was deliberately false, and the reason is
  // kept here rather than deleted because it is the thing to re-examine if the result looks wrong:
  // the map sits inside a SCROLLING dashboard, so the gray "you can scroll past me" gutters read
  // as part of the page rather than as map chrome — unlike the reference maps
  // (my-upg-100-list, doxa-research-map), where the map owns its viewport.
  // Every other regions map already takes the library default (true); this was the one opt-out.
  // useMapInstance.js:290 defaults it true and wires useEdgeScrollAffordance at :551, so this is
  // the shared composable, not a hand-rolled strip.
  showEdgeBorders: true,
})

// THE REGION COLOURS, CARRIED ONTO THE LANDMASSES — a sanctioned addition.
// The pins already paint by region via the shared expression (regionColorExpression, below at the
// pin layer). The polygons cannot use that expression directly: it matches on ['get','region'],
// which is a property of OUR geojson, while the boundary tileset's features carry
// `iso_3166_1_alpha_3` and know nothing about WAGF regions. So this builds the bridge — country
// code -> that country's region -> THE SAME PALETTE. No second palette, which is exactly what
// check:one-palette exists to prevent.
// The library's fallback, taken from the library itself: getColor({}) resolves an unknown region
// to DEFAULT_COLOR. That constant is not exported, and adding an export to a file every bundle
// imports is not worth one colour (RULE 2).
const REGION_DEFAULT = regionColorFor({})
const regionFillExpression = computed(() => {
  const byCode = new Map()
  for (const p of props.points) {
    if (!p || !p.code || !p.region) continue
    if (!byCode.has(p.code)) byCode.set(p.code, p.region)
  }
  if (!byCode.size) return REGION_DEFAULT
  const match = ['match', ['get', 'iso_3166_1_alpha_3']]
  for (const [code, region] of byCode) match.push(code, REGION_PALETTE[region] || REGION_DEFAULT)
  match.push(REGION_DEFAULT)
  return match
})
// Their fill is 0.12 — near-invisible, which is right for a single highlighted country on a
// CLONED page. The chooser is ours and its whole job is to read AS seven regions at a glance, so
// it carries more. The cloned pages keep 0.12 exactly.
const FILL_OPACITY_REGION = 0.42

const SRC_PINS = 'rcm-people-groups'
const SRC_COUNTRIES = 'rcm-country-boundaries'

function countryFilter() {
  // CountryMap.vue:187-191. The ISO half needs no branch: THE FIELD BRIDGE above already copies
  // iso3 -> iso_3166_1_alpha_3 onto every geojson feature before setData, so one name is read
  // everywhere. I nearly added a second name for that one fact, having read the RAW file instead of
  // the data as loaded — the bridge was three lines above the filter.
  //
  // ★ THE WORLDVIEW HALF IS THE BUG, and it has no bridge. The TILESET repeats a country once per
  // worldview, so without this clause the highlight draws two or three times over. The geojson has
  // no such duplication and carries NO worldview property at all, so both sides of the `any` are
  // false on every feature and the `all` excluded the entire layer. Measured by eye at
  // b0cd3140: source 200, basemap and 2,107 pins drawn, 0 features in the fill layer, while Mapbox
  // drew 156. Mapbox-only, not a thing to translate.
  const byCode = ['in', ['get', 'iso_3166_1_alpha_3'], ['literal', props.countryCodes]]
  if (isMaplibreProvider) return byCode
  return ['all', byCode,
    ['any', ['==', ['get', 'worldview'], 'all'], ['in', 'US', ['get', 'worldview']]]]
}

// CountryMap.vue:218-223 verbatim. Split out of addLayers() because the LAYER is created once
// and the MODE changes underneath it: RegionDetail passes color-by-prayer, CountryDetail does
// not, and this element now keeps ONE map across both. Creating the layer with the region's
// expression and never updating it left a country page painting prayer colours -- a yellow
// "1+ praying" pin sitting on a page whose whole point is in-country vs surrounding. Nothing
// numeric caught it; it was visible in a screenshot and invisible to every assertion, because
// the pins WERE rendered and the legend WAS correctly absent.
function pinExpressions() {
  const outsideFocus = ['!', ['get', 'inCountry']]
  const full = ['>=', ['get', 'committed'], FULL_PRAYER_COVERAGE_COUNT]
  const some = ['>', ['get', 'committed'], 0]
  const lit = props.highlightRegion
  const isLit = ['==', ['get', 'region'], lit]

  if (props.colorMode === 'region') {
    // OURS, chooser only. Colour from the shared strategy; a hovered region lifts above the rest
    // and the others recede, which is the cheapest way to say "these pins are one group".
    return {
      color: regionColorExpression(),
      sortKey: lit ? ['case', isLit, 2, 1] : 1,
      opacity: lit ? ['case', isLit, 1, 0.45] : 1,
      // ★ THE DIM DIMS THE STROKE TOO, AND THAT IS THE WHOLE FIX. circle-opacity applies to the
      // FILL only; circle-stroke-opacity is a separate property that defaults to 1. So the old
      // 0.25 dim left the 1px white stroke fully opaque, and at the dimmed radius that ring is
      // most of the pin: a reader saw a crisp white O with a washed-out centre, not a receded dot.
      // A screenshot (pins-a5eb9f6fa/hover2/maplibre-1440-hover.png) showed them as pale rings,
      // which is exactly what an opaque stroke around a faint core looks like on a pastel fill.
      // Worth being precise, because "keep the stroke opaque while dimming the fill" was the
      // proposed fix and it was already the behaviour — it was the CAUSE, not the cure.
      strokeOpacity: lit ? ['case', isLit, 1, 0.3] : 1,
      // THE RESTING STATE IS BIGGER THAN THE CLONE'S, and only here. Reported: the pins
      // as hard to see; this is the state that answers that, because it is what the page shows on
      // load, before any hover. Two things make a pin harder to read on THIS map than on a cloned
      // country page, and neither is taste:
      //   · the chooser renders the GLOBE, so the subject is the whole world rather than one
      //     country — every pin sits at the lowest useful zoom instead of a framed close-up;
      //   · a 1px white stroke is a fixed cost, so at radius 3 it eats a third of the pin's
      //     width and the COLOURED core that carries the region's identity is only ~2px.
      // Raising the resting radius 3 -> 4 at zoom 2 grows the coloured core from ~2 to ~3, which is
      // a ~50% gain in the part a reader actually distinguishes, for ~33% more footprint. Opacity
      // goes 0.9 -> 1 for the same reason: at this size, 10% transparency over a basemap is a
      // visible loss of contrast and buys nothing when nothing is being de-emphasised yet.
      // The HOVER state is deliberately untouched — dimming the rest to 0.25 is the design saying
      // "these pins are one group", which is a taste call rather than a legibility defect.
      // ★ SMALLER BELOW ZOOM 1 (2026-09-30: on a phone the globe sits near zoom -0.5 and the dots, clamped at their
      // zoom-2 size, read as far too large). Measured: the desktop chooser sits near zoom 1.1, so every stop from zoom
      // 1 up keeps the old size and the desktop keeps its dots; below zoom 1 they shrink to about half.
      radius: lit
        // ZOOM AT THE TOP, the case inside each stop: MapLibre allows ONE zoom interpolate per expression, at the
        // top, so ['case', isLit, interpolate, interpolate] does not parse and a lit map never got these sizes.
        ? ['interpolate', ['linear'], ['zoom'], -1, ['case', isLit, 2.8, 1.6], 0.5, ['case', isLit, 3.2, 2], 1, ['case', isLit, 4.5, 3], 2, ['case', isLit, 4.5, 3], 6, ['case', isLit, 8, 5.5]]
        : ['interpolate', ['linear'], ['zoom'], -1, 2, 0.5, 2.5, 1, 4, 2, 4, 6, 7.5],
      // THE TAP TARGET: the invisible rcm-pins-hit twin (addLayers), at least 7 px at every zoom.
      hitRadius: HIT_RADIUS,
    }
  }
  // DX-life's two modes, unchanged (CountryMap.vue:218-223).
  return {
    color: props.colorMode === 'prayer'
      ? ['case', outsideFocus, C.outside, full, C.prayerFull, some, C.prayerPartial, C.prayerNone]
      : ['case', ['get', 'inCountry'], C.inCountry, C.muted],
    sortKey: props.colorMode === 'prayer'
      ? ['case', outsideFocus, 0, full, 3, some, 2, 1]
      : ['case', ['get', 'inCountry'], 1, 0],
    opacity: ['case', ['get', 'inCountry'], 1, 0.75],
    strokeOpacity: 1,   // theirs, unchanged (CountryMap.vue) — only the chooser's dim is ours
    radius: ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 6.5],
    hitRadius: HIT_RADIUS,
  }
}

// ★ PIN TAPS WERE HARD TO LAND ON A PHONE ("not very responsive"): the tap target was the drawn dot, 3-4 px of
// radius at the zooms a phone shows. The invisible twin takes at least 7 px at every zoom (the size UPG-100's pins
// settled on), growing with the dots at street zoom. Where pins crowd, the pin drawn on top wins the tap.
const HIT_RADIUS = ['interpolate', ['linear'], ['zoom'], -1, 7, 2, 7, 6, 9]

function addLayers() {
  const m = map.value
  if (!m) return
  const { color: pinColor, sortKey: pinSortKey, opacity: pinOpacity, radius: pinRadius, strokeOpacity: pinStrokeOpacity, hitRadius: pinHitRadius } = pinExpressions()

  if (!m.getSource(SRC_COUNTRIES)) {
    // ── COUNTRY POLYGONS, PER PROVIDER ────────────────────────────────────────────────────────
    // ★ THE ENGINE SWAP IS NOT ONE CONFIG LINE. This read from
    // `mapbox://mapbox.country-boundaries-v1`, a Mapbox-hosted VECTOR TILESET that MapLibre
    // cannot fetch at all — it throws
    //     Fetch API cannot load mapbox://mapbox.country-boundaries-v1. URL scheme "mapbox" is not supported
    // and then draws the basemap perfectly with the highlighted countries simply ABSENT.
    // MEASURED, not predicted: the leaf reported canvas=1 and engine=MAPLIBRE — a coarse sweep
    // called it "swapped" while its primary data layer was missing. Only the console said so.
    //
    // The keyless equivalent already ships: assets/boundaries/world-adm0.geojson, staged by
    // generate-tree and already consumed by upg-100-list, connectivity-map and resources-map
    // through this same resolveAssetsBase helper. No new asset, no new dependency.
    //
    // ★ THE FIELD BRIDGE. The tileset names the ISO field `iso_3166_1_alpha_3`; the geojson names
    // it `iso3`. countryFilter() reads the tileset name, so the property is normalised ONCE as the
    // data loads and every expression keeps reading the single name it always read — the Mapbox
    // path stays byte-for-byte unchanged. Same shape as DashboardMapPanel, deliberately copied.
    if (isMaplibreProvider) {
      // Add EMPTY first, then setData after the fetch: the addLayer calls below must run
      // SYNCHRONOUSLY to keep these fills beneath the pins (layer order is insertion order).
      m.addSource(SRC_COUNTRIES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      fetch(`${resolveAssetsBase(profileConfig?.value)}/boundaries/world-adm0-web.geojson`)
        .then((r) => r.json())
        .then((gj) => {
          for (const f of gj.features || []) {
            if (f.properties && f.properties.iso3) f.properties.iso_3166_1_alpha_3 = f.properties.iso3
          }
          const src = map.value && map.value.getSource(SRC_COUNTRIES)
          if (src) src.setData(gj)
          // ★ REPAINT ONCE THE LANDMASSES EXIST (hardening; check:region-fill-repaint). fill-color
          // is SNAPSHOTTED into the
          // layer's paint when addLayers creates it (:322) from an expression built out of
          // props.points — and with no points yet that expression is a FLAT no-data grey. On
          // MapLibre, the default engine, this fetch is the first moment the layer has any
          // features at all, and nothing re-evaluated the colour after it: whichever of the two
          // async inputs landed last, the fill kept the colour it was born with. applySubject is
          // idempotent and guards on getLayer, so this is harmless when the colour was already
          // right — it only removes the ordering's power to be the last word.
          applySubject()
        })
        .catch((e) => console.warn('[rcm] country boundaries failed to load', e))
    } else {
      m.addSource(SRC_COUNTRIES, { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' })
    }
    // 'source-layer' applies to VECTOR TILE sources only — on a geojson source MapLibre rejects
    // the layer outright ("does not need a source-layer"), so it is set for Mapbox alone.
    const srcLayer = isMaplibreProvider ? {} : { 'source-layer': 'country_boundaries' }
    m.addLayer({
      id: 'rcm-focus-fill', type: 'fill', source: SRC_COUNTRIES,
      ...srcLayer, filter: countryFilter(),
      paint: {
        'fill-color': props.colorMode === 'region' ? regionFillExpression.value : C.brand,
        'fill-opacity': props.colorMode === 'region' ? FILL_OPACITY_REGION : 0.12,
      },
    })
    m.addLayer({
      id: 'rcm-focus-outline', type: 'line', source: SRC_COUNTRIES,
      ...srcLayer, filter: countryFilter(),
      paint: { 'line-color': C.brand, 'line-width': 2 },
    })
  }
  if (!m.getSource(SRC_PINS)) {
    m.addSource(SRC_PINS, { type: 'geojson', data: geojson.value })
    m.addLayer({
      id: 'rcm-pins', type: 'circle', source: SRC_PINS,
      layout: { 'circle-sort-key': pinSortKey },
      paint: {
        'circle-radius': pinRadius,
        'circle-color': pinColor,
        'circle-opacity': pinOpacity,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': pinStrokeOpacity,
      },
    })
    // ★ AN INVISIBLE HIT TWIN (the pattern UPG-100's pins use): the engines hit-test a circle at its radius +
    // stroke, so shrinking the drawn dot would shrink the tap target with it. The twin keeps the old ramps, the
    // same sort key (so a tap picks the same pin as before), and both opacities 0, which skips the draw but
    // keeps the features queryable. The click and the cursor bind to it.
    m.addLayer({
      id: 'rcm-pins-hit', type: 'circle', source: SRC_PINS,
      layout: { 'circle-sort-key': pinSortKey },
      paint: { 'circle-radius': pinHitRadius, 'circle-stroke-width': 1, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
    })
    m.on('click', 'rcm-pins-hit', onPinClick)
    m.on('click', 'rcm-focus-fill', onCountryClick)
    m.on('mouseenter', 'rcm-focus-fill', () => { if (props.selectOnPinClick) m.getCanvas().style.cursor = 'pointer' })
    m.on('mouseleave', 'rcm-focus-fill', () => { if (props.selectOnPinClick) m.getCanvas().style.cursor = '' })
    m.on('mouseenter', 'rcm-pins-hit', () => { m.getCanvas().style.cursor = 'pointer' })
    m.on('mouseleave', 'rcm-pins-hit', () => { m.getCanvas().style.cursor = '' })
  }
}

// Their popup (CountryMap.vue:130-162) shows name, country, population and a profile link.
let popup = null
function onPinClick(e) {
  const f = e.features && e.features[0]
  if (!f) return
  // ★ A PIN TAP OPENS ITS POPUP, everywhere (2026-09-30: on the all-regions map a pin tap jumped to the country's
  // dashboard, when the reader wanted the people group). In the chooser, a COUNTRY tap picks the country instead
  // (onCountryClick).
  // ★ THE ENGINE THAT BUILT THIS MAP, not the Mapbox global. This read `window.mapboxgl` and
  // returned SILENTLY when it was absent. Under provider=maplibre it worked only because every
  // leaf <head> statically loads mapbox-gl — so a MapLibre map was opening a MAPBOX popup. studio
  // is removing those static tags (they leak a visitor's IP to Mapbox for partners who chose
  // MapLibre), and the moment that lands this popup would vanish with no error at all: the pin
  // click would simply do nothing. engineFor() asks which namespace owns the map instance.
  const g = engineFor(map.value)
  if (!g) return
  const p = f.properties || {}
  const html = popupHtml(p)
  if (popup) popup.remove()
  popup = new g.Popup({ closeButton: true, maxWidth: '264px', offset: POPUP_OFFSET })
    .setLngLat(f.geometry.coordinates).setHTML(html).addTo(map.value)
  // The box only has a height once it is in the document, so measure on the next frame.
  requestAnimationFrame(() => panPopupIntoView(f.geometry.coordinates))
}

// The CHOOSER picks a country by its shape. A tap that lands on a pin is the pin's (its popup), so the country
// only answers a tap with no pin under it. The prop keeps its old name: it means "this map is the chooser".
function onCountryClick(e) {
  if (!props.selectOnPinClick || !map.value) return
  if (map.value.getLayer('rcm-pins-hit') && map.value.queryRenderedFeatures(e.point, { layers: ['rcm-pins-hit'] }).length) return
  const f = e.features && e.features[0]
  const code = f && f.properties && f.properties.iso_3166_1_alpha_3
  if (code) emit('pick-country', { code: String(code).toUpperCase(), region: '', name: (f.properties.name || '') })
}

// Their popup offset, as one constant: the pan arithmetic has to use the SAME number the popup was
// built with, and two literals drift.
const POPUP_OFFSET = 12

/**
 * How far the map must move, in pixels, for the whole popup to sit inside the map.
 *
 * ★ WHY PANNING AND NOT A SHORTER POPUP. The popup is built with no explicit anchor, so the engine
 * places it above the pin when there is room and below when there is not. MEASURED on the drop-in:
 * a 452px popup on a pin in the lower half of a 780px map fits NEITHER way, so it opens below and
 * the map's overflow:hidden cuts off the Pray and Full Profile buttons — a real click then lands on
 * the page behind. Moving the PIN is what makes the preferred anchor fit; the popup's design is
 * untouched, which is what keeps this a clone. It is what Leaflet does by default.
 *
 * ★ AND IT ALWAYS RESOLVES, at every width this component renders at. Container height is
 * max(780, 16/9 of width) at >=768px and 2x width below that, so even at 320px wide the container
 * is 640px against a 452px popup — 164px of headroom. The popup would have to grow by 164px before
 * any width could overflow. So there is no residual case needing an inner scroll.
 *
 * ★ CLEARING THE CLIP IS NOT THE SAME AS BEING CLICKABLE, which is what the first version of this
 * got wrong. The bottom controls — the attribution and the pin hint — are painted OVER the canvas
 * and take pointer events, so a popup that ends fully inside the frame can still have its buttons
 * underneath them. MEASURED at 390 on a 366x732 map: the pan cleared the clip exactly (cut 0), and
 * a real click on Full Profile still did nothing, because at y~701 the top element at that point
 * was div.maplibregl-ctrl-attrib-inner; on the sibling pin it was span.pin-hint-pill. The popup is
 * not at fault and neither is the control: attribution is a LICENCE TERM of the basemap, so raising
 * the popup over it is not available to us. The usable frame is simply shorter than the container,
 * and the fit test has to say so.
 *
 * bottomInset is therefore MEASURED from the live controls rather than assumed — a constant would
 * be wrong on the next control we add, at a width where the attribution wraps to two lines, or when
 * the gallery's clearance transform lifts the whole band.
 *
 * Returns 0 when nothing should move: already fitting, unmeasurable, or a popup taller than its
 * container. That last one matters — a host can give the map a short slot, and there panning would
 * only move the clipping around, so the failure stays what it is today rather than becoming a
 * clipped popup AND a camera that jumped.
 */
function panPlanFor({ containerH, popupH, pinY, offset = POPUP_OFFSET, bottomInset = 0 }) {
  if (!(containerH > 0) || !(popupH > 0) || !Number.isFinite(pinY)) return 0
  const need = popupH + offset
  // The frame the popup must fit inside is the container MINUS the band the controls occupy.
  const usableH = containerH - Math.max(0, bottomInset)
  if (pinY >= need || (usableH - pinY) >= need) return 0      // one anchor already fits, clear of the controls
  if (need > usableH) return 0                                // taller than the usable frame: unfixable here
  const downToFitAbove = need - pinY
  const upToFitBelow = need - (usableH - pinY)
  return downToFitAbove <= upToFitBelow ? downToFitAbove : -upToFitBelow
}

/**
 * The height of the bottom control band, in CSS pixels, measured from the live elements.
 *
 * Both engines are named because the provider prop can swap them. Only controls that actually
 * INTERCEPT POINTER EVENTS matter here: the container is pointer-events:none and the control inside
 * it is pointer-events:auto, so the band is measured from the controls, not from their corner box —
 * which at 390 spans nearly the full map width and would over-reserve the whole strip.
 */
function bottomControlInset(container) {
  if (!container) return 0
  let top = Infinity
  const box = container.getBoundingClientRect()
  const sel = '.maplibregl-ctrl-bottom-left .maplibregl-ctrl, .maplibregl-ctrl-bottom-right .maplibregl-ctrl,'
    + '.mapboxgl-ctrl-bottom-left .mapboxgl-ctrl, .mapboxgl-ctrl-bottom-right .mapboxgl-ctrl, .pin-hint-pill'
  for (const el of container.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect()
    if (r.height <= 0 || r.width <= 0) continue               // a collapsed control reserves nothing
    if (r.top < top) top = r.top
  }
  if (!Number.isFinite(top)) return 0
  return Math.max(0, Math.round(box.bottom - top))
}

function panPopupIntoView(lngLat) {
  const m = map.value
  if (!m || !popup) return
  let popupH = 0, containerH = 0, pinY = NaN, bottomInset = 0
  try {
    const el = popup.getElement()
    popupH = el ? el.getBoundingClientRect().height : 0
    const c = m.getContainer()
    containerH = c?.clientHeight || 0
    bottomInset = bottomControlInset(c)
    pinY = m.project(lngLat).y
  } catch (_) { return }                                      // a map mid-load cannot be measured
  const dy = panPlanFor({ containerH, popupH, pinY, bottomInset })
  // panBy moves the CAMERA, so the sign is inverted: a positive plan moves the PIN down the screen.
  if (dy) { try { m.panBy([0, -dy], { duration: 200 }) } catch (_) { /* a pan is a nicety, never a failure */ } }
}
// THEIR escape, not a shorter one: CountryMap.vue:122-125 also escapes the two quote characters,
// and this string is interpolated into href="" and alt="" attributes below, where omitting them is
// the difference between an escape and a hole.
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ★ THEIR PIN POPUP, PORTED — CountryMap.vue:130-161. Ours was a four-line stub: a bold name, the
// country, "Population 12,345" and "678 praying", in English, with no photo, no religion, no
// description and no way to act on it. Theirs is a card: the people group's photo, the name, the
// country and its primary ethnolinguistic group, a definition list of Population / Religion /
// Intercessors-out-of-100, up to three lines of the location description, and two buttons — Pray,
// which is the entire point of the site, and Full Profile.
// It could not have been ported before this pass because the DATA was not being fetched: rop1,
// religion, location_description and the photo were missing from our field list.
function popupHtml(p) {
  const name = esc(p.name || '')
  const subtitle = [p.country, p.rop1].filter(Boolean).map(esc).join(' · ')
  // ★ NUMBER FORMAT IS HELD, AND THAT MEANS THE GROUPING TOO -- NOT JUST THE DIGITS.
  // 'NUMERALS ARE HELD' (COMMON.md) covers the whole formatted
  // number, so per-locale grouping is itself the held decision. I misread it as a digits-only rule
  // and shipped `${locale}-u-nu-latn`, which keeps digits Latin but lets the SEPARATORS follow the
  // locale (de 1.234.567, ru 1 234 567). That is the held choice being made by one map, which is
  // exactly what the hold exists to prevent -- gospel did the same and was asked to revert too.
  // Reverted to a fixed 'en-US' on the shepherd's instruction so no map decides this alone.
  //
  // For the record, the state immediately before that was `toLocaleString(locale.value || 'en')`,
  // which followed the locale for digits AND grouping -- so this element was already out of
  // compliance; my change altered the form of the deviation rather than introducing it. 'en-US' is
  // the older form, from 29eaf3a6.
  //
  // THEIRS DIFFERS, deliberately and temporarily: their formatPopulation is
  // toLocaleString(languageCode). Exact parity is PROVISIONAL, pending a product decision --
  // this line and the two sibling formatters change together.
  //
  // EVIDENCE FOR THAT DECISION, measured here and carried back: a REGIONED tag is what
  // switches the digit system, not the bare language code --
  //     ar     -> numberingSystem=latn -> 1,234,567
  //     ar-EG  -> numberingSystem=arab -> ١٬٢٣٤٬٥٦٧
  // so a host setting profile-config.locale to 'ar-EG' is the case that actually changes digits.
  // A fixed 'en-US' is immune to it, which is a second reason the revert is safe.
  const pop = Number(p.population) > 0 ? Number(p.population).toLocaleString('en-US') : ''
  const profileUrl = joinBase(props.researchUrl, p.slug || '')
  const prayUrl = `${joinBase(props.prayBaseUrl, p.slug || '')}?source=doxalife`

  const rows = []
  if (pop) rows.push(`<div><dt>${esc(t('Population'))}</dt><dd>${pop}</dd></div>`)
  if (p.religion) rows.push(`<div><dt>${esc(t('Religion'))}</dt><dd>${esc(p.religion)}</dd></div>`)
  rows.push(`<div><dt>${esc(t('Intercessors'))}</dt><dd>${Number(p.committed) || 0}/${FULL_PRAYER_COVERAGE_COUNT}</dd></div>`)

  return `<div class="cm-popup">
      ${p.imageUrl ? `<img class="cm-popup__img" src="${esc(p.imageUrl)}" alt="${name}" loading="lazy">` : ''}
      <div class="cm-popup__body">
        <div class="cm-popup__name">${name}</div>
        ${subtitle ? `<div class="cm-popup__sub">${subtitle}</div>` : ''}
        ${rows.length ? `<dl class="cm-popup__stats">${rows.join('')}</dl>` : ''}
        ${p.description ? `<p class="cm-popup__desc">${esc(p.description)}</p>` : ''}
        <div class="cm-popup__actions">
          <a class="cm-popup__btn cm-popup__btn--primary" href="${esc(prayUrl)}">${esc(t('Pray'))}</a>
          <a class="cm-popup__btn" href="${esc(profileUrl)}">${esc(t('Full Profile'))}</a>
        </div>
      </div>
    </div>`
}

// Re-frame and re-source on a new selection instead of tearing the map down: a rebuilt map
// re-downloads tiles and flashes, and the subject changes on every tab-1 click.
/**
 * The chooser's zoom has to follow the CONTAINER, and it has to be asked of the GLOBE.
 *
 * ★ THIS USED TO BE `log2(width / 512)` — mercator's world is 512*2^z wide, so that is the zoom
 * which fits one mercator world. But the chooser renders under the GLOBE projection, and the same
 * mistake that made the region pages frame too wide (a mercator answer applied to a sphere) made
 * this frame too SMALL. Found by LOOKING at _shot-chooser-map-desktop.png — a sphere adrift in
 * white space — not by any assertion, and then measured at 1200x780:
 *
 *   zoom 1.229 (what the mercator formula returned) -> sphere diameter 390.61px = 50.1% of the
 *   frame's short side. HALF THE FRAME WAS DEAD SPACE.
 *
 * Worse, the number was inert. That probe measured zoom 0.5, 1.0 and 1.229 all rendering an
 * IDENTICAL 390.61px sphere, because Mapbox clamps the globe's apparent size at low zoom: the
 * formula's output sat inside the clamp, so it could have returned 0.5 and changed nothing.
 *
 * There is no closed form to replace it with. The same probe measured the diameter against a clean
 * doubling and found 3.6-10.5% error above the clamp, because the globe-to-mercator transition is
 * nonlinear there — so `log2` of anything is the wrong shape. What the measurement DID establish
 * is that the diameter never decreases as zoom rises, and monotonicity is the only property a
 * solver needs. So SOLVE it against the engine instead of modelling it:
 * bisect the zoom whose pole-to-pole projection fills FILL of the frame's short side.
 *
 * project() is pure transform math — no tiles, no paint, no network — and every setZoom here
 * lands in ONE synchronous block before any frame renders, so the bisection is invisible; the
 * original zoom is restored in a `finally` regardless. If any of it throws, the old mercator
 * formula is the fallback, because a slightly small globe beats a broken chooser.
 *
 * Only the chooser uses this; a selected page is framed by their own bounds/centre/zoom.
 */
const CHOOSER_FILL = 0.92     // leave a margin so the limb is never clipped by the frame
function chooserZoom(m) {
  if (props.colorMode !== 'region') return props.zoom
  let W = 0, H = 0
  try { const el = m.getContainer(); W = el?.clientWidth || 0; H = el?.clientHeight || 0 } catch (_) { W = 0 }
  if (!W) return props.zoom
  const mercatorFallback = Math.max(0, Math.min(2, Math.log2(W / 512)))
  if (!H) return mercatorFallback

  const z0 = m.getZoom()
  try {
    const c = m.getCenter()
    // ★ THE LIMB, NOT THE POLES. The first version of this measured pole-to-pole and called it the
    // diameter, which is only true when the centre sits on the equator. The chooser centres on the
    // mean of every people group -- latitude 28 -- so pole-to-pole is a CHORD: measured 717.6px
    // where the sphere was really 792-835px across, understating it by 1.104x. The solver therefore
    // over-zoomed and the globe was clipped top and bottom, which the screenshot showed plainly
    // while every number still looked right.
    // Under the globe the silhouette is centred on the map centre, so any point at 90 deg ANGULAR
    // distance lies on the limb. Sample several bearings and take the MAX, because Mapbox's globe
    // is a perspective camera rather than a true orthographic one, so the silhouette is not a
    // perfect screen-space circle -- measured radius 396px along the meridian against 417.3px east
    // and west at the same zoom. Taking the max is what keeps the widest axis inside the frame.
    const RAD = Math.PI / 180, DEG = 180 / Math.PI
    const phi0 = c.lat * RAD
    // Great-circle destination at angular distance 90 deg on bearing t, which reduces to this
    // because cos(90 deg) is 0 and sin(90 deg) is 1.
    const limbPoints = []
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * 2 * Math.PI
      const lat = Math.asin(Math.cos(phi0) * Math.cos(t))
      const lng = c.lng + Math.atan2(Math.sin(t) * Math.cos(phi0), -Math.sin(phi0) * Math.sin(lat)) * DEG
      limbPoints.push([lng, lat * DEG])
    }
    const diameter = (z) => {
      m.setZoom(z)
      const ctr = m.project([c.lng, c.lat])
      let max = 0
      for (const pt of limbPoints) {
        const q = m.project(pt)
        const d = Math.hypot(q.x - ctr.x, q.y - ctr.y)
        if (Number.isFinite(d) && d > max) max = d
      }
      return max * 2
    }
    const want = Math.min(W, H) * CHOOSER_FILL
    let lo = 0, hi = 5
    if (diameter(hi) < want) return hi          // frame bigger than the globe can fill
    for (let i = 0; i < 24; i++) {              // 24 halvings of [0,5] resolves to ~3e-7 zoom
      const mid = (lo + hi) / 2
      if (diameter(mid) < want) lo = mid; else hi = mid
    }
    const solved = (lo + hi) / 2
    return Number.isFinite(solved) ? solved : mercatorFallback
  } catch (e) {
    console.warn('[RegionCountryMap] globe fill solve failed, using the mercator fit:', e && e.message)
    return mercatorFallback
  } finally {
    // Never leave the camera parked on a probe value.
    try { m.setZoom(z0) } catch (_) {}
  }
}

/**
 * Frame `bounds` the way THEIR CONSTRUCTOR frames it, not the way a post-load fitBounds does.
 *
 * ★ MEASURED 2026-09-24, one page, one box, one engine (mapbox-gl 3.24.0 on both sides):
 *
 *   new mapboxgl.Map({ bounds, fitBoundsOptions })  -> zoom 3.210, getProjection() 'mercator' at t=0
 *   map.fitBounds(bounds, sameOptions)              -> zoom 2.777, getProjection() 'globe'
 *
 * Same box [[-16.683,-33.976],[57.497,16.769]], same padding 40, same maxZoom 6, same 1200x780
 * frame. 0.433 zoom apart == 1.35x linear scale, which IS the difference the Africa crops showed
 * and the reason their frame cuts the Sahel while ours had room for Madagascar and Sri Lanka.
 *
 * The cause is not the box and not the options: Mapbox v3 resolves a constructor `bounds` while
 * the camera is still mercator and applies the style's globe afterwards, so that camera keeps the
 * tighter mercator fit forever. A post-load fitBounds is resolved with the globe already active,
 * and a sphere shows more planet at the same zoom, so it pulls back.
 *
 * So the fix is to ask the engine the SAME question their constructor asks -- compute the camera
 * with the projection set to mercator, then put the globe back and jump there. Asking the engine
 * rather than reimplementing a Web Mercator fit keeps Mapbox's own padding and worldSize
 * semantics, which a hand-rolled version would drift from at the next upgrade.
 *
 * Both setProjection calls land in ONE synchronous tick, so no frame renders in mercator; the
 * probe asserts the projection is still 'globe' afterwards rather than trusting that.
 */
// The two engines disagree about BOTH halves of the projection API, and this read used to assume
// Mapbox's:
//   Mapbox    getProjection() -> { name: 'globe' }      setProjection('mercator')
//   MapLibre  getProjection() -> { type: 'globe' } | undefined
//                                                   setProjection({ type: 'mercator' })
// MEASURED in maplibre-gl@5's own source: Map.getProjection() returns `this.stylesheet?.projection`,
// and the OpenFreeMap style we hand MapLibre declares no `projection` key at all — its top level is
// version, sources, sprite, glyphs, layers. So getProjection() is UNDEFINED there, and reading
// `.name` off it threw a TypeError. That read sat OUTSIDE the try, so the throw escaped
// fitTheirWay, escaped applySubject() — of which it is the last statement — and the camera was
// never framed. Opening a region dashboard under MapLibre therefore left the map wherever it was
// instead of flying to the region, which is exactly the reported symptom.
// ★ BOTH OF THESE NOW COME FROM library/useMapProvider (C2). Mine read the engine from CONFIG
// (isMaplibreProvider), which is weaker than reading it from the INSTANCE: a page configured for one
// engine can hold a map built by the other. The library version instance-tests, which is what
// pplr-data-maps had been doing correctly all along.
// Mapbox takes the bare string; MapLibre v5 takes { type }. Writing the wrong shape is not a
// no-op — maplibre reads e?.type and would set undefined.

function fitTheirWay(m, bounds, opts = FIT_OPTS) {
  let cam = null
  const proj = projectionOf(m)
  try {
    if (proj && proj !== 'mercator') setProjectionOn(m, 'mercator')
    cam = m.cameraForBounds(bounds, opts)
  } catch (e) {
    console.warn('[RegionCountryMap] mercator fit unavailable, falling back to fitBounds:', e && e.message)
  } finally {
    // Restore in `finally` so a throw inside cameraForBounds can never leave the map flat.
    if (proj && proj !== 'mercator') setProjectionOn(m, proj)
  }
  if (cam && cam.center && typeof cam.zoom === 'number') m.easeTo({ center: cam.center, zoom: cam.zoom, duration: 600 })
  else m.fitBounds(bounds, { ...opts, duration: 600 })
}

/**
 * The box the drawn pins occupy, or null when there are none to bound.
 * [[west, south], [east, north]] — the same shape props.bounds arrives in.
 */
function pinsBox() {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const p of props.points) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue
    if (p.lng < w) w = p.lng
    if (p.lng > e) e = p.lng
    if (p.lat < s) s = p.lat
    if (p.lat > n) n = p.lat
  }
  return Number.isFinite(w) && Number.isFinite(s) ? [[w, s], [e, n]] : null
}

/**
 * ★ A FIXED ZOOM SHOWS LESS ON A NARROW SCREEN, so a tall country loses its edges.
 *
 * MEASURED on the drop-in: /regions/niger at 390 wide put the camera over southern Niger
 * and northern Nigeria with the Agadez outline cut off at the top, and 0 of the page's 2 pins in
 * view, while the same page at 1440 showed both. INHERITED, not introduced here: their
 * CountryDetail.vue passes only :center and :zoom to CountryMap and never a box, so the live site
 * frames the same way. chooserZoom cannot save it either — its first line returns props.zoom
 * unchanged unless colorMode is 'region', and a country page is 'prayer'.
 *
 * ★ WHY THIS IS CONDITIONAL RATHER THAN ALWAYS FITTING. fitTheirWay ends in easeTo({center, zoom}),
 * so it moves the CENTRE as well as the zoom. Fitting unconditionally would therefore shift the
 * framing of every already-correct page, which is exactly what a clone must not do. So the
 * configured camera is applied first and kept, and the fit runs only when a pin actually falls
 * outside it.
 *
 * ★ AND THE CAP IS A CEILING, NOT A FLOOR. maxZoom: props.zoom lets the fit zoom OUT — which is the
 * whole point, since the narrow case needs a LOWER zoom to fit — while forbidding it from zooming
 * IN past the camera the page asked for. (An earlier version of this idea capped it the other way,
 * which would have made the fix a no-op on the one case it exists for.)
 *
 * The pins' box is the honest input available here. The country outline comes from the countries
 * tile source, so its extent is only as good as the tiles that happen to be loaded — reading a box
 * off it would measure the viewport, not the country. A real country box would have to come from
 * the page, and would be better, because pins can cluster in one corner.
 */
function fitIfPinsAreOutOfView(m) {
  const box = pinsBox()
  if (!box) return
  let view = null
  try { view = m.getBounds() } catch (_) { return }
  if (!view || typeof view.contains !== 'function') return
  const inView = (lng, lat) => { try { return view.contains([lng, lat]) } catch (_) { return true } }
  const allIn = inView(box[0][0], box[0][1]) && inView(box[1][0], box[1][1])
    && inView(box[0][0], box[1][1]) && inView(box[1][0], box[0][1])
  if (allIn) return                                   // well framed already: do not touch the camera
  fitTheirWay(m, box, { ...FIT_OPTS, maxZoom: props.zoom })
}

function applySubject() {
  const m = map.value
  // Deliberately NOT gated on isMapReady: that flag tracks useMapInstance's own view of the
  // load, and gating on it is what let a re-frame land before the layers existed. getSource /
  // getLayer answer the only question that matters here.
  if (!m) return
  const src = m.getSource(SRC_PINS)
  if (src) src.setData(geojson.value)
  // Re-apply the MODE, not just the data — see pinExpressions().
  if (m.getLayer('rcm-pins')) {
    const { color, sortKey, opacity, radius, strokeOpacity, hitRadius } = pinExpressions()
    m.setPaintProperty('rcm-pins', 'circle-color', color)
    m.setPaintProperty('rcm-pins', 'circle-opacity', opacity)
    m.setPaintProperty('rcm-pins', 'circle-stroke-opacity', strokeOpacity)
    m.setPaintProperty('rcm-pins', 'circle-radius', radius)
    m.setLayoutProperty('rcm-pins', 'circle-sort-key', sortKey)
    if (m.getLayer('rcm-pins-hit')) {
      m.setPaintProperty('rcm-pins-hit', 'circle-radius', hitRadius)
      m.setLayoutProperty('rcm-pins-hit', 'circle-sort-key', sortKey)
    }
  }
  for (const id of ['rcm-focus-fill', 'rcm-focus-outline']) {
    if (m.getLayer(id)) m.setFilter(id, countryFilter())
  }
  // The fill follows the mode too, not just the filter: switching between the chooser and a
  // cloned page must repaint the landmasses, or the region colours would leak onto their pages.
  if (m.getLayer('rcm-focus-fill')) {
    const byRegion = props.colorMode === 'region'
    m.setPaintProperty('rcm-focus-fill', 'fill-color', byRegion ? regionFillExpression.value : C.brand)
    m.setPaintProperty('rcm-focus-fill', 'fill-opacity', byRegion ? FILL_OPACITY_REGION : 0.12)
  }
  // NO PROJECTION OVERRIDE. This used to force mercator in the chooser, on the reasoning that
  // Mapbox v3's globe below ~zoom 6 left a world-view chooser as a small sphere in a 1200x780
  // frame. That was ruled out (2026-09-24): these maps are a clone, changed only in colour and the
  // scrolling side bar, so the globe stays. Deleted rather than argued — and
  // deleting is the right shape of fix here, since their page sets no projection at all.
  // Expose the box we asked to fit, so a probe can ask the engine what IT would have chosen for
  // the same box and tell 'the fit is wrong' apart from 'something overrode the fit'.
  if (props.bounds && typeof window !== 'undefined') window.__rcmBounds = props.bounds
  if (props.bounds) fitTheirWay(m, props.bounds)
  else {
    const zoom = chooserZoom(m)
    // Same null guard as the constructor above: flyTo goes through the engine's own LngLat
    // conversion, so a null here throws exactly as it does at mount. Falling back to the map's
    // current centre re-frames the ZOOM without moving the camera sideways, which is what a
    // caller who supplied no centre wants.
    const c = props.center || m.getCenter()
    m.flyTo({ center: c, zoom, duration: 600 })
    // getBounds() reads the CURRENT camera, and flyTo is animated, so asking now would test the
    // camera we are leaving. Ask once the move has landed instead. `once` so repeated re-frames
    // cannot stack listeners, and the check is a no-op on a page that is already framed right.
    m.once('moveend', () => fitIfPinsAreOutOfView(m))
  }
}

/**
 * Run `fn` once the STYLE is actually usable, with no dependence on when we started listening.
 *
 * ★ WHY NOT `map.once('load', ...)` — measured 2026-09-23, twice, in both directions.
 *   Whether 'load' has already fired by the time this component gets to subscribe depends on how
 *   long the style takes, and the answer changed when the element was restructured. Miss the
 *   event and addLayers() NEVER RUNS: the map is real, it has a 1200x780 GL canvas, it flies to
 *   the right centre and zoom, and it draws NOTHING. That state passed every check that existed then, because
 *   a canvas at the right size is not the same property as a map that drew something.
 *   So: ask the map whether it is ready (isStyleLoaded) rather than trusting that we saw the
 *   moment it became ready, and keep asking on every styledata until it says yes. Idempotent --
 *   addLayers() guards on getSource, so a duplicate call is a no-op.
 */
function whenStyleReady(m, fn) {
  let done = false
  const run = () => {
    if (done) return
    done = true
    m.off('style.load', run); m.off('load', run)
    fn()
  }
  // 'style.load' is the event that means "the style JSON is parsed, addSource/addLayer are legal".
  // isStyleLoaded() is a STRONGER condition -- it also wants the style's sources loaded -- and
  // waiting for it is a trap: MEASURED, the country view at zoom 6 never satisfies it on this box,
  // because the local Mapbox token is URL-restricted and its high-zoom tiles 403. The region view
  // at zoom 2.8 does satisfy it, so the same code drew 934 pins for a region and nothing at all
  // for a country -- an environment limit masquerading as a bug in the country branch.
  if (m.isStyleLoaded && m.isStyleLoaded()) return run()
  m.on('style.load', run)
  m.on('load', run)
  // Last resort for exactly that case: if the style object already carries layers, the style is
  // parsed and our layers can go on regardless of whether any tile ever arrives.
  setTimeout(() => { try { if (m.getStyle && m.getStyle() && m.getStyle().layers) run() } catch (_) {} }, 1500)
}

onMounted(async () => {
  try {
    await initializeMap()
    if (!map.value) { mapFailed.value = true; return }
    // THEIR MAP CONTROLS, ported verbatim (CountryMap.vue:181-182). These were MISSING, which makes
    // it not a full clone: the fullscreen and zoom controls are part of the cloned surface. Neither this component nor useMapInstance added any control, and
    // NO diff covered them — every vs-live probe compares computed CSS and text, so two whole
    // controls could be absent and still report 79/79 identical. Their exact options and corner:
    //   new mapboxgl.NavigationControl({ showCompass: false }), 'top-right'
    //   new mapboxgl.FullscreenControl(), 'top-right'
    // Guarded per control so a MapLibre provider, which names these the same but not always
    // identically, cannot take the whole map down with it.
    // Same question as the popup: which engine owns THIS map. The old `mapboxgl || maplibregl`
    // happened to work because the fallback existed, but it preferred Mapbox even on a MapLibre
    // map — the identical shape of bug, one line away from the same silent failure.
    const gl = engineFor(map.value)
    if (gl) {
      try { map.value.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right') } catch (e) { console.warn('[RegionCountryMap] NavigationControl unavailable:', e && e.message) }
      try { map.value.addControl(new gl.FullscreenControl(), 'top-right') } catch (e) { console.warn('[RegionCountryMap] FullscreenControl unavailable:', e && e.message) }
    }
    whenStyleReady(map.value, () => { addLayers(); applySubject(); watchResize() })
  } catch (e) {
    console.error('[RegionCountryMap] init failed:', e)
    mapFailed.value = true
  }
})
// A CANVAS AT THE RIGHT SIZE IS NOT A MAP. Exposed so a gate can call
// queryRenderedFeatures() and assert pins and the country fill were actually DRAWN -- the
// country map rendered fully blank while 'a real GL canvas exists at 1200x780' passed.
// Same seam verify:interop reads for the camera (window.__rdashMap).
watch(isMapReady, (r) => { if (r && typeof window !== 'undefined') window.__rcmMap = map.value })

// ★ THE CREDIT SHOWS, THEN FOLDS TO ITS (i) (the attribution rule, plugin-designer skill §8). These maps have no
// footer sheet, so the credit keeps the engine's bottom corner (bottom-right; bottom-left in RTL, CSS below).
// On a narrow map both engines draw it compact, expanded at first; CREDIT_FOLD_MS after it first shows, fold it
// the way the engine's own drag does (drop the -compact-show class). A tap on the (i) expands it again. The same
// look-then-fold LegendMobile does for the footer maps: every half second, for up to 30 s, until it is there.
const CREDIT_FOLD_MS = 3000
let creditTimer = 0
const narrow = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches
function foldCredit(triesLeft) {
  creditTimer = 0
  const el = map.value && map.value.getContainer ? map.value.getContainer() : null
  if (!el) return
  const shown = el.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show, .mapboxgl-ctrl-attrib.mapboxgl-compact-show')
  if (shown) {
    creditTimer = setTimeout(() => { creditTimer = 0; if (narrow()) shown.classList.remove('maplibregl-compact-show', 'mapboxgl-compact-show') }, CREDIT_FOLD_MS)
    return
  }
  // KEEP LOOKING until it first shows: the engine marks the credit compact a moment AFTER the map reports ready
  // (measured: stopping at a credit that was present but not yet compact left it expanded for good in en).
  if (triesLeft > 0) creditTimer = setTimeout(() => foldCredit(triesLeft - 1), 500)
}
watch(isMapReady, (r) => { if (r && narrow()) foldCredit(60) })
// A rotated phone or a resized pane changes the width the zoom was derived from.
let ro = null
function watchResize() {
  if (typeof ResizeObserver === 'undefined' || !mapContainer.value) return
  ro = new ResizeObserver(() => {
    const m = map.value
    if (!m || props.colorMode !== 'region' || props.bounds) return
    try { m.setZoom(chooserZoom(m)) } catch (_) {}
  })
  ro.observe(mapContainer.value)
}

/**
 * ★ RELEASE EVERY GLOBAL THIS COMPONENT SETS, AS A SET — not just the one that came to mind.
 *
 * Two are published: __rcmMap (the live map instance, which pins the whole app — measured at
 * ~10 MB per mount) and __rcmBounds. Only the first was ever deleted, so every unmounted map left
 * its bounds behind; the leak that gets fixed is the one you remember, and the set is what the
 * check looks for.
 *
 * ★ AND BOTH DELETES ARE IDENTITY-CHECKED, for the reason the grid already needed: two of these
 * maps can share a page — the regions chooser and a country map — and the second mount overwrites
 * the global. An unconditional delete on the FIRST one's unmount would then strip the SECOND,
 * still-live map's handle, with no error anywhere. Clearing a shared global is only safe while you
 * can still prove you are the one who set it.
 *
 * One delete per line, deliberately: sr's check reads them as separate statements.
 */
/**
 * Resolve once this map has nothing left to draw — what the dashboard's Print button waits on.
 *
 * ★ `map.loaded()` IS NOT THE QUESTION. It reports true while tiles are still streaming, which is
 * how gospel's charts printed blank twice today (COMMON.md). The condition that actually means
 * "the pixels are the ones the reader asked for" is: the style is applied, the camera has stopped,
 * and the tiles for this camera are in.
 *
 * ★ 'idle' IS SUBSCRIBED TO ONLY AFTER CHECKING NOW. This component's own header records that
 * once('load') was measured unreliable in BOTH directions here — whether it has already fired
 * depends on how the map was constructed. An event that fired before we listened never arrives, so
 * the synchronous check is the first thing, not the fallback.
 *
 * Always resolves, never rejects, and always removes its listener — a print must not be blocked by
 * a map, and a map must not accumulate listeners because someone printed twice.
 */
function whenIdle({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const m = map.value
    if (!m || typeof m.isStyleLoaded !== 'function') return resolve('no-map')
    const settled = () => m.isStyleLoaded()
      && !m.isMoving()
      && (typeof m.areTilesLoaded !== 'function' || m.areTilesLoaded())
    let timer = null
    const finish = (why) => {
      if (timer) { clearTimeout(timer); timer = null }
      try { m.off('idle', onIdle) } catch (_) {}
      resolve(why)
    }
    const onIdle = () => { if (settled()) finish('idle') }
    if (settled()) return finish('ready')
    m.on('idle', onIdle)
    timer = setTimeout(() => finish('timeout'), timeoutMs)
  })
}

// The dashboard prints the page this map is on, so it has to be able to ask when the map is done.
defineExpose({ whenIdle })

onBeforeUnmount(() => {
  if (creditTimer) { clearTimeout(creditTimer); creditTimer = 0 }
  if (ro) { try { ro.disconnect() } catch (_) {} }
  if (popup) popup.remove()
  try { if (typeof window !== 'undefined' && window.__rcmMap === map.value) delete window.__rcmMap } catch (_) {}
  try { if (typeof window !== 'undefined' && window.__rcmBounds === props.bounds) delete window.__rcmBounds } catch (_) {}
  destroy()
})

watch(() => [props.countryCodes, props.bounds, props.center, props.zoom, props.points, props.colorMode, props.highlightRegion], applySubject, { deep: true })

// Their .country-map block, CountryMap.vue's scoped style: 16/9 with a 780px floor, flipping to
// 1/2 and no floor under 768px. Ported as an aspect-ratio pair; radius:inherit so the card that
// contains it supplies the corner, exactly as theirs does.
useShadowStyles(
  // The shared scroll-past strips, ported verbatim from my-upg-100-list/upg-100-list.vue:378.
  // touch-action:pan-y IS the mechanism: it lets a vertical drag scroll the PAGE while Mapbox
  // keeps the centre, which is the whole point of the affordance on a map inside a scrolling
  // dashboard. .rcm is already position:relative, so these anchor to it.
  '.map-scroll-edge{position:absolute;top:0;bottom:0;width:40px;z-index:2;' +
  'touch-action:pan-y;pointer-events:auto;background:transparent}' +
  '.map-scroll-edge--left{left:0}' +
  '.map-scroll-edge--right{right:0}' +

  // ── ★ PRINT: THE LEGEND GOES BESIDE THE MAP, NOT OVER IT ───────────────────────────────────
  // This plugin shipped with NO @media print rule at all, which is the single cause behind all
  // three of his symptoms: on paper the legend stayed absolutely positioned ON the map, the map
  // kept a 780px min-height and a 16/9 ratio that no page can hold, and the interactive chrome
  // printed along with it. A page that was never styled for print does not fail loudly; it just
  // prints the screen.
  //
  // .rcm__legend is a SIBLING of .rcm__canvas inside .rcm, so putting it beside the map is a
  // matter of letting it back into flow rather than restructuring anything: .rcm becomes a row,
  // the canvas takes the remaining width, and the legend takes its natural width.
  '@media print{' +
  '  .rcm{ display:flex; align-items:flex-start; gap:12px; min-height:0; aspect-ratio:auto; height:auto; break-inside:avoid; }' +
  '  .rcm__canvas{ flex:1 1 auto; height:12cm; }' +
  // Static, so it sits in the row instead of floating over the canvas. Capped so a long legend
  // cannot squeeze the map it is explaining down to a strip.
  '  .rcm__legend{ position:static; inset:auto; flex:0 0 auto; max-width:38%; background:none; box-shadow:none; }' +
  // Chrome that only means something to a pointer. The scroll strips are invisible on screen and
  // would print as two empty 40px columns beside the map.
  '  .map-scroll-edge, .mapboxgl-ctrl-group, .maplibregl-ctrl-group, .mapboxgl-ctrl-attrib-button, .maplibregl-ctrl-attrib-button{ display:none !important; }' +
  '}' +
  // ★ THE SCROLL STRIPS WERE SWALLOWING THE MAP CONTROLS (reported on Mapbox): zoom in, zoom out
  // and fullscreen could not be clicked at all. The strips are 40px wide, full height,
  // pointer-events:auto and z-index:2 — and BOTH engines place their control groups in the very
  // corners the strips cover. Equal z-index means the later element in the DOM wins, and the
  // strips are rendered after the map container, so they sat on top of every control.
  // The strips must keep their pointer events (touch-action:pan-y is the whole affordance — a
  // vertical drag scrolls the page instead of panning the map), so the fix is to lift the controls
  // above them rather than to make the strips inert.
  // ALL FOUR CORNERS, BOTH ENGINES, on purpose: the left strip covers the two left corners exactly
  // as the right one covers the right, a control can be placed in any of them, and naming both
  // prefixes is what makes this survive a provider swap — which is the point of the provider prop.
  '.mapboxgl-ctrl-top-left,.maplibregl-ctrl-top-left,' +
  '.mapboxgl-ctrl-top-right,.maplibregl-ctrl-top-right,' +
  '.mapboxgl-ctrl-bottom-left,.maplibregl-ctrl-bottom-left,' +
  '.mapboxgl-ctrl-bottom-right,.maplibregl-ctrl-bottom-right{ z-index:3; }' +
  // ★ ON A PHONE (the attribution rule, plugin-designer skill §8): the credit stays in the bottom corner, mirrored
  // to bottom-LEFT in RTL (the round ☰ sits bottom-right there), above the scroll-edge strips (z-index 3 over their
  // 2, above), folded by foldCredit(); and MapLibre's optional logo goes, as its licence allows (the credit stays).
  '@media (max-width: 767px){' +
  '  .rcm:dir(rtl) .maplibregl-ctrl-bottom-right, .rcm:dir(rtl) .mapboxgl-ctrl-bottom-right{ right:auto; left:0; }' +
  '  .rcm .maplibregl-ctrl-logo{ display:none !important; }' +
  '}' +
  // ★ NO LIFT FOR THE ROUND ☰ (2026-09-30). This used to translate both bottom corners up by the gallery's
  // --map-fab-clearance whenever the round ☰ rendered. That is right for a map that fills the viewport, whose
  // bottom edge sits under the fixed ☰. It is wrong here: the Regions maps sit in the dashboard's page flow, so
  // at rest their bottom edge is nowhere near the ☰, and the lift parked the MapLibre credit 80-100 px up,
  // mid-map, on a phone. The credit now keeps its engine position in the bottom corner. The full-height maps
  // keep their own clearance in LegendMobile, which this component does not load.
  // ★ THEIR GLOBAL BOX-SIZING RESET, which no scoped style could ever have shown me.
  // app/assets/styles/base/_reset.scss:3-8 is `*, *::before, *::after { box-sizing: border-box }`
  // (a piccalil.li reset) and it applies to every element on their page, the legend swatch
  // included. Our leaf document already carries the same rule -- regions-dashboard/index.html:9 --
  // but this component renders inside a SHADOW ROOT, and a document-level `*` selector does not
  // cross a shadow boundary. So every element in here was content-box while theirs was border-box.
  // MEASURED: their legend swatch is `width:10px; border:1px solid #fff`, which is 10px under
  // border-box and 12px under content-box. Two swatch columns of 1px each are exactly the 2px by
  // which our legend panel measured wider than theirs (167px vs 165px) after the rest of the
  // legend was aligned to the pixel -- and the same string measures 129px in both, in the same
  // Poppins, so the text was never the cause.
  // This is the SEVENTH global rule of theirs found missing, and the reason the codebase had
  // accumulated seven separate per-element `box-sizing:border-box` patches: each one was a local
  // workaround for the reset that never arrived. Scoped to `.rcm` rather than the whole shadow
  // root so it is verified where it is measured; porting it bundle-wide and DELETING those seven
  // patches is carded (BUILD-PORT-THEIR-BOX-SIZING-RESET-TO-THE-SHADOW-ROOT) because it changes
  // geometry in components whose match against live has to be re-measured, not assumed.
  '.rcm{ display:block; position:relative; width:100%; min-height:780px; aspect-ratio:16/9;' +
  '  overflow:hidden; border-radius:inherit; }' +
  '@media (max-width:768px){ .rcm{ min-height:0; aspect-ratio:1/2; } }' +
  // ★ THE CHOOSER IS SQUARE ON MOBILE, AND THIS IS GEOMETRY RATHER THAN TASTE.
  // Their .country-map flips to aspect-ratio 1/2 under 768px and the rule above ports that verbatim
  // -- correct for the CLONE pages, which frame one region or country in portrait. The chooser is
  // a sanctioned addition and renders under the GLOBE projection, so its subject is a
  // CIRCLE whose diameter cannot exceed the frame's short side. In a 1:2 frame that circle covers at
  // most W/2W = 50% of the height: at 390px wide, 390px of globe in a 780px box and the rest empty.
  // A SQUARE is the only frame a circle fills on BOTH axes -- vertical coverage 50% -> 100%, and area
  // fill pi/4 = 78.5%, the maximum a circle can reach in any rectangle. Taller wastes height, wider
  // wastes width. The sanctioned scope is: improve the map's LOOK and add the all-regions map,
  // which must be intuitive. So: chooser ONLY, and the cloned pages
  // above keep their 1/2 untouched.
  '@media (max-width:768px){ .rcm--chooser{ aspect-ratio:1/1; } }' +
  '.rcm__canvas{ position:absolute; inset:0; }' +
  '.rcm__note{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
  '  text-align:center; padding:24px; color:#6d766e; font-size:15.625px; background:#f3f3f1; }' +
  // THEIR key, overlaid bottom-left above the canvas -- CountryMap.vue's .country-map__legend,
  // now copied property-for-property. An earlier comment here called this "one of the sanctioned
  // additions"; that was WRONG and is why it drifted. Their CountryMap.vue carries this legend with
  // these same four entries, so it is a CLONE and every property is theirs to dictate. Caught by
  // looking at the side-by-side Africa crops after the framing fix: our rows sat a few px off and
  // the box read differently. Diffing our block against theirs found six differences, none of which
  // any computed-CSS probe was covering -- font-size 12.5px vs their 12px (a rounded-token artifact
  // of mine, not their scale), colour #2a332a vs their #1f1f1f, and four properties simply missing:
  // the panel's box-shadow, pointer-events:none, and the swatch's display, border and ring.
  // The swatch border is the one with layout consequences: a 10px dot inside a 1px border is 12px
  // tall, so dropping it shortened every row and moved the whole stack -- which is exactly the
  // drift the crop showed.
  // THE ONE DEVIATION, deliberate and documented: inset-inline-start instead of their physical
  // `left`, so the legend sits in the reading-start corner in Arabic. A legend pinned to the
  // physical left in an RTL layout reads as broken regardless of whose design it is.
  '.rcm__legend{ position:absolute; inset-inline-start:10px; bottom:28px; z-index:2; display:flex;' +
  '  flex-direction:column; gap:4px; padding:8px 10px; border-radius:8px;' +
  '  background:rgba(255,255,255,0.92); box-shadow:0 2px 8px rgba(0,0,0,0.15);' +
  '  font-size:12px; font-weight:600; color:#1f1f1f; pointer-events:none; }' +
  '.rcm__legend span{ display:inline-flex; align-items:center; gap:6px; }' +
  // `flex:0 0 auto` used to guard the swatch against shrinking. Their border/ring pair makes the
  // box 12px and theirs does not shrink, so the guard is deleted rather than kept alongside a
  // faithful copy -- deleting a workaround beats adding one. The re-cropped legend is the check.
  '.rcm__legend i{ display:inline-block; width:10px; height:10px; border-radius:100px;' +
  '  border:1px solid #ffffff; box-shadow:0 0 0 1px rgba(0,0,0,0.15); }' +

  // ── THEIR PIN POPUP'S CSS, ported verbatim from CountryMap.vue's scoped block ──────────────
  // Mapbox builds the popup inside the map container, which is inside this shadow root, so these
  // reach it. The var() fallbacks are theirs and resolve to the same bytes here as there:
  // --color-brand is #3b463d and --color-brand-lighter #6d766e on live, identical to the
  // fallbacks, and --color-black is not defined on either side so #1f1f1f applies to both.
  '.mapboxgl-popup-content:has(.cm-popup){ padding:12px; border-radius:10px;' +
  '  box-shadow:0 4px 16px rgba(0,0,0,0.18); }' +
  '.cm-popup{ width:240px; }' +
  '.cm-popup__img{ display:block; width:150px; aspect-ratio:4/5; object-fit:cover;' +
  '  border-radius:8px; margin:0 auto 8px; }' +
  '.cm-popup__body{ padding:0; }' +
  '.cm-popup__name{ font-weight:700; font-size:15px; line-height:1.25;' +
  '  color:var(--color-black, #1f1f1f); }' +
  '.cm-popup__sub{ margin-top:2px; font-size:12px; color:var(--color-brand-lighter, #6d766e); }' +
  '.cm-popup__stats{ margin:8px 0 0; display:flex; flex-direction:column; gap:3px; }' +
  '.cm-popup__stats > div{ display:flex; justify-content:space-between; gap:10px; font-size:12px; }' +
  '.cm-popup__stats dt{ margin:0; color:var(--color-brand-lighter, #6d766e); }' +
  '.cm-popup__stats dd{ margin:0; text-align:end; font-weight:600;' +
  '  color:var(--color-black, #1f1f1f); }' +
  '.cm-popup__desc{ margin:8px 0 0; font-size:12px; line-height:1.45; color:#555;' +
  '  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }' +
  '.cm-popup__actions{ display:flex; gap:6px; margin-top:10px; }' +
  '.cm-popup__btn{ flex:1; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600;' +
  '  text-align:center; text-decoration:none; background:#ecf0f1;' +
  '  color:var(--color-black, #1f1f1f); }' +
  '.cm-popup__btn--primary{ background:var(--color-brand, #3b463d); color:#fff; }',
  'region-country-map'
)
</script>

<template>
  <!-- rcm--chooser is the sanctioned addition's own frame: see the aspect rule in the styles
       below for why a globe needs a square on mobile and the cloned pages must not get one. -->
  <div class="rcm" :class="{ 'rcm--chooser': colorMode === 'region' }">
    <div ref="mapContainer" class="rcm__canvas" />
    <!-- THE SHARED EDGE-SCROLL STRIPS. useEdgeScrollAffordance does NOT create these — it scans
         the wrapper for them (useEdgeScrollAffordance.js:57, `if (!edges.length) return NOOP`),
         so flipping showEdgeBorders alone was a no-op and the probe measured 0 strips. The markup
         and CSS are per-consumer in all five existing users (upg-100-list, doxa-simple-map,
         countries-map, research-map, DashboardMapPanel); only the BEHAVIOUR is shared. Ported
         from my-upg-100-list/upg-100-list.vue:1889 rather than invented. -->
    <div class="map-scroll-edge map-scroll-edge--left" />
    <div class="map-scroll-edge map-scroll-edge--right" />
    <p v-if="mapFailed" class="rcm__note" role="status">{{ t('The map could not start. This is a map-token or connection problem, not a filter — the figures above are unaffected.') }}</p>
    <div v-if="colorMode === 'prayer' && !mapFailed" class="rcm__legend">
      <span><i :style="{ background: C.prayerFull }" />{{ t('100+ People Praying') }}</span>
      <span><i :style="{ background: C.prayerPartial }" />{{ t('1+ People Praying') }}</span>
      <span><i :style="{ background: C.prayerNone }" />{{ t('No One Praying') }}</span>
      <span><i :style="{ background: C.outside }" />{{ t('Outside this region') }}</span>
    </div>
  </div>
</template>
