#!/usr/bin/env node
// NOTE: GATING — runs FIRST in `build:unlocked`, so a failure here stops the build before any
// bundle is emitted. (This header used to say "advisory only, not wired into the build"; that
// was stale.) It does not yet handle NESTED template literals (${`...`}), which is why
// internal/generate-tree.mjs can false-positive. Also runnable by hand:
//   bun run check:template-literal
/**
 * template-literal-check.mjs — catch the backtick-in-a-template-literal build breaker.
 *
 * WHY THIS EXISTS (it has broken the build twice):
 *   Our shadow-DOM layouts inject their CSS as a JS TEMPLATE LITERAL:
 *       useShadowStyles(`  ...css...  `)          // library/layouts/*.vue
 *       const VTL_SHADOW_CSS = `  ...css...  `
 *   and generate-tree.mjs builds leaf pages the same way. Writing a markdown-style
 *   `code span` inside a CSS comment in one of those strings TERMINATES the string.
 *   The parser then fails far away from the real edit — e.g. a comment at line 246 produced
 *   "Unexpected identifier 'auto'" and, in another run, an error pointing at line 39 — so the
 *   message actively misleads you about where the mistake is.
 *
 * WHAT IT CHECKS
 *   For each guarded file, find every backtick-delimited template literal, then flag a
 *   BACKTICK that appears inside a CSS comment within it. Inside such a string a backtick is
 *   almost always an accidental markdown quote, never intentional CSS.
 *
 * Exits 1 with the file:line so the build stops at the cause instead of a confusing parse error.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// plugin-designs/**/*.vue — enumerated without a glob dep (Node 20 has no fs.globSync).
//
// ★ WAS ONE LEVEL DEEP, AND THAT IS HOW A BREAKAGE GOT THROUGH (2026-09-20)
// This walked only plugin-designs/<bundle>/*.vue, so it saw 30 of the 41 .vue files and NONE of
// the 10 shadow-CSS-injecting components under <bundle>/src/components/. A backtick landed in
// DashboardTopBar.vue's useShadowStyles literal, this check reported PASS, and the build broke
// with Babel's "Identifier directly after number" — exactly the misleading far-away error this
// script exists to replace. The guard was not wrong about its files; it was wrong about WHICH
// files, which is the more dangerous failure because it reports success.
// Recursing costs nothing and makes coverage follow the tree instead of a fixed depth.
function pluginDesignVues() {
  const root = 'plugin-designs'
  if (!existsSync(root)) return []
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(root)
  return out
}

// ★ THE SAME SCOPE BUG, A SECOND TIME — now in the OTHER half of the list (2026-09-22).
// The note above records fixing plugin-designs/ by recursing instead of globbing one level. But
// `library/` stayed a hand-written list of THREE .vue files, and 17 files under library/ carry a
// useShadowStyles(`…`) literal. So a backtick inside a CSS comment in any of the other 14 — e.g.
// library/components/hints/PinHint.vue — passed this gate AND passed check:sfc-parse, and would
// have broken the build later with the far-away Babel error this script exists to replace.
// MEASURED: injecting `LICENCE \`obligation\`` into PinHint.vue's literal left both gates green.
//
// A hand-maintained file list decays silently, because nothing tells you when a new file should
// have been added to it. That is what makes this class worse than a wrong rule: the rule was
// always right, and it was simply never shown the file. Walk the tree instead, so coverage is a
// consequence of where code lives rather than of someone remembering.
function vuesUnder(root) {
  if (!existsSync(root)) return []
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(root)
  return out
}

const FILES = [
  'internal/generate-tree.mjs',
  ...vuesUnder('library'),
  ...pluginDesignVues(),
]

let bad = 0

for (const file of FILES) {
  let src
  try { src = readFileSync(file, 'utf8') } catch { continue }

  // Walk the file tracking whether we are inside a backtick template literal, and inside it,
  // whether we are inside a /* ... */ comment. A backtick while in a comment inside a literal
  // is the bug (it silently closes the literal).
  let inTemplate = false
  let inComment = false   // /* */ inside a template literal
  let inQuote = null      // ' or " — a backtick in here is legitimate (e.g. an error message)
  let inLineComment = false
  // ★ HTML COMMENTS (2026-09-21). 13 of our .vue files OPEN with a <!-- ... --> block whose prose
  // uses markdown backticks (e.g. "the `title` prop"). The scanner had no notion of them, so every
  // one of those backticks TOGGLED inTemplate and its state was scrambled before it ever reached
  // real code. That latent desync is why a first attempt to widen this gate to live CSS produced
  // 98 FALSE POSITIVES on a clean tree. Skipping HTML comments is the upstream fix.
  let inHtmlComment = false
  let line = 1

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]

    if (c === '\n') { line++; inLineComment = false; continue }
    if (src[i - 1] === '\\') continue // escaped char — skip

    // HTML comments FIRST — they wrap prose, and prose backticks must never touch our state.
    // Only honoured OUTSIDE a template literal: a "<!--" inside CSS is not a comment opener there.
    if (!inTemplate && !inQuote && !inHtmlComment && c === '<' && src.startsWith('<!--', i)) {
      inHtmlComment = true; i += 3; continue
    }
    if (inHtmlComment) {
      if (c === '-' && src.startsWith('-->', i)) { inHtmlComment = false; i += 2 }
      continue
    }

    // A // line comment outside a template literal: skip to end of line.
    if (!inTemplate && !inQuote && !inLineComment && c === '/' && next === '/') { inLineComment = true; i++; continue }
    if (inLineComment) continue

    // Quoted strings OUTSIDE a template literal may legitimately contain backticks.
    if (!inTemplate && !inComment) {
      if (inQuote) { if (c === inQuote) inQuote = null; continue }
      if (c === '\'' || c === '"') { inQuote = c; continue }
    }

    // Block comments — tracked BOTH inside and outside a template literal.
    //
    // Tracking them only INSIDE was the false-positive bug (found 2026-09-20): a module-level
    // JSDoc block such as
    //     /** Read instances declared in a `*.instances.json` next to a profile's .vue ... */
    // contains ordinary prose backticks. Left unskipped, each one TOGGLED inTemplate, so the
    // scanner's idea of "am I in a template literal" desynchronized from reality and it reported
    // safe JSDoc at generate-tree.mjs:696 as a build-breaking bug. Backticks in a comment OUTSIDE
    // a template literal are harmless documentation markup — only ones INSIDE a literal close it.
    if (!inComment && c === '/' && next === '*') { inComment = true; i++; continue }
    if (inComment && c === '*' && next === '/') { inComment = false; i++; continue }
    // Inside a comment that is NOT inside a template literal, nothing can break the build.
    if (inComment && !inTemplate) continue

    if (c === '`') {
      if (inTemplate && inComment) {
        console.error(
          `TEMPLATE-LITERAL: ${file}:${line} — a backtick inside a CSS comment within a template literal.\n` +
          `  This CLOSES the string and breaks the build with a misleading error elsewhere.\n` +
          `  Fix: write the term WITHOUT backticks (e.g. display:block, not \`display:block\`).`
        )
        bad++
        inComment = false // keep scanning for more
        continue
      }
      inTemplate = !inTemplate
      inComment = false
    }
  }
}

if (bad) {
  console.error(`\nTEMPLATE-LITERAL: FAIL — ${bad} offending backtick(s). Remove them and re-run.`)
  process.exit(1)
}
// ★ PRINT THE COVERAGE NUMBER, always — not decoration.
// This guard reported PASS while scanning 30 of 41 .vue files (it walked only one level deep, missing
// every shadow-CSS component under <bundle>/src/components/). A backtick landed in one of the 11 it
// could not see and the build broke with Babel's misleading "Identifier directly after number".
// A visible count makes a coverage gap noticeable BEFORE it breaks something: if this number stops
// tracking the repo's real .vue count, the guard's scope has drifted even though it still says PASS.
// The general rule (three gates hit it in one session): a gate can be correct about its LOGIC and
// wrong about its INPUT SET, and that failure mode reports SUCCESS.
console.log(
  `TEMPLATE-LITERAL: PASS — no stray backticks inside template-literal CSS comments ` +
  // Counts are DERIVED, not hardcoded. The previous label said "+ 4 library/internal" because the
  // library side used to be a hand-written list of exactly four paths; after that list became a
  // tree walk the constant would have under-reported coverage by 36 files while sounding precise.
  // A number in a status line is documentation, and documentation drifts — compute it.
  `(checked ${FILES.length} file(s): ${FILES.filter((f) => f.startsWith('plugin-designs')).length} under ` +
  `plugin-designs + ${FILES.filter((f) => f.startsWith('library')).length} under library + ` +
  `${FILES.filter((f) => f.startsWith('internal')).length} internal).`
)
