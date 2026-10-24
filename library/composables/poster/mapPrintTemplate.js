/**
 * mapPrintTemplate.js — SHARED (@map/composables/poster/mapPrintTemplate.js).
 *
 * ★ ONE TEMPLATE FOR A MAP'S PRINT (2026-09-30: "the map download/print should look finished"). Every map's
 * "Export poster…" builds its sheet here, so they all look the same:
 *   - LANDSCAPE Letter, always: a map is wider than a page is tall, and a standard sheet prints anywhere;
 *   - a HEADER with the MAP's own name, the view on screen ("Prayer", "Religion"…) as its subtitle;
 *   - the LEGEND as a side panel (computeLayout's right-hand column);
 *   - a FOOTER line from the prayer packet's final page, the 12 prayer points: point 6, the prayer for laborers
 *     and shepherds with its scripture references, in the reader's language. packet-strings.json already
 *     carries it, with the book names, in all 11 locales, so no scripture text is newly translated.
 * The loading screen that shows the renderer's progress is MapPrintProgress.vue.
 * Piloted on Simple Research's map; the other maps adopt it after it has been seen.
 */
import { defaultPosterSpec } from '../../constants/posterDefaults.js'

/** The prayer point (1-12) whose references the footer quotes. */
export const MAP_PRINT_POINT = 6

/**
 * The poster spec for a map print. Rendered by useMapPoster, then printed by printImageBlob.
 * @param {{ title: string, subtitle?: string, legendRows?: Array, legendTitle?: string, dir?: 'ltr'|'rtl',
 *           footerLeft?: string, footerRight?: string, attribution?: string }} o
 */
export function mapPrintSpec(o = {}) {
  const spec = defaultPosterSpec({ widthIn: 11, heightIn: 8.5, dpi: 200, orientation: 'landscape' })
  spec.dir = o.dir === 'rtl' ? 'rtl' : 'ltr'
  // The composed sheet: title band, map, legend column, footer (see useMapPoster, layout 'poster').
  spec.layout = 'poster'
  spec.slots.title = { ...spec.slots.title, text: o.title || '', ...(o.subtitle ? { subtitle: o.subtitle } : {}) }
  spec.slots.legend = { ...spec.slots.legend, rows: o.legendRows || [], title: o.legendTitle || '' }
  // No scale bar or north arrow: the headless renderer's are placeholders, and a globe has no single scale.
  spec.slots.scaleBar = false
  spec.slots.north = false
  spec.slots.footer = {
    ...spec.slots.footer,
    left: o.footerLeft || '',
    right: o.footerRight || '',
    ...(o.attribution ? { attribution: o.attribution } : {}),
  }
  return spec
}

/**
 * The footer line in `lang`: the prayer point's heading and its references, with the book names from the same
 * table ("laborers & shepherds — Luke 10:2 · John 10:11–15"). '' when the table has no such point.
 * @param {Object} strings  loadPacketStrings()'s table ({ en, es, …, zh })
 */
export function packetScriptureLine(strings, lang = 'en') {
  const loc = (strings && (strings[lang] || strings.en)) || {}
  const en = (strings && strings.en) || {}
  const points = (Array.isArray(loc.points) && loc.points.length ? loc.points : en.points) || []
  const p = points.find((x) => x && x.n === MAP_PRINT_POINT) || points[MAP_PRINT_POINT - 1]
  if (!p) return ''
  const books = loc.books || {}
  // refSpan's own split (packet-render.js, the points page): the book, then the numbers. In a right-to-left line the
  // en dash of a range is a neutral between two numbers and takes the line's direction, so "10:11–15" printed as
  // "15–10:11". The numbers go in a left-to-right ISOLATE (U+2066 … U+2069); this footer is plain text, not HTML,
  // so the isolation refSpan does with a span is done with the Unicode isolate marks.
  const refs = (p.refs || []).map((r) => {
    const m = String(r).match(/^(.*?)\s+(\d[\d:–\-,; ]*)$/)
    const book = m && books[m[1]]
    return book ? `${book} \u2066${m[2]}\u2069` : String(r)
  })
  // THE WHOLE LINE in a first-strong isolate (U+2068 … U+2069): the footer's SVG text has no direction of its own,
  // so an Arabic line was laid out left to right and the last reference's numbers jumped to its start. FSI takes the
  // direction of the first strong letter: right to left for ar, and en is unchanged.
  const line = [p.sub, refs.join(' · ')].filter(Boolean).join(' — ')
  return line ? `\u2068${line}\u2069` : ''
}
