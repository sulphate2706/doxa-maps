/**
 * generate.js — pure wiring: live people-group records + India boundaries + a format → the finished
 * poster SVG string, generated at call time (nothing stored). NO fetch and NO DOM here; the caller (the
 * Vue view in a browser, or a node test) supplies the records and the boundary geojson, so this stays
 * testable and Worker-friendly. The generator is the LOCAL STOPGAP copy under ./generators/; attempts
 * move onto the shared @map circular-layout module when it lands and this copy is deleted.
 */
import { createPosterGenerator } from './generators/poster-render.js'

const INDIA = {
  id: 'country-ind', zoneKey: 'country-ind', label: 'India', color: '#d4a640',
  adm0: ['IND'], selector: { type: 'country_codes', values: ['IND'] },
  provinces: ['36 states and union territories'],
}

// The blessing on every poster. Header = the banner; footer = the Aaronic blessing (Numbers 6:24-26).
// WEB British Edition ("The LORD …"), public domain, switchable: pass a different `footer` to change
// the version (e.g. NIV, which needs Biblica's notice). Header mirrors the Wall of People Groups' spirit.
export const BLESSING = {
  header: "Bless India in Jesus' name",
  footer: {
    text: 'The LORD bless you, and keep you. The LORD make his face to shine on you, and be gracious to you. The LORD lift up his face toward you, and give you peace.',
    ref: 'Numbers 6:24-26',
  },
}

/** A people-group record (PRINT_FIELDS: latitude/longitude/name/…) → the generator's pin shape. */
export function recordsToPins(records) {
  return (records || [])
    .map((r) => ({
      name: r.name,
      lng: r.longitude != null ? +r.longitude : r.lng != null ? +r.lng : null,
      lat: r.latitude != null ? +r.latitude : r.lat != null ? +r.lat : null,
      country_code: r.country_code || 'IND',
      image_url: r.image_url,
      population: r.population != null ? +r.population : (r.p != null ? +r.p : undefined),
      wagf_region: r.wagf_region,
      slug: r.slug,
    }))
    .filter((p) => p.name && Number.isFinite(p.lng) && Number.isFinite(p.lat))
}

// Lift the finished <svg> out of the poster HTML WITH its stylesheet inlined. The poster's fills use
// CSS vars (--paper/--sea/--frameline) defined in the HTML's <style> :root; without that block every
// fill falls back to black. Same approach as @map/packet/poster-raster.js inlineSvg (replicated here,
// pure, so the plugin needn't import the raster module). :root inside a standalone <svg> matches the
// svg root, so the vars resolve.
function inlineSvg(html) {
  const s = String(html || '')
  const svg = (s.match(/<svg[\s\S]*?<\/svg>/) || [])[0]
  if (!svg) return ''
  const css = (s.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  const safe = css.replace(/<\/style>/gi, '')
  return svg.replace(/<svg([^>]*)>/, `<svg$1><style>${safe}</style>`)
}

/**
 * @returns {Promise<{ svg:string, stats:object, title:string, count:number }>}
 * `svg` is the finished poster as one standalone <svg> (feed it to PanelSheets as a data URL).
 */
export async function generatePoster({
  records, adm0, adm1Ind, nePlaces = [], seriesDef = {}, iso3Name = {},
  format = '60x96c4b', env = {}, blessing = BLESSING,
}) {
  const pins = recordsToPins(records)
  const zone = { ...INDIA, label: blessing.header, count: pins.length }
  env = { ...env, FOOTER_VERSE_JSON: JSON.stringify(blessing.footer) }
  // Physical sheet seams as page-height fractions (trim edge of each non-last sheet), so the layout
  // can nudge text off them. Derived from the format's sheet plan: 60x96 = three 36in sheets, 6in joins
  // → seams at 36in and 66in of 96in. (Only whole-page formats; small sizes have no seam.)
  const SEAMS = { '60x96c4b': [0.375, 0.6875], '60x96c4': [0.375, 0.6875] }
  if (SEAMS[format]) env = { ...env, SEAM_FRACS_JSON: JSON.stringify(SEAMS[format]) }
  const feats = (adm0 && adm0.features) || []
  const zoneFC = {
    type: 'FeatureCollection',
    features: feats
      .filter((f) => f.properties && f.properties.iso3 === 'IND')
      .map((f) => ({
        type: 'Feature',
        properties: { ...f.properties, zoneKey: zone.zoneKey, zoneColor: zone.color, zoneLabel: zone.label },
        geometry: f.geometry,
      })),
  }
  // This plugin's own banner + series words: no "Pray for" qualifier (header is exactly the blessing),
  // and a series name of its own rather than the country-map template's.
  const sd = { ...seriesDef, poster: { ...(seriesDef.poster || {}), titleQualifier: '', seriesName: 'Bless India Posters' } }
  const gen = createPosterGenerator({
    env: { ...env, FORMAT: format, SPARSE: '1' },
    SERIES_DEF: sd, ISO3_NAME: iso3Name,
    adm0, adm1Ind, adm1Chn: null, nePlaces,
    series: { totalGroups: pins.length, totalLists: 1, index: 1 },
  })
  const out = await gen.renderPoster(zone, pins, zoneFC)
  return { html: out.html, svg: inlineSvg(out.html), stats: out.indiaSheet || null, title: out.title || 'India', count: pins.length }
}
