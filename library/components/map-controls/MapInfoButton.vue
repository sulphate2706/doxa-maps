<!--
  MapInfoButton.vue — the map's "what can this map do for you?" control, IN the map's control column.

  It opens the host's MapInfo popup and owns no popup of its own. The host (the gallery) mounts one
  MapInfo per tab over the tab's pane, with trigger="control"; this button reaches it with a bubbling,
  COMPOSED event, so the plugin's shadow root is no wall. The popup, its examples and its focus handling
  stay in one place (library/components/info/MapInfo.vue).

  ★ IT SHOWS ONLY WHEN A HOST ANSWERS. A control that opens nothing is worse than no control: a
  standalone leaf or a partner page has no MapInfo. So on mount the control ASKS ('dxmaps:mapinfo-control',
  detail.ack = false), and a MapInfo in control mode on the SAME pane sets ack = true while the event is
  being dispatched (dispatch is synchronous, so the answer is there when dispatchEvent returns). No answer:
  nothing renders (not even a hidden button), and it asks again when a host announces itself later
  ('dxmaps:mapinfo-host' on window, for a MapInfo that mounted after the map). Use it inside a MapToolbar.

  ★ HIDING IS NOT THE HOST'S SIGNAL. The host decides whether its floating ⓘ is needed by MEASURING this
  button (connected, a non-zero on-screen rect, not inert), never by an unmount event: a detached element
  cannot bubble anything to the pane. See MapInfo's control mode.

  ★ A QUESTION MARK, NOT AN (i). The map's attribution control is a round (i) too, and two identical
  glyphs on one map read as the same thing. The same glyph is MapInfo's floating fallback button.

  Props:
    isDark — theme flag forwarded from parent
-->
<script setup>
import { ref, inject, nextTick, getCurrentInstance, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'

const { t } = useI18n()

const props = defineProps({
  isDark: { type: Boolean, default: false },
  // The map carries its own info, so the control may stand ALONE: when no host answers (an embed on a
  // partner page, a standalone preset page), it asks its map to mount a popup of its own (the
  // 'standalone' event) instead of rendering nothing. Never inside the gallery: there the gallery alone
  // decides, its own info:false included. Off by default, so every other consumer is unchanged.
  standalone: { type: Boolean, default: false },
  // 'round' (default) is the map-control form. 'rounded-square' is the dashboard HEADER form (the ⓘ
  // sits in a header bar beside Share, not in a map's control column) — forwarded to MapControlButton.
  shape: { type: String, default: 'round' },
})

// ★ AN UNANSWERED CONTROL ADDS NO CHILD TO THE COLUMN. The button renders only once a host has answered
// (v-if, not v-show): a display:none child is still a child, so it would take the square toolbar's
// :last-child corners (MapToolbar's controls="square") from the last button a reader can see. So the
// QUESTION is asked from the toolbar's own element (provided by MapToolbar as mapToolbar.el), or from this
// component's placeholder's parent, and once answered the rendered button announces ITSELF, so the host
// measures and focuses the real element.
const emit = defineEmits(['standalone'])
const toolbar = inject('mapToolbar', null)
const self = getCurrentInstance()
const hosted = ref(false)
const btn = ref(null)
const node = () => (btn.value && btn.value.$el) || null
const origin = () => node() || (toolbar && toolbar.el && toolbar.el.value) || (self && self.proxy && self.proxy.$el && self.proxy.$el.parentNode) || null
function announce(from, el) {
  const detail = { el, ack: false }
  try { from.dispatchEvent(new CustomEvent('dxmaps:mapinfo-control', { bubbles: true, composed: true, detail })) } catch { /* no CustomEvent */ }
  return detail.ack === true
}
// Inside the gallery (its panes carry data-doxa-gallery), across shadow roots.
function inGallery(el) {
  for (let n = el; n; n = n.parentNode || n.host) if (n.nodeType === 1 && n.hasAttribute('data-doxa-gallery')) return true
  return false
}
// The map's own popup is up: it answers from the map, so this control is hosted by it.
let local = false
function ask() {
  const from = origin()
  if (!from) return
  const was = hosted.value
  hosted.value = announce(from, node())
  if (hosted.value && !was) nextTick(() => { const el = node(); if (el) announce(el, el) })
  // Nobody answered and the map carries its info: ask the map for its own popup. When it mounts, it
  // announces itself ('dxmaps:mapinfo-host', detail.local), and the question above is asked again.
  if (!hosted.value && props.standalone && !local && !inGallery(from)) { local = true; emit('standalone', true) }
}
// A host appeared. The map's own popup asks us again; any OTHER host (the gallery's) takes over, so the
// map's popup is dropped first: it sits inside the map and would answer before the gallery could.
function onHost(e) {
  if (local && !(e && e.detail && e.detail.local)) {
    local = false; hosted.value = false; emit('standalone', false); nextTick(ask); return
  }
  ask()
}
function openInfo() {
  const el = node()
  if (!el) return
  try { el.dispatchEvent(new CustomEvent('dxmaps:mapinfo-open', { bubbles: true, composed: true, detail: { el } })) } catch { /* no CustomEvent */ }
}
onMounted(() => {
  nextTick(ask)
  window.addEventListener('dxmaps:mapinfo-host', onHost)
})
onBeforeUnmount(() => {
  window.removeEventListener('dxmaps:mapinfo-host', onHost)
  if (local) emit('standalone', false)
})
</script>

<template>
  <MapControlButton v-if="hosted" ref="btn" data-control="map-info" :is-dark="isDark" :shape="shape" :title="t('mapInfo.open')"
    aria-haspopup="dialog" aria-expanded="false" @click="openInfo">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="12" cy="17" r="1.3" fill="currentColor" />
    </svg>
  </MapControlButton>
</template>
