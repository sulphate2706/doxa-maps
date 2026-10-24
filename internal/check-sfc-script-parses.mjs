#!/usr/bin/env node
/**
 * check-sfc-script-parses.mjs — every .vue script block must actually PARSE.
 *
 * ⚠ IT IMPORTS `@vue/compiler-sfc`, so it needs an INSTALLED node_modules. Unlike its ~20 sibling
 * check:* gates, which use only Node built-ins and therefore run in a bare worktree, this one
 * dies with ERR_MODULE_NOT_FOUND if deps are missing — and it is the FIRST pre-gate to do so, so
 * its failure is what a dependency-less worktree looks like from the build log. Measured
 * 2026-09-24 in wt-packet: `node_modules/` was entirely absent, `bun run build` reported
 * "6/7 pre gates passed — check:sfc-parse FAILED" on a tree with ZERO parse errors, and the real
 * error (`Cannot find package '@vue/compiler-sfc'`) was hidden by the parallel runner.
 * If you see this gate fail with ERR_MODULE_NOT_FOUND, run `bun install --frozen-lockfile` —
 * do NOT chase a parse bug, and do NOT switch the shebang to bun. Switching runtimes only
 * APPEARS to fix it: bun falls back to a global module cache and resolves the import on a tree
 * that has no node_modules at all, so this gate goes green while all 23 bundle builds still fail
 * on `Cannot find package 'vite'`. That is a masked environment fault, not a fix.
 *
 * THE GAP THIS CLOSES. `check:template-literal` catches a stray backtick inside a CSS *comment*
 * within a template literal, but NOT one in LIVE CSS — and a live-CSS backtick breaks the build the
 * same way. Proven both directions on 2026-09-21 (see
 * BUG-TEMPLATE-LITERAL-GATE-MISSES-BACKTICKS-IN-LIVE-CSS): planting `content: \`x\`;` into
 * doxa-simple-map's shadow CSS left check:template-literal at PASS/EXIT=0, while
 * `BUNDLE=doxa-simple-map bun x vite build` died EXIT=1 with a Babel parseSubscripts stack trace
 * pointing far from the edit — the exact misleading error that gate exists to replace.
 *
 * ★ WHY "NOT ACHIEVABLE" WAS ONE STEP TOO STRONG. That card concluded live-CSS detection was not
 * achievable, on solid evidence: THREE lookahead heuristics were tried and reverted, scoring 98 and
 * then 136 false positives on a HEALTHY tree (the real terminator of a template literal is also a
 * backtick, so no window of surrounding characters can separate the two). The evidence was right
 * and the inference over-generalised — "no heuristic works" is not "nothing works." The card itself
 * named the answer in its last line: *needs a tokenizer*. A parser does not guess; it knows where
 * the literal ends, because ending it is what parsing means.
 *
 * ★ MEASURED BEFORE BEING BUILT, against the same tree the heuristics failed on:
 *     lookahead heuristic (pre-fix)   ->  98 false positives
 *     lookahead heuristic (post-fix)  -> 136 false positives
 *     THIS (parse the script block)   ->   0 false positives across 83 .vue files
 *
 * WHY @babel/parser SPECIFICALLY: it is the parser Vite's own pipeline reports errors from, so its
 * verdict matches what actually breaks the build rather than approximating it. @vue/compiler-sfc
 * splits the SFC first, so the check sees exactly the `<script>` / `<script setup>` text the build
 * compiles — no regex extraction, no guessing where a block starts.
 *
 * WHAT IT DOES NOT DO: it is not a linter and takes no view on style. A file either parses as the
 * build will parse it, or it does not. That narrowness is the point — it can never cry wolf, which
 * is what disqualified every heuristic attempt.
 *
 * NEGATIVE-TESTED: planting a backtick in LIVE shadow CSS (the exact case check:template-literal
 * misses) makes this FAIL naming the file and the line; removing it returns PASS. A run that finds
 * fewer than MIN_FILES .vue files FAILS rather than passing vacuously.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as babelParse } from '@babel/parser'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The two authored zones. internal/ and deployment/ hold no .vue sources.
const SCAN = ['plugin-designs', 'library']

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const files = SCAN.flatMap(d => walk(join(ROOT, d)))

// Vacuous guard: "0 files scanned" must never read as "0 problems".
const MIN_FILES = 40
if (files.length < MIN_FILES) {
  console.error(`SFC-PARSE: FAIL — only ${files.length} .vue file(s) found (expected >= ${MIN_FILES}).`)
  console.error('  The walk is broken or the tree is empty. Refusing to pass vacuously.')
  process.exit(1)
}

const broken = []
let parsed = 0, blocks = 0

for (const f of files) {
  const rel = f.replace(ROOT + '/', '')
  const src = readFileSync(f, 'utf8')

  let descriptor, errors
  try { ({ descriptor, errors } = sfcParse(src, { filename: f })) }
  catch (e) { broken.push({ rel, where: 'SFC', msg: String(e.message).split('\n')[0].slice(0, 90) }); continue }

  if (errors && errors.length) {
    broken.push({ rel, where: 'SFC', msg: String(errors[0].message).split('\n')[0].slice(0, 90) })
    continue
  }

  // Both block forms compile in a real build, so both are checked.
  const scripts = [descriptor.script, descriptor.scriptSetup].filter(Boolean)
  let failed = false
  for (const b of scripts) {
    blocks++
    try {
      // jsx is enabled because a .vue script may legitimately contain it; enabling a plugin cannot
      // make invalid code parse, only widen what counts as valid.
      babelParse(b.content, { sourceType: 'module', plugins: ['jsx'] })
    } catch (e) {
      // Babel reports a line within the BLOCK; offset it to the file line so the message is
      // actionable. b.loc.start.line is the line the block's content begins on.
      const m = /\((\d+):(\d+)\)\s*$/.exec(e.message.split('\n')[0])
      const fileLine = m ? (b.loc.start.line + Number(m[1]) - 1) : null
      broken.push({
        rel, where: b === descriptor.scriptSetup ? '<script setup>' : '<script>',
        msg: e.message.split('\n')[0].replace(/\(\d+:\d+\)\s*$/, '').trim().slice(0, 80),
        line: fileLine,
      })
      failed = true
      break
    }
  }
  if (!failed) parsed++
}

console.log(`SFC-PARSE: ${files.length} .vue file(s), ${blocks} script block(s) parsed.`)

if (broken.length) {
  console.error(`\nSFC-PARSE: FAIL — ${broken.length} file(s) do not parse as the build will parse them:`)
  for (const b of broken) {
    console.error(`  ✗ ${b.rel}${b.line ? ':' + b.line : ''}  (${b.where})`)
    console.error(`      ${b.msg}`)
  }
  console.error(
    '\n  The build would fail on these too, but with a stack trace pointing FAR FROM the edit —\n' +
    '  that misleading error is what this gate exists to replace. The commonest cause in this repo\n' +
    '  is a stray backtick inside a shadow-CSS template literal: a backtick ENDS the literal, so\n' +
    '  everything after it is read as code. Write `display:block`, never a backticked form, and\n' +
    '  keep both synced CSS copies identical.'
  )
  process.exit(1)
}

console.log('SFC-PARSE: PASS — every .vue script block parses exactly as the build parses it.')
console.log('  This covers the LIVE-CSS backtick that check:template-literal cannot see (it reads')
console.log('  CSS comments only). Three lookahead heuristics scored 98 and 136 false positives on')
console.log('  this same tree; parsing scores 0, because it never guesses where a literal ends.')
