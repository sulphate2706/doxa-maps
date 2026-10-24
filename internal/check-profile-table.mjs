#!/usr/bin/env node
/**
 * check-profile-table — the packet's ~20-per-page profile TABLE: picture | generated localized
 * description | three prayer checkboxes.
 *
 * WHAT THIS GATE CAN AND CANNOT SEE — stated up front, because the limit is the interesting part.
 * It runs in Node with no layout engine, so it asserts the things that are TRUE OF THE MODEL: the
 * geometry closes, every group gets a row, the fit ladder picks the size it claims, the fallback
 * fires in all three states. It CANNOT assert that the rendered row is 73px tall in a browser —
 * that is the browser gate (internal/check-packet-render.mjs, which launches a browser and is exit-75
 * NOT MEASURED anywhere else). A character-count budget is a MODEL of wrapping, not a measurement
 * of it, and the honest place to say so is here rather than in a commit message nobody re-reads.
 *
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const { createPacketRenderer } = await import(resolve(ROOT, 'library/packet/packet-render.js'))
const { describeGroup } = await import(resolve(ROOT, 'library/packets/describeGroup.js'))
const S = JSON.parse(read('library/scripts/posters/packet-strings.json'))

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const CN = () => 'Malaysia'
const describe = (g) => describeGroup(g, 'en', { strings: S, countryName: CN })
const mk = (d) => createPacketRenderer({ strings: S, lang: 'en', describe: d })
const G = (i) => ({ slug: `g${i}`, name: `Group ${i}`, country_code: 'MYS', primary_language_label: 'Abai Sungai', population: 1000, religion: 'Islam', imb_gsec: 1 })

// ── 1. THE GEOMETRY CLOSES ON THE PAGE, AND WITH ZERO SLACK ────────────────────────────────────
// ★ Zero slack is the FINDING, not the reassurance: 20 rows + 19 gutters fill the sheet to exactly
// the bottom margin, so a row that grows by one line does not "use up spare space" — it pushes the
// last row off the sheet. This assertion is what makes the fit ladder load-bearing rather than
// decorative, and it fails loudly if anyone adjusts a constant without re-deriving the rest.
// ⚠ READ THE REAL CONSTANTS, DO NOT RESTATE THEM. An earlier version hardcoded ROWS/M/HEAD here,
// which meant the assertion checked MY arithmetic against MY arithmetic and stayed green when the
// source's ROWS changed — it was the pagination check that caught that mutant, by luck. PER_PAGE is
// exported; the rest come out of the rendered geometry, so this compares the SOURCE to the sheet.
const { PER_PAGE, FD_FIRST, W, H } = mk(describe)
const SRC = read('library/packet/packet-render.js')
const numOf = (re, what) => {
  const m = SRC.match(re)
  if (!m) { fails.push(`could not read ${what} out of packet-render.js — this gate is now measuring nothing`); return NaN }
  return Number(m[1])
}
const M = numOf(/const M = (\d+), HEAD = (\d+)/, 'M')
const HEAD = Number((SRC.match(/const M = \d+, HEAD = (\d+)/) || [])[1])
const GUT = numOf(/const GUT = (\d+)/, 'GUT')
const CH = (H - 2 * M - HEAD - GUT * (PER_PAGE - 1)) / PER_PAGE
// ⚠ "THE ROWS CLOSE ON THE BOTTOM MARGIN" IS A TAUTOLOGY AND IS NOT ASSERTED HERE. CH is DERIVED by
// dividing the usable height by PER_PAGE, so the rows always fill the sheet exactly, for any row
// count — I wrote that assertion first, watched a 21-row mutant sail through it, and removed it.
// An assertion that cannot fail is worse than none: it reads as coverage.
// ★ THE REAL CONSTRAINT IS THE OPPOSITE ONE: rows shrink as they multiply, so the question is
// whether a row is still TALL ENOUGH for its content — the name line plus a two-line description at
// the SMALLEST ladder size. Below that, no ladder step fits and every long row overflows. Verified
// to fire: 20 rows (73px) and 21 rows (69px) pass because the content genuinely fits; 24 rows
// (60px) and 28 fail. That is the boundary this is meant to guard.
// ⚠ THE ROW IS A BORDER-BOX, so its padding and border come OUT of the declared height rather than
// being added to it. A browser check measured 81px against a 73.25px model before `box-sizing:border-box` was
// set — the rows were rendering 7.75px taller than the geometry that positions them, overlapping
// their successors, while the stack still fitted the sheet (ending 8px INSIDE the bottom margin
// rather than on it). Nothing clipped and nothing ran off the page, which is exactly why only a
// MEASUREMENT could find it. Budget against the CONTENT box that survives the chrome.
const ROW_PAD = 6, ROW_BORDER = 1
const CONTENT_H = CH - ROW_PAD - ROW_BORDER
ok(CONTENT_H >= 15 * 1.15 + 2 + 2 * 14 * 1.25,
  `the row's content box is ${CONTENT_H.toFixed(1)}px at PER_PAGE=${PER_PAGE} — too short for a name plus two description lines even at the smallest ladder size, so long rows will overflow onto the row below`)
// ★ AND THE BIGGEST LADDER STEP MUST FIT TOO, not just the smallest. Asserting only the 14px case
// would let the 17px default overflow on every row while the gate stayed green — the ladder's TOP
// is what almost every row actually renders at (all 11 locales fit at 17px today).
ok(CONTENT_H >= 15 * 1.15 + 2 + 2 * 17 * 1.25,
  `the row's content box is ${CONTENT_H.toFixed(1)}px — too short for a name plus two lines at the DEFAULT 17px, which is what nearly every row renders at`)
// The box model itself, asserted in the source: without border-box the declared height is the
// CONTENT box and the row silently renders ${ROW_PAD + ROW_BORDER}px taller than it is positioned for.
ok(/\.card\{[^}]*box-sizing:border-box/.test(SRC),
  'the .card row is not box-sizing:border-box — its padding and border will be ADDED to the declared height, so every row renders taller than the geometry that positions it')

// ── 2. EVERY GROUP GETS A ROW, ACROSS THE PAGE BOUNDARY ────────────────────────────────────────
// ★ THE LOAD-BEARING ONE. A layout rewrite is exactly where people get silently dropped: an
// off-by-one in the slice, or a row that overflows and is clipped, loses a PEOPLE GROUP with no
// error and a page that still looks complete. Asserted at a count that is NOT a multiple of
// PER_PAGE, because a clean multiple hides an off-by-one on the last page.
for (const n of [1, 19, 20, 21, 45, 100]) {
  const R = mk(describe)
  const html = R.listPages({ id: 'z', label: 'Z' }, Array.from({ length: n }, (_, i) => G(i)), new Map()).join('')
  const rows = (html.match(/class="card"/g) || []).length
  ok(rows === n, `${n} groups rendered ${rows} rows — a layout rewrite dropped people`)
  const pages = R.listPages({ id: 'z', label: 'Z' }, Array.from({ length: n }, (_, i) => G(i)), new Map()).length
  // The first page gives its top to the explanation band (2026-10-02) and holds FD_FIRST rows; the rest PER_PAGE.
  const want = 1 + Math.ceil(Math.max(0, n - FD_FIRST) / PER_PAGE)
  ok(Number.isInteger(FD_FIRST) && FD_FIRST > 0 && FD_FIRST < PER_PAGE, `FD_FIRST should be a row count below PER_PAGE, got ${FD_FIRST}`)
  ok(pages === want, `${n} groups made ${pages} pages, expected ${want} (${FD_FIRST} on the first, ${PER_PAGE} after)`)
}

// Each row must carry its three prayer boxes — the packet is a WORKING sheet, and a row without
// them is a reference row the reader cannot mark.
{
  const html = mk(describe).listPages({ id: 'z' }, Array.from({ length: 20 }, (_, i) => G(i)), new Map()).join('')
  ok((html.match(/pray-box/g) || []).length === 60, 'not every row carries three prayer checkboxes')
}

// ── 3. THE FIT LADDER PICKS THE SIZE IT CLAIMS, AND EVERY TIER FIRES ───────────────────────────
// Budgets are recomputed here from the same inputs rather than hardcoded, so this tests the LADDER
// and not my arithmetic twice.
// DESC_W READ FROM THE SOURCE'S OWN INPUTS, not restated: it was a typed 1036 and went stale the moment the tally
// cells widened (PRAY_CELL 84 → 96). The row is the sheet less its margins, the photo, the three tally cells and
// two gutters.
const PRAY_CELL = numOf(/const PRAY_CELL = (\d+)/, 'PRAY_CELL')
const DESC_W = (W - 2 * M) - Math.min(CH - 8, 64) - 3 * PRAY_CELL - GUT * 2, ADV = 0.52, LINES = 2
const budget = (px) => Math.floor(DESC_W / (px * ADV)) * LINES
const probe = (txt) => {
  const html = mk(() => txt).listPages({ id: 'z' }, [G(0)], new Map()).join('')
  const m = html.match(/class="d-tx" style="font-size:(\d+)px">([^<]*)</)
  return m ? { px: +m[1], text: m[2] } : { fallback: /d-fb/.test(html) }
}
const words = (n) => 'word '.repeat(n).trim()
ok(probe(words(10)).px === 17, 'a short description did not render at the full 17px')
ok(probe(words(Math.floor(budget(17) / 5))).px === 17, 'a description just inside the 17px budget stepped down anyway')
// Between the 17px and the 15px budgets, wherever they fall for this row width: '+6 words' was 30 characters, and
// when the tally cells widened the gap between the two budgets shrank to 24, so the probe skipped 15 for 14.
ok(probe(words(Math.floor((budget(17) + budget(15)) / 2 / 5))).px === 15,
  'a description over the 17px budget did not step to 15px')
const long = probe(words(Math.floor(budget(14) / 5) + 40))
ok(long.px === 14, `a very long description did not clamp at the smallest size (got ${long.px}px)`)
ok(long.text.endsWith('…'), 'a clamped description is not marked with an ellipsis')
// ★ THE CUT IS WORD-AWARE. Slicing mid-word reads as a RENDERING FAULT rather than an editorial
// cut — especially inside a people-group's name, where the reader cannot tell a truncation from a
// misspelling of a name they have never seen.
// ⚠ THE INPUT MUST HAVE DISTINCT WORDS. My first version of this check fed `'word '.repeat(n)`,
// and a mid-word cut of identical repeated words is INDISTINGUISHABLE from a word-boundary cut
// ("…word word wor…" vs "…word word…" both look plausible) — the assertion passed against a
// deliberately mid-word-cutting mutant. The words must differ in length so the cut point is
// observable: every retained token is checked against the source vocabulary.
{
  const vocab = ['alpha', 'bravissimo', 'cho', 'delta', 'echoing', 'foxtrotting', 'golf', 'hotelier']
  const text = Array.from({ length: 200 }, (_, i) => vocab[i % vocab.length]).join(' ')
  const cut = probe(text)
  ok(cut.text.endsWith('…'), 'the long-word truncation is not marked')
  const body = cut.text.replace(/…$/, '').trim()
  const tokens = body.split(/\s+/)
  const lastToken = tokens[tokens.length - 1]
  ok(vocab.includes(lastToken),
    `the truncation cut MID-WORD: the final token is ${JSON.stringify(lastToken)}, which is not a whole word from the source — a reader cannot tell this from a misspelling`)
}

// ── 4. THE THREE FALLBACK STATES ───────────────────────────────────────────────────────────────
// `describe` is INJECTED, so it may be absent entirely; and it returns '' for a group whose fields
// cannot form a sentence. Both must degrade to the metadata line, never to a blank cell. Without
// the empty-string branch the table would have shipped blank cells the day describeGroup returned
// '' for a group — which is a real state, not a hypothetical.
{
  const has = (h, c) => new RegExp(`class="${c}"`).test(h)
  const sentence = mk(describe).listPages({ id: 'z' }, [G(0)], new Map()).join('')
  ok(has(sentence, 'd-tx'), 'a describable group did not render its sentence')
  ok(!has(sentence, 'd-fb'), 'a describable group ALSO rendered the metadata fallback — the normal render must not carry a metadata line, or the country prints twice')
  const empty = mk(() => '').listPages({ id: 'z' }, [G(0)], new Map()).join('')
  ok(has(empty, 'd-fb') && !has(empty, 'd-tx'), 'an empty description did not fall back to the metadata line')
  const absent = createPacketRenderer({ strings: S, lang: 'en' }).listPages({ id: 'z' }, [G(0)], new Map()).join('')
  ok(has(absent, 'd-fb'), 'a MISSING describer did not fall back — the packet must not fail to print because one column has no describer')
}

// ── 5. EVERY SHIPPED LOCALE FITS, MEASURED AGAINST THE REAL CATALOGUE ──────────────────────────
// ★ This is the arm that would have caught a locale no reviewer can read by eye. The ladder is INSURANCE, not
// routine: if a real locale is routinely stepping down, the budget is wrong and the fix is the
// budget, not the ladder. Longest today is German at 178 against a 234-char budget.
{
  const base = { name: 'Abai Sungai', country_code: 'MYS', primary_language_label: 'Abai Sungai', imb_gsec: 1 }
  for (const lc of Object.keys(S).filter((k) => k !== '_meta')) {
    let worst = 0
    for (const gsec of [0, 1, 2, 3, 4, 5, 6]) {
      const s = describeGroup({ ...base, imb_gsec: gsec }, lc, { strings: S, countryName: CN })
      if (s.length > worst) worst = s.length
    }
    ok(worst <= budget(17),
      `locale '${lc}' has a ${worst}-char description against a ${budget(17)}-char budget at 17px — it will step down on EVERY row, which means the budget is wrong, not the text`)
  }
}

if (fails.length) {
  console.error('PROFILE-TABLE: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PROFILE-TABLE: PASS — the row is tall enough for a name plus two description lines at the smallest ladder size, every group gets a row across page boundaries, the fit ladder steps 17→15→14 and cuts at a whole word only as a last resort, a missing or empty describer degrades to the metadata line, and every shipped locale fits at full size. NOT covered here: the RENDERED row height and whether the description actually wraps to two lines — those need a browser check.')
