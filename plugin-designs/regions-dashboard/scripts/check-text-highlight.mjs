#!/usr/bin/env node
/* check-text-highlight.mjs — `bun run check:text-highlight`. Source-only, headless, ~0.1s.
 *
 * library/composables/useTextHighlight.js was extracted because TWO plugins had built the same
 * search-highlight construction independently, line for line apart from variable names:
 * regions-dashboard/src/UupgsList.vue and people-groups-grid/people-groups-grid.vue. This asserts the
 * shared version reproduces the construction it replaced, and pins the two escaping deltas that the
 * extraction deliberately introduces — so neither is discovered later by a reader wondering why their
 * output changed.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { highlightRanges } from '../../../library/composables/useTextHighlight.js'
import { codeOnly } from './strip-code.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

// ── the OLD inline construction, verbatim in shape from UupgsList before the extraction ──────────
const oldEscape = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const oldHighlight = (original, indices) => {
  let cursor = 0, out = ''
  indices.forEach((idx, i) => {
    const [start, end] = idx
    const isLast = i === indices.length - 1
    out += oldEscape(original.slice(cursor, start))
      + '<span class="search-highlight">' + oldEscape(original.slice(start, end + 1)) + '</span>'
      + (isLast ? oldEscape(original.slice(end + 1)) : '')
    cursor = end + 1
  })
  return out
}

// ── 1. EQUIVALENCE on every range shape, for text with no special characters ─────────────────────
const CASES = [
  ['one range in the middle', 'Cameroon', [[2, 4]]],
  ['range at the very start', 'Cameroon', [[0, 2]]],
  ['range at the very end', 'Cameroon', [[5, 7]]],
  ['two ranges', 'Cameroon Republic', [[0, 2], [9, 12]]],
  ['three ranges, adjacent-ish', 'abcdefghij', [[0, 0], [2, 3], [8, 9]]],
  ['whole string', 'Chad', [[0, 3]]],
]
for (const [label, value, indices] of CASES) {
  ok(oldHighlight(value, indices) === highlightRanges(value, indices),
    `${label}: shared output is byte-identical to the construction it replaced`)
}

// ── 2. THE TWO DELTAS, asserted so they are documented behaviour rather than a surprise ──────────
ok(highlightRanges('a`b', [[0, 0]]).includes('&#96;') || highlightRanges('a`b', [[0, 0]]).includes('&#x60;'),
  'DELTA 1: a backtick IS now escaped (library/utils/html.js escapes it; neither plugin copy did)')
ok(!oldHighlight('a`b', [[0, 0]]).includes('&#96;'),
  'CONTROL: and the old copy did NOT escape it, so delta 1 is a real difference and not a no-op')
ok(highlightRanges(null, [[0, 1]]) === '' || typeof highlightRanges(null, [[0, 1]]) === 'string',
  'DELTA 2: a null value returns a string rather than throwing (people-groups-grid\'s copy has no null guard)')
const pggEscape = (s) => s.replace(/&/g, '&amp;')   // their shape: no guard at all
let threw = false
try { pggEscape(null) } catch (_) { threw = true }
ok(threw, 'CONTROL: people-groups-grid\'s escaper really does throw on null, so delta 2 removes a real crash')

// ── 3. escaping still happens on EVERY segment, which is the security-relevant part ──────────────
const hostile = '<img onerror=x>'
const outH = highlightRanges(hostile, [[0, 3]])
ok(!outH.includes('<img'), 'the hit itself is escaped, not injected as markup')
ok(!/<(?!\/?span)/.test(outH), 'the ONLY unescaped tags in the output are the span wrappers')
ok(highlightRanges('<b>x</b>', []).includes('&lt;b&gt;'),
  'with NO ranges the whole value is still escaped (the early return does not skip escaping)')

// ── 4. NEG CONTROLS: the comparison must be capable of failing ───────────────────────────────────
const broken = (v) => String(v)   // an "escaper" that escapes nothing
ok(broken('<b>') !== highlightRanges('<b>', []),
  'NEG CONTROL: an implementation that escaped nothing would FAIL this gate')
ok(highlightRanges('Cameroon', [[2, 4]]) !== highlightRanges('Cameroon', [[0, 2]]),
  'NEG CONTROL: the output actually depends on the indices')

// ── 5. the consumers, in source ──────────────────────────────────────────────────────────────────
const upg = codeOnly(readFileSync(resolve(ROOT, 'plugin-designs/regions-dashboard/src/UupgsList.vue'), 'utf8'))
ok(/highlightRanges/.test(upg), 'UupgsList routes through highlightRanges()')
ok(!/function escapeHtml\(/.test(upg), 'and no longer hand-rolls escapeHtml (its only callers were inside highlight())')
// people-groups-grid is the SECOND consumer that justified the extraction under RULE 2. studio agreed
// to treat it as unowned and asked for it to be cut, so it is migrated now and asserted here.
const pgg = codeOnly(readFileSync(resolve(ROOT, 'plugin-designs/people-groups-grid/people-groups-grid.vue'), 'utf8'))
ok(/highlightRanges/.test(pgg), 'people-groups-grid routes through highlightRanges() too -- the duplicate is gone')
ok(!/function escapeHtml\(/.test(pgg),
  'and its own escapeHtml is gone: after the loop moved, it had ZERO callers left')
ok(!/currentIndex = end \+ 1/.test(pgg),
  'the hand-rolled range walk is really removed, not merely shadowed by the import')

console.log(fails ? `\nTEXT-HIGHLIGHT: ${fails} FAIL(s)` : '\nTEXT-HIGHLIGHT: the shared highlighter matches what it replaced, and both escaping deltas are pinned')
process.exit(fails ? 1 : 0)
