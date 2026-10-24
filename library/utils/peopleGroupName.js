/**
 * peopleGroupName.js — a people group's name in the reader's language, or English if it was machine-translated.
 *
 * The source is assets/pplr/pg-names.json: { locales: [17 codes], names: { <ROP3>: [17 names in that order] } },
 * 21,419 groups. About a third of its rows were MACHINE-TRANSLATED AS WORDS instead of transliterated:
 *   220002 Balantak     fr "Balance"  es "Balanza"  de "Waage"      (scales)
 *   220017 Balo         fr "Sac à dos"  es "Mochila"  de "Rucksack"  (backpack)
 *   220045 Abai Sungai  fr "Ignorer la rivière"  de "Ignoriere den Fluss"
 * A proper name rendered as a dictionary word is worse than English: the reader cannot tell it is wrong.
 *
 * THE GATE, per row. A real transliteration of a proper name stays close to the English spelling in every
 * Latin-script locale; a translated word does not. So each Latin locale's name is compared with the English one
 * (bigram Dice similarity, accents folded). When TWO OR MORE of them fall below 0.5, the row is a translation, and
 * EVERY locale of that group shows English, because the non-Latin names (ar, hi, ru, zh) came from the same
 * process and cannot be checked directly.
 * Measured on the whole table: 8,055 of 21,419 rows (37.6%) are translations, and 117 more have fewer than two
 * Latin names to check, so they are not trusted either: 8,172 (38.2%) show English. Balantak, Balo, Abaga and Abai
 * Sungai fall back; Balangao Bontoc keeps its names. The 0.4-0.5 band (1,406 rows) is about half wrong (Bawaria →
 * "Bavière", Ager → "Agriculteur"), so 0.5 is the safer side: a wrongly kept translation is the worse error.
 *
 * ★ THE ONE-READER RULE. This file is the only code that interprets a pg-names row. A caller fetches the table
 * (it is 7.9 MB, served, never bundled) and passes the row in; check:pg-name-gate fails on any other reader, with
 * pplr-data-maps as the carded exception (its coverage views read the raw rows on purpose).
 *
 * PURE: no fetch, no JSON import, no i18n framework. It takes the locale string the caller already has.
 */

// The Latin-script locales of pg-names.json: the ones whose spelling can be compared with English.
export const LATIN_LOCALES = ['fr', 'pt', 'es', 'tl', 'id', 'de']
export const MIN_SIMILARITY = 0.5
export const MAX_FAR_LOCALES = 1   // two or more far locales → the row is a translation
export const MIN_LATIN_EVIDENCE = 2 // fewer Latin names than this → no evidence either way → English

// The app's locales → pg-names.json's. it and ro have no column, so they show English.
const LOCALE_COLUMN = { en: 'en', es: 'es', fr: 'fr', pt: 'pt', de: 'de', ru: 'ru', ar: 'ar', hi: 'hi', zh: 'zh_CN' }

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')

/** Bigram Dice similarity of two names, 0..1, accents and punctuation ignored. */
export function nameSimilarity(a, b) {
  const x = fold(a), y = fold(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1) } return m }
  const gx = grams(x), gy = grams(y)
  let shared = 0
  for (const [g, n] of gx) shared += Math.min(n, gy.get(g) || 0)
  return (2 * shared) / (x.length - 1 + y.length - 1)
}

/**
 * True when the row's names are transliterations (keep them), false when they were translated as words. A row with
 * fewer than MIN_LATIN_EVIDENCE Latin names cannot be checked (117 rows), so it is NOT trusted: English.
 */
export function isTransliterated(row, locales) {
  if (!Array.isArray(row) || !Array.isArray(locales)) return false
  const en = row[locales.indexOf('en')]
  if (!en) return false
  let far = 0, seen = 0
  for (const l of LATIN_LOCALES) {
    const v = row[locales.indexOf(l)]
    if (!v) continue
    seen++
    if (nameSimilarity(v, en) < MIN_SIMILARITY) far++
  }
  return seen >= MIN_LATIN_EVIDENCE && far <= MAX_FAR_LOCALES
}

/**
 * The name to show for a group: its `lang` name when the row is a transliteration and has that column, else
 * `english`. ★ CALLERS ALWAYS PASS `english` (the record's own name): it is what a fallback shows, and a row the
 * table does not have (row undefined) has no English column to fall back to, so without it the result is ''.
 */
export function peopleGroupName(row, locales, lang, english) {
  const en = english || (Array.isArray(row) && Array.isArray(locales) ? row[locales.indexOf('en')] : '') || ''
  const col = LOCALE_COLUMN[String(lang || 'en').toLowerCase().split(/[-_]/)[0]]
  if (!col || col === 'en' || !isTransliterated(row, locales)) return en
  const v = row[locales.indexOf(col)]
  return (typeof v === 'string' && v.trim()) ? v : en
}

export default { peopleGroupName, isTransliterated, nameSimilarity, LATIN_LOCALES, MIN_SIMILARITY, MAX_FAR_LOCALES, MIN_LATIN_EVIDENCE }
