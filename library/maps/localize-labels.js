/**
 * localize-labels.js — show the BASEMAP's place names in the reader's language, on both engines.
 *
 * WHY. Every map translated its own chrome but left the basemap's country, city and street names in
 * the style's default (English for Mapbox, Latin + native script for OpenFreeMap), in all eleven
 * locales. A reader in Arabic saw an Arabic legend over an English map.
 *
 * TWO ENGINES, TWO MECHANISMS — each the engine's own supported one:
 *   Mapbox    map.setLanguage(lang). The engine localizes its own styles, including the Standard
 *             style's IMPORTED basemap, which a layer-by-layer rewrite cannot reach.
 *   MapLibre  OpenFreeMap styles label from OSM name tags, so each basemap symbol layer's text-field
 *             is pointed at ['coalesce', name:<lang>, name:latin, name]: the translated name where
 *             OSM has one, else the style's Latin name, else the local name. English restores each
 *             layer's ORIGINAL expression (remembered per map), so switching back loses nothing.
 *
 * ★ ONLY THE BASEMAP'S LABELS. Plugins add their own symbol layers (zone titles, people-group names,
 * counts) that read their OWN properties. A layer is rewritten only when its text-field reads an OSM
 * name field (name, name:latin, name:nonlatin, name_en, name_int, name:en). Anything else is not a
 * basemap label and is never touched.
 *
 * Fail-soft everywhere: a label that stays in the default language is a nicety lost, never a broken
 * map.
 */

const OSM_NAME_FIELD = /\[\s*"get"\s*,\s*"name(?::latin|:nonlatin|:en|_en|_int)?"\s*\]|\{name(?::latin|:nonlatin|:en|_en|_int)?\}/
const originals = new WeakMap()   // map -> Map(layerId -> original text-field)

function isMaplibreMap(map) {
  return typeof window !== 'undefined' && !!window.maplibregl && map instanceof window.maplibregl.Map
}

/**
 * Point the basemap's place-name labels at `lang` (every language, English included).
 * Call after style.load, and again whenever the reader's language changes.
 * @returns {number} how many label layers were localized (0 on Mapbox, which localizes internally)
 */
export function localizeBasemapLabels(map, lang) {
  if (!map || !lang) return 0
  const code = String(lang).split('-')[0].toLowerCase()
  try {
    if (!isMaplibreMap(map)) {
      if (typeof map.setLanguage === 'function') map.setLanguage(code)
      return 0
    }
    const style = map.getStyle && map.getStyle()
    if (!style || !Array.isArray(style.layers)) return 0
    let saved = originals.get(map)
    if (!saved) { saved = new Map(); originals.set(map, saved) }
    let n = 0
    for (const layer of style.layers) {
      if (layer.type !== 'symbol' || !layer.layout || layer.layout['text-field'] == null) continue
      const current = layer.layout['text-field']
      const json = JSON.stringify(current)
      // Our own expression is recognisable by shape. Anything ELSE is the style's current original —
      // re-saved every time, so a setStyle() that reuses layer ids with new expressions (a theme
      // switch) never restores the PREVIOUS style's labels.
      if (!json.startsWith('["coalesce",["get","name:')) {
        if (!OSM_NAME_FIELD.test(json)) continue   // a plugin's own label: leave it
        saved.set(layer.id, current)
      } else if (!saved.has(layer.id)) continue
      // English too, not the style's own bilingual labels ("Россия" under "Russia"): those drew every
      // native script at world view, so an English page fetched 13 extra glyph ranges (~600 KB, measured:
      // Prayer Progress 18 requests / 777 KB in en against 5 / 185 KB in ar). One language per label.
      // ★ AND THE UNDERSCORE SPELLING, because one of our basemaps writes it that way. The galaxy
      // style (research-dashboard, my-upg-100-list) is VersaTiles Colorful on the Shortbread schema,
      // whose label keys are name_ar / name_de / name_en …, NOT name:ar. This chain only tried the
      // colon spelling, so every one of its 43 label layers coalesced down to `name` — the ENDONYM —
      // and a Russian page rendered 中国 and Türkiye while fetching a glyph range for every script on
      // screen. The localizer was running and could not help, which is the failure that looks like a
      // basemap problem and is really a key-name problem.
      //
      // MEASURED against the live tiles (six z3/z4 tiles across Europe, Asia and Africa, identical key
      // sets): name_ar, name_de, name_el, name_en, name_es, name_fr, name_it, name_nl, name_pl,
      // name_pt, name_uk. Of the eleven locales we ship that covers SEVEN — ar, de, en, es, fr, it, pt
      // — in their own language, with no change to the chosen basemap.
      //
      // hi, ro, ru and zh are genuinely absent from those tiles, so they take name_en: Latin script,
      // one script, readable rather than mixed CJK and Devanagari endonyms. That is the same role
      // name:latin already plays for the OpenFreeMap styles, which is why it sits in the same position
      // rather than being a special case.
      //
      // Order matters and is not arbitrary: the colon spelling first so the OpenFreeMap styles behave
      // exactly as before (their first entry still wins and nothing about them changes), then the
      // underscore, then the two Latin fallbacks, then the local name.
      const next = ['coalesce',
        ['get', 'name:' + code], ['get', 'name_' + code],
        ['get', 'name:latin'], ['get', 'name_en'],
        ['get', 'name']]
      map.setLayoutProperty(layer.id, 'text-field', next)
      n++
    }
    return n
  } catch (_) {
    return 0
  }
}

export default localizeBasemapLabels
