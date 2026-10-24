#!/usr/bin/env node
// check-shadow-style-labels-unique.mjs — `bun run check:shadow-style-labels-unique`. Source-only, headless, no network.
//
// Every useShadowStyles(css, label) call must use its OWN label.
//
// WHY A SHARED LABEL IS A BUG, not a naming nit: useShadowStyles keys its <style> by the label, and when a
// tag with that key is already in the shadow root and its text differs, it OVERWRITES the text (the
// hot-update branch in library/composables/useShadowStyles.js). Two components that share a label and
// mount in one root therefore keep only the LAST one's CSS, silently. The regions list lost its whole
// sheet this way on 2026-09-29: RegionSectionCard.vue, extracted from regions-list.vue, kept the label
// 'regions-list'. The cards mount after the list's fetch, so they overwrote .rl-root/.rl-scroll and the
// list stopped scrolling. It was latent for two days, because the list's own label was being swallowed
// into its CSS by a trailing comma; fixing that comma made the label real and the collision live.
//
// ★ GLOBAL, NOT PER SHADOW ROOT, on purpose. The live defect needs two labels in the SAME root, but proving
// which components can co-mount needs an import graph (aliases, import.meta.glob, dynamic imports), and
// every edge such a resolver misses UNDER-reports — the "0 collisions" false green this gate exists to
// prevent. Both collisions found so far were born the same way: a copy (an extracted component, a forked
// profile) kept its source's label. A global rule catches that at the moment of the copy; a per-root rule
// catches it only once the two happen to co-mount. Compliance costs a one-word rename.
//
// THE OTHER WAYS TWO CALLS END UP WITH ONE KEY, each an arm below:
//   - no label: the key is 'hmr-' + the COMPONENT's HMR id under the dev server (a hash of the CSS in a
//     build), so two unlabelled calls in one component, or one in a composable its caller also makes,
//     share a key in dev;
//   - a label that is fixed while the CSS is not: a wrapper `useX(css) { useShadowStyles(css, 'x') }`, or
//     CSS built from setup(props), gives every caller the same key with different text.
//
// ★ A CALL THE WALK CANNOT SEE MUST NOT READ AS "NO CALL". A hand-rolled scan of this question
// under-reported twice on 2026-09-29, and a first version of this gate cross-checked its AST walk with a
// token scan that used the SAME rule ("the name followed by '('"), so `useShadowStyles?.(…)`, `.call(…)`,
// a rebinding and a re-export slipped past both. So: every REFERENCE to the function (by name or by an
// import alias) must be classified as an import, a call, or the definition, and anything else FAILS; and
// the count of references in Babel's TOKEN stream must equal the count in its AST.
// The parsers are the real ones (the SFC parser and Babel), as in check:shadow-css-parses.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as babelParse } from '@babel/parser'

// Each copy of this repo grades ITS OWN tree (check:no-abs-paths).
const REPO = process.env.DOXA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSABLE = 'library/composables/useShadowStyles.js'
const NAME = 'useShadowStyles'
const FROM_COMPOSABLE = /(^|\/)useShadowStyles(\.js)?$/
const SOURCE_EXT = /\.(vue|js|mjs|cjs|jsx|ts|tsx|mts|cts)$/

// Keys useShadowStyles itself writes. A component using one would overwrite, or be overwritten by, the injector.
const RESERVED = [{ test: (l) => l === 'reduced-motion', why: 'the per-root reduced-motion reset uses this key' },
  { test: (l) => l.startsWith('hmr-'), why: 'dev-server hot-update keys use this prefix' }]

let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

function pluginsFor(lang) {
  if (lang === 'ts' || lang === 'mts' || lang === 'cts') return ['typescript']
  if (lang === 'tsx') return ['typescript', 'jsx']
  return ['jsx']
}

function scriptsOf(path, src) {
  const ext = path.split('.').pop()
  if (ext !== 'vue') return [{ code: src, offset: 0, lang: ext }]
  const { descriptor } = sfcParse(src, { filename: path })
  return [descriptor.script, descriptor.scriptSetup].filter(Boolean)
    .map((b) => ({ code: b.content, offset: b.loc.start.line - 1, lang: b.lang || 'js' }))
}

// Names every identifier a pattern binds (function parameters).
function boundNames(p, out = new Set()) {
  if (!p) return out
  if (p.type === 'Identifier') out.add(p.name)
  else if (p.type === 'AssignmentPattern') boundNames(p.left, out)
  else if (p.type === 'RestElement') boundNames(p.argument, out)
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => boundNames(q.type === 'RestElement' ? q : q.value, out))
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => boundNames(q, out))
  else if (p.type === 'TSParameterProperty') boundNames(p.parameter, out)
  return out
}

// Identifiers READ inside an expression (not property names, not object keys).
function readNames(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => readNames(n, out)); return out }
  if (node.type === 'Identifier') { out.add(node.name); return out }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || /Comments$/.test(k)) continue
    if (k === 'property' && node.type === 'MemberExpression' && !node.computed) continue
    if (k === 'key' && node.type === 'ObjectProperty' && !node.computed) continue
    readNames(node[k], out)
  }
  return out
}

// The token-stream count of references, compared with the AST's. Pure, so the self-tests can show it FAILS.
function referenceCountsAgree(tokens, astStarts, names) {
  let n = 0
  for (const t of tokens) if (t.type && t.type.label === 'name' && names.has(t.value)) n++
  return { agree: n === astStarts.size, tokens: n, ast: astStarts.size }
}

// One file: the calls with their labels, and every problem that stops the file being graded honestly.
function gradeFile(path, src) {
  const blocks = scriptsOf(path, src)
  const parsed = blocks.map((b) => ({ ...b, ast: babelParse(b.code, { sourceType: 'module', plugins: pluginsFor(b.lang), tokens: true }) }))

  // Aliases are collected across BOTH blocks: <script> and <script setup> share their imports.
  const names = new Set([NAME])
  const problems = []
  for (const b of parsed) {
    for (const n of b.ast.program.body) {
      if (n.type === 'ImportDeclaration' && FROM_COMPOSABLE.test(n.source.value)) {
        for (const s of n.specifiers) {
          if (s.type === 'ImportSpecifier' && (s.imported.name || s.imported.value) === NAME) names.add(s.local.name)
          else problems.push(`${path}:${n.loc.start.line + b.offset}: import useShadowStyles BY NAME ({ useShadowStyles }); a default or namespace import hides its calls from this gate`)
        }
      }
      if (n.type === 'ExportAllDeclaration' && FROM_COMPOSABLE.test(n.source.value)) {
        problems.push(`${path}:${n.loc.start.line + b.offset}: re-exports the composable (export *); its callers would call it by another name this gate cannot follow`)
      }
    }
  }

  const calls = []
  for (const b of parsed) {
    const at = (node) => `${path}:${node.loc.start.line + b.offset}`
    const refStarts = new Set()
    const calleeOf = new Set()   // identifiers that are a callee (or a callee's property)
    ;(function walk(node, parent, fnParams) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach((n) => walk(n, parent, fnParams)); return }
      if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.type === 'Import')) {
        const s = node.source || node.arguments[0]
        if (s && s.type === 'StringLiteral' && FROM_COMPOSABLE.test(s.value)) problems.push(`${at(node)}: imports the composable dynamically; import { useShadowStyles } statically so its calls can be graded`)
      }
      if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        const c = node.callee
        const direct = c.type === 'Identifier' && names.has(c.name)
        const member = (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed && c.property.name === NAME
        if (direct || member) {
          calleeOf.add(direct ? c : c.property)
          const args = node.arguments
          let label
          if (args.slice(0, 2).some((a) => a.type === 'SpreadElement')) label = { kind: 'computed', text: '...spread' }
          else {
            const a = args[1]
            if (!a || (a.type === 'Identifier' && a.name === 'undefined') || a.type === 'NullLiteral' ||
              (a.type === 'StringLiteral' && a.value === '') ||
              (a.type === 'TemplateLiteral' && !a.expressions.length && a.quasis[0].value.cooked === '')) label = { kind: 'absent' }
            else if (a.type === 'StringLiteral') label = { kind: 'literal', text: a.value }
            else if (a.type === 'TemplateLiteral' && !a.expressions.length) label = { kind: 'literal', text: a.quasis[0].value.cooked }
            else label = { kind: 'computed', text: b.code.slice(a.start, a.end).slice(0, 60) }
          }
          // A fixed label over CSS that varies per caller: the CSS reads a parameter of an enclosing function.
          const varying = [...readNames(args[0])].filter((n) => fnParams.has(n))
          calls.push({ at: at(node), label, varying })
        }
      }
      if (node.type === 'Identifier' && names.has(node.name)) refStarts.add(node.start)
      let params = fnParams
      if (/Function|Method/.test(node.type) && node.params) {
        params = new Set(fnParams)
        boundNames({ type: 'ArrayPattern', elements: node.params }, params)
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || /Comments$/.test(k)) continue
        walk(node[k], node, params)
      }
    })(b.ast.program, null, new Set())

    // CLASSIFY EVERY REFERENCE. An import specifier, a callee and the composable's own definition are the only
    // positions a reference may take; anything else (rebinding, .call/.apply, a destructured key, a re-export,
    // passing it as a value) is a call this gate cannot follow.
    ;(function classify(node, parent) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach((n) => classify(n, parent)); return }
      const isRef = (node.type === 'Identifier' && names.has(node.name))
      if (isRef && !calleeOf.has(node)) {
        const fine = (parent?.type === 'ImportSpecifier') ||
          (path === COMPOSABLE && parent?.type === 'FunctionDeclaration' && parent.id === node)
        if (!fine) {
          problems.push(`${at(node)}: '${node.name}' is used as ${parent?.type || 'a value'}, not called; this gate can only grade direct calls ` +
            '(a rebinding, .call/.apply, a destructured key, a re-export or a method of that name all hide a call)')
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || /Comments$/.test(k)) continue
        classify(node[k], node)
      }
    })(b.ast.program, null)

    const cc = referenceCountsAgree(b.ast.tokens, refStarts, names)
    if (!cc.agree) problems.push(`${path}: the token stream holds ${cc.tokens} reference(s) to useShadowStyles and the AST ${cc.ast}; the file cannot be graded`)
  }
  return { calls, problems }
}

// Grades a set of { path, src } files. Returns the problems found (empty = pass) and what was measured.
function grade(files) {
  const byLabel = new Map()
  const problems = []
  let calls = 0, absent = 0
  for (const { path, src } of files) {
    if (!/useShadowStyles/.test(src)) continue
    let r
    try { r = gradeFile(path, src) } catch (e) { problems.push(`${path}: could not be parsed (${e.message.slice(0, 80)})`); continue }
    problems.push(...r.problems)
    const unlabelled = r.calls.filter((c) => c.label.kind === 'absent')
    if (unlabelled.length && !path.endsWith('.vue')) {
      problems.push(`${unlabelled.map((c) => c.at).join(' , ')}: an unlabelled call outside a .vue file is keyed by its CALLER's HMR id under the dev server, ` +
        'so it overwrites the caller\'s own unlabelled sheet; give it a label')
    } else if (unlabelled.length > 1) {
      problems.push(`${unlabelled.map((c) => c.at).join(' , ')}: ${unlabelled.length} unlabelled calls in one component share its HMR key under the dev server; label them`)
    }
    for (const c of r.calls) {
      calls++
      if (c.varying.length) {
        problems.push(`${c.at}: the CSS reads ${c.varying.join(', ')}, a parameter of the enclosing function, under one label; ` +
          'every caller (or instance) then shares the key with different CSS. Pass fixed CSS, or give each caller its own label')
      }
      if (c.label.kind === 'absent') { absent++; continue }
      if (c.label.kind === 'computed') {
        problems.push(`${c.at}: the label is computed (${c.label.text}); pass a string literal so its uniqueness can be checked`)
        continue
      }
      const res = RESERVED.find((x) => x.test(c.label.text))
      if (res) problems.push(`${c.at}: label '${c.label.text}' is reserved (${res.why})`)
      if (!byLabel.has(c.label.text)) byLabel.set(c.label.text, [])
      byLabel.get(c.label.text).push(c.at)
    }
  }
  for (const [label, sites] of byLabel) {
    if (sites.length > 1) {
      problems.push(`label '${label}' is used by ${sites.length} calls: ${sites.join(' , ')}\n` +
        '         whichever mounts last in a shadow root overwrites the other\'s CSS; give each call its own label (its file\'s name)')
    }
  }
  return { problems, calls, absent, labels: byLabel.size }
}

// ── SELF-TESTS: the grader must FAIL on the damage it exists to catch, and pass its absence ──────────
console.log('SELF-TESTS (a check that cannot fail proves nothing)')
const f = (path, src) => ({ path, src })
const imp = "import { useShadowStyles } from '@map/composables/useShadowStyles.js'\n"
const sfc = (body) => `<script setup>\n${imp}${body}\n</script>\n<template><div/></template>`
const one = (files, re, m) => { const r = grade(files); ok(r.problems.length === 1 && re.test(r.problems[0]), `${m}${r.problems.length === 1 ? '' : ` (got ${r.problems.length} problems)`}`) }
{
  const r = grade([f('a.js', imp + "useShadowStyles('.a{}', 'aa')"), f('b.vue', sfc("useShadowStyles('.b{}', 'bb')"))])
  ok(!r.problems.length && r.calls === 2, 'distinct labels in two files pass')
}
one([f('list.vue', sfc("useShadowStyles('.rl-root{}', 'regions-list')")), f('Card.vue', sfc("useShadowStyles('.card{}', 'regions-list')"))],
  /'regions-list' is used by 2 calls/, 'NEG CONTROL: the regions-list collision (two .vue files, one label) FAILS')
one([f('a.js', imp + 'useShadowStyles(`\n' + '.x{ color:red; }\n'.repeat(263) + "`, 'research-map')"), f('b.js', imp + "useShadowStyles('.b{}', 'research-map')")],
  /'research-map'/, 'NEG CONTROL: a label 263 lines after its call, after a template literal, is still read')
one([f('a.js', "import { useShadowStyles as inject } from './useShadowStyles.js'\ninject('.a{}', 'dup')"), f('b.js', imp + "useShadowStyles('.b{}', 'dup')")],
  /'dup' is used by 2/, 'NEG CONTROL: a call through an import ALIAS is graded')
one([f('a.vue', `<script>\nimport { useShadowStyles as inject } from './useShadowStyles.js'\n</script>\n<script setup>\ninject('.a{}', 'dup')\n</script>`), f('b.js', imp + "useShadowStyles('.b{}', 'dup')")],
  /'dup' is used by 2/, 'NEG CONTROL: an alias imported in <script> and called in <script setup> is graded')
one([f('a.js', imp + "useShadowStyles?.('.a{}', 'dup')"), f('b.js', imp + "useShadowStyles('.b{}', 'dup')")],
  /'dup' is used by 2/, 'NEG CONTROL: an optional call ?.() is graded')
one([f('a.js', imp + "useShadowStyles('.a{}', `dup`)"), f('b.js', imp + "useShadowStyles('.b{}', 'dup')")],
  /'dup' is used by 2/, 'NEG CONTROL: a template-literal label is read as its text')
one([f('a.js', imp + "useShadowStyles('.a{}', 'dup')\nuseShadowStyles('.b{}', 'dup')")], /'dup' is used by 2/, 'NEG CONTROL: two calls in ONE file with one label FAIL')
one([f('a.js', imp + "const L = 'x'\nuseShadowStyles('.a{}', L)")], /computed/, 'NEG CONTROL: a computed label FAILS (it cannot be checked)')
one([f('a.js', imp + "const args = ['.a{}', 'x']\nuseShadowStyles(...args)")], /computed/, 'NEG CONTROL: spread arguments FAIL as computed, not pass as unlabelled')
one([f('a.js', imp + "useShadowStyles('.a{}', 'reduced-motion')")], /reserved/, 'NEG CONTROL: a reserved key FAILS')
one([f('a.js', imp + "const inject = useShadowStyles\ninject('.a{}', 'x')")], /not called/, 'NEG CONTROL: a rebinding FAILS (the call behind it is invisible)')
one([f('a.js', imp + "useShadowStyles.call(null, '.a{}', 'x')")], /not called/, 'NEG CONTROL: .call() FAILS')
one([f('a.js', "export { useShadowStyles as injectCss } from './useShadowStyles.js'")], /not called/, 'NEG CONTROL: a re-export under another name FAILS')
one([f('a.js', "import * as S from './useShadowStyles.js'\nS.useShadowStyles('.a{}', 'x')")], /BY NAME/, 'NEG CONTROL: a namespace import FAILS')
one([f('a.js', imp + "const o = { useShadowStyles(css) { return css } }\nuseShadowStyles('.a{}', 'x')")], /not called/, 'NEG CONTROL: a method NAMED useShadowStyles is refused, not counted as a call')
one([f('a.js', imp + "export function useX(css) { useShadowStyles(css, 'x') }")], /parameter of the enclosing function/,
  'NEG CONTROL: a wrapper forwarding its caller\'s CSS under one fixed label FAILS')
{
  const r = grade([f('a.js', imp + "const CSS = '.a{}'\nexport function useCard() { useShadowStyles(CSS, 'card') }")])
  ok(!r.problems.length, 'a wrapper injecting FIXED CSS under its label passes (useCardSurface\'s shape)')
}
one([f('a.vue', sfc("useShadowStyles('.a{}')\nuseShadowStyles('.b{}')"))], /2 unlabelled calls in one component/, 'NEG CONTROL: two unlabelled calls in one component FAIL (one dev HMR key)')
one([f('a.js', imp + "useShadowStyles('.a{}')")], /outside a \.vue file/, 'NEG CONTROL: an unlabelled call in a composable FAILS (it takes its caller\'s HMR key)')
{
  const r = grade([f('a.vue', sfc("useShadowStyles('.a{}')")), f('b.vue', sfc("useShadowStyles('.b{}', '')"))])
  ok(!r.problems.length && r.absent === 2, "one unlabelled call per component passes, and '' is read as no label (the runtime's label || …)")
}
{
  const r = grade([f('a.js', imp + "// useShadowStyles('.a{}', 'dup')\nconst s = \"useShadowStyles('.a{}', 'dup')\"\nuseShadowStyles /* why */ ('.b{}', 'dup')")])
  ok(!r.problems.length && r.calls === 1, 'a call in a comment or a string is not a call, and a comment before the ( does not trip the count')
}
{
  const good = referenceCountsAgree([{ type: { label: 'name' }, value: NAME }], new Set([7]), new Set([NAME]))
  const bad = referenceCountsAgree([{ type: { label: 'name' }, value: NAME }, { type: { label: 'name' }, value: NAME }], new Set([7]), new Set([NAME]))
  ok(good.agree && !bad.agree, 'NEG CONTROL: the token-vs-AST reference count FAILS when the two disagree (2 tokens, 1 node)')
}

// ── the tree ─────────────────────────────────────────────────────────────────────────────────────────
// Tracked files plus untracked-but-not-ignored ones: a gitignored local copy (an _archive/ backup of a
// component, keeping its label) must not turn one machine red. Outside a git checkout (DOXA_REPO pointed at
// an exported tree), every source file is read.
function sourceFiles() {
  try {
    const top = execFileSync('git', ['-C', REPO, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (resolve(top) === resolve(REPO)) {
      return execFileSync('git', ['-C', REPO, 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'library', 'plugin-designs'],
        { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter((p) => SOURCE_EXT.test(p))
    }
  } catch { /* not a checkout of its own: walk it */ }
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' || n.startsWith('.') ? [] : walk(p)
    return SOURCE_EXT.test(n) ? [p.slice(REPO.length + 1)] : []
  })
  return [...walk(join(REPO, 'library')), ...walk(join(REPO, 'plugin-designs'))]
}
const files = sourceFiles().sort().flatMap((p) => { try { return [f(p, readFileSync(join(REPO, p), 'utf8'))] } catch { return [] } })

console.log(`\nSHADOW-STYLE LABELS across library/ and plugin-designs/ (${files.length} source files)`)
const r = grade(files)
for (const p of r.problems) console.log(`  FAIL - ${p}`)
fails += r.problems.length
ok(r.calls > 0, `${r.calls} useShadowStyles call(s) graded: ${r.labels} distinct label(s), ${r.absent} unlabelled (0 calls would mean this measured nothing)`)

console.log(fails ? `\nSHADOW-STYLE-LABELS: ${fails} FAIL(s)` : `\nSHADOW-STYLE-LABELS: every one of ${r.calls - r.absent} labelled call(s) has its own label`)
process.exit(fails ? 1 : 0)
