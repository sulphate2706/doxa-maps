/**
 * embed.js — the Poster Sections panel's choices → the <dxm-poster-section> tags that show them. Pure (no Vue, no
 * DOM), so the page and scripts/check-poster-sections.mjs use the SAME function: what the live sections render is
 * exactly what "Copy embed" hands a website.
 *
 *   choices = { type, scope, scopes, locale, collapsed, columns, assetsBase }
 *     scope ''  = "All regions": one section per scope in `scopes`, in that order
 *     columns 0 = leave it to the wall (no attribute)
 */
export const TAG = 'dxm-poster-section'

export function sectionAttrs(choices) {
  const { type = 'country', scope = '', scopes = [], locale = '', collapsed = false, columns = 0, assetsBase = '' } = choices || {}
  const list = scope ? [scope] : scopes
  return list.map((s) => {
    const a = { type, scope: s }
    if (locale) a.locale = locale
    if (collapsed) a.collapsed = ''
    if (columns) a.columns = String(columns)
    if (assetsBase) a['assets-base'] = assetsBase
    return a
  })
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The text a website pastes: the bundle's script once, then one tag per section. */
export function embedSnippet(choices, scriptUrl) {
  const tags = sectionAttrs(choices).map((a) => `<${TAG}${Object.entries(a).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('')}></${TAG}>`)
  return [`<script src="${esc(scriptUrl)}"></script>`, ...tags].join('\n')
}
