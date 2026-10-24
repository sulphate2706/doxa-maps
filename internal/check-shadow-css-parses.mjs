#!/usr/bin/env node
// check-shadow-css-parses.mjs — `bun run check:shadow-css-parses`. Source-only, headless, no network.
//
// LINE COMMENTS, NOT A BLOCK COMMENT, and that is not a style preference: this file's own header
// quotes the CSS comment delimiters it exists to reason about, so wrapping it in /* */ ended the
// comment early and the gate would not even parse. A file about a reader getting confused by comment
// delimiters is an apt place to be bitten by one.
//
// Does the CSS we assemble as JS strings actually PARSE as CSS?
//
// THE GAP THIS CLOSES WAS MEASURED, not imagined. In REGLIB batch 1 a line-filtered deletion left 9
// orphaned declarations and braces at 12 open / 21 close in regions-list.vue -- and check:sfc-parse
// PASSED it, because that gate only proves the JS parses, and a broken stylesheet inside a valid
// string literal is still a valid string literal. studio confirmed independently that nothing in the
// tree validates CSS syntax: "check:legend-logical-insets reads declarations and would not notice
// unbalanced braces."
//
// ★ IT USES THE REAL PARSERS, AND THE THREE BUGS THAT FORCED THAT ARE THE POINT OF THIS COMMENT.
// The first version hand-rolled a JS lexer to pull the string literals out, and it was wrong three
// times in a row, each time producing a confident FALSE RED against a file that was fine:
//   1. it read /* CSS comments */ inside the CSS as stranded declarations  -- the reader must speak
//      the language of the text it reads, and this text is CSS, not JS;
//   2. it ran over a whole .vue file, so the apostrophe in GoalCard's prose header ("one caller's
//      feature") opened a phantom string literal and it reported `</div>` from the TEMPLATE as CSS;
//   3. PosterWall.vue:518 has `.replace(/"/g, '&quot;')` -- a REGEX LITERAL CONTAINING A QUOTE, which
//      no hand-rolled scanner can get right without resolving the regex-vs-division ambiguity.
// Three false reds from one shortcut. So the literals now come out of the Babel AST that the build
// itself parses: comments, template literals, regexes and apostrophes all stop being my problem.
// Only the CSS scan below is hand-written, because CSS is the thing actually being checked.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as babelParse } from '@babel/parser'

// Each copy of this repo grades ITS OWN tree: a hardcoded path once made one copy silently grade
// another worktree's files (check:no-abs-paths, 2026-09-24).
const REPO = process.env.DOXA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..')

let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

// ── the script block, via the SFC parser the build uses ─────────────────────────────────────────
function scriptsOf(path, src) {
  if (!path.endsWith('.vue')) return [src]
  const { descriptor } = sfcParse(src, { filename: path })
  return [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean)
}

// ── every useShadowStyles(<css>, label) argument, folded to a string ────────────────────────────
// Returns { css, complete } -- complete:false means part of the argument was an identifier (an
// imported constant), so the text is PARTIAL and must not be scanned as if it were the whole sheet.
function shadowCssOf(script, filename) {
  const ast = babelParse(script, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true })
  const found = []

  // Fold a `'a' + 'b' + IDENT` expression into its literal parts, noting whether any part was not one.
  function fold(node, acc) {
    if (!node) return
    // ★ `endsLiteral` TRACKS THE LAST FRAGMENT, not whether any fragment was readable. A sheet that
    // STARTS with an imported constant (SHADOW_BOX_SIZING_RESET + DXLIFE_TOKENS + '…') is
    // complete:false for the whole string, yet its TAIL is plain text and perfectly judgeable — and
    // that is exactly the shape regions-list shipped its dangling selector in. Gating the
    // dangling-selector arm on `complete` alone suppressed the one bug it was written for, which is
    // what the poison test caught. A trailing CALL (GoalCard's `'.rd-goal ' + strongMedium()`) is
    // the case that genuinely cannot be judged, and that is what this flag distinguishes.
    if (node.type === 'StringLiteral') { acc.css += node.value; acc.endsLiteral = true; return }
    if (node.type === 'TemplateLiteral') {
      if (node.expressions.length) acc.complete = false
      acc.css += node.quasis.map((q) => q.value.cooked ?? '').join('')
      acc.endsLiteral = node.expressions.length === 0
      return
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') { fold(node.left, acc); fold(node.right, acc); return }
    acc.complete = false   // an identifier, a call, a conditional -- not text we can read here
    acc.endsLiteral = false
  }

  ;(function walk(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'CallExpression' && node.callee && node.callee.name === 'useShadowStyles') {
      const acc = { css: '', complete: true, endsLiteral: false }
      fold(node.arguments[0], acc)
      // The style ID (second argument). A plain identifier is the only correct shape: a CSS rule moved
      // past the first argument concatenates onto it ('@media(...){...}doxa-gospel-map'), which is valid
      // JS, keeps the build green and silently loses the rule (a known trap, COMMON.md).
      const lab = { text: '', literal: true, present: !!node.arguments[1] }
      if (node.arguments[1]) { const la = { css: '', complete: true, endsLiteral: false }; fold(node.arguments[1], la); lab.text = la.css; lab.literal = la.complete }
      acc.label = lab
      found.push(acc)
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue
      walk(node[k])
    }
  })(ast.program)
  return found
}

// ── scan a CSS string ───────────────────────────────────────────────────────────────────────────
// CSS comments and quoted values are consumed as their own token types: a /* */ is not a declaration
// and a brace inside content:'a{b' does not open a rule.
function scanCss(cssRaw) {
  let depth = 0, chunk = '', open = 0, close = 0, i = 0
  const orphans = [], emptySelectors = []
  const n = cssRaw.length
  while (i < n) {
    const ch = cssRaw[i]
    if (ch === '/' && cssRaw[i + 1] === '*') {
      i += 2
      while (i < n && !(cssRaw[i] === '*' && cssRaw[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === "'" || ch === '"') {
      const q = ch
      i++
      while (i < n && cssRaw[i] !== q) { if (cssRaw[i] === '\\') i++; i++ }
      i++
      chunk += "''"
      continue
    }
    if (ch === '{') {
      open++
      if (depth === 0 && !chunk.trim()) emptySelectors.push('(empty selector before "{")')
      if (depth === 0 && /;/.test(chunk) && /[A-Za-z-]+\s*:/.test(chunk)) orphans.push(chunk.trim().slice(0, 90))
      depth++; chunk = ''; i++
      continue
    }
    if (ch === '}') { close++; depth = Math.max(0, depth - 1); chunk = ''; i++; continue }
    chunk += ch
    if (depth === 0 && ch === ';' && /[A-Za-z-]+\s*:/.test(chunk)) { orphans.push(chunk.trim().slice(0, 90)); chunk = '' }
    i++
  }
  // ★ A SELECTOR THAT NEVER GETS A BLOCK (2026-09-29). Whatever is left in `chunk`
  // once the scan ends sits at depth 0 after the last '}' — i.e. text that looks like a selector and
  // has no declarations. That is how regions-list.vue shipped
  //     [lang="ru"] .rl-title, [lang="ru-RU"] .rl-title,regions-list
  // for weeks: the author ended the line with a comma instead of a rule, so the concatenation joined
  // the selector list to useShadowStyles' STYLE-ID argument. The Russian heading font was never
  // applied AND the sheet lost its id. Braces stayed balanced (12/12), there was no orphaned
  // declaration and no empty selector, so every existing arm here passed it — this file reported
  // 80/80 green both before and after the fix.
  // Only flagged when it actually looks like a selector: a bare trailing comment or whitespace is
  // normal, and a chunk with no selector-ish character would be noise.
  const tail = chunk.trim()
  const dangling = []
  if (depth === 0 && tail && /[.#\[:a-zA-Z]/.test(tail) && !/^\/\*/.test(tail)) {
    dangling.push(tail.slice(0, 90))
  }
  return { open, close, orphans, emptySelectors, dangling }
}

// ── SELF-TESTS: the scanner must be shown to FAIL on the damage it is meant to catch ────────────
console.log('SELF-TESTS (a scanner that cannot fail proves nothing)')
let r = scanCss('.a{ color:red; } @media (x){ .b{ color:blue; } }')
ok(r.open === r.close && !r.orphans.length, `valid CSS scans clean (${r.open}/${r.close} braces, 0 orphans)`)
r = scanCss('.a{ color:red; }  padding:4px; margin:0; .b{ color:blue; }')
ok(r.orphans.length === 2, `NEG CONTROL: two stranded declarations are caught (found ${r.orphans.length}) -- the exact batch-1 damage`)
r = scanCss('.a{ color:red; } } }')
ok(r.close - r.open === 2, `NEG CONTROL: unbalanced braces are caught (${r.open} open / ${r.close} close)`)
r = scanCss(".a{ content:'a{b'; }")
ok(r.open === 1 && r.close === 1, `NEG CONTROL: a brace inside a quoted CSS value does not unbalance the count (${r.open}/${r.close})`)
r = scanCss('/* padding:4px; a comment that looks like a declaration */ .a{ color:red; }')
ok(!r.orphans.length, 'NEG CONTROL: a CSS comment containing "padding:4px;" is not read as a stranded declaration')
r = scanCss('.a{ background:url(data:image/svg+xml;base64,AA==); }')
ok(r.open === 1 && !r.orphans.length, 'a data: URL with a ; inside url() does not read as an orphan')

// ── the dangling-selector arm, with the EXACT bug it was written for ────────────────────────────
// regions-list.vue shipped `'[lang="ru"] .rl-title, [lang="ru-RU"] .rl-title,' + 'regions-list'`:
// braces balanced 12/12, no orphan, no empty selector — every other arm here passed it, and the
// Russian heading font silently never applied while the style-id was consumed as CSS.
r = scanCss('.a{ color:red; } [lang="ru"] .t, [lang="ru-RU"] .t,regions-list')
ok(r.dangling.length === 1, `NEG CONTROL: a selector list that never gets a { } block is caught (found ${r.dangling.length}) -- the exact regions-list damage`)
r = scanCss('.a{ color:red; } [lang="ru"] .t{ font-weight:500; }')
ok(!r.dangling.length, 'a sheet whose last rule HAS a block is not flagged as dangling')
r = scanCss('.a{ color:red; } /* a trailing comment is normal */')
ok(!r.dangling.length, 'NEG CONTROL: a trailing CSS comment is not read as a dangling selector')
r = scanCss('.a{ color:red; }   ')
ok(!r.dangling.length, 'trailing whitespace is not a dangling selector')

// the three extractor bugs, as regression tests against the files that exposed them
{
  const apostrophe = "<!-- one caller's feature -->\n<script setup>\nuseShadowStyles('.a{ color:red; }', 'x')\n</script>\n<template><div class=\"b\"/></template>"
  const got = scriptsOf('x.vue', apostrophe).flatMap((s) => shadowCssOf(s, 'x.vue')).map((a) => a.css).join('')
  ok(got === '.a{ color:red; }', 'NEG CONTROL: an apostrophe in a .vue prose header cannot leak template text into the CSS')
}
{
  const regexy = "const esc = (v) => String(v).replace(/\"/g, '&quot;')\nuseShadowStyles('.a{ color:red; }', 'x')"
  const got = shadowCssOf(regexy, 'x.js').map((a) => a.css).join('')
  ok(got === '.a{ color:red; }', 'NEG CONTROL: a regex literal containing a quote (PosterWall.vue:518) no longer desynchronises the read')
}
{
  const partial = "import { A } from './a.js'\nuseShadowStyles(A + '.b{ color:red; }', 'x')"
  const got = shadowCssOf(partial, 'x.js')
  ok(got.length === 1 && got[0].complete === false,
    'an argument built partly from an imported constant is reported PARTIAL, not scanned as a whole sheet')
}
{
  // The known trap: a rule moved past the CSS argument concatenates onto the style id
  const trap = "useShadowStyles('.a{ color:red; }', '@media (max-width:1px){ .b{ color:red; } }' + 'doxa-gospel-map')"
  const lab = shadowCssOf(trap, 'x.js')[0].label
  ok(lab.literal && !/^[a-z0-9-]+$/.test(lab.text), 'the style-id arm reads a rule concatenated onto the id as NOT a plain identifier')
  const good = shadowCssOf("useShadowStyles('.a{ color:red; }', 'doxa-gospel-map')", 'x.js')[0].label
  ok(good.literal && /^[a-z0-9-]+$/.test(good.text), 'NEG CONTROL: a plain id passes the style-id arm')
}

// ── the tree ────────────────────────────────────────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  if (statSync(p).isDirectory()) return f === 'node_modules' || f.startsWith('.') ? [] : walk(p)
  return /\.(vue|js)$/.test(f) ? [p] : []
})
const rel = (p) => p.slice(REPO.length + 1)
const files = [...walk(join(REPO, 'library')), ...walk(join(REPO, 'plugin-designs'))].sort()

console.log('\nSHADOW CSS, file by file')
let measured = 0
const partials = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (!src.includes('useShadowStyles(')) continue
  let blocks
  try { blocks = scriptsOf(f, src).flatMap((s) => shadowCssOf(s, f)) }
  catch (e) { console.log(`  FAIL - ${rel(f)}: could not be parsed (${e.message.slice(0, 70)})`); fails++; continue }
  for (const { css, complete, endsLiteral, label } of blocks) {
    // ID arm: a literal style ID must be a plain identifier. A computed one (a variable) is left alone.
    if (label && label.present && label.literal && !/^[a-z0-9-]+$/.test(label.text)) {
      console.log(`  FAIL - ${rel(f)}: useShadowStyles id is not a plain identifier: ${JSON.stringify(label.text.slice(0, 80))}`)
      console.log('         a CSS rule has probably been concatenated onto the id; move it back into the first argument')
      fails++
    }
    if (!/[{}]/.test(css)) { partials.push(f); continue }
    // ★ A PARTIAL ARGUMENT IS STILL SCANNED, and skipping it was a false green waiting to happen.
    // region-dashboards.vue builds its sheet as DXLIFE_TOKENS + SHADOW_BOX_SIZING_RESET + literals,
    // so the first cut of this check classified it PARTIAL and skipped it -- excluding the very file
    // whose CSS I had just cut rules out of, which is the whole reason the check exists. The imported
    // constants are complete rule sets, so the literal remainder must balance on its own; if one ever
    // straddled a rule this would go red and the label below says where to look.
    measured++
    const { open, close, orphans, emptySelectors, dangling } = scanCss(css)
    const note = complete ? '' : ' (literal segments only; imported constants scanned in their own module)'
    // ★ ONLY JUDGE A DANGLING SELECTOR WHEN THE WHOLE STRING IS READABLE. When part of the argument
    // is a call or an identifier (complete:false) the folder cannot see that text, so a trailing
    // ".rd-goal " is simply the prefix before a helper's output — GoalCard composes
    // `'.rd-goal ' + strongMedium()` exactly that way, and my first version reported it as a bug.
    // The brace arms already tolerate incompleteness for the same reason; this one must too.
    const realDangling = endsLiteral ? dangling : []
    if (open !== close || orphans.length || emptySelectors.length || realDangling.length) {
      console.log(`  FAIL - ${rel(f)}: ${open} open / ${close} close brace(s)${note}`)
      for (const o of orphans) console.log(`         orphan declaration: ${o}`)
      for (const e of emptySelectors) console.log(`         ${e}`)
      for (const d of realDangling) console.log(`         SELECTOR WITH NO BLOCK (nothing is applied, and the style-id may have been consumed): ${d}`)
      fails++
    } else {
      console.log(`  ok   - ${rel(f)}: ${open} rule(s), braces balanced, 0 orphans${note}`)
    }
  }
}
ok(measured > 0, `${measured} stylesheet(s) were actually scanned (0 would mean this check measured nothing)`)
if (partials.length) {
  console.log('\n  NO CSS LITERALS AT ALL (the argument is entirely an imported constant):')
  for (const f of [...new Set(partials)]) console.log(`    ${rel(f)}`)
}

console.log(fails ? `\nSHADOW-CSS: ${fails} FAIL(s)` : `\nSHADOW-CSS: ${measured} stylesheet(s) parse as CSS -- braces balanced, no stranded declarations`)
process.exit(fails ? 1 : 0)
