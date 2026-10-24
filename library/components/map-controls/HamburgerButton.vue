<!--
  HamburgerButton.vue — Toggle button for the side menu drawer.

  Rendered as a Mapbox custom control added to 'top-left', so it floats
  naturally to the RIGHT of the geocoder search bar using Mapbox's own
  float:left layout — no absolute positioning or CSS offset hacks needed.

  Props:
    map    — live mapboxgl.Map instance (required once map is ready)
    isOpen — reflects the current drawer state; animates the lines to an X
    isDark — mirrors the app theme

  Emits:
    toggle — fired on click; parent owns the open/close state
-->
<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

useShadowStyles(`
/* ── Mapbox ctrl wrapper — zero margin so button sits flush next to geocoder ── */
.hbg-ctrl { margin: 10px 0 0 6px !important; line-height: 0; }

/* ── Button ── */
.hbg-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.10);
  transition: background 0.2s, box-shadow 0.2s, transform 0.1s;
  padding: 0;
  outline: none;
}
.hbg-btn:hover { background: #f0f0f0; }
.hbg-btn:active { transform: scale(0.93); }

/* Dark mode */
.hbg-btn.dark {
  background: #3b463d;
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
.hbg-btn.dark:hover { background: #4e594f; }

/* The three lines */
.hbg-line {
  width: 16px;
  height: 2px;
  border-radius: 1px;
  background: #333;
  transition: transform 0.25s ease, opacity 0.25s ease, width 0.25s ease;
  transform-origin: center;
  pointer-events: none;
}
.hbg-btn.dark .hbg-line { background: rgba(255,255,255,0.85); }

/* Animate to X when open */
.hbg-btn.open .hbg-line:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hbg-btn.open .hbg-line:nth-child(2) { opacity: 0; width: 0; }
.hbg-btn.open .hbg-line:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

@media (max-width: 767px) {
  .hbg-ctrl { margin: 7px 0 0 5px !important; }
  .hbg-btn { width: 36px; height: 36px; gap: 4px; }
  .hbg-line { width: 14px; }
}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .hb-btn, .hb-bar { transition: none !important; animation: none !important; }
}
`, 'hamburger-button')

const props = defineProps({
  map:    { type: Object,  default: null },
  isOpen: { type: Boolean, default: false },
  isDark: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle'])

// Imperative DOM refs — lives inside the Mapbox control container (shadow DOM)
let _container = null
let _btn       = null
let _control   = null

function _updateBtn() {
  if (!_btn) return
  const classes = ['hbg-btn']
  if (props.isOpen) classes.push('open')
  if (props.isDark) classes.push('dark')
  _btn.className = classes.join(' ')
  _btn.title = props.isOpen ? 'Close menu' : 'Open menu'
}

onMounted(() => {
  if (!props.map) return

  // Outer wrapper needs mapboxgl-ctrl so Mapbox applies float:left + margin
  _container = document.createElement('div')
  _container.className = 'mapboxgl-ctrl hbg-ctrl'

  _btn = document.createElement('button')
  _btn.type = 'button'
  _btn.innerHTML =
    '<span class="hbg-line"></span>' +
    '<span class="hbg-line"></span>' +
    '<span class="hbg-line"></span>'
  _btn.addEventListener('click', () => emit('toggle'))
  _container.appendChild(_btn)

  _updateBtn()

  _control = {
    onAdd:    () => _container,
    onRemove: () => { try { _container.remove() } catch {} }
  }

  props.map.addControl(_control, 'top-left')
})

onBeforeUnmount(() => {
  try {
    if (props.map && _control) props.map.removeControl(_control)
  } catch {}
})

watch(() => props.isOpen, _updateBtn)
watch(() => props.isDark, _updateBtn)
</script>

<!-- Renderless — all DOM is created imperatively inside the Mapbox control -->
<template></template>
