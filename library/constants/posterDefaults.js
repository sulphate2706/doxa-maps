/**
 * posterDefaults.js — default margins, bleed, slot sizes, and typography
 * used by the poster pipeline.
 *
 * These are reasonable starting values for a 24×36" research poster at
 * 300 DPI. Override per-spec via the PosterSpec passed to useMapPoster().
 *
 * All measurements are in INCHES unless noted. The renderer converts to
 * pixels using the spec's DPI.
 */

export const posterDefaults = {
  dpi: 300,

  // Outside margins (printed area inset from page edge, after bleed).
  margins: {
    top:    0.75,
    right:  0.75,
    bottom: 0.75,
    left:   0.75,
  },

  // Bleed area (pulled outside the trimmed page); 0.125" = 3 mm is industry standard.
  bleed: 0.125,

  // Vertical/horizontal gutter between sections.
  gutter: { in: 0.20 },

  // Title strip across the top of content area.
  title: {
    heightIn: 1.25,
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontWeightTitle: 700,
    fontWeightSubtitle: 500,
    fontSizeTitlePt: 36,
    fontSizeSubtitlePt: 16,
    color: '#0a0a0a',
  },

  // Legend column on the right.
  legend: {
    widthIn: 3.0,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePt: 11,
    swatchSize: 14,    // px (in legend SVG)
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderColor: '#cccccc',
  },

  // Chrome band (scale + north arrow) under the map.
  chromeBand: { heightIn: 0.6 },

  // Scale bar.
  scaleBar: {
    widthIn: 2.5,
    units: 'both',     // 'km' | 'mi' | 'both'
    color: '#111',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },

  // North arrow.
  north: {
    sizeIn: 0.6,
    color: '#111',
  },

  // Footer strip — ALWAYS present (Mapbox attribution requirement).
  footer: {
    heightIn: 0.45,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePt: 10,
    color: '#222',
    // Caller may set left/right text; attribution is enforced by FooterSlot.
    // ★ A FALLBACK OF LAST RESORT, NOT THE ANSWER. useMapPoster reads the credit from the map's
    // LOADED sources (library/maps/map-attribution.js) and overrides this, because under the
    // fleet's MapLibre default Mapbox serves nothing and this line would credit the wrong party.
    // It stays non-empty only so a map that cannot be read still prints something: a licence
    // footer may never be blank.
    attribution: '© Mapbox © OpenStreetMap',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
};

/**
 * Build a default PosterSpec. Caller usually overrides title/legend/etc.
 *
 * @param {{ widthIn: number, heightIn: number, dpi?: number, orientation?: 'portrait'|'landscape' }} size
 * @returns {import('../composables/poster/useMapPoster.js').PosterSpec}
 */
export function defaultPosterSpec(size) {
  return {
    widthIn:  size.widthIn,
    heightIn: size.heightIn,
    dpi: size.dpi || posterDefaults.dpi,
    orientation: size.orientation || (size.heightIn >= size.widthIn ? 'portrait' : 'landscape'),
    margins: { ...posterDefaults.margins },
    bleed:   posterDefaults.bleed,
    slots: {
      title:    { text: 'Untitled', subtitle: '', heightIn: posterDefaults.title.heightIn },
      legend:   { rows: [], type: 'generic', widthIn: posterDefaults.legend.widthIn },
      scaleBar: true,
      north:    true,
      footer:   {
        left:  '',
        right: '',
        attribution: posterDefaults.footer.attribution,
        heightIn: posterDefaults.footer.heightIn,
      },
    },
    renderPath: 'auto',
  };
}
