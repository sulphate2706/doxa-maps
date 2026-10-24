<script setup>
// What this instance put on window, recorded AS IT IS SET so unmount can tell its own values
// from another instance's. Two of these can share a page; clearing by NAME alone would let the
// second unmount delete the first's live hooks.
const ownGlobals = Object.create(null)
function setGlobal(name, value) {
  try { window[name] = value; ownGlobals[name] = value } catch (_) {}
}
/**
 * resources-map.vue — THE GOSPEL RESOURCES GLOBAL MAP.
 *
 * @description 12,379 people-group pins over a country choropleth: tap a pin for the Scripture, audio, film, Bible-story and training links that exist in that group's own language with real URLs, tap a country for every group in it, search by group, language or ISO 639-3 code, and filter to the groups where nothing was found.
 *
 * 12,379 people-group pins over a country choropleth, coloured by what each group has
 * in its OWN language: Scripture and film, something, or nothing found. Tap a pin for
 * the real links; tap a country for every group in it. Search reaches a named group,
 * the key doubles as a filter so the gap can be looked at on its own, and a shared URL
 * reopens the group you were looking at.
 *
 * The country shading is a COUNT of Doxa's groups with nothing found — never a share,
 * because 106 of their 175 countries hold one or two groups and a percentage over that
 * denominator is noise. The dots are individual groups, which is why a dark dot can sit
 * on a light country — that case is the point of the map, not a rendering fault. A
 * country Doxa does not work is left uncoloured, not drawn as covered.
 *
 * Why this map exists: gospel resources had no map of their own, alongside key city posters
 * and cities with internet.
 *
 * MOBILE FIRST, deliberately. Mobile-friendliness was a requirement before this
 * map existed, so it is built that way rather than retrofitted:
 *   - one WebGL context (the ~16-cap rule; this is the app's only map pane)
 *   - tap-to-select with a bottom SHEET, not a hover popup — hover does not exist
 *     on a phone, and a hover-only map is an unusable map
 *   - the legend is a BOUNDED panel (380px, left-anchored), clear of the control
 *     rail on the right. It was a full-width strip; that is what made it collide.
 *   - boundaries FETCHED at runtime (the IIFE inlines every import; 2.7MB of
 *     geojson in the bundle would block first paint)
 *
 * ═══ WHAT THE COLOUR MEANS, AND WHAT IT MUST NOT BE READ AS ═════════════════
 * The band is the share of a country's people groups at TIER 0 — no resource of
 * ANY kind found in any pool checked. It is recomputed from the pin index, so the
 * colour and the dots cannot disagree.
 *
 * This comment was wrong in three ways and is worth correcting precisely, because
 * it is what the next reader trusts: the band is not "no scripture and no film",
 * it is no resource at all; the pools are not "eBible + Arclight" but eBible,
 * PNG.Bible, Arclight, Door43, Faith Comes By Hearing, Scripture Earth, Cru and
 * Global Recordings Network; and GRN is NOT key-blocked — it is reached through
 * their 5fish site, needs no key, and has now been swept in full at the crawl
 * delay their robots.txt asks for. API.Bible, DBL and progress.bible are the ones
 * that still need credentials this build does not have.
 *
 * So a red country is "we found nothing for most of these groups", NOT "nothing
 * exists". That distinction is printed in the legend and repeated in every detail
 * sheet, because a map is exactly where a caveat gets lost.
 *
 * SAFETY: this shades RESOURCE AVAILABILITY per language, aggregated to country.
 * It carries no church, believer or meeting-point data and must never gain any.
 *
 * ═══ TWO MODES, BECAUSE ONE SHADING CANNOT ANSWER BOTH QUESTIONS ════════════════
 * GAP (default) shades what is MISSING; COVERAGE shades what was FOUND. They are
 * not redundant — a country can be mostly-covered by group count while the groups
 * still lacking anything are the large ones, and only flipping the shading shows it.
 * GAP leads because it is the question the corpus was built to answer: where is
 * there no resource to point someone to. Neither mode is "all the resources"
 * though — a choropleth is an average and cannot list anything. The actual
 * resources live in the country sheet below, which lists every group, its language,
 * its ISO 639-3 code and its links, with the link-verification state on each.
 *
 * ═══ JOINING A CLICKED COUNTRY TO ITS PEOPLE GROUPS ═════════════════════════════
 * DO NOT `split(',')` the `countries` field. Country names in this corpus CONTAIN
 * commas — "Micronesia, Federated States of", "Virgin Islands, British" — so a
 * naive split shatters them into fragments ("Micronesia" + "Federated States of")
 * and the row silently lands under a country that does not exist. Instead the names
 * are matched longest-first against the known country vocabulary with comma
 * boundaries. Verified against the corpus's own `country_count`: 0 of 2,106 rows
 * disagree, and the 5-country string above parses to exactly its 5 real names.
 */
import { computed, inject, ref, shallowRef, markRaw, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOptionalT } from '@map/composables/useOptionalT.js'   // vue-i18n stays: two guarded LOCALE reads below
import { formatList } from '@map/i18n/index.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { addMapAttribution } from '@map/composables/useMapAttribution'
import { engineUiLocale } from '@map/composables/useMapInstance.js'

// Map toolbar — canonical modular control rail (MapToolbar slot-wrapper + button
// children). ThemeToggleButton is omitted: this profile's isDark is a read-only
// computed off profile-config with no theme-toggle handler to wire it to.
import MapToolbar       from '@map/components/map-controls/MapToolbar.vue'
import MapInfoButton    from '@map/components/map-controls/MapInfoButton.vue'
import { useEdgeScrollAffordance } from '@map/composables/useEdgeScrollAffordance.js'
import ZoomInButton     from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton    from '@map/components/map-controls/ZoomOutButton.vue'
import LocationButton   from '@map/components/map-controls/LocationButton.vue'
import FullscreenButton from '@map/components/map-controls/FullscreenButton.vue'
import ShareButton      from '@map/components/map-controls/ShareButton.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { resolveMapProvider, providerLabel } from '@map/composables/useMapProvider.js'
import { ensureEngineScript, engineGlobal, engineStylesheetUrl, ensureEngineCSS } from '@map/composables/useMapInstance.js'
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
import { resolveNamedStyle } from '@map/styles/registry.js'

const profileConfig = inject('profileConfig', ref(null))
// EDGE SCROLL AFFORDANCE: the gray side strips that say the page scrolls PAST the map (UPG-100's pattern).
// This map builds its map RAW with new gl.Map, not through useMapInstance, so nothing wired the strips
// for it and a phone had no scroll escape at the map's edges. Flagged per embed, because it is a
// promise: <… edge-scroll-affordance="false"> or config.edgeScrollAffordance switches it off for a map
// with nothing beneath it. Defaults on, as UPG-100's does.
const EDGE_SCROLL_AFFORDANCE = computed(() => {
  const v = profileConfig.value?.edgeScrollAffordance
  return v === undefined || v === null ? true : !(v === false || v === 'false')
})
let detachEdges = null
const isDark = computed(() => profileConfig.value?.isDark === true)
// The token through the library's channel (documentation/reference-universal-props.md): the
// profile-config tk, then ProfileLoader's injected mapboxToken (which carries the page-wide shared
// token, fed by window.MAP_TOKEN), then window.MAP_TOKEN. This read window.DOXA_TOKEN, which only a
// few dev pages set, so in the studio and on every built page the map ignored the page's token.
// Same fix as cities-internet and key-cities (1cf57f7a) — the pattern is copied, not re-invented,
// because three raw maps drifting apart on how they find a token is how this happened.
const injectedTk = inject('mapboxToken', null)
const mapboxToken = computed(() => profileConfig.value?.tk || injectedTk?.value
  || (typeof window !== 'undefined' && window.MAP_TOKEN) || '')

// ── HONOUR THE PROVIDER SWITCH: this profile builds its map RAW ─────────────
// Bundles that go through useMapInstance get the switch for free; this one calls `new gl.Map`
// directly, so it never saw it. MEASURED by sweeping all 16 isMap leaves: at ?provider=maplibre
// this leaf still loaded Mapbox and made 18 requests to api.mapbox.com, identical to its mapbox
// run. Same shape and same fix as cities-internet/connectivity-map and my-upg-100-list; the engine
// loader is IMPORTED from useMapInstance, never a second copy of the ENGINES table.
// No geocoder is mounted here, so the deferred-search-bar rule does not apply to this profile.
const grProvider = resolveMapProvider(profileConfig)
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

const mapEl = ref(null)
// ★ THE LICENCE CREDIT, COMPACT (plugin-designer 5.8, the bottom-of-map standard). The engine's own
// AttributionControl, with geoBoundaries as custom attribution (its licence asks for the name and a link back).
// On a narrow map the engine draws it compact, EXPANDED at first; CREDIT_FOLD_MS after it first shows,
// foldCredit folds it to its (i) the way the engine's own drag does (it drops the -compact-show class), and a
// tap on the (i) opens it again. The style may still be loading when the map is built, so it looks every half
// second, for up to 30 s, and stops once the credit is there and folded, or is full width (not compact).
const GB_CREDIT = '<a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a>'
const CREDIT_FOLD_MS = 3000
let creditTimer = 0
function foldCredit(triesLeft = 60) {
  creditTimer = 0
  const box = mapEl.value
  if (!box) return
  const shown = box.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show, .mapboxgl-ctrl-attrib.mapboxgl-compact-show')
  // The clock starts once the STYLE's own credit has joined geoBoundaries (it arrives with the style's
  // sources), so the first expanded show names the basemap too; measured, the fold otherwise came while
  // only "geoBoundaries" had shown. After 30 s it starts anyway.
  const inner = shown && shown.querySelector('.maplibregl-ctrl-attrib-inner, .mapboxgl-ctrl-attrib-inner')
  const full = !!(inner && inner.textContent.replace('geoBoundaries', '').replace(/[|\s]/g, '').length)
  if (shown && (full || triesLeft <= 0)) {
    creditTimer = setTimeout(() => { creditTimer = 0; shown.classList.remove('maplibregl-compact-show', 'mapboxgl-compact-show') }, CREDIT_FOLD_MS)
    return
  }
  const credit = box.querySelector('.maplibregl-ctrl-attrib, .mapboxgl-ctrl-attrib')
  if (!shown && credit && !/attrib-empty/.test(credit.className)) return
  if (triesLeft > 0) creditTimer = setTimeout(() => foldCredit(triesLeft - 1), 500)
}
function addCompactCredit(map, gl) {
  if (typeof gl?.AttributionControl !== 'function') return false
  try { map.addControl(new gl.AttributionControl({ customAttribution: GB_CREDIT }), 'bottom-right') } catch (_) { return false }
  foldCredit()
  return true
}
const mapRef = shallowRef(null)
const rows = ref([])
const selected = ref(null)
const err = ref(null)

// ─── "What can this map do?" is on its way (Prayer Progress's announcement) ────────────────────
// The control column, with its ⓘ on top, renders only once the map exists, after the data, which can
// take tens of seconds on a slow phone. So at mount this map tells the gallery's MapInfo a control is
// COMING, and MapInfo waits for the map instead of a clock rather than flashing its floating ⓘ first.
// A failure (err) or an unmount before the map exists withdraws it, so the floating ⓘ shows at once.
// A standalone page has no MapInfo: nothing answers and nothing changes.
function announceInfoPending(pending) {
  const el = mapEl.value
  if (!el) return
  try { el.dispatchEvent(new CustomEvent('dxmaps:mapinfo-pending', { bubbles: true, composed: true, detail: { pending } })) } catch (_) {}
}
// A MapInfo that mounts after this map asked into the void announces itself; answer it again.
const reannounceInfoPending = () => { if (!cardMode.value && !mapRef.value && !err.value) announceInfoPending(true) }
watch(err, (e) => { if (e) announceInfoPending(false) })

// ─── On a phone the control column starts BELOW the folded legend ─────────────────────────────────
// The ⓘ is the column's top control, and its one-time pointer runs sideways from it across the map's
// top band, which on a phone is this legend's. MapToolbar's phone rule puts the column at top:72px,
// inside that band, so the pointer lay over the legend's title and buttons. The column now starts 8px
// below the FOLDED legend's measured bottom, whatever its height in each language. Measured only while
// folded, and before the toolbar exists, so opening the legend never moves the controls under the reader's
// thumb (MapInfo would re-place its pointer on its 1.5 s timer, but the controls should not jump). Desktop
// is unchanged.
const legendEl = ref(null)
const toolbarTop = ref(0)
let legendRO = null
function measureLegend() {
  const el = legendEl.value
  if (!el || !narrow.value || legendOpen.value) return
  const b = el.offsetTop + el.offsetHeight
  if (b > 0) toolbarTop.value = b + 8
}
function watchLegend() {
  try { legendRO = new ResizeObserver(measureLegend); if (legendEl.value) legendRO.observe(legendEl.value) } catch (_) { legendRO = null }
  measureLegend()
}

// GAP = what is missing (default). COVERAGE = what was found. See the header note.
const mode = ref('gap')

// Bands, not a continuous ramp: a reader can hold four categories, not a gradient.
/**
 * ═══ THE COLOUR SCALE, AND WHY IT COUNTS INSTEAD OF DIVIDING ════════════════════════════
 *
 * The old ramp painted a country by the SHARE of its groups with nothing found. Measured
 * against Doxa's roster that is not a statistic, it is noise: 106 of their 175 countries
 * hold one or two groups, and the United States holds three — Coquille, Pequots, Umpqua.
 * One of three without a resource is 33%, so the whole United States rendered amber next
 * to India, which holds 855. The map read as "most of the world is in crisis" because of
 * arithmetic, not because of the world. Swapping in a prettier ramp would have kept the
 * lie and made it handsomer.
 *
 * So the scale is a COUNT: how many of Doxa's groups in this country have nothing found.
 * A count cannot be inflated by a small denominator, it is what a team would actually plan
 * around, and it puts India, Sudan and Laos where they belong.
 *
 * OUT OF SCOPE IS NOT ZERO. A country with no Doxa groups gets NO FILL at all. Painting it
 * "green/covered" claimed a finding about a place this dataset says nothing about, which is
 * the same class of error as drawing an unmeasured figure as a zero.
 *
 * THE RAMP. Single family, light to dark, on the house light palette — sage for "every Doxa
 * group here has something", then four steps of clay deepening with the count. No yellow:
 * a mid-spectrum yellow over a pale basemap is what made the old map look jaundiced, and it
 * also carries the least luminance contrast of any hue against #f3f3f1. Sage and clay sit
 * far apart in hue AND in lightness, so the scale survives being read without colour.
 */
const NO_DOXA_FILL = 'rgba(0,0,0,0)'
const BANDS = [
  { id: 'd0',   labelKey: 'gospel.legend.doxa0',   color: '#92b195', min: 0,  max: 0 },
  { id: 'd1',   labelKey: 'gospel.legend.doxa1',   color: '#e8d9cd', min: 1,  max: 4 },
  { id: 'd5',   labelKey: 'gospel.legend.doxa5',   color: '#cfa388', min: 5,  max: 14 },
  { id: 'd15',  labelKey: 'gospel.legend.doxa15',  color: '#b06f57', min: 15, max: 39 },
  { id: 'd40',  labelKey: 'gospel.legend.doxa40',  color: '#7d3b30', min: 40, max: Infinity },
]
/* Coverage mode asks the opposite question over the same roster: how many Doxa groups here
   DO have something. Same count logic, same reason, mirrored ramp. */
const COVER_BANDS = [
  { id: 'c1',   labelKey: 'gospel.legend.cvd1',   color: '#e8d9cd', min: 1,  max: 4 },
  { id: 'c5',   labelKey: 'gospel.legend.cvd5',   color: '#a8c4a9', min: 5,  max: 14 },
  { id: 'c15',  labelKey: 'gospel.legend.cvd15',  color: '#6f9673', min: 15, max: 39 },
  { id: 'c40',  labelKey: 'gospel.legend.cvd40',  color: '#3b463d', min: 40, max: Infinity },
]
const bandFor = (list, n) => list.find((b) => n >= b.min && n <= b.max) || null
/** A country's fill. Null tally = Doxa does not work here = no fill, never a colour. */
const featureColor = (iso3) => {
  const t = doxaByCountry.value[iso3]
  if (!t) return NO_DOXA_FILL
  const n = mode.value === 'gap' ? t.none : t.groups - t.none
  const b = bandFor(mode.value === 'gap' ? BANDS : COVER_BANDS, n)
  return b ? b.color : NO_DOXA_FILL
}
const bandColor = (b) => (BANDS.find((x) => x.id === b) || {}).color || NO_DOXA_FILL

const activeBands = computed(() => (mode.value === 'gap' ? BANDS : COVER_BANDS))

// PIN TIERS ARE THEIR OWN SCALE NOW, and deliberately so. They used to index into BANDS,
// which was safe while both scales measured the same thing. They no longer do: a band is a
// COUNT of Doxa groups in a country, a pin is what ONE group HAS. Indexing a count ramp by
// a tier would have painted "nothing found" in the colour of "1-4 groups" — two different
// facts wearing one colour, which is the disagreement that comment was written to prevent.
/**
 * ═══ THE GAP IS A HOLE IN THE MAP ════════════════════════════════════════════════════════
 *
 * The claim above — "all three sit apart from the clay ramp" — was false for the one that
 * matters. Tier 0 was #7d3b30 and the darkest country fill is #7d3b30: THE SAME COLOUR. So in
 * exactly the countries with 40+ groups having nothing, the pins that matter most dissolved
 * into their own country. Reported from use; confirmed by reading the two tables.
 *
 * Hue alone cannot fix this, because a choropleth and its pins compete for the same range at
 * every zoom. So the states differ in FORM, which survives any background:
 *
 *   nothing found  a HOLE — white centre, thick oxblood rim. Reads as absence, and carries
 *                  both a light and a dark component, so it separates on pale fills and on
 *                  the darkest one. Largest, and drawn on top.
 *   some resource  a solid sage dot
 *   Scripture+film a small solid dark dot, quiet, receding
 *
 * A white under-halo sits beneath every pin as well, so a dot never touches its fill directly.
 * Size carries urgency, form carries state, colour agrees with both: at a glance the map reads
 * as holes where the gospel is not, and the eye goes to them first.
 */
const PIN_COLOR = {
  2: '#3b463d',  // Scripture AND film in their own language
  1: '#92b195',  // one of the two
  0: '#ffffff',  // nothing found — a WHITE CORE, rimmed oxblood by the stroke below
}
const PIN_RIM = {
  2: '#ffffff',
  1: '#ffffff',
  0: '#7d3b30',  // the rim carries the alarm; the hole carries the meaning
}


const byIso = computed(() => {
  const m = {}
  for (const r of rows.value) m[r.iso3] = r
  return m
})

/* ══ PEOPLE-GROUP DETAIL — fetched lazily, on the first country tap ═════════════
 * people-group-resources.json is 1.4MB. Loading it up-front to populate a sheet
 * nobody has opened yet would delay the map's first paint for every visitor. */
const prayIndex = ref({})
const pgReady = ref(false)        // link-verification fetched (the group list comes from pins)
const linkVerify = ref(null)
const pgLoading = ref(false)
const pgErr = ref(null)
const selectedGroup = ref(null)   // set = the people-group detail is showing
// The tap hint (PinHint) goes away on the reader's first pin. It listens for uiStore.selectPeopleGroup,
// which this map never calls: it selects through its own refs. So a country or a people-group selection
// here says so with the event PinHint also hears, from inside this map's root.
watch([selected, selectedGroup], ([c, g]) => {
  if ((c || g) && mapEl.value) mapEl.value.dispatchEvent(new CustomEvent('dxmaps:pin-selected', { bubbles: true, composed: true }))
})
const pinRows = shallowRef([])    // [name, lat, lng, iso3, code, population, tier, slug]
const doxaTotal = ref(0)          // every group on Doxa's roster, placed or not
const doxaUnplaced = ref(0)       // on the roster, no coordinates in this build yet
const doxaByCountry = shallowRef({})
const pinCodes = ref({})
/* SUN — one signed language with Scripture in it, for Deaf groups whose own sign language has
   nothing. Carried in the pin index beside the spoken bridges so the sheet and the access table
   cannot disagree. */
const pinSun = ref(null)
const pinBridges = ref({})        // '<iso639-3>|<ISO3 country>' -> the in-country bridge, if any
/* Declared beside pinBridges. The previous edit USED this ref without declaring it —
   a silent string replace that matched nothing — and the ReferenceError died inside the
   custom-element boundary, so the map simply never mounted and the page reported no error
   at all. Zero errors is not the same as working. */
const pinCandidates = shallowRef({})
const pinCount = ref(0)

// The legend quotes these, so they can never drift from what the layer is drawing.
// PIN FILTER. The map answers "what does this group have" on tap, but it could not answer
// "show me only the ones with nothing" — which is the question the map exists for. Filtering
// the LAYER rather than rebuilding the source: setFilter is a GL-side predicate, so 12,379
// features stay on the GPU and nothing is re-parsed or re-uploaded on a toggle.
// HEARD, NOT READ. The triage a translation team actually runs: a group that can already
// hear the gospel — recorded audio, the JESUS Film, a Bible video, Words of Life — but has
// no TEXT Scripture found in their language. It is the largest actionable set on this map
// and nothing could select it; the tier filter only separates nothing / something / both.
//
// "No text found" is a statement about the pools checked, never about the world, and the
// button says so. Several of the largest entries here — Western Punjabi, Shanghainese,
// Egyptian Arabic — are varieties where a recording exists and a text in THAT variety is
// genuinely contested, which is exactly why the claim has to stay bounded.
/**
 * Was a pool ACTUALLY SEARCHED for this code? The absent-case chips depend on it.
 *
 * The GRN sweep ran against the GAP first — the 1,192 codes with nothing else — and stopped
 * there, so 3,202 codes that already carry a resource have never been asked. The build
 * records that per code: a swept code lists `grn` in checked_pools, an unswept one carries
 * "grn (not yet swept)" in unchecked_pools.
 *
 * A first version of the GRN chip ignored this and told every group "none found at GRN".
 * On German — which certainly does have Words of Life — that was simply false, and it was
 * false in the same way the legend caveat had been an hour earlier: stating a result for a
 * search nobody ran. The data was already right; only the chip was wrong. So the chip asks
 * the data rather than assuming the sweep was universal.
 */
/**
 * Does this country actually HAVE the curated analysis? 72 of 242 do not, and the two †
 * figures were rendering for them regardless — deaths/day fell through `|| 0` and drew a
 * zero. A measurement nobody made must not appear as a measurement of zero.
 */
const hasCurated = computed(
  () => selected.value != null &&
    (selected.value.growing_unreached != null || selected.value.deaths_day != null),
)

const poolSearched = (g, pool) =>
  new RegExp(`(^|,\\s*)${pool}(\\s*,|$)`).test(String(g?.checked_pools || ''))

const hasTextScripture = (c) =>
  !!c.s ||
  !!(c.au && /text/.test(c.au.m || '')) ||
  !!c.se ||
  (c.d || []).some((d) => !/^Open Bible Stories/.test(d.s || ''))
// NEVER a sign language. "Can hear the gospel" is the wrong sentence about a Deaf people
// group, and recorded audio is not the thing they lack or the thing they need — the map
// already suppresses the audio chip and the GRN attach for them for the same reason. This
// filter shipped without the guard and counted 49 sign languages among the 2,289.
const canHear = (c) =>
  c.sg !== 1 &&
  (!!c.ga || !!(c.au && /audio/.test(c.au.m || '')) || !!c.f || !!c.bv)

/**
 * ═══ A PARTNER'S OWN LIST, AS AN ADDRESS ══════════════════════════════════════════════════
 *
 * This map ships Doxa's roster, and the whole point of a public corpus is that OTHER lists can
 * stand on it: a sending church with forty groups, a network with its own hundred. Until now a
 * partner could embed this map and then had to tell their reader to go hunting for their own
 * people in 12,379 dots.
 *
 *     ?codes=ckb,bal,pbu     the map draws only those languages, framed on them
 *     ?country=IND           opens India's sheet, no pin needed
 *     ?view=zero             the groups with nothing (already here)
 *
 * The join is ISO 639-3, the same key everything else here joins on, so a partner's list needs
 * no agreement with ours — only the codes their own data already carries.
 *
 * ⚠ IT FILTERS, IT NEVER INVENTS. A code nobody here has draws nothing; the counter says so,
 * and the reader gets a way back to the whole map. A link that matched none of its codes shows
 * an empty map reading "0 / 12,379", which is the truth about that link — showing the full map
 * instead would tell a partner their broken list works.
 */
/* ═══ TWO NUMBERS THAT WERE TYPED INTO A SENTENCE ═════════════════════════════════════════════
 * The folded explainer says "106 of these 175 countries hold one or two groups" to justify why a
 * country shows a COUNT and never a percentage. Audited today: both were exactly right. They were
 * also typed in, which is how every stale claim I have fixed this flight began — so they are
 * derived from the same pins the map draws, and the sentence cannot outlive the data. */
const countryScale = computed(() => {
  const per = new Map()
  for (const r of pinRows.value) per.set(r[3], (per.get(r[3]) || 0) + 1)
  let small = 0
  for (const n of per.values()) if (n <= 2) small++
  return { countries: per.size, small }
})

/* ═══ THE FIELD CARD: ?card=<slug> ════════════════════════════════════════════════════════════
 * For the catalyst standing with the group on a phone. Seeing ONE group used to cost the engine, the
 * world boundaries, the basemap tiles and the 2.3 MB pin index before a single link appeared. In card
 * mode none of that is fetched: one hash-addressed shard, mean 9 KB, largest 18 KB.
 *
 * The hash is djb2 over the slug, low byte in hex — the SAME function as
 * scripts/build-field-cards.mjs. If either drifts the card 404s loudly rather than serving somebody
 * else's group, which is the only acceptable failure for a shared addressing scheme.
 */
const cardSlug = (() => {
  try { return (new URLSearchParams(window.location.search).get('card') || '').trim().toLowerCase() } catch { return '' }
})()
const cardMode = ref(!!cardSlug)
const cardShard = (slug) => {
  let h = 5381
  for (let i = 0; i < slug.length; i++) h = (((h << 5) + h) ^ slug.charCodeAt(i)) & 0xffffffff
  return ((h >>> 0) & 0xff).toString(16).padStart(2, '0')
}

/* Share what is on screen. navigator.share is the phone path — it opens WhatsApp, Signal, SMS,
   whatever the catalyst already has — and clipboard is the desktop fallback. The URL is built from
   the group's own slug, so what arrives reopens this card and not a search. */
/* WHAT THE READABLE TEXT COVERS, named HERE because naming is a surface job: the builder ships the
   part count FCBH claims and nothing else. 66 and 27 have names a reader knows; any other count is
   reported as itself and never rounded up to a Testament. No count means the scope is unknown, and
   then only the source is named — which is the honest thing to say. */
const sxScope = (sx) => {
  if (!sx) return ''
  const n = Number(sx.parts) || 0
  /* ⚠ THE WORDS ALREADY EXISTED, TRANSLATED. gospel.charts.newTestament and gospel.charts.fullBible
     are in all 11 locales (used by the charts leaf), while the gospel.res.* keys first added here
     existed nowhere, so every locale including Arabic fell back to the English defaults, and even en
     read "full Bible" against the catalogue's "Full Bible". Two keys for one word is drift; these are
     the same words, so they are the same keys. Only the part count needed a new one. */
  const name = n === 66 ? t('gospel.charts.fullBible')
    : n === 27 ? t('gospel.charts.newTestament')
    : n ? t('gospel.res.nParts', { n: fmt(n) })
    : ''
  return name ? `${name} — ${sx.src}` : sx.src
}

const shareState = ref('')
async function shareCard(g) {
  const slug = g && g.slug
  if (!slug) return
  let url = ''
  try {
    const u = new URL(window.location.href)
    u.search = `?card=${encodeURIComponent(slug)}`
    url = u.href
  } catch { return }
  const title = `${g.people_group}${g.language ? ` — ${g.language}` : ''}`
  try {
    if (navigator.share) { await navigator.share({ title, url }); shareState.value = ''; return }
    await navigator.clipboard.writeText(url)
    shareState.value = 'copied'
    setTimeout(() => { shareState.value = '' }, 2500)
  } catch (_) { /* a cancelled share is not an error, and must not look like one */ }
}

const linkCodes = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get('codes') || ''
    return new Set(raw.split(',').map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z]{3}$/.test(c)))
  } catch { return new Set() }
})()
/* ═══ ?groups= — THESE PEOPLES, NOT THE LANGUAGES THEY SPEAK ══════════════════════════════════
 * ?codes= answers "show me these languages", which is what a partner's list usually is. It is the
 * WRONG filter for a list of peoples, and the reach table measured the gap: its Mandarin row counts
 * 36 groups, those 36 speak 30 codes, and 55 Doxa groups speak those 30 — so a ?codes= link from a
 * 36-group row drew 55 pins. The extra groups are real and also have nothing; they simply belong to
 * a different row. Naming the peoples by slug makes the row and the map agree exactly.
 * The slug is doxa.life's own, carried from the roster, so nothing here invents an identifier. */
const linkSlugs = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get('groups') || ''
    return new Set(raw.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean))
  } catch { return new Set() }
})()
const linkActive = ref(linkCodes.size > 0 || linkSlugs.size > 0)
const inLinkList = (r) => (linkSlugs.size ? linkSlugs.has(r[7]) : linkCodes.has(r[4]))
const linkMatched = computed(() => (linkActive.value
  ? pinRows.value.reduce((n, r) => n + (inLinkList(r) ? 1 : 0), 0)
  : 0))

/* THE WAY BACK. A reader who arrives on a partner's embed is looking at somebody else's forty
   groups and has no way to learn that the map holds 12,379 — so the counter is a button, and it
   drops the clause rather than rebuilding the source: `lc` stays baked and simply stops being
   asked about. */
function clearLinkList() {
  if (!linkActive.value) return
  linkActive.value = false
  setPinFilter(pinFilter.value)
  if (mapRef.value) fitToPins(mapRef.value, null)
}

const pinFilter = ref('all')   // all | none | some | both | hnr
function setPinFilter(v) {
  pinFilter.value = v
  const m = mapRef.value
  if (!m || !m.getLayer('gr-pins')) return
  /* Both layers, always. A halo left behind by a filtered-out pin is a ghost dot, and the
     reader has no way to tell it from a real one. */
  /* ONE expression, applied to both layers. Written twice, the halo and the pin would drift
     and a filtered-out pin would leave its halo behind as a ghost dot the reader cannot tell
     from a real one. */
  const base =
    v === 'all' ? null
    : v === 'none' ? ['==', ['get', 'tier'], 0]
    : v === 'some' ? ['==', ['get', 'tier'], 1]
    : v === 'hnr' ? ['==', ['get', 'hnr'], true]
    : ['==', ['get', 'tier'], 2]
  /* The partner's list ANDs with whatever the reader has chosen, rather than replacing it: a
     church embedding their forty groups still gets the gap filter to work inside their forty. */
  const link = linkActive.value ? ['==', ['get', 'lc'], true] : null
  const expr = base && link ? ['all', link, base] : (base || link)
  if (m.getLayer('gr-pins-halo')) m.setFilter('gr-pins-halo', expr)
  m.setFilter('gr-pins', expr)
}

// THE RANKED GAP. "Where is the gap" is answered by the filter; "which gap is biggest"
// is the question that actually picks a field, and nothing answered it — the 3,444 groups
// with nothing were reachable only by tapping dots until you found a large one.
// Sorted by population because a mobiliser choosing where to go is choosing how many
// people are behind the decision, not how many rows are.
// SEARCH. 12,379 dots and no way to reach a named one: finding "Fulani" or "Uzbek" meant
// hunting the map by eye. Matches a people-group name, its language, or its ISO 639-3
// code, because a user arrives with whichever of the three they happen to know.
// SUBSTRING, NOT FUZZY: a fuzzy match over 12,379 rows returns plausible WRONG groups,
// and handing someone the resources for a similarly-named people is the failure this map
// is most careful about everywhere else.
// SHARE A GROUP, NOT JUST THE MAP. Search made a group findable; nothing made it
// sendable — a colleague could be pointed at the map but not at the Fulani group you
// just found. The share URL now carries the selection.
//
// KEYED ON code+country+name, NEVER on the pin INDEX. The index shifts every time the
// pin table is rebuilt, so an index-based link would silently open a DIFFERENT people
// group after the next data refresh — a link that rots into a wrong answer is worse than
// one that breaks. These three are stable identifiers and are matched exactly.
//
// The query rides on embedPath rather than teaching ShareButton about parameters:
// that component has other consumers and none of them need this.
const BASE_EMBED = 'gospel-resources/resources-map/index.html'
const shareEmbedPath = computed(() => {
  const g = selectedGroup.value
  if (!g || !g.iso639_3) return BASE_EMBED
  const p = new URLSearchParams({ code: g.iso639_3, country: g.countries || '', name: g.people_group || '' })
  return `${BASE_EMBED}?${p.toString()}`
})

// Reopen what a shared link names. Runs once the pins are in hand, because resolving a
// group needs the table the link refers to.
function openFromUrl() {
  let sp
  try { sp = new URLSearchParams(window.location.search) } catch { return }
  /* ═══ ONE LINK INTO THE ZERO-ACCESS VIEW ══════════════════════════════════════════════
   * The list of groups with nothing already existed and could only be reached by knowing which
   * control to press. It is the question this map is for, so it gets an address: ?view=zero
   * opens it with the map already filtered to those pins. That address is also what a partner
   * embeds and what a QR code on a noticeboard points at. */
  const view = (sp.get('view') || '').trim().toLowerCase()
  if (view === 'zero' || view === 'gap') { setPinFilter('none'); openGapList() }
  const code = (sp.get('code') || '').trim()
  const country = (sp.get('country') || '').trim()
  /* ⚠ A COUNTRY IS AN ADDRESS TOO, and it was not one: ?country=IND did nothing at all unless a
     ?code came with it, because country was only ever a tie-breaker between two pins sharing a
     language. The second requirement — click a country, see its resources — had no URL,
     which is precisely what a partner embeds. Accepts the ISO3 or the country's own name. */
  if (!code && country) {
    const key = country.toUpperCase()
    const iso = byIso.value[key] ? key
      : Object.keys(byIso.value).find((k) => String(byIso.value[k]?.country || '').toLowerCase() === country.toLowerCase())
    if (iso) {
      openCountry(iso)
      const map0 = mapRef.value
      if (map0) fitToPins(map0, (r) => r[3] === iso)
    }
    return
  }
  if (!code) return
  const name = (sp.get('name') || '').trim()
  let best = -1
  for (let i = 0; i < pinRows.value.length; i++) {
    const r = pinRows.value[i]
    if (r[4] !== code) continue
    // exact name+country wins; code+country next; code alone last.
    if (name && r[0] === name && (!country || byIso.value[r[3]]?.country === country || r[3] === country)) { best = i; break }
    if (best < 0) best = i
  }
  if (best < 0) return
  const r = pinRows.value[best]
  const map = mapRef.value
  if (map) map.flyTo({ center: [r[2], r[1]], zoom: Math.max(map.getZoom(), 4.2), duration: 0 })
  openPin(best)
}

// LEGEND COLLAPSE, NARROW SCREENS ONLY. MEASURED at 390x844: the legend rendered 469px
// tall over a 675px map — 69% of the map hidden behind its own explanation, and the search
// box added this flight made it worse. Everything in it earns its place on a desktop, where
// it is 290px of a 900px map; on a phone the prose has to fold.
// Search and the Gap/Resources toggle stay visible, because they are the two controls a
// reader touches. The key and the caveats fold behind one button — folded, not deleted:
// "a red dot can sit on a green country" is the thing that stops a correct map reading as
// a bug, so it stays one tap away rather than being dropped on small screens.
const narrow = ref(false)
// ONE state for both widths. It used to govern the mobile sheet only — every section read
// `!narrow || legendOpen`, so on desktop the legend was always open and there was no way to
// shut it. Now `legendOpen` alone decides, and desktop gets the same collapse control mobile
// has always had.
const legendOpen = ref(true)
// Remembered for the SESSION, not forever: a reader who collapses the legend to see the map
// wants it to stay collapsed while they work, and wants a fresh visit to start from the
// designed state rather than from a decision they made once and forgot. sessionStorage is
// exactly that lifetime. Wrapped because a sandboxed or storage-blocked embed throws on
// access, and a legend that cannot remember is far better than a map that will not load.
const LEGEND_KEY = 'gm.legendOpen'
function rememberLegend(v) {
  try { window.sessionStorage?.setItem(LEGEND_KEY, v ? '1' : '0') } catch (_) {}
}
function recallLegend() {
  try { const v = window.sessionStorage?.getItem(LEGEND_KEY); return v == null ? null : v === '1' }
  catch (_) { return null }
}
function toggleLegend() { legendOpen.value = !legendOpen.value; rememberLegend(legendOpen.value) }
function syncNarrow() {
  const n = typeof window !== 'undefined' && window.innerWidth < 700
  if (n === narrow.value) return
  narrow.value = n
  // A remembered choice wins over the width default. Without this, dragging a window across
  // the breakpoint would silently reopen a legend the reader had deliberately closed — the
  // resize would be undoing their decision rather than responding to it.
  const remembered = recallLegend()
  legendOpen.value = remembered == null ? !n : remembered
}
if (typeof window !== 'undefined') {
  syncNarrow()
  window.addEventListener('resize', syncNarrow)
}

const q = ref('')
const matches = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (needle.length < 2) return []
  const out = []
  for (let i = 0; i < pinRows.value.length && out.length < 200; i++) {
    const r = pinRows.value[i]
    const lang = pinCodes.value[r[4]]?.l || ''
    if (r[0].toLowerCase().includes(needle) ||
        lang.toLowerCase().includes(needle) ||
        r[4].toLowerCase() === needle) {
      out.push({ i, name: r[0], lang, iso3: r[3], code: r[4], pop: r[5], tier: r[6] })
    }
  }
  // Largest first: a name like "Fulani" matches dozens of groups and the biggest is the
  // one most likely meant.
  return out.sort((x, y) => y.pop - x.pop)
})
function gotoMatch(m) {
  const r = pinRows.value[m.i]
  const map = mapRef.value
  if (map && r) map.flyTo({ center: [r[2], r[1]], zoom: Math.max(map.getZoom(), 4.2), duration: 900 })
  q.value = ''
  showGapList.value = false
  openPin(m.i)
}

const showGapList = ref(false)
const gapPeople = computed(() => {
  let n = 0
  for (const r of pinRows.value) if (r[6] === 0) n += r[5] || 0
  return n
})
const gapList = computed(() => {
  if (!showGapList.value) return []
  const out = []
  for (let i = 0; i < pinRows.value.length; i++) {
    const r = pinRows.value[i]
    // `rel` is carried into the row because this list is the thing that gets read
    // top-down, and its top two entries are exactly the varieties that need the caveat.
    /* THE WAY IN TRAVELS WITH THE ROW. This list is the one a mobiliser reads top-down, and it
       was the only place showing groups with nothing that did not say what to do about them —
       the country panel and the pin sheet both do. Same rule as those, not a second copy. */
    if (r[6] === 0) out.push({ i, name: r[0], lat: r[1], lng: r[2], iso3: r[3], code: r[4], pop: r[5],
      rel: pinCodes.value[r[4]]?.rel || null, wayIn: wayInBetween(r[4], r[3], r[0]) })
  }
  out.sort((a, b) => b.pop - a.pop)
  return out.slice(0, 40)
})
// WHERE, not just WHO. The ranked group list answers "which single group is largest";
// a mobiliser also asks "where would a team go", and the answer concentrates hard: the
// top 10 countries hold 56.6% of all 2,901 groups with nothing.
// Both axes are shown because they disagree, and the disagreement is the useful part —
// Papua New Guinea has 469 groups with nothing but only 2.2M people, China has 125 groups
// and 150.3M. Ranking by either one alone hides the other question.
const gapBy = ref('groups')
// THE SHARPEST INTERSECTION THIS DATA HOLDS: no gospel resource found in any pool checked,
// AND nobody praying. 213 people groups, 4.67M people. Every other view here ends at "this
// group has nothing"; this one ends at a page where the reader can do something about it,
// which is why the rows are links rather than fly-to buttons.
//
// "NOBODY PRAYING" MEANS ZERO ON DOXA.LIFE'S COUNTER. It is not a claim that nobody in the
// world prays for these people — an unknowable thing — and the sheet says so rather than
// letting the number imply it.
// THE SAME SET THE MAP FILTER SELECTS, RANKED. The filter answers "who"; a list answers
// "which of them first", and 2,289 dots cannot be read top-down. Same treatment as the
// nothing-found list: largest population first, because that is what a team choosing a
// field is actually weighing. What each group DOES have is carried onto the row, so the
// reader can see whether they are being sent to a recording or a film before they go.
// WHAT THE GAP NUMBER IS MADE OF. "1,913 groups have nothing" is four different
// situations wearing one number, and they call for four different responses:
//   - a private-use code (qaa-qtz) or no code at all: NO pool can index them, so this is a
//     cataloguing problem and no amount of searching will move it;
//   - a sign language: the pools that would hold signed Scripture are key-gated, so this is
//     an access problem — 136 groups and fifty million people sit here;
//   - a code GRN has not reached yet: this bucket is now EMPTY — the sweep finished — but the
//     branch stays, because the next pool swept a batch at a time will need it again;
//   - everything else: every pool this build can reach was checked and found nothing. That
//     last line is the real translation gap, and it is the only one of the four that a
//     translator rather than an administrator can close.
// Computed from the pins and the per-code `checked` line, never from a typed number.
// How many of the four situations actually have rows today. The sweep empties one of them
// on completion, and a sentence reading "Four different situations" beside a line saying
// "0 groups — GRN has not been swept for them yet" would be two lies at once: the count and
// the implication that some remain.
const gapKindsPresent = computed(() => {
  const m = gapMakeup.value
  return [m.searched, m.pending, m.sign, m.priv + m.noCode].filter((n) => n > 0).length
})
const WORDS = ['no', 'One', 'Two', 'Three', 'Four']
const gapKindsWord = computed(() => WORDS[gapKindsPresent.value] || String(gapKindsPresent.value))

const gapMakeup = computed(() => {
  const m = { noCode: 0, priv: 0, signPriv: 0, sign: 0, pending: 0, searched: 0,
              noCodeP: 0, privP: 0, signPrivP: 0, signP: 0, pendingP: 0, searchedP: 0 }
  for (const r of pinRows.value) {
    if (r[6] !== 0) continue
    const code = r[4]
    const c = pinCodes.value[code] || {}
    const pop = r[5] || 0
    if (!code) { m.noCode++; m.noCodeP += pop; continue }
    // SIGN LANGUAGE IS TESTED FIRST, and the order is the whole point. Every private-use
    // code in this gap is also a sign language, so testing private-use first split one
    // population across two lines and understated the Deaf share by 47 groups. Being Deaf
    // is the more actionable fact about these rows than the shape of their code, and the
    // exported gaps table classifies them the same way — the two must not disagree.
    if (c.sg === 1) {
      m.sign++; m.signP += pop
      if (/^q[a-t][a-z]$/.test(code)) { m.signPriv++; m.signPrivP += pop }
      continue
    }
    if (/^q[a-t][a-z]$/.test(code)) { m.priv++; m.privP += pop; continue }
    if (!/\bgrn\b/.test(c.ck || '')) { m.pending++; m.pendingP += pop; continue }
    m.searched++; m.searchedP += pop
  }
  return m
})

const gapHnr = computed(() => {
  if (!showGapList.value) return []
  const out = []
  for (let i = 0; i < pinRows.value.length; i++) {
    const r = pinRows.value[i]
    if (r[6] === 0) continue
    const c = pinCodes.value[r[4]]
    if (!c || !canHear(c) || hasTextScripture(c)) continue
    const has = []
    if (c.ga) has.push('gospel audio')
    if (c.au && /audio/.test(c.au.m || '')) has.push('audio Scripture')
    if (c.f) has.push('the JESUS Film')
    if (c.bv) has.push('Bible video')
    // CONJUNCTION: the group HAS all of these. It renders into gospel.gap.hasNoText, whose ar message
    // is "لديها {what} — لا يوجد نص", so an English comma was printing inside Arabic prose.
    out.push({ i, name: r[0], lat: r[1], lng: r[2], iso3: r[3], code: r[4], pop: r[5], has: formatList(has, { type: 'conjunction' }) })
  }
  return out.sort((a, b) => b.pop - a.pop).slice(0, 40)
})

const gapNoPrayer = computed(() => {
  if (!showGapList.value) return []
  const out = []
  for (let i = 0; i < pinRows.value.length; i++) {
    const r = pinRows.value[i]
    if (r[6] !== 0) continue
    const e = prayIndex.value[prayKey(r[0], r[3])]
    if (!e || e.praying > 0) continue
    out.push({ i, name: r[0], iso3: r[3], code: r[4], pop: r[5], url: e.u })
  }
  return out.sort((a, b) => b.pop - a.pop).slice(0, 40)
})

// A THIRD AXIS: the RATE. The country tab ranks by how many groups a country holds and
// shows population beside it; neither answers "what share of this place is unreached".
// Measured, the three disagree completely and each is somebody's question:
//   Oceania  51.2% of its groups have nothing — the worst rate anywhere — but 3.1M people
//   Asia     19.3%, and 198.7M people with nothing — by far the largest population
//   Africa   30.0%, 923 groups — the most after Asia
// Ranked by rate here, because count and population are already answered by the other two
// tabs and a third copy of either would be noise.
const gapRegions = computed(() => {
  if (!showGapList.value) return []
  const by = {}
  for (const r of pinRows.value) {
    const reg = byIso.value[r[3]]?.region || ''
    if (!reg) continue
    const e = (by[reg] = by[reg] || { region: reg, groups: 0, none: 0, pop: 0 })
    e.groups++
    if (r[6] === 0) { e.none++; e.pop += r[5] || 0 }
  }
  return Object.values(by)
    .map((e) => ({ ...e, pct: e.groups ? Math.round((1000 * e.none) / e.groups) / 10 : 0 }))
    .sort((a, b) => b.pct - a.pct)
})

const gapCountries = computed(() => {
  if (!showGapList.value) return []
  const by = {}
  for (const r of pinRows.value) {
    if (r[6] !== 0) continue
    const e = (by[r[3]] = by[r[3]] || { iso3: r[3], groups: 0, pop: 0 })
    e.groups++
    e.pop += r[5] || 0
  }
  return Object.values(by)
    .map((e) => ({ ...e, country: byIso.value[e.iso3]?.country || e.iso3 }))
    .sort((a, b) => b.groups - a.groups)
    .slice(0, 40)
})

function openGapList() {
  // The prayer index is fetched lazily and the "Nobody praying" tab is built from it, so
  // opening this list without having first clicked a pin left the tab hidden entirely —
  // the view existed and was unreachable unless you happened to take the long way round.
  ensurePeopleGroups()
  showGapList.value = true
  selected.value = null
  selectedGroup.value = null
}
function closeGapList() { showGapList.value = false }
// Fly first, THEN open: openPin sets `selected`, which swaps the sheet away from this list,
// so doing it the other way round loses the map movement behind a re-render.
function gotoGap(g) {
  const m = mapRef.value
  if (m) m.flyTo({ center: [g.lng, g.lat], zoom: Math.max(m.getZoom(), 4.2), duration: 900 })
  showGapList.value = false
  openPin(g.i)
}

// Counted, not typed. The same rule as the legend's tallies: a number written into copy
// is wrong the first time the data moves, and this one sits inside a claim about a group
// of people.
const signTally = computed(() => {
  let codesSeen = new Set(), people = 0, both = 0
  for (const r of pinRows.value) {
    if (pinCodes.value[r[4]]?.sg !== 1) continue
    codesSeen.add(r[4]); people += r[5] || 0
    if (r[6] === 2) both++
  }
  return { langs: codesSeen.size, people, both }
})

const pinTally = computed(() => {
  const t = [0, 0, 0]
  let hnr = 0
  /* How many of the groups with NOTHING have somewhere to start anyway — a curated bridge, a
     language their country actually speaks, or SUN for a Deaf group. Counted in the same pass
     as the tiers, from the same rows, so the two numbers cannot drift apart. */
  let wayIn = 0
  for (const r of pinRows.value) {
    t[r[6]]++
    const c = pinCodes.value[r[4]]
    if (r[6] !== 0 && c && canHear(c) && !hasTextScripture(c)) hnr++
    if (r[6] === 0) {
      const key = `${r[4]}|${r[3]}`
      if (pinBridges.value[key] || pinCandidates.value[key] || (c && c.sg === 1 && pinSun.value)) wayIn++
    }
  }
  return { none: t[0], partial: t[1], both: t[2], hnr, linked: t[1] + t[2], total: pinRows.value.length, wayIn }
})

async function ensurePeopleGroups() {
  if (pgReady.value || pgLoading.value) return
  pgLoading.value = true; pgErr.value = null
  try {
    // people-group-resources.json is NO LONGER fetched: the country list is built from
    // the pins, which are already in memory and carry richer resource data than that
    // 1.4MB file. Only the link verification remains, and it is allowed to fail —
    // without it every link falls back to "unchecked", which is the honest state rather
    // than a broken UI.
    // Prayer links, keyed by (group name, country) rather than by language — see
    // scripts/fetch-pray-index.mjs for why this one join is not by ISO code.
    const pr = await fetch(`${assetsBase.value}/tables/pray-index.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    prayIndex.value = pr?.byKey || {}
    const lv = await fetch(`${assetsBase.value}/tables/gospel-link-verification.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    linkVerify.value = lv?.links || {}
    pgReady.value = true
  } catch (e) { pgErr.value = String(e.message || e) }
  finally { pgLoading.value = false }
}

// Longest-first so "Micronesia, Federated States of" is consumed before a bare
// "Micronesia" could ever match part of it. See the header note.
// ── THE COUNTRY LIST IS BUILT FROM THE PINS ──────────────────────────────────────
// It used to be built from people-group-resources.json, a curated 2,106-record subset,
// while the MAP draws 12,379 pins. The two described different universes and the sheet
// silently undercounted: MEASURED before this change — Indonesia 36 rows against 669
// pins, Nigeria 38 against 433, India 899 against 2,146. Tapping a country and being
// told it has 36 people groups while 669 dots sit under your finger is the map
// contradicting itself.
//
// Matching was also done by PARSING a comma-separated country-name string against a
// longest-first vocabulary, which is a second way to lose rows — a name that does not
// match the vocabulary exactly drops out silently. Pins carry ISO3, so the index is an
// exact key rather than a text search.
//
// This also retires the 1.4MB people-group-resources.json fetch: the pins are already in
// memory and now carry richer resource data than that file ever did.
const pinsByIso = computed(() => {
  const m = {}
  for (let i = 0; i < pinRows.value.length; i++) {
    const r = pinRows.value[i]
    ;(m[r[3]] ||= []).push(i)
  }
  return m
})

// One shape for the sheet, whether a group arrived by pin tap, country list or
// same-language list. Divergent shapes here are how a field renders blank in one path
// and fine in another.
// Same normalisation the index was built with. Kept beside groupAt so the two cannot
// drift: a key built differently here would silently match nothing.
// Their directory names are file-format shorthand; a worker reading the sheet should see
// what they can actually open, not the folder name.
/**
 * SHORT LABELS ARE TRANSLATED; THE EXPLANATORY PROSE IS NOT, AND THAT IS A DECISION.
 *
 * Every string on this surface used to be hard-coded English, so the map rendered identical
 * English under ?lang=ar, zh, ru and hi — measured, 3,018 words either way and not one
 * non-Latin character. The chrome a reader navigates by is now translated in all eleven
 * locales from library/i18n/locales/<lc>/gospel.json.
 *
 * The prose is deliberately left in English and marked dir="ltr" where it sits. It carries
 * doctrinal and statistical precision — which pools were searched, what "nothing found" does
 * and does not claim, why Open Bible Stories is not Scripture — and a machine-translated
 * caveat would read as authoritative while being wrong. gospel.prose.english is the one
 * translated line that tells the reader, in their own language, that the notes are English.
 * It stays extractable: when a human-reviewed translation exists it gets its own area file
 * and that line comes out.
 *
 * i18n IS OPTIONAL. useI18n() throws when the host never called app.use(i18n), and this
 * bundle is embeddable in pages that have not — the same failure that blanked a production
 * plugin from an unguarded call in FilterDropdown. English is the fallback, never a blank.
 */
/* The fallback resolves against the SHIPPED ENGLISH CATALOG (imported at the top), not the
   key. Returning the last dot-segment would have put "gap" and "deathsDay" on screen — a
   broken-looking label is not graceful degradation, it just moves the bug. */
/* Walks from the ROOT of the catalogue, not from its gospel subtree: this leaf now also reads
   `pins.*`, the shared people-group-pin wording, and an area-blind lookup would have fallen back
   to the key name for every one of those on a host with no i18n. */
/* The fallback interpolates too. vue-i18n does it for the translated path; without this the
   English arm would render "{names} — {n} groups share…" literally. */
const fill = (str, params) => (params
  ? String(str).replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])))
  : str)
// C4 wave 3a, RE-CUT on main 4d18a6f3. ★ NO NAMESPACE, and that is the whole point of the re-cut.
// This leaf passes FULL keys in TWO areas -- gospel.* and pins.* (the shared people-group-pin
// wording) -- and enLookup above deliberately walks from the catalogue ROOT to see both. An earlier
// version of this migration used useOptionalT('gospel', ...), whose qualify() would have turned
// pins.approximate into gospel.pins.approximate on the translated path and sent the fallback looking
// under EN_MESSAGES.gospel, where pins.* does not exist. studio caught it as a SEMANTIC conflict
// before it landed; passing '' keeps every key exactly as the caller wrote it.
// C4 wave 3a, the plugin owner's call (2026-09-26): take the LOCALE-HONOURING fallback. Their reason is
// the bundle's purpose -- most partners drop an element or an iframe and never install vue-i18n, so
// those hosts got enLookup's ENGLISH while the bundle already shipped all 11 catalogues. "That is a
// bug, not a decision." tStatic honours the runtime locale and keeps English as the LAST resort.
// ★ NO NAMESPACE: this leaf passes FULL keys in two areas (gospel.* and pins.*), so any prefixing
// would ask for gospel.pins.approximate, which no catalogue has. studio caught that before it landed.
const t = useOptionalT('')
/* Whether to show the "these notes are in English" line at all. Read from the same i18n
   instance the labels come from, so the two can never disagree. */
const isEnglish = (() => {
  try { return String(useI18n().locale.value || 'en').split('-')[0] === 'en' } catch { return true }
})()
/* The reader's language as a bare tag, for the ENGINE's own control labels. Read the same way
   isEnglish is, so the engine's chrome and ours can never disagree about who is reading. */
const readerLang = () => {
  try { return String(useI18n().locale.value || 'en') } catch { return 'en' }
}
/* tOr() IS GONE, and what it hid is worth recording. It rendered English while a key was in
   flight, and all eleven keys it guarded have landed — each compared against the catalogue one by
   one rather than assumed. Ten were identical. The eleventh was not: gospel.sheet.share held my
   inline "Share this card" against the catalogue's "Share", which is translated in eleven locales
   where my phrase was not, so the catalogue wins and that button now reads Share. Deleting a
   fallback silently changes what a reader sees, so this one was measured before it was deleted. */

const SE_KIND = { PDF: 'PDF', audio: 'audio', sab: 'app', study: 'study notes', viewer: 'read online' }
// CONJUNCTION: Scripture Earth holds all of these kinds for the language, and they render beside a
// keyed label at the pin sheet, so the separator is read by the same reader as the label.
const seKinds = (k) => formatList((Array.isArray(k) ? k : []).map((x) => SE_KIND[x] || x), { type: 'conjunction' })

const prayKey = (name, iso3) =>
  `${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(iso3 || '').toUpperCase()}`

// COMPUTED, not baked into groupAt. The index is fetched lazily, and groupAt runs the
// moment a pin is clicked — so a value read there is whatever had arrived by then, and
// never updates when the fetch lands. Measured: the control did not render at all, because
// the first click always beats the request. The same shape of bug as the link-verification
// state that hung off openPin's country branch.
const selectedPray = computed(() => {
  const g = selectedGroup.value
  if (!g) return null
  return prayIndex.value[prayKey(g.people_group, g._iso3 || '')] || null
})

/* ═══ ONE NORMALIZER, TWO ENTRY POINTS ════════════════════════════════════════════════════════
 * The field card used to be built field-by-field in scripts/build-field-cards.mjs, mirroring this
 * function by hand. It missed `door43`, which exists only here, and the sheet's
 * `!selectedGroup.door43.length` threw on undefined — a blank card for every slug, twice reported
 * as fixed. Two code paths producing "the same" object is the bug; the count of missing fields was
 * only ever the symptom.
 *
 * So the shard now ships the SAME RAW INPUTS the map has — the pin row, the code record, the
 * country name and the two bridge records — and this function normalizes both paths. A field added
 * here reaches the card with no second edit, and one that is forgotten is impossible.
 */
function groupFrom(r, c, country, bridge, bridgeCandidate, i) {
  if (!r) return null
  c = c || {}
  return {
    _i: i,
    slug: r[7] || '',
    // The tier the pin index computed, carried so no consumer re-derives "has anything".
    _tier: r[6],
    people_group: r[0],
    language: c.l || '',
    iso639_3: r[4] || '',
    population: r[5],
    countries: country || r[3],
    _iso3: r[3] || '',
    lat: r[1], lng: r[2],
    scripture_url: c.s || '',
    film_url: c.f || '',
    /* Empty except where the JESUS component does not carry this language and another
       JESUS Film Project feature does. See gospel-resource-rows.js — the chip must say
       which film it is, not which film we usually mean. */
    film_title: c.fT || '',
    has_audio: c.a === 1 ? true : c.a === 0 ? false : 'unknown',
    has_open_bible_stories: !!c.o,
    door43: Array.isArray(c.d) ? c.d : [],
    checked_pools: c.ck || '',
    unchecked_pools: c.un || '',
    is_sign: isDeafGroup(r[4], r[0]),
    audio: c.au || null,
    bible_video: c.bv || null,
    gospel_tract: c.gp || null,
    scripture_earth: c.se || null,
    gospel_audio: c.ga || null,
    bridge: bridge || null,
    bridge_candidate: bridgeCandidate || null,
    related: c.rel || null,
    zume_url: c.z || '',
    zume_approx: c.za || null,
    scripture_title: c.sv || '',
    credit: c.cr || null,
    sx: c.sx || null,
    scripture_scope: c.ss || '',
    code_note: r[4] ? '' : 'This group has no ISO 639-3 code in the source, so no resource lookup is possible for it.',
  }
}

function groupAt(i) {
  const r = pinRows.value[i]
  if (!r) return null
  return groupFrom(r, pinCodes.value[r[4]], byIso.value[r[3]]?.country,
    pinBridges.value[`${r[4]}|${r[3]}`], pinCandidates.value[`${r[4]}|${r[3]}`], i)
}

// EVERY medium counts, not just the two this started with. While it read only
// scripture/film/door43, 559 people groups covering 61M people were filed under "No
// resource found" in the country view while their own pin sheet showed a live audio
// Scripture link — one map contradicting itself depending on which way you opened it.
// READ THE TIER. This listed the resource fields by hand and went stale every time a source
// was added — the FOURTH time this shape has appeared in this bundle. Measured before the
// fix: 729 groups, 77.9 million people, were filed under "no resources found" in the country
// sheet while the pin sheet offered them a working link, because Scripture Earth and GRN
// were missing from the list. The pin index already decides this and a gate guards it.
const hasAny = (r) => r._tier !== 0

// Resources first — a standing decision, not a default — then largest population inside
// each block.
const groupsForCountry = computed(() => {
  const idx = pinsByIso.value[selected.value?.iso3] || []
  const list = idx.map(groupAt).filter(Boolean)
  return list.sort((a, b) =>
    (hasAny(b) ? 1 : 0) - (hasAny(a) ? 1 : 0) || (b.population || 0) - (a.population || 0))
})
const withResources = computed(() => groupsForCountry.value.filter(hasAny))
const withoutResources = computed(() => groupsForCountry.value.filter((r) => !hasAny(r)))

/**
 * ═══ THE COUNTRY'S GAP LIST SHOULD SAY WHERE TO START ═════════════════════════════════════
 *
 * The rows under "No resource found" carried a name, a language and a population, and nothing
 * else — so the one thing a mobiliser opened the country for, "what do I do about these?",
 * took one click per group. 369 of the 370 groups with nothing now have a way in, and it was
 * reachable only by opening each pin in turn.
 *
 * TEXT, NOT A LINK, and structurally it could not be otherwise: these rows are <button>
 * drill-ins and HTML forbids an anchor inside a button — the parser hoists it out and it stops
 * being a link, which is why the rows that DO have resources are plain containers instead. The
 * row opens the group sheet, and the sheet carries the bridge's real links.
 *
 * It names the bridge and nothing more. Saying "Bambara" here does not claim Bambara reaches
 * this group — that is the local question the sheet spells out — but it does turn a list of
 * dead ends into a list with a first move against each one.
 */
/**
 * ═══ ONE DEAF TEST FOR THIS LEAF, MATCHING BOTH BUILDERS ══════════════════════════════════
 *
 * `sg` comes from the sign-language catalogues and a sign language absent from them never gets
 * it: codes.asf (Auslan) carries none. Reading sg alone, this leaf missed Cocos Deaf, Deaf
 * Christmas Islanders and Deaf Norfolk Islanders — their pin sheet offered no SUN panel and the
 * zero-access list showed them with no way in, while the access table gave all three SUN.
 * Third time this exact flag has under-reported: the pins builder and the access builder were
 * both corrected the same way. Same three signals here, so the four surfaces agree.
 */
/**
 * ═══ WHAT A DOT IS, AND WHAT IT IS NOT ════════════════════════════════════════════════════
 *
 * A pin is a locality marker for a PEOPLE, not the location of a settlement, and the data says
 * so if you look at it. MEASURED over the 2,107 placed groups: 2,048 distinct coordinates, so
 * 49 coordinates carry more than one group and 108 groups sit on a point they share with
 * another — 41 pairs, 6 triples and 2 quadruples. Four groups share 12.843781, 75.247906 in
 * coastal Karnataka; four more share a second point a few kilometres away.
 *
 * The coordinates also carry FALSE PRECISION: 1,274 of them are given to six decimal places,
 * which is metre resolution on a point that is only approximate (locations are generalised). Rendering that
 * without comment invites a reader to treat a dot as an address.
 *
 * So the sheet says what the dot is, and where a point is shared it says how many share it.
 * "Approximate" alone is not the honest word — it hides that some dots are literally the same
 * dot, which is the part a reader would otherwise never discover.
 */
const sharedPoints = computed(() => {
  const at = {}
  for (const r of pinRows.value) {
    const k = `${r[1]},${r[2]}`
    ;(at[k] = at[k] || []).push(r[0])
  }
  return at
})
const sharedWith = (g) => {
  if (!g || g.lat == null || g.lng == null) return []
  const names = sharedPoints.value[`${g.lat},${g.lng}`] || []
  return names.filter((n) => n !== g.people_group)
}

const isDeafGroup = (code, name) => {
  const c = pinCodes.value[code]
  return (c && c.sg === 1) || /sign language/i.test((c && c.l) || '') || /\bDeaf\b/i.test(name || '')
}

/* Keyed on an explicit code+country so BOTH callers use one rule: the country panel passes the
   selected country, the global zero-access list passes each row's own. Two copies of this test is
   how the map once offered Deaf groups a spoken bridge while the table refused it. */
const wayInBetween = (code, iso3, name) => {
  if (!code || !iso3) return ''
  if (isDeafGroup(code, name)) return pinSun.value ? 'SUN (signed)' : ''
  const key = `${code}|${iso3}`
  const b = pinBridges.value[key] || pinCandidates.value[key]
  if (!b) return ''
  /* Say whether the TRAINING is there too, not only the Scripture. A mobiliser scanning a
     country's gap list is deciding where to start, and "there is a way in AND the discipleship
     course exists in it" is a different proposition from "there is a way in". MEASURED: 182 of
     the 369 groups with nothing have a bridge that carries Zume, so this is the common case,
     not a footnote. The bridge's own name stays first, because the language is the decision and
     the training is what makes it actionable. */
  const bc = pinCodes.value[b.c]
  return bc && bc.z ? `${b.l} · ${t('gospel.res.training')}` : b.l
}
const wayInFor = (g) => wayInBetween(g.iso639_3 || '', selected.value?.iso3 || '', g.people_group || '')

// The header must count the SAME set the list below it shows. It used to read
// gospel-by-country.json, which is built from the curated 2,106-record subset, so after
// the list moved to the pins the card contradicted itself inside one view: "People
// groups 36" sitting directly above "Gospel resources found (282)" for Indonesia.
// Derived here from the same groupsForCountry the list renders, so the two cannot drift.
const countryStats = computed(() => {
  const g = groupsForCountry.value
  let scripture = 0, film = 0, audio = 0, none = 0, popNone = 0, sign = 0
  for (const r of g) {
    if (r.scripture_url) scripture++
    if (r.film_url) film++
    if (r.audio) audio++
    if (!hasAny(r)) { none++; popNone += r.population || 0 }
    if (r.is_sign) sign++
  }
  return {
    groups: g.length, scripture, film, audio, none, popNone, sign,
    pctNone: g.length ? Math.round((1000 * none) / g.length) / 10 : 0,
  }
})

/**
 * ═══ PRAYER IS A MOVE, NOT A STATISTIC ════════════════════════════════════════════════════
 *
 * A country click ended in numbers. Every one of them describes work somebody else has to fund,
 * staff or translate — and the one thing the reader of a country can do THIS MINUTE was reachable
 * only by guessing which pin to tap. So the country sheet now ends in a move: the largest group
 * here that has nothing AND nobody praying, with its prayer page one tap away.
 *
 * ⚠ THE DENOMINATOR IS STATED BECAUSE IT IS NOT THE COUNTRY. doxa.life publishes a page for
 * 1,723 of the 12,379 groups on this map, so "nobody praying" can only ever be said of the
 * groups that HAVE a page — never of the country. Rendering a bare count would read as "14 groups
 * in this country have nobody praying", which this data cannot support. It is shown as N of M.
 *
 * ⚠ ZERO IS ZERO ON doxa.life's COUNTER, which is what the gap tab already says in full. It is
 * not a claim that nobody in the world prays for these people — an unknowable thing.
 */
const countryPrayer = computed(() => {
  const g = groupsForCountry.value
  let pages = 0, noPray = 0, noPrayPeople = 0
  let firstMove = null, firstMovePop = -1
  for (const r of g) {
    const e = prayIndex.value[prayKey(r.people_group, r._iso3 || selected.value?.iso3 || '')]
    if (!e) continue
    pages++
    if (e.praying > 0) continue
    noPray++
    noPrayPeople += r.population || 0
    /* NEED FIRST, THEN SIZE, and India shows what that costs: of its 601 groups with nobody
       praying only FIVE have nothing at all, so this offers Malai Pandaram at 8,700 people ahead
       of Badhai at 851,000 — who already have Scripture and film. That is the map's own ladder
       applied to prayer rather than a second, quieter ranking, and the sub-label says "nothing
       found" so the reader can see which rung they were handed. Where every unprayed-for group
       here has something, the largest of those is offered instead. */
    const rank = (hasAny(r) ? 0 : 1e12) + (r.population || 0)
    if (rank > firstMovePop) { firstMovePop = rank; firstMove = { ...e, group: r } }
  }
  return { pages, noPray, noPrayPeople, firstMove }
})

/* ITEM 2 — resources in a group's OWN language, joined on the EXACT ISO 639-3 code.
 * Never a name match: language names collide and drift ("Arabic" is dozens of
 * distinct codes), and a fuzzy hit here would put the wrong scripture in someone's
 * hand while looking perfectly correct on screen. */
const sameLanguage = computed(() => {
  const g = selectedGroup.value
  const code = String(g?.iso639_3 || '').trim()
  if (!code) return []
  const out = []
  for (let i = 0; i < pinRows.value.length; i++) {
    const r = pinRows.value[i]
    if (r[4] !== code) continue
    if (r[0] === g.people_group && r[3] === (g._iso3 || r[3]) && i === g._i) continue
    out.push(groupAt(i))
  }
  // Largest first, and capped by the template at 12 — a widely-spoken code like cmn
  // otherwise lists 135 groups inside a 330px card.
  return out.sort((a, b) => (b.population || 0) - (a.population || 0))
})


const verifyOf = (url) => (url && linkVerify.value ? linkVerify.value[url] : null) || null
/* labelKey, not label: a chip reads "<resource> · <state>" and BOTH halves are chrome, so
   both come from the catalogue. The class stays as it is — it is styling, not language. */
const VSTATE = {
  verified: { cls: 'ok',   labelKey: 'gospel.state.linkChecked' },
  broken:   { cls: 'bad',  labelKey: 'gospel.state.linkDead' },
  mismatch: { cls: 'warn', labelKey: 'gospel.state.wrongLanguage' },
  unknown:  { cls: 'meh',  labelKey: 'gospel.state.unchecked' },
}
// A URL with no verification entry is UNCHECKED — never quietly shown as working.
const vchip = (url) => VSTATE[verifyOf(url)?.state || 'unknown'] || VSTATE.unknown
const vtitle = (url) => verifyOf(url)?.detail || t('gospel.ui.linkUnchecked')

// A big field (India carries 856 groups) would otherwise render hundreds of buttons
// into a phone sheet on the first tap. Capped, with the real total always stated and
// one tap to see everything — a silent truncation would read as "that is all of them".
const PAGE = 40
const shown = ref(PAGE)

function openCountry(iso) {
  if (!iso || !byIso.value[iso]) return
  selected.value = byIso.value[iso]
  selectedGroup.value = null
  selectedProvince.value = null
  shown.value = PAGE
  ensurePeopleGroups()
  /* Opening India or China IS the intent signal. 1.6 MB of Indian geometry is not something to
     spend on the 173 countries nobody is looking at. */
  ensureProvinces(iso)
}

function openGroup(g) { selectedGroup.value = g }
function closeSheet() { selected.value = null; selectedGroup.value = null; selectedProvince.value = null }

async function load() {
  const [data, adm0, pinData, doxaData] = await Promise.all([
    fetch(`${assetsBase.value}/tables/gospel-by-country.json`).then((r) => r.json()),
      // world-adm0 now INCLUDES India, so there is one ADM0 file and no patched
      // variant. It used to omit IND (the 100-list splits India into 10 provincial
      // zones, so its geometry shipped only as gb-IND-ADM1.geojson) — which left the
      // LARGEST field in the dataset, 856 people groups, as a hole on every map. The
      // review caught it as "India seems to have no internet coverage". The fix was a
      // second file, world-adm0-plus.geojson; that file is gone and India is fetched
      // at ADM0 like every other country (data/source-boundaries.mjs).
    fetch(`${assetsBase.value}/boundaries/world-adm0-web.geojson`).then((r) => r.json()),
    // 650KB and it is the point of the map, so it loads with the boundaries rather
    // than behind a tap. URLs are normalised into `codes` by ISO 639-3, so the 12,379
    // pins carry a code rather than 12,379 copies of the same jesusfilm.org link.
    fetch(`${assetsBase.value}/tables/people-group-pins.json`).then((r) => r.json()),
    /* ═══ THE MAP DRAWS DOXA'S ROSTER, NOT EVERY PEOPLE GROUP ON EARTH ═══════════════
     * people-group-pins.json stays exactly as it is — 12,379 groups, 8,437 verified
     * links, the whole GRN sweep — because it is the RESEARCH RECORD and the resource
     * index every sheet reads. What changed is what gets DRAWN. Doxa works the ~2,100
     * groups on pray.doxa.life, and a map of everyone buries the ones they can reach.
     * Nothing is lost; the wider set simply stops being dumped on the map. */
    fetch(`${assetsBase.value}/tables/doxa-people-groups.json`).then((r) => r.json()),
  ])
  rows.value = data.countries || []
  pinCodes.value = pinData.codes || {}
  pinBridges.value = pinData.bridges || {}
  pinCandidates.value = pinData.bridgeCandidates || {}
  pinSun.value = pinData.sun || null

  /* Same seven-slot shape the rest of this file already speaks, so narrowing the roster
     changes WHICH pins exist and nothing about how they are drawn, clicked or filtered. */
  // …and within that roster, only the groups of this page's people-group LIST (library/lists/).
  const roster = await applyPeopleGroupList(doxaData.rows || [], profileConfig)
  doxaTotal.value = roster.length
  /**
   * ═══ THE TIER COMES FROM THE INDEX, NOT FROM THE ROSTER'S COPY OF IT ════════════════════
   *
   * The roster file stores a tier per group, captured when that file was generated. The pin
   * index is rebuilt whenever a pool lands; the roster is not, so the copy goes stale silently
   * and the map paints from the stale one.
   *
   * MEASURED: exactly one row disagreed, and it was the worst possible row. Gazan Arabs —
   * 2,315,000 people — was drawn RED as "nothing found" while the index had held a Scripture
   * Earth PDF and a Zume course in South Levantine Arabic since the roster was written. It was
   * also, because of that stale zero, the single group on this map shown as having nothing AND
   * no way in. The access table beside it already said "read". One group, one file, and the
   * two halves of the map disagreed about the second-largest population it draws.
   *
   * This READS the `tiers` map the pin index publishes — one entry per code, computed there by
   * the same expression that tiers a pin. It does not re-derive a tier from the resource fields,
   * which is what the surfaces gate forbids. The roster's stored value stays only as the
   * fallback for a code the index has never seen at all.
   */
  const tierByCode = pinData.tiers || {}
  pinRows.value = roster
    .filter((r) => r.mapped && r.lat != null && r.lng != null)
    /* [7] is the SLUG, carried so a link can name these peoples exactly rather than naming the
       languages they speak. It costs nothing: the roster already has it, from doxa.life. */
    .map((r) => [r.name, r.lat, r.lng, r.iso3, r.iso639_3 || '', r.population || 0,
      tierByCode[r.iso639_3] ?? r.tier ?? 0, r.slug || ''])
  pinCount.value = pinRows.value.length
  doxaUnplaced.value = doxaTotal.value - pinCount.value

  /* Countries Doxa actually works, and how many of their groups have nothing. A country
     outside this set is NOT "zero" — it is out of scope, and painting it at all was the
     misleading part: the United States holds three Doxa groups, so one without a resource
     read as 33% and turned the whole country amber. */
  const tally = {}
  for (const r of roster) {
    const t = (tally[r.iso3] ||= { groups: 0, none: 0, people: 0 })
    t.groups += 1
    t.people += r.population || 0
    if (r.mapped && r.tier === 0) t.none += 1
  }
  doxaByCountry.value = tally
  return adm0
}

// Kept so a mode switch can recolour from the geometry already in hand rather than
// re-fetching 2.7MB of boundaries.
const adm0Ref = shallowRef(null)

function paint(map, adm0) {
  const m = byIso.value
  const feats = (adm0.features || []).map((f) => {
    const iso = f.properties?.iso3
    const d = m[iso]
    return {
      type: 'Feature',
      properties: {
        iso3: iso,
        band: d?.band || 'none',
        /* Keyed by ISO3, not by the old country row: scope now comes from Doxa's roster,
           and a country they do not work gets no fill rather than a "covered" colour. */
        color: featureColor(iso),
        hasData: !!doxaByCountry.value[iso],
      },
      geometry: f.geometry,
    }
  })
  const fc = { type: 'FeatureCollection', features: feats }

  if (map.getSource('gr-src')) { map.getSource('gr-src').setData(fc); return }
  map.addSource('gr-src', { type: 'geojson', data: fc })
  map.addLayer({
    id: 'gr-fill', type: 'fill', source: 'gr-src',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'hasData'], 0.72, 0] },
  })
  map.addLayer({
    id: 'gr-line', type: 'line', source: 'gr-src',
    paint: { 'line-color': 'rgba(255,255,255,0.5)', 'line-width': 0.5 },
  })
  // TAP, not hover. On a phone hover never fires, so a hover-only map is dead.
  map.on('click', 'gr-fill', (e) => openCountry(e.features?.[0]?.properties?.iso3))
  map.on('mouseenter', 'gr-fill', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'gr-fill', () => { map.getCanvas().style.cursor = '' })
}

/**
 * ═══ PROVINCES, FETCHED ONLY WHEN SOMEONE LOOKS ══════════════════════════════════════════
 *
 * India and China hold 47.9% of the roster (855 + 154 of 2,107) and a national fill cannot
 * answer "where would a team go" for half the map. But India's ADM1 geometry is 1,628 KB —
 * nearly the size of the whole world ADM0 file — on a leaf that already loads about 4 MB and
 * is meant to be embedded on thousands of partner sites. Loading it for the 173 countries
 * nobody is looking at would be a tax on every reader for the benefit of two.
 *
 * So it arrives on intent: opening India or China fetches that country's provinces once, and
 * nothing else changes for anyone else. China is 54 KB, India 1,628 KB, and both are cached
 * after the first open.
 *
 * COLOURED BY THE SAME LADDER as the country fill, because a reader who has just learned what
 * the clay ramp means must not have to learn a second scale one zoom later.
 */
const provinceState = ref({})          // iso3 -> 'loading' | 'ready' | 'failed'
const provinceGeo = ref({})            // iso3 -> the loaded FeatureCollection, kept for recolouring
/* A province is coloured by the SAME rule as a country, mode included — a reader who has just
   learned the clay ramp must not meet a second scale one zoom later. featureColor cannot be
   reused directly because it looks a country up by iso3; this is the same two lines against a
   province's own counts. */
const colourProvinces = (geo) => {
  for (const f of geo.features) {
    const n = mode.value === 'gap' ? f.properties.zero : f.properties.groups - f.properties.zero
    const b = f.properties.groups > 0 ? bandFor(mode.value === 'gap' ? BANDS : COVER_BANDS, n) : null
    f.properties.pcolor = b ? b.color : NO_DOXA_FILL
  }
}
/* Mode changes after a province layer exists would otherwise leave it painted in the old
   scale — the country beneath it would say one thing and the province another. */
const repaintProvinces = () => {
  const map = mapRef.value
  if (!map) return
  for (const [iso3, geo] of Object.entries(provinceGeo.value)) {
    colourProvinces(geo)
    const src = map.getSource(`gr-prov-${iso3}`)
    if (src) src.setData(geo)
  }
}
const provinceRows = ref(null)         // the measured table: province -> counts
const selectedProvince = ref(null)

async function ensureProvinceTable() {
  if (provinceRows.value) return provinceRows.value
  const r = await fetch(`${assetsBase.value}/tables/gospel-by-province.json`)
  provinceRows.value = await r.json()
  return provinceRows.value
}

const PROVINCE_FILE = { IND: 'gb-IND-ADM1-full-web.geojson', CHN: 'gb-CHN-ADM1.geojson' }

async function ensureProvinces(iso3) {
  const map = mapRef.value
  if (!map || !PROVINCE_FILE[iso3] || provinceState.value[iso3]) return
  provinceState.value = { ...provinceState.value, [iso3]: 'loading' }
  try {
    const [geo, table] = await Promise.all([
      fetch(`${assetsBase.value}/boundaries/${PROVINCE_FILE[iso3]}`).then((r) => r.json()),
      ensureProvinceTable(),
    ])
    /* The counts come from the measured table, never recomputed here — the point-in-polygon
       that produced them belongs in the build, and a second implementation in the leaf is how
       two surfaces come to disagree. */
    const by = {}
    for (const row of (table.rows || [])) if (row.iso3 === iso3) by[row.province] = row
    for (const f of geo.features) {
      const row = by[f.properties.shapeName]
      f.properties.zero = row ? row.zero_access_groups : 0
      f.properties.groups = row ? row.groups : 0
    }
    provinceGeo.value = { ...provinceGeo.value, [iso3]: geo }
    colourProvinces(geo)
    const src = `gr-prov-${iso3}`
    if (!map.getSource(src)) {
      map.addSource(src, { type: 'geojson', data: geo })
      map.addLayer({
        id: `${src}-fill`, type: 'fill', source: src,
        paint: { 'fill-color': ['get', 'pcolor'], 'fill-opacity': ['case', ['>', ['get', 'groups'], 0], 0.82, 0] },
      }, 'gr-line')
      map.addLayer({
        id: `${src}-line`, type: 'line', source: src,
        paint: { 'line-color': 'rgba(255,255,255,0.75)', 'line-width': 0.7 },
      }, 'gr-pins-halo')
      map.on('click', `${src}-fill`, (e) => openProvince(iso3, e.features?.[0]?.properties?.shapeName))
      map.on('mouseenter', `${src}-fill`, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', `${src}-fill`, () => { map.getCanvas().style.cursor = '' })
    }
    provinceState.value = { ...provinceState.value, [iso3]: 'ready' }
  } catch (_) {
    /* A province view is an enrichment; losing it must never take the country view with it. */
    provinceState.value = { ...provinceState.value, [iso3]: 'failed' }
  }
}

function openProvince(iso3, name) {
  const t = provinceRows.value
  if (!t || !name) return
  selectedProvince.value = (t.rows || []).find((r) => r.iso3 === iso3 && r.province === name) || null
}
function closeProvince() { selectedProvince.value = null }

function pinFC() {
  const feats = new Array(pinRows.value.length)
  const hnrFor = (code) => {
    const c = pinCodes.value[code]
    return !!c && canHear(c) && !hasTextScripture(c)
  }
  for (let i = 0; i < pinRows.value.length; i++) {
    const p = pinRows.value[i]
    // Only the INDEX travels in properties; the row itself stays in JS. Mapbox
    // stringifies nested feature properties, so passing the record would ship a
    // second copy of the table into the GL source.
    feats[i] = {
      type: 'Feature',
      // hnr is baked so the filter stays a GL-side predicate like the others: recomputing it
      // per toggle would re-upload 12,379 features to answer a yes/no already known here.
      properties: { i, tier: p[6], color: PIN_COLOR[p[6]], rim: PIN_RIM[p[6]], hnr: hnrFor(p[4]), lc: inLinkList(p) },
      geometry: { type: 'Point', coordinates: [p[2], p[1]] },
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

/**
 * Frame the DATA, not a guessed zoom. Runs once, on load, before the reader has navigated:
 * every Doxa group is on screen at the start, which is the one moment the whole roster is
 * the subject. Padding keeps the legend card from covering the westernmost pins.
 */
function fitToPins(map, keep) {
  const all = pinRows.value
  /* FRAMED ON WHAT IS DRAWN. With a partner's list on the URL the whole-world frame is the wrong
     first sight: their forty groups become forty specks. Falls back to everything when the
     subset is empty, because a fit to nothing is a fit to the null island. */
  const sub = keep ? all.filter(keep) : all
  const rows = sub.length ? sub : all
  if (!map || !rows.length) return
  let w = 180, e = -180, s = 90, n = -90
  for (const r of rows) {
    const lat = r[1], lng = r[2]
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (lng < w) w = lng
    if (lng > e) e = lng
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  if (w > e || s > n) return
  try {
    map.fitBounds([[w, s], [e, n]], { padding: { top: 24, right: 24, bottom: 24, left: 24 }, duration: 0, maxZoom: keep ? 6 : 4 })
  } catch (_) { /* a bad extent must never stop the map drawing */ }
}

function paintPins(map) {
  if (!pinRows.value.length) return
  if (map.getSource('gr-pin-src')) { map.getSource('gr-pin-src').setData(pinFC()); return }
  map.addSource('gr-pin-src', { type: 'geojson', data: pinFC() })
  /* A neutral halo UNDER every pin, so a dot never touches its fill directly. This is what
     makes the encoding survive a choropleth that shares its colour range — form and hue both
     fail on a near-match, a gap of background does not. Separate layer, because a circle has
     one stroke and the pin above needs its own for the rim. */
  map.addLayer({
    id: 'gr-pins-halo', type: 'circle', source: 'gr-pin-src',
    paint: {
      'circle-color': 'rgba(255,255,255,0.85)',
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        0, ['match', ['get', 'tier'], 0, 4.0, 2.7],
        4, ['match', ['get', 'tier'], 0, 6.0, 4.0],
        8, ['match', ['get', 'tier'], 0, 9.4, 6.6],
        12, ['match', ['get', 'tier'], 0, 13, 9.4]],
      'circle-blur': 0.35,
      'circle-opacity': 0.55,
    },
  })
  map.addLayer({
    id: 'gr-pins', type: 'circle', source: 'gr-pin-src',
    // circle-sort-key is a LAYOUT property. Mapbox tolerates it in `paint`; MapLibre
    // rejects the whole layer for one misplaced property — without throwing — so every
    // pin on this map vanished under the keyless engine while the page still looked
    // fine. Same defect, same fix, as all-people-groups. check:maplibre-drops is the
    // gate that names it.
    layout: {
      // A group with NOTHING found draws ON TOP of a covered one. At world zoom the
      // pins overlap heavily, and the whole purpose of this map is that the gap is
      // the thing you cannot miss — so the gap wins the z-fight, by construction.
      'circle-sort-key': ['match', ['get', 'tier'], 0, 3, 1, 2, 1],
    },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-stroke-color': ['get', 'rim'],
      // The hole needs a rim thick enough to be a rim and not an outline: at world zoom a
      // 0.4px stroke on a 1.8px dot is invisible, which is how the old one disappeared.
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'],
        0, ['match', ['get', 'tier'], 0, 1.1, 0.5],
        6, ['match', ['get', 'tier'], 0, 1.8, 0.9],
        12, ['match', ['get', 'tier'], 0, 2.6, 1.2]],
      'circle-stroke-opacity': 1,
      // Size is urgency. A group with nothing is the largest dot on the map at every zoom.
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        0, ['match', ['get', 'tier'], 0, 2.6, 1.6],
        4, ['match', ['get', 'tier'], 0, 4.2, 2.6],
        8, ['match', ['get', 'tier'], 0, 7, 4.8],
        12, ['match', ['get', 'tier'], 0, 10, 7]],
      'circle-opacity': 1,
    },
  })
  // TAP, not hover — same reason as the choropleth: hover never fires on a phone.
  map.on('click', 'gr-pins', (e) => openPin(e.features?.[0]?.properties?.i))

  // VERIFICATION HANDLE — same contract as DashboardMapPanel's window.__rdashMap. An
  // agent checking this map otherwise has to guess screen coordinates to hit a 3px dot,
  // which is how a gate ends up reporting a product defect for its own bad arithmetic.
  // __grState() is the falsifiable one: it reports the counts the layer actually holds.
  if (typeof window !== 'undefined') {
    setGlobal('__grMap', map)
    setGlobal('__grOpenPin', (i) => openPin(i))
    setGlobal('__grState', () => ({
      pins: pinRows.value.length,
      codes: Object.keys(pinCodes.value).length,
      hasLayer: !!map.getLayer('gr-pins'),
      hasSource: !!map.getSource('gr-pin-src'),
      rendered: map.queryRenderedFeatures({ layers: ['gr-pins'] }).length,
      // country view: what the sheet is actually listing, so a check can compare it
      // against the pins the layer holds for the same country rather than counting DOM
      // rows, which are paginated at 40.
      country: selected.value?.iso3 || null,
      countryGroups: groupsForCountry.value.length,
      countryWith: withResources.value.length,
      countryWithout: withoutResources.value.length,
      pinsInCountry: (pinsByIso.value[selected.value?.iso3] || []).length,
      group: selectedGroup.value,
    }))
  }
  map.on('mouseenter', 'gr-pins', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'gr-pins', () => { map.getCanvas().style.cursor = '' })
}

// A pin click opens the group detail AND sets the country context, because the sheet
// is `v-if="selected"` and its back button reads `selected.country`. Opening a group
// without a country would render nothing at all.
function openPin(i) {
  const r = pinRows.value[i]
  if (!r) return
  // Link verification is needed by EVERY pin, so it is fetched unconditionally. It used
  // to hang off the country branch below, which meant a tap landing before the country
  // index had loaded left the whole session showing "unchecked" on links that were in
  // fact verified — and "unchecked" is indistinguishable from "nobody looked".
  ensurePeopleGroups()
  const country = byIso.value[r[3]]
  if (country) { selected.value = country; shown.value = PAGE }
  else selected.value = { country: r[3], iso3: r[3] }
  // ONE shape, built in one place. openPin used to assemble its own object, so a field
  // added to the country-list shape silently did not exist on a pin tap.
  selectedGroup.value = groupAt(i)
}

/**
 * ═══ THE ENGINE'S OWN CSS HAS TO REACH THIS SHADOW ROOT ═════════════════════════════════
 *
 * Bundles that go through useMapInstance get this for free — its header says so: "injects
 * Mapbox GL CSS into the root". This profile calls `new gl.Map` directly, for the provider
 * switch above, and in taking that path it silently opted out of the CSS injection too.
 *
 * MEASURED against a leaf that does use the composable. Mapbox inserts a hidden
 * div.mapboxgl-canary and checks its computed style; mapbox-gl.css is the only thing that
 * paints it salmon. research-dashboard: rgb(250,128,114), no warning. This leaf, before the
 * fix: rgba(0,0,0,0) and "missing CSS declarations". The stylesheet was in the leaf's
 * DOCUMENT all along, which is why tiles painted and nothing looked obviously wrong — but
 * document CSS does not cross a shadow boundary, so controls, geocoder and markers were
 * positioned by no stylesheet at all.
 *
 * ONE IMPLEMENTATION, NOT TWO. This was first fixed with a local copy built on the already-
 * exported engineStylesheetUrl, because nothing shared needed changing for it. The library
 * then exported ensureEngineCSS for the same defect on connectivity-map, so this converges
 * onto theirs — and theirs is the better one: it also waits on a link that is PRESENT BUT
 * NOT YET LOADED, a case the local copy would have skipped straight past.
 */
onMounted(async () => {
  if (!cardMode.value) {
    announceInfoPending(true)
    window.addEventListener('dxmaps:mapinfo-host', reannounceInfoPending)
    watchLegend()
    detachEdges = useEdgeScrollAffordance(mapEl.value?.parentElement || null, { enabled: EDGE_SCROLL_AFFORDANCE.value })
  }
  /* ⚠ CARD MODE RETURNS BEFORE THE ENGINE. Everything below this block — the engine script, its
     stylesheet, the boundaries, the pin index — is what makes the card expensive, so none of it
     runs. One fetch, then render. */
  if (cardMode.value) {
    try {
      const r = await fetch(`${assetsBase.value}/tables/card-${cardShard(cardSlug)}.json`)
      const shard = r.ok ? await r.json() : null
      const card = shard && shard[cardSlug]
      if (card) {
        /* THE SAME normalizer the map path uses, on the same raw inputs. */
        selectedGroup.value = groupFrom(card.row, card.c, card.country, card.bridge, card.bridge_candidate, -1)
        /* Two things the sheet reads from tables the card never fetches: the prayer page (prayIndex)
           and the SUN block (the pin index's own). Both ship in the shard, and both matter most to
           the persona this card exists for — a catalyst with a Deaf group, or one who wants to hand
           someone a prayer page. Seeded here rather than special-cased in the template. */
        if (card.pray_url) {
          prayIndex.value = { [prayKey(card.row[0], card.row[3])]: { u: card.pray_url, n: card.row[0], praying: 0 } }
        }
        if (card.sun) pinSun.value = { scripture: { u: card.sun.u, t: card.sun.t } }
        /* The chips read their state from linkVerify; without this every one says "unchecked" on a
           card whose links are verified, which understates the evidence behind them. */
        if (card.verified) linkVerify.value = card.verified
        selectedGroup.value._cardRes = card._cardRes || null
        /* ⚠ THE SHEET READS selected.* IN FOURTEEN PLACES, and card mode had no country at all, so
           the first of them — the back button's selected.country — threw and the page rendered
           BLANK. Guarding that one line would have left thirteen. The card knows its country, so
           `selected` is populated from it: every existing read is satisfied, and the curated-analysis
           block stays hidden on its own hasCurated test because a card carries none of those fields. */
        selected.value = { iso3: card._iso3 || '', country: card.countries || card._iso3 || '' }
      }
      else err.value = `No card for "${cardSlug}".`
    } catch (e) { err.value = String(e.message || e) }
    return
  }
  try { await ensureEngineScript(grProvider) } catch (_) { /* fall through to the notice below */ }
  try {
    const css = engineStylesheetUrl(grProvider)
    if (css) await ensureEngineCSS(mapEl.value, css)
  } catch (_) { /* a stylesheet must never stop the map painting */ }
  /* Re-check after the await: this leaf can be unmounted mid-initialise, which is the race
     that produced "Cannot read properties of null" across the fleet. */
  if (!mapEl.value) return
  /* ⚠ NEVER SWITCH ENGINES SILENTLY (regions' C3 read, 2026-09-26). This used to read
     `engineGlobal(grProvider) || window.mapboxgl`. engineGlobal already defaults to mapbox, so
     the fallback could only ever fire for provider 'maplibre' — and then it handed back MAPBOX:
     a page that chose the keyless engine got the one that needs a token, which breaks the
     keyless contract silently, with a map that looks fine until the token is missing. The
     requested engine or a visible failure; never a different engine. */
  const gl = engineGlobal(grProvider)
  if (!gl) {
    /* The console line stays English on purpose — it is for whoever is debugging the page, not
       for the reader. The line the READER sees goes through the catalogue. */
    console.warn(`[gospel-resources] the ${grProvider} engine global never loaded — refusing to substitute another engine, because that would hand a keyless page the engine that needs a token.`)
    err.value = t('messages.engineMissing', { engine: providerLabel(grProvider) })
    return
  }
  if (!mapEl.value) return
  /**
   * ═══ ARABIC, HEBREW AND PERSIAN PLACE NAMES NEED A SHAPER ═══════════════════════════════
   *
   * Same root cause as the stylesheet above: maps built through useMapInstance get this at
   * line 416, and building raw opted out of it. Without the plugin every RTL label draws as
   * disconnected, left-to-right glyphs — not a subtly wrong font, unreadable text.
   *
   * THIS IS NOT AN ARABIC-LOCALE BUG, which is why it went unseen. This leaf never localises
   * basemap labels, so the style renders each place in its OWN script: the Middle East and
   * North Africa come back in Arabic for EVERY viewer, whatever their UI language. An English
   * reader saw broken Arabic and had no reason to report it; an Arabic reader would have.
   * MEASURED before this line existed — getRTLTextPluginStatus() 'unavailable' on both the
   * default load and ?lang=ar.
   *
   * IT GOES HERE, NOT IN index.js. Sibling bundles call it at entry load time, but this
   * bundle injects its engine lazily, so at entry time there is no engine global to install
   * into and the call would silently do nothing (rtl-text.js says so in its own header). The
   * first moment it can work is the one after the engine resolves — this one. Idempotent, so
   * a second profile on the same page costs nothing, and lazy, so a map with no RTL labels
   * never fetches the plugin.
   */
  installRtlTextPlugin(gl)
  try {
    const adm0 = await load()
    const map = new gl.Map({
      container: mapEl.value,
      // Paired through the registry so both engines show one intent: 'ink' is the near-black entry
      // (mapbox dark-v11 / OpenFreeMap dark), 'paper' the near-white one (light-v11 / positron).
      style: resolveNamedStyle(isDark.value ? 'ink' : 'paper', grProvider).style
        || (isDark.value ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11'),
      accessToken: mapboxToken.value,
      /* THE ENGINE'S OWN STRINGS, IN THE READER'S LANGUAGE. This leaf calls
         `new gl.Map` directly instead of going through useMapInstance, so it did not inherit
         the locale map the shared composable passes — "Toggle attribution" and the canvas's
         accessible name "Map" stayed English under ar while every string we own was Arabic.
         Set at construction because that is the only time either engine reads it. */
      locale: engineUiLocale(readerLang(), grProvider),
      /* A starting zoom is a guess about the canvas. It was 1.3, which framed the world
         while this leaf was running WITHOUT the engine's stylesheet; once mapbox-gl.css
         reached the shadow root the canvas sized correctly and the same 1.3 cut the visible
         band to -23.8..52.0 — Cape Town, Iceland and the Faroes fell off the map, and 21 of
         Doxa's groups with them. Kept as the pre-load frame only; fitToPins below replaces
         it with the DATA's own extent as soon as the pins are known, so the opening view
         cannot depend on a canvas size again. */
      center: [42, 18], zoom: 1.3, projection: 'mercator', attributionControl: false,
    })
    mapRef.value = markRaw(map)
    adm0Ref.value = markRaw(adm0)
    // LICENCE OBLIGATION, not decoration. attributionControl:false above kills
    // Mapbox's built-in credit and nothing replaced it — this map was shipping with
    // NO attribution at all. It SHADES geoBoundaries polygons, so the geoBoundaries
    // credit + link back is required, and gbOpen is mixed-licence with several
    // countries carrying a real attribution requirement (India CC BY 2.5 IN, etc).
    /**
     * ═══ THE CREDIT MUST NAME THE BASEMAP THAT IS ACTUALLY DRAWN ═════════════════════════
     *
     * Under ?provider=maplibre this line used to read "geoBoundaries · Mapbox ·
     * © OpenStreetMap" while the tiles came from OpenFreeMap. Crediting the wrong supplier is
     * worse than crediting none — it is a false statement about whose work is on screen, and
     * OpenFreeMap's terms ask for their credit.
     *
     * addMapAttribution hardcodes the Mapbox link whenever basemap is true; it takes no engine.
     * Fixing THAT belongs in library/ and is handed to the build owner, so this does the
     * plugin-only half: under MapLibre the shared bar credits geoBoundaries alone, and the
     * engine's own AttributionControl supplies the basemap credit.
     *
     * ⚠ AND IT READS THE TEXT FROM THE STYLE RATHER THAN RESTATING IT. OpenFreeMap's TileJSON
     * carries the exact wording — OpenFreeMap, © OpenMapTiles, data from OpenStreetMap — so a
     * hand-typed copy here would be one more thing to go stale the day they change it. Verified
     * against https://tiles.openfreemap.org/planet before writing this.
     */
    const isMaplibre = grProvider === 'maplibre'
    // ★ NOW ONE CREDIT: the engine's own control on BOTH engines, compact on a narrow map (plugin-designer 5.8),
    // with geoBoundaries as custom attribution. It still reads the basemap wording from the style, as above; under
    // Mapbox the style names Mapbox and OpenStreetMap. An engine without the control keeps the shared line, with
    // the basemap credit it can name.
    if (!addCompactCredit(map, gl)) addMapAttribution(map, { boundaries: true, basemap: !isMaplibre })
    /**
     * ═══ 'load' MAY HAVE ALREADY FIRED ════════════════════════════════════════════════════
     *
     * ⚠ THE DEFECT THIS WAS WRITTEN FOR WAS RETRACTED. A first reading said that under
     * ?provider=maplibre this map drew the basemap and nothing else; re-measured by polling
     * until the tiles and features were actually in, it draws 170 fills and 2,107 pins on both
     * engines. The original reading was taken on a fixed 18 s timer, right as the layers
     * arrived. The guard stays because it is correct on its own terms — everything this map
     * draws hangs off one callback — but it fixed nothing, and saying otherwise would leave a
     * false account of the code in the code.
     *
     * Everything this map draws is added inside this one callback, so a `load` that has already
     * fired would leave exactly the basemap. That race is real even though it was not what
     * happened here, and the two engines do resolve their styles on different schedules, so the
     * guard is cheap insurance rather than a repair.
     */
    const draw = () => {
      paint(map, adm0)
      paintPins(map)
      /* The link clause lives in setPinFilter, and nothing has called it yet at first paint —
         so without this the partner's list would be baked into the features and ignored. */
      if (linkActive.value) setPinFilter(pinFilter.value)
      fitToPins(map, linkActive.value ? inLinkList : null)
      openFromUrl()
    }
    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) draw()
    else map.once('load', draw)
  } catch (e) { err.value = String(e.message || e) }
})
onBeforeUnmount(() => {
  if (creditTimer) { clearTimeout(creditTimer); creditTimer = 0 }
  if (typeof window !== 'undefined') window.removeEventListener('dxmaps:mapinfo-host', reannounceInfoPending)
  try { legendRO?.disconnect() } catch (_) {}
  try { detachEdges?.() } catch (_) {}
  detachEdges = null
  if (!mapRef.value) announceInfoPending(false)
  // ★ RELEASE THE TEST HOOKS. Each pins whatever it closes over — a map instance pins its
  // canvas, its sources, and through them the whole app — so every mount that leaves one behind
  // leaks another copy, measured at roughly 10 MB each.
  // Released as a SET, not just the obvious one: a block that sets several and clears one leaks
  // the rest silently, and the named one is the one you remember. One delete per line, so the
  // released set is readable and greppable.
  // Identity-checked: only this instance's own value is cleared, so a second instance sharing the
  // page does not delete the first's live hooks on its way out.
  try { if (window.__grMap === ownGlobals.__grMap) delete window.__grMap } catch (_) {}
  try { if (window.__grOpenPin === ownGlobals.__grOpenPin) delete window.__grOpenPin } catch (_) {}
  try { if (window.__grState === ownGlobals.__grState) delete window.__grState } catch (_) {}
  try { mapRef.value?.remove() } catch (_) {}
  if (typeof window !== 'undefined') window.removeEventListener('resize', syncNarrow)
})

function setMode(m) {
  if (mode.value === m) return
  mode.value = m
  if (mapRef.value && adm0Ref.value) paint(mapRef.value, adm0Ref.value)
  repaintProvinces()
}

/* ═══ NUMBER FORMAT IS HELD FLEET-WIDE ════════════════════════════════════════════════
 * This briefly formatted with the locale i18n resolved, which is almost certainly the right
 * answer — but it decides number format for THIS map alone, and the decision belongs to every
 * map at once or none. Reverted on that ground, not because the finding was wrong.
 *
 * THE FINDING, kept here so it is not re-derived: toLocaleString() with no argument formats for
 * the JS RUNTIME's locale, i.e. the browser's, which has nothing to do with the locale this
 * plugin was asked to render in. The same page therefore shows different numbers to different
 * readers — Hindi grouping in lakhs, French and Russian spaces — depending on their browser and
 * not on the locale the page is in. Pinning numberingSystem to latn would change the DIGITS for
 * region tags only (ar-EG resolves to arab, fa to arabext); the eleven tags this bundle ships,
 * plain "ar" included, already resolve to latn.
 */
const fmt = (n) => (Number(n) || 0).toLocaleString()

// The table lives on a SIBLING page, so "see all of these" is a URL. Built here rather
// than inline in the template so the group link and the country link cannot drift apart.
/**
 * ═══ A BRIDGE NOBODY CAN FOLLOW IS NOT A WAY IN ═══════════════════════════════════════════
 *
 * Both bridge panels below NAMED a language and stopped there. For a group with nothing, the
 * only link on the sheet was "Every resource in <their own language>" — which is, by
 * definition, the empty table. MEASURED by clicking a gap pin: Syenara Senufo offered five
 * "none found" chips, named Minianka as the way in, and the one thing to click led to nothing.
 * So the sheet told a mobiliser where to go and then made them go and find it themselves.
 *
 * Nothing new has to be fetched. Both bridge records already carry the bridge's ISO 639-3
 * code, and the pin index already holds that language's own verified links — Minianka is
 * ebible.org/myk/ and jesusfilm.org/watch/jesus/minianka, on the same screened publishers and
 * through the same doctrine scan as every other link here. The data was one lookup away.
 *
 * Joined on the CODE, never the name, for the reason the whole index is built that way.
 */
const bridgeResources = (b, pre) => {
  if (!b || !b.c) return null
  /* In card mode the pin index was never fetched, so the builder ships the bridge's resources
     alongside; the map path has pinCodes and needs no help. */
  if (pre) return pre
  const c = pinCodes.value[b.c]
  if (!c) return null
  /* ⚠ c.s IS NOT THE ONLY PLACE A READABLE SCRIPTURE LIVES, and reading only it lost the very
     language this fix exists for: Bambara's text Bible is carried on the Faith Comes By Hearing
     record (au.m names the media it holds), so the panel offered Bambara the film alone while a
     full 66-book text sat one field away. Same field-list-goes-stale shape as the build script,
     so the fallback is spelled out here rather than assumed. */
  const fcbhText = c.au && /text/.test(c.au.m || '') ? c.au : null
  return {
    iso: b.c,
    language: c.l || b.l || '',
    credit: c.cr || null,
    scripture_url: c.s || (fcbhText ? fcbhText.u : ''),
    scripture_title: c.sv || (fcbhText ? fcbhText.n : ''),
    film_url: c.f || '',
    film_title: c.fT || '',
    /* ═══ A BRIDGE CAN CARRY TRAINING, NOT ONLY SCRIPTURE ══════════════════════════════════
     * The point of this map is not that somebody reads a page. It is that the first believers
     * in a group are trained, and become the first messengers to their own people and their
     * neighbours. Zume is the piece that does that, and it is published in 52 languages.
     * MEASURED across the 369 Doxa groups with nothing: ZERO have Zume in their own language,
     * and 182 have a bridge language that does. So for half the gap the training already
     * exists in a language their neighbours speak — and until now the map showed Zume only to
     * groups that already had something, which is the half that needs it least. */
    zume_url: c.z || '',
  }
}

/**
 * The Deaf way in, for a group that has nothing filmed in its own sign language.
 *
 * WHY IT IS OFFERED ONLY WHEN THERE IS NOTHING. A group that already has Scripture in its own
 * sign language does not need to learn a second one, and saying otherwise would read as a
 * recommendation to leave their own language behind. Same rule the spoken bridges follow.
 *
 * It is a BRIDGE and says so: SUN has to be learned, and it closes no gap in their own language.
 */
const deafBridge = computed(() => {
  const g = selectedGroup.value
  if (!g || !g.is_sign || !pinSun.value) return null
  const hasSomething = g.scripture_url || g.film_url || g.audio || g.bible_video ||
    g.gospel_audio || g.scripture_earth
  if (hasSomething) return null
  const key = String(g.countries || '').toLowerCase().replace(/[^a-z]/g, '')
  return { ...pinSun.value, organisation: pinSun.value.byCountry?.[key] || '' }
})

/* Resolved once per selection rather than on every reference in the template. */
const curatedBridgeRes = computed(() => bridgeResources(selectedGroup.value?.bridge, selectedGroup.value?._cardRes?.bridge))
const candidateBridgeRes = computed(() => bridgeResources(selectedGroup.value?.bridge_candidate, selectedGroup.value?._cardRes?.candidate))
/* The runner-up on a near-tie is named in the sentence above, so it needs links for exactly the
   reason the primary does: a bridge nobody can follow is not a way in. Naming two languages and
   linking one would make the second look like the lesser option when the whole point is that the
   map will not choose between them. */
const altBridgeRes = computed(() => bridgeResources(selectedGroup.value?.bridge_candidate?.alt, selectedGroup.value?._cardRes?.alt))

const tableLink = (q) => {
  const p = new URLSearchParams({ tab: 'links', ...q })
  return `../data-tables/index.html?${p.toString()}`
}

// When this map is composed ABOVE its own tables, "see all of these" must not be a
// navigation — the tables are already on screen and leaving the page throws the map away.
// Null on the standalone page, where the link is exactly right.
const composedFilter = inject('composedFilter', null)
const composed = computed(() => !!composedFilter)
function filterComposedTables(q) {
  if (!composedFilter) return
  composedFilter.value = { ...q, at: Date.now() }
  // Bring the tables into view; without this the filter applies somewhere the reader
  // cannot see and the click reads as having done nothing.
  const host = document.querySelector('gospel-resources-dashboard, gospel-resources-map')
  const root = host && host.shadowRoot
  const tables = root && root.querySelector('.gd-tables')
  if (tables && tables.scrollIntoView) tables.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

useShadowStyles(
  '.gm{position:absolute;inset:0;overflow:hidden}' +
  // inset:0 alone lost to mapbox-gl.css once that stylesheet finally reached this shadow
  // root: .mapboxgl-map carries position:relative, which cancelled the absolute box and
  // collapsed the canvas to 300px on a 900px viewport — a blank map that still reported
  // 2,107 pins to queryRenderedFeatures, because that API does not care whether anything
  // is visible. The size is stated outright now so no engine stylesheet can take it.
  '.gm-map{position:absolute;inset:0;width:100%;height:100%}' +
  // THE CREDIT CORNER (plugin-designer 5.8; this map has no footer sheet, its legend panel is at the top). The
  // engine's compact credit sits at the bottom END corner, opposite the gallery's round ☰ (bottom-right;
  // bottom-left in Arabic), and is NOT lifted by --map-fab-clearance: lifted, it floated up the page. Where the
  // round button can show, the corner sits above the scroll-edge strips so a tap on its (i) lands, and the
  // expanded credit stops 64px short of the far edge, clear of the button.
  '@media(max-width:767.98px){' +
  '.gm .maplibregl-ctrl-bottom-right,.gm .mapboxgl-ctrl-bottom-right{inset-inline-end:0 !important;inset-inline-start:auto !important;max-width:calc(100% - 64px);z-index:3}' +
  '.gm .maplibregl-ctrl-bottom-right .maplibregl-ctrl,.gm .mapboxgl-ctrl-bottom-right .mapboxgl-ctrl{margin:0 0 10px;margin-inline-end:10px}' +
  '}' +
  // LEGEND: a BOUNDED, left-anchored panel — NOT a full-width strip.
  // It used to be `left:8px;right:8px`, which is a strip spanning the whole map
  // (MEASURED 1264px of a 1280px map, 98.75%). That collided with the floating
  // control rail by construction: MapToolbar is inset-inline-end:3px with 32px
  // buttons, so ANY box reaching right:8px intersects it at every viewport. This
  // legend is the TALLER of the two siblings (127px — it carries the mode
  // toggle), so it ran under FOUR of the five buttons where cities ran under two.
  // The rail's z-index:10 beats this z-index:4, so the buttons stayed clickable
  // and the defect read as "the legend underlaps the controls" — reported 3x.
  // The fix imitates the shared SemanticTreeLegend, which has always done it
  // correctly: `left:8px; width:var(--map-legend-width,380px)`. Bounded and
  // left-anchored cannot reach the right rail, so the two can never overlap
  // again — a geometric guarantee, not a tuned z-index.
  // KEEP THIS BYTE-IDENTICAL to cities-internet/connectivity-map.vue: they are
  // clones and the whole point of fixing them together is that they not diverge.
  /* ═══ THE LEGEND MUST NEVER RUN OFF THE MAP ═══════════════════════════════════════════
     Reported from use: it overlapped the bottom of the page. It is absolutely
     positioned inside the map, so its height was whatever its content happened to be — on a
     short viewport that is taller than the map itself, and the overflow simply escaped.
     Capped to the map's own height and scrolled inside. The cap is the CONTAINER's height,
     not the viewport's, because this leaf is embedded and the two are not the same thing —
     using vh here would break on every partner page that gives the map a fixed box. */
  '.gm-linklist{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 8px;padding:7px 10px;' +
  'border:1px solid #d1d4cd;border-radius:8px;background:#f3f3f1;color:#3b463d;font:inherit;font-size:13px;' +
  'cursor:pointer;text-align:start}' +
  '.gm-linklist:hover,.gm-linklist:focus-visible{background:#e8eae4}' +
  '.gm-linklist span{color:#6d766e}' +
  '.is-dark .gm-linklist{background:rgba(59,70,61,.6);border-color:#6d766e;color:#f3f3f1}' +
  '.is-dark .gm-linklist span{color:#d1d4cd}' +
  /* ⚠ LOGICAL, NOT PHYSICAL (found in use, measured on main 52eeb0db). Under ar the five
     map controls mirror to the LEFT while `left:8px` kept the legend physically left, so the
     legend sat underneath all five of them. cities-internet shares this class name and passed
     for one reason: it anchors inline. Every physical left/right in this stylesheet that has a
     direction-dependent meaning is now logical — the anchor, the search clear button, the
     accent borders and the header's push-right. */
  /* ⚠ NO MAP BEHIND IT, SO NO BAND ABOVE IT. The sheet is a bottom panel capped at 62% of the
     map; in card mode there is nothing underneath, so on a phone the top 285px was empty grey.
     Full height, and the border-radius goes with it. */
  '.gm-sheet-full{top:0;max-height:100%;border-radius:0}' +
  '@media(min-width:700px){.gm-sheet-full{inset:0;width:auto;border-radius:0}}' +
  '.gm-card-wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;color:#6d766e;padding:24px;text-align:center}' +
  '@media(max-width:699px){.gm .map-toolbar.map-toolbar{top:var(--gm-toolbar-top,72px)}}' +
  // The strips sit at z-index 1: above the canvas, so a vertical drag on them scrolls the page, and UNDER
  // everything else, including the engine's corner controls (z 2), so the licence credit stays on top.
  '.map-scroll-edge{position:absolute;top:0;bottom:0;width:40px;z-index:1;touch-action:pan-y;pointer-events:auto;background:transparent}' +
  '.map-scroll-edge--left{left:0}' +
  '.map-scroll-edge--right{right:0}' +
  '.gm-legend{position:absolute;top:8px;inset-inline-start:8px;width:var(--map-legend-width,380px);' +
  'max-height:calc(100% - 16px);overflow-y:auto;overscroll-behavior:contain;' +
  'max-width:calc(100% - 16px);box-sizing:border-box;z-index:21;padding:8px 10px;' +
  'border-radius:10px;background:rgba(255,255,255,.94);color:#0f1419;' +
  "font:12px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.16)}" +
  // Narrow screens: the rail is still on the right, so the legend must stop short
  // of it rather than run under it. 46px = 32px button + 3px inset + clearance.
  '@media(max-width:480px){.gm-legend{width:auto;inset-inline-end:46px}}' +
  // THE LEGEND OVERLAPS ITS MAP CONTROLS (the legend's z-index 21 above). It shares one stacking context with the
  // gallery's ⓘ pointer (z 20; the gallery pane and this map's host form none of their own), and at 4 that pointer
  // was drawn over the open legend's title; the map's own toolbar is z 10. It never meets the gallery's round ☰
  // (z 15): the legend hangs from the top and stops at 70% on a phone, and the button sits at the bottom. While a
  // country or state SHEET is open the legend drops back under it (z 4 < the sheet's 6), so the sheet stays on top
  // and the round ☰ stays above the sheet; the gallery's drawer and the ⓘ dialog stay above all of it.
  '.gm.has-sheet .gm-legend{z-index:4}' +
  // The caret's box matches .stl-collapse-btn exactly (22x20, 5px radius, 1px border) so the
  // two legends read as the same control. The colours are this map's, because the palette is
  // the map's and the geometry is the fleet's.
  // Collapsed, the panel must SHRINK TO THE CARET. Hiding the contents alone would leave a
  // 380px box of empty background sitting over the map — the reader would have pressed
  // collapse and got a blank panel instead of their map back, which is worse than no control.
  '.gm-legend.closed{width:auto;padding:6px 8px;background:rgba(243,243,241,.92)}' +
  '.gm-legend.closed .gm-head{margin-bottom:0}' +
  '.gm-collapse{flex-shrink:0;width:22px;height:20px;' +
    'display:flex;align-items:center;justify-content:center;background:rgba(209,212,205,.4);' +
    'border:1px solid #d1d4cd;border-radius:5px;cursor:pointer;color:#6d766e;padding:0;' +
    'transition:transform .3s ease-out,color .1s,background .1s;transform-origin:center}' +
  '.gm-collapse:hover{color:#3b463d;background:rgba(146,177,149,.25);border-color:#92b195}' +
  '.gm-collapse svg{transition:transform .18s;transform:rotate(180deg)}' +
  '.gm-collapse.closed svg{transform:rotate(0deg)}' +
  '.is-dark .gm-legend{background:rgba(19,32,25,.95);color:#e5e7eb}' +
  '.gm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}' +
  '.gm-title{font-weight:700;font-size:15.5px}' +
  '.gm-keys{display:flex;flex-wrap:wrap;gap:5px 12px}' +
  '.gm-key{display:flex;align-items:center;gap:5px;font-size:14px;white-space:nowrap}' +
  // This one label is a phrase, not a legend word, so it is allowed to wrap rather than
  // be clipped by the nowrap above.
  '.gm-key.wide{white-space:normal;text-align:start;line-height:1.25}' +
  '.gm-sw{width:12px;height:12px;border-radius:3px;flex:none}' +
  '.gm-dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block;' +
  'border:1.4px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.18);vertical-align:-1px}' +
  '.gm-pinkey{margin-top:7px;padding-top:6px;border-top:1px solid rgba(0,0,0,.12)}' +
  '.is-dark .gm-pinkey{border-top-color:rgba(255,255,255,.16)}' +
  '.gm-keys-btn{gap:4px 8px}' +
  '.gm-kbtn{border:1px solid transparent;background:transparent;color:inherit;font:inherit;font-size:14px;' +
  'padding:2px 6px;border-radius:999px;cursor:pointer;min-height:24px;display:inline-flex;align-items:center;gap:5px}' +
  '.gm-kbtn:hover{background:#e9ebe6;border-color:#d1d4cd}' +
  '.gm-kbtn.on{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.gm-kbtn b{font-variant-numeric:tabular-nums;opacity:.75;font-weight:700}' +
  '.gm-filtered{margin-top:5px;font-size:13.5px;line-height:1.45;color:#3b463d}' +
  '.is-dark .gm-filtered{color:#e5e7eb}' +
  '.gm-kclear{border:1px solid #d1d4cd;background:#fff;color:#3b463d;font:600 10.5px inherit;' +
  'padding:3px 8px;border-radius:6px;cursor:pointer;margin-inline-start:4px;min-height:24px}' +
  '.gm-pinkey-h{font-size:14px;font-weight:600;margin-bottom:4px}' +
  '.gm-caveat{margin-top:5px;font-size:13.5px;opacity:.72;line-height:1.4}' +
  '.gm-dot-hole{border:2.5px solid #7d3b30;box-sizing:border-box}' +
  '.gm-why{margin-top:6px}' +
  '.gm-why-sum{cursor:pointer;font-weight:600;opacity:.9;list-style:none;padding:2px 0}' +
  '.gm-why-sum::-webkit-details-marker{display:none}' +
  '.gm-why-sum::before{content:"\\25B8  "}' +
  'details[open]>.gm-why-sum::before{content:"\\25BE  "}' +
  '.gm-why-body{margin-top:4px;opacity:.9}' +
  /* Quiet enough that the gap itself still reads first: the row is about what is MISSING, and
     the way in is the footnote to it, not the headline. */
  '.gm-pg-way{display:block;font-size:12.5px;color:#3b463d;opacity:.8;margin-top:2px}' +
  '.gm-credit{font-size:12.5px;color:#6d766e;line-height:1.35}' +
  /* The contact is a LINK inside a grey credit line, so it carries the ink colour and an
     underline of its own — grey-on-grey would hide the one part of the sentence a
     mobiliser is meant to act on. */
  '.gm-org{color:#3b463d;text-decoration:underline;text-underline-offset:2px}' +
  '.gm-org:hover{color:#2c352e}' +
  '.is-dark .gm-org{color:#f3f3f1}' +
  '.is-dark .gm-credit{color:#d1d4cd}' +
  '.is-dark .gm-pg-way{color:#d1d4cd}' +
  '.gm-prose-note{opacity:.9;font-weight:600}' +
  // DETAIL: a bottom sheet on a phone, a corner card on desktop.
  // ON A PHONE THE SHEET IS THE PAGE, and the shared pin hint sits on top of it. The hint
  // is a library component with z-index 2147482000 and a deliberate "only the reader closes
  // it" rule, which is right for a bare map — but once a group sheet is open the invitation
  // to tap a dot is both redundant and obstructive: measured at 390px it covered "Also speak
  // German, Standard (25)" and the first row under it.
  // Hidden rather than out-stacked. Raising this sheet above 2147482000 would be a z-index
  // arms race with shared code, and the hint lives inside this component's own shadow root,
  // so scoping it here costs nothing and changes nothing for any other map.
  // Desktop is untouched: there the sheet is a 330px corner card and the two never collide.
  '@media(max-width:699px){.gm.has-sheet .pin-hint{display:none}}' +
  '.gm-sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;max-height:62%;overflow-y:auto;' +
  'background:#fff;color:#0f1419;border-radius:14px 14px 0 0;padding:14px 16px 22px;' +
  "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 -6px 26px rgba(0,0,0,.28)}" +
  // The corner card sits at the inline END, opposite the legend (inline START), in both directions.
  // It said right:14px, so in Arabic the legend mirrored to the right and the card stayed on it,
  // covering it at every desktop width. Cities' copy of this rule was already logical.
  '@media(min-width:700px){.gm-sheet{inset-inline-start:auto;inset-inline-end:14px;bottom:14px;width:330px;border-radius:12px}}' +
  '.is-dark .gm-sheet{background:#132019;color:#e5e7eb}' +
  '.gm-sh-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}' +
  '.gm-sh-name{font-weight:800;font-size:18px}' +
  '.gm-x{margin-inline-start:auto;border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit;' +
  'font:600 12px inherit;padding:6px 12px;border-radius:8px;cursor:pointer;min-height:34px}' +
  '.gm-stat{display:flex;justify-content:space-between;gap:12px;padding:4px 0;' +
  'border-bottom:1px solid rgba(0,0,0,.07);font-variant-numeric:tabular-nums}' +
  '.is-dark .gm-stat{border-bottom-color:rgba(255,255,255,.09)}' +
  '.gm-stat b{font-weight:700}' +
  '.gm-note{margin-top:9px;font-size:14px;line-height:1.5;opacity:.75}' +
  '.gm-err{position:absolute;top:50%;left:0;right:0;text-align:center;font-size:16px;opacity:.7}' +
  // MODE TOGGLE — sits in the legend, because the legend is what it changes.
  '.gm-fold{width:100%;margin:0 0 6px;border:1px solid #d1d4cd;background:#f3f3f1;color:#3b463d;font:600 11px inherit;padding:6px 10px;border-radius:8px;cursor:pointer;min-height:32px}' +
  '.gm-fold:hover{background:#e9ebe6}' +
  '.gm-search{position:relative;margin-bottom:6px}' +
  '.gm-q{width:100%;box-sizing:border-box;border:1px solid #d1d4cd;border-radius:8px;background:#fff;color:#3b463d;font:12px inherit;padding:7px 26px 7px 9px;min-height:32px}' +
  '.gm-q:focus{outline:2px solid #92b195;outline-offset:1px}' +
  '.gm-qx{position:absolute;inset-inline-end:4px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#6d766e;font-size:19px;line-height:1;cursor:pointer;padding:4px 6px;min-height:24px}' +
  '.gm-qres{margin:-2px 0 7px;border:1px solid #d1d4cd;border-radius:8px;background:#fff;overflow:hidden}' +
  '.gm-qrow{display:flex;align-items:baseline;gap:6px;width:100%;text-align:start;border:0;background:transparent;font:inherit;font-size:14px;color:#3b463d;padding:6px 8px;cursor:pointer;min-height:30px;border-bottom:1px solid #eceee9}' +
  '.gm-qrow:last-child{border-bottom:0}' +
  '.gm-qrow:hover{background:#f3f3f1}' +
  '.gm-qn{font-weight:700}' +
  '.gm-ql{opacity:.7}' +
  '.gm-qnone,.gm-qmore{padding:6px 8px;font-size:13.5px;color:#6d766e}' +
  '.gm-modes{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}' +
  '.gm-modes .gm-fold{width:auto;margin:0;margin-inline-start:auto}' +
  '.gm-mode{font:600 10.5px inherit;padding:4px 10px;border-radius:999px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit;min-height:26px}' +
  '.gm-mode.on{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.is-dark .gm-mode{border-color:rgba(255,255,255,.22)}' +
  '.is-dark .gm-mode.on{background:#92b195;border-color:#92b195;color:#0f1419}' +
  // RESOURCE LIST inside the sheet.
  '.gm-scope{margin:7px 0 0;font-size:14.5px;line-height:1.45;color:#3b463d}' +
  '.gm-scope b{font-weight:700}' +
  '.is-dark .gm-scope{color:#e5e7eb}' +
  // Same frame as the sign-language note: a caveat, visually separate from the chips so it
  // never reads as another resource.
  // Quiet, not alarming: it is a caveat on a real gap, not a dismissal of it.
  // Five tabs no longer fit one row at phone width; wrapping keeps every label readable
  // rather than clipping each to a few characters.
  '.gm-gswitch{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}' +
  '.gm-gtab{min-width:88px}' +
  '.gm-gtab{flex:1;font:600 11px inherit;padding:5px 8px;border-radius:999px;cursor:pointer;' +
  'border:1px solid #d1d4cd;background:#fff;color:#3b463d}' +
  '.gm-gtab.on{background:#92b195;border-color:#92b195;color:#fff}' +
  '.is-dark .gm-gtab{background:transparent;border-color:rgba(255,255,255,.22);color:#e5e7eb}' +
  '.is-dark .gm-gtab.on{background:#92b195;color:#10241a}' +
  '.gm-pg-rel{display:block;margin-top:2px;font-size:13px;color:#6d766e;font-style:italic}' +
  '.is-dark .gm-pg-rel{color:#9fb3a4}' +
  '.gm-rel{margin:8px 0 0;padding:8px 10px;border:1px solid #d1d4cd;border-inline-start:3px solid #92b195;' +
  'border-radius:6px;background:#fff;font-size:14.5px;line-height:1.5}' +
  '.gm-rel code{font-size:14px;background:#f3f3f1;padding:1px 4px;border-radius:3px}' +
  '.is-dark .gm-rel{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18);color:#e5e7eb}' +
  '.gm-sign{margin:8px 0 0;padding:8px 10px;border:1px solid #d1d4cd;border-inline-start:3px solid #6d766e;' +
  'border-radius:8px;background:#f3f3f1;color:#3b463d;font-size:14.5px;line-height:1.5}' +
  '.is-dark .gm-sign{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18);color:#e5e7eb}' +
  '.gm-pray{display:block;margin:8px 0 0;padding:9px 11px;border-radius:8px;text-decoration:none;' +
  'background:#3b463d;color:#fff;font:600 12.5px inherit;text-align:center}' +
  '.gm-pray:hover,.gm-pray:focus-visible{background:#2f382f}' +
  '.gm-pray-n{display:block;margin-top:2px;font-weight:500;font-size:14px;opacity:.85}' +
  '.gm-tablink{display:block;margin:10px 0 2px;padding:9px 12px;border:1px solid #d1d4cd;border-inline-start:3px solid #92b195;border-radius:8px;background:#f3f3f1;color:#3b463d;font-weight:600;font-size:15.5px;text-decoration:none;min-height:36px;box-sizing:border-box}' +
  '.gm-tablink:hover{background:#e9ebe6}' +
  '.is-dark .gm-tablink{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18);color:#e5e7eb}' +
  '.gm-stat-alt span{opacity:.72}' +
  '.gm-sec{margin-top:12px}' +
  '.gm-sec-h{font-weight:800;font-size:15px;letter-spacing:.02em;margin-bottom:6px}' +
  '.gm-load{padding:10px 0;font-size:14.5px;opacity:.65}' +
  // .gm-pg is now the SHELL only. The resource rows are a <div> shell (so the chips
  // inside can be real anchors) while the no-resource rows are still a <button>; both
  // must look identical, so the shell carries the box and .gm-pg-btn/.gm-pg-open carry
  // the interactive bits. cursor:pointer is NOT on the shell — on a resource row the
  // gaps between the name and the chips are not clickable, and saying otherwise lies.
  '.gm-pg{width:100%;box-sizing:border-box;text-align:start;display:block;padding:8px 9px;' +
  'margin-bottom:6px;border-radius:8px;' +
  'border:1px solid rgba(0,0,0,.10);background:rgba(0,0,0,.02);color:inherit;font:inherit}' +
  '.is-dark .gm-pg{border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.03)}' +
  '.gm-pg-btn{cursor:pointer;text-decoration:none;color:inherit}' +
  // The drill-in control on a resource row: a bare button that inherits the shell's
  // look, so the row still reads as one tap-target for the name + language line.
  '.gm-pg-open{display:block;width:100%;text-align:start;padding:0;margin:0;border:0;' +
  'background:transparent;color:inherit;font:inherit;cursor:pointer}' +
  '.gm-pg-n{display:block;font-weight:700;font-size:15.5px}' +
  '.gm-pg-l{display:block;font-size:14px;opacity:.75;margin-top:1px}' +
  '.gm-code{display:inline-block;font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;' +
  'padding:1px 5px;border-radius:4px;background:rgba(0,0,0,.09);margin-inline-start:5px;vertical-align:1px}' +
  '.is-dark .gm-code{background:rgba(255,255,255,.12)}' +
  '.gm-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}' +
  // nowrap keeps the short status chips ("Film - link checked") on one line, but a Door43
  // entry can be "Aligned Bible (translationCore-Create-BCS) - Door43 - Portions of both",
  // which simply ran off the edge of a 330px sheet and could not be read at all. Long chips
  // wrap instead; max-width keeps them inside the panel either way.
  '.gm-chip{font-size:13px;padding:2px 7px;border-radius:999px;white-space:nowrap;max-width:100%;' +
  'background:rgba(0,0,0,.06);text-decoration:none;color:inherit;border:1px solid transparent}' +
  '.gm-chip.wrap{white-space:normal;overflow-wrap:anywhere;line-height:1.35}' +
  '.is-dark .gm-chip{background:rgba(255,255,255,.08)}' +
  '.gm-chip.ok{background:rgba(16,185,129,.16);border-color:rgba(16,185,129,.35)}' +
  '.gm-chip.bad{background:rgba(180,35,24,.16);border-color:rgba(180,35,24,.38)}' +
  '.gm-chip.warn{background:rgba(224,122,43,.18);border-color:rgba(224,122,43,.38)}' +
  '.gm-chip.meh{background:rgba(120,130,140,.16);border-color:rgba(120,130,140,.30)}' +
  // APPROXIMATE: the same green family as a confirmed chip, because the resource is real,
  // but DASHED and unfilled so it never reads as the same claim at a glance.
  '.gm-chip.approx{background:transparent;border-style:dashed;border-color:rgba(16,185,129,.55)}' +
  '.gm-chip.approx em{font-style:normal;opacity:.7}' +
  // Only an ANCHOR chip gets the pointer + underline. A <span> chip ("none found",
  // "unknown") must keep looking inert, because it is.
  'a.gm-chip{cursor:pointer}' +
  'a.gm-chip:hover,a.gm-chip:focus-visible{text-decoration:underline}' +
  '.gm-none{font-size:14px;opacity:.7}' +
  '.gm-back{border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit;' +
  'font:600 11px inherit;padding:5px 11px;border-radius:8px;cursor:pointer;min-height:30px}' +
  '.is-dark .gm-back{border-color:rgba(255,255,255,.22)}' +
  '.gm-more{font-size:14px;opacity:.66;margin-top:2px}' +
  /* ═══ SIZED FOR A PHONE, MEASURED AT 390x844 ════════════════════════════════════════════════
   * History: the Gap / Resources toggle rendered 48x26 and 129x26, and the fold button 316x32; they
   * went to 44px as the comfortable thumb target. Then the phone review found the folded legend too
   * big (three rows, pill-round buttons, about 30% of the page), so they are 32px now and the fold
   * button shares the mode row. 32px is still above WCAG 2.5.8's 24x24 AA floor. Narrow screens only;
   * on a desktop these sit in a 290px card beside a pointer and 26px is the right density there.
   *
   * ⚠ AND IT MUST COME LAST. Written above .gm-mode's own rule it changed the font size and nothing
   * else: a media query adds NO specificity, and that rule sets min-height:26px, so the later plain
   * selector won. Measured by reading the computed style — min-height resolved to 26px while my
   * font-size had applied, which is what told me the rule was live and merely losing. */
  // OPEN, the phone legend stops at 70% of the map and scrolls inside rather than covering all of it.
  // FOLDED, it is one search line and one row of buttons: 30px buttons, a 28px search, 4px gaps and
  // 6px/8px panel padding. At 32px with 10px sides the Arabic row overflowed by 9px and wrapped to a
  // third line (133px folded at 390); these sizes keep it on two lines in both directions.
  '@media(max-width:699px){' +
  '.gm-mode{min-height:30px;padding:0 8px;font-size:12px;border-radius:8px}' +
  '.gm-fold{min-height:30px;font-size:12px;padding:3px 8px}' +
  '.gm-q{min-height:28px;padding:4px 26px 4px 9px}' +
  '.gm-search{margin-bottom:4px}' +
  '.gm-modes{gap:4px;margin-bottom:4px}' +
  '.gm-legend{max-height:70%;padding:6px 8px}' +
  '}',
  'doxa-gospel-map',
)
</script>

<template>
  <!-- THE ROOT FOLLOWS THE LOCALE; THE ENGLISH PROSE DOES NOT.
       This root carried dir="ltr" while every string here was English — an RTL flip over
       English text had clipped the legend title's first letter, rendered "30-59%" as
       "59%-30", and thrown sentence-ending periods to the START of lines. The chrome is
       translated now, so Arabic gets the RTL layout it should have, and the blanket
       override is gone. What stays LTR is each block of English EXPLANATORY PROSE, marked
       where it sits: those are still English by decision, and English inside an RTL box is
       the defect this replaced. -->
  <div class="gm" :class="{ 'is-dark': isDark, 'has-sheet': !!(selected || showGapList || selectedProvince) }" :style="narrow && toolbarTop ? { '--gm-toolbar-top': toolbarTop + 'px' } : null">
    <div v-show="!cardMode" ref="mapEl" class="gm-map"></div>
    <!-- The edge scroll strips: direct siblings of the map inside .gm, the wrapper handed to
         useEdgeScrollAffordance. The single-card page has no map, so no strips. -->
    <template v-if="EDGE_SCROLL_AFFORDANCE && !cardMode">
      <div class="map-scroll-edge map-scroll-edge--left" />
      <div class="map-scroll-edge map-scroll-edge--right" />
    </template>
    <!-- ⚠ CARD MODE RENDERED BLANK TWICE. First because the sheet read selected.country when card
         mode had no country; then because the sheet mounted on cardMode ALONE, before the shard
         fetch had set it. The sheet now waits for data, and this is what stands in until then —
         a card that is loading must look like one, and a card that failed must say so. -->
    <div v-if="cardMode && !selectedGroup" class="gm-card-wait">
      <span v-if="err">{{ err }}</span>
      <span v-else>{{ t('gospel.sheet.loading') }}</span>
    </div>

    <!-- Shared control rail — MapToolbar self-positions top-right. Zoom/Location/
         Fullscreen gate on the live map instance; ShareButton needs neither and
         always renders so the map is embeddable. -->
    <!-- The TOP control is "What can this map do?": it opens the gallery's MapInfo for this tab, which then
         hides its own floating button. It renders only where a MapInfo answers it, so a standalone page
         has no dead button. Round and spaced, the library default. -->
    <MapToolbar v-if="mapRef">
      <MapInfoButton    :is-dark="isDark" />
      <ZoomInButton     :map="mapRef"          :is-dark="isDark" />
      <ZoomOutButton    :map="mapRef"          :is-dark="isDark" />
      <LocationButton   :map="mapRef"          :is-dark="isDark" />
      <FullscreenButton :map-container="mapEl" :is-dark="isDark" />
      <ShareButton      :is-dark="isDark"      :embed-path="shareEmbedPath" />
    </MapToolbar>

    <div v-if="!cardMode" ref="legendEl" class="gm-legend" :class="{ closed: !legendOpen && !narrow }">
      <!-- ═══ SOMEBODY ELSE'S LIST, SAID PLAINLY ════════════════════════════════════════
           First thing in the legend, because it is the first thing that is different about
           this map: the reader is looking at a subset somebody chose. Two numbers and one
           existing, translated verb — "Show all groups" — so the whole notice costs nothing
           to localise and still says what happened and how to undo it. -->
      <button v-if="linkActive" type="button" class="gm-linklist" @click="clearLinkList">
        <b dir="ltr">{{ fmt(linkMatched) }} / {{ fmt(pinRows.length) }}</b>
        <span>{{ t('gospel.legend.showAll') }}</span>
      </button>
      <div class="gm-search">
        <!-- The full phrase clips to "…ISO cod" at 390px, which loses the one word that tells
             a reader an ISO CODE is accepted at all. The short form keeps all three things it
             accepts; the aria-label stays long, because a screen reader has no width. -->
        <input type="search" class="gm-q" v-model="q"
               :placeholder="narrow ? t('gospel.search.placeholderShort') : t('gospel.search.placeholder')"
               :aria-label="t('gospel.search.aria')">
        <button v-if="q" type="button" class="gm-qx" @click="q = ''" :aria-label="t('gospel.search.clear')">&times;</button>
      </div>
      <div v-if="q.trim().length >= 2" class="gm-qres">
        <div v-if="!matches.length" class="gm-qnone">{{ t('gospel.search.none') }}</div>
        <template v-else>
          <button v-for="m in matches.slice(0, 8)" :key="m.i" type="button" class="gm-qrow" @click="gotoMatch(m)">
            <i class="gm-dot" :style="{ background: PIN_COLOR[m.tier] }"></i>
            <span class="gm-qn">{{ m.name }}</span>
            <span class="gm-ql">{{ m.lang || t('gospel.ui.unnamed') }} · {{ m.iso3 }}</span>
          </button>
          <div v-if="matches.length > 8" class="gm-qmore"><bdi dir="ltr">Showing 8 of {{ fmt(matches.length) }} matches — keep typing to narrow.</bdi></div>
        </template>
      </div>

      <div class="gm-modes">
        <button type="button" class="gm-mode" :class="{ on: mode === 'gap' }" @click="setMode('gap')">{{ t('gospel.mode.gap') }}</button>
        <button type="button" class="gm-mode" :class="{ on: mode === 'coverage' }" @click="setMode('coverage')">{{ t('gospel.mode.coverage') }}</button>
        <!-- On a phone the fold button shares the mode row: two rows folded instead of three. -->
        <button v-if="narrow" type="button" class="gm-fold" @click="toggleLegend"
                :aria-expanded="legendOpen ? 'true' : 'false'">
          <!-- The label names the ACTION: "Expand legend" / "Collapse legend", the same words, in all 11
               locales, as the desktop collapse button's aria.expandLegend / aria.collapseLegend. They live in
               this map's own gospel.ui keys because Cities' area-scoped translator cannot read the aria area
               where the gallery has no vue-i18n: both maps keep their own keys, same words. (Never write that
               translator's call with an area name in a comment: the build's area scan reads comments too.)
               "Key & notes" and then "Key & filters" named what sits behind the button, and readers did not
               know what a "key" was. The panel still holds the pin filters and the way into the gap list. -->
          {{ legendOpen ? t('gospel.ui.hideKey') : t('gospel.ui.showKey') }}
        </button>
      </div>
      <!-- ★ HEADER ROW, NOT A FLOATING CORNER. The caret used to be absolutely positioned over
           the panel's top-right, and the title was hidden when collapsed — so collapsing left a
           lone glyph floating on the map with nothing saying what it would reopen. The shared
           SemanticTreeLegend puts its caret INLINE in the title bar as a flex item (no
           positioning at all, just flex-shrink:0), and that is what makes it read as part of the
           panel rather than as something dropped on top of it.
           The header stays visible when collapsed, so the control always carries its own label. -->
      <div class="gm-head">
        <div v-show="legendOpen" class="gm-title">
        {{ mode === 'gap'
          ? t('gospel.legend.title')
          : t('gospel.legend.titleCoverage') }}
      </div>
        <!-- DESKTOP COLLAPSE. Mobile has always had one; desktop had none, so a reader who
             wanted the map under the legend had no way to move it. Deliberately NOT a new
             control: same 22x20 caret, same rotation, same aria contract as the shared
             SemanticTreeLegend's .stl-collapse-btn, which LegendMobile also copies. Matching it
             costs nothing and means a reader who has met one legend has met this one. -->
        <button v-if="!narrow" type="button" class="gm-collapse" :class="{ closed: !legendOpen }"
                :title="legendOpen ? t('aria.collapseLegend') : t('aria.expandLegend')"
                :aria-label="legendOpen ? t('aria.collapseLegend') : t('aria.expandLegend')"
                :aria-expanded="String(legendOpen)" @click="toggleLegend">
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
      <div v-show="legendOpen" class="gm-keys">
        <span v-for="b in activeBands" :key="b.id" class="gm-key">
          <i class="gm-sw" :style="{ background: b.color }"></i>{{ t(b.labelKey) }}
        </span>
      </div>
      <!-- The tally sentence is still English prose, so it declares its own direction
           like the caveat below it. -->
      <div v-show="legendOpen" class="gm-pinkey" v-if="pinTally.total">
        <!-- Translated rather than pinned LTR. Pinning it left-aligned an English sentence
             inside the RTL panel and the second line ran off the left edge — "th a link".
             It is a COUNT, not doctrinal prose, so it belongs in the catalogue with the
             rest of the chrome, and then the bidi problem does not exist. -->
        <div class="gm-pinkey-h">
          {{ t('gospel.legend.tallyEach') }} <i class="gm-dot" style="background:#6d766e"></i>
          {{ t('gospel.legend.tallyIs') }}
          {{ fmt(pinTally.total) }} {{ t('gospel.legend.tallyOf') }}
          {{ fmt(pinTally.linked) }} {{ t('gospel.legend.tallyLink') }}
        </div>
        <!-- The key IS the filter: a reader who has just understood what a colour means is
             exactly the reader who wants to see only that colour. Two controls would be one
             too many. -->
        <div v-show="legendOpen" class="gm-keys gm-keys-btn">
          <button type="button" class="gm-key gm-kbtn" :class="{ on: pinFilter === 'both' }"
                  @click="setPinFilter(pinFilter === 'both' ? 'all' : 'both')"
                  :aria-pressed="pinFilter === 'both'">
            <i class="gm-dot" :style="{ background: PIN_COLOR[2] }"></i>{{ t('gospel.legend.tier2') }}
            <b>{{ fmt(pinTally.both) }}</b>
          </button>
          <button type="button" class="gm-key gm-kbtn" :class="{ on: pinFilter === 'some' }"
                  @click="setPinFilter(pinFilter === 'some' ? 'all' : 'some')"
                  :aria-pressed="pinFilter === 'some'">
            <i class="gm-dot" :style="{ background: PIN_COLOR[1] }"></i>{{ t('gospel.legend.tier1') }}
            <b>{{ fmt(pinTally.partial) }}</b>
          </button>
          <button type="button" class="gm-key gm-kbtn" :class="{ on: pinFilter === 'none' }"
                  @click="setPinFilter(pinFilter === 'none' ? 'all' : 'none')"
                  :aria-pressed="pinFilter === 'none'">
            <!-- The swatch must BE the mark it explains. Tier 0 is a hole on the map — white
                 core, oxblood rim — so a plain filled dot here would teach the wrong symbol,
                 and a white one would vanish against this panel. -->
            <i class="gm-dot gm-dot-hole" :style="{ background: PIN_COLOR[0], borderColor: PIN_RIM[0] }"></i>{{ t('gospel.legend.tier0') }}
            <b>{{ fmt(pinTally.none) }}</b>
          </button>
          <!-- ═══ THE NUMBER BESIDE THE GAP IS THE ONE A MOBILISER CAME FOR ══════════════════
               "370 with nothing found" is where the map used to stop, and it reads as a wall.
               Every one of those groups now has somewhere to start — a curated bridge, a
               language their own country speaks, or SUN for a Deaf group — and none of that was
               visible without opening 370 pins one at a time.
               It says "a way in", not "reached": a bridge has to be learnt, it is not Scripture
               in their language, and the gap the red dot marks is unchanged. Counted from the
               same rows as the number above it. English prose, like the rest of this block. -->
          <p v-if="pinTally.none && pinTally.wayIn" class="gm-caveat" dir="ltr" style="margin:2px 0 0">
            <!-- "369 of those 369" is the normal case now and reads like a coincidence, so the
                 all-covered wording says what it means. Still two different claims: every group
                 has SOMEWHERE TO START, and not one of them has the gospel in their own
                 language. -->
            <!-- ⚠ THIS SENTENCE IS NOT PROSE AND MUST NOT STAY ENGLISH. It is the legend's one
                 piece of news — that almost every group with nothing has somewhere to start — and
                 it measured as the Latin left in an Arabic legend once the explainer was
                 folded away. Through t() with its numbers as parameters, so it renders the catalogue's
                 English until the key lands and then switches. The CAVEAT that followed it ("a way
                 in is not the gospel in their own language") moved into the fold below, where the
                 rest of the basis lives: it qualifies the news rather than being it. -->
            <b>{{ pinTally.wayIn === pinTally.none
              ? t('gospel.guide.wayInAll', { n: fmt(pinTally.none) })
              : t('gospel.guide.wayInSome', { n: fmt(pinTally.wayIn), total: fmt(pinTally.none) }) }}</b>
            {{ t('gospel.guide.wayInWhat') }}
          </p>
          <!-- Not a colour, so it carries no dot: this cuts ACROSS the three tiers rather
               than naming one of them. It is the translation-priority question. -->
          <button type="button" class="gm-key gm-kbtn wide" :class="{ on: pinFilter === 'hnr' }"
                  @click="setPinFilter(pinFilter === 'hnr' ? 'all' : 'hnr')"
                  :aria-pressed="pinFilter === 'hnr'"
                  :title="t('gospel.legend.hnrTip')">
            {{ t('gospel.legend.hnr') }}
            <b>{{ fmt(pinTally.hnr) }}</b>
          </button>
        </div>
        <div v-if="pinFilter !== 'all' && legendOpen" class="gm-filtered">
            <!-- ONE SENTENCE, ONE KEY: the bold phrase varies by filter, so each branch is its own
                 key and slots into the sentence. Concatenating "Showing only" with a branch would
                 fix the clause order in English. -->
            {{ t('gospel.gap.showingOnly', { what: t('gospel.gap.kind.' + (pinFilter === 'none' ? 'none' : pinFilter === 'some' ? 'some' : pinFilter === 'hnr' ? 'hnr' : 'all')) }) }}
          <button type="button" class="gm-kclear" @click="setPinFilter('all')">{{ t('gospel.filter.showAll', { count: fmt(pinTally.total) }) }}</button>
          <button v-if="pinFilter === 'none'" type="button" class="gm-kclear" @click="openGapList">
            {{ t('gospel.sheet.seeLargest', { n: 40 }) }}
          </button>
        </div>
      </div>
      <!-- The ONE translated line about the English below it. Rendered outside the LTR
           block so it reads in the reader's own direction, and only when the locale is
           not English — telling an English reader that the English is English is noise. -->
      <div v-show="legendOpen" v-if="!isEnglish" class="gm-caveat gm-prose-note">
        {{ t('gospel.prose.english') }}
      </div>
      <!-- ═══ BOTTOM LINE UP FRONT ═══════════════════════════════════════════════════════
             The three bold lines are the whole instruction set: what a dot is, what "none
             found" does not mean, and that a country is tappable. They are short, translated,
             and they are what a mobiliser opens this map for.
             Behind them sat 232 words of English prose — every word true and load-bearing, and
             none of it needed before you act. It was also half the reason the legend overflowed
             the page. Folded, not deleted: the basis is one click away, it stays English by the
             standing decision on prose, so folding costs nothing to translate and removes 232
             words from first sight. -->
        <div v-show="legendOpen" class="gm-caveat" dir="ltr">
          <b>{{ t('gospel.guide.dotVsCountry') }}</b>
          <br><b>{{ t('gospel.guide.noneFoundShort') }}</b>
          <br><b>{{ t('gospel.guide.tapCountry') }}</b>
          <details class="gm-why">
            <summary class="gm-why-sum">{{ t('gospel.guide.howNumbersMade') }}</summary>
            <div class="gm-why-body">
              <span dir="ltr">A way in is not the gospel in someone's own language; the gap it is
              counted against is unchanged by it.</span>
              <span dir="ltr"> A country is a COUNT of those groups — how many of
        Doxa's are there with nothing found — never a percentage: {{ fmt(countryScale.small) }} of
        these {{ fmt(countryScale.countries) }} countries hold one or two groups, and a share over a
        denominator of two says nothing. A country Doxa does
        not work is left UNCOLOURED rather than drawn as covered, because this dataset has no
        finding about it either way.</span>
              <span dir="ltr">The pools checked are eBible, PNG.Bible, JESUS Film, Door43,
        Faith Comes By Hearing, Scripture Earth and Global Recordings Network). GRN is reached
        through their 5fish site, and that sweep is now <b>finished for every group in the gap</b>
        — every language with nothing else was asked for, at the ten-second crawl delay they
        request — so “nothing found” no longer rests on an unread pool. Codes that already carry
        a resource were not all asked, because the sweep was spent on the gap first. What is still
        unread is api.bible, the Digital Bible Library, progress.bible and YouVersion, which need
        credentials or permission this build does not have. Never proof of absence.
        <template v-if="mode === 'coverage'">
          A “found” colour is equally bounded: it counts what these pools list, not everything that exists.
        </template></span>
            </div>
          </details>
        </div>
    </div>

    <div v-if="err" class="gm-err">{{ err }}</div>

    <!-- Tap a country: bottom sheet on mobile, corner card on desktop. -->
    <!-- ═══ A PROVINCE, WHEN ONE IS TAPPED ═══════════════════════════════════════════════
         Sits above the country sheet because it is the narrower answer to the same question,
         and a reader who tapped a province asked about the province. Closing it returns to the
         country rather than to the world, so the drill-down is reversible one step at a time.
         English prose in the caveat line, per the standing decision. -->
    <div v-if="selectedProvince" class="gm-sheet">
      <div class="gm-sh-head">
        <button type="button" class="gm-back" @click="closeProvince">‹ {{ selectedProvince.country }}</button>
        <button type="button" class="gm-back" @click="closeSheet">{{ t('gospel.sheet.close') }}</button>
      </div>
      <h3 class="gm-sh-title">{{ selectedProvince.province }}</h3>
      <div class="gm-stat"><span>{{ t('gospel.stat.peopleGroups') }}</span><b>{{ fmt(selectedProvince.groups) }}</b></div>
      <div class="gm-stat"><span>{{ t('gospel.stat.population') }}</span><b>{{ fmt(selectedProvince.people) }}</b></div>
      <div class="gm-stat"><span>{{ t('gospel.legend.tier0') }}</span><b>{{ fmt(selectedProvince.zero_access_groups) }}</b></div>
      <div class="gm-stat" v-if="selectedProvince.zero_access_people">
        <span>{{ t('gospel.stat.peopleAffected') }}</span><b>{{ fmt(selectedProvince.zero_access_people) }}</b>
      </div>
      <p v-if="selectedProvince.zero_access_examples" class="gm-note" dir="ltr" style="margin:6px 0 0">
        Largest with nothing: <b>{{ selectedProvince.zero_access_examples }}</b>
        <!-- The basis travels WITH the answer. This line used to read "chosen for the country, not
             this province" on every row, which was true then and is now true of five rows in
             forty-six; printing it on all of them would understate the other forty-one and
             printing none of them would overstate these five. -->
        <template v-if="selectedProvince.ways_in"><br>Way in: {{ selectedProvince.ways_in }} — {{ selectedProvince.ways_in_basis || 'country-level' }}.</template>
      </p>
      <!-- N of M, the same rule as the country sheet: the denominator is the groups HERE with a
           prayer page, never the province. -->
      <div class="gm-stat" v-if="selectedProvince.prayer_pages">
        <span>{{ t('gospel.tabs.noprayer') }}</span>
        <b>{{ fmt(selectedProvince.nobody_praying_groups) }} / {{ fmt(selectedProvince.prayer_pages) }}</b>
      </div>
      <p class="gm-note" dir="ltr" style="margin:6px 0 0">
        A group is placed in a province from its dot on the map, which marks a people group, not a
        settlement. The dot's position is approximate, so near a border it can fall on the wrong side.
      </p>
      <!-- The THIRD requirement at the province grain: clicking a place filters the
           table to it. Same split as the country and language links — a filter when the tables
           are already beneath this map, a link when they are not. -->
      <button v-if="composed" type="button" class="gm-tablink"
              @click="filterComposedTables({ tab: 'province', province: selectedProvince.province, label: selectedProvince.province })">
        {{ selectedProvince.province }} ↓
      </button>
      <a v-else class="gm-tablink"
         :href="tableLink({ tab: 'province', province: selectedProvince.province, label: selectedProvince.province })">
        {{ selectedProvince.province }} →
      </a>

      <!-- ═══ THE MOVE, AT THE GRAIN A TEAM IS SENT TO ══════════════════════════════════════
           A country is not where anyone is sent; a state is. Same ranking as the country sheet —
           need first, then size — so drilling down never hands the reader a second answer. -->
      <a v-if="selectedProvince.pray_first" class="gm-pray" :href="selectedProvince.pray_first.url"
         target="_blank" rel="noopener noreferrer"
         :title="'Open the prayer page for ' + selectedProvince.pray_first.name + ' on doxa.life.'">
        {{ t('gospel.sheet.pray') }} {{ selectedProvince.pray_first.name }}
        <span class="gm-pray-n" dir="ltr">{{ fmt(selectedProvince.pray_first.people) }}
          people<template v-if="selectedProvince.pray_first.has_nothing">, nothing found</template></span>
      </a>
    </div>

    <div v-else-if="selected || showGapList" class="gm-sheet" :class="{ 'gm-sheet-full': cardMode }">

      <!-- ITEM 0 — the ranked gap: the largest groups with nothing found anywhere. -->
      <template v-if="showGapList && !selected">
        <div class="gm-sh-head">
          <span class="gm-sh-name">{{ gapBy === 'groups' ? t('gospel.ui.largest')
            : gapBy === 'noprayer' ? t('gospel.ui.nobodyPraying')
            : gapBy === 'hnr' ? 'Can hear the gospel, no text to read'
            : t('gospel.ui.concentrates') }}</span>
          <button type="button" class="gm-x" @click="closeGapList">{{ t('gospel.sheet.close') }}</button>
        </div>
        <p class="gm-note" dir="ltr" style="margin-top:0">
          <!-- The hnr tab describes a DIFFERENT population from the other three, so it must
               not inherit the nothing-found sentence: those groups do have something. -->
          <template v-if="gapBy === 'hnr'">
            {{ fmt(pinTally.hnr) }} people groups can already hear the gospel — a recording,
            the JESUS Film, a Bible video or Words of Life — but have <b>no text Scripture
            found in the pools checked</b>. These are the {{ gapHnr.length }} largest; tap one
            to fly there.
            <br>That is a statement about the pools searched, <b>not</b> a claim no text
            exists. The largest entries here are varieties like Western Punjabi and
            Shanghainese, where a recording plainly exists and a text in that same variety is
            genuinely contested.
          </template>
          <template v-else>
          {{ fmt(pinTally.none) }} people groups have no Scripture, audio, film, Bible video or
          Door43 resource in the pools checked — {{ fmt(gapPeople) }} people. </template>
          <template v-if="gapBy === 'noprayer'">
            The groups with nothing found in any pool checked AND nobody praying —
            {{ fmt(gapNoPrayer.length) }} shown, largest first. Tapping one opens their prayer
            page on doxa.life.
            <br><b>"Nobody praying" means zero on doxa.life's counter</b>, not a claim that
            nobody in the world prays for them. Only the {{ fmt(Object.keys(prayIndex).length) }}
            groups doxa.life publishes a page for can appear here at all.
          </template>
          <template v-else-if="gapBy === 'regions'">
            The five UN regions, ranked by the SHARE of their groups with nothing — the one
            question the other two tabs cannot answer. Oceania is half unreached by group
            and small by population; Asia is the reverse. Rate, count and population each
            point somewhere different, and all three are here rather than one chosen for you.
          </template>
          <template v-else-if="gapBy === 'countries'">
            The top 40 countries by how many of those groups they hold; tap one to open it.
            The two columns disagree on purpose — Papua New Guinea has the most groups and
            few people, China the reverse — and which one matters depends on whether you are
            sending translators or broadcasters.
          </template>
          <template v-else-if="gapBy !== 'hnr'">These are the 40 largest; tap one to fly there.</template>
          <template v-if="gapBy === 'groups'">
            <br><b>What that number is made of.</b> {{ gapKindsWord }} different situations share
            it, and only the first is a translation problem:
            <template v-if="gapMakeup.searched">
              <br>· <b>{{ fmt(gapMakeup.searched) }}</b> groups ({{ fmt(gapMakeup.searchedP) }} people)
              — every pool this build can reach was checked and found nothing. This is the real gap.
            </template>
            <template v-if="gapMakeup.pending">
              <br>· <b>{{ fmt(gapMakeup.pending) }}</b> ({{ fmt(gapMakeup.pendingP) }}) — Global
              Recordings Network has not been swept for them yet; the crawl runs a batch at a time.
            </template>
            <template v-if="gapMakeup.sign">
            <br>· <b>{{ fmt(gapMakeup.sign) }}</b> ({{ fmt(gapMakeup.signP) }}) — sign languages,
            whose pools are key-gated. The largest blocked population here, and an access
            problem rather than a translation one. <template v-if="gapMakeup.signPriv">{{ fmt(gapMakeup.signPriv) }}
            of them also carry a code no pool can index, so they are doubly stuck. </template>
            </template>
            <template v-if="gapMakeup.priv + gapMakeup.noCode">
              <br>· <b>{{ fmt(gapMakeup.priv + gapMakeup.noCode) }}</b>
              ({{ fmt(gapMakeup.privP + gapMakeup.noCodeP) }}) — a private-use code or none at
              all, which no pool can index. Searching harder cannot move these.
            </template>
          </template>
          <!-- This paragraph has twice had to stop claiming a pool was unsearched: first when
               Faith Comes By Hearing was added, then when GRN was reached through 5fish. A
               stale caveat is as misleading as a stale number. -->
          <template v-if="gapBy !== 'hnr'">
          <br>Audio <b>has</b> been searched — at Faith Comes By Hearing, and at Global
          Recordings Network through their 5fish site, whose sweep is finished for every group
          in this list, at the ten-second delay they ask crawlers for. These groups have none in
          either.
          </template>
          <template v-if="gapBy !== 'hnr'">
          <br><em>{{ t('gospel.gapList.relatedLabel') }}</em> where a line below carries it, ISO 639-3 files that code under a
          macrolanguage with another variety that does have resources. It is how the standard
          groups the codes, not a claim they are mutually intelligible.
          </template>
        </p>
        <div class="gm-gswitch">
          <button type="button" class="gm-gtab" :class="{ on: gapBy === 'groups' }"
                  @click="gapBy = 'groups'">{{ t('gospel.tabs.groups') }}</button>
          <button type="button" class="gm-gtab" :class="{ on: gapBy === 'countries' }"
                  @click="gapBy = 'countries'">{{ t('gospel.tabs.countries') }}</button>
          <button type="button" class="gm-gtab" :class="{ on: gapBy === 'regions' }"
                  @click="gapBy = 'regions'">{{ t('gospel.tabs.regions') }}</button>
          <button v-if="gapNoPrayer.length" type="button" class="gm-gtab" :class="{ on: gapBy === 'noprayer' }"
                  @click="gapBy = 'noprayer'">{{ t('gospel.tabs.noprayer') }}</button>
          <button v-if="gapHnr.length" type="button" class="gm-gtab" :class="{ on: gapBy === 'hnr' }"
                  @click="gapBy = 'hnr'">{{ t('gospel.tabs.hnr') }}</button>
        </div>

        <!-- Links, not fly-to buttons: every row here HAS a prayer page, so the useful
             action is to open it rather than to look at the dot again. -->
        <!-- Fly-to buttons like the nothing-found list: unlike the prayer tab these rows
             have no single URL to open — a group's resources live in its own sheet. -->
        <template v-if="gapBy === 'hnr'">
          <button v-for="g in gapHnr" :key="g.i" type="button" class="gm-pg gm-pg-btn" @click="gotoGap(g)">
            <span class="gm-pg-n">{{ g.name }}</span>
            <span class="gm-pg-l">{{ t('gospel.gap.popLine', { pop: fmt(g.pop), iso3: g.iso3 }) }}<code class="gm-code">{{ g.code || t('gospel.ui.noCode') }}</code></span>
            <span class="gm-pg-rel">{{ t('gospel.gap.hasNoText', { what: g.has }) }}</span>
          </button>
        </template>

        <template v-else-if="gapBy === 'noprayer'">
          <a v-for="g in gapNoPrayer" :key="g.i" class="gm-pg gm-pg-btn" :href="g.url"
             target="_blank" rel="noopener noreferrer">
            <span class="gm-pg-n">{{ g.name }}</span>
            <span class="gm-pg-l">{{ t('gospel.gap.popLine', { pop: fmt(g.pop), iso3: g.iso3 }) }}<code class="gm-code">{{ g.code || t('gospel.ui.noCode') }}</code></span>
            <span class="gm-pg-rel"><bdi dir="ltr">nothing found, and nobody praying — open their prayer page ↗</bdi></span>
          </a>
        </template>

        <!-- Not buttons: a region is not a place this map can fly to, and a control that
             looks clickable and does nothing is worse than a plain row. -->
        <template v-else-if="gapBy === 'regions'">
          <div v-for="r in gapRegions" :key="r.region" class="gm-pg">
            <span class="gm-pg-n">{{ r.region }}</span>
            <span class="gm-pg-l"><b>{{ r.pct }}%</b> <bdi dir="ltr">of its {{ fmt(r.groups) }} groups have nothing
              · {{ fmt(r.none) }} groups · {{ fmt(r.pop) }} people</bdi></span>
          </div>
        </template>

        <template v-else-if="gapBy === 'countries'">
          <button v-for="c in gapCountries" :key="c.iso3" type="button" class="gm-pg gm-pg-btn"
                  @click="closeGapList(); openCountry(c.iso3)">
            <span class="gm-pg-n">{{ c.country }}</span>
            <span class="gm-pg-l"><bdi dir="ltr">{{ fmt(c.groups) }} groups with nothing · {{ fmt(c.pop) }} people</bdi><code class="gm-code">{{ c.iso3 }}</code></span>
          </button>
        </template>

        <button v-else v-for="g in gapList" :key="g.i" type="button" class="gm-pg gm-pg-btn" @click="gotoGap(g)">
          <span class="gm-pg-n">{{ g.name }}</span>
          <span class="gm-pg-l">{{ t('gospel.gap.popLine', { pop: fmt(g.pop), iso3: g.iso3 }) }}<code class="gm-code">{{ g.code || t('gospel.ui.noCode') }}</code></span>
          <span v-if="g.wayIn" class="gm-pg-way">{{ t('gospel.gap.wayIn', { via: g.wayIn }) }}</span>
          <span v-if="g.rel" class="gm-pg-rel"
                :title="'ISO 639-3 files this under macrolanguage ' + g.rel.m + ' with ' + g.rel.l + ', which has resources. That is how the standard groups the codes, not a claim they are mutually intelligible.'">
            {{ t('gospel.sheet.hasResources', { lang: g.rel.l }) }}
          </span>
        </button>
      </template>

      <!-- ITEM 2 — one people group: what exists in THEIR OWN language. -->
      <template v-else-if="selectedGroup">
        <div class="gm-sh-head">
          <button v-if="!cardMode" type="button" class="gm-back" @click="selectedGroup = null">‹ {{ selected.country }}</button>
          <button v-if="!cardMode" type="button" class="gm-x" @click="closeSheet">{{ t('gospel.sheet.close') }}</button>
        </div>
        <div class="gm-sh-name" style="margin-bottom:6px">{{ selectedGroup.people_group }}</div>
        <div class="gm-stat">
          <span>{{ t('gospel.stat.language') }}</span>
          <b>{{ selectedGroup.language }}<code class="gm-code">{{ selectedGroup.iso639_3 || t('gospel.ui.noCode') }}</code></b>
        </div>
        <div class="gm-stat"><span>{{ t('gospel.stat.population') }}</span><b>{{ fmt(selectedGroup.population) }}</b></div>
        <div class="gm-stat"><span>{{ t('gospel.stat.countries') }}</span><b>{{ selectedGroup.countries }}</b></div>

        <!-- ═══ WHAT THE DOT MEANS, SAID ON THE SHEET THAT THE DOT OPENED ══════════════════
             A pin marks a PEOPLE group, not a settlement, and its position is approximate: 108
             of the 2,107 placed groups sit on a coordinate they share with another group. Where
             this one does, it names them, because "approximate" on its own hides the part a
             reader would never otherwise discover — that some dots are literally the same dot.
             TRANSLATED, in 11 locales, from the shared pins.* area (APPROXPIN) — the same
             catalogue library ApproxPinNote.vue reads, so the wording is shared and not copied;
             it is this map's own P5 proposal that became the library's.
             WHY THE KEYS AND NOT THE COMPONENT, and the reason has CHANGED: it used to be that
             the component resolved its catalogue without the guard this leaf needs for hosts that
             never installed vue-i18n. C4 wave 2 fixed that, so the component is safe to mount and
             this note no longer warns anyone off it. What is left is typography: it carries its
             own inline 11px and #5b6470, while every other note in this sheet is .gm-note at 14px
             inheriting the sheet's ink. Mounting it here would render one note in a different
             size and an off-palette grey. Same sentence, this sheet's voice. -->
        <p class="gm-note" :dir="isEnglish ? 'ltr' : null" style="margin:6px 0 0">
          {{ t('pins.approximate') }}
          <template v-if="sharedWith(selectedGroup).length">
            <!-- CONJUNCTION: these groups all share the point. The names go INTO a translated
                 sentence (pins.sharedPoint), so a hardcoded ", " printed English separators inside
                 Arabic prose — the same defect studio fixed in ApproxPinNote. -->
            {{ t('pins.sharedPoint', { names: formatList(sharedWith(selectedGroup), { type: 'conjunction' }), n: sharedWith(selectedGroup).length + 1 }) }}
          </template>
        </p>

        <div class="gm-sec">
          <div class="gm-sec-h">{{ t('gospel.sheet.ownLanguage') }}</div>
          <div class="gm-chips">
            <!-- ⚠ THIS CHIP SAID "none found" TO PEOPLE WHO HAD A BIBLE. It tested scripture_url
                 alone, and readable text lives in four places: 887 codes carry theirs on the Faith
                 Comes By Hearing record, on Scripture Earth or in a Door43 translation. The builder
                 now publishes `sx` — the readable text with its SOURCE named — so the chip links it
                 and says whose it is. The source is named because a reader deserves to know they are
                 being sent to an audio site to read. -->
            <a v-if="selectedGroup.scripture_url || selectedGroup.sx" class="gm-chip"
               :class="vchip(selectedGroup.scripture_url || selectedGroup.sx.u).cls"
               :href="selectedGroup.scripture_url || selectedGroup.sx.u" target="_blank" rel="noopener noreferrer"
               :title="vtitle(selectedGroup.scripture_url || selectedGroup.sx.u)">
              {{ t('gospel.res.scripture') }} · {{ t(vchip(selectedGroup.scripture_url || selectedGroup.sx.u).labelKey)
              }}<template v-if="!selectedGroup.scripture_url && selectedGroup.sx"> <bdi dir="ltr">({{ sxScope(selectedGroup.sx) }})</bdi></template>
            </a>
            <span v-else class="gm-chip meh">{{ t('gospel.res.scripture') }} · {{ t('gospel.state.noneFound') }}</span>

            <!-- The title says what the evidence IS. The JESUS Film Project's own API
                 confirms a feature film in this language; the watch URL opens their site
                 but is NOT a language deep link — measured in a browser, a real id and a
                 bogus id render the same library page. Promising more than that in a
                 tooltip is how a field worker follows a link and finds nothing. -->
            <a v-if="selectedGroup.film_url" class="gm-chip" :class="vchip(selectedGroup.film_url).cls"
               :href="selectedGroup.film_url" target="_blank" rel="noopener noreferrer"
               :title="/[?&]languageId=/.test(selectedGroup.film_url)
                 ? 'The JESUS Film Project lists a feature film in this language, but no per-language link is published for it — this opens their site and you may need to choose the language there.'
                 : 'Opens the JESUS Film in this language on jesusfilm.org.'">
              {{ selectedGroup.film_title || t('gospel.res.film') }} · {{ t(vchip(selectedGroup.film_url).labelKey) }}
            </a>
            <span v-else class="gm-chip meh">{{ t('gospel.res.film') }} · {{ t('gospel.state.noneFound') }}</span>

            <!-- AUDIO SCRIPTURE, from Faith Comes By Hearing. This chip read "not searched
                 (GRN)" on every group for as long as this map existed. GRN is now searched too,
                 through 5fish, and appears as its own Gospel audio chip — so this one speaks
                 only for FCBH and no longer implies the audio question went unasked. -->
            <!-- ONE link, and it says what it carries. A bible.is fileset is a single page
                 that may hold audio, text or both, so two chips to the same URL would be
                 noise; the media list is the useful part, because "there is a recording"
                 and "there is a readable text" are different answers to different needs. -->
            <a v-if="selectedGroup.audio" class="gm-chip ok wrap"
               :href="selectedGroup.audio.u" target="_blank" rel="noopener noreferrer"
               :title="selectedGroup.audio.n + ' — Scripture from Faith Comes By Hearing (' + (selectedGroup.audio.m || 'audio') + '), free in a browser.'
                 + (selectedGroup.audio.vsc ? ' Video covers: ' + selectedGroup.audio.vsc + '. That is Bible video, not the JESUS Film.' : '')">
              {{ t('gospel.chip.scriptureAudio', { medium: selectedGroup.audio.m || t('gospel.res.audio'), source: selectedGroup.audio.n }) }}
            </a>
            <!-- Not shown for a sign language. Telling a Deaf group that no AUDIO was found
                 is noise about a medium they cannot use, and it pushes the one line that
                 matters — which pool could still have signed Scripture — further down. When
                 FCBH does hold something for them it is text, and the link above still shows. -->
            <span v-else-if="!selectedGroup.is_sign" class="gm-chip meh"
                  title="Faith Comes By Hearing publishes no audio or text Scripture in this language. Global Recordings Network is searched separately and appears as its own Gospel audio chip when they hold something.">
              {{ t('gospel.res.audio') }} · {{ t('gospel.state.noneAtFcbh') }}
            </span>

            <!-- Bible VIDEO, kept visibly apart from Film. Film here means the JESUS Film;
                 this is FCBH's Bible narrative, and its real book scope is shown because
                 "video" alone does not tell anyone whether they are getting Genesis or Acts. -->
            <a v-if="selectedGroup.bible_video" class="gm-chip ok wrap"
               :href="selectedGroup.bible_video.u" target="_blank" rel="noopener noreferrer"
               :title="selectedGroup.bible_video.n + ' — Bible narrative video from Faith Comes By Hearing. This is NOT the JESUS Film.'">
              {{ t('gospel.chip.bibleVideoOf', { source: selectedGroup.bible_video.sc || selectedGroup.bible_video.n }) }}
            </a>
            <!-- Door43 entries are real published repos, so they ship as real links. The
                 SUBJECT is shown verbatim: "Open Bible Stories" is 50 illustrated narratives,
                 not a Bible, and calling it Scripture would be the one lie that matters here. -->
            <a v-for="d in selectedGroup.door43" :key="d.u" class="gm-chip ok wrap"
               :href="d.u" target="_blank" rel="noopener noreferrer"
               :title="d.s + ' — published on Door43 (unfoldingWord), open licence'">
              {{ /^Open Bible Stories/.test(d.s) ? d.s.replace('Open Bible Stories', 'Bible Stories') : d.s }} · Door43<template v-if="d.sc"> · {{ d.sc }}</template>
            </a>
            <span v-if="!selectedGroup.door43.length" class="gm-chip meh">
              {{ t('gospel.res.bibleStories') }} · {{ t('gospel.state.noneFound') }}
            </span>

            <!-- A GOSPEL PRESENTATION — the short translated thing you actually open with
                 someone. Not Scripture, not film, not a course, so it gets its own chip. It
                 closes no gap: every language carrying one already has something else. -->
            <a v-if="selectedGroup.gospel_tract" class="gm-chip ok wrap"
               :href="selectedGroup.gospel_tract.u" target="_blank" rel="noopener noreferrer"
               :title="selectedGroup.gospel_tract.n + ' — a gospel presentation from Cru (GodTools), free to read in a browser in this language.'">
              {{ t('gospel.res.gospelPresentation') }} · {{ selectedGroup.gospel_tract.n }}
            </a>

            <!-- GOSPEL AUDIO — for a language with no writing system this may be the only
                 form the gospel can take, so it gets its own chip rather than being folded
                 into the audio-Scripture one. The title says plainly that it is not a
                 translation: a worker must not set out believing they have Scripture. -->
            <a v-if="selectedGroup.gospel_audio" class="gm-chip ok wrap"
               :href="selectedGroup.gospel_audio.u" target="_blank" rel="noopener noreferrer"
               title="Global Recordings Network publishes gospel audio in this language — usually Words of Life, gospel messages and Bible stories with songs. It is not a translation of the Bible.">
              {{ t('gospel.res.gospelAudio') }} · GRN
            </a>
            <!-- THE ABSENT CASE, which was missing while five other pools had one. For a group
                 in the gap this sheet listed "none found" for Scripture, film, FCBH audio,
                 Bible Stories and Zume, and said NOTHING about Global Recordings Network —
                 the pool that for 1,220 groups is the only thing there is. Silence there does
                 not read as "searched and empty", it reads as "nobody asked", which is exactly
                 the impression the sweep was run to remove.
                 Not shown for a sign language: GRN publishes audio, so they are skipped on
                 purpose and "none found" would describe a search that was never the right one
                 — the same rule the FCBH chip above follows. -->
            <span v-else-if="!selectedGroup.is_sign && poolSearched(selectedGroup, 'grn')"
                  class="gm-chip meh"
                  title="Global Recordings Network was asked for this language through their 5fish site and holds nothing in it. Shown only when they were actually asked — the sweep ran against the gap first, so a language that already has resources may not have been.">
              {{ t('gospel.res.gospelAudio') }} · {{ t('gospel.state.noneAtGrn') }}
            </span>

            <!-- SCRIPTURE EARTH — SIL and its translation partners, reaching small languages
                 the big catalogues skip. The chip names WHAT IS THERE rather than saying just
                 "Scripture Earth", because the kinds differ per language and a worker needs to
                 know whether they are being sent to a PDF or to recorded audio. Codes carrying
                 only Jesus Film metadata stubs never reach this field. -->
            <a v-if="selectedGroup.scripture_earth" class="gm-chip ok wrap"
               :href="selectedGroup.scripture_earth.u" target="_blank" rel="noopener noreferrer"
               title="Scripture Earth (SIL International and its translation partners) publishes Scripture in this language. The listing shows every file they hold for it.">
              {{ t('gospel.res.scriptureEarth') }} · {{ seKinds(selectedGroup.scripture_earth.k) }}
            </a>
            <!-- Shown for a sign language too, unlike the audio chips: Scripture Earth
                 publishes text, PDFs and apps, so its absence is a real answer for a Deaf
                 group rather than noise about a medium they cannot use. -->
            <span v-else-if="poolSearched(selectedGroup, 'scriptureearth')" class="gm-chip meh"
                  title="Scripture Earth (SIL International and its translation partners) holds nothing under this language code. That sweep covered every code this map carries, so it is a searched-and-empty result.">
              {{ t('gospel.res.scriptureEarth') }} · {{ t('gospel.state.noneFound') }}
            </span>

            <!-- Zume is DISCIPLESHIP TRAINING, not Scripture and not film, so it sits here
                 as its own thing and moves no tier. The absent case names the denominator
                 rather than saying "none found": Zume is one platform in 54 languages, not
                 a pool that was searched exhaustively, and the two are not the same claim. -->
            <a v-if="selectedGroup.zume_url" class="gm-chip ok"
               :href="selectedGroup.zume_url" target="_blank" rel="noopener noreferrer"
               title="Zume Training publishes its discipleship course in this language — free, no account needed to read it.">
              {{ t('gospel.res.training') }} · Zume
            </a>
            <!-- APPROXIMATE, and it says so on its face. Zume publishes a written course
                 in this language but does not state which variety, and this group speaks
                 one of several. Saying "not in Zume's 54" here was false for 13 groups
                 covering 47.6M speakers; saying "Zume" flat would have been an overclaim.
                 The chip is styled apart from a confirmed one so the two never read alike. -->
            <a v-else-if="selectedGroup.zume_approx" class="gm-chip approx"
               :href="selectedGroup.zume_approx.u" target="_blank" rel="noopener noreferrer"
               :title="selectedGroup.zume_approx.n + '. The course is written in one standard script, so it is likely to be readable — but it was not published against this ISO code and is shown as an approximate match, not a confirmed one.'">
              {{ t('gospel.res.training') }} · {{ t('gospel.res.zumeInLanguage', { language: selectedGroup.zume_approx.l }) }} <em>{{ t('gospel.state.varietyNotStated') }}</em>
            </a>
            <span v-else class="gm-chip meh"
                  title="Zume Training publishes in 54 languages and this is not one of them. That is a gap in one training platform, not a statement about every training resource.">
              {{ t('gospel.res.training') }} · {{ t('gospel.state.notInZume') }}
            </span>
          </div>
            <!-- AN IN-COUNTRY BRIDGE, and only for a group with nothing of their own. Worded
               so it cannot be skimmed as "they have Scripture": the heading says NOT their
               language, the body names whose language it is, and the gap above is
               untouched. A bridge is a way in, not a translation. -->
          <div v-if="selectedGroup.bridge && !selectedGroup.scripture_url && !selectedGroup.film_url
                     && !selectedGroup.audio && !selectedGroup.gospel_audio && !selectedGroup.scripture_earth"
               class="gm-sign" style="border-left-color:#92b195" dir="ltr">
            <b>Not their language — but spoken around them.</b>
            <br>Nothing was found in {{ selectedGroup.language || 'their language' }}. In this
            country, <b>{{ selectedGroup.bridge.l }}</b> is spoken by
            {{ selectedGroup.bridge.n }} people groups and does have
            <template v-if="selectedGroup.bridge.s && selectedGroup.bridge.f">Scripture and the JESUS Film</template>
            <template v-else-if="selectedGroup.bridge.s">Scripture</template>
            <template v-else>the JESUS Film</template>.
            <br><em>Bridge strength: {{ selectedGroup.bridge.st }}.</em> A second language is a
            way in, not a translation — the gap in their own language is unchanged.
          
            <!-- THE LINKS THAT MAKE IT FOLLOWABLE. Same chips, same publishers and the same
                 doctrine scan as the group's own resources above; only the language differs.
                 Rendered only when the index actually holds a URL, so a named bridge with
                 nothing behind it stays a name rather than becoming a dead chip. -->
            <div v-if="curatedBridgeRes && (curatedBridgeRes.scripture_url || curatedBridgeRes.film_url)" class="gm-chips">
              <a v-if="curatedBridgeRes.scripture_url" class="gm-chip ok wrap"
                 :href="curatedBridgeRes.scripture_url" target="_blank" rel="noopener">
                {{ curatedBridgeRes.language }} · {{ curatedBridgeRes.scripture_title || t('gospel.res.scripture') }} ↗</a>
              <a v-if="curatedBridgeRes.film_url" class="gm-chip ok wrap"
                 :href="curatedBridgeRes.film_url" target="_blank" rel="noopener">
                {{ curatedBridgeRes.language }} · {{ curatedBridgeRes.film_title || t('gospel.res.jesusFilm') }} ↗</a>
              <a v-if="curatedBridgeRes.zume_url" class="gm-chip ok wrap"
                 :href="curatedBridgeRes.zume_url" target="_blank" rel="noopener">
                {{ curatedBridgeRes.language }} · {{ t('gospel.res.training') }} ↗</a>
              <a class="gm-chip wrap"
                 :href="tableLink({ iso: curatedBridgeRes.iso, label: curatedBridgeRes.language })">
                {{ t('gospel.sheet.everyResource') }} {{ curatedBridgeRes.language }} →</a>
            </div>
            <p v-if="curatedBridgeRes && curatedBridgeRes.credit" class="gm-credit" dir="ltr" style="margin:4px 0 0">
              The {{ curatedBridgeRes.language }} Scripture was translated by <a v-if="curatedBridgeRes.credit.u"
                class="gm-org" :href="curatedBridgeRes.credit.u" target="_blank" rel="noopener noreferrer"><b>{{
                  curatedBridgeRes.credit.o }}</b></a><b v-else>{{ curatedBridgeRes.credit.o }}</b><template
                v-if="curatedBridgeRes.credit.y">, {{ curatedBridgeRes.credit.y }}</template> — the likeliest people to ask
              about this language next.
            </p>
          </div>
          <!-- THE WEAKER CASE, and it says so on its face. No curated bridge exists for this
               group, but their country does have a language carrying Scripture and the film.
               No strength is shown because none can honestly be computed: ranking needs "is
               this a lingua franca", and by population share a 10% floor refuses Urdu in
               Pakistan while by group count Oman picks Swahili for an Arabic-speaking people.
               The evidence is shown instead and the reader judges. Never for a sign language:
               a spoken bridge is no bridge for a Deaf community. -->
          <div v-else-if="selectedGroup.bridge_candidate && !selectedGroup.is_sign
                     && !selectedGroup.scripture_url && !selectedGroup.film_url
                     && !selectedGroup.audio && !selectedGroup.gospel_audio && !selectedGroup.scripture_earth"
               class="gm-sign" style="border-left-color:#d1d4cd" dir="ltr">
            <b>Possibly a way in — worth checking locally.</b>
            <br>Nothing was found in {{ selectedGroup.language || 'their language' }}.
            <!-- TWO DIFFERENT DENOMINATORS, SAID PLAINLY. A CLDR candidate's percentage is a
                 share of the COUNTRY, which is what a reader assumes a percentage means. The
                 fallback's is a share of the PINNED population — a much smaller and invisible
                 denominator — so it is never printed as a bare percentage. -->
            <template v-if="selectedGroup.bridge_candidate.src === 'cldr'">
              <!-- TWO NAMES, BECAUSE THE MEASUREMENT AND THE SCRIPTURE BELONG TO DIFFERENT ONES.
                   CLDR measures a MACROLANGUAGE — Arabic is spoken by 100% of Saudi Arabia — while
                   publishers release into a VARIETY, and nothing at all is published under the
                   macrolanguage code. Saying "Standard Arabic is spoken by 100% of this country"
                   would be a claim CLDR never made, so the share keeps the name it was measured
                   under and the variety is named where the Scripture actually is. -->
              <template v-if="selectedGroup.bridge_candidate.macro">
                <b>{{ selectedGroup.bridge_candidate.macroName }}</b> is spoken by
                {{ selectedGroup.bridge_candidate.pct }}% of this country<template
                  v-if="selectedGroup.bridge_candidate.official"> and is an official language</template>,
                and Scripture and the JESUS Film are published in
                <b>{{ selectedGroup.bridge_candidate.l }}</b>.
              </template>
              <template v-else>
                <b>{{ selectedGroup.bridge_candidate.l }}</b> is spoken by
                {{ selectedGroup.bridge_candidate.pct }}% of this country<template
                  v-if="selectedGroup.bridge_candidate.official"> and is an official language</template>,
                and has Scripture and the JESUS Film.
              </template>
              <!-- A tie is not a ranking. Where a second language is within five points, both
                   are named rather than one being chosen by a rule the reader cannot see. -->
              <template v-if="selectedGroup.bridge_candidate.alt">
                So is <b>{{ selectedGroup.bridge_candidate.alt.l }}</b>, at
                {{ selectedGroup.bridge_candidate.alt.pct }}%<template
                  v-if="selectedGroup.bridge_candidate.alt.official"> and official</template> —
                the two are close enough that this map will not choose between them.
              </template>
              <div v-if="altBridgeRes && (altBridgeRes.scripture_url || altBridgeRes.film_url)" class="gm-chips">
                <a v-if="altBridgeRes.scripture_url" class="gm-chip ok wrap"
                   :href="altBridgeRes.scripture_url" target="_blank" rel="noopener">
                  {{ altBridgeRes.language }} · {{ altBridgeRes.scripture_title || t('gospel.res.scripture') }} ↗</a>
                <a v-if="altBridgeRes.film_url" class="gm-chip ok wrap"
                   :href="altBridgeRes.film_url" target="_blank" rel="noopener">
                  {{ altBridgeRes.language }} · {{ altBridgeRes.film_title || t('gospel.res.jesusFilm') }} ↗</a>
                <a class="gm-chip wrap" :href="tableLink({ iso: altBridgeRes.iso, label: altBridgeRes.language })">
                  {{ t('gospel.sheet.everyResource') }} {{ altBridgeRes.language }} →</a>
              </div>
            </template>
            <template v-else>
              The largest language among the people groups mapped here that does have Scripture
              and the JESUS Film is <b>{{ selectedGroup.bridge_candidate.l }}</b>, spoken by
              {{ selectedGroup.bridge_candidate.n }} of them. That is a count of THIS MAP's
              groups, not of the country — no published figure for the country was available.
            </template>
            <br><em>Not ranked and not recommended</em> — whether it actually reaches this group
            is a local question, and the gap in their own language is unchanged.

            <!-- THE LINKS THAT MAKE IT FOLLOWABLE. Same chips, same publishers and the same
                 doctrine scan as the group's own resources above; only the language differs.
                 Rendered only when the index actually holds a URL, so a named bridge with
                 nothing behind it stays a name rather than becoming a dead chip. -->
            <div v-if="candidateBridgeRes && (candidateBridgeRes.scripture_url || candidateBridgeRes.film_url)" class="gm-chips">
              <a v-if="candidateBridgeRes.scripture_url" class="gm-chip ok wrap"
                 :href="candidateBridgeRes.scripture_url" target="_blank" rel="noopener">
                {{ candidateBridgeRes.language }} · {{ candidateBridgeRes.scripture_title || t('gospel.res.scripture') }} ↗</a>
              <a v-if="candidateBridgeRes.film_url" class="gm-chip ok wrap"
                 :href="candidateBridgeRes.film_url" target="_blank" rel="noopener">
                {{ candidateBridgeRes.language }} · {{ candidateBridgeRes.film_title || t('gospel.res.jesusFilm') }} ↗</a>
              <a v-if="candidateBridgeRes.zume_url" class="gm-chip ok wrap"
                 :href="candidateBridgeRes.zume_url" target="_blank" rel="noopener">
                {{ candidateBridgeRes.language }} · {{ t('gospel.res.training') }} ↗</a>
              <a class="gm-chip wrap"
                 :href="tableLink({ iso: candidateBridgeRes.iso, label: candidateBridgeRes.language })">
                {{ t('gospel.sheet.everyResource') }} {{ candidateBridgeRes.language }} →</a>
            </div>
            <p v-if="candidateBridgeRes && candidateBridgeRes.credit" class="gm-credit" dir="ltr" style="margin:4px 0 0">
              The {{ candidateBridgeRes.language }} Scripture was translated by <a v-if="candidateBridgeRes.credit.u"
                class="gm-org" :href="candidateBridgeRes.credit.u" target="_blank" rel="noopener noreferrer"><b>{{
                  candidateBridgeRes.credit.o }}</b></a><b v-else>{{ candidateBridgeRes.credit.o }}</b><template
                v-if="candidateBridgeRes.credit.y">, {{ candidateBridgeRes.credit.y }}</template> — the likeliest people to ask
              about this language next.
            </p>
          </div>

          <p v-if="selectedGroup.scripture_title || selectedGroup.scripture_scope" class="gm-scope">
            <b>{{ selectedGroup.scripture_title || 'Scripture' }}</b>
            <template v-if="selectedGroup.scripture_scope"> — {{ selectedGroup.scripture_scope }}</template>
            <!-- ═══ WHO TO ASK, NOT JUST WHERE TO LOOK ══════════════════════════════════════
                 A link answers where the Scripture is. The organisation that produced it is
                 the one with the linguists, the relationships and very often a team already in
                 that country — which is what a mobiliser actually needs next, so the name is a
                 LINK where one exists. Not eBible's own homeDomain field, which is still dropped:
                 the URL comes from data/tables/translator-org-links.json, a hand-screened list
                 whose every entry the build fetched. An org with no screened URL stays a name. -->
            <template v-if="selectedGroup.credit">
              <br><span class="gm-credit" dir="ltr">Translated by <a v-if="selectedGroup.credit.u"
                  class="gm-org" :href="selectedGroup.credit.u" target="_blank" rel="noopener noreferrer">{{
                  selectedGroup.credit.o }}</a><template v-else>{{ selectedGroup.credit.o }}</template><template
                  v-if="selectedGroup.credit.y">, {{ selectedGroup.credit.y }}</template></span>
            </template>
          </p>

          <!-- A related variety that DOES have something. This is the note that stops the
               gap list being read top-down into the wrong places: Jinyu at 60.3M and Gan at
               41.3M are the two largest "nothing found" entries on this map, and ISO files
               both under `zho` beside Mandarin, which has everything.
               It deliberately does NOT claim intelligibility — spoken Jinyu and spoken
               Mandarin are not mutually intelligible, they share a written standard — and it
               changes no tier. The group still has nothing in its own variety. -->
          <p v-if="selectedGroup.related" class="gm-rel">
            <b>{{ t('gospel.related.nothingInItself', { language: selectedGroup.language || 'this variety' }) }}</b> <bdi dir="ltr">— but ISO 639-3
            files it under the macrolanguage</bdi> <code>{{ selectedGroup.related.m }}</code> together
            with <b>{{ selectedGroup.related.l }}</b><bdi dir="ltr">, which does have resources here.</bdi>
            <br><br>
            <bdi dir="ltr">That is a statement about how the standard groups these codes,</bdi> <em>not</em> <bdi dir="ltr">a claim
            that the two are mutually intelligible — often what they share is a written
            standard rather than speech. It closes no gap and changes nothing above. It is here
            because the largest "nothing found" entries on this map are varieties of this kind,
            and a list read top-down would send you to them first.</bdi>
          </p>

          <p v-if="selectedGroup.is_sign" class="gm-sign">
            <b>{{ t('gospel.guide.isSignLanguage') }}</b> <bdi dir="ltr">A Deaf group cannot be reached by a text
            translation, so eBible's silence here is not an absence of Scripture — it is a
            text pool that was never the right place to look. What counts is Scripture</bdi>
            <em><bdi dir="ltr">filmed in this sign language</bdi></em><bdi dir="ltr">. Of {{ fmt(signTally.langs) }} sign languages
            on this map, covering {{ fmt(signTally.people) }} people,
            {{ signTally.both ? fmt(signTally.both) + ' have' : 'none yet has' }} both a film and
            a text Scripture.</bdi>
            <br><br>
            <bdi dir="ltr"><!-- Naming the pool that could still have it is the useful half. Measured: the
                 JESUS Film catalogue lists 14 sign languages and every one is already on
                 this map, and Faith Comes By Hearing carries none at all — so the open
                 catalogues are exhausted here, and this gap closes through an agreement
                 rather than more searching. -->
            The open catalogues are</bdi> <b>exhausted</b> <bdi dir="ltr">for sign language: the JESUS Film lists
            14 entries across 13 language codes and every one is already here, and Faith
            Comes By Hearing carries none at all. What is unchecked is</bdi> <b>Deaf Bible
            Society</b> and <b>DOOR International</b><bdi dir="ltr">, both of which need a key or an
            agreement — this gap closes by asking them, not by searching harder.</bdi>
          </p>

          <!-- ═══ AND HERE IS THE ONE WAY IN THAT EXISTS TODAY ════════════════════════════
               The paragraph above explains the gap honestly and then leaves a mobiliser with
               nothing to do, which for 93 groups and 17.5 million people is every Deaf group
               on this map. A spoken bridge cannot reach them, so they were the only population
               here with nothing AND no way in — structurally, not by bad luck.
               SUN is a signed language built to be learnt ACROSS sign languages, with Scripture
               in it. It is a bridge in the same sense the spoken ones are: it has to be learnt,
               and it is no substitute for Scripture in their own sign language — which is why
               it changes no tier and sits below the gap rather than closing it. -->
          <div v-if="deafBridge" class="gm-sign" style="border-left-color:#92b195" dir="ltr">
            <b>There is one signed language with Scripture in it.</b>
            <br><b>SUN</b> is built to be learnt across sign languages rather than being tied to
            one country, so it can be learnt by a Deaf community whose own sign language has
            nothing. Published by {{ deafBridge.publisher }}.
            <br><em>A bridge, not a translation</em> — it has to be learnt, and the gap in their
            own sign language is unchanged.
            <div class="gm-chips">
              <a v-if="deafBridge.scripture" class="gm-chip ok wrap"
                 :href="deafBridge.scripture.u" target="_blank" rel="noopener">{{ deafBridge.scripture.t }} ↗</a>
              <a v-if="deafBridge.stories" class="gm-chip ok wrap"
                 :href="deafBridge.stories.u" target="_blank" rel="noopener">{{ deafBridge.stories.t }} ↗</a>
              <a v-if="deafBridge.about" class="gm-chip wrap"
                 :href="deafBridge.about" target="_blank" rel="noopener">About SUN ↗</a>
            </div>
            <!-- A named local partner is the difference between a resource and somebody to
                 call, so it is shown only where SUN itself says the work is already running. -->
            <p v-if="deafBridge.organisation" class="gm-note" style="margin:6px 0 0">
              SUN is already being taught in {{ selectedGroup.countries }} by
              <b>{{ deafBridge.organisation }}</b>.
            </p>
          </div>
        </div>

        <!-- THE MAP'S OWN PROMPT, ANSWERED. Its toast has always said "someone still needs
             prayer" and tapping a dot offered no way to pray. doxa.life publishes a page per
             group and sibling plugins here already link to it; this map simply did not.
             Only shown where the join is unambiguous — 1,723 of 12,379 groups. -->
        <!-- ═══ SHARE WHAT IS ON SCREEN ════════════════════════════════════════════════════
             The catalyst standing with the group needs to hand this to a local believer, and the
             link that reopens exactly this card already existed (?card=<slug>) with nothing to
             reveal it. navigator.share is the phone path — it offers whatever they already use,
             WhatsApp or SMS — and the clipboard is the desktop fallback. A cancelled share is not
             an error and must not look like one. -->
        <button v-if="selectedGroup.slug" type="button" class="gm-tablink" @click="shareCard(selectedGroup)">
          {{ shareState === 'copied' ? t('gospel.sheet.linkCopied') : t('gospel.sheet.share') }}
        </button>

        <a v-if="selectedPray" class="gm-pray" :href="selectedPray.u"
           target="_blank" rel="noopener noreferrer"
           :title="'Open the prayer page for ' + selectedPray.n + ' on doxa.life.'">
          {{ t('gospel.sheet.pray') }} {{ selectedPray.n }}
          <span v-if="selectedPray.praying" class="gm-pray-n">{{ t('gospel.sheet.alreadyPraying', { n: fmt(selectedPray.praying) }) }}</span>
        </a>

        <!-- A link when standalone, a filter when composed. Same words either way, because
             the promise is the same; only the destination differs. -->
        <button v-if="selectedGroup.iso639_3 && composed" type="button" class="gm-tablink"
                @click="filterComposedTables({ iso: selectedGroup.iso639_3, label: selectedGroup.language || '' })">
          {{ t('gospel.sheet.everyResource') }} {{ selectedGroup.language }} ↓
        </button>
        <a v-else-if="selectedGroup.iso639_3" class="gm-tablink"
           :href="tableLink({ iso: selectedGroup.iso639_3 || '', label: selectedGroup.language || '' })">
          {{ t('gospel.sheet.everyResource') }} {{ selectedGroup.language }} →
        </a>

        <div class="gm-sec" v-if="sameLanguage.length">
          <div class="gm-sec-h">{{ t('gospel.sheet.alsoSpeak') }} {{ selectedGroup.language }} ({{ sameLanguage.length }})</div>
          <button v-for="g in sameLanguage.slice(0, 12)" :key="g.people_group + g.countries"
                  type="button" class="gm-pg gm-pg-btn" @click="openGroup(g)">
            <span class="gm-pg-n">{{ g.people_group }}</span>
            <span class="gm-pg-l">{{ t('gospel.sheet.popCountries', { pop: fmt(g.population), countries: g.countries }) }}</span>
          </button>
          <div v-if="sameLanguage.length > 12" class="gm-more">
            <bdi dir="ltr">Showing 12 of {{ sameLanguage.length }} groups sharing this language.</bdi>
          </div>
        </div>

        <p class="gm-note" dir="ltr">
          Matched on ISO 639-3 <b>{{ selectedGroup.iso639_3 || '—' }}</b> — an exact code match, never a
          language-name match, because names collide across unrelated languages.
          Checked: {{ selectedGroup.checked_pools || '—' }}. Not checked:
          {{ selectedGroup.unchecked_pools || '—' }} — “none found” means absent from the pools checked,
          never proof that nothing exists.
          <template v-if="selectedGroup.code_note"><br>{{ selectedGroup.code_note }}</template>
        </p>
      </template>

      <!-- ITEM 1 — a country: the aggregates, then the ACTUAL resources behind them. -->
      <template v-else>
        <div class="gm-sh-head">
          <span class="gm-sh-name">{{ selected.country }}</span>
          <button v-if="!cardMode" type="button" class="gm-x" @click="closeSheet">{{ t('gospel.sheet.close') }}</button>
        </div>
        <div class="gm-stat"><span>{{ t('gospel.stat.peopleGroups') }}</span><b>{{ fmt(countryStats.groups) }}</b></div>
        <div class="gm-stat"><span>{{ t('gospel.stat.noResource') }}</span><b>{{ fmt(countryStats.none) }} ({{ countryStats.pctNone }}%)</b></div>
        <div class="gm-stat"><span>{{ t('gospel.stat.peopleAffected') }}</span><b>{{ fmt(countryStats.popNone) }}</b></div>
        <div class="gm-stat"><span>{{ t('gospel.stat.haveScripture') }}</span><b>{{ fmt(countryStats.scripture) }}</b></div>
        <div class="gm-stat"><span>{{ t('gospel.stat.haveFilm') }}</span><b>{{ fmt(countryStats.film) }}</b></div>
        <!-- Audio Scripture is counted here for the same reason it is chipped below: without
             it the summary said a country had two media when it often has three, and the
             rows underneath already showed the third. -->
        <div class="gm-stat"><span>{{ t('gospel.stat.haveAudio') }}</span><b>{{ fmt(countryStats.audio) }}</b></div>
        <div class="gm-stat" v-if="countryStats.sign"><span>{{ t('gospel.stat.signLanguages') }}</span><b>{{ fmt(countryStats.sign) }}</b></div>
        <!-- N of M, never a bare N: the denominator is the groups doxa.life publishes a prayer
             page for, not the country. See countryPrayer. -->
        <div class="gm-stat" v-if="countryPrayer.pages">
          <span>{{ t('gospel.tabs.noprayer') }}</span>
          <b>{{ fmt(countryPrayer.noPray) }} / {{ fmt(countryPrayer.pages) }}</b>
        </div>
        <!-- These two are NOT derivable from the pins: they come from the curated country
             analysis, over its own narrower set of groups. Labelled so the different basis is
             visible rather than implied.
             SHOWN ONLY WHERE THAT ANALYSIS EXISTS. 72 of the 242 countries here have no
             curated row, and these rendered for them anyway — "Est. deaths/day 0", which is
             not a measurement of anything. An absent figure drawn as a zero is worse than a
             missing row, because a zero is a claim. -->
        <template v-if="hasCurated">
          <div class="gm-stat gm-stat-alt"><span>{{ t('gospel.stat.growingUnreached') }}<sup>†</sup></span><b>{{ fmt(selected.growing_unreached) }}</b></div>
          <div class="gm-stat gm-stat-alt"><span>{{ t('gospel.stat.deathsDay') }}<sup>†</sup></span><b>{{ fmt(Math.round(selected.deaths_day || 0)) }}</b></div>
          <p class="gm-note" dir="ltr" style="margin:4px 0 0">
            <sup>†</sup> from the curated country analysis, over
            <template v-if="selected.curated_groups">{{ fmt(selected.curated_groups) }} of these
            {{ fmt(countryStats.groups) }} groups</template><template v-else>a different set of
            groups</template> — not the pins, so it is not a share of the numbers above.
          </p>
        </template>

        <!-- ═══ THE MOVE ═══════════════════════════════════════════════════════════════════
             Everything above this line is work for somebody else to fund, staff or translate.
             This is the one a reader can do before closing the tab, and it names the group
             rather than making them choose: the largest here with nothing and nobody praying. -->
        <a v-if="countryPrayer.firstMove" class="gm-pray" :href="countryPrayer.firstMove.u"
           target="_blank" rel="noopener noreferrer"
           :title="'Open the prayer page for ' + countryPrayer.firstMove.n + ' on doxa.life.'">
          {{ t('gospel.sheet.pray') }} {{ countryPrayer.firstMove.n }}
          <span class="gm-pray-n" dir="ltr">{{ fmt(countryPrayer.firstMove.group.population || 0) }}
            people<template v-if="!countryPrayer.firstMove.group._tier">, nothing found</template></span>
        </a>

        <!-- Same split as the language link above: a filter when the tables are already on
             screen beneath this map, a link when they are not. This is the SECOND
             requirement — click a country, see its resources — and in the composite it was
             answering by leaving the composite. -->
        <button v-if="selected.iso3 && composed" type="button" class="gm-tablink"
                @click="filterComposedTables({ country: selected.iso3, label: selected.country || '' })">
          {{ t('gospel.sheet.everyIn', { country: selected.country }) }} ↓
        </button>
        <a v-else-if="selected.iso3" class="gm-tablink"
           :href="tableLink({ country: selected.iso3 || '', label: selected.country || '' })">
          {{ t('gospel.sheet.everyIn', { country: selected.country }) }} →
        </a>

        <div v-if="pgLoading" class="gm-load">{{ t('gospel.chip.loading') }}</div>
        <div v-else-if="pgErr" class="gm-err" style="position:static;text-align:start">{{ pgErr }}</div>

        <template v-else>
          <div class="gm-sec">
            <div class="gm-sec-h">{{ t('gospel.sheet.found', { n: withResources.length }) }}</div>
            <div v-if="!withResources.length" class="gm-none">
              <bdi dir="ltr">Nothing found for any group here in the pools checked.</bdi>
            </div>
            <!-- NOT a <button> wrapper. The chips below are real <a href> links to the
                 resource itself, and HTML forbids interactive content inside a button —
                 a nested anchor is hoisted out by the parser and stops being a link.
                 So the row is a plain container: the NAME is the drill-in control, the
                 CHIPS are the outbound links, and the two no longer fight. -->
            <div v-for="g in withResources.slice(0, shown)" :key="'r' + g.people_group + g.language"
                 class="gm-pg">
              <button type="button" class="gm-pg-open" @click="openGroup(g)">
                <span class="gm-pg-n">{{ g.people_group }}</span>
                <span class="gm-pg-l">{{ g.language }}<code class="gm-code">{{ g.iso639_3 || t('gospel.ui.noCode') }}</code></span>
              </button>
              <span class="gm-chips">
                <!-- The URL the verification pass already proved. Surfacing it is the
                     whole point: a chip that SAYS "link checked" while hiding the link
                     costs middle-click, open-in-new-tab, copy-link-address and link
                     semantics for screen readers. -->
                <a v-if="g.scripture_url" class="gm-chip" :class="vchip(g.scripture_url).cls"
                   :href="g.scripture_url" target="_blank" rel="noopener noreferrer"
                   :title="vtitle(g.scripture_url)">
                  {{ t('gospel.res.scripture') }} · {{ t(vchip(g.scripture_url).labelKey) }}
                </a>
                <a v-if="g.film_url" class="gm-chip" :class="vchip(g.film_url).cls"
                   :href="g.film_url" target="_blank" rel="noopener noreferrer"
                   :title="vtitle(g.film_url)">
                  {{ t('gospel.res.film') }} · {{ t(vchip(g.film_url).labelKey) }}
                </a>
                <!-- The other three media. A country view that shows only Scripture and film
                     under-reports what is actually reachable there, and the pin sheet for the
                     same group would have shown all of them. -->
                <a v-if="g.audio" class="gm-chip ok wrap" :href="g.audio.u"
                   target="_blank" rel="noopener noreferrer"
                   :title="g.audio.n + ' — Faith Comes By Hearing (' + (g.audio.m || 'audio') + ')'">
                  <!-- The LABEL is keyed; g.audio.m stays raw — it is the table's own media
                       descriptor, and 'audio' is its data default, not UI text. -->
                  {{ t('gospel.res.scripture') }}, {{ g.audio.m || 'audio' }}
                </a>
                <a v-if="g.bible_video" class="gm-chip ok wrap" :href="g.bible_video.u"
                   target="_blank" rel="noopener noreferrer"
                   :title="g.bible_video.n + ' — Bible narrative video. This is NOT the JESUS Film. Covers: ' + (g.bible_video.sc || 'see site')">
                  {{ t('gospel.res.bibleVideo') }}
                </a>
                <a v-if="g.zume_url" class="gm-chip ok" :href="g.zume_url"
                   target="_blank" rel="noopener noreferrer"
                   title="Zume Training publishes its discipleship course in this language.">
                  {{ t('gospel.res.training') }}
                </a>
              </span>
            </div>
            <div v-if="withResources.length > shown" class="gm-more">
              {{ t('gospel.sheet.showingOf', { shown, total: withResources.length }) }}
              <button type="button" class="gm-back" @click="shown = withResources.length">{{ t('gospel.legend.showAll') }}</button>
            </div>
          </div>

          <div class="gm-sec" v-if="withoutResources.length">
            <div class="gm-sec-h">{{ t('gospel.sheet.none', { n: withoutResources.length }) }}</div>
            <!-- These groups have NO verified URL, so NOTHING here becomes an anchor.
                 A dead <a> that navigates nowhere would claim a resource exists — the
                 exact overclaim this map refuses everywhere else. The row stays a plain
                 drill-in button and keeps saying, honestly, that nothing was found. -->
            <button v-for="g in withoutResources.slice(0, shown)" :key="'n' + g.people_group + g.language"
                    type="button" class="gm-pg gm-pg-btn" @click="openGroup(g)">
              <span class="gm-pg-n">{{ g.people_group }}</span>
              <span class="gm-pg-l">
                {{ g.language }}<code class="gm-code">{{ g.iso639_3 || t('gospel.ui.noCode') }}</code>
                {{ t('gospel.sheet.popSuffix', { pop: fmt(g.population) }) }}
              </span>
              <span v-if="wayInFor(g)" class="gm-pg-way">{{ t('gospel.gap.wayIn', { via: wayInFor(g) }) }}</span>
            </button>
            <div v-if="withoutResources.length > shown" class="gm-more">
              {{ t('gospel.sheet.showingOf', { shown, total: withoutResources.length }) }}
              <button type="button" class="gm-back" @click="shown = withoutResources.length">{{ t('gospel.legend.showAll') }}</button>
            </div>
          </div>
        </template>

        <p class="gm-note" dir="ltr">
          Deaths/day applies a national crude death rate to a sub-population — order of magnitude, not a count.
          <!-- This footnote still told readers audio was key-blocked and unchecked, long after
               Faith Comes By Hearing and GRN were both searched. A caveat that has stopped
               being true is not a safe default — it understates what the map can show. -->
          “No resource found” means not present in any pool checked: eBible, PNG.Bible, the
          JESUS Film catalogue, Door43, Faith Comes By Hearing, Scripture Earth and Global
          Recordings Network. Audio <b>is</b> searched — GRN through their 5fish site, at the
          crawl delay they ask for, with every language in the gap now decided. API.Bible, the
          Digital Bible Library, progress.bible and YouVersion need credentials or permission
          this build does not have.
          <br>Link states: <b>link checked</b> = the target resolves to the language claimed.
          Scripture links are fetched from eBible directly. Film links are checked against the Arclight
          catalogue, not jesusfilm.org — that page is client-rendered and returns an identical page for a
          bogus language, so fetching it could only ever produce a false pass.
          <b>unchecked</b> is never evidence that a link works or fails.
        </p>
      </template>
    </div>
  </div>
</template>
