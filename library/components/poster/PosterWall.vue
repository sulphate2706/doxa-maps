<script setup>
/**
 * PosterWall.vue — THE SHARED POSTER WALL.
 *
 * A grid of poster cards styled as posters taped to a wall, grouped into
 * collapsible sections. Extracted from my-upg-100-list/poster-wall.vue so that
 * every poster app renders from ONE component.
 *
 * The design: application PROFILES are duplicated per app, while the shared poster wall
 * is ONE parameterized library component. An app picks its template and supplies its
 * data (the posters on its wall); the reusable work lives in the library, which exists
 * for parameterized components like this one.
 *
 * So: PROFILES duplicate, COMPONENTS get promoted here and parameterized.
 *
 * WHAT IS PARAMETERIZED
 *   items        — the posters. Each { id, label, count, bbox? }.
 *   groupBy      — (item) => section name. The caller owns its own taxonomy.
 *   collapsible  — per-section expand/collapse.
 *   collapsedBy  — (section) => bool, the INITIAL state. Lets a caller open the
 *                  dense sections and fold the long tail without hard-coding.
 *   assetsBase   — where previews/posters are served from.
 *   eventName    — the window CustomEvent this wall dispatches for "show on map".
 *   heading / tag / intro / unit / itemNoun — the copy.
 *
 * WHAT IS NOT
 *   Sorting. Sections AND items are ALWAYS ordered by descending count. Both apps
 *   want the densest prayer need to lead, and on the country wall it is load-
 *   bearing: 92 of 175 countries have exactly ONE people group, so without this
 *   the wall opens on a wall of single-entry cards.
 *
 * COLLAPSIBILITY IS NOT COSMETIC. A country wall has far too many countries to scroll
 * through one by one, so sections collapse. Measured:
 * Europe alone is 27 countries averaging 2 groups each.
 *
 * CROSS-PANE COMMS — this wall NEVER imports a map. It dispatches a window
 * CustomEvent scoped by instanceId, so several embeds on one page never cross-talk.
 */
import { computed, ref, watch, onBeforeUnmount, onMounted, onUpdated, provide, toRefs } from 'vue'
import PosterSection from './PosterSection.vue'
import { POSTER_WALL_CTX } from './posterWallContext.js'
import { tStatic } from '../../i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { fetchPosterRaster, fetchPosterSource } from '@map/packet/poster-fetch.js'
import { usePosterPrints } from '@map/composables/usePosterPrints.js'
import { keyedError, errorText } from '@map/i18n/keyedError.js'
import { useOptionalI18n, useOptionalT } from '@map/composables/useOptionalT.js'
// Export-modal geometry. A fixed;inset:0 scrim covers only the CONTENT PANE in the cap-5 shell
// (contain:layout on .vtl-content). Measured 1024x793 @ (256,107) at 1280x900 — rail clickable
// behind the "modal". See library/utils/viewportScrim.js for the measurements and rejected fixes.
import { useViewportScrim } from '@map/utils/viewportScrim.js'
import { bundleTreeRoot } from '@map/utils/embedBase.js'

const props = defineProps({
  items:       { type: Array,  required: true },
  groupBy:     { type: Function, default: () => 'All' },
  instanceId:  { type: String, default: 'poster-wall' },
  isDark:      { type: Boolean, default: false },
  assetsBase:  { type: String, default: './assets' },
  eventName:   { type: String, default: 'doxa-poster-wall:show-on-map' },
  heading:     { type: String, default: 'Prayer Lists & Posters' },
  tag:         { type: String, default: '' },
  intro:       { type: String, default: '' },
  // "92 UPG" on a card header — the unit travels with the number so the header
  // states what it counts.
  unit:        { type: String, default: 'UPG' },
  itemNoun:    { type: String, default: 'list' },
  // English plurals are not "+s". A naive pluralizer shipped "28 countrys" to the
  // section headers, so the plural is a PARAMETER — the caller knows its own noun.
  // ⚠ No "+s" default any more: a noun pair is English-only by construction.
  itemNounPlural: { type: String, default: '' },
  // ★ THE LOCALIZED WAY TO COUNT ITEMS: a catalogue PLURAL key ("{n} country | {n} countries" in en,
  // four forms in ru, six in ar, one in zh), rendered with the count so each locale picks its own CLDR
  // form. Wins over itemNoun/itemNounPlural, which remain for callers that have not moved yet.
  itemCountKey: { type: String, default: '' },
  collapsible: { type: Boolean, default: false },
  collapsedBy: { type: Function, default: () => false },
  // A section's people-group total, shown in its header and used to order the sections (largest first).
  // Default: the sum of its cards' counts. A caller whose cards overlap overrides it, so a group is counted
  // once: the Country Posters India section holds India's own card AND one card per state, the same 855 groups.
  sectionTotal: { type: Function, default: null },
  // A card may declare itself unsupported (India: 855 groups do not fit a sheet).
  // The caller supplies the reason; the wall renders it instead of a poster.
  unsupported: { type: Function, default: () => null },
  downloadPrefix: { type: String, default: 'doxa' },
  // What "Prayer List" says while it is unbuilt. PARAMETERIZED because the unit
  // differs per app: the 100-list generates a list per PEOPLE GROUP, the country
  // app one per COUNTRY. A shared hardcoded string told country users the wrong
  // thing. The message must say that a prayer list is generated for each item the
  // app lists (each country, on the country app).
  prayerListSoonMessage: { type: String,
    default: 'Coming soon — the prayer list for each people group is in build.' },
  // ★ RECORDS PROVIDER — the seam that makes the print actions shareable.
  // The PRINT ACTIONS are common to every wall; the RECORD FETCHING is not. The
  // 100-list resolves its rows through the people-groups API, the selector
  // evaluator and a pg_slugs special case; Key Cities and Country Posters have
  // entirely different data shapes. So a bundle that CAN supply rows passes this
  // and gets the list + card-deck prints; one that cannot simply omits it and
  // those buttons stay hidden, rather than failing at click time.
  records: { type: Function, default: null },
  // () => the ISO3 -> English name table the host's map sheets were generated from (a loader, so a
  // bundle can keep it lazy). With it, a packet's page-1 map names its countries in the packet's
  // language; without it the sheet prints as drawn. usePosterPrints' iso3Names.
  iso3Names: { type: Function, default: null },
  // async (item) => an image URL of this item's map that the host GENERATES (a live map raster), used
  // for the packet's page 1 before any stored sheet. usePosterPrints' mapImage.
  mapImage: { type: Function, default: null },
  // async (item, format) => a map SHEET generated now (packet/posterSheets.js); tried first for the poster
  // print and the packet's page 1. usePosterPrints' sheet.
  sheet: { type: Function, default: null },
  // Card stock for the deck print, when this wall offers one. See card-render.js
  // STOCK — both orientations are available. This is the DEFAULT selection.
  cardStock: { type: String, default: 'poker' },
  // LET THE READER CHOOSE THE STOCK. `cardStock` alone fixes one size for the whole
  // wall, which is right for country-posters and key-cities; my-upg-100-list offers a
  // picker, and that was the one capability keeping it on its own 888-line copy of
  // this component rather than consuming it.
  // Pass true for every stock card-render.js supports, or an array of stock ids to
  // offer a subset. Default false = today's behaviour exactly: no picker, cardStock
  // is used as-is, so the two migrated consumers are untouched.
  // ⚠ The LABELS come from card-render.js STOCK, never hand-written here. The
  // 100-list carried its own DECK_STOCKS list duplicating all five labels, with a
  // comment saying they "come from the renderer's own STOCK table so this list cannot
  // drift" — which was the intent, not the implementation. Deriving them makes it true.
  cardStocks: { type: [Boolean, Array], default: false },
  // ★ DOWNLOAD OR PRINT? A PRODUCT RULING, NOT A PREFERENCE — and the reason the
  // 100-list could not simply adopt this component.
  // Default 'download' is what country-posters and key-cities do today and keeps
  // them byte-for-byte unchanged. 'print' opens the OS print dialog on the poster
  // instead, which is what my-upg-100-list/poster-wall.vue:280 records as the
  // brief: three print buttons, each opening an in-browser print dialog, and no
  // silent file download as the default action (a raw 'Download' button and a
  // 'Prayer List: coming soon' placeholder were the two rejected). Printing to PDF
  // from that dialog covers the get-a-file need without a fourth competing button.
  // Migrating the 100-list onto this component WITHOUT this prop would have
  // reintroduced both rejected buttons — the capability gap was never the whole
  // blocker; the shared component still encoded the pre-brief design.
  // ★ DEFAULT 'print': an export-poster button opens the PRINT DIALOG with a preview, never a direct
  // download. country-posters and key-cities set nothing and downloaded.
  // 'download' is an explicit opt-in, and a consumer that opts in must say why in a comment carrying
  // `posterAction-download:` (check:poster-action-print). Multi-page PDF packets and CSV exports are not
  // poster buttons and stay downloads.
  posterAction: { type: String, default: 'print' },   // 'print' | 'download'
  // ★ IS THE PREVIEW ITSELF A CONTROL? Default 'none' keeps the image inert, which is
  // what country-posters and key-cities render today. 'print' makes clicking the
  // poster preview open it for printing (the poster shown in the browser to help
  // print it), and the LAST capability the my-upg-100-list
  // migration had not carried across.
  // ⚠ WHEN IT IS A CONTROL IT MUST BE A KEYBOARD CONTROL. The original carried
  // role="button", tabindex="0" and Enter/Space handlers alongside the click; an
  // <img> with only @click is unreachable without a mouse, and re-adding the click
  // alone would be a half-restoration that LOOKS complete. The alt and title change
  // with the mode too, because "prayer poster" and "click to preview and print" are
  // different promises to a screen reader.
  previewAction: { type: String, default: 'none' },      // 'none' | 'print'
  // Hide the Prayer List button entirely, rather than showing it as a
  // "coming soon" placeholder. The placeholder is honest where the feature is
  // genuinely unbuilt, and it is the OTHER rejected button on a wall
  // where the list DOES print — so a wall with a records provider can suppress it.
  hidePrayerListWhenSoon: { type: Boolean, default: false },
  // EMBEDDED mode (added 2026-09-24 for the regions-tab poster dropdown). The wall's root is
  // `position:absolute;inset:0` because in country-posters and my-upg-100-list it IS a pane and
  // fills it. Dropped inside another component — a region card, say — that absolute root covers
  // the whole element: MEASURED at 1440x1100 painted over the region's country list, which no
  // assertion caught and the screenshot did. Embedded returns it to normal flow and drops the
  // pane background so it inherits its host's. Default false, so both existing panes are
  // byte-identical.
  embedded:    { type: Boolean, default: false },
  // Section heads carry the group name and its totals. A caller that has ALREADY named the
  // group in its own chrome (the region card's header and summary) would otherwise repeat it,
  // and with a single unnamed group the head renders the literal "Other". Default true.
  sectionHeads:{ type: Boolean, default: true },
  // ★ HOW MANY POSTERS SIT IN A ROW. The regions posters want two per row, with a setting to raise
  // the number.
  // 0 keeps the wall's existing auto-fill (repeat(auto-fill, minmax(210px, 1fr))), so the two
  // panes that already ship — country-posters and my-upg-100-list — are byte-identical unless
  // their owner opts in. A positive number fixes the track count instead.
  columns:        { type: Number,  default: 0 },
  // And the control that changes it, off by default for the same reason. Only the caller that
  // asked for a fixed count wants a knob for it.
  columnsControl: { type: Boolean, default: false },
  // The narrowest card this wall will lay out before it drops a column. 0 (the default) means
  // CARD_MIN_PX, 210 -- so every wall that does not set it lays out exactly as before. A wall whose
  // cards are thumbnails can set it lower so a phone keeps two per row; see the clamp below for why
  // that is safe now.
  minCardPx:      { type: Number,  default: 0 },
  // ★ WHAT THE CARD'S HEADER STICKER DOES. null (the default) is today's "Show on map" toggle,
  // unchanged for every wall that does not set it. A wall with no map beside it (a gallery of
  // templates) passes { labelKey, ariaKey } instead: the sticker then reads t(labelKey), is a plain
  // button rather than a toggle (no aria-pressed, no is-last highlight), and emits 'header-action'
  // with the item, dispatching no window event. ariaKey gets { label: item.label }. An item with no
  // count (a template, not a list of people) shows the label alone, without the "N UPG ·" prefix.
  headerAction:   { type: Object,  default: null },
  // ★ WHERE A CARD'S PREVIEW IMAGE COMES FROM. null (the default) is the stored
  // previews/<id>.webp every wall uses today, untouched. A wall whose cards have no stored
  // preview (a gallery of templates drawn from the library, so a library change shows up in it)
  // passes async (item) => an image URL | null. It runs only for cards that come into view, one at
  // a time, cached per page by instanceId + item id; until it answers the card shows its label, and
  // null, a throw or no answer within PREVIEW_TIMEOUT_MS shows the "preview unavailable" placeholder.
  // The page keeps each returned URL and never revokes it (see GENERATED PREVIEWS below).
  previewSrc:     { type: Function, default: null },
  // ★ ONE SECTION COUNTED IN ITS OWN WORDS. null (the default) counts every section's cards with item-count-key, as
  // always. A wall whose section holds a different kind of card passes (sec) => an i18n plural key, or { key, n }
  // to count n rather than the section's card count, or null for that section to keep the default. The Country
  // Posters India section holds India's own card and one per state and union territory, which are not countries.
  sectionItemCountKey: { type: Function, default: null },
  // SECTION-ONLY: the wall's own head (heading, tag, intro) is not drawn, only its section(s): a standalone poster
  // section (<dxm-poster-section>). Off by default, so every existing wall renders exactly as before.
  sectionOnly:    { type: Boolean, default: false },
})
const emit = defineEmits(['header-action'])

// The live count, seeded from the prop. A ref rather than the prop directly, because the control
// changes it and a prop is not ours to write.
// A stored preference outranks the prop default, because the prop is only what the page suggests
// before the reader has said otherwise; once they choose, their choice is the default.
const perRow = ref(readStoredPerRow() ?? (props.columns || PER_ROW_DEFAULT))
watch(() => props.columns, (n) => { if (readStoredPerRow() == null) perRow.value = n || PER_ROW_DEFAULT })
// ⚠ PER_ROW_AUTO (0) IS STORED TOO, so "Auto" survives a reload like any other choice. Without this
// clause the range check below rejects 0, nothing is written, and the next visit silently falls back
// to the default — a preference that forgets only ONE of its values is worse than one that forgets
// them all, because the reader cannot tell it is broken.
watch(perRow, (n) => {
  if (n === PER_ROW_AUTO || (Number.isFinite(n) && n >= PER_ROW_MIN && n <= PER_ROW_MAX)) storePerRow(n)
})
// The choices the control offers: a minimum of 1, a maximum of 5, a default of 2; the ceiling is the
// wall's own auto-fill behaviour, offered as "fit" so the knob can always get back to where it started.
// ★ AUTO IS 0, AND 0 IS NOT A COUNT — it is the absence of an override. gridStyle already returns
// {} for a non-positive value, leaving the stylesheet's auto-fill rule in charge, so Auto needed no
// new branch in the layout: it needed to become REACHABLE from the control and from storage.
// This extends the earlier ruling (min 2, max 5, default 2) rather than contradicting it: those
// bound the COUNTS, and Auto is the option that declines to pick one.
const PER_ROW_AUTO = 0
// 1 joined the counts 2026-09-30: on a phone the choices are Auto / 1 / 2, and 1 is the one a reader
// asks for when two posters are too small to read (see perRowChoices below).
const PER_ROW_MIN = 1, PER_ROW_MAX = 5, PER_ROW_DEFAULT = 2
// The choice persists in localStorage, so a number the reader sets survives a reload. One key for the
// whole wall, not per instance: the reader is setting a PREFERENCE, and a preference that only survives on the
// page you set it on is not one. Every access is wrapped because localStorage THROWS outright in a
// private window or with site data blocked -- a preference must never be able to break the wall.
const PER_ROW_KEY = 'doxa-maps:poster-wall:per-row'
function readStoredPerRow() {
  try {
    const raw = window.localStorage.getItem(PER_ROW_KEY)
    // ⚠ A MISSING KEY MUST NOT READ AS AUTO. getItem returns null when nothing is stored, and
    // Number(null) is 0 — which is exactly PER_ROW_AUTO now that 0 means something. Without this
    // guard every first-time reader would silently get Auto instead of the default, i.e. adding an
    // option would have CHANGED the layout for everyone who never touched the control. Caught by
    // round-tripping the storage values rather than by reading the code.
    if (raw == null || raw === '') return null
    const n = Number(raw)
    if (n === PER_ROW_AUTO) return PER_ROW_AUTO
    return Number.isFinite(n) && n >= PER_ROW_MIN && n <= PER_ROW_MAX ? n : null
  } catch (_) { return null }
}
function storePerRow(n) {
  try { window.localStorage.setItem(PER_ROW_KEY, String(n)) } catch (_) { /* unavailable: keep the session value */ }
}
// grid-template-columns, or nothing at all when the count is 0 — an empty string leaves the
// stylesheet's auto-fill rule in charge rather than overriding it with something equivalent.
// ⚠ THE PREFERENCE IS CLAMPED BY WHAT THE VIEWPORT CAN ACTUALLY HOLD.
// An inline style beats the stylesheet, so `repeat(2, minmax(0,1fr))` overrode the CSS rule's
// `minmax(210px,1fr)` at EVERY width — including 390px, where two columns give a ~162px card.
// Reported from a 390x844 phone shot: two posters per row, where the CSS alone would have
// given one. The stored preference is the reader's and must survive; it is a preference for
// DESKTOP density, not an instruction to overflow a phone.
// 210px is the same minimum the stylesheet's auto-fill uses, so the clamp agrees with the rule
// it is overriding rather than inventing a second breakpoint.
const CARD_MIN_PX = 210
const viewportW = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
if (typeof window !== 'undefined') {
  const onResize = () => { viewportW.value = window.innerWidth }
  window.addEventListener('resize', onResize)
  onBeforeUnmount(() => window.removeEventListener('resize', onResize))
}
// ★ OFFER ONLY WHAT FITS (2026-09-30, from a phone: "3" and "4" still showed two). The grid below
// clamps a count to what the viewport can hold, so a choice above that clamp was a promise the wall
// could not keep. The choices are Auto plus every count up to what fits, capped at 5: Auto / 1 / 2 on
// a 390px phone (minCardPx 150), up to 5 on a desktop. A stored preference above the fit (4, set on a
// desktop) is SHOWN as what is rendered and stays stored, so the desktop keeps its 4.
const fitsPerRow = computed(() => {
  const usable = Math.max(0, viewportW.value - 36)
  const minCard = props.minCardPx > 0 ? props.minCardPx : CARD_MIN_PX
  return Math.max(1, Math.floor(usable / minCard))
})
const perRowChoices = computed(() => [PER_ROW_AUTO, ...Array.from({ length: Math.min(PER_ROW_MAX, fitsPerRow.value) }, (_, i) => i + 1)])
const perRowShown = computed({
  get: () => (perRow.value > 0 ? Math.min(perRow.value, fitsPerRow.value) : perRow.value),
  set: (n) => { perRow.value = n },
})
const gridStyle = computed(() => {
  if (!(perRow.value > 0)) return {}
  // The wall's own padding either side; err toward FEWER columns rather than a clipped card.
  const usable = Math.max(0, viewportW.value - 36)
  // ★ A PHONE CAN NOW HOLD TWO, IF THE WALL ASKS. This clamp forced ONE poster per row at 390
  // (floor(354 / 210) = 1), silently overriding a per-row setting of 2 -- reported from a phone
  // as "2 posters per row does not work". It was added while the card's action labels were
  // being CLIPPED at ~162px ('Pra...', Romanian 'Pachet de cartonase'); those labels now WRAP
  // (the .pfs > .pbtn rule below), so a two-up card stays legible and only grows taller.
  // It stays OPT-IN: the default is still CARD_MIN_PX, so no wall changes unless it sets minCardPx.
  const minCard = props.minCardPx > 0 ? props.minCardPx : CARD_MIN_PX
  const fits = Math.max(1, Math.floor(usable / minCard))
  return { gridTemplateColumns: `repeat(${Math.min(perRow.value, fits)}, minmax(0, 1fr))` }
})

const plural     = computed(() => props.itemNounPlural || props.itemNoun)
// Counts are PLURAL catalogue keys, rendered with the number so each locale takes its own CLDR form.
// `t` here is useOptionalI18n's, whose bare-host fallback is humanizeKey — right for button labels,
// wrong for a count — so counts use a catalogue translator of their own (tStatic when no i18n).
const tCount = useOptionalT('')
const countOf = (key, n) => tCount(key, { n: Number(n || 0).toLocaleString() }, Number(n || 0))
// The HUD's kinds and progress messages, and the poster image's alt text (what a screen reader announces
// for a card), in the page's language; English only where a key is absent. The same translator goes to
// usePosterPrints (opts.t) so the messages IT sets are localized too.
const hud = (key, en, params = null, n = undefined) => {
  const v = tCount(key, params || {}, n)
  return v && v !== key ? v : String(en).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m))
}
const itemCount = (n) => (props.itemCountKey ? countOf(props.itemCountKey, n) : `${n} ${n === 1 ? props.itemNoun : plural.value}`)
// A section head's count line. The people-group total and its " · " leave together when the total is 0 (a gallery
// of poster templates counts no people), the rule the cards already follow with v-if="item.count". One string in
// one interpolation, so a head with a total renders exactly the text it always did, whitespace included.
const sectionItems = (sec) => {
  const own = props.sectionItemCountKey ? props.sectionItemCountKey(sec) : null
  if (!own) return itemCount(sec.items.length)
  return typeof own === 'string' ? countOf(own, sec.items.length) : countOf(own.key, own.n ?? sec.items.length)
}
const sectionCount = (sec) => (sec.total > 0
  ? `${countOf('wall.peopleGroupCount', sec.total)} · ${sectionItems(sec)}`
  : sectionItems(sec))
const base       = computed(() => String(props.assetsBase || './assets').replace(/\/+$/, ''))

// ★ A SECOND PLACE TO LOOK, because "poster not generated yet" was being shown for posters that
// ARE generated. It was reported on Ethiopia, whose country-eth.webp exists (174 of the 175
// records have their .webp; India is the one that legitimately does not and carries its own
// reason). MEASURED here — static build AND dev server, every request 200, zero cards in that
// branch — so the file is not missing; a HOST LAYOUT is. resolveAssetsBase points at
// <treeRoot>/../assets, the shared pool, which is correct for the layout generate-tree documents
// and wrong on a host that publishes only the tree folder. generate-tree ALSO stages a
// self-contained copy INSIDE the tree ("staged 421 runtime asset(s) → doxa-maps/assets"), and
// that copy is reachable on both layouts. So: try the pool, and if the bytes do not arrive, try
// the copy before telling the user anything.
const fallbackBase = computed(() => {
  const root = String(bundleTreeRoot() || '').replace(/\/+$/, '')
  return root ? `${root}/assets` : ''
})
// 0/absent = first attempt, 1 = the fallback is being tried.
const attempt    = ref({})
const previewUrl = (id) => `${attempt.value[id] ? fallbackBase.value : base.value}/previews/${id}.webp`
function onPreviewError(id) {
  // A generated preview has no second base to try.
  if (props.previewSrc) { missing.value = { ...missing.value, [id]: true }; return }
  const fb = fallbackBase.value
  if (!attempt.value[id] && fb && fb !== base.value) { attempt.value = { ...attempt.value, [id]: 1 }; return }
  missing.value = { ...missing.value, [id]: true }
}

// Sections ordered by TOTAL count (largest first), items within a section by their
// own count — the densest prayer need leads at BOTH levels.
const sections = computed(() => {
  const byGroup = new Map()
  for (const it of props.items || []) {
    if (!it || !it.id) continue
    const g = props.groupBy(it) || 'Other'
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(it)
  }
  return [...byGroup.entries()]
    .map(([name, items]) => ({
      name,
      items: items.slice().sort((a, b) => (b.count || 0) - (a.count || 0)),
      total: props.sectionTotal ? props.sectionTotal(name, items) : items.reduce((n, x) => n + (x.count || 0), 0),
    }))
    .sort((a, b) => b.total - a.total)
})

// The INITIAL collapsed state, derived from the caller's rule. Kept separate from
// the user's overrides so a click is never fighting a re-seed.
//
// This used to seed lazily INSIDE isCollapsed(), i.e. it wrote to a ref while Vue
// was rendering. That is a side effect during render: the write happened after the
// dependency was already read, so toggling a section changed the ref and the DOM
// never updated — clicking a region header did nothing. Deriving the seed and
// layering explicit overrides on top keeps the render pure.
const seeded = computed(() => {
  const out = {}
  for (const s of sections.value) out[s.name] = !!props.collapsedBy(s)
  return out
})
const overrides = ref({})
const isCollapsed = (name) => {
  if (!props.collapsible) return false
  return name in overrides.value ? !!overrides.value[name] : !!seeded.value[name]
}
const toggleSection = (name) => {
  overrides.value = { ...overrides.value, [name]: !isCollapsed(name) }
}

const lastShown = ref(null)
const missing   = ref({})
// FORGET the shown card when the wall's view goes inactive (row 79). A composite marks its
// inactive pane `inert` (the PinHint contract); after "Show zone" -> Map -> back, the same card must SHOW
// again, not toggle off a selection the reader can no longer see. Watches the ancestor chain, through
// shadow roots, for inert/hidden/aria-hidden; clears lastShown only (the map keeps its selection).
const wallEl = ref(null)
let paneMOs = []
onMounted(() => {
  const chain = []
  for (let n = wallEl.value; n; n = n.parentNode || n.host || null) if (n.nodeType === 1) chain.push(n)
  const inactive = () => chain.some((a) => a.hasAttribute('inert') || a.hasAttribute('hidden') || a.getAttribute('aria-hidden') === 'true')
  if (typeof MutationObserver === 'undefined') return
  for (const a of chain) {
    const mo = new MutationObserver(() => { if (inactive()) lastShown.value = null })
    mo.observe(a, { attributes: true, attributeFilter: ['inert', 'hidden', 'aria-hidden'] })
    paneMOs.push(mo)
  }
})
onBeforeUnmount(() => { for (const mo of paneMOs) mo.disconnect(); paneMOs = [] })

// ★ THE CARD CONTAINS ITS PRINT ROW (2026-09-30, from a phone at two posters per row). The row is a sticker
// pinned --tape-overlap over the banner's bottom edge that grows DOWNWARD as its labels wrap. One line
// fits inside the card's 26px bottom padding; on a ~162px two-up card it wraps to three lines and hung
// about 45px below the card's white box. No fixed padding fits every locale x width (the reason the row
// is pinned by its overlap and not its centre), so each card is fitted to its own row: a ResizeObserver
// on every .pfs writes --pfs-room on the card: for a row that hangs past the white box (the 26px padding
// and the 1px border), the part below the banner plus ROW_DAYLIGHT_PX that the 26px does not cover. A row
// that fits writes 0 (a one-line row ends ~5px inside the box), so every card that fit is unchanged.
// The revealed packet/size rows stay overlays on purpose (.has-tape-open lifts the card above its
// neighbours); only the print row itself is contained.
const CARD_PAD_BOTTOM_PX = 26
const CARD_BORDER_PX = 1
const ROW_DAYLIGHT_PX = 8
let rowRO = null
function fitCardToRow(pfs) {
  const card = pfs.closest('.card')
  const banner = pfs.parentElement
  if (!card || !banner) return
  // Rect DIFFERENCES inside one card: the hover lift (a translateY on the card) moves both edges alike.
  const below = pfs.getBoundingClientRect().bottom - banner.getBoundingClientRect().bottom
  const hangs = below > CARD_PAD_BOTTOM_PX + CARD_BORDER_PX
  const room = `${hangs ? Math.ceil(below + ROW_DAYLIGHT_PX - CARD_PAD_BOTTOM_PX) : 0}px`
  if (card.style.getPropertyValue('--pfs-room') !== room) card.style.setProperty('--pfs-room', room)
}
// observe() is idempotent, so re-scanning after every render only adds the rows that are new (items,
// sections opened, the per-row choice); a hidden wall reports 0 and writes 0 until it is shown.
function observeRows() {
  if (!rowRO || !wallEl.value) return
  for (const pfs of wallEl.value.querySelectorAll('.pfs')) rowRO.observe(pfs)
}
onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  rowRO = new ResizeObserver((entries) => { for (const e of entries) fitCardToRow(e.target) })
  observeRows()
})
onUpdated(observeRows)
onBeforeUnmount(() => { if (rowRO) rowRO.disconnect(); rowRO = null })

// ─── GENERATED PREVIEWS (the previewSrc prop) ────────────────────────────────
// Nothing here runs unless the caller passes previewSrc. A pending card registers its placeholder
// through a function ref; the observer queues it once it is in view; the queue renders ONE preview
// at a time, so a gallery never starts a burst of renders on load. The answer is cached on the page
// (a module cache would be per bundle), so a remount or a second tab shows it without a re-render.
// Two limits, both deliberate: (1) the timeout stops the WAIT, not the render, so after one times out
// the next may start while the slow one still runs ("one at a time" is best-effort past a timeout);
// (2) the cache keeps whatever URL previewSrc returns for the life of the page and never revokes it,
// which suits a gallery that shows the same few previews again; a caller that makes many should say so.
const PREVIEW_TIMEOUT_MS = 20000
const previewCache = (globalThis.__posterWallPreviews_v1 ||= new Map())
const generated = ref({})          // id -> the URL previewSrc answered
const previewEls = new Map()       // id -> its pending placeholder
const previewIds = new WeakMap()   // placeholder -> id
const previewQueue = []
let previewBusy = false
let previewIO = null

function setPreviewEl(id, el) {
  const old = previewEls.get(id)
  if (old === el) return
  if (old && previewIO) previewIO.unobserve(old)
  if (!el) { previewEls.delete(id); return }
  previewEls.set(id, el)
  previewIds.set(el, id)
  if (previewIO) previewIO.observe(el)
}
function queuePreview(id) {
  if (id == null || generated.value[id] || missing.value[id] || previewQueue.includes(id)) return
  previewQueue.push(id)
  pumpPreviews()
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview timed out')), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}
async function pumpPreviews() {
  if (previewBusy || !previewQueue.length) return
  const id = previewQueue.shift()
  const item = (props.items || []).find((x) => x && x.id === id)
  if (!item || !props.previewSrc) { pumpPreviews(); return }
  previewBusy = true
  const key = `${props.instanceId}\u0000${id}`
  try {
    if (!previewCache.has(key)) {
      previewCache.set(key, withTimeout(Promise.resolve().then(() => props.previewSrc(item)), PREVIEW_TIMEOUT_MS))
    }
    let url = null
    try { url = await previewCache.get(key) } catch (_) { url = null }
    if (url) generated.value = { ...generated.value, [id]: url }
    else {
      previewCache.delete(key)     // a later mount may try again
      missing.value = { ...missing.value, [id]: true }
    }
  } finally {
    previewBusy = false
    pumpPreviews()
  }
}
onMounted(() => {
  if (!props.previewSrc) return
  // No observer (an old engine): still one at a time, just not deferred to view.
  if (typeof IntersectionObserver === 'undefined') { for (const id of previewEls.keys()) queuePreview(id); return }
  // The ROOT is the wall's own scroller: a pane wall scrolls inside .wall, which clips its cards, so
  // a viewport root would never see a card ahead of view and the margin would buy nothing. An embedded
  // wall is in normal flow and the page scrolls it, so there the viewport is the right root.
  previewIO = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) queuePreview(previewIds.get(e.target))
  }, { root: props.embedded ? null : wallEl.value, rootMargin: '200px' })
  for (const el of previewEls.values()) previewIO.observe(el)
})
onBeforeUnmount(() => { if (previewIO) previewIO.disconnect(); previewIO = null; previewQueue.length = 0 })

function showOnMap(item) {
  // TOGGLE, not a one-way set: a control the user can turn on but not off reads as
  // broken even when the selection is correct.
  const isOn = lastShown.value === item.id
  lastShown.value = isOn ? null : item.id
  window.dispatchEvent(new CustomEvent(props.eventName, {
    detail: {
      instanceId: props.instanceId,
      listId: isOn ? null : item.id,      // null = deselect
      label:  isOn ? null : item.label,
    },
  }))
}

// ─── EXPORT — serve the PRE-RENDERED poster ──────────────────────────────────
// Deliberately a fetch, not a re-render. Re-rendering produced a DIFFERENT
// ARTEFACT from the preview on the same card — a bare basemap capture with no
// title, no scripture bands, no facts table, no numbered pins. Serving the
// pre-rendered image makes preview and download identical BY CONSTRUCTION rather
// than by keeping two renderers in sync, and it works on Android where the Node
// generator cannot run at all.
const exportState = ref(null)
const { scrimRef, scrimStyle } = useViewportScrim(exportState)

async function exportPoster(item) {
  if (exportState.value) return                      // one at a time
  const reason = props.unsupported(item)
  if (reason) {
    exportState.value = { label: item.label, kind: hud('wall.hud.kindPoster', 'Poster'), phase: 'soon', message: reason, pct: 0 }
    return
  }
  exportState.value = { label: item.label, kind: hud('wall.hud.kindPoster', 'Poster'), phase: 'fetch',
                        message: hud('wall.hud.fetchingPoster', 'fetching the poster'), pct: 20 }
  try {
    // ★ GENERATED FIRST (the print standard): a host that can draw the sheet now (the `sheet` prop,
    // packet/posterSheets.js) prints or downloads THAT — no stored file involved, so a country, which has
    // no stored sheet on the published tree, still gets its poster. 'letter' for a print (the format made
    // for a home printer), the item's own poster size for a download. A generation that fails falls through
    // to the stored image and HTML below rather than to an error.
    if (props.sheet) {
      exportState.value = { ...exportState.value, phase: 'render', message: hud('wall.hud.generatingPoster', 'generating the poster'), pct: 35 }
      const format = props.posterAction === 'print' ? 'letter' : (item.sheet === '3x3' ? '3x3' : '3x4')
      const html = await Promise.resolve().then(() => props.sheet(item, format)).catch(() => '')
      if (html) {
        const { rasterPoster, looksRendered, hasExternalImages } = await import('@map/packet/poster-raster.js')
        // ★ A SHEET WITH PHOTOS PRINTS AS ITS OWN DOCUMENT (the large side-lane sheets): a raster cannot carry a
        // photo from its own host (poster-raster.js says why), and the sheet's own @page is its true size
        // (60in 96in), where an image of it would be shrunk onto letter. A download still rasterises, without them.
        if (props.posterAction === 'print' && hasExternalImages(html)) { await printSheetDocument(html); return }
        const blob = await rasterPoster(html, { scale: 2 })
        if (await looksRendered(blob)) { await deliverPoster(blob, item); return }
      }
    }
    // ⚠ A THROWN FETCH IS A MISS, NOT AN ERROR. `fetch` rejects — it does not return
    // !ok — when the request is blocked, offline, or refused by the network layer.
    // Letting that reject escape to the outer catch skips the rasterise fallback
    // entirely and reports "Failed to fetch" to the reader, on a poster the browser
    // could have generated from posters/<id>.html. Measured 2026-09-24 while
    // migrating my-upg-100-list onto this component: check:poster-print-fallback,
    // which aborts every .webp at the network layer to force the default-drop
    // condition, went from PASS on the old wall to FAIL here with 0 .html requests.
    // The wall this component was extracted from already guarded it; the extraction
    // did not carry the guard across. The guard now lives in poster-fetch.js, which also
    // takes a host's 200 fallback page (text/html for a missing .webp) as a miss.
    const raster = await fetchPosterRaster(`${base.value}/posters/${item.id}.webp`)
    if (!raster) {
      // ★ NO PRE-RENDERED IMAGE? GENERATE IT. The 378 .webp posters were 41 MB in
      // every clone, shipped to every reader whether or not they opened one — and a
      // publish was already rejected once at a 74 MB asset tree. The poster HTML is
      // SMALLER than the image it produces (~115 KB gzipped vs ~213 KB) and it is
      // the source, so the reader picks the resolution instead of being handed one.
      // This is the same move the prayer packet already makes: generate on click,
      // ship nothing. A 404 used to end here as "poster not found".
      exportState.value = { ...exportState.value, phase: 'render',
        message: hud('wall.hud.generatingPoster', 'generating the poster'), pct: 45 }
      const source = await fetchPosterSource(`${base.value}/posters/${item.id}.html`)
      if (!source.html) throw keyedError('wall.hud.posterNotFound', 'poster not found ({status})', { status: source.status })
      const { rasterPoster, looksRendered } = await import('@map/packet/poster-raster.js')
      const blob = await rasterPoster(source.html, { scale: 2 })
      // Fail LOUDLY rather than hand over a black rectangle: an SVG in an <img> is
      // an isolated document, so a missing stylesheet makes every fill fall back to
      // black with no error at all.
      if (!(await looksRendered(blob))) throw keyedError('wall.hud.posterBlank', 'the generated poster came out blank')
      await deliverPoster(blob, item)
      return
    }
    await deliverPoster(raster, item)
  } catch (e) {
    exportState.value = { label: item.label, kind: hud('wall.hud.kindPoster', 'Poster'), phase: 'error',
      message: errorText(e, (k, p) => hud(k, k, p)).slice(0, 140), pct: 0 }
  }
}

// ── SHARED PRINT ACTIONS ──────────────────────────────────────────────────
// The list and card-deck prints live in the shared composable so every wall gets
// the same documents. They need ROWS, which only the bundle can fetch — hence the
// `records` prop. Without it the buttons are hidden and this stays honest rather
// than offering an action that cannot work.
// The wall follows the app's locale: the card deck and its QR codes are localised,
// and packet-strings.json falls back per key.
// `t` for the wall's own labels, `locale` for the card deck's language. Both come
// from the SAME instance so a label and a printed deck can never disagree about
// which language the reader chose.
// ★ i18n IS OPTIONAL IN A LIBRARY COMPONENT, NOT REQUIRED. useI18n() THROWS ("Need to install
// with `app.use` function") on any host that never installed vue-i18n, and seven bundles here do
// not — big-picture, doxa-maps-spa, doxa-vision-card, golden-path-check, people-groups-grid,
// plugin-studio, stack-demo. An unguarded call in a component this widely consumed is a BLANK
// PAGE waiting for the first bare host that renders it: exactly how library FilterDropdown
// blanked people-groups-grid, a production plugin, fixed by studio in 6603dc17. Same shape of
// fix as PinHint.vue.
//
// ⚠ THE FALLBACK IS DERIVED, NOT A TABLE. Hardcoding English for these eleven keys would put a
// second copy of the `en` catalog inside this file, and two copies of one fact drift — the exact
// trap behind the embedBase asset-path bug this week. Humanizing the last path segment gives
// "buttons.prayerList" -> "Prayer List", "buttons.cardDeck" -> "Card Deck",
// "buttons.posterMap" -> "Poster Map": readable English that CANNOT go stale, rather than a raw
// key shown to a reader.
const humanizeKey = (k) => String(k).split('.').pop()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
// C4: the guard is library/composables/useOptionalI18n now. humanizeKey stays the fallback and the
// bare-host locale stays 'en', so nothing this wall prints changes.
const { t, locale: wallLocale } = useOptionalI18n('', { fallback: (k) => humanizeKey(k) })
// ⚠ ONE exportState, not two. The composable owns a ref of its own; if the HUD
// keeps rendering the wall's while the print actions write to the composable's, a
// card-deck print shows NO progress and its errors vanish silently — the mechanism
// works and the feedback does not. Hand the composable this wall's ref so both
// write to the surface the reader is actually looking at.
// ── CARD STOCK, optionally reader-chosen ────────────────────────────────────
// pickedStock is what the deck actually prints at: the prop when there is no
// picker, the reader's choice when there is.
const pickedStock = ref(props.cardStock)
const stockOptions = ref([])
// ⚠ LAZY, deliberately. usePosterPrints imports card-render.js dynamically
// (usePosterPrints.js:157) to keep a 10KB renderer out of every wall's initial
// bundle; importing it statically here just for five labels would undo that for
// every consumer, including the ones that show no picker at all. So the options
// fill in when the module arrives, and until then the <select> simply is not
// rendered — no flash of unlabelled ids.
// A stock's name in the page's language: the NOUN translates (wall.stockCard / stockPostcard), the size
// stays as a printer's box prints it, and a stock without a noun (A6) keeps its international name.
const stockLabel = (s) => {
  if (!s.noun) return s.label
  const key = `wall.stock${s.noun[0].toUpperCase()}${s.noun.slice(1)}`
  const noun = tCount(key)
  if (!noun || noun === key) return s.label
  const dims = `${s.w} × ${s.h} in`
  return s.side ? `${noun} ${dims} (${tCount('wall.stockLandscape')})` : `${noun} ${dims}`
}
if (props.cardStocks) {
  import('@map/packet/card-render.js').then(({ STOCK }) => {
    const want = Array.isArray(props.cardStocks) ? props.cardStocks : Object.keys(STOCK)
    stockOptions.value = want
      .filter((id) => STOCK[id])          // an unknown id is dropped, not rendered blank
      // The STOCK is kept, not a label string: the label is read at render (stockLabel below), so a
      // locale change re-labels the buttons like every other string on the wall.
      .map((id) => ({ id, stock: STOCK[id] }))
    // Keep the default honest: if the configured cardStock is not on offer, fall
    // back to the first one that is, rather than printing at a size not listed.
    if (!stockOptions.value.some((s) => s.id === pickedStock.value)) {
      pickedStock.value = stockOptions.value[0]?.id || props.cardStock
    }
  }).catch(() => { /* no picker rather than a broken one */ })
}

const prints = usePosterPrints({
  t: (key, params, n) => tCount(key, params, n),
  state: exportState,
  // This wall's HUD renders phase 'ready' as a Print button (a phone whose tap expired while preparing).
  tapToPrint: true,
  records: props.records ? (item) => props.records(item) : null,
  // useI18n()'s locale can be a ref or a plain string depending on how the host
  // installed it, so normalise rather than assume.
  lang: () => {
    const l = wallLocale && (wallLocale.value ?? wallLocale)
    return (typeof l === 'string' && l) || 'en'
  },
  stock: () => pickedStock.value,
  label: (item) => item?.label || item?.id || '',
  // The near-neighbours table for the FULL packet's bounded/centered back page — fetched from the
  // SAME served asset pool the posters come from, so an embedded copy of this bundle prints the
  // same page as the dev tree. null on any failure: the packet prints without the page rather
  // than not printing.
  // assetsBase feeds the packet's default map lift (posters/<id>.html). Without it the lift's
  // guard skips silently and the wall would STILL print a mapless packet — the exact
  // seam-without-supplier failure this change exists to close, one layer down.
  assetsBase: () => props.assetsBase,
  iso3Names: props.iso3Names ? () => props.iso3Names() : null,
  mapImage: props.mapImage ? (item) => props.mapImage(item) : null,
  sheet: props.sheet ? (item, format) => props.sheet(item, format) : null,
  sets: () => fetch(`${props.assetsBase}/tables/near-neighbors.json`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null),
})
const canPrintRows = computed(() => typeof props.records === 'function')
const previewIsControl = computed(() => props.previewAction === 'print')

// ── CARD-DECK DISCLOSURE ────────────────────────────────────────────────────
// Which card currently has its size row revealed, by item id. Holding an ID
// rather than a boolean-per-card means opening one CLOSES the others for free:
// two size rows open at once would overlap in the grid gap, and there is no
// reading of the request where two are wanted.
// ★ NOW A COMPOUND KEY, `${id}:${which}` — the Prayer List gets the SAME caret, with two entries
// (Full detail / Lightweight), and explicitly not a merged menu and not a second dropdown component. There is no dropdown COMPONENT here to reuse: this is an inline
// disclosure, one ref plus a sibling tape of plain buttons. So the PATTERN is generalized instead of
// copied — copy/paste would give two independent open-states, and then opening the Prayer List would
// NOT close the Cards, so two tapes could sit open at once and overlap in the grid gap. That is a
// visible regression on the Cards row, which is to stay exactly as it is.
// Holding ONE key keeps "opening one closes the others" free, which is why it was an id to begin with.
const deckOpenFor = ref(null)
const deckKey = (id, which) => `${id}:${which}`
function toggleDeck(id, ev, which = 'deck') {
  const key = deckKey(id, which)
  deckOpenFor.value = deckOpenFor.value === key ? null : key
  // Tell the size row how far down to start: the print row's REAL height, which is
  // one line in en and two in the long-label locales. Walking up from the clicked
  // button to its own .pfs keeps this correct per card rather than per wall.
  const pfs = ev?.currentTarget?.closest?.('.pfs')
  if (pfs) pfs.parentElement?.style.setProperty('--pstocks-gap', `${pfs.offsetHeight}px`)
}

// Choosing a size IS the print command — the reader already said "print the
// cards" by opening this row, so a second confirm step would be a click with
// nothing behind it. prints.stock reads pickedStock through a getter, so setting
// it here is what the deck prints at.
function printDeckAt(item, stockId) {
  pickedStock.value = stockId
  deckOpenFor.value = null
  prints.printCardDeck(item)
}

function downloadPacket(item) {
  // Still the honest "not yet" when this wall has no records provider: NOT an
  // error — unbuilt, not broken. phase:'error' reads to a user as "something went
  // wrong" rather than "not yet".
  if (!canPrintRows.value) {
    exportState.value = { label: item.label, kind: hud('wall.hud.kindPrayerList', 'Prayer List'), phase: 'soon',
      message: props.prayerListSoonMessage, pct: 0 }
    return
  }
  prints.printList(item)
}

// ★ THE TWO PACKETS the Prayer List caret reveals. Declared here rather than inline in the
// template so the row is DATA — a third packet is one entry, not a markup change — and so the
// gate can assert the entries without parsing HTML.
// ⚠ The ids MUST match packet-render's VARIANTS keys; buildPacket falls back to 'full' on an
// unknown one, which would silently print the wrong packet rather than failing. Asserted in
// internal/check-packet-variants.mjs, which reads BOTH sides and compares.
const packetVariants = [
  { id: 'full', labelKey: 'buttons.packetFull' },
  { id: 'lightweight', labelKey: 'buttons.packetLightweight' },
]

// Choosing a variant IS the print command, exactly as choosing a card size is — the reader
// already said "prayer list" by opening the row. Routed through downloadPacket's guard rather
// than around it, so a wall with no records provider answers "not yet" identically whichever
// entry is picked. Opening a variant closes the row, like printDeckAt.
// ★ THIS CALLS printPacket, NOT printList — and that difference is a DEFECT FIX, not a refactor.
// MEASURED: downloadPacket() above calls prints.printList(item), which renders a COLUMNAR TABLE
// (name / country / population / religion — usePosterPrints.js:150). The PRAYER PACKET as specified
// — map, life calendar, %-evangelical grid, triangle, profiles, wheel, points — is
// prints.printPacket, and this wall never called it. Every OTHER surface does
// (upg-100-list.vue:1430 and :1671, research-map.vue:1597, countries-map.vue:1360); the poster wall
// was the sole exception. So the button labelled "Prayer List" here has been printing a list, which
// is why the packet "does not follow the design that was asked for" ON THIS SURFACE — it was never
// the packet renderer's output.
function printPacketAs(item, variantId) {
  if (!canPrintRows.value) { downloadPacket(item); return }
  deckOpenFor.value = null
  // mapSvg/funnel are optional: printPacket defaults them, and mapPage/funnelPage each render ''
  // without data rather than breaking, so the wall prints a correct packet with the pages it can
  // truthfully draw. A host that has them can pass them through the same seam.
  prints.printPacket(item, { variant: variantId })
}

// ONE delivery point for the finished poster, so 'download' and 'print' cannot
// drift apart or be applied to only one of the two paths (shipped .webp vs
// browser-rasterised). Both callers in exportPoster() route through here.
// Print a generated sheet as the document it is (photos load, the page is its own size). Same HUD steps as
// deliverPoster's print, including the phone's Print button when the tap has expired.
async function printSheetDocument(html) {
  exportState.value = { ...exportState.value, phase: 'save', message: hud('wall.hud.openingPrint', 'opening the print dialog'), pct: 80 }
  const { printDocument } = await import('@map/composables/printInPlace.js')
  const how = await printDocument(html, { onNeedsTap: (printNow, cancel) => {
    exportState.value = { ...exportState.value, phase: 'ready', message: hud('wall.hud.readyToPrint', 'ready to print'), pct: 100,
      action: () => { exportState.value = null; printNow() }, cancel }
  } })
  if (how === 'needs-tap') return
  exportState.value = { ...exportState.value, phase: 'done', message: hud('wall.hud.printOpened', 'print dialog opened'), pct: 100 }
  setTimeout(() => { exportState.value = null }, 900)
}

async function deliverPoster(blob, item) {
  if (props.posterAction === 'print') {
    exportState.value = { ...exportState.value, phase: 'save', message: hud('wall.hud.openingPrint', 'opening the print dialog'), pct: 80 }
    const { printDocument } = await import('@map/composables/printInPlace.js')
    const url = URL.createObjectURL(blob)
    posterObjectUrls.push(url)
    // A 3ft SQUARE on a PORTRAIT sheet must fit by its SHORTER axis: scaling to the
    // full page WIDTH makes it taller than the printable height and it overflows onto
    // a second page. Constrain both axes and let object-fit letterbox it.
    // printDocument: the in-place frame as before, or on a phone the PAGE itself (printInPlace.js says why).
    const how = await printDocument(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
      + esc(`${props.downloadPrefix} — ${item.label || item.id}`) + '</title>'
      + '<style>@page{size:letter portrait;margin:12mm}'
      + 'html,body{margin:0;height:100%;background:#fff}'
      + 'body{display:flex;align-items:center;justify-content:center}'
      + 'img{max-width:100%;max-height:100vh;object-fit:contain;display:block}'
      + '@media print{body{height:auto}'
      + 'img{width:auto;max-width:100%;max-height:100%;object-fit:contain}}</style></head>'
      + `<body><img src="${url}" alt="${esc(item.label || item.id)}"></body></html>`,
      { onNeedsTap: (printNow, cancel) => {
        exportState.value = { ...exportState.value, phase: 'ready', message: hud('wall.hud.readyToPrint', 'ready to print'), pct: 100,
          action: () => { exportState.value = null; printNow() }, cancel }
      } },
    )
    // The reader now owns the next step: the Print button in the HUD.
    if (how === 'needs-tap') return
  } else {
    exportState.value = { ...exportState.value, phase: 'save', message: hud('wall.hud.saving', 'saving'), pct: 80 }
    download(blob, `${props.downloadPrefix}-${item.id}-poster.webp`)
  }
  exportState.value = { ...exportState.value, phase: 'done',
    message: props.posterAction === 'print' ? hud('wall.hud.printOpened', 'print dialog opened') : hud('wall.hud.saved', 'saved'), pct: 100 }
  setTimeout(() => { exportState.value = null }, 900)
}

// Blob urls for printed posters. NOT revoked when the frame opens — the preview
// <img> is still loading from them and revoking early prints a blank sheet — so
// they are held until this component goes away.
const posterObjectUrls = []
onBeforeUnmount(() => {
  for (const u of posterObjectUrls.splice(0)) { try { URL.revokeObjectURL(u) } catch { /* already gone */ } }
})

// Escape the characters that break out of an HTML text node or a "..." attribute.
// The print document is built by string concatenation, so every interpolated value
// — a list label straight from data — goes through this first.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

// A 'ready' print that the reader walks away from takes its document with it, so the browser's own Print
// menu prints the page again rather than a poster nobody asked for.
function dismissExport() {
  const s = exportState.value
  exportState.value = null
  try { if (s && typeof s.cancel === 'function') s.cancel() } catch (_) { /* already gone */ }
}

useShadowStyles(
  // --wall-pad-top is read back by .sec-head::before to cover the scroll-padding strip
  // above a pinned header (see there). Declared as a var so the two can never drift:
  // typing 22px in both places is how that gap would silently re-open.
  '.wall{--wall-pad-top:22px;position:absolute;inset:0;overflow-y:auto;' +
  'padding:var(--wall-pad-top) 18px 44px;' +
  "background:#f6f7f9;color:#0f1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.wall.is-dark{background:#0a1410;color:#e5e7eb}' +
  // Embedded: normal flow, no pane background, no pane padding. inset:auto matters as much
  // as position:static — leaving inset set keeps the box stretched even once static.
  // ⚠ --wall-pad-top MUST go to 0 here too, not just the padding. Embedded, the wall is not
  // the scroll container — the HOST page is — so there is no scroll-padding strip to cover,
  // and a 22px cover bar would paint the wall's background over the host's own content
  // above each header. The var and the padding are one decision, set in one place.
  '.wall--embedded{--wall-pad-top:0px;position:static;inset:auto;overflow-y:visible;' +
  'padding:0;background:transparent}' +
  '.wall--embedded.is-dark{background:transparent}' +
  '.wall-h{margin:0 0 6px;font-size:19px;font-weight:700;text-align:center}' +
  '.wall-tag{margin:0 auto 12px;width:fit-content;padding:3px 11px;border-radius:999px;' +
  'background:rgba(16,185,129,.13);color:#0b7a5b;border:1px solid rgba(16,185,129,.28);' +
  'font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}' +
  '.is-dark .wall-tag{background:rgba(16,185,129,.16);color:#6ee7b7;border-color:rgba(110,231,183,.32)}' +
  '.wall-sub{margin:0 auto 22px;max-width:620px;font-size:12.5px;line-height:1.55;' +
  'text-align:center;opacity:.75}' +
  '.wall-sub strong{font-weight:700;opacity:1;color:inherit}' +
  // GAP must clear the OVERHANGING TAPES, not just the card boxes: the header tape
  // sits at top:-11px and the footer fieldset at bottom:-14px, so a 26px row gap
  // left ~1px of real air and the wall read as one dense block.
  // ⚠ THE ROW GAP MUST CLEAR THE PRINT ROW, and 88px was tuned for a row that NO LONGER HANGS
  // THAT FAR. It was set when .pfs sat at top:100% with margin-top:-14px on the CARD — i.e. the
  // whole row (up to 78px wrapped) hung below the card and the gap had to clear all of it.
  // The row now straddles the BANNER's bottom edge and overhangs by --tape-overlap plus whatever
  // grows downward, and the card's own 26px bottom padding absorbs part of that. Reported from a
  // 390x844 phone shot: a ~180px empty band between one row's print stickers and the next row's
  // header stickers — the gap is now clearing a distance nothing occupies.
  // 56px still clears a two-line row (the ro/ru case) with room; the assertion that keeps this
  // honest is `neighbour 0` in check-poster-card-fits, which fails if a row reaches another card.
  '.grid{display:grid;gap:56px 30px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));' +
  'max-width:1180px;margin:0 auto}' +
  // The per-row control. Sits above its own grid, right-aligned so it reads as a setting for the
  // block below rather than as content, and inherits the wall's type so it does not announce
  // itself. max-width matches the grid's, so the two share an edge.
  '.perrow{display:flex;align-items:center;justify-content:flex-end;gap:8px;' +
  'max-width:1180px;margin:0 auto 12px;font:inherit;font-size:13px}' +
  '.perrow__label{color:#6d766e}' +
  '.perrow__select{font:inherit;font-size:13px;padding:2px 6px;border:1px solid #cbd2d9;' +
  'border-radius:6px;background:#fff;color:inherit;cursor:pointer}' +
  '.is-dark .perrow__label{color:#9fb3a6}' +
  '.is-dark .perrow__select{background:#132019;border-color:rgba(110,231,183,.20)}' +
  // --card-pad-top IS the banner's top edge in card coordinates, and .tape-h reads it to
  // centre itself there. Declared as a var so the two cannot drift apart the way a second
  // hand-typed 24px would.
  '.card{--card-pad-top:24px;--tape-overlap:16px;position:relative;background:#fff;border:1px solid #e3e6ea;' +
  'border-radius:3px;' +
  // --pfs-room: the extra bottom padding a card needs to CONTAIN its print row once that row wraps
  // (fitCardToRow in the script). 0 wherever the row fits the 26px, so those cards are unchanged.
  'padding:var(--card-pad-top) 12px calc(26px + var(--pfs-room,0px));' +
  'box-shadow:0 1px 3px rgba(0,0,0,.10),0 6px 18px rgba(0,0,0,.07);' +
  'transition:transform .16s ease,box-shadow .16s ease}' +
  // ★ THE BLUE OUTLINE IS A HOVER STATE, NOT A MISSING STATIC BORDER. Several reports have asked
  // for "the blue outline around the poster" to be restored, and MEASURED 2026-09-24 there has
  // never been one: all 136 elements painting a frame on this wall compute `outline:none`, and
  // every border is grey (.card #e3e6ea, .main #dfe3e7). Nothing regressed — the affordance was
  // never built. Asked for as Pinterest/Instagram do it: the card answers the pointer.
  //
  // ⚠ `outline`, NOT `border`, and this is the load-bearing choice. An outline is painted OUTSIDE
  // the box and takes no space, so it cannot move anything. Growing the border on hover would
  // re-lay-out the card by 2px and push the print row — whose geometry is asserted at five widths
  // by check:poster-card-fits (0 overflow / 0 over-preview / 0 neighbour intrusions) — meaning a
  // cosmetic hover would break a gate about print controls. outline-offset keeps it clear of the
  // rounded corner instead of cutting across it.
  //
  // ⚠ :focus-visible CARRIES IT TO THE KEYBOARD. A hover-only affordance tells a mouse user which
  // card they are about to act on and tells a keyboard user nothing, on a card whose buttons this
  // same wall already had to be fixed to name (791/791 accessible names).
  '.card:hover,.card:focus-within{transform:translateY(-3px);' +
  'box-shadow:0 3px 8px rgba(0,0,0,.14),0 12px 28px rgba(0,0,0,.10);' +
  'outline:2px solid #2f6fdb;outline-offset:2px}' +
  '.is-dark .card:hover,.is-dark .card:focus-within{outline-color:#5aa0ff}' +
  // ⚠ A TOUCH READER NEVER HOVERS. On a phone the lift and the outline would either never appear
  // or, worse, stick after a tap and leave a card looking selected. The print row on this wall is
  // always visible, so touch loses no affordance by dropping the hover state entirely.
  '@media (hover:none){.card:hover,.card:focus-within{transform:none;outline:none}}' +
  '.is-dark .card{background:#132019;border-color:rgba(110,231,183,.20)}' +
  // box-sizing is NOT inherited into a shadow root from the host page's reset.
  '.tape{box-sizing:border-box;position:absolute;left:50%;transform:translateX(-50%);z-index:2;' +
  'font-size:10.5px;font-weight:600;letter-spacing:.02em;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.08);background:#eef2f6;color:#23303c}' +
  '.is-dark .tape{background:#1d2b23;color:#cfe9d9;border-color:rgba(255,255,255,.10)}' +
  // ★ THE HEADER STICKER STRADDLES THE BANNER'S TOP EDGE, for the same reason the footer one
  // straddles the bottom. MEASURED before: 35px above the banner's top edge, -1px below — it
  // floated over the card, touching the banner nowhere. The rounded top sticker is the one
  // that reads as well spaced, so this keeps its size and shape exactly and only corrects
  // WHERE it sits: centred on the edge it is taping.
  // --banner-pad-top reserves the banner surface it lands on, so it never reaches the map.
  // .tape-h is positioned against .card (it is a direct child), and the banner's top is the
  // card's padding-top — hence top:24px, read from the card rather than restated.
  // Same rule as .pfs below: the OVERLAP onto the banner is the constant, not the centre. This
  // sticker is a single line at every width so centring happened to work, but pinning both
  // stickers the same way means one --tape-overlap governs both and neither can drift.
  // Its height grows UPWARD here (bottom-anchored to the band) so it never reaches the map.
  '.tape-h{top:calc(var(--card-pad-top,24px) - var(--tape-overlap,16px));' +
  'transform:translateX(-50%);' +
  'width:82%;padding:4px 8px;border-radius:999px;' +
  'display:flex;align-items:center;justify-content:center;gap:5px}' +
  '.tape-h:hover{background:#e2e8ee}' +
  '.hcount{font-weight:800;font-variant-numeric:tabular-nums}' +
  '.hsep{opacity:.45}' +
  '.hlabel{font-weight:600}' +
  '.card.is-last{box-shadow:0 0 0 2px #10b981,0 6px 18px rgba(0,0,0,.10)}' +
  '.card.is-last .tape-h{background:#10b981;color:#04241a;border-color:#10b981}' +
  // ⚠ min-width:0 ON THE CHILDREN — and NOT flex-wrap. width:82% bounds the fieldset, but flex
  // items default to min-width:auto and REFUSE to shrink below their intrinsic content width, so
  // four controls (Prayer List · Card Deck · stock select · Poster Map) burst the box regardless.
  // MEASURED 2026-09-24 at 1440px: all 27 cards overflowing, worst 110px past a 212px card.
  //
  // ★ flex-wrap:wrap FIXED THAT AND BROKE THE OTHER AXIS — reported the same day. The row is
  // absolutely positioned at bottom:-14px, so wrapping it to three lines grew it 35px -> 78px and
  // pushed its TOP up from 216px to 173px into a 238px card: straight over the preview image and
  // the card's outline. Horizontal overflow traded for vertical. min-width:0 alone lets the
  // controls compress on ONE line, which is what the row was always meant to be.
  // The gate that passed this only measured horizontal edges; it now measures the row's top too.
  // ⚠ ANCHORED AT THE TOP, NOT THE BOTTOM. This was bottom:-14px, so any growth pushed the row
  // UPWARD over the preview — which is exactly how wrapping it turned a sideways overflow into
  // a vertical one. Anchoring at top:100% pins it just under the card, so the
  // second line grows DOWN into empty space. MEASURED: 92px between the preview's bottom and
  // the next card, of which the single-line row used 35 — 51px spare.
  // ★ THE FOOTER STICKER STRADDLES THE BANNER'S BOTTOM EDGE. The header (Show on map) sits on the
  // top border of the poster box; the footer print options did not sit on the bottom one. The
  // footer now imitates the header, on the edge like a piece of tape.
  //
  // top:100% + translate(-50%,-50%) centres it on that edge at ANY height, which matters because
  // the row's height is NOT fixed: it holds two to four controls and grows with translated
  // labels (MEASURED 68px in en/ro, 54px in zh). A fixed margin-top left it hanging below the
  // edge and moved again whenever the height changed. Centring is self-correcting, so no
  // constant here has to track the locale.
  //
  // ⚠ top:100% IS THE BANNER'S BOTTOM EDGE ONLY BECAUSE .pfs LIVES INSIDE .main. As a SIBLING
  // of the banner it resolved against the CARD instead — MEASURED card bottom 453 vs banner
  // bottom 426, so the row centred on a line 27px past the banner, touching it nowhere. The
  // re-parenting and the centring are one fix; neither works alone.
  //
  // Half the sticker lands on the banner, so the banner must reserve white space for it or the
  // sticker sits on the map: that is --banner-pad-bottom on .main, and the gate asserts the
  // result (map-covered 0) rather than trusting the arithmetic.
  //
  // ⚠ DO NOT ADD margin-top HERE. `margin:0` in the shorthand below RESETS any margin-top
  // declared above it — a shorthand always beats an earlier longhand in the same block. A
  // margin-top:-1px sat here computing to 0px while I believed it was doing the positioning;
  // a mutation test (set it to 26px, expect the row to move) proved it inert.
  // ⚠ NOT CENTRED — and this is a MEASURED correction, not a preference. translate(-50%,-50%)
  // puts HALF the row's height onto the banner, and the row's height is CONTENT-DEPENDENT: it
  // wraps to two lines in ro/ru and to three at 390px once the labels wrap. Measured ro/390px:
  // 27 of 27 stickers overlapping the map by 4px, while en and zh were clean at the same
  // padding. No fixed --banner-pad-bottom can be right for every locale x width, because half
  // of a variable is a variable.
  //
  // So the OVERLAP is the constant instead of the centre: the sticker's top is pinned a fixed
  // --tape-overlap above the banner's bottom edge, and any extra height grows DOWNWARD into
  // the grid's row gap, where there is room. The amount sitting on the banner is now the same
  // in all 11 locales at every width, which is what --banner-pad-bottom has to clear.
  '.pfs{position:absolute;top:calc(100% - var(--tape-overlap,16px));' +
  'left:50%;transform:translateX(-50%);' +
  // ⚠ min-width:0 ON THE FIELDSET ITSELF. A <fieldset> gets `min-width:min-content` from the
  // UA stylesheet, which OVERRIDES width and max-width — measured: computed width 431px
  // inside a 212px card while the rule said 82%. That is the real reason `width:82%` read as
  // correct in source for so long and the row still burst the card.
  'width:82%;max-width:82%;min-width:0;box-sizing:border-box;margin:0;padding:0 4px 3px;' +
  'border:1px solid rgba(0,0,0,.14);' +
  'border-radius:2px;background:#fff;display:flex;flex-wrap:wrap;gap:2px;justify-content:center;' +
  'box-shadow:0 1px 4px rgba(0,0,0,.10)}' +
  // Let every control shrink inside the row rather than push it open. overflow:hidden +
  // text-overflow keeps a squeezed label readable instead of spilling.
  // ⚠ NO ELLIPSIS CRUSH. min-width:0 alone let three 76-79px labels share 172px — 40px each,
  // about five characters, so 'Prayer List' and 'Poster Map' both read 'Pra…'. MEASURED: 81
  // of 108 controls clipped. Fitting a row by hiding what its buttons say is not fitting it.
  // flex-basis:auto + wrap lets each control take the width its LABEL needs and flow to a
  // second line, which there is room for now that the row grows downward.
  // ⚠ nowrap HERE IS A CLIPPING BUG IN THE NARROW x LONG-LABEL CORNER, and it only appeared once
  // the per-row default became 2: at 390px that halves the card to ~170px, and Romanian's
  // "Pachet de cartonașe" (133px) plus two more controls cannot share it on one line.
  // MEASURED after the merge: 54 of 81 controls clipped at ro/390px, en and zh clean — long
  // labels and a narrow card, exactly the pair each change was individually fine with.
  // The standing ruling on this wall is that a label too long for its box WRAPS; nowrap forced
  // the browser to clip instead. Wrapping costs a second line in the one corner that needs it.
  '.pfs > .pbtn{flex:0 1 auto;min-width:0;white-space:normal;overflow-wrap:break-word;' +
  'text-align:center;line-height:1.2}' +
  '.is-dark .pfs{background:#132019;border-color:rgba(110,231,183,.24)}' +
  // ── THE REVEALED SIZE ROW ────────────────────────────────────────────────────
  // Sits directly under the print row, still hanging into the grid's 88px row-gap.
  // ⚠ THE OFFSET IS MEASURED, NOT GUESSED. Both rows share .main as containing block, so
  // "under .pfs" means top:100% + .pfs's own height — and that height is NOT a constant:
  // the row wraps to a second line in long-label locales (ro/ru measured at 2 lines).
  // A hard-coded 20px would tuck the size row under the print row in exactly those
  // locales. toggleDeck() reads the live offsetHeight and writes it to --pstocks-gap.
  // ⚠ THE OFFSET IS THE FULL ROW HEIGHT MINUS A FIXED STICKER OVERHANG, NOT HALF THE ROW.
  // It used to be `calc(var(--pstocks-gap) / 2)`, reasoning that the footer sticker half-overhangs
  // the banner edge so half the row's height is the right clearance. That holds ONLY while the row
  // is ONE LINE. On mobile it wraps to two, and half of a doubled height is no longer half a row —
  // it lands squarely on the labels, so the size options covered the words "Card deck" themselves.
  // Reported from mobile 2026-09-28.
  // A FRACTION OF A VARIABLE HEIGHT IS THE BUG: the sticker's overhang is a CONSTANT (~11px), so
  // subtracting a constant is correct at any number of lines, while halving is correct at exactly
  // one. Same shape as the box-sizing error on the packet's table rows — a value that happens to be
  // right at one size and is silently wrong at every other.
  '.pstocks{top:100%;margin-top:calc(var(--pstocks-gap,20px) - 11px);width:92%;max-width:92%;' +
  'box-sizing:border-box;padding:3px;border-radius:2px;background:#fff;' +
  'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;' +
  'box-shadow:0 1px 4px rgba(0,0,0,.10);cursor:default}' +
  '.is-dark .pstocks{background:#132019;border-color:rgba(110,231,183,.24)}' +
  // ★ The open card outranks its siblings. 5 sits above any card (all of which are z-index:auto)
  // and below the sticky section header at 6, so a revealed tape never covers the header the
  // reader uses to scroll — a menu that hides its own navigation is a worse bug than the one
  // being fixed here.
  '.card.has-tape-open{z-index:5}' +
  // The tape is OPAQUE and casts a shadow so it reads as sitting ON the card below rather than
  // being tangled with it. Without a solid background the next card's text shows through, which is
  // the other half of what "underlapping" looks like on a phone.
  '.pstocks{box-shadow:0 2px 10px rgba(0,0,0,.18)}' +
  '.pfs > legend{margin:0 auto;padding:0 5px;font-size:8px;text-transform:uppercase;' +
  'letter-spacing:.6px;font-weight:700;color:#8a93a0}' +
  '.is-dark .pfs > legend{color:#7f9c8c}' +
  '.pbtn{position:relative;flex:1;border:0;background:none;color:#5b6672;font:inherit;' +
  'font-size:10.5px;font-weight:600;padding:2px 6px 3px;cursor:pointer;white-space:nowrap;' +
  'transition:color .15s}' +
  '.pbtn::after{content:"";position:absolute;left:6px;right:6px;bottom:0;height:2px;' +
  'border-radius:2px;background:transparent;transition:background .15s}' +
  '.pbtn:hover{color:#10b981}' +
  '.pbtn:hover::after{background:#10b981}' +
  // The deck button is a DISCLOSURE, so it says so while open — a caret that flips,
  // plus the green the row already uses for "active", so the reader can see which
  // card's sizes are showing without reading aria-expanded.
  '.pbtn-deck[aria-expanded="true"]{color:#10b981}' +
  '.pbtn-deck::before{content:"\\25B8";display:inline-block;margin-right:3px;font-size:8px;' +
  'transition:transform .15s}' +
  '.pbtn-deck[aria-expanded="true"]::before{transform:rotate(90deg)}' +
  // Size choices. These are BUTTONS, not <option>s — a native dropdown here would
  // collide with the other dropdowns on the host page.
  // Each one both picks the size and prints, so it is styled as an action.
  // ⚠ NO nowrap HERE, and this is a MEASURED correction rather than a preference. With
  // white-space:nowrap the two landscape labels rendered 161px inside a 169px row and CLIPPED
  // ("Card 3.5 x 2.5 in (landscape)", "Postcard 6 x 4 in (landscape)"). The standing ruling on
  // this wall is that a label too long for its box WRAPS — never an ellipsis, never a crop. So
  // each size takes a full row of its own when it needs one; flex-wrap on .pstocks gives it the
  // line, and min-width:0 lets the text actually break instead of forcing the box open.
  '.pstock{flex:0 1 auto;min-width:0;max-width:100%;border:1px solid #d8dde3;border-radius:3px;' +
  'background:#fff;color:#5b6672;font:inherit;font-size:9.5px;font-weight:600;' +
  'padding:2px 5px;cursor:pointer;line-height:1.25;white-space:normal;overflow-wrap:break-word}' +
  '.pstock:hover{border-color:#10b981;color:#10b981}' +
  '.pstock.is-on{border-color:#10b981;color:#0b7a5b;background:rgba(16,185,129,.10)}' +
  // ★ WCAG 2.5.8 Target Size (Minimum), AA = 24x24 CSS px. MEASURED at 390x844 on the UPG-100
  // wall: .pbtn 76x20, .pstock 188x20, .tape-h 289x22 -- 135 controls under the minimum on one
  // phone screen, and the same components fail on three other maps because they live in library/.
  // SCOPED TO (pointer:coarse) ON PURPOSE: 2.5.8 is a TOUCH ergonomics rule, and these three
  // controls sit in a row whose height was tuned by eye -- the tape must
  // straddle the border without reaching the poster's blue outline, with ~9px of artwork clearance
  // left. Growing them for the mouse would spend 2px of that clearance to solve a problem a mouse
  // does not have, on a wall that is another owner's map. A finger gets the bigger target; the
  // desktop keeps the geometry that was signed off. Safe to grow because both stickers are now
  // pinned by --tape-overlap rather than by their centres: the overlap onto the banner is the
  // constant, so extra height grows into empty space instead of walking over the artwork.
  // ⚠ STATE THE REQUIREMENT, DO NOT COMPUTE IT. The first attempt here grew the padding instead
  // -- 2px a side on .pbtn, 2px on .pstock -- and MEASURED 23.7px and 23.0px: under the minimum by
  // a third of a pixel and by one, because the height is padding PLUS a line box derived from a
  // 10.5px font, and that line box is the renderer's number, not mine. min-height IS the 24 the
  // spec asks for, it survives a font swap or a locale with taller glyphs, and a reader can check
  // it against WCAG without doing arithmetic. Both controls centre their own label, so no padding
  // change is needed to go with it.
  '@media (pointer:coarse){' +
  '.pbtn{min-height:24px}' +
  '.pstock{min-height:24px}' +
  '.tape-h{min-height:24px}' +
  '}' +
  // previewAction='print' only. The zoom-in cursor says "this opens something", and
  // the focus-visible outline is not optional: it is how a keyboard user sees where
  // they are on a control that is otherwise just a picture.
  '.img.is-clickable{cursor:zoom-in}' +
  '.img.is-clickable:hover{outline:2px solid #38bdf8;outline-offset:-2px}' +
  '.img.is-clickable:focus-visible{outline:2px solid #38bdf8;outline-offset:-2px}' +
  '.is-dark .pstock{background:#12211a;border-color:#2c4a3b;color:#9fb3a8}' +
  '.is-dark .pbtn{color:#9fb3a8}' +
  // The section is the sticky header's CONTAINING BLOCK: a sticky element only
  // stays pinned while its parent is in view, so each header releases exactly when
  // its own countries have scrolled past and the next region takes over. That
  // hand-off is what makes it read as a TreeTable rather than one floating bar.
  // Bottom margin is on a spacer INSIDE the section (not the section itself), or
  // the header would stay pinned over 56px of empty paper.
  // ★ EACH SECTION IS A STACKING CONTEXT, EARLIER ONES ON TOP (2026-09-30, reported from a phone): the LAST
  // poster of a section opened its Prayer-List / Card-deck menu UNDER the next section's header, so its
  // buttons could not be tapped (measured at 390: Card-deck 3/5 and 4/5 tappable). The open card's z-index 5
  // sits deliberately below its OWN sticky header (6), but the menu hangs past the section's end, where the
  // NEXT section's header is also 6. The template gives each section a z-index that decreases down the wall:
  // inside a section nothing changes, and an earlier section's hanging menu paints over the later header.
  // (A card z-index above 6 would instead paint an open menu over its own pinned header when scrolled.)
  '.sec{position:relative;max-width:1180px;margin:0 auto;padding-bottom:44px}' +
  // TREETABLE ROW HEADER — STICKY, so it stays visible while its own children
  // scroll past: while a reader scrolls through a section's posters, its header stays
  // in view, so the section can be collapsed at any point instead of scrolled to its end.
  //
  // WHY position:sticky RATHER THAN A COMPONENT LIBRARY. The reference was
  // PrimeVue's TreeTable, but doxa-maps ships no component framework and this wall
  // renders INSIDE A SHADOW ROOT — a third-party table would bring its own global
  // stylesheet, its own theme layer and a dependency, to reproduce two behaviours
  // (expand a row, freeze its header) that are ~6 lines of CSS here. The
  // INTERACTION is what was asked for, not the package.
  //
  // Sticky needs an opaque background or the cards scroll THROUGH the header, and
  // it must not be inside a transformed/overflow-hidden ancestor. `.wall` is the
  // scroll container, so `top:0` is relative to it.
  // OPAQUE, not translucent. A sticky bar with a see-through background lets the
  // poster cards scroll visibly THROUGH the region name — measured on the country
  // wall, where Asia's header sat on top of four posters at once. backdrop-filter
  // is not enough; the fill has to be solid. A soft shadow separates the pinned bar
  // from the content passing under it.
  '.sec-head{display:flex;align-items:baseline;gap:10px;margin:0 2px 14px;' +
  'padding:11px 10px 9px;border-bottom:1px solid rgba(0,0,0,.10);' +
  'position:sticky;top:0;z-index:6;background:#f6f7f9;' +
  'box-shadow:0 6px 10px -8px rgba(0,0,0,.35);border-radius:4px 4px 0 0}' +
  '.is-dark .sec-head{border-bottom-color:rgba(255,255,255,.12);background:#0a1410;' +
  'box-shadow:0 6px 10px -8px rgba(0,0,0,.7)}' +
  // ★ THE TRANSPARENT STRIP ABOVE A PINNED HEADER: while scrolling, the posters showed through a
  // transparent band between the pinned header and the top of the page.
  //
  // CAUSE, MEASURED at 1440px: `position:sticky; top:0` pins to the scroll container's PADDING
  // BOX, not its border box. .wall has padding-top:22px, so a pinned header comes to rest 22px
  // down and the cards keep scrolling through those 22px. Probed at scrollTop 400/900/1600 the
  // element painting in that strip was IMG.img every time — literally posters flying past above
  // the header, exactly as reported.
  //
  // WHY A PSEUDO-ELEMENT AND NOT `top:-22px`. Pulling the header up by the padding does pin it
  // flush, but sticky clips nothing: the header's own first 22px would then sit outside the
  // container and its text would be cut off. And padding-top on the header itself would move the
  // text down instead of covering anything. A ::before that extends the SAME opaque fill upward
  // covers the strip while leaving both layout and the header's own position untouched — the
  // `outline` vs `border` distinction again: paint outside the box, do not re-lay-out.
  //
  // Height comes from --wall-pad-top (set on .wall), never a second literal 22px.
  // Full-bleed on x: the header is inset 2px by its own margin and the strip has to cover the
  // container's 18px side padding too, or the posters show through at the edges.
  '.sec-head::before{content:"";position:absolute;left:-20px;right:-20px;' +
  'bottom:100%;height:var(--wall-pad-top,0px);background:inherit;pointer-events:none}' +
  // Nothing to cover when the wall is not the scroller (--wall-pad-top is 0px there), but be
  // explicit: an embedded wall must never paint a bar over its host.
  '.wall--embedded .sec-head::before{display:none}' +
  // A collapsed row is a plain bar — no bottom rule reaching for content that is
  // not there.
  '.sec-head.is-shut{border-bottom-color:transparent;margin-bottom:6px}' +
  // The whole head is the hit target when collapsible — a 15px caret is a poor one.
  // NOTE `background` is NOT reset here. A <button> needs its UA background
  // cleared, but this selector is MORE SPECIFIC than the .sec-head rule above and
  // therefore silently won the cascade — so `background:none` here made the sticky
  // header transparent and the poster cards scrolled visibly through the region
  // name. The base rule owns the fill; this rule owns only button chrome.
  // ★ calc(100% - 4px), NOT 100%: the head keeps the 2px side margins of .sec-head, so a full-width button
  // overflowed the wall's content box by 4px. Its full-bleed ::before (left/right -20px) then reached 2px past
  // the wall on each side, and a collapsible wall scrolled sideways by 4px at any width (scrollWidth 394 in 390).
  '.sec-head.is-toggle{cursor:pointer;user-select:none;width:calc(100% - 4px);text-align:left;' +
  'border-top:0;border-left:0;border-right:0;font:inherit;color:inherit}' +
  '.sec-head.is-toggle:hover .sec-name{color:#10b981}' +
  '.sec-caret{display:inline-block;width:12px;font-size:10px;opacity:.55;' +
  'transition:transform .18s ease}' +
  '.sec-caret.is-open{transform:rotate(90deg)}' +
  '.sec-name{margin:0;font-size:15px;font-weight:700;letter-spacing:.01em}' +
  '.sec-count{font-size:11px;opacity:.6;font-variant-numeric:tabular-nums}' +
  // Poster aspect is 3ft x 3ft SQUARE — the real print ratio, so the wall previews
  // the actual artefact rather than an arbitrary box.
  // ★ THE BANNER IS NOT THE MAP — and until now it effectively was.
  // This box is a BANNER that DISPLAYS the map, the way a label displays a design. A banner taped
  // to a wall gets a sticker at the top and one at the bottom, each straddling its edge: a slight
  // overlap over the banner, never over the banner's content, because tape over the map would
  // spoil it.
  //
  // MEASURED before this change, and it is the whole problem: banner 240-426, map 241-425.
  // whiteSpaceTopOfBanner 1px, whiteSpaceBottomOfBanner 1px. The map filled the banner edge to
  // edge, so there was NO banner surface for a sticker to sit on — the bottom sticker could
  // only ever hang off into space (measured straddle: 1px on, 67px off) or cover the map.
  // Both wrong, and no amount of moving the sticker fixes it; the BANNER had to grow.
  //
  // --banner-pad is that room. .img is object-fit:contain, which fits the CONTENT box, so
  // padding reserves banner surface and the map shrinks to sit inside it rather than spilling.
  // The bottom gets MORE than the top because the footer sticker is taller than the header one
  // and, per the brief, should overhang the page BELOW the banner more than it covers the
  // banner itself ("probably an equal or more overlap").
  //
  // ⚠ aspect-ratio applies to the BORDER box here (box-sizing is border-box in this root), so
  // the square is the BANNER's shape, not the map's. The map inside is correspondingly shorter
  // than it is wide, which is correct: the banner is the thing being framed.
  //
  // overflow IS VISIBLE, DELIBERATELY. .pfs lives INSIDE this banner so its top:100% resolves
  // here; under `hidden` the print row was clipped to nothing. Nothing else needs the clip:
  // .img is object-fit:contain (never paints past its box) and .ph is a smaller flow box.
  // ⚠ DERIVED FROM THE STICKER HEIGHTS, NOT CHOSEN — and derived with SLACK, because the
  // heights are fractional. A sticker centred on the banner edge puts HALF its height onto the
  // banner, so the reserved white space must exceed that half.
  //   attempt 1: 10px/26px by eye vs 34px/68px stickers -> map covered by 6px and 8px.
  //   attempt 2: exactly half + 4px (21px/38px) -> STILL 1px of overlap on 27 cards in en and
  //              ro but NOT zh, where the print row is 54px rather than 68px. The rects are
  //              fractional (68.x), so half of them rounds past an integer constant; and the
  //              row's height is LOCALE-DEPENDENT, which no fixed number can track.
  // Hence generous slack rather than a tighter constant: 12px past the widest measured half.
  // The gate asserts the relationship (map-covered 0), so if a future locale wraps the row to
  // three lines this fails loudly instead of quietly shaving the map.
  // Now that the OVERLAP is a constant (--tape-overlap on .card) rather than half a
  // content-dependent height, the banner only has to reserve that overlap plus daylight —
  // the same number in every locale at every width. It was 29/50 chasing half of a row that
  // is 68px in en, 54px in zh and taller still when ro wraps at 390px; that chase is what put
  // 4px of sticker on the map. 16 + 8 of daylight, both ends.
  '.main{--banner-pad-top:24px;--banner-pad-bottom:24px;' +
  'position:relative;aspect-ratio:1/1;border:1px solid #dfe3e7;overflow:visible;' +
  'padding:var(--banner-pad-top) 10px var(--banner-pad-bottom);' +
  'background:#fbfcfd;display:flex;align-items:center;justify-content:center}' +
  '.is-dark .main{background:#0c1712;border-color:rgba(255,255,255,.08)}' +
  // CONTAIN, not cover: `cover` crops to fill, which on a square sheet sliced off
  // the title and the footer scripture.
  '.img{width:100%;height:100%;object-fit:contain;display:block}' +
  '.ph{padding:14px 10px;text-align:center}' +
  '.ph-label{font-size:12.5px;font-weight:700;line-height:1.3}' +
  '.ph-count{margin-top:5px;font-size:11px;opacity:.7}' +
  '.ph-note{margin-top:10px;font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;opacity:.45}' +
  // NOT-YET card — amber, deliberately distinct from a failed load.
  '.ph.is-soon{background:rgba(245,158,11,.06)}' +
  '.ph-soon{margin-top:9px;font-size:10px;line-height:1.45;color:#8a6414}' +
  '.is-dark .ph-soon{color:#e8b862}' +
  '.modal-scrim{position:fixed;inset:0;z-index:1000;background:rgba(8,12,16,.55);' +
  'display:grid;place-items:center;padding:22px}' +
  '.modal{width:min(340px,100%);background:#fff;color:#0f1419;border-radius:14px;' +
  'padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center}' +
  '.is-dark .modal{background:#132019;color:#e5e7eb}' +
  '.modal-kind{font-size:10px;text-transform:uppercase;letter-spacing:.1em;opacity:.55}' +
  '.modal-title{margin:3px 0 14px;font-size:15px;font-weight:700;line-height:1.3}' +
  '.bar{height:5px;border-radius:99px;background:rgba(0,0,0,.10);overflow:hidden}' +
  '.is-dark .bar{background:rgba(255,255,255,.12)}' +
  '.bar-fill{height:100%;background:#10b981;border-radius:99px;transition:width .25s ease}' +
  '.modal-phase{margin-top:10px;font-size:12.5px;font-weight:600}' +
  '.modal-hint{margin-top:6px;font-size:11px;line-height:1.5;opacity:.62}' +
  '.modal-soon{font-size:13px;line-height:1.5;color:#5f5849;margin:6px 0 14px}' +
  '.modal-err{font-size:12.5px;line-height:1.55;color:#b42318;margin-bottom:14px}' +
  '.is-dark .modal-err{color:#fda29b}' +
  '.modal-btn{border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit;' +
  'font:inherit;font-size:12.5px;padding:6px 18px;border-radius:8px;cursor:pointer}' +
  '.modal-btn:hover{background:rgba(0,0,0,.06)}',
  'doxa-poster-wall',

  + '/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,\n   and no generated leaf ships one anyway (measured: 0 across the whole tree). Additive only. */\n@media (prefers-reduced-motion: reduce) {\n  .pw-card, .pw-grid, .pw-overlay, .pw-btn { transition: none !important; animation: none !important; }\n}\n'
)
// ★ EACH SECTION IS A PosterSection (the head + its cards), drawn from THIS wall's state and actions, provided here.
const { collapsible, columnsControl, headerAction, hidePrayerListWhenSoon, instanceId, previewSrc, sectionHeads, unit, unsupported } = toRefs(props)
provide(POSTER_WALL_CTX, {
  collapsible, columnsControl, headerAction, hidePrayerListWhenSoon, instanceId, previewSrc, sectionHeads, unit, unsupported, PER_ROW_AUTO, T, canPrintRows, countOf, deckKey, deckOpenFor, emit, exportPoster, generated, gridStyle, hud, isCollapsed, lastShown, missing, onPreviewError, packetVariants, perRowChoices, perRowShown, pickedStock, previewIsControl, previewUrl, printDeckAt, printPacketAs, sectionCount, setPreviewEl, showOnMap, stockLabel, stockOptions, t, toggleDeck, toggleSection,
})
</script>

<template>
  <div ref="wallEl" class="wall" :class="{ 'is-dark': isDark, 'wall--embedded': embedded }">
    <template v-if="!sectionOnly">
    <h2 class="wall-h">{{ heading }}</h2>
    <div v-if="tag" class="wall-tag">{{ tag }}</div>
    <p v-if="intro" class="wall-sub" v-html="intro"></p>
    </template>

    <!-- Each section stacks ABOVE the ones after it (z-index decreasing down the wall; see .sec), so the LAST
         poster's open menu, which hangs past its section's end, sits over the next section's header. -->
    <PosterSection v-for="(sec, i) in sections" :key="sec.name" :sec="sec" :z="sections.length - i" />

    <div v-if="exportState" ref="scrimRef" :style="scrimStyle" class="modal-scrim" @click.self="(exportState.phase === 'error' || exportState.phase === 'ready') && dismissExport()">
      <div class="modal" role="dialog" aria-live="polite">
        <div class="modal-kind">{{ exportState.kind }}</div>
        <div class="modal-title">{{ exportState.label }}</div>

        <template v-if="exportState.phase === 'error'">
          <div class="modal-err">{{ exportState.message }}</div>
          <button type="button" class="modal-btn" @click="dismissExport">{{ t('buttons.close') }}</button>
        </template>

        <template v-else-if="exportState.phase === 'ready'">
          <div class="modal-soon">{{ exportState.message }}</div>
          <button type="button" class="modal-btn" @click="exportState.action && exportState.action()">{{ hud('wall.hud.printNow', 'Print') }}</button>
        </template>

        <template v-else-if="exportState.phase === 'soon'">
          <div class="modal-soon">{{ exportState.message }}</div>
          <button type="button" class="modal-btn" @click="dismissExport">{{ t('buttons.close') }}</button>
        </template>

        <template v-else>
          <div class="bar"><div class="bar-fill" :style="{ width: exportState.pct + '%' }"></div></div>
          <div class="modal-phase">{{ exportState.message }}</div>
          <div class="modal-hint">
            {{ t('buttons.renderingLocal') }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
