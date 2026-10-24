<script>
const pointerDoneThisLoad = new Set()
</script>

<script setup>
/**
 * MapInfo.vue — a map's "what can this do for you?" button, one-time pointer and example popup.
 *
 * The popup answers the question with REAL output the map makes.
 *
 * WHY: a map shown to someone with nobody beside them to explain it has to explain itself. The
 * popup does that by showing what you walk away with (a poster, a prayer packet, a deck of cards, a
 * spreadsheet), pre-generated, so it opens instantly instead of rendering for seconds.
 *
 * ★ EXAMPLES ARE A LIST, NOT A FIXED POSTER/PACKET/CARDS TRIPLE. Maps make different things: the
 * UPG-100 and Regions maps make posters, packets and cards; Big Picture makes only a spreadsheet
 * (its export is a CSV and it has no poster or packet anywhere). A fixed triple would promise a
 * button a map does not have. Each item is one artefact, in the order given:
 *   { kind: 'image', src, full?, alt?, titleKey? }    a poster or any single picture; `full` opens
 *                                                    the full-size file in a new tab
 *   { kind: 'pages', pages: [src, …], titleKey? }    the first page; expands to every page and back
 *   { kind: 'deck',  cards: [src, …], titleKey? }    a stacked deck; expands to every card and back
 *   { kind: 'table', columns: [..], rows: [[..]..], total?, titleKey? }
 *                                                    a small real excerpt of a spreadsheet; `total`
 *                                                    says how many rows the full export has. A
 *                                                    column is a ready string or { key } — pass the
 *                                                    table's own header keys so an Arabic reader does
 *                                                    not get English headers. Number cells are
 *                                                    formatted in the reader's locale.
 * Relative srcs resolve against `assetsBase`, so the same list works in any tree.
 *
 * ★ THE POINTER GOES FOR GOOD, per map, once its popup has been opened AND closed (opening alone
 * could be a mis-tap). The checkbox in the popup turns the pointer off on EVERY map. A map whose ⓘ is
 * its own control (trigger 'control') points ONCE PER PAGE LOAD instead, with no checkbox: see "the
 * page-load pointer" below. What is stored lives in
 * localStorage, read through a guard: private browsing and sandboxed frames throw on access, and a
 * hint must never be the thing that breaks a page. The button itself always stays.
 *
 * ★ TEXT. The component's own words are in the 'mapInfo' catalogue area, in all eleven locales, and
 * so are the per-map words, as mapInfo.tab.<tabId>.lead / .takeaway / .note, passed in as KEYS (ready
 * strings also work). NOT in each map's own area: a bundle ships only the catalogue areas its source
 * names (internal/i18n-areas.mjs), and the gallery that mounts one of these per map names none of the
 * maps' areas, so a key there would render blank; naming them would pull every map's whole catalogue
 * into the gallery. Everything is resolved at render, never stored, so a live language switch
 * re-translates it. A host without vue-i18n has only the page-global locale, which
 * nothing observes; pass `locale` from a host that tracks it, and the popup also re-reads the
 * global every time it opens.
 *
 * Usage (one per map, inside a positioned container):
 *   <MapInfo storage-key="upg-100" lead-key="…" :examples="[…]" :assets-base="assetsBase" />
 */
import { ref, reactive, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { tStatic, getRuntimeLocale } from '@map/i18n/index.js'

const props = defineProps({
  /** One per map. Keys the "this map's pointer has been seen" flag. */
  storageKey: { type: String, required: true },
  /** The map's own sentence: what it does for the reader. A catalogue key, or a ready string. */
  leadKey: { type: String, default: '' },
  lead: { type: String, default: '' },
  /** What the reader takes away. Key or string, optional. */
  takeawayKey: { type: String, default: '' },
  takeaway: { type: String, default: '' },
  /** A caveat under the examples (e.g. which countries are not supported yet). Key or string. */
  noteKey: { type: String, default: '' },
  /**
   * The map's STRATEGY, as a catalogue key PREFIX (e.g. 'mapInfo.tab.upg-100.strategy'): <prefix>.bottom is
   * the bottom line, <prefix>.p1, .p2 … the points, read in order until the first one that is missing. So
   * the number of points is the catalogue's business, never a count kept here. The popup shows the short
   * description (the lead) first, then the strategy as a collapsed disclosure, then the examples. The
   * takeaway is not shown beside a strategy, which supersedes it.
   */
  strategyKey: { type: String, default: '' },
  note: { type: String, default: '' },
  /** The artefacts, in display order. See the header for the four kinds. */
  examples: { type: Array, default: () => [] },
  /** Base for relative example srcs, normally the tree's assets folder. */
  assetsBase: { type: String, default: '' },
  /** Where the button sits in its container. */
  placement: { type: String, default: 'top-right', validator: (v) => ['top-right', 'top-left'].includes(v) },
  /** The host's current locale, when it tracks one. */
  locale: { type: String, default: '' },
  /**
   * 'floating' (default): this component draws its own button and pointer over its container.
   * 'control': the map draws the button in its own control column (map-controls/MapInfoButton.vue) and
   * this component answers it. Its own button stays as the FALLBACK, shown whenever that control is not
   * actually on screen (see "control mode" below).
   */
  trigger: { type: String, default: 'floating', validator: (v) => ['floating', 'control'].includes(v) },
  /**
   * With trigger 'control': the popup a MAP mounts for its own control when no host answers it (an
   * embed, a standalone page). It never draws its own button, since the map's control is the only
   * button; it answers that control from inside the map, points at it once per page load, and opens
   * the same popup. It announces itself as local, so the control can tell it from a real host.
   */
  popupOnly: { type: Boolean, default: false },
})
// ★ THE PAGE-LOAD POINTER (control mode). The pointer beside the map's own ⓘ shows ONCE PER PAGE LOAD:
// the first time that control is on screen in the load. It goes for the rest of the load once the reader
// opens the popup OR leaves the tab (the pane is hidden or inert), and a full reload shows it again. That
// is page-load memory (pointerDoneThisLoad), never storage, so the popup offers no checkbox: the
// every-map "don't point again" box belongs to the floating model, which stores its answer.
const pageLoad = () => props.trigger === 'control'

// ── locale and text ──────────────────────────────────────────────────────────────────────────────
// `opens` is read by every lookup, so opening the popup re-reads the page-global locale on hosts
// with no reactive one.
const opens = ref(0)
function lang() {
  void opens.value
  return String(props.locale || getRuntimeLocale() || 'en').split('-')[0].toLowerCase()
}
const t = useOptionalT('', { fallback: (q) => tStatic(q, lang()) })
const text = (key, str) => (key ? t(key) : str)
// The strategy, read from the catalogue in the reader's language (tStatic falls back to English per key).
// lang() reads `opens`, so the lines are re-read on every open. A point is a non-empty string; the first
// missing one ends the list.
const MAX_POINTS = 8
const strategyBottom = () => (props.strategyKey ? tStatic(props.strategyKey + '.bottom', lang()) || '' : '')
function strategyPoints() {
  const out = []
  if (!props.strategyKey) return out
  for (let i = 1; i <= MAX_POINTS; i++) {
    const v = tStatic(props.strategyKey + '.p' + i, lang())
    if (!v) break
    out.push(v)
  }
  return out
}
const hasStrategy = () => !!strategyBottom()

const num = (n) => { try { return new Intl.NumberFormat(lang()).format(n) } catch { return String(n) } }
const isRtl = () => lang() === 'ar'

// ── storage, guarded ─────────────────────────────────────────────────────────────────────────────
const SEEN = 'dxmaps.mapInfo.seen.'
const OFF = 'dxmaps.mapInfo.pointer'
const OFF_EVENT = 'dxmaps:mapinfo-pointer-off'
function readStore(k) { try { return window.localStorage.getItem(k) } catch { return null } }
function writeStore(k, v) { try { window.localStorage.setItem(k, v) } catch { /* private mode: in-memory only */ } }

// ★ PAGE-LOAD MEMORY: pointerDoneThisLoad, in the plain <script> block at the top of this file, is shared
// by every MapInfo on the page, so it must live in module scope: the gallery REMOUNTS a heavy tab's MapInfo
// on each switch back, and component state dies with the instance. It holds the storageKeys whose
// page-load pointer is done for this load; a full reload starts empty. (It sits ABOVE
// <script setup> so an ordering check reads it as declared before use; it carries no comment there
// because the library index takes this component's description from the file's first comment.)
const pointing = ref(false)
const pointerOff = ref(false)
function refreshPointer() {
  pointerOff.value = readStore(OFF) === 'off'
  if (pageLoad()) { pointing.value = !pointerDoneThisLoad.has(props.storageKey); return }
  pointing.value = !pointerOff.value && readStore(SEEN + props.storageKey) !== '1'
}
// Another map on the page (same document) or another tab (storage event) turned the pointer off. A
// page-load pointer ignores both: the every-map switch is not offered beside it, and a switch the reader
// cannot see on this map must not silently take its pointer away.
function onPointerOff() { if (!pageLoad()) refreshPointer() }
function onStorage(e) {
  if (pageLoad()) return
  if (!e || e.key === OFF || e.key === SEEN + props.storageKey) refreshPointer()
}
onMounted(() => {
  refreshPointer()
  window.addEventListener(OFF_EVENT, onPointerOff)
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => {
  window.removeEventListener(OFF_EVENT, onPointerOff)
  window.removeEventListener('storage', onStorage)
})
function setPointerOff(off) {
  pointerOff.value = off
  writeStore(OFF, off ? 'off' : 'on')
  pointing.value = !off && readStore(SEEN + props.storageKey) !== '1'
  try { window.dispatchEvent(new CustomEvent(OFF_EVENT)) } catch { /* no window */ }
}

// ── open / close ─────────────────────────────────────────────────────────────────────────────────
const open = ref(false)
const btnEl = ref(null)
const closeEl = ref(null)
const expanded = reactive({})
const failed = reactive({})
async function show() {
  opens.value++
  open.value = true
  // A page-load pointer is done for this load once the popup has been opened (in memory only).
  if (pageLoad()) pointerDoneThisLoad.add(props.storageKey)
  await nextTick()
  closeEl.value?.focus()
}
async function hide() {
  open.value = false
  if (!pageLoad()) writeStore(SEEN + props.storageKey, '1')
  pointing.value = false
  await nextTick()
  // Back to whichever button the reader can see: the map's own control when it is on screen, else ours.
  const back = props.trigger === 'control' && controlShown.value && control.value ? control.value : btnEl.value
  back?.focus()
}

// ── control mode ─────────────────────────────────────────────────────────────────────────────────
// ★ FAIL-OPEN: THERE IS ALWAYS EXACTLY ONE ⓘ. The map's control (MapInfoButton) announces itself and asks
// for the popup with composed events that bubble out of the plugin's shadow root to the pane this
// component sits in. Our own button is hidden ONLY while that control is MEASURED to be usable:
// connected, a non-zero rect on screen, and in no inert subtree (the composite marks its inactive pane
// inert, and an inert pane keeps its rects). It is re-measured by IntersectionObserver and ResizeObserver
// on the control, and by a slow fallback timer. It is NEVER inferred from an unmount event: a detached
// element cannot bubble anything to the pane. So on the UPG-100 wall (no map on screen), on a tab being
// switched away and back, or with the column hidden, our button is the one that shows.
const rootEl = ref(null)
const control = ref(null)
const controlShown = ref(false)
let pane = null, io = null, ro = null, timer = null
function inert(el) {
  for (let n = el; n; n = n.parentNode || n.host) {
    if (n.nodeType === 1 && (n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true')) return true
  }
  return false
}
// ★ NO FLASH WHILE THE MAP LOADS. Until a control has announced itself, our button waits: the map draws
// its column only once it is ready, so showing ours first put the floating ⓘ on screen for a moment and
// then swapped it for the control. The wait is BOUNDED and counts only while our pane is on screen (a
// tab that mounts hidden, or waits in an inert pane, keeps its full grace for when it is opened): if no
// control arrives within CONTROL_GRACE_MS of visible time, our button shows (fail-open). Once a control
// has announced itself, the measurement below decides alone, so a hidden column still gives our button.
// A map that knows its control is on its way says so ('dxmaps:mapinfo-pending', { pending: true }), and
// then the clock is only a BACKSTOP (CONTROL_BACKSTOP_MS, for a failure nobody reported); a map that
// reports its failure ({ pending: false }) ends the wait at once.
const CONTROL_GRACE_MS = 30000
const CONTROL_BACKSTOP_MS = 90000
let controlPending = false
const awaitingControl = ref(props.trigger === 'control')
let graceFrom = 0
function paneVisible() {
  const p = rootEl.value && rootEl.value.parentElement
  const r = p && p.getBoundingClientRect()
  return !!p && !inert(p) && r.width > 0 && r.height > 0
}
function tickGrace() {
  if (!awaitingControl.value) return
  if (!paneVisible()) { graceFrom = 0; return }
  if (!graceFrom) graceFrom = Date.now()
  else if (Date.now() - graceFrom >= (controlPending ? CONTROL_BACKSTOP_MS : CONTROL_GRACE_MS)) awaitingControl.value = false
}
function measureControl() {
  tickGrace()
  // Leaving the tab ends a page-load pointer that has already been on screen (see the page-load pointer).
  if (pageLoad() && pointing.value && pointerDoneThisLoad.has(props.storageKey) && !paneVisible()) pointing.value = false
  const c = control.value
  let shown = false
  if (c && c.isConnected && !inert(c)) {
    const r = c.getBoundingClientRect()
    shown = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
    if (shown) {
      const n = placeBeside(r), o = ctlAt.value
      if (n) n.strip = inStrip(c)
      if (!n || !o || n.side !== o.side || n.top !== o.top || n.left !== o.left || n.right !== o.right || n.strip !== o.strip) ctlAt.value = n
    }
  }
  controlShown.value = shown
}
// ★ THE POINTER FOLLOWS THE CONTROL, WHEREVER THE MAP PUT IT. The floating pointer is anchored to our
// own button by CSS; the control lives in the map's shadow root, so its place is MEASURED, against the
// box our absolutely-placed pointer is laid out in (our offsetParent, the pane, which scrolls: hence
// scrollTop). It goes on the control's physical inner side: a right-to-left map mirrors its column to
// the left edge, and that is read from where the control IS, never assumed from the page's direction.
const GAP = 10
// A control in a tab's HEADER (MapControlButton's rounded-square form, the header-bar button) sits in the
// tab's top strip, where the 1200px rule below measured the pointer covering the view switcher, so its
// pointer takes that rule again (mi-ctl-strip). A control in a map's own column keeps its pointer at every width.
const inStrip = (el) => el.classList.contains('mcb--rounded-square')
function placeBeside(r) {
  const cb = rootEl.value && rootEl.value.offsetParent
  if (!cb) return null
  const b = cb.getBoundingClientRect()
  const x0 = b.left + cb.clientLeft, y0 = b.top + cb.clientTop
  const top = Math.round(r.top - y0 + cb.scrollTop + r.height / 2)
  return (r.left + r.width / 2) > (x0 + cb.clientWidth / 2)
    ? { side: 'right', top, right: Math.round(x0 + cb.clientWidth - r.left + GAP) }
    : { side: 'left', top, left: Math.round(r.right - x0 + GAP) }
}
const ctlAt = ref(null)
const ctlStyle = () => {
  const p = ctlAt.value
  return p.side === 'right' ? { top: p.top + 'px', right: p.right + 'px' } : { top: p.top + 'px', left: p.left + 'px' }
}
const onResize = () => measureControl()
function adopt(el) {
  if (!el || el === control.value) { measureControl(); return }
  try { io?.disconnect(); ro?.disconnect() } catch { /* already gone */ }
  control.value = el
  awaitingControl.value = false
  try { io = new IntersectionObserver(measureControl); io.observe(el) } catch { io = null }
  try { ro = new ResizeObserver(measureControl); ro.observe(el) } catch { ro = null }
  el.setAttribute('aria-expanded', String(open.value))
  measureControl()
}
// Only events that travelled through OUR pane; they stop here, so an outer host never sees them twice.
const ours = (e) => !!pane && typeof e.composedPath === 'function' && e.composedPath().includes(pane)
function onControl(e) {
  if (!ours(e)) return
  e.stopPropagation()
  if (e.detail) e.detail.ack = true
  adopt(e.detail && e.detail.el)
}
function onPending(e) {
  if (!ours(e)) return
  e.stopPropagation()
  controlPending = !!(e.detail && e.detail.pending)
  if (!controlPending && !control.value) awaitingControl.value = false
}
function onOpenRequest(e) {
  if (!ours(e)) return
  e.stopPropagation()
  adopt(e.detail && e.detail.el)
  if (!open.value) show()
}
onMounted(() => {
  if (props.trigger !== 'control') return
  pane = rootEl.value && rootEl.value.parentElement
  if (!pane) return
  pane.addEventListener('dxmaps:mapinfo-control', onControl)
  pane.addEventListener('dxmaps:mapinfo-open', onOpenRequest)
  pane.addEventListener('dxmaps:mapinfo-pending', onPending)
  timer = window.setInterval(measureControl, 1500)
  window.addEventListener('resize', onResize)
  // A control that mounted before we did asked into the void; tell it to ask again.
  try { window.dispatchEvent(new CustomEvent('dxmaps:mapinfo-host', { detail: { local: props.popupOnly } })) } catch { /* no CustomEvent */ }
})
onBeforeUnmount(() => {
  if (pane) {
    pane.removeEventListener('dxmaps:mapinfo-control', onControl)
    pane.removeEventListener('dxmaps:mapinfo-open', onOpenRequest)
    pane.removeEventListener('dxmaps:mapinfo-pending', onPending)
  }
  try { io?.disconnect(); ro?.disconnect() } catch { /* already gone */ }
  if (timer) window.clearInterval(timer)
  window.removeEventListener('resize', onResize)
})
watch(open, (v) => { control.value?.setAttribute('aria-expanded', String(v)) })

// ★ A MAP PANEL OPENING ENDS THE POINTER (MapControlMenu's composed 'dxmaps:panel-open': Share, and every menu built
// on it). The pointer may be drawn over the map from outside its shadow root, where no z-index of the panel's can
// beat it, and on a phone it covered the Share panel's ✕. Heard on our container, so only THIS map's panels count;
// a MapInfo at the top of a shadow tree has no parentElement, so there it is heard on that shadow root.
// A page-load pointer is then done for this load, as if its popup had been opened.
let panelPane = null
function onPanelOpen() {
  if (!pointing.value) return
  pointing.value = false
  if (pageLoad()) pointerDoneThisLoad.add(props.storageKey)
}
onMounted(() => {
  panelPane = rootEl.value && (rootEl.value.parentElement || rootEl.value.getRootNode())
  if (panelPane) panelPane.addEventListener('dxmaps:panel-open', onPanelOpen)
})
onBeforeUnmount(() => { if (panelPane) panelPane.removeEventListener('dxmaps:panel-open', onPanelOpen); panelPane = null })
const floatingShown = () => !props.popupOnly && (props.trigger !== 'control' || (!awaitingControl.value && !controlShown.value))
// The pointer beside the control has been on screen: this page load has pointed once, so a remount (the
// gallery rebuilds a heavy tab on every switch back) does not point again. Marked on SCREEN, not on mount:
// a tab's MapInfo can mount inside a hidden pane.
watch(() => pageLoad() && pointing.value && !open.value && !floatingShown() && !!ctlAt.value,
  (on) => { if (on) pointerDoneThisLoad.add(props.storageKey) }, { immediate: true })
// ★ aria-modal PROMISES THE READER THAT TAB STAYS INSIDE, so keep it there: Tab from the last control
// wraps to the first, Shift+Tab from the first to the last. The active element is read from the shadow
// root (document.activeElement would be the host element). Hidden controls are skipped.
const dialogEl = ref(null)
function trapTab(e) {
  const box = dialogEl.value
  if (!box) return
  const items = [...box.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null)
  if (!items.length) return
  const active = box.getRootNode().activeElement
  const first = items[0], last = items[items.length - 1]
  if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus() }
}
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); hide() }
  else if (e.key === 'Tab') trapTab(e)
}
function toggle(i) { expanded[i] = !expanded[i] }
// ★ A MISSING EXAMPLE IMAGE DISAPPEARS, QUIETLY. The examples are pre-generated files that ship in the
// tree; if one is absent (a shoot not yet landed, a tree copied without it) the reader must see neither
// a broken-image icon nor an empty frame. An artefact whose lead image fails is dropped whole, title
// and all (failed[i]); a single page or card that fails later just hides itself. The text above the
// examples still reads on its own.
function dropImg(e) { const el = e && e.target; if (el) el.style.display = 'none' }

// ── examples ─────────────────────────────────────────────────────────────────────────────────────
function url(src) {
  const s = String(src || '')
  if (!s || /^(?:[a-z]+:|\/)/i.test(s) || !props.assetsBase) return s
  return props.assetsBase.replace(/\/+$/, '') + '/' + s.replace(/^\.?\//, '')
}
const DEFAULT_TITLE = { image: 'mapInfo.poster', pages: 'mapInfo.packet', deck: 'mapInfo.cards', table: 'mapInfo.spreadsheet' }
function titleOf(ex) { return t(ex.titleKey || DEFAULT_TITLE[ex.kind] || 'mapInfo.example') }
const deckTop = (ex) => (ex.cards || []).slice(0, 5)
const colLabel = (c) => (c && typeof c === 'object' ? (c.key ? t(c.key) : String(c.label || '')) : String(c ?? ''))

useShadowStyles(`
  .mi-btn{ position:absolute; z-index:20; top:var(--map-info-top, 12px); width:40px; height:40px;
    border-radius:50%; border:1px solid rgba(0,0,0,.18); background:#fff; color:#1f2a44; cursor:pointer;
    display:inline-flex; align-items:center; justify-content:center; padding:0;
    box-shadow:0 2px 8px rgba(0,0,0,.18); font:inherit; }
  .mi-btn:hover{ background:#f3f5fa; }
  .mi-btn:focus-visible{ outline:3px solid #2563eb; outline-offset:2px; }
  .mi-btn svg{ width:22px; height:22px; }
  /* LOGICAL SIDES, so an RTL page mirrors: "right" is the END of the line, which in Arabic is the LEFT.
     With a physical right:12px the button and pointer covered the first (active) tab of an Arabic tab
     bar, which starts at the right. */
  .mi-at-right{ inset-inline-end:var(--map-info-side, 12px); }
  .mi-at-left{ inset-inline-start:var(--map-info-side, 12px); }
  .mi-pointer{ position:absolute; z-index:20; top:calc(var(--map-info-top, 12px) + 4px);
    display:flex; align-items:center; gap:6px; pointer-events:none; white-space:nowrap;
    background:#1f2a44; color:#fff; font-size:13px; font-weight:600; line-height:1; padding:8px 12px;
    border-radius:999px; box-shadow:0 2px 10px rgba(0,0,0,.25); animation:mi-nudge 1.4s ease-in-out infinite; }
  .mi-pointer.mi-at-right{ inset-inline-end:calc(var(--map-info-side, 12px) + 50px); }
  .mi-pointer.mi-at-left{ inset-inline-start:calc(var(--map-info-side, 12px) + 50px); flex-direction:row-reverse;
    animation-name:mi-nudge-left; }
  /* The flex order mirrors by itself under dir=rtl; the arrow glyph and the nudge do not, so flip both
     so the pointer still points and moves TOWARD the button. */
  .mi[dir="rtl"] .mi-pointer svg{ transform:scaleX(-1); }
  .mi[dir="rtl"] .mi-pointer.mi-at-right{ animation-name:mi-nudge-left; }
  .mi[dir="rtl"] .mi-pointer.mi-at-left{ animation-name:mi-nudge; }
  .mi-pointer svg{ width:16px; height:16px; flex:none; }
  @keyframes mi-nudge{ 0%,100%{ transform:translateX(0) } 50%{ transform:translateX(6px) } }
  @keyframes mi-nudge-left{ 0%,100%{ transform:translateX(0) } 50%{ transform:translateX(-6px) } }
  /* Control mode: top/left/right come from placeBeside (inline), centred on the control by translate,
     which composes with the nudge's transform. Laid out left-to-right on purpose: the arrow's side is the
     control's PHYSICAL side, measured, so the page direction must not flip the row, the glyph or the
     nudge (the span keeps the text's own direction). (0,3,0) so the 1200px rule below does not hide it:
     that rule measured the floating pointer crossing each tab's top strip, and this one is placed and
     measured beside one map's own control instead. A HEADER control is in that strip, so the rule
     hides its pointer again at (0,4,0) (mi-ctl-strip). */
  .mi .mi-pointer.mi-ctl{ display:flex; direction:ltr; translate:0 -50%; }
  .mi .mi-pointer.mi-ctl-left{ flex-direction:row-reverse; animation-name:mi-nudge-left; }
  .mi .mi-pointer.mi-ctl-right{ animation-name:mi-nudge; }
  .mi[dir="rtl"] .mi-pointer.mi-ctl svg{ transform:none; }

  /* z-index above every map's own top layer: PinHint's first-visit pill sits at 2147482000, so at 1000 it
     floated bright and clickable over the dimmed backdrop (gospel). The dialog is a child of this fixed,
     z-indexed scrim, so it paints inside the scrim's stacking context, on top of it. The root fix is the
     top layer (<dialog>.showModal()); until then this is the highest layer the page uses. */
  .mi-scrim{ position:fixed; inset:0; z-index:2147483000; background:rgba(15,20,35,.55);
    display:flex; align-items:center; justify-content:center; padding:24px; }
  .mi-dialog{ background:#fff; color:#1b1f2a; width:min(720px, 100%); max-height:min(88vh, 100%);
    border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35); display:flex; flex-direction:column;
    overflow:hidden; font-size:15px; line-height:1.5; }
  .mi-head{ display:flex; align-items:flex-start; gap:12px; padding:18px 20px 12px; border-bottom:1px solid #e6e8ee; }
  .mi-title{ margin:0; font-size:19px; line-height:1.3; flex:1; }
  .mi-close{ flex:none; width:40px; height:40px; border-radius:50%; border:none; background:#eef1f6;
    color:#1b1f2a; cursor:pointer; font-size:22px; line-height:1; }
  .mi-close:focus-visible, .mi-toggle:focus-visible, .mi-hit:focus-visible, .mi-full:focus-visible{
    outline:3px solid #2563eb; outline-offset:2px; }
  .mi-body{ overflow-y:auto; padding:16px 20px 20px; -webkit-overflow-scrolling:touch; }
  /* The short description is the first thing the eye should find: the Rudder blue (#38bdf8) as the ACCENT
     (a left bar on a pale band of the same hue), and the text in a darker shade of that hue (#0369a1), since
     the accent itself is only ~2.1:1 on white and would be hard to read as text. */
  .mi-bluf{ margin:0 0 12px; padding:10px 12px; background:#f0f9ff; border-inline-start:4px solid #38bdf8; border-radius:6px; }
  .mi-bluf-h{ margin:0 0 4px; font-size:13px; font-weight:700; color:#0c4a6e; }
  .mi-lead{ margin:0; font-size:16px; font-weight:500; color:#0369a1; }
  .mi-takeaway{ margin:0 0 14px; color:#3b4256; }
  .mi-takeaway b{ color:#1b1f2a; }
  .mi-ex{ margin:18px 0 0; }
  .mi-strategy{ margin:14px 0 0; border:1px solid #e6e8ee; border-radius:10px; }
  .mi-strategy-sum{ display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:44px;
    padding:0 14px; cursor:pointer; font-weight:700; color:#1b1f2a; list-style:none; }
  .mi-strategy-sum::-webkit-details-marker{ display:none; }
  .mi-strategy-sum:focus-visible{ outline:3px solid #2563eb; outline-offset:2px; border-radius:10px; }
  .mi-chev{ transition:transform .15s; }
  .mi-strategy[open] .mi-chev{ transform:rotate(180deg); }
  .mi-strategy > .mi-bottom, .mi-strategy > .mi-points{ margin-inline:14px; }
  .mi-strategy > :last-child{ margin-bottom:14px; }
  .mi-bottom{ margin:0 0 8px; font-weight:600; color:#1b1f2a; }
  .mi-points{ margin:0; padding-inline-start:20px; }
  .mi-points li{ margin:0 0 6px; }
  .mi-ex h3{ margin:0 0 8px; font-size:15px; text-transform:uppercase; letter-spacing:.04em; color:#556; }
  .mi-img{ display:block; width:100%; height:auto; border-radius:8px; background:#f4f5f8;
    box-shadow:0 1px 4px rgba(0,0,0,.15); }
  .mi-poster{ max-width:480px; margin:0 auto; }
  .mi-full{ display:inline-block; margin-top:6px; font-size:14px; color:#1d4ed8; }
  .mi-hit{ display:block; width:100%; padding:0; border:none; background:none; cursor:zoom-in; text-align:inherit; }
  .mi-hit.mi-open{ cursor:zoom-out; }
  .mi-page{ max-width:420px; margin:0 auto; }
  .mi-pages .mi-page + .mi-page{ margin-top:12px; }
  /* isolation: the shadow card behind the first page sits at z-index:-1, which without its own stacking
     context is painted UNDER the dialog's white background, i.e. never seen. */
  .mi-stack{ position:relative; isolation:isolate; }
  .mi-stack::after{ content:''; position:absolute; inset:6px -6px -6px 6px; z-index:-1; border-radius:8px;
    background:#e3e6ee; box-shadow:0 1px 4px rgba(0,0,0,.15); }
  .mi-toggle{ display:inline-flex; align-items:center; min-height:44px; margin-top:10px; padding:0 16px;
    border-radius:999px; border:1px solid #c9cedb; background:#fff; color:#1b1f2a; font:inherit;
    font-size:14px; font-weight:600; cursor:pointer; }
  .mi-toggle:hover{ background:#f3f5fa; }
  .mi-center{ text-align:center; }
  .mi-deck{ position:relative; height:250px; max-width:340px; margin:0 auto; }
  .mi-deck .mi-card{ position:absolute; top:10px; width:160px; height:224px; object-fit:cover;
    border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.25); background:#f4f5f8; }
  .mi-grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px; }
  .mi-grid .mi-img{ aspect-ratio:5 / 7; object-fit:cover; }
  .mi-table-wrap{ overflow-x:auto; border:1px solid #e1e4ec; border-radius:8px; }
  .mi-table{ border-collapse:collapse; width:100%; font-size:13px; }
  .mi-table th, .mi-table td{ padding:6px 10px; border-bottom:1px solid #eceef3; text-align:start; white-space:nowrap; }
  .mi-table th{ background:#f5f6f9; font-weight:600; }
  .mi-more{ margin:6px 0 0; font-size:13px; color:#556; }
  .mi-note{ margin:18px 0 0; padding:10px 12px; border-radius:8px; background:#fff7e6; color:#5a4300; font-size:14px; }
  .mi-foot{ padding:12px 20px; border-top:1px solid #e6e8ee; font-size:14px; }
  .mi-foot label{ display:inline-flex; align-items:center; gap:8px; min-height:44px; cursor:pointer; }
  .mi-foot input{ width:20px; height:20px; }

  /* A phone gets the whole screen: a floating card with margins leaves too little room for a page. */
  /* ★ THE ONE-TIME NUDGE IS DESKTOP-ONLY, AND THE THRESHOLD IS MEASURED, NOT CHOSEN. The pointer
     is anchored beside the button and extends ~213px INWARD, straight across whatever the tab puts
     in its top strip. Measured on Deep Research, on the shared browser, worst overlap per width:
         390   Regions "Region Dashboards" 1416px^2   UPG-100 1428px^2
         768   Cities legend 6560   Gospel legend 6560 + input 6240   Regions selector 4200
         900   Cities legend 2432   Gospel legend 2496 + input 2176   Regions selector 3696
        1024   Cities CLEAN         Gospel CLEAN                      Regions selector 2100
        1200   CLEAN                CLEAN                             CLEAN
        1280   CLEAN                CLEAN                             CLEAN
     UPG-100 measures the same shape independently: 768 over "Prayer Resources" AND "Map", 1024 over
     "Map", clear at 1200/1280/1440 -- in en AND ar.
     So it is not a phone problem, which is how it was first reported and first fixed: it persists
     to 1024 and only clears near 1200. A max-width:600px rule would have left 768, 900 and 1024
     broken on four tabs -- found because gospel counted PANELS (.gm-legend/.gm-sheet) as well as
     controls, which a control-only probe misses entirely.
     ARABIC IS MEASURED, not argued: via DX Life's /ar/ route (dir=rtl confirmed), the pointer is
     hidden and clean at 390, 768 and 1024, and at 1440 it mirrors to the start side (x=104) and is
     clean there too.
     THE RULE IS ITS OWN BLOCK, deliberately: the 600px block below also full-screens the dialog,
     and this has nothing to do with the phone sheet. The .98 covers fractional viewport widths
     under browser zoom.
     Hiding it below the measured clear width is the only rule that holds everywhere: the button it
     points at is untouched, so nothing becomes unreachable, and a hint that covers a map's own
     legend, search box or view switcher is worse than no hint.
     Two other shapes were measured and both were worse: stacking it below the button traded one
     collision for five (Gospel's "Resources found" 2010px^2, plus the zoom +/- of three tabs), and
     hiding only its text still left 675px^2 on "Region Dashboards" and 900px^2 on Gospel's input.
     ⚠ NOT A PLACEMENT CHANGE. The per-tab pos.narrow values in the shell's tabInfo are measured per
     tab (the buttons sit at x=8, 12, 294 and 346 across the seven tabs at 390); an inset-inline-*
     pinned here would win by specificity and silently flatten all of them. The button is
     placement's business; this rule is only about the hint. */
  @media (max-width:1199.98px){
    .mi-pointer{ display:none; }
    .mi .mi-pointer.mi-ctl.mi-ctl-strip{ display:none; }
  }

  /* A phone gets a BOTTOM SHEET, not a full screen. A full-screen dialog showed a few lines of text at the
     top of an empty white page, and read as a new page rather than a panel over the map. The sheet sizes to
     its content up to 70% of the SMALL viewport (svh: a collapsing URL bar must not resize it), scrolls
     inside with its scroll kept to itself, keeps a 44px close button in view, and leaves the dimmed map
     above it, where a tap closes it (the scrim's @click.self), like Escape does. */
  @media (max-width:767.98px){
    .mi-scrim{ padding:0; align-items:flex-end; }
    .mi-dialog{ width:100%; max-height:70vh; max-height:70svh; border-radius:16px 16px 0 0; }
    .mi-head{ align-items:center; padding:10px 10px 10px 20px; padding-inline:20px 10px; }
    .mi-close{ width:44px; height:44px; }
    .mi-body{ overscroll-behavior:contain; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0px)); }
  }
  @media (max-width:600px){
    .mi-pointer{ font-size:12px; padding:7px 10px; }
    .mi-deck{ height:220px; }
    .mi-deck .mi-card{ width:136px; height:190px; }
  }
  /* This component animates (the pointer's nudge), so it carries its own reduced-motion rule where its
     styles are injected: a page-level rule cannot reach into a shadow root. */
  @media (prefers-reduced-motion: reduce){
    .mi-pointer, .mi .mi-pointer.mi-ctl{ animation:none; }
    .mi-chev{ transition:none; }
  }
`, 'map-info')
</script>

<template>
  <div ref="rootEl" class="mi" :dir="isRtl() ? 'rtl' : 'ltr'" :lang="lang()">
    <button v-show="floatingShown()" ref="btnEl" type="button" class="mi-btn" :class="placement === 'top-left' ? 'mi-at-left' : 'mi-at-right'"
      :aria-label="t('mapInfo.open')" :title="t('mapInfo.open')" aria-haspopup="dialog" :aria-expanded="String(open)"
      @click="show">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="12" cy="17" r="1.3" fill="currentColor" />
      </svg>
    </button>

    <div v-if="pointing && !open && floatingShown()" class="mi-pointer" :class="placement === 'top-left' ? 'mi-at-left' : 'mi-at-right'" aria-hidden="true">
      <span>{{ t('mapInfo.pointer') }}</span>
      <svg viewBox="0 0 16 16" focusable="false">
        <path v-if="placement === 'top-left'" d="M14 8H3M7 3.5 2.5 8 7 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path v-else d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    <!-- Control mode: the same pointer, beside the map's own control (placed by measurement, placeBeside). -->
    <div v-if="pointing && !open && !floatingShown() && ctlAt" class="mi-pointer mi-ctl" :class="['mi-ctl-' + ctlAt.side, { 'mi-ctl-strip': ctlAt.strip }]" :style="ctlStyle()" aria-hidden="true">
      <span :dir="isRtl() ? 'rtl' : 'ltr'">{{ t('mapInfo.pointer') }}</span>
      <svg viewBox="0 0 16 16" focusable="false">
        <path v-if="ctlAt.side === 'left'" d="M14 8H3M7 3.5 2.5 8 7 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path v-else d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <div v-if="open" class="mi-scrim" @click.self="hide" @keydown="onKey">
      <div ref="dialogEl" class="mi-dialog" role="dialog" aria-modal="true" :aria-labelledby="'mi-title-' + storageKey">
        <div class="mi-head">
          <h2 :id="'mi-title-' + storageKey" class="mi-title">{{ t('mapInfo.title') }}</h2>
          <button ref="closeEl" type="button" class="mi-close" :aria-label="t('mapInfo.close')" @click="hide">×</button>
        </div>

        <div class="mi-body">
          <!-- BOTTOM LINE FIRST: the map's short description, marked, in blue, so the eye lands there. -->
          <section v-if="leadKey || lead" class="mi-bluf" :aria-labelledby="'mi-bluf-' + storageKey">
            <h3 :id="'mi-bluf-' + storageKey" class="mi-bluf-h">{{ t('mapInfo.shortDescription') }}</h3>
            <p class="mi-lead">{{ text(leadKey, lead) }}</p>
          </section>
          <p v-if="(takeawayKey || takeaway) && !hasStrategy()" class="mi-takeaway"><b>{{ t('mapInfo.takeaway') }}</b> {{ text(takeawayKey, takeaway) }}</p>

          <!-- The strategy, collapsed until asked for (a native disclosure: keyboard and screen readers for free).
               Keyed by the open count, so every open starts collapsed. -->
          <details v-if="hasStrategy()" :key="'st-' + opens" class="mi-strategy">
            <summary class="mi-strategy-sum"><span>{{ t('mapInfo.tabStrategy') }}</span><span class="mi-chev" aria-hidden="true">▾</span></summary>
            <p class="mi-bottom">{{ strategyBottom() }}</p>
            <ul v-if="strategyPoints().length" class="mi-points">
              <li v-for="(p, k) in strategyPoints()" :key="k">{{ p }}</li>
            </ul>
          </details>

          <section v-for="(ex, i) in examples" v-show="!failed[i]" :key="i" class="mi-ex">
            <h3>{{ titleOf(ex) }}</h3>

            <template v-if="ex.kind === 'image'">
              <img class="mi-img mi-poster" :src="url(ex.src)" :alt="ex.alt || titleOf(ex)" decoding="async" @error="failed[i] = true" />
              <div v-if="ex.full" class="mi-center">
                <a class="mi-full" :href="url(ex.full)" target="_blank" rel="noopener">{{ t('mapInfo.openFull') }}</a>
              </div>
            </template>

            <template v-else-if="ex.kind === 'pages' && (ex.pages || []).length">
              <template v-if="!expanded[i]">
                <button type="button" class="mi-hit mi-page" :class="{ 'mi-stack': ex.pages.length > 1 }"
                  :aria-label="t('mapInfo.expandPages', { n: num(ex.pages.length) })" aria-expanded="false" @click="toggle(i)">
                  <img class="mi-img" :src="url(ex.pages[0])" :alt="titleOf(ex)" decoding="async" @error="failed[i] = true" />
                </button>
                <div v-if="ex.pages.length > 1" class="mi-center">
                  <button type="button" class="mi-toggle" aria-expanded="false" @click="toggle(i)">{{ t('mapInfo.expandPages', { n: num(ex.pages.length) }) }}</button>
                </div>
              </template>
              <template v-else>
                <div class="mi-center"><button type="button" class="mi-toggle" aria-expanded="true" @click="toggle(i)">{{ t('mapInfo.collapsePages') }}</button></div>
                <div class="mi-pages">
                  <button v-for="(p, k) in ex.pages" :key="k" type="button" class="mi-hit mi-open mi-page"
                    :aria-label="t('mapInfo.collapsePages')" @click="toggle(i)">
                    <img class="mi-img" :src="url(p)" :alt="titleOf(ex) + ' ' + num(k + 1)" loading="lazy" decoding="async" @error="dropImg" />
                  </button>
                </div>
                <div class="mi-center"><button type="button" class="mi-toggle" aria-expanded="true" @click="toggle(i)">{{ t('mapInfo.collapsePages') }}</button></div>
              </template>
            </template>

            <template v-else-if="ex.kind === 'deck' && (ex.cards || []).length">
              <template v-if="!expanded[i]">
                <button type="button" class="mi-hit mi-deck" :aria-label="t('mapInfo.expandDeck', { n: num(ex.cards.length) })"
                  aria-expanded="false" @click="toggle(i)">
                  <img v-for="(c, k) in deckTop(ex)" :key="k" class="mi-card" :src="url(c)" alt="" decoding="async" @error="k === 0 ? (failed[i] = true) : dropImg($event)"
                    :style="{ insetInlineStart: (k * 36) + 'px', transform: 'rotate(' + ((k - 2) * 4) + 'deg)', zIndex: 10 - k }" />
                </button>
                <div class="mi-center">
                  <button type="button" class="mi-toggle" aria-expanded="false" @click="toggle(i)">{{ t('mapInfo.expandDeck', { n: num(ex.cards.length) }) }}</button>
                </div>
              </template>
              <template v-else>
                <div class="mi-center"><button type="button" class="mi-toggle" aria-expanded="true" @click="toggle(i)">{{ t('mapInfo.collapseDeck') }}</button></div>
                <div class="mi-grid">
                  <img v-for="(c, k) in ex.cards" :key="k" class="mi-img" :src="url(c)" :alt="titleOf(ex) + ' ' + num(k + 1)" loading="lazy" decoding="async" @error="dropImg" />
                </div>
                <div class="mi-center"><button type="button" class="mi-toggle" aria-expanded="true" @click="toggle(i)">{{ t('mapInfo.collapseDeck') }}</button></div>
              </template>
            </template>

            <template v-else-if="ex.kind === 'table' && (ex.columns || []).length">
              <div class="mi-table-wrap">
                <table class="mi-table">
                  <thead><tr><th v-for="(c, k) in ex.columns" :key="k" scope="col">{{ colLabel(c) }}</th></tr></thead>
                  <tbody><tr v-for="(r, k) in ex.rows || []" :key="k"><td v-for="(v, j) in r" :key="j">{{ typeof v === 'number' ? num(v) : v }}</td></tr></tbody>
                </table>
              </div>
              <p v-if="ex.total && ex.total > (ex.rows || []).length" class="mi-more">
                {{ t('mapInfo.moreRows', { n: num(ex.total - (ex.rows || []).length) }) }}
              </p>
            </template>
          </section>

          <p v-if="noteKey || note" class="mi-note">{{ text(noteKey, note) }}</p>
        </div>

        <div v-if="!pageLoad()" class="mi-foot">
          <label>
            <input type="checkbox" :checked="pointerOff" @change="setPointerOff($event.target.checked)" />
            <span>{{ t('mapInfo.pointerOff') }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
