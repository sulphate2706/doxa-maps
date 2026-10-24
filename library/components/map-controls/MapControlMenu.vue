<!--
  MapControlMenu.vue — the ONE menu every map control opens.

  A control (share, export, …) only toggles `open`; this component owns where the menu
  lives and how it behaves, on phones and desktop alike:

    • It renders INSIDE the map area (teleported out of the toolbar into the same shadow
      root), so it never escapes the map's walls, never uses position:fixed, and scrolls
      with the map when the host page scrolls.
    • Its top edge is the toolbar's top edge. By default it is as tall as its content needs
      (bounded only by the map's bottom edge — no scrolling); `maxHeight` caps it lower and
      `matchToolbar` limits it to the toolbar column's height (content then scrolls).
    • It opens on the toolbar's inner side: to the LEFT of right-hand controls, to the
      RIGHT of left-hand controls. The side is measured, so a right-to-left page that
      mirrors the toolbar mirrors the menu as well.
    • Width: as wide as fits between the toolbar and the opposite edge, capped at `width`.
    • A STANDALONE anchor (ShareButton in a page header, no map toolbar: `standalone` on the
      provided anchor) opens BELOW its button instead, toward the side with room, inside the
      VIEWPORT, at `width` (the maps' readable 340) or the viewport minus its edges, whichever is
      less. Where it lives and where it goes are resolved when it OPENS, and its coordinates are
      converted into the block that really contains it (see placeBeside).
    • One z tier for menus (--z-menu, default 3000); only one menu is open per map at a
      time; closes on Escape or on a tap on the bare map canvas (never on legend/search).

  Props: open (Boolean), title (String), isDark (Boolean),
         width     (Number, 340)  — preferred width; shrinks to what fits (mobile friendly)
         maxHeight    (Number|null) — cap the height (null = fit the content within the map)
         height       (Number|null) — a fixed height instead of fitting the content
         matchToolbar (Boolean)     — limit the height to the toolbar column (content scrolls)
  Emits: close
  Slot:  the menu content (tabs, buttons, text) — chrome (header, close) is provided here.
-->
<script setup>
import { ref, inject, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '../../composables/useShadowStyles.js'

useShadowStyles(`
.mcm{position:absolute;z-index:var(--z-menu,3000);display:flex;flex-direction:column;box-sizing:border-box;
  background:#161b22;border:1px solid #30363d;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.45);
  color:#e6edf3;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;
  overflow:hidden;opacity:0;transform:translateY(-4px) scale(0.98);animation:mcm-in 0.18s ease-out forwards;}
@keyframes mcm-in{to{opacity:1;transform:translateY(0) scale(1);}}
.mcm.light{background:#ffffff;border-color:#d8dee4;box-shadow:0 6px 24px rgba(0,0,0,0.16);color:#1f2328;}
.mcm-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;min-height:32px;flex:0 0 auto;border-bottom:1px solid #21262d;}
.mcm.light .mcm-header{border-bottom-color:#d8dee4;}
.mcm-title{font:600 10px ui-monospace,monospace;color:#73A17F;text-transform:uppercase;letter-spacing:0.07em;}
.mcm.light .mcm-title{color:#3b463d;}
.mcm-close{width:22px;height:20px;border:1px solid #30363d;background:rgba(110,118,129,0.12);border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#8b949e;padding:0;transition:color 0.1s,background 0.1s,border-color 0.1s;}
.mcm-close:hover{color:#c9d1d9;background:rgba(59,70,61,0.18);border-color:#73A17F;}
.mcm.light .mcm-close{background:rgba(208,215,222,0.4);border-color:#d0d7de;color:#57606a;}
.mcm.light .mcm-close:hover{color:#3b463d;background:rgba(59,70,61,0.12);border-color:#3b463d;}
.mcm-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .mcm-menu, .mcm-item { transition: none !important; animation: none !important; }
}
`, 'map-control-menu')

const props = defineProps({
  open:   { type: Boolean, default: false },
  title:  { type: String,  default: '' },
  width:  { type: Number,  default: 340 },
  isDark: { type: Boolean, default: false },
  maxHeight: { type: Number, default: null },
  height:    { type: Number, default: null },
  matchToolbar: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

// The toolbar this menu belongs to (MapToolbar provides its element); the map area is the
// nearest positioned map container above it — where the menu is teleported to.
const toolbar = inject('mapToolbar', null)
const host = ref(null)
const el = ref(null)
const style = ref({})

// ★ AN ALLOWLIST OF THREE PLUGIN CLASS NAMES DECIDED WHETHER THIS MENU HAD AN ANCHOR AT ALL, and a
// plugin not on the list got no placement rather than a worse one. `.dsm-map-area` is doxa-simple-map,
// `.rm-map-area` is research-map, `.dm-map-area` is demo-map -- so Prayer Progress and Simple Research
// placed correctly and everyone else fell through to `|| null`, which place() answers with an EMPTY
// STYLE, which leaves `.mcm{position:absolute}` at its STATIC position: below-and-right of a button
// already at the top right. Off the page.
// That is the identical failure the 2026-09-22 dashboard fix describes below, returning through a
// different door: not "a wrong side was chosen" but "nothing chose anything".
// MEASURED 2026-09-28: cities-internet, gospel-resources, key-cities and upg-neighbor carry NO map-area
// class and no data-map-area, so all four were unanchored. Two of them were reported; the list is
// what made it four.
const AREA = '.dsm-map-area, .rm-map-area, .dm-map-area, [data-map-area]'

function place() {
  const tb = toolbar?.el?.value, area = host.value
  if (!tb || !area) { style.value = {}; return }
  if (toolbar.standalone) return placeBeside(tb)
  const ar = area.getBoundingClientRect(), tr = tb.getBoundingClientRect()
  const onRight = (tr.left + tr.right) / 2 > (ar.left + ar.right) / 2
  const gap = 8, edge = 12
  const offset = onRight ? (ar.right - tr.left + gap) : (tr.right - ar.left + gap)
  const width = Math.max(200, Math.min(props.width, ar.width - offset - edge))
  const top = Math.max(0, tr.top - ar.top)
  // A menu never outgrows the MAP's walls. (A header button is not placed here: placeBeside bounds it by the
  // viewport, so it opens at natural height; measured on upg-100-mfe, a header band as the wall gave a 291px
  // menu a 69px scrolling body, BUG-SHARE-MENU-HAS-A-SCROLLBAR-SHOULD-BE-FULLY-EXPANDED.)
  let maxHeight = Math.max(120, ar.height - top - edge)
  if (props.matchToolbar) maxHeight = Math.max(120, Math.min(maxHeight, tr.height))
  if (props.maxHeight) maxHeight = Math.min(maxHeight, props.maxHeight)
  style.value = {
    top: `${Math.round(top)}px`,
    [onRight ? 'right' : 'left']: `${Math.round(offset)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
    ...(props.height ? { height: `${Math.round(Math.min(props.height, maxHeight))}px` } : {}),
  }
}

// ★ BESIDE ITS BUTTON, INSIDE THE VIEWPORT (a standalone anchor: a Share button in a page header). Below the
// button, toward the side with room (a button right of centre opens leftward, its end edges aligned; RTL headers
// mirror with no special case, because the side is measured), at the readable width the maps use, clamped inside
// the viewport, as tall as its content up to the viewport's bottom edge.
// ★ THE BLOCK THAT CONTAINS IT IS MEASURED, NOT ASSUMED. The menu is position:absolute, so its coordinates are
// relative to its containing block, which the HOST's markup decides: an unpositioned wrapper hands it to the
// header above. Measuring against one element and positioning against another is what sent the header menu far
// to the left (the UPG-100 list page, 2026-10-03). So the target point is computed in viewport coordinates and converted into
// the containing block's own (its padding edge, scrolled), whatever element that turns out to be.
function placeBeside(tb) {
  const vw = document.documentElement.clientWidth || window.innerWidth || 1024
  const vh = window.innerHeight || 800
  const r = tb.getBoundingClientRect(), gap = 8, edge = 12
  const width = Math.min(props.width, Math.max(160, vw - 2 * edge))
  const onRight = (r.left + r.right) / 2 > vw / 2
  const x = Math.max(edge, Math.min(onRight ? r.right - width : r.left, vw - edge - width))
  const y = r.bottom + gap
  let maxHeight = Math.max(120, vh - y - edge)
  if (props.maxHeight) maxHeight = Math.min(maxHeight, props.maxHeight)
  const o = blockOrigin(el.value)
  style.value = {
    top: `${Math.round(y - o.y)}px`,
    left: `${Math.round(x - o.x)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
    ...(props.height ? { height: `${Math.round(Math.min(props.height, maxHeight))}px` } : {}),
  }
}
// The viewport position of the origin an absolutely positioned element is placed from: its offsetParent's padding
// edge, scrolled. A static body (or none) means the initial containing block: the document origin.
function blockOrigin(m) {
  const cb = m && m.offsetParent
  if (!cb || ((cb === document.body || cb === document.documentElement) && getComputedStyle(cb).position === 'static')) {
    return { x: -(window.scrollX || 0), y: -(window.scrollY || 0) }
  }
  const b = cb.getBoundingClientRect()
  return { x: b.left + cb.clientLeft - cb.scrollLeft, y: b.top + cb.clientTop - cb.scrollTop }
}

// Only one menu open per map: opening this one closes any other.
const OPEN_EVENT = 'doxa-map-menu-open'
function onOtherOpened(e) { if (props.open && e.detail !== el.value) emit('close') }

// ★ AN OPEN PANEL ENDS THE ONBOARDING POINTER. MapInfo's "What can this map do?" pointer can be drawn by the HOST
// (the gallery), outside this map's shadow root, so no z-index in here can lift a panel above it, and on a phone
// it sat over the Share panel's ✕ (measured 2026-10-02, cities-with-internet). So every panel says it opened, as
// a composed event that leaves the shadow root, and MapInfo puts its pointer away (library/components/info/MapInfo.vue).
const PANEL_OPEN_EVENT = 'dxmaps:panel-open'
// ...and its twin when it closes (✕, an outside tap, Esc, or unmounted while open), so a HOST can hide its own chrome
// while a panel is up: DX Life's top scroll strip sat over the Share panel's ✕.
const PANEL_CLOSE_EVENT = 'dxmaps:panel-close'
const announceClose = () => { try { host.value?.dispatchEvent(new CustomEvent(PANEL_CLOSE_EVENT, { bubbles: true, composed: true })) } catch (_) {} }

watch(() => props.open, async (open, was) => {
  if (!open) { if (was) announceClose(); return }
  if (toolbar?.standalone) host.value = resolveHost()   // layout is known now: where the menu lives
  await nextTick()
  place()
  try { host.value?.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: el.value })) } catch (_) {}
  try { host.value?.dispatchEvent(new CustomEvent(PANEL_OPEN_EVENT, { bubbles: true, composed: true })) } catch (_) {}
})

function onResize() { if (props.open) place() }
function onKeyDown(e) { if (e.key === 'Escape' && props.open) emit('close') }
// Close only on the bare map canvas — never while the user works the legend, search or toolbar.
function onClickOutside(e) {
  if (!props.open) return
  const path = e.composedPath ? e.composedPath() : [e.target]
  if (el.value && path.includes(el.value)) return
  if (toolbar?.el?.value && path.includes(toolbar.el.value)) return
  if (path.some(n => n?.classList?.contains?.('mapboxgl-canvas') || n?.classList?.contains?.('maplibregl-canvas'))) emit('close')
}

// Where the menu lives (the Teleport target). A map control: the map area, else the toolbar's offset parent. A
// standalone button: a named area if its host declares one, else its offset parent, kept in the button's own
// (shadow) root so the menu keeps this root's styles; else the root's top element.
function resolveHost() {
  const tbEl = toolbar?.el?.value || null
  if (!tbEl) return null
  if (!toolbar.standalone) return tbEl.closest(AREA) || tbEl.offsetParent || tbEl.parentElement || null
  const root = tbEl.getRootNode(), mine = (n) => n && n.getRootNode() === root ? n : null
  let top = tbEl; while (top.parentElement) top = top.parentElement
  return mine(tbEl.closest(AREA)) || mine(tbEl.offsetParent) || (root === document ? document.body : top)
}
// The "one menu at a time" listener follows the host, which a standalone button re-resolves on every open.
watch(host, (h, was) => { was?.removeEventListener(OPEN_EVENT, onOtherOpened); h?.addEventListener(OPEN_EVENT, onOtherOpened) })

onMounted(() => {
  // ★ NEVER null. A named area is still preferred -- it is the MAP's walls, and a menu must not outgrow
  // them -- but when a plugin has not tagged one, the toolbar's own offsetParent is the containing block
  // this menu is absolutely positioned against, so placing against it is geometrically correct by
  // definition rather than by convention. A plugin that adopts a class or data-map-area later simply
  // gets the better anchor; nothing has to be registered anywhere for the menu to be on screen.
  host.value = resolveHost()
  window.addEventListener('resize', onResize)
  document.addEventListener('click', onClickOutside, true)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  if (props.open) announceClose()
  host.value?.removeEventListener(OPEN_EVENT, onOtherOpened)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onClickOutside, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport :to="host" :disabled="!host">
    <div v-if="open" ref="el" class="mcm" :class="{ light: !isDark }" :style="style" role="dialog" :aria-label="title">
      <div class="mcm-header">
        <span class="mcm-title">{{ title }}</span>
        <button class="mcm-close" type="button" :aria-label="T('buttons.close', 'Close')" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
          </svg>
        </button>
      </div>
      <div class="mcm-body"><slot /></div>
    </div>
  </Teleport>
</template>
