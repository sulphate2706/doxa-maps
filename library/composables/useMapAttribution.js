// useMapAttribution.js — the data-credit line every map MUST carry.
//
//   import { addMapAttribution } from '@map/composables/useMapAttribution'
//   addMapAttribution(map, { boundaries: true })
//
// ═══ WHY THIS EXISTS — IT IS A LICENCE OBLIGATION, NOT A NICETY ═════════════
// Every map in this repo constructs Mapbox with `attributionControl: false`
// (useMapInstance.js and all three research profiles), and NOTHING replaced it. So
// the live maps were rendering NO attribution at all — not for geoBoundaries, and
// not for Mapbox/OpenStreetMap either, whose terms also require it.
//
// geoBoundaries' own request, verbatim: "we ask that you put the name
// 'geoBoundaries' with a link back to this website, www.geoboundaries.org,
// somewhere prominent on the page that uses the boundaries."
//
// gbOpen is ALSO a MIXED-LICENCE collection — it passes through each country's
// upstream licence, verified live against their API:
//   India ADM1   CC BY 2.5 IN        (source: github.com/datameet/maps)
//   Sudan ADM0   CC BY 3.0 IGO       (source: HDX)
//   Brazil ADM0  CC BY 3.0 IGO       (source: HDX)
//   USA ADM0     Public Domain       (US Census)
//   China ADM0   Public Domain       (Wikimedia Commons)
// Several therefore carry a genuine per-country attribution requirement. A repo
// comment previously called this "Apache-2.0-ish", which is wrong and would be the
// wrong basis for a publication decision.
//
// SELF-HOSTED, NO NETWORK. This is plain DOM + inline style: it adds no request, so
// it cannot leak a viewer's IP the way a third-party badge would. That matters here
// — see the open OPEN_DEFECT_mapbox_cdn finding.

const LINKS = {
  boundaries: {
    label: 'geoBoundaries',
    href: 'https://www.geoboundaries.org',
    title: 'Country and administrative boundaries — geoBoundaries gbOpen (mixed upstream licences; see docs)',
  },
  mapbox: { label: 'Mapbox', href: 'https://www.mapbox.com/about/maps/' },
  osm: { label: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  // Under MapLibre the basemap is OpenFreeMap's, built from OpenMapTiles on OpenStreetMap data — the
  // credit its own TileJSON asks for. Mapbox serves nothing on those maps and must not be credited.
  openfreemap: { label: 'OpenFreeMap', href: 'https://openfreemap.org' },
  openmaptiles: { label: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  osmContributors: { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
};

/** The basemap credit for the engine that actually drew THIS map (read from the instance, not config). */
function basemapCredit(map) {
  const ml = typeof window !== 'undefined' ? window.maplibregl : null;
  const isMaplibre = !!(ml && ml.Map && map instanceof ml.Map);
  return isMaplibre ? [LINKS.openfreemap, LINKS.openmaptiles, LINKS.osmContributors] : [LINKS.mapbox, LINKS.osm];
}

/**
 * Add the bottom-right attribution bar to a Mapbox map.
 *
 * @param {Object} map            a mapboxgl.Map
 * @param {Object} [opts]
 * @param {boolean} [opts.boundaries=true]  credit geoBoundaries (set false only if
 *                                          the map draws NO gb polygons at all)
 * @param {boolean} [opts.basemap=true]     credit the basemap of the engine that drew this map:
 *                                          Mapbox + OpenStreetMap, or under MapLibre OpenFreeMap +
 *                                          OpenMapTiles + OpenStreetMap contributors
 */
export function addMapAttribution(map, opts = {}) {
  if (!map || typeof map.addControl !== 'function') return null;
  const { boundaries = true, basemap = true } = opts;

  const el = document.createElement('div');
  el.className = 'doxa-attribution mapboxgl-ctrl';
  // Inline style: these maps live in SHADOW ROOTS, so a stylesheet in the host page
  // would not reach here. Kept muted and small so it reads as a credit line, not UI.
  el.style.cssText = [
    'font:11px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'background:rgba(255,255,255,.82)', 'color:#3a4048',
    'padding:2px 6px', 'border-radius:3px 0 0 0',
    'pointer-events:auto', 'max-width:min(92vw,420px)',
  ].join(';');

  const parts = [];
  if (boundaries) parts.push(LINKS.boundaries);
  if (basemap) parts.push(...basemapCredit(map));

  // href-escaped-ok: every p comes from the LINKS table above — module constants chosen by engine
  // type in basemapCredit(). No API value and no host attribute reaches this href, so there is
  // nothing user-supplied to escape. (check:popup-href-escaped)
  el.innerHTML = parts.map((p) =>
    `<a href="${p.href}" target="_blank" rel="noopener noreferrer"`
    + (p.title ? ` title="${p.title}"` : '')
    + ` style="color:#2a5d8f;text-decoration:none">${p.label}</a>`).join(' · ');

  const control = {
    onAdd: () => el,
    onRemove: () => { el.parentNode && el.parentNode.removeChild(el); },
    getDefaultPosition: () => 'bottom-right',
  };
  map.addControl(control, 'bottom-right');
  return control;
}

/**
 * The same credit as plain text — for posters, PDFs and print, which have no DOM — for the engine that
 * drew the map ('maplibre' → OpenFreeMap / OpenMapTiles / OpenStreetMap contributors).
 */
export function attributionText(provider = 'mapbox') {
  return provider === 'maplibre'
    ? 'Boundaries: geoBoundaries (geoboundaries.org) · OpenFreeMap © OpenMapTiles © OpenStreetMap contributors'
    : 'Boundaries: geoBoundaries (geoboundaries.org) · © Mapbox © OpenStreetMap';
}
/** @deprecated the Mapbox credit only; use attributionText(provider). Kept for existing importers. */
export const ATTRIBUTION_TEXT = attributionText('mapbox');
