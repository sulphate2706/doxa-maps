// upg-total.js — how many people groups the UPG-100 list covers, from ONE place: the funnel's last step
// (data/people-groups/vision-funnel.json, the same figure the packet's footnote uses). Never write the number into
// a string: the list grows (2,106 was printed in eleven languages after it had become 2,107), so every sentence
// takes it as {n}, formatted for the reader's locale. check:upg-count keeps it that way.
// PURE (no JSON import, so node gates can import it): the .vue callers import the funnel and pass it in.

/** The list's total: the funnel's last step (the whole DOXA set). 0 when the funnel is missing. */
export function upgTotal(funnel) {
  const steps = (funnel && Array.isArray(funnel.steps)) ? funnel.steps : []
  return Number(steps.length ? steps[steps.length - 1].groups : 0) || 0
}

/** A count as the reader writes numbers (2,107 · 2.107 · 2 107), in `numberingSystem` when one is given (٢٬١٠٧). */
export function formatCount(n, locale, numberingSystem) {
  try { return new Intl.NumberFormat(locale || undefined, numberingSystem ? { numberingSystem } : undefined).format(n) } catch (_) { return String(n) }
}

// The non-Western digit system a text already writes its numbers in, or null (Western digits, or none).
const DIGIT_SYSTEMS = [['arab', /[\u0660-\u0669]/], ['arabext', /[\u06F0-\u06F9]/], ['deva', /[\u0966-\u096F]/], ['beng', /[\u09E6-\u09EF]/]]
export function digitSystemOf(text) {
  for (const [nu, re] of DIGIT_SYSTEMS) if (re.test(String(text || ''))) return nu
  return null
}

// ★ ONE SENTENCE, ONE DIGIT SYSTEM. {n} is written in the digits the translated sentence already uses for its own
// numbers. CLDR's default for a bare `ar` is Western (Intl.NumberFormat('ar') gives "2,107"), but the ar wall intro
// writes "٢٧" and "٩:١٤" in Arabic-Indic, so a plain locale format would put "2,107" between them. The sentence is
// rendered once with an empty slot to read its digits, then with the count. Locales whose sentence uses Western
// digits (or none) format exactly as before.
// `tr` is the caller's t(); passing it in keeps this module pure for the node gate.
export function countInSentence(tr, key, n, locale, params = {}) {
  const bare = tr(key, { ...params, n: '' })
  return tr(key, { ...params, n: formatCount(n, locale, digitSystemOf(bare)) })
}

export default { upgTotal, formatCount, digitSystemOf, countInSentence }
