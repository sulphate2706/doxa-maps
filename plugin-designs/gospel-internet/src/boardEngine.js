/**
 * boardEngine.js — build one map on whichever engine the embed asked for, the way this board builds all
 * of its maps: engine from resolveMapProvider, script + CSS ensured, RTL shaping installed before `new
 * Map`, the style from the registry ('paper' = Mapbox light / OpenFreeMap positron), labels in the
 * reader's language, attribution added. Used by the geographic map AND the language-tree whiteboard, so
 * the two can never drift apart on an engine detail.
 *
 * whiteboard:true hides every basemap layer except the background once the style loads. The style is
 * still loaded because it is what declares the GLYPH server: a hand-typed glyph URL is how labels
 * silently vanished on one engine before (library/maps/label-font.js).
 */
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { ensureEngineScript, engineGlobal, ensureEngineCSS, engineStylesheetUrl, engineUiLocale } from '@map/composables/useMapInstance.js'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
import { localizeBasemapLabels } from '@map/maps/localize-labels.js'
import { addMapAttribution } from '@map/composables/useMapAttribution'

export function readerLang(profileConfig) {
  const pc = profileConfig || {}
  if (pc.locale || pc.lang) return String(pc.locale || pc.lang)
  try { return new URLSearchParams(location.search).get('lang') || document.documentElement.lang || 'en' } catch { return 'en' }
}

/**
 * @returns {Promise<{ map, provider } | { error: string, provider }>}  resolves once the style has loaded
 */
export async function createBoardMap(el, profileConfig, { center = [60, 20], zoom = 1.4, whiteboard = false, boundaries = true, background = '#f3f3f1', token = '' } = {}) {
  const provider = resolveMapProvider(profileConfig)
  try { await ensureEngineScript(provider) } catch (_) { /* reported below */ }
  const gl = engineGlobal(provider)
  if (!gl) return { provider, error: provider === 'maplibre' ? 'MapLibre' : 'Mapbox' }
  installRtlTextPlugin(gl)
  const css = engineStylesheetUrl(provider)
  if (css) await ensureEngineCSS(el, css)
  const lang = readerLang(profileConfig)
  // The host's token by the same ladder the production maps use: profile-config tk, then the token
  // ProfileLoader provides (a tokenUrl token-service answer, or the page's shared token), then the page global.
  const tk = profileConfig?.tk || token || (typeof window !== 'undefined' && window.MAP_TOKEN) || ''
  const map = new gl.Map({
    container: el,
    style: resolveNamedStyle('paper', provider).style || 'mapbox://styles/mapbox/light-v11',
    accessToken: tk,
    locale: engineUiLocale(lang, provider),
    center, zoom, projection: 'mercator', attributionControl: false,
    // a whiteboard is not a world: no wrap-around copies of the tapestry at low zoom
    renderWorldCopies: !whiteboard,
  })
  addMapAttribution(map, { boundaries, basemap: !whiteboard })
  await new Promise((res) => map.once('load', res))
  if (whiteboard) {
    for (const l of map.getStyle().layers || []) {
      try {
        if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', background)
        else map.setLayoutProperty(l.id, 'visibility', 'none')
      } catch (_) { /* a layer the engine will not touch is left as it is */ }
    }
  } else {
    try { localizeBasemapLabels(map, lang) } catch (_) { /* a nicety, never a broken map */ }
  }
  return { map, provider }
}

/** Reduced motion, read LIVE (never cached): under it every camera change is a jump. */
export function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
}
