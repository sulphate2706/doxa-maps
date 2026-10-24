/**
 * useLastWordHighlight.js — their `.highlight` + `data-highlight-last` heading treatment.
 *
 * WHAT IT IS. Every page heading on DX-life's regions surface is
 * `<h1 class="highlight" data-highlight-last>`, and app/composables/useTextHighlight.ts wraps the
 * LAST WORD of that heading in `<span class="color-primary">`. So their titles read with the final
 * word in brand primary:
 *   /regions/africa       -> the whole title green, because "Africa" IS the last word
 *   /regions/middle-east  -> "Middle" in ink, "East" in green
 * MEASURED on the live pages: h1 colour rgb(42,51,42) with an inner span at rgb(146,177,149).
 *
 * ★ HOW IT WAS MISSED. A 68-of-68 computed-style diff of the region page reported no differences
 * while our titles were entirely dark, because the diff compared the h1's fontSize, lineHeight,
 * fontFamily and textAlign — and never its COLOUR, nor the existence of an inner span. The lesson
 * is not "add colour to the list"; it is that a property absent from the spec list is not
 * measured, and unmeasured is not identical.
 *
 * WHY DECLARATIVE AND NOT THEIR DOM WALK. Theirs mutates innerHTML once onMounted and stamps
 * data-highlightProcessed so re-runs are cheap — correct for a Nuxt page whose title never
 * changes. Our heading changes on every selection (chooser -> region -> country), so an
 * imperative one-shot would either fight Vue's re-render or go stale after the first subject.
 * Same logic, expressed where Vue can keep it true: split the words, wrap the last.
 */

/**
 * Split a heading for last-word highlighting.
 * @param {string} text
 * @returns {{ head: string, last: string }} head = everything before the final word (may be ''),
 *          last = the final word. Their split is on any whitespace run, after trimming, so word
 *          boundaries are right regardless of how the template was formatted.
 */
export function splitLastWord(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { head: '', last: '' }
  const last = words[words.length - 1]
  const head = words.slice(0, -1).join(' ')
  return { head, last }
}
