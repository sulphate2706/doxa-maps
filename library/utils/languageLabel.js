/**
 * languageLabel.js — turn the API's comma-inverted language label into the natural reading.
 *
 * The pray-tools API returns primary_language.label in an INDEX ordering, surname-first:
 * "Arabic, Shihhi" where a reader expects "Shihhi Arabic". It is the ordering a printed language
 * catalogue uses so that every Arabic variety files together, and it is wrong in a sentence.
 * 725 of the 12,379 rows carry one (measured on data/people-groups/people_groups.csv, LanguageName,
 * the same vocabulary), so this is not an edge case: it is one row in seventeen.
 *
 * ★ THE SPLIT IS PARENTHESIS-AWARE, AND THAT IS THE WHOLE REASON THIS IS A MODULE. 13 names carry a
 * comma INSIDE a parenthetical -- "Boano (Indonesia, Central Sulawesi)", "Kango (DRC, Tshopo district)",
 * "Mari (PNG, Madang Province)". A naive label.split(',') reverses those into
 * "Central Sulawesi) Boano (Indonesia": unbalanced, unreadable, and printed. The comma in those names
 * is not an inversion marker, it separates a disambiguating region, so only a TOP-LEVEL comma counts.
 *
 * ★ THIS IS HARMLESS IN A LOOKUP AND FATAL IN A SENTENCE, which is why the rule lives here rather than
 * staying where it was. useLanguageFamilyLegendData built the same reversal to produce a KEY for
 * langFamilyByLanguage, where a garbage candidate simply misses and the next one is tried -- the
 * corruption never reaches a reader. describeGroup interpolates the result into printed prose, where
 * there is no such safety net. Both now split through splitLanguageLabelParts so the two cannot drift.
 */

/**
 * Split a label on its TOP-LEVEL commas — commas inside parentheses are text, not separators.
 * "Arabic, Shihhi" -> ['Arabic', 'Shihhi'];  "Boano (Indonesia, Central Sulawesi)" -> one part.
 * @param {string} label
 * @returns {string[]} trimmed, empty parts dropped ("Kango (DRC, , Bas-Uélé district)" is real data)
 */
export function splitLanguageLabelParts(label) {
  if (!label || typeof label !== 'string') return []
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of label) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts.map((s) => s.trim()).filter(Boolean)
}

/**
 * The natural reading of a language label, for display.
 * Un-inverted when the label is inverted; returned unchanged when it is not, so it is safe to call on
 * any label from any source. A trailing parenthetical stays at the END, where it qualifies the whole
 * name: "Naga, Tangkhul (India)" -> "Tangkhul Naga (India)", not "Tangkhul (India) Naga".
 * @param {string} label
 * @returns {string} '' for a missing or non-string label
 */
export function naturalLanguageLabel(label) {
  if (!label || typeof label !== 'string') return ''
  const parts = splitLanguageLabelParts(label)
  if (parts.length < 2) return label.trim()
  const last = parts[parts.length - 1]
  const paren = last.match(/\s*(\(.*\))$/)
  if (paren) parts[parts.length - 1] = last.slice(0, paren.index).trim()
  const reversed = parts.filter(Boolean).reverse().join(' ')
  return paren ? `${reversed} ${paren[1]}` : reversed
}

export default naturalLanguageLabel
