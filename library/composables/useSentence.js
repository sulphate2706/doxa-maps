/**
 * useSentence.js — a translated SENTENCE that carries values and markup, as one key.
 *
 * WHY THIS EXISTS. A label is one key; a sentence that interpolates values is also ONE key, because
 * the clause order is part of the translation. The pattern it replaces built a sentence by
 * concatenating translated pieces around untranslated text:
 *
 *   <b>{{ fmt(nNone) }}</b> of {{ fmt(nLang) }} languages have <b><bdi dir="ltr">no scripture…</bdi></b>
 *
 * Every fragment there ("languages have", "of") is a separate string, and Arabic does not put those
 * clauses in that order. Translating the fragments gives Arabic words in English order: grammatically
 * broken, and WORSE than leaving it in English, because it looks translated and nobody re-checks it.
 *
 * HOW. The message is one key with NAMED placeholders — "{nNone} of {nLang} languages have
 * {noScripture}" — so a translator moves the clauses freely. The caller passes a VNode (or a string)
 * per name. The message is rendered with sentinels, split on them, and the slots are dropped back in.
 * Markup therefore SURVIVES without being translated around: the bold numbers and the `dir="ltr"`
 * island are passed in, never spliced into the catalogue string.
 *
 * ★ NO <i18n-t>. This tree has none, and this works with precompiled messages, which is why the
 * sentinel split is used rather than a component: it needs nothing from vue-i18n beyond the string.
 *
 * ★ A MISSING SLOT STAYS VISIBLE. If a name has no value the placeholder is left as written, the
 * same rule fillParams follows and for the same reason: `{nLang}` on screen is a bug someone reports,
 * while "null" or "" reads as content and ships.
 */
import { h } from 'vue'

/**
 * A sentinel that cannot occur in a translated message. U+FFFC is OBJECT REPLACEMENT CHARACTER —
 * Unicode's own "an object goes here" — so a catalogue containing it is already wrong.
 */
// ★ PRIVATE-USE CHARACTERS (U+E000+n), studio's constraint and the safer choice. U+FFFC (OBJECT
// REPLACEMENT CHARACTER) reads better in a dump, but it is a REAL assigned character: anything in the
// i18n pipeline that escapes or normalises message parameters may legitimately touch it, and a
// sentinel that survives everywhere except one build step fails silently and only in one locale.
// U+E000.. is unassigned by definition — nothing may interpret it — so nothing can rewrite it.
// Neither failed under the escaping available in a local test; this follows the build pipeline's
// known behaviour, not a reproduced break.
const MARK_BASE = 0xE000
const mark = (i) => String.fromCharCode(MARK_BASE + i)
const MARK_RE = /[\uE000-\uE0FF]/
const MARK_ALL = /[\uE000-\uE0FF]/g

/**
 * Render a message with slotted values.
 *
 * @param {string} message  the translated sentence, with {named} placeholders
 * @param {Object} slots    name → VNode | string | number
 * @returns {Array} children for a Vue render function / JSX-free template use
 *
 * Text runs are returned as plain strings, so a caller can put them straight into a template with
 * <component :is> or a functional wrapper; the slots keep their own identity as VNodes.
 */
export function sentenceParts(message, slots = {}) {
  const names = []
  // Replace only the names we were GIVEN. An unknown placeholder is left alone so it shows up.
  // ★ STRIP ANY SENTINEL THE MESSAGE ALREADY CARRIES, before placing ours. Private-use characters
  // are unassigned, not impossible — a paste or a bad import can carry one — and a stray that
  // survives into the split is indistinguishable from a slot we placed, so it silently swallows a
  // value. The gate caught this printing 'a X b X'. Removing them first makes every remaining mark
  // ours by construction, which is a stronger guarantee than checking the index afterwards.
  const clean = String(message ?? '').replace(MARK_ALL, '')
  const marked = clean.replace(/\{(\w+)\}/g, (m, k) => {
    // ★ `== null` ONLY, so 0 and '' are VALUES. A count of zero is a real sentence — "0 of 7,296
    // languages have nothing found" is the answer a filter can legitimately produce — and a falsy
    // test would have left {nNone} on screen for exactly the case a reader most needs to trust.
    // Caught by the gate's negative control rather than by review.
    if (slots[k] == null) return m
    names.push(k)
    return mark(names.length - 1)
  })
  const out = []
  let rest = marked
  while (rest) {
    const at = rest.search(MARK_RE)
    if (at < 0) { if (rest) out.push(rest); break }
    if (at > 0) out.push(rest.slice(0, at))
    // ★ ONLY A SENTINEL WE PLACED IS A SLOT. A private-use character already in the message is
    // content: unassigned does not mean impossible, and a paste can carry one. Indexing blindly
    // turned a planted U+E000 into slot 0, so the gate's own stray-sentinel arm printed 'a X b X'
    // — and still passed, because it only asserted the slot was present. Out-of-range marks are
    // passed through as the characters they are.
    out.push(slots[names[rest.charCodeAt(at) - MARK_BASE]])
    rest = rest.slice(at + 1)
  }
  return out
}

/**
 * The same thing as a single element, for a template that wants one node.
 * `tag` defaults to a fragment-like <span> so it inherits the surrounding text styling.
 */
export function sentenceNode(message, slots = {}, tag = 'span') {
  return h(tag, sentenceParts(message, slots))
}

/** A bold value — the shape these sentences use most, so callers do not re-derive it. */
export function strong(value) { return h('b', [String(value)]) }

/**
 * A value that must not be re-ordered by the reader's direction: a resource name, a code, a phrase
 * quoted from an English source. `dir="ltr"` on its own element is what stops it reversing inside an
 * Arabic sentence, and it is passed in rather than written into the catalogue so a translator never
 * has to reproduce the markup.
 */
export function ltr(value, bold = false) {
  const inner = h('bdi', { dir: 'ltr' }, [String(value)])
  return bold ? h('b', [inner]) : inner
}

/**
 * The params to hand `t()` so it returns its message with the placeholders INTACT.
 *
 * ★ WITHOUT THIS THE SENTENCE COMES BACK EMPTY. vue-i18n resolves a message at lookup, so `t('s')`
 * with no params BLANKS every placeholder: measured on 9.14.5, "{nNone} of {nLang} have
 * {noScripture}" returns " of  have " — and sentenceParts then has nothing to split, so the sentence
 * silently loses its values. Passing each name back as its own literal makes t() a no-op over them.
 *
 * Preferred over tm(), which returns the raw string only while messages are compiled at runtime; this
 * works with precompiled messages and with plurals, which is the whole point of the pattern.
 *
 *   const msg = t('charts.noneOfLanguages', keep('nNone', 'nLang', 'noScripture'))
 *   sentenceParts(msg, { nNone: strong(a), nLang: strong(b), noScripture: ltr(c, true) })
 */
export function keep(...names) {
  const out = {}
  for (const n of names) out[n] = '{' + n + '}'
  return out
}
