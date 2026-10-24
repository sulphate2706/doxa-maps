/**
 * mapLabels — name the countries on a generated map sheet in the packet's language, at print time.
 *
 * The map sheets (posters, and the map-only packet page) are generated once, in English: every country
 * on the map is labelled with its English name in capitals. In an Arabic or Chinese packet those labels
 * printed in Latin capitals. Regenerating a sheet per language would multiply the artwork by eleven; so
 * instead the label is recognised on the way into the packet and replaced.
 *
 * ★ RECOGNISED BY THE GENERATOR'S OWN RULE, NOT A HAND-MADE LIST. generate.mjs writes each label as
 * esc(ISO3_NAME[iso3].toUpperCase()), from the ISO3_NAME table in the zone data. Inverting that same
 * table under that same transform gives, for every label the generator can draw, the country it names.
 * The inverse is unambiguous (no two countries share a label), so a label is either known exactly or
 * left alone — never guessed.
 *
 * Pure and zero-import: the caller injects the table, the country-name resolver its runtime can load,
 * and the language, so the browser print and the offline generator run the same code.
 *
 * @param {{iso3Name: Object<string,string>, countryName: (iso3:string, lang:string)=>string, lang: string}} o
 * @returns {null | ((labelText:string) => (string|null))}
 *   null for English — the sheets are already English, and returning no relabeller is what keeps an
 *   English packet's output byte-identical. Otherwise a function from a label as it appears in the
 *   sheet to the localized name, or null for a label it does not know (which is then left as drawn).
 */
export function makeCountryLabelFor({ iso3Name, countryName, lang } = {}) {
  const lc = String(lang || 'en').split('-')[0].toLowerCase()
  if (lc === 'en' || !iso3Name || typeof countryName !== 'function') return null
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const byLabel = new Map()
  for (const [iso3, name] of Object.entries(iso3Name)) byLabel.set(esc(String(name).toUpperCase()), iso3)
  return (labelText) => {
    const iso3 = byLabel.get(String(labelText))
    if (!iso3) return null
    const name = countryName(iso3, lc)
    if (!name || name === iso3) return null
    // Capitals as the sheet draws them, in the language's own casing rules; scripts without case
    // (Arabic, Devanagari, Chinese) come back unchanged.
    return esc(name.toLocaleUpperCase(lc))
  }
}
