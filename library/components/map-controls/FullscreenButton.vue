<!--
  FullscreenButton.vue — Toggles fullscreen for the map host element.

  Two strategies depending on platform capability:

    1. Standard Fullscreen API (desktop + Android Chrome + iPadOS w/ trackpad)
       — calls requestFullscreen / webkitRequestFullscreen on the custom-element
       host. Listens to fullscreenchange to stay in sync with Esc.

    2. CSS pseudo-fullscreen fallback (iOS Safari / iPhone)
       — iOS Safari does NOT implement requestFullscreen on arbitrary
       elements (only on <video>). Attempting it silently fails. We instead
       apply position:fixed inset:0 z-index:2147483647 to the custom-element
       host so the map fills the viewport. Tap again to release.

  Listens to the native `fullscreenchange` event to keep `isFullscreen` in sync
  when the user presses Escape to exit (standard-API path only).

  Props:
    mapContainer — ref to the map canvas div (used to walk up to shadow host)
    isDark       — theme flag forwarded from parent

  Emits:
    change(isFullscreen: Boolean) — fires whenever fullscreen state changes
-->
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'

const { t } = useI18n()

const props = defineProps({
  mapContainer: { type: Object,  default: null },  // template ref (el)
  isDark:       { type: Boolean, default: false }
})

const emit = defineEmits(['change'])

const isFullscreen = ref(false)

// Track the shadow root we attached the change listener to (if any) so we
// can remove the listener from the same target on unmount.
let shadowRootRef = null

// Saved inline-style snapshot for the pseudo-fullscreen path so we can
// restore the host element exactly to its pre-toggle state.
let pseudoSavedCssText = null
let pseudoHostEl = null
// Saved body / documentElement inline values so we can restore them
// exactly on exit (avoids stomping app-level inline styles). The page
// host may have its own scroller (Nuxt commonly wraps content in a div
// with its own overflow), so locking just `body.overflow` is not enough
// — we also hard-lock html.overflow, body.position:fixed (with
// preserved scroll offset), body.touchAction, and attach a passive:false
// touchmove blocker on document while pseudo-fullscreen is active.
let pseudoSavedBodyOverflow = null
let pseudoSavedHtmlOverflow = null
let pseudoSavedBodyPosition = null
let pseudoSavedBodyTop = null
let pseudoSavedBodyLeft = null
let pseudoSavedBodyWidth = null
let pseudoSavedBodyTouchAction = null
let pseudoSavedHtmlTouchAction = null
let pseudoSavedScrollY = 0
let pseudoSavedScrollX = 0
let pseudoTouchmoveBlocker = null
let pseudoWheelBlocker = null

// Platform detection ──────────────────────────────────────────────────────
// iOS Safari (iPhone + non-iPadOS-13+ iPad) cannot fullscreen arbitrary
// elements. iPadOS 13+ reports as Mac, but Safari there still rejects
// requestFullscreen() on non-<video> elements until the user is in Stage
// Manager / external display. Feature-detecting `document.fullscreenEnabled`
// catches the common case; the UA regex covers iPhones where the property
// exists as `webkitFullscreenEnabled` but only honors <video>.
function isStandardFullscreenSupported() {
  if (typeof document === 'undefined') return false
  // Some iPad UAs claim Mac but still lack working element-fullscreen.
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  const isiOS = /iPad|iPhone|iPod/.test(ua)
    || (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document)
  if (isiOS) return false
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
}

function resolveHost() {
  return props.mapContainer?.getRootNode?.()?.host ?? null
}

// Cross-browser fullscreen helpers ────────────────────────────────────────
function currentFullscreenElement() {
  const sr = props.mapContainer?.getRootNode?.()
  return (
    document.fullscreenElement
    || document.webkitFullscreenElement
    || (sr && sr instanceof ShadowRoot ? sr.fullscreenElement : null)
    || null
  )
}

function requestFs(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  if (!fn) return Promise.reject(new Error('Fullscreen API unavailable'))
  const result = fn.call(el)
  // webkitRequestFullscreen historically returned `undefined`, not a promise.
  return result && typeof result.then === 'function' ? result : Promise.resolve()
}

function exitFs() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen
  if (!fn) return Promise.reject(new Error('Fullscreen API unavailable'))
  const result = fn.call(document)
  return result && typeof result.then === 'function' ? result : Promise.resolve()
}

// Pseudo-fullscreen (CSS-only) helpers ────────────────────────────────────
// Used when the native API is unavailable (notably iOS Safari).
function enterPseudoFullscreen() {
  const host = resolveHost()
  if (!host) return false
  pseudoHostEl = host
  pseudoSavedCssText = host.style.cssText
  host.style.position = 'fixed'
  host.style.top = '0'
  host.style.left = '0'
  host.style.right = '0'
  host.style.bottom = '0'
  host.style.width = '100vw'
  // Set 100vh first as a fallback, then 100dvh; browsers that don't
  // understand dvh ignore the second declaration and keep 100vh. dvh
  // accounts for the iOS Safari URL bar collapsing/expanding so the host
  // fills the dynamic viewport exactly.
  host.style.height = '100vh'
  host.style.height = '100dvh'
  host.style.zIndex = '2147483647'
  host.style.margin = '0'
  // Override any inherited rounded corners so the overlay fills the
  // viewport edge-to-edge — otherwise the underlying page bleeds through
  // at the corners.
  host.style.borderRadius = '0'
  // Let the map's own gestures (pan, pinch-zoom) flow into the canvas
  // unchanged; anything outside the canvas — i.e. padding zones around
  // the rendered map — must NOT trigger page scroll. The document-level
  // touch-action lock below handles the outside-canvas case.
  host.style.touchAction = 'pan-x pan-y pinch-zoom'

  // Lock page scroll while pseudo-fullscreen is active. The embedding
  // page may have its own nested scroll containers (Nuxt wraps content
  // in a div with overflow:auto, host pages often have a sticky header
  // viewport, etc.), so `body.overflow:hidden` alone is not enough.
  // Combine: html+body overflow:hidden, body position:fixed (iOS
  // bullet-proof scroll lock — preserves scroll offset), body
  // touch-action:none (kills scroll-gesture interpretation at the
  // root), plus a passive:false touchmove listener that
  // preventDefault()s any touch outside the map host. wheel events
  // outside the host are blocked the same way for desktop.
  if (typeof document !== 'undefined') {
    pseudoSavedScrollY = window.scrollY || window.pageYOffset || 0
    pseudoSavedScrollX = window.scrollX || window.pageXOffset || 0
    const body = document.body
    const html = document.documentElement
    pseudoSavedBodyOverflow = body ? body.style.overflow : null
    pseudoSavedHtmlOverflow = html ? html.style.overflow : null
    pseudoSavedBodyPosition = body ? body.style.position : null
    pseudoSavedBodyTop = body ? body.style.top : null
    pseudoSavedBodyLeft = body ? body.style.left : null
    pseudoSavedBodyWidth = body ? body.style.width : null
    pseudoSavedBodyTouchAction = body ? body.style.touchAction : null
    pseudoSavedHtmlTouchAction = html ? html.style.touchAction : null

    if (html) {
      html.style.overflow = 'hidden'
      html.style.touchAction = 'none'
    }
    if (body) {
      body.style.overflow = 'hidden'
      // position:fixed with negative top is the iOS-friendly scroll lock
      // — keeps the viewport pinned without losing the underlying
      // scroll position. We restore both on exit.
      body.style.position = 'fixed'
      body.style.top = `-${pseudoSavedScrollY}px`
      body.style.left = `-${pseudoSavedScrollX}px`
      body.style.width = '100%'
      body.style.touchAction = 'none'
    }

    // Document-level touchmove / wheel blocker. Anything OUTSIDE the
    // shadow host (padding zones, scrollbars, gutters next to a
    // narrower map canvas) calls preventDefault. Inside the host, the
    // map's own gesture handlers stay intact because we never call
    // preventDefault on those events. passive:false is required for
    // preventDefault to actually cancel scroll on mobile.
    pseudoTouchmoveBlocker = (ev) => {
      if (!pseudoHostEl) return
      const target = ev.target
      // If the touch target is inside the host (the map embed) let it
      // through; otherwise kill the scroll gesture entirely.
      if (target && (target === pseudoHostEl || (pseudoHostEl.contains && pseudoHostEl.contains(target)))) {
        return
      }
      if (ev.cancelable) ev.preventDefault()
    }
    pseudoWheelBlocker = (ev) => {
      if (!pseudoHostEl) return
      const target = ev.target
      if (target && (target === pseudoHostEl || (pseudoHostEl.contains && pseudoHostEl.contains(target)))) {
        return
      }
      if (ev.cancelable) ev.preventDefault()
    }
    document.addEventListener('touchmove', pseudoTouchmoveBlocker, { passive: false, capture: true })
    document.addEventListener('wheel', pseudoWheelBlocker, { passive: false, capture: true })
  }
  return true
}

function exitPseudoFullscreen() {
  if (!pseudoHostEl) return
  // Restore exactly — using cssText preserves any inline styles the page
  // applied before we touched the element.
  pseudoHostEl.style.cssText = pseudoSavedCssText || ''
  pseudoHostEl = null
  pseudoSavedCssText = null

  // Restore page scroll. Empty string is the correct way to clear an
  // inline style; we fall back to '' if we somehow never captured a
  // value. Order matters here: clear the body position-lock styles
  // FIRST, then call window.scrollTo so the page returns to where the
  // user was before entering pseudo-fullscreen.
  if (typeof document !== 'undefined') {
    const body = document.body
    const html = document.documentElement
    if (body) {
      body.style.overflow = pseudoSavedBodyOverflow ?? ''
      body.style.position = pseudoSavedBodyPosition ?? ''
      body.style.top = pseudoSavedBodyTop ?? ''
      body.style.left = pseudoSavedBodyLeft ?? ''
      body.style.width = pseudoSavedBodyWidth ?? ''
      body.style.touchAction = pseudoSavedBodyTouchAction ?? ''
    }
    if (html) {
      html.style.overflow = pseudoSavedHtmlOverflow ?? ''
      html.style.touchAction = pseudoSavedHtmlTouchAction ?? ''
    }

    // Detach the document-level scroll/touch blockers.
    if (pseudoTouchmoveBlocker) {
      document.removeEventListener('touchmove', pseudoTouchmoveBlocker, { capture: true })
      pseudoTouchmoveBlocker = null
    }
    if (pseudoWheelBlocker) {
      document.removeEventListener('wheel', pseudoWheelBlocker, { capture: true })
      pseudoWheelBlocker = null
    }

    // Restore the scroll offset captured before we pinned the body.
    if (typeof window !== 'undefined' && (pseudoSavedScrollY || pseudoSavedScrollX)) {
      window.scrollTo(pseudoSavedScrollX, pseudoSavedScrollY)
    }
  }
  pseudoSavedBodyOverflow = null
  pseudoSavedHtmlOverflow = null
  pseudoSavedBodyPosition = null
  pseudoSavedBodyTop = null
  pseudoSavedBodyLeft = null
  pseudoSavedBodyWidth = null
  pseudoSavedBodyTouchAction = null
  pseudoSavedHtmlTouchAction = null
  pseudoSavedScrollY = 0
  pseudoSavedScrollX = 0
}

function notifyMapResize() {
  // Give the browser one frame to apply layout, then nudge mapbox to
  // recompute its canvas size. Reading off the host element avoids any
  // direct coupling to the map instance.
  if (typeof window === 'undefined') return
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

function toggle() {
  if (!isStandardFullscreenSupported()) {
    // Pseudo-fullscreen path
    if (isFullscreen.value) {
      exitPseudoFullscreen()
      isFullscreen.value = false
      emit('change', false)
    } else {
      if (enterPseudoFullscreen()) {
        isFullscreen.value = true
        emit('change', true)
      }
    }
    notifyMapResize()
    return
  }

  // Always re-read the live state — the cached `isFullscreen` ref can
  // fall out of sync if the user pressed Esc and the change event fired
  // on a target we weren't listening to (e.g. shadow root vs document).
  const active = currentFullscreenElement()
  if (!active) {
    const host = resolveHost() ?? document.documentElement
    requestFs(host)
      .then(() => { isFullscreen.value = true; emit('change', true) })
      .catch(() => {
        // Last-resort fallback: fullscreen the document element.
        requestFs(document.documentElement)
          .then(() => { isFullscreen.value = true; emit('change', true) })
          .catch(() => { /* user denied or API unavailable — leave state as-is */ })
      })
  } else {
    exitFs()
      .then(() => { isFullscreen.value = false; emit('change', false) })
      .catch(() => { /* exit failed — onFsChange will reconcile if state actually changed */ })
  }
}

function onFsChange() {
  isFullscreen.value = !!currentFullscreenElement()
  emit('change', isFullscreen.value)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  // Shadow roots get their own fullscreenchange events that don't bubble
  // up to `document`. Without this, exiting via Esc inside the shadow
  // tree leaves our local ref stuck at `true` and the next tap of the
  // button tries to re-enter rather than exit.
  const sr = props.mapContainer?.getRootNode?.()
  if (sr instanceof ShadowRoot) {
    shadowRootRef = sr
    sr.addEventListener('fullscreenchange', onFsChange)
    sr.addEventListener('webkitfullscreenchange', onFsChange)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
  if (shadowRootRef) {
    shadowRootRef.removeEventListener('fullscreenchange', onFsChange)
    shadowRootRef.removeEventListener('webkitfullscreenchange', onFsChange)
    shadowRootRef = null
  }
  // If the component is torn down while in pseudo-fullscreen, release
  // the host element so it doesn't stay fixed to the viewport.
  if (pseudoHostEl) exitPseudoFullscreen()
})
</script>

<template>
  <MapControlButton data-control="fullscreen" :is-dark="isDark" :active="isFullscreen" :title="t('buttons.toggleFullscreen')" @click="toggle">
    <!-- Native Mapbox FullscreenControl icons (bolder / clearer than the old ones).
         enter-fullscreen when not fullscreen; shrink when fullscreen. viewBox 0 0 29 29. -->
    <svg v-if="!isFullscreen" xmlns="http://www.w3.org/2000/svg"
         width="20" height="20" viewBox="0 0 29 29" fill="currentColor">
      <path d="M24 16v5.5c0 1.75-.75 2.5-2.5 2.5H16v-1l3-1.5-4-5.5 1-1 5.5 4 1.5-3h1zM6 16l1.5 3 5.5-4 1 1-4 5.5 3 1.5v1H7.5C5.75 24 5 23.25 5 21.5V16h1zm7-11v1l-3 1.5 4 5.5-1 1-5.5-4L6 13H5V7.5C5 5.75 5.75 5 7.5 5H13zm11 2.5c0-1.75-.75-2.5-2.5-2.5H16v1l3 1.5-4 5.5 1 1 5.5-4 1.5 3h1V7.5z"/>
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg"
         width="20" height="20" viewBox="0 0 29 29" fill="currentColor">
      <path d="M18.5 16c-1.75 0-2.5.75-2.5 2.5V24h1l1.5-3 5.5 4 1-1-4-5.5 3-1.5v-1h-5.5zM13 18.5c0-1.75-.75-2.5-2.5-2.5H5v1l3 1.5L4 24l1 1 5.5-4 1.5 3h1v-5.5zm3-8c0 1.75.75 2.5 2.5 2.5H24v-1l-3-1.5L25 5l-1-1-5.5 4L17 5h-1v5.5zM10.5 13c1.75 0 2.5-.75 2.5-2.5V5h-1l-1.5 3L5 4 4 5l4 5.5L5 12v1h5.5z"/>
    </svg>
  </MapControlButton>
</template>
