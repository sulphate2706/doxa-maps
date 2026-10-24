#!/usr/bin/env node
/**
 * check-frozen-labels — a label resolved ONCE that never re-resolves when the locale changes.
 *
 * THE DEFECT, and it is created BY FIXING ANOTHER ONE. `const TABS = [{ label: t('…') }]` at
 * module/setup scope evaluates once. ProfileLoader drives appI18n.global.locale at RUNTIME, so a
 * mid-session language switch leaves that label in the boot language while everything around it
 * changes. A computed re-reads on access; a const does not. This is a DIFFERENT defect from
 * hardcoded English with the SAME symptom: hardcoded English never consults the catalogue,
 * a frozen label consults it once and caches. check:hardcoded-english finds the first and cannot
 * see the second — and binding a literal to t() in the wrong scope converts one into the other.
 *
 * tStatic() freezes the same way for a different reason: it reads getRuntimeLocale() AT CALL TIME
 * (library/i18n/index.js), so RE-CALLING it picks up a change; storing its result once does not.
 *
 * ★ PARSED, NOT REGEXED. A regex cannot tell `const X = t('a')` from
 * `const X = computed(() => t('a'))` across a multi-line array. Templates go through
 * @vue/compiler-sfc, scripts through @babel/parser; the test is on the AST.
 *
 * ★ SCOPED BY PROFILE STAGE, NOT BUNDLE STAGE. bundle.stage reads 'production' if ANY profile is,
 * and FOUR bundles are mixed (cities-internet, gospel-resources, my-upg-100-list, regions-dashboard
 * — measured 2026-09-28). A .vue file IS a profile, so the file's own profile.stage is the honest
 * key. Scoping by bundle.stage would FAIL on experimental files in a production bundle.
 *   production profile or library/  -> FAIL (exit 1)
 *   experimental profile            -> REPORTED, never fails
 *
 * ⚠ CANNOT TELL WHETHER A FROZEN LABEL IS RENDERED. A frozen const in dead code is not a
 * user-visible defect; refs= is a reference count, a proxy, not proof it reaches a screen.
 *
 * Deliberately NOT flagged (all re-evaluate, or are pinned on purpose): t() inside a
 * function/arrow/method body, inside computed()/watch()/watchEffect(), in a template expression,
 * and tStatic(path, explicitLocale).
 *
 * NEGATIVE-TESTED: --self-test plants 4 bad shapes it must catch and 6 good ones it must not.
 * Exit 0 clean · 1 a production/library finding · 2 parse error.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
// ★ SHARED WITH check:hardcoded-english (the same file list). Two gates must agree about WHICH files are
// in scope even when they disagree about what they find in them; a second copy would drift on exactly
// the pair-form / transitive / cycle details below, and the drift would be silent.
import { effectiveStages, stageReason } from './lib/effective-stage.mjs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import * as babel from '@babel/parser'

const TRANSLATORS = new Set(['t', 'tStatic', '$t'])
// A call is "reactive" if any ANCESTOR is one of these: the value is recomputed later.
const REACTIVE_WRAPPERS = new Set(['computed', 'watch', 'watchEffect', 'watchPostEffect', 'defineExpose'])

function parseScript(code) {
  return babel.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'topLevelAwait', 'importMeta'],
    errorRecovery: true,
  })
}

/** Walk the AST, tracking whether we are inside a function body or a reactive wrapper. */
function findFrozen(ast, aliases) {
  const out = []
  const visit = (node, parents) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) visit(n, parents); return }
    if (!node.type) return

    if (node.type === 'CallExpression') {
      const callee = node.callee
      const name = callee?.type === 'Identifier' ? callee.name
        : callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier' ? callee.property.name
        : null
      if (name && (TRANSLATORS.has(name) || aliases.has(name))) {
        // tStatic(path, EXPLICIT_LOCALE) — the caller pinned it deliberately.
        const pinned = name === 'tStatic' && node.arguments.length > 1
        // ★ tStatic IS NEVER LIVE, WHEREVER IT SITS (2026-09-28). It resolves the locale via
        // getRuntimeLocale(), which reads a PLAIN window property — not a Vue ref — so a computed()
        // wrapping it has NO reactive dependency and never invalidates. computed(() => tStatic(x))
        // is strictly WORSE than the naked call: it looks like the fix, so nobody looks again.
        // Only a reactive translator (vue-i18n t / useOptionalT) counts as live inside a wrapper.
        // ⚠ BUT A PLAIN FUNCTION BODY STILL RE-RUNS. tStatic inside a function/arrow that a caller
        // INVOKES re-reads the global each call (useOptionalT:74 returns exactly such an arrow), so
        // only a REACTIVE WRAPPER is the lie: computed/watch cache the result and never invalidate.
        const inReactiveWrapper = parents.some((p) =>
          p.type === 'CallExpression' && p.callee?.type === 'Identifier' && REACTIVE_WRAPPERS.has(p.callee.name))
        const neverLive = name === 'tStatic' && !pinned && inReactiveWrapper
        // Inside any function body or reactive wrapper => re-evaluated later.
        const shielded = parents.some((p) =>
          p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' ||
          p.type === 'ArrowFunctionExpression' || p.type === 'ObjectMethod' ||
          p.type === 'ClassMethod' ||
          (p.type === 'CallExpression' && p.callee?.type === 'Identifier' && REACTIVE_WRAPPERS.has(p.callee.name)))
        if ((!shielded || neverLive) && !pinned) {
          // Name the binding it freezes into, when there is one.
          const decl = parents.find((p) => p.type === 'VariableDeclarator')
          out.push({
            line: node.loc?.start.line ?? 0,
            binding: decl?.id?.type === 'Identifier' ? decl.id.name : '(expression)',
            call: name,
          })
        }
      }
    }
    const next = [...parents, node]
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'leadingComments' || k === 'trailingComments') continue
      visit(node[k], next)
    }
  }
  visit(ast.program ?? ast, [])
  return out
}

/** `const t2 = t` / `const { t } = useI18n()` — alias discovery, so a rename cannot hide a call. */
function findAliases(code) {
  const set = new Set()
  for (const m of code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(t|tStatic|useOptionalT\([^)]*\))\s*[;\n]/g)) set.add(m[1])
  for (const m of code.matchAll(/const\s*\{\s*([^}]*)\}\s*=\s*useI18n\(\)/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.split(':').map((s) => s.trim())
      if (orig === 't') set.add(alias || 't')
    }
  }
  return set
}

// ── TWO SHAPES THE SHIELDING RULE ABOVE CANNOT SEE (upg100, both real in their i18n batch) ──────
//
// The rule above treats "inside a function body" as safe, because a function RE-RUNS. That is true
// of the function and false of the label, when nothing calls the function again after the locale
// changes. Both shapes below are frozen labels that the AST walk reports as fine.

/** Names that read the locale REACTIVELY — a watcher on any of these re-runs on a language change. */
const REACTIVE_LOCALE = /\blocale\b|\bpacketLang\b|\buiLocale\b|\beffectiveLocale\b|\bactiveLocale\b/
/** Plain getters: they return today's locale and notify nobody. */
const DEAD_LOCALE_GETTER = /\b(getRuntimeLocale|detectLocale|localeFromUrl)\s*\(/

/**
 * SHAPE 1 — a tree or list built ONCE from t() and stored.
 *
 *   function opts() { return { title: () => t('poster.zone_deaf') } }
 *   onMounted(() => { nodes.value = build(opts()) })          // and nothing re-runs it
 *
 * The t() sits in a function, so the walk above shields it; the RESULT is assigned to a ref and
 * never rebuilt. Flagged only when NO call site of that function sits inside a reactive wrapper or a
 * locale watcher.
 *
 * ⚠ THE WATCHER DOES NOT HAVE TO BE `watch(locale, …)`. upg100's own fix is
 * `watch(() => packetLang(), …)`, where packetLang() reads packetLocale.value — a real reactive
 * source under a local name. A signal that looked for the literal `locale` would have flagged the
 * FIX as the defect, which is the worst thing a gate can do to someone who just did the work.
 */
/**
 * Is offset `at` inside the parentheses of a computed()/watch()/watchEffect() that tracks the locale?
 *
 * ⚠ BRACE DEPTH, NOT A LOOKBACK WINDOW (GOS-FROZEN-SR). The first version of this asked
 * whether a wrapper appeared in the preceding 260 characters. gospel hit exactly this in GiDrawer.vue
 * — the enclosing `computed(` opens at line 35 and the call sites are at 95-100 — and reported SIX
 * false positives on working code, nearly "fixing" it. Measured on the same shape here: 2,600
 * characters between the `watch(` and the call, ten times the window. A window cannot answer a
 * containment question; only matching brackets can.
 *
 * Walks backwards counting bracket depth, so it finds the wrapper that actually ENCLOSES this
 * offset however far above it sits, and cannot be fooled by a closed wrapper that merely precedes it.
 */
function enclosingReactiveWrapper(code, at) {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    const c = code[i]
    if (c === ')' || c === '}' || c === ']') depth++
    else if (c === '(' || c === '{' || c === '[') {
      if (depth > 0) { depth--; continue }
      // an unclosed opener: is it the paren of a reactive wrapper call?
      if (c === '(') {
        const head = code.slice(Math.max(0, i - 40), i)
        const m = /\b(computed|watch|watchEffect)\s*$/.exec(head)
        if (m) {
          // watchEffect always tracks what it reads; watch/computed must name a locale source.
          if (m[1] === 'watchEffect') return true
          const scope = code.slice(i, Math.min(code.length, at))
          if (REACTIVE_LOCALE.test(scope)) return true
        }
      }
    }
  }
  return false
}

function findStoredTreeFreeze(code) {
  const out = []
  // functions whose body calls a translator
  const fns = [...code.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)]
  for (const m of fns) {
    const name = m[1]
    const open = code.indexOf('{', m.index + m[0].length - 1)
    let d = 0, end = open
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') d++
      else if (code[i] === '}') { d--; if (d === 0) { end = i; break } }
    }
    const body = code.slice(open, end + 1)
    // ⚠ "THE BODY MENTIONS t()" IS NOT THE SHAPE. Tested against development: that alone flagged
    // fetchPhotos (an image fetcher), relabelSheet and popupHtml — large functions that call a
    // translator once for an error string or a caption and return something unrelated. Five
    // production files, none of them a label tree. The shape upg100 described is narrower: the
    // function RETURNS A STRUCTURE whose values come from the translator — an options object or a
    // node list — which a caller then stores. So require the translator call to sit inside a
    // returned object/array literal, not merely somewhere in the body.
    // ★ THE MECHANISM IS "BUILT CORRECTLY, THEN PARKED", not "built once at setup" (found on
    // upg100's legendOpts). That function re-reads t() correctly on EVERY call — its own comment
    // says the function shape is deliberate — and the freeze is one level out: the RESULT is
    // assigned into a ref and nothing re-fills it. A rule that only looked for a translator outside
    // a function would miss it entirely, and it is the shape that will recur, because it looks
    // correct at the call site.
    //
    // So: a translator ANYWHERE in the function, plus a returned structure, plus a stored result.
    // The returned-structure test stays because it is what separates a label builder from a
    // fetcher that happens to call t() once for an error string — five production false positives
    // came from dropping it.
    const callsTranslator = /\b(?:t|tStatic|tf)\s*\(\s*['"`]/.test(body)
    const returnsStructure = /return\s*[{[]/.test(body)
    if (!(callsTranslator && returnsStructure)) continue
    // ⚠ A GETTER DEFERS THE READ TO WHOEVER TOUCHES THE PROPERTY, so storing the object is safe —
    // the label resolves on access, not on construction. useDashboardShell builds its segment list
    // exactly this way and says why in its own comment ("a resolved string would freeze the first
    // locale seen"), and the looser rule above flagged that CORRECT code. Same escape hatch the
    // provide() rule uses, for the same reason: what matters is when the read happens.
    if (/\bget\s+[A-Za-z_$][\w$]*\s*\(\s*\)\s*\{/.test(body)) continue
    // every call site of this function, outside its own declaration
    const callRe = new RegExp(`\\b${name}\\s*\\(`, 'g')
    const sites = [...code.matchAll(callRe)].map((x) => x.index).filter((i) => i < m.index || i > end)
    if (!sites.length) continue
    // is ANY call site assigned to a ref/let, and is ANY inside a reactive wrapper or locale watcher?
    let stored = false, live = false
    for (const i of sites) {
      const line = code.slice(code.lastIndexOf('\n', i) + 1, code.indexOf('\n', i))
      if (/\.value\s*=|^\s*(?:let|const)\s+\w+\s*=/.test(line)) stored = true
      if (enclosingReactiveWrapper(code, i)) live = true
    }
    if (stored && !live) {
      const line = code.slice(0, m.index).split('\n').length
      out.push({ line, binding: name, call: 'stored-tree', why: `${name}() builds labels from t() and its result is stored; no call site is inside a locale watcher or reactive wrapper` })
    }
  }
  return out
}

/**
 * SHAPE 2 — a computed whose ONLY locale source is a non-reactive getter.
 *
 *   computed(() => zones.map(z => title(z, getRuntimeLocale())))
 *
 * getRuntimeLocale() reads a plain window property, so the computed has no reactive dependency on
 * the language and resolves once. This is the `neverLive` rule above generalised past tStatic: the
 * getter can be reached through any helper, not only through a translator call.
 */
function findDeadGetterComputed(code) {
  const out = []
  for (const m of code.matchAll(/\b(computed|watchEffect)\s*\(\s*\(\s*\)\s*=>/g)) {
    const open = code.indexOf('{', m.index)
    const paren = code.indexOf('(', m.index + m[0].length - 3)
    // take the arrow body by bracket depth from the wrapper's own opening paren
    const start = code.indexOf('(', m.index + m[1].length)
    let d = 0, end = start
    for (let i = start; i < code.length; i++) {
      if (code[i] === '(') d++
      else if (code[i] === ')') { d--; if (d === 0) { end = i; break } }
    }
    const body = code.slice(start, end + 1)
    if (!DEAD_LOCALE_GETTER.test(body)) continue
    // a reactive read anywhere in the body rescues it: locale.value, t(), or any reactive locale name
    const rescued = /\.value\b/.test(body) || /\b(?:t|tf)\s*\(\s*['"`]/.test(body) || REACTIVE_LOCALE.test(body)
    if (rescued) continue
    out.push({
      line: code.slice(0, m.index).split('\n').length,
      binding: '(computed)',
      call: 'dead-locale-getter',
      why: `${m[1]}() reads the locale only through a plain getter, so it never re-runs on a language change`,
    })
  }
  return out
}

/**
 * SHAPE 3 — labels evaluated inside a provide() literal (GOS-FROZEN-SR; real in GiCombos.vue).
 *
 *   provide('dashboardConfig', { facets: { access_level: { label: T('…') } } })
 *
 * T() runs once at setup, the object goes to the consumer as a plain value, and a live language
 * switch leaves every facet name in the boot language. The fix is a computed reached through a
 * getter, so the consumer re-reads instead of capturing a snapshot.
 *
 * ⚠ THIS IS INVISIBLE TO EVERY PER-STRING CHECK, and that is gospel's point: all ten call sites
 * passed a REAL key and every key resolved in ALL ELEVEN locales. "Is it keyed" and "does the key
 * exist" both answer yes. What was wrong is WHEN the key was read — a lifetime, not a string.
 *
 * A getter (`get facets() { … }`) or a spread of a computed rescues it, because the read is deferred
 * to the consumer.
 */
function findProvideFreeze(code) {
  const out = []
  for (const m of code.matchAll(/\bprovide\s*\(/g)) {
    const start = m.index + m[0].length - 1
    let d = 0, end = start
    for (let i = start; i < code.length; i++) {
      if (code[i] === '(') d++
      else if (code[i] === ')') { d--; if (d === 0) { end = i; break } }
    }
    const body = code.slice(start, end + 1)
    if (!/\b(?:t|T|tStatic|tf)\s*\(\s*['"`]/.test(body)) continue
    // deferred reads are fine: a getter, or a .value read the consumer triggers
    if (/\bget\s+[A-Za-z_$][\w$]*\s*\(\s*\)\s*\{/.test(body)) continue
    if (/\b(computed|watch|watchEffect)\s*\(/.test(body)) continue
    out.push({
      line: code.slice(0, m.index).split('\n').length,
      binding: '(provide)',
      call: 'provided-literal',
      why: 'labels are resolved inside the provide() literal, so the consumer receives a snapshot taken at setup',
    })
  }
  return out
}

export function scanSource(code) {
  const aliases = findAliases(code)
  let ast
  try { ast = parseScript(code) } catch { return [] }
  return [...findFrozen(ast, aliases), ...findStoredTreeFreeze(code), ...findDeadGetterComputed(code), ...findProvideFreeze(code)]
}

export function scanVue(src) {
  const { descriptor } = parseSfc(src)
  const block = descriptor.scriptSetup || descriptor.script
  if (!block) return []
  const offset = src.slice(0, block.loc.start.offset).split('\n').length - 1
  return scanSource(block.content).map((f) => ({ ...f, line: f.line + offset }))
}

// ── SELF-TEST ───────────────────────────────────────────────────────────────
const CASES = [
  ['BAD  const array of t() labels',      () => scanSource("const { t } = useI18n()\nconst TABS = [{ label: t('a.b') }]").length, 1],
  ['BAD  t() straight into a const',      () => scanSource("const { t } = useI18n()\nconst title = t('a.b')").length, 1],
  ['BAD  tStatic() into a const',         () => scanSource("const title = tStatic('a.b')").length, 1],
  ['BAD  through an ALIAS of t',          () => scanSource("const { t } = useI18n()\nconst t2 = t\nconst x = t2('a.b')").length, 1],
  ['GOOD computed(() => t())',            () => scanSource("const { t } = useI18n()\nconst TABS = computed(() => [{ label: t('a.b') }])").length, 0],
  ['GOOD inside a function body',         () => scanSource("const { t } = useI18n()\nfunction f() { return t('a.b') }").length, 0],
  // ── upg100's two shapes: a function-shielded freeze, and a computed with no reactive locale ──
  ['BAD  stored tree, nothing re-runs it',
    () => scanSource("function opts(){ return { title: t('poster.zone_deaf') } }\nonMounted(() => { nodes.value = build(opts()) })").filter((f) => f.call === 'stored-tree').length, 1],
  ['GOOD stored tree + watch(locale)',
    () => scanSource("function opts(){ return { title: t('poster.zone_deaf') } }\nwatch(locale, () => { nodes.value = build(opts()) })").filter((f) => f.call === 'stored-tree').length, 0],
  // ⚠ upg100's OWN FIX watches a locale getter under a local name, not `locale`. A signal that
  // looked for the literal would flag the fix as the defect.
  ['GOOD stored tree + watch(() => packetLang())',
    () => scanSource("function opts(){ return { title: t('poster.zone_deaf') } }\nwatch(() => packetLang(), () => { nodes.value = build(opts()) })").filter((f) => f.call === 'stored-tree').length, 0],
  // ⚠ the false-positive case that five PRODUCTION files hit on the first draft: a big function that
  // calls a translator once for an error string and returns something unrelated.
  ['GOOD fetcher that merely mentions t()',
    () => scanSource("function fetchPhotos(g){ const e = t('no_photo'); return new Map() }\nconst p = fetchPhotos(x)").filter((f) => f.call === 'stored-tree').length, 0],
  // ── gospel (GOS-FROZEN-SR): the wrapper can open FAR above the call site ──────────────────────
  // Their GiDrawer.vue has computed( at line 35 and the call sites at 95-100. A lookback window
  // reported SIX false positives on working code; this fixture is ~2,600 chars between the two.
  ['GOOD watcher opens 40 lines above the call site',
    () => scanSource("function opts(){ return { title: t('poster.zone_deaf') } }\nwatch(() => packetLang(), () => {\n  // padding 0\n  // padding 1\n  // padding 2\n  // padding 3\n  // padding 4\n  // padding 5\n  // padding 6\n  // padding 7\n  // padding 8\n  // padding 9\n  // padding 10\n  // padding 11\n  // padding 12\n  // padding 13\n  // padding 14\n  // padding 15\n  // padding 16\n  // padding 17\n  // padding 18\n  // padding 19\n  // padding 20\n  // padding 21\n  // padding 22\n  // padding 23\n  // padding 24\n  // padding 25\n  // padding 26\n  // padding 27\n  // padding 28\n  // padding 29\n  // padding 30\n  // padding 31\n  // padding 32\n  // padding 33\n  // padding 34\n  // padding 35\n  // padding 36\n  // padding 37\n  // padding 38\n  // padding 39\n  nodes.value = build(opts())\n})").filter((f) => f.call === 'stored-tree').length, 0],
  // ⚠ gospel's model.js:46 matched only because a DOC COMMENT quotes a translator call.
  ['GOOD a doc comment that quotes t()',
    () => scanSource("// returns { title: t('a.b') } for each zone\nfunction opts(){ return { id: 1 } }\nnodes.value = build(opts())").filter((f) => f.call === 'stored-tree').length, 0],
  // ── gospel (GOS-VERIFY): the mechanism is "built correctly, then parked", not "built at setup" ──
  // upg100's legendOpts re-reads t() on every call; the freeze is that its RESULT is assigned to a
  // ref and nothing re-fills it. A rule looking only for a translator OUTSIDE a function misses it.
  ['BAD  strings built above the return, result stored',
    () => scanSource("function opts(){ const s = { a: t('x.y') }; return { title: (z) => s.a } }\nnodes.value = build(opts())").filter((f) => f.call === 'stored-tree').length, 1],
  // ⚠ a GETTER defers the read to the consumer, so storing the object is safe. useDashboardShell
  // builds its segment list this way on purpose; the looser rule above flagged that correct code.
  ['GOOD returned object exposes labels through getters',
    () => scanSource("function seg(){ return [{ k: 'map', get l() { return tStatic('dashboard.map') } }] }\nconst SEG = seg()").filter((f) => f.call === 'stored-tree').length, 0],
  // ── gospel's PATTERN 1, real in GiCombos.vue and still live on development ────────────────────
  // Every call site is keyed and every key resolves in all eleven locales; what is wrong is WHEN
  // they are read. Their fix defers the read to the consumer through a getter.
  ['BAD  labels resolved inside a provide() literal',
    () => scanSource("provide('dashboardConfig', { facets: { access: { label: T('gi.facet.access') } } })").filter((f) => f.call === 'provided-literal').length, 1],
  ['GOOD provide() hands over a getter',
    () => scanSource("const facets = computed(() => ({ access: { label: T('gi.facet.access') } }))\nprovide('dashboardConfig', { get facets() { return facets.value } })").filter((f) => f.call === 'provided-literal').length, 0],
  ['BAD  computed reads only a dead locale getter',
    () => scanSource("const x = computed(() => zones.map(z => title(z, getRuntimeLocale())))").filter((f) => f.call === 'dead-locale-getter').length, 1],
  ['GOOD computed reads locale.value first',
    () => scanSource("const x = computed(() => { const l = locale.value; return zones.map(z => title(z, l || getRuntimeLocale())) })").filter((f) => f.call === 'dead-locale-getter').length, 0],
  ['GOOD inside an arrow',                () => scanSource("const { t } = useI18n()\nconst f = () => t('a.b')").length, 0],
  ['GOOD tStatic with explicit locale',   () => scanSource("const x = tStatic('a.b', 'en')").length, 0],
  ['GOOD watch(() => t())',               () => scanSource("const { t } = useI18n()\nwatch(src, () => t('a.b'))").length, 0],
  // ★ A known false negative: a computed cannot make tStatic live.
  ['BAD  computed(() => tStatic()) is STILL frozen', () => scanSource("const X = computed(() => tStatic('a.b'))").length, 1],
  // A function BODY re-reads the global on every call (useOptionalT:74 returns such an arrow),
  // so it is NOT frozen. Only a reactive wrapper caches it. I had this case backwards at first.
  ['GOOD tStatic in a function body re-runs',        () => scanSource("function f(){ return tStatic('a.b') }").length, 0],
  ['GOOD computed(() => t()) IS live',               () => scanSource("const { t } = useI18n()\nconst X = computed(() => t('a.b'))").length, 0],
  ['GOOD computed(() => tStatic(x, loc)) is pinned', () => scanSource("const X = computed(() => tStatic('a.b', 'en'))").length, 0],
  ['GOOD no translator at all',           () => scanSource("const TABS = [{ label: 'Region' }]").length, 0],
]

if (process.argv.includes('--self-test')) {
  let ok = 0
  for (const [name, run, want] of CASES) {
    let got
    try { got = run() } catch (e) { got = `ERR ${e.message}` }
    const pass = got === want
    console.log(`  ${pass ? '✓' : '✗'} ${name}  -> ${got} (want ${want})`)
    if (pass) ok++
  }
  console.log(ok === CASES.length
    ? `FREEZE-CENSUS SELF-TEST: PASS — ${ok}/${CASES.length}, every rule proven able to fail`
    : `FREEZE-CENSUS SELF-TEST: FAIL — ${ok}/${CASES.length}`)
  process.exit(ok === CASES.length ? 0 : 1)
}

// ── RUN ─────────────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TREE = join(ROOT, `public/${TREE_NAME}`)

// profile.stage per FILE. A .vue under plugin-designs/<bundle>/<profile>.vue IS that profile.
// Anything under library/ is shared by every bundle, so it is held to the production bar.
function stageIndex() {
  const mf = join(TREE, 'manifest.json')
  if (!existsSync(mf)) return null
  const m = JSON.parse(readFileSync(mf, 'utf8'))
  const byFile = new Map()
  for (const b of m.bundles || []) for (const p of b.profiles || []) {
    byFile.set(join('plugin-designs', b.bundle, p.profile + '.vue'), p.stage || b.stage || 'experimental')
  }
  // The manifest itself and the bundle-level effective stage travel with it: the file-level answer
  // needs both, and re-reading the manifest twice would let the two drift apart.
  return { byFile, manifest: m, effStages: effectiveStages(m) }
}

const walk = (dir, acc = []) => {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'public') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(vue|js|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

const idx = stageIndex()
if (!idx) {
  console.log(`FROZEN-LABELS: SKIP — no built tree at public/${TREE_NAME}. Run a build first.`)
  console.log('  Reported as a SKIP, not a pass: a gate that reports success when it never ran is worse than no gate.')
  process.exit(0)
}
const { byFile: stages, manifest, effStages } = idx

const files = ['library', 'plugin-designs'].flatMap((r) => walk(join(ROOT, r)))
const failures = [], reported = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  let hits
  try { hits = f.endsWith('.vue') ? scanVue(src) : scanSource(src) }
  catch (e) { console.error(`FROZEN-LABELS: parse error in ${relative(ROOT, f)} — ${e.message}`); process.exit(2) }
  if (!hits.length) continue
  const rel = relative(ROOT, f)
  // ★ TWO QUESTIONS, BOTH ASKED. A .vue file IS a profile, so its own profile.stage is the precise
  // answer for the FILE — bundle.stage reads 'production' if ANY profile is, and four bundles are
  // mixed (cities-internet, gospel-resources, my-upg-100-list, regions-dashboard), so scoping by
  // bundle alone would FAIL on experimental files inside a production bundle. But profile stage alone
  // UNDER-reports: three experimental bundles are COMPOSED BY production ones (research-dashboard by
  // dashboard-plus-grid, doxa-research-map by research-map-plus-grid, people-groups-grid by both), so
  // a reader sees them on a production page while the file says experimental. Take the stricter of the
  // two: FAIL if the file's own profile is production OR its bundle is production by effective stage.
  const bundleOf = rel.startsWith('plugin-designs/') ? rel.split('/')[1] : null
  const byProfile = rel.startsWith('library/') ? 'production' : (stages.get(rel) || 'experimental')
  const byBundle = bundleOf ? (effStages.get(bundleOf) || 'experimental') : 'production'
  const stage = (byProfile === 'production' || byBundle === 'production') ? 'production' : 'experimental'
  // A widened scope must be able to EXPLAIN itself, or it reads as a bug to whoever it newly fails.
  const why = (stage === 'production' && byProfile !== 'production' && bundleOf)
    ? '  [in scope: ' + stageReason(manifest, bundleOf) + ']'
    : ''
  for (const h of hits) {
    const refs = h.binding === '(expression)' ? -1 : (src.match(new RegExp(`\\b${h.binding}\\b`, 'g')) || []).length - 1
    const row = `${rel}:${h.line}  ${h.binding} (${h.call}) refs=${refs < 0 ? '?' : refs}${why}`
    ;(stage === 'production' ? failures : reported).push(row)
  }
}

for (const r of reported) console.log(`  · ${r}   [experimental — reported, not failing]`)
for (const r of failures) console.log(`  ✗ ${r}   [PRODUCTION]`)
if (failures.length) {
  console.log(`FROZEN-LABELS: FAIL — ${failures.length} label(s) in a PRODUCTION profile or library/ resolve once and never re-resolve on a locale change. Wrap in computed().`)
  process.exit(1)
}
console.log(`FROZEN-LABELS: PASS — 0 in production/library${reported.length ? `, ${reported.length} reported in experimental` : ''}.`)
process.exit(0)
