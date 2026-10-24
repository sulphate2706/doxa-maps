/**
 * whiteboard-map.js — a map engine used as a DRAWING SURFACE rather than as a map.
 *
 * ★ WHY A CHART USES THE MAP ENGINE AT ALL (it has to stay fast, light and lower-definition
 * when zoomed out). A GeoJSON source is tiled per zoom, so zoomed out it draws LESS; label placement
 * never lets two labels overlap and reveals them in priority order as the reader zooms; hit-testing and
 * pan/zoom come free. An SVG chart keeps every node in the page at every zoom, which is what makes a
 * big one slow. So the engine is asked for a blank surface and the chart draws on it.
 *
 * ★ whiteboard:true IS A BEHAVIOUR, NOT A LOOK, and that is why this takes a MODE and never an engine
 * factory. It hides every basemap layer except the background AND sets renderWorldCopies:false, because
 * a whiteboard is not a world: with world copies on, the drawing repeats horizontally at low zoom and a
 * reader sees three tapestries. A caller passing an ordinary map factory would get that, silently.
 *
 * ★ THE STYLE IS STILL LOADED even though every layer is then hidden. The style is what declares the
 * GLYPH server, and a hand-typed glyph URL is how labels silently vanished on one engine before (see
 * library/maps/label-font.js). Hiding layers after load costs one pass; guessing a glyph URL costs the
 * labels.
 *
 * MOVED, NOT WRITTEN: this was gospel-internet/src/boardEngine.js — 67 lines whose every import already
 * came from library. It was never gospel-specific; it simply lived in the first plugin that needed it.
 */
import { resolveMapProvider } from '../composables/useMapProvider.js'
import { ensureEngineScript, engineGlobal, ensureEngineCSS, engineStylesheetUrl, engineUiLocale } from '../composables/useMapInstance.js'
import { resolveNamedStyle } from '../styles/registry.js'
import { installRtlTextPlugin } from './rtl-text.js'
import { localizeBasemapLabels } from './localize-labels.js'
import { addMapAttribution } from '../composables/useMapAttribution.js'

/** The reader's language, from the host's config first and the page second. */
export function readerLang(profileConfig) {
  const pc = profileConfig || {}
  if (pc.locale || pc.lang) return String(pc.locale || pc.lang)
  try { return new URLSearchParams(location.search).get('lang') || document.documentElement.lang || 'en' } catch { return 'en' }
}

/**
 * @returns {Promise<{ map, provider } | { error: string, provider }>} resolves once the style has loaded
 */
export async function createWhiteboardMap(el, profileConfig, {
  center = [0, 0], zoom = 1, whiteboard = true, boundaries = false, background = '#f3f3f1', token = '',
} = {}) {
  const provider = resolveMapProvider(profileConfig)
  try { await ensureEngineScript(provider) } catch (_) { /* reported below */ }
  const gl = engineGlobal(provider)
  if (!gl) return { provider, error: provider === 'maplibre' ? 'MapLibre' : 'Mapbox' }
  installRtlTextPlugin(gl)
  const css = engineStylesheetUrl(provider)
  if (css) await ensureEngineCSS(el, css)
  const lang = readerLang(profileConfig)
  // The host's token by the same ladder the production maps use: profile-config tk, then the token
  // ProfileLoader provides (a tokenUrl answer, or the page's shared token), then the page global.
  const tk = profileConfig?.tk || token || (typeof window !== 'undefined' && window.MAP_TOKEN) || ''
  const map = new gl.Map({
    container: el,
    style: resolveNamedStyle('paper', provider).style || 'mapbox://styles/mapbox/light-v11',
    accessToken: tk,
    locale: engineUiLocale(lang, provider),
    center, zoom, projection: 'mercator', attributionControl: false,
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

export default createWhiteboardMap
