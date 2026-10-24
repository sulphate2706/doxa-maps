/**
 * useDocumentFont.js — register a self-hosted @font-face at DOCUMENT level, once per page.
 *
 * WHY THIS IS NOT useShadowStyles. @font-face is DOCUMENT-SCOPED: a face declared inside a shadow
 * root is ignored by every engine, so a custom element cannot register its own webfont the way it
 * registers its own CSS. The face has to go in the host document; only then can shadow CSS refer
 * to the family by name. That asymmetry is the whole reason this file exists next to
 * useShadowStyles rather than inside it.
 *
 * WHY A WEBFONT AT ALL (measured 2026-09-24). The regions plugin is an exact clone of DX-life's
 * /regions pages, whose headings are Bebas Neue. We cannot @font-face from their origin — their
 * font file is served without CORS headers, so a cross-origin face silently fails and every
 * heading falls back to a condensed system stack. That substitution was the ONLY difference left
 * between our region dashboard and theirs: 7 computed properties, of which 3 were the family
 * itself and 4 were knock-ons (an uppercase hack to imitate Bebas's caps, and two font-sizes
 * stepped down because a wider fallback face overflowed their card widths). Vendoring the font
 * collapses all 7 and DELETES those workarounds rather than adding more.
 *
 * SELF-HOSTED, NEVER A CDN — the same rule public/assets/vendor/tabulator follows, and the
 * reason the files live under public/assets/fonts with their licence beside them.
 *
 * IDEMPOTENT per page: keyed by family name on document.head, so N elements composing on one page
 * register one face. Safe to call from setup(); no-ops server-side and in any context without a
 * document.
 */

/**
 * @param {string} family      the family name shadow CSS will ask for, e.g. 'Bebas Neue'
 * @param {Array}  faces       [{ src, unicodeRange? }] — src RELATIVE to assetsBase
 * @param {string} assetsBase  where the shared asset tree is served from (profileConfig.assetsBase)
 * @param {object} [opts]      { weight = '400', style = 'normal', display = 'swap' }
 */
export function useDocumentFont(family, faces, assetsBase, opts = {}) {
  if (typeof document === 'undefined' || !family || !faces?.length) return
  const key = 'doxa-font-' + String(family).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  if (document.getElementById(key)) return

  const base = String(assetsBase || './assets').replace(/\/+$/, '')
  const weight = opts.weight || '400'
  const style = opts.style || 'normal'
  const display = opts.display || 'swap'

  const css = faces.map((f) => {
    // Per-face weight, because a real family is several files: Poppins ships 400/500/600/700 and
    // each weight is its own woff2 per subset. A face without its own weight falls back to the
    // call's single weight, so the one-weight callers (Bebas) are unchanged.
    const w = f.weight || weight
    // The unicode-range values are Google's own (css2 API), carried through verbatim so the
    // subset split behaves as it does on their site rather than pulling the larger file always.
    const range = f.unicodeRange ? `  unicode-range: ${f.unicodeRange};\n` : ''
    return `@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n` +
           `  font-weight: ${w};\n  font-display: ${display};\n` +
           `  src: url('${base}/${String(f.src).replace(/^\/+/, '')}') format('woff2');\n${range}}`
  }).join('\n')

  const el = document.createElement('style')
  el.id = key
  el.setAttribute('data-doxa-font', family)
  el.textContent = css
  document.head.appendChild(el)
}

// Bebas Neue, as DX-life serves it: two subsets, Google's own ranges (css2 v16).
export const BEBAS_NEUE_FACES = [
  {
    src: 'fonts/bebas-neue/bebas-neue-latin.woff2',
    unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
      'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, ' +
      'U+FEFF, U+FFFD',
  },
  {
    src: 'fonts/bebas-neue/bebas-neue-latin-ext.woff2',
    unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, ' +
      'U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, ' +
      'U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
]

// Poppins — DX-life's --font-family-base, the body face of every page these components clone.
// Only the four weights the regions surface asks for (measured), latin + latin-ext only, 44 KB.
// Google's own unicode-ranges (css2 v24) so the subset split behaves as it does on their site.
const POPPINS_LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const POPPINS_LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'
// FIGTREE — the free stand-in for Brandon Grotesque, which is COMMERCIAL and must not ship in a
// public giveaway. Chosen by measurement: at 500/19.5312px it renders
// their button text at 126px against Brandon's 128px on live doxa.life, the closest of 19 libre
// grotesques; Inter was +6 and Archivo +7. Weight 500 only — that is the single weight the two
// rules that named Brandon actually use.
export const FIGTREE_FACES = [
  { weight: '500', src: 'fonts/figtree/figtree-500-latin.woff2', unicodeRange: POPPINS_LATIN },
  { weight: '500', src: 'fonts/figtree/figtree-500-latin-ext.woff2', unicodeRange: POPPINS_LATIN_EXT },
]

export const POPPINS_FACES = [
  { weight: '400', src: 'fonts/poppins/poppins-400-latin.woff2', unicodeRange: POPPINS_LATIN },
  { weight: '400', src: 'fonts/poppins/poppins-400-latin-ext.woff2', unicodeRange: POPPINS_LATIN_EXT },
  { weight: '500', src: 'fonts/poppins/poppins-500-latin.woff2', unicodeRange: POPPINS_LATIN },
  { weight: '500', src: 'fonts/poppins/poppins-500-latin-ext.woff2', unicodeRange: POPPINS_LATIN_EXT },
  { weight: '600', src: 'fonts/poppins/poppins-600-latin.woff2', unicodeRange: POPPINS_LATIN },
  { weight: '600', src: 'fonts/poppins/poppins-600-latin-ext.woff2', unicodeRange: POPPINS_LATIN_EXT },
  { weight: '700', src: 'fonts/poppins/poppins-700-latin.woff2', unicodeRange: POPPINS_LATIN },
  { weight: '700', src: 'fonts/poppins/poppins-700-latin-ext.woff2', unicodeRange: POPPINS_LATIN_EXT },
]

// Oswald, as DX-life serves it for CYRILLIC HEADINGS. base/_globals.scss:35-44 switches every
// h1/h2/h3 to --font-family-cyrillic under [lang="ru-RU"], because Bebas Neue has no Cyrillic
// glyphs at all — without the switch a Russian heading leaves the family entirely. Google's own
// unicode-range values (css2 v57), carried verbatim so only the needed subset is fetched; latin and
// latin-ext are included because a Russian heading routinely contains Latin characters and a
// Cyrillic-only face would drop those back to the fallback mid-word.
export const OSWALD_FACES = [
  {
    src: 'fonts/oswald/oswald-400-cyrillic.woff2',
    unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  },
  {
    src: 'fonts/oswald/oswald-400-cyrillic-ext.woff2',
    unicodeRange: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  },
  {
    src: 'fonts/oswald/oswald-400-latin.woff2',
    unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    src: 'fonts/oswald/oswald-400-latin-ext.woff2',
    unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
]
