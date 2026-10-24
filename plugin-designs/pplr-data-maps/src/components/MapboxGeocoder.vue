<script setup>
/**
 * MapboxGeocoder.vue — wraps mapbox-gl-geocoder npm plugin (loaded via CDN).
 *
 * DOXA's pattern, ported here: a geocoder mapped directly to the language-family
 * legend, as comparable tools offer. Replaces the bespoke PplrGeocoder.vue dropdown with
 * Mapbox's vetted UI/UX (keyboard nav, debouncing, ARIA, mobile-friendly)
 * while keeping local-data search via the localGeocoder callback.
 *
 * Search results funnel into either:
 *   - emit('select', node)  — when the user picks a local item from props.localIndex
 *   - emit('place', place)  — when the user picks a Mapbox geographic place
 *
 * Both events forward to the parent profile, which already wires `select`
 * into instance.selection (legend highlight + map filter via setFilter) and
 * `place` into a flyTo / fitBounds.
 *
 * The `/` keyboard shortcut from the original PplrGeocoder is preserved.
 */
import { ref, watch, onMounted, onBeforeUnmount, computed, inject } from 'vue'
import { ensureGeocoder, GEOCODER } from '../utils/pplrData.js'
import { escHtml } from '../utils/pplrMap.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { ensureEngineScript, engineGlobal } from '@map/composables/useMapInstance.js'
import { useInstance } from '@map/composables/usePplrInstance.js'

const props = defineProps({
  /** Pre-flattened searchable items: [{id, label, kind, depth, filter, color?, count?, pop?, ...}] */
  localIndex:  { type: Array,  default: () => [] },
  /** Placeholder text — parameterized per map */
  placeholder: { type: String, default: 'Search…' },
  /** Mapbox access token (required for the geographic Places search) */
  mapboxToken: { type: String, default: '' },
  /** Min query length before search fires */
  minChars:    { type: Number, default: 2 },
  /** Kind labels for hint text — { family: 'Lang Family', bloc: 'Affinity Bloc', ... } */
  kindLabels:  { type: Object, default: () => ({}) },
  /** Max local results in the dropdown */
  localMax:    { type: Number, default: 8 },
})

const emit = defineEmits(['select', 'place'])

const instance = useInstance()
const wrapEl = ref(null)
const slotEl = ref(null)

let geocoder = null
// Same engine the map uses. Under maplibre (the keyless gallery) search runs on MaplibreGeocoder
// over this map's own local index only, so it makes no Mapbox request at all.
const provider = resolveMapProvider(inject('profileConfig', null))
const isMaplibre = provider === 'maplibre'

// Build the localGeocoder callback. Mapbox-gl-geocoder calls this on every
// keystroke; we return Carmen-GeoJSON-shaped features for matching local
// items. The `__pplr_local` property carries the original node so onResult
// can route it back to emit('select').
function buildLocalGeocoder() {
  return (q) => {
    if (!q || q.length < props.minChars) return []
    const ql = q.toLowerCase()
    const out = []
    for (const item of props.localIndex) {
      const label = (item.label || '').toLowerCase()
      if (!label.includes(ql)) continue
      out.push({
        type: 'Feature',
        // Carmen-GeoJSON shape required by mapbox-gl-geocoder
        place_name: item.label,
        place_type: ['poi'],
        text: item.label,
        properties: {
          // Carry a hint of what KIND of result this is (shows in dropdown)
          __pplr_kind: props.kindLabels[item.kind] || item.kind || '',
          __pplr_local: item,
        },
        // Geometry is required by Carmen-GeoJSON schema. Use a sentinel
        // [0,0] centroid; the parent ignores geometry for local results.
        geometry: { type: 'Point', coordinates: [0, 0] },
        center: [0, 0],
      })
      if (out.length >= props.localMax) break
    }
    // Sort priority: BROADER scope first (lower depth = bigger bucket), then
    // prefix matches, then population/count desc. Found in QA:
    // searching "Arabic" was selecting the narrow "Arabic" language node
    // (depth 1) instead of the family "Arab (Arabic)" (depth 0) — only some
    // Arabic pins showed. Depth-first means picking the top result now
    // filters the broadest reasonable bucket (whole family).
    out.sort((a, b) => {
      const ai = a.properties.__pplr_local
      const bi = b.properties.__pplr_local
      const ad = ai?.depth ?? 99
      const bd = bi?.depth ?? 99
      if (ad !== bd) return ad - bd
      const ap = a.place_name.toLowerCase().startsWith(ql) ? 0 : 1
      const bp = b.place_name.toLowerCase().startsWith(ql) ? 0 : 1
      if (ap !== bp) return ap - bp
      return ((bi?.pop || 0) - (ai?.pop || 0)) || ((bi?.count || 0) - (ai?.count || 0))
    })
    return out
  }
}

// Custom suggestion renderer — shows the local kind chip beside each row
function renderSuggestion(item) {
  const kind = item?.properties?.__pplr_kind || ''
  const local = item?.properties?.__pplr_local
  const dotColor = local?.color || ''
  const dot = dotColor
    ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${escHtml(dotColor)};margin-right:8px;vertical-align:middle"></span>`
    : ''
  const tag = kind
    ? `<span style="font:600 9px ui-monospace,monospace;color:#73A17F;text-transform:uppercase;letter-spacing:0.06em;margin-left:auto">${escHtml(kind)}</span>`
    : ''
  return `<div class="mapboxgl-ctrl-geocoder--suggestion-title" style="display:flex;align-items:center;gap:4px;width:100%">
    ${dot}<span style="flex:1">${escHtml(item.place_name)}</span>${tag}
  </div>`
}

// mapbox-gl-geocoder CSS lives in the regular document's <head> via index.html.
// Shadow DOM is sealed from regular-document styles, so we must inject the same
// stylesheet into each shadow root that hosts a geocoder. Idempotent — checks
// if already present.
const GEOCODER_CSS_URL = (GEOCODER[provider] || GEOCODER.mapbox).css
function ensureGeocoderCss(root) {
  if (!root || root === document) return
  if (root.querySelector('link[data-pplr-geocoder-css]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = GEOCODER_CSS_URL
  link.setAttribute('data-pplr-geocoder-css', '1')
  root.prepend(link)
}

function setup() {
  // Wrap entire setup in try/catch — a geocoder failure must NEVER bubble
  // out of onMounted, since Vue's "Unhandled error during execution of
  // mounted hook" cascades and can prevent sibling components (the map!)
  // from mounting. Without the guard the map went completely blank when
  // the geocoder threw on shadow-DOM addTo().
  try {
    if (isMaplibre) {
      if (!window.MaplibreGeocoder || !window.maplibregl) {
        console.warn('[MapboxGeocoder] maplibre-gl-geocoder or maplibre-gl not on window — search disabled')
        return
      }
      // Local-only: the PG/family index this map already holds. No place search, no key.
      geocoder = new window.MaplibreGeocoder({ forwardGeocode: async () => ({ type: 'FeatureCollection', features: [] }) }, {
        maplibregl: window.maplibregl,
        placeholder: props.placeholder,
        localGeocoder: buildLocalGeocoder(),
        localGeocoderOnly: true,
        minLength: props.minChars,
        showResultsWhileTyping: true,
        render: renderSuggestion,
      })
    } else {
    if (!window.MapboxGeocoder || !engineGlobal('mapbox')) {
      console.warn('[MapboxGeocoder] mapbox-gl-geocoder or mapbox-gl not on window — check CDN <script> tags')
      return
    }
    if (!props.mapboxToken) {
      console.warn('[MapboxGeocoder] mapboxToken prop is empty — geographic Places search disabled')
    }
    geocoder = new window.MapboxGeocoder({
      accessToken: props.mapboxToken,
      mapboxgl: engineGlobal('mapbox'),
      placeholder: props.placeholder,
      localGeocoder: buildLocalGeocoder(),
      localGeocoderOnly: false,
      minLength: props.minChars,
      types: 'country,region,district,place',
      limit: 5,
      render: renderSuggestion,
    })
    }

    geocoder.on('result', (ev) => {
      const f = ev.result
      const local = f?.properties?.__pplr_local
      if (local) {
        if (instance) {
          instance.selection.value = local
          if (typeof local.depth === 'number') instance.activeTab.value = local.depth
        }
        emit('select', local)
      } else {
        emit('place', {
          id:     f.id,
          label:  f.place_name,
          place:  f.text,
          kind:   'place',
          bbox:   f.bbox,
          center: f.center,
        })
      }
    })

    geocoder.on('clear', () => {
      if (instance) instance.selection.value = null
      emit('select', null)
    })

    // mapbox-gl-geocoder v5's addTo() does `document.body.contains(el)`
    // which returns false for shadow-DOM elements (our case — each profile
    // mounts inside <doxa-map>'s shadow root). Workaround: stage in body,
    // then move the rendered element into our shadow-DOM slot. References
    // inside the geocoder are by element reference so the move is safe.
    if (!slotEl.value) return
    // Inject geocoder CSS into the shadow root so the rendered geocoder is
    // actually styled (regular-document <head> styles don't cross the shadow).
    ensureGeocoderCss(slotEl.value.getRootNode())
    const stage = document.createElement('div')
    stage.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;'
    document.body.appendChild(stage)
    try {
      geocoder.addTo(stage)
      const rendered = stage.firstElementChild
      if (rendered) slotEl.value.appendChild(rendered)
    } finally {
      if (stage.parentNode) stage.parentNode.removeChild(stage)
    }
  } catch (e) {
    console.warn('[MapboxGeocoder] setup failed — geocoder disabled:', e)
    geocoder = null
  }
}

function teardown() {
  try { geocoder?.onRemove() } catch {}
  geocoder = null
  if (slotEl.value) slotEl.value.innerHTML = ''
}

// Rebuild localGeocoder callback when localIndex changes (the closure captures
// props.localIndex by reference via getter; Mapbox calls our function fresh
// each query so this is automatic — no rebuild needed).

// Global "/" shortcut to focus geocoder (preserved from PplrGeocoder)
function onGlobalKey(e) {
  const tgt = document.activeElement
  const inField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)
  const isSlash = e.key === '/' && !inField
  const isCmdK  = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
  if (isSlash || isCmdK) {
    e.preventDefault()
    const input = slotEl.value?.querySelector('input.mapboxgl-ctrl-geocoder--input, input.maplibregl-ctrl-geocoder--input')
    input?.focus()
    input?.select?.()
  }
}

onMounted(() => {
  // setup() swallows its own errors; a failed script load leaves the map working without search.
  // The ENGINE first, then its geocoder: the Mapbox path hands mapboxgl to the geocoder, and it
  // used to find it only because every leaf <head> preloaded mapbox-gl.js. ensureEngineScript is
  // a no-op when the map already loaded it.
  ensureEngineScript(provider).then(() => ensureGeocoder(provider)).then(setup, (e) => console.warn('[MapboxGeocoder]', e.message))
  document.addEventListener('keydown', onGlobalKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKey)
  teardown()
})
</script>

<template>
  <div ref="wrapEl" class="mgc-wrap" :data-theme="instance?.theme.value || 'dark'">
    <div ref="slotEl" class="mgc-slot" />
  </div>
</template>

<style scoped>
.mgc-wrap { width: 100%; position: relative; }
/* mapbox-gl-geocoder injects its own root .mapboxgl-ctrl-geocoder; we just
   need a slot element to host it. Style overrides target the deep selectors
   from the plugin's stylesheet (loaded via index.html CDN). */
.mgc-slot :deep(.mapboxgl-ctrl-geocoder) {
  width: 100%; max-width: 100%;
  background: rgba(13,17,23,0.96);
  border: 1px solid #30363d;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  font: 13px system-ui, sans-serif;
  min-width: 0;
}
.mgc-slot :deep(.mapboxgl-ctrl-geocoder--input) {
  color: #c9d1d9;
  height: 36px;
  padding: 6px 36px 6px 38px;
  font: 13px system-ui, sans-serif;
}
.mgc-slot :deep(.mapboxgl-ctrl-geocoder--input::placeholder) { color: #6e7681; }
.mgc-slot :deep(.mapboxgl-ctrl-geocoder--icon-search) {
  fill: #6e7681; top: 8px; left: 9px;
}
.mgc-slot :deep(.mapboxgl-ctrl-geocoder--button) {
  background: transparent; top: 6px;
}
.mgc-slot :deep(.suggestions) {
  background: rgba(13,17,23,0.97);
  border: 1px solid #30363d; border-radius: 8px;
  margin-top: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
}
.mgc-slot :deep(.suggestions > li > a) {
  color: #c9d1d9; padding: 8px 12px;
}
.mgc-slot :deep(.suggestions > .active > a),
.mgc-slot :deep(.suggestions > li > a:hover) {
  background: rgba(115,161,127,0.12);
  color: #c9d1d9;
}

/* Light theme overrides */
.mgc-wrap[data-theme="light"] :deep(.mapboxgl-ctrl-geocoder) {
  background: rgba(255,255,255,0.97); border-color: #d0d7de;
  box-shadow: 0 4px 14px rgba(31,35,40,0.15);
}
.mgc-wrap[data-theme="light"] :deep(.mapboxgl-ctrl-geocoder--input) { color: #1f2328; }
.mgc-wrap[data-theme="light"] :deep(.mapboxgl-ctrl-geocoder--input::placeholder) { color: #57606a; }
.mgc-wrap[data-theme="light"] :deep(.suggestions) {
  background: #ffffff; border-color: #d0d7de; color: #1f2328;
}
.mgc-wrap[data-theme="light"] :deep(.suggestions > li > a) { color: #1f2328; }
.mgc-wrap[data-theme="light"] :deep(.suggestions > .active > a),
.mgc-wrap[data-theme="light"] :deep(.suggestions > li > a:hover) {
  background: #f6f8fa; color: #1f2328;
}
</style>
