// library/styles/registry.js — the named 12-style pack, every style on BOTH engines.
//
// WHY NAMES: profile-config carried raw style URLs, which (a) tie an embed to one
// engine (a mapbox:// URL is meaningless to MapLibre) and (b) scatter taste
// decisions across profiles. A NAME ('midnight-glow') resolves per provider, so
// the same embed config works on Mapbox and token-free MapLibre alike.
//
// PAIRING RULES:
//   · mapbox side: official style URLs (Standard's lightPreset variants give
//     day/dawn/dusk/night from ONE style doc — seamless theme flips, see
//     useMapTheme.js). `lightPreset` here is a HINT profiles may apply on load.
//   · maplibre side: FREE, no-key styles only — OpenFreeMap (liberty/bright/
//     positron/dark/fiord). No free satellite imagery exists for MapLibre, so imagery
//     styles fall back to the closest free look (noted per entry).
//
//     ★ FIORD ADDED 2026-09-24, after RENDERING the candidates rather than reading a gallery.
//     OpenFreeMap ships a blue-toned dark style this registry never used. Side by side at the
//     band this product actually shows (30E 25N, z2.4), `dark` reads flat and muddy — near-black
//     land against near-black water — while `fiord` separates land from sea, keeps labels legible
//     in BOTH Latin and native script, and carries the blue cast the galaxy entry below already
//     asks for in words. It took the three dark entries whose MAPBOX counterpart is also blue-ish
//     (Standard@night, Standard@dusk, navigation-night); `ink` pairs with near-black dark-v11 and
//     deliberately did not move — see the note there.
//     Endpoint verified 200 keyless before the swap, same bar as every other URL here. Note that
//     OpenFreeMap's documented '3d' style is NOT live at /styles/3d (404) — do not cite it.
//
//     ★ CARTO REMOVED 2026-09-22, and this is a rule, not a preference. Eight of these
//     twelve entries previously resolved to basemaps.cartocdn.com. Those URLs were keyless
//     *at the time* — verified live, a real style.json + a 275KB .mvt + a font .pbf all 200
//     with no token — but CARTO's own documentation reserves the right to extend its API-key
//     requirement to vector tiles. That is a future silent outage already shipped in our
//     code, and it is the SAME single-point-of-failure shape we are trying to escape by
//     moving off the URL-restricted Mapbox token. A dependency that is free today and
//     gated tomorrow is not a free dependency; it is a deferred one.
//
//     Substitutions (each OpenFreeMap style verified 200 keyless before the swap):
//       carto dark-matter -> openfreemap dark      (midnight-glow, dusk, ink, wayfinder-night)
//       carto positron    -> openfreemap positron  (paper)
//       carto voyager     -> openfreemap liberty   (satellite, hybrid, wayfinder-day)
//
//     THE BAR FOR ADDING A maplibre: URL HERE: keyless, commercial use permitted, and
//     self-hostable. MapTiler and Stadia free tiers fail the second test outright — both
//     prohibit commercial use — so they are disqualified on licence, not merely on key risk.
//
// A raw URL still works everywhere a name does (resolveNamedStyle passes
// mapbox:// and http(s):// through untouched) — nothing existing breaks.

export const STYLE_REGISTRY = [
  { id: 'midnight-glow',  label: 'Midnight Glow',  mood: 'the prayer-map dark — pins glow like embers',
    mapbox: 'mapbox://styles/mapbox/standard', lightPreset: 'night',
    maplibre: 'https://tiles.openfreemap.org/styles/fiord',
    bestFor: ['doxa-simple-map', 'my-upg-100-list'] },
  { id: 'daylight',       label: 'Daylight',       mood: 'the same Standard world, lights on',
    mapbox: 'mapbox://styles/mapbox/standard', lightPreset: 'day',
    maplibre: 'https://tiles.openfreemap.org/styles/liberty',
    bestFor: ['doxa-research-map', 'gospel-resources'] },
  { id: 'dawn',           label: 'Dawn',           mood: 'soft warm horizon — hopeful, quiet',
    mapbox: 'mapbox://styles/mapbox/standard', lightPreset: 'dawn',
    maplibre: 'https://tiles.openfreemap.org/styles/positron',
    bestFor: ['doxa-simple-map'] },
  { id: 'dusk',           label: 'Dusk',           mood: 'blue hour — calm contrast for bright pins',
    mapbox: 'mapbox://styles/mapbox/standard', lightPreset: 'dusk',
    maplibre: 'https://tiles.openfreemap.org/styles/fiord',
    bestFor: ['my-upg-100-list'] },
  { id: 'paper',          label: 'Paper',          mood: 'near-white minimal — data reads like print',
    mapbox: 'mapbox://styles/mapbox/light-v11',
    maplibre: 'https://tiles.openfreemap.org/styles/positron',
    bestFor: ['research-dashboard', 'cities-internet'] },
  { id: 'ink',            label: 'Ink',            mood: 'near-black minimal — maximum pin contrast',
    mapbox: 'mapbox://styles/mapbox/dark-v11',
    // KEEPS `dark` ON PURPOSE while the other three dark entries moved to `fiord`. Ink pairs with
    // mapbox dark-v11, which is NEAR-BLACK, and its whole job is maximum pin contrast. fiord is a
    // BLUE-toned dark — better looking in isolation and wrong here, because a lighter, bluer ground
    // eats exactly the contrast this entry exists to provide. Not an oversight; do not "finish" it.
    maplibre: 'https://tiles.openfreemap.org/styles/dark',
    bestFor: ['my-upg-100-list', 'cities-internet'] },
  { id: 'streetlife',     label: 'Street Life',    mood: 'full street detail — city-scale work',
    mapbox: 'mapbox://styles/mapbox/streets-v12',
    maplibre: 'https://tiles.openfreemap.org/styles/bright',
    bestFor: ['cities-internet', 'key-cities'] },
  { id: 'terrain',        label: 'Terrain',        mood: 'relief + parks — where people actually live',
    mapbox: 'mapbox://styles/mapbox/outdoors-v12',
    maplibre: 'https://tiles.openfreemap.org/styles/liberty',
    bestFor: ['doxa-research-map', 'country-posters'] },
  { id: 'satellite',      label: 'Satellite',      mood: 'imagery — the real ground',
    mapbox: 'mapbox://styles/mapbox/satellite-v9',
    maplibre: 'https://tiles.openfreemap.org/styles/liberty',   // no free imagery on MapLibre — closest free look
    bestFor: ['country-posters'] },
  { id: 'hybrid',         label: 'Hybrid',         mood: 'imagery + labels — orientation without losing ground truth',
    mapbox: 'mapbox://styles/mapbox/satellite-streets-v12',
    maplibre: 'https://tiles.openfreemap.org/styles/liberty',   // same fallback note as satellite
    bestFor: ['key-cities'] },
  { id: 'wayfinder-day',  label: 'Wayfinder Day',  mood: 'high-legibility navigation palette',
    mapbox: 'mapbox://styles/mapbox/navigation-day-v1',
    maplibre: 'https://tiles.openfreemap.org/styles/liberty',
    bestFor: ['gospel-resources'] },
  { id: 'wayfinder-night',label: 'Wayfinder Night',mood: 'dark navigation — dashboards at night',
    mapbox: 'mapbox://styles/mapbox/navigation-night-v1',
    maplibre: 'https://tiles.openfreemap.org/styles/fiord',
    bestFor: ['research-dashboard'] },

  // ── GALAXY — black ground, BLUE water ────────────────────────────────────────────────────
  // The ask (2026-09-23): BLUE WATER against a BLACK GALAXY background. The continents go to deep
  // space; the oceans stay unmistakably water.
  //
  // ★ WHY THIS IS A BASE STYLE + A PAINT PATCH, NOT A HAND-AUTHORED style.json. Writing a whole
  // style document would mean owning ~47 layers, a glyph endpoint and a sprite URL forever, and
  // it would be MapLibre-only — breaking the registry's contract that every id resolves on BOTH
  // engines. Instead both providers start from their existing near-black style and we repaint
  // exactly the layers that carry water. The patch is small, auditable, and provider-symmetric.
  //
  // WHAT THE BASE STYLES ACTUALLY PAINT (measured 2026-09-23, not assumed):
  //   OpenFreeMap dark  — background rgb(12,12,12); layer id `water` (fill) is rgb(27,27,29) and
  //                       `waterway` (line) the same. i.e. the base style does not distinguish
  //                       water from land AT ALL. That is precisely the gap this entry fills.
  //   Mapbox dark-v11   — its water layer ids are enumerated at runtime (they differ from
  //                       MapLibre's and have changed across style versions), so `paint` lists
  //                       CANDIDATES and the applier skips any id the loaded style lacks.
  //
  // THE BLUE: #2563a8 measures 3.19:1 against the rgb(12,12,12) ground — above the 3:1 WCAG
  // non-text threshold, so the coastline is a real edge rather than a tonal hint. Darker,
  // moodier blues were tried and measured first: #1b3a6b 1.74:1 and #1e4d8f 2.34:1 both fall
  // UNDER 3:1, which is how an ocean ends up merely looking like slightly-less-black land.
  /* ★ CORRECTED 2026-09-23 — THE FIRST GALAXY WAS A MISREADING OF THE ASK. Not a dark basemap: a
     spherical GLOBE on a black background (the galaxy, as the Mapbox map has it), with BLUE OCEANS
     like the Mapbox map, and land that is NOT black.
     The first attempt tinted a dark basemap (black land, recoloured water) — the night side of
     Earth. What he described is the DAY side seen from space: NORMAL land colours, the default
     blue oceans, and the blackness belongs to the SPACE BEHIND THE SPHERE, not to the ground.
     So the style is now a normal-coloured basemap with no paint overrides at all — the galaxy is
     not a property of the tiles. It is the void the globe floats in, which is the map CONTAINER's
     background showing through outside the sphere (see DashboardMapPanel's .rd-map rule). */
  { id: 'galaxy',         label: 'Galaxy',         mood: 'the day side of Earth floating in space — normal land, blue oceans, black void behind the sphere',
    mapbox: 'mapbox://styles/mapbox/standard',
    // ★ FOUND, NOT AUTHORED: replaced with a style that already exists online.
    // VersaTiles Colorful — a maintained, production-free, keyless style (280 layers) whose ocean
    // is a real blue (#bfd9f2), the closest of the surveyed free styles to the Mapbox look. The
    // alternatives measured and rejected: CARTO Voyager's water is pale teal #b0d0d6; OSM
    // Americana has proper blue but its hosted tiles are a demo endpoint, not for production.
    maplibre: 'https://tiles.versatiles.org/assets/styles/colorful/style.json',
    bestFor: ['research-dashboard', 'my-upg-100-list'] },
]

const BY_ID = Object.fromEntries(STYLE_REGISTRY.map(s => [s.id, s]))

/**
 * Resolve a profile-config `style` value for an engine.
 *   · a registry NAME → that entry's per-provider style URL
 *   · a raw mapbox:// or http(s):// URL → passed through untouched (legacy behavior)
 *   · anything else / undefined → undefined (caller keeps its own default)
 * Returns { style, lightPreset, paint } — lightPreset only for named Standard variants,
 * `paint` only for entries that patch the base style (see applyStylePaint).
 */
export function resolveNamedStyle(value, provider = 'mapbox') {
  if (typeof value !== 'string' || !value) return { style: undefined, lightPreset: undefined, paint: undefined }
  const entry = BY_ID[value]
  if (entry) {
    return provider === 'maplibre'
      ? { style: entry.maplibre, lightPreset: undefined, paint: entry.paint }
      : { style: entry.mapbox, lightPreset: entry.lightPreset, paint: entry.paint }
  }
  if (/^(mapbox:\/\/|https?:\/\/)/.test(value)) return { style: value, lightPreset: undefined, paint: undefined }
  return { style: undefined, lightPreset: undefined, paint: undefined }
}

/**
 * Apply a registry entry's `paint` patch to a LOADED map, skipping any layer the style lacks.
 *
 * ★ WHY SKIP-IF-ABSENT IS THE WHOLE DESIGN. Layer ids are a property of the STYLE DOCUMENT, not
 * of the engine — Mapbox and MapLibre name water differently, and Mapbox has renamed its own ids
 * across style versions. Hardcoding one id and calling setPaintProperty on it throws and kills
 * the rest of the patch. Probing getLayer() first turns a wrong guess into a no-op, so a list
 * covering both engines is safe to apply to either.
 *
 * Returns the ids it actually matched, so a caller can log what the loaded style really had
 * rather than what we hoped it had.
 */
export function applyStylePaint(map, paint) {
  if (!map || !Array.isArray(paint)) return []
  const applied = []
  for (const p of paint) {
    if (!p || !p.layer || !p.prop) continue
    try {
      if (!map.getLayer(p.layer)) continue
      map.setPaintProperty(p.layer, p.prop, p.value)
      applied.push(p.layer + '.' + p.prop)
    } catch (_) { /* a style that has the layer but not the property: skip, never throw */ }
  }
  return applied
}
