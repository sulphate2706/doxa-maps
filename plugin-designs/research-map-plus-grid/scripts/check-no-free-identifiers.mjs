#!/usr/bin/env node
/**
 * check-no-free-identifiers.mjs — an SFC must not reference a name it never bound.
 *
 * ★ THE DEFECT THIS EXISTS FOR, AND I SHIPPED IT. Editing two composites with a pattern-match
 * script, I replaced an import line by matching text that had already changed, so the replacement
 * silently matched nothing and three names — RTL_LOCALES, getRuntimeLocale, detectLocale — were
 * used but never imported. Both composites threw a ReferenceError in setup and rendered NOTHING on
 * main until a hotfix landed.
 *
 * It passed every gate. It compiled, because a free identifier is perfectly valid JavaScript until
 * it RUNS. It passed a grep of the built bundle for the new code, because the code was there. It
 * passed template-literal, sfc-parse, freshness and SRI, because not one of them evaluates a setup
 * function. The evidence I had could not tell a working composite from a dead one, and I called it
 * "verified headless" anyway.
 *
 * So this reads what the compiler reads and asks the one question those gates cannot: is every name
 * this file USES actually BOUND somewhere — imported, declared, a parameter, or a known global?
 * No browser, no mount, milliseconds per file. It is the cheap half of the pair; the browser lane's
 * check:composites-mount is the expensive half that proves the thing actually runs.
 *
 * SCOPE: every .vue under plugin-designs/ and library/ — fleet-wide, because the mistake was a
 * text-edit habit rather than anything about one plugin.
 *
 * HOW IT AVOIDS CRYING WOLF. It tracks real scopes (module, function, block, catch, class), so a
 * name bound in a nested function is not reported at the top. It ignores non-computed property
 * names, labels, and the declaration side of imports and destructuring. Vue's compiler macros and
 * the browser/node globals this tree actually uses are listed below, by name, where a reader can
 * see and argue with them — an allowlist that is a regex is an allowlist nobody can audit.
 *
 * Exit: 0 clean · 1 at least one free identifier · 2 could not parse (reported, not silent).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSFC } from '@vue/compiler-sfc'
import * as acorn from 'acorn'

const TAG = 'NO-FREE-IDENTIFIERS'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// internal/ too, and .mjs files (below): 30 browser gates gained `const ROOT = …(_fileURLToPath(…))` in one
// commit, and the two that never imported it crashed on load for four days, because they run only by hand.
// A free identifier at module scope is the same defect in a Node script as in an SFC.
const ROOTS = ['plugin-designs', 'library', 'internal']

// Vue's <script setup> compiler macros: real bindings the compiler provides, not free names.
const VUE_MACROS = [
  'defineProps', 'defineEmits', 'defineExpose', 'defineOptions', 'defineModel',
  'defineSlots', 'withDefaults', 'useSlots', 'useAttrs', 'useTemplateRef', 'useId',
]
// Globals this tree actually uses. Listed by name so the list can be read and argued with.
const GLOBALS = [
  'globalThis', 'window', 'document', 'navigator', 'location', 'history', 'screen',
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol',
  'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Proxy', 'Reflect', 'BigInt',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Infinity', 'NaN', 'undefined',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'structuredClone', 'queueMicrotask', 'crypto', 'atob', 'btoa',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'TextEncoder', 'TextDecoder',
  'Event', 'CustomEvent', 'EventTarget', 'MessageChannel', 'BroadcastChannel',
  'IntersectionObserver', 'DOMException', 'createImageBitmap', 'ResizeObserver', 'MutationObserver', 'PerformanceObserver', 'performance',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'Element', 'Node', 'NodeList', 'DOMParser',
  'Path2D', 'OffscreenCanvas', 'ImageData',   // canvas built-ins (the Wall draws its icons with Path2D)
  'Image', 'Audio', 'Intl', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt',
  'localStorage', 'sessionStorage', 'devicePixelRatio', 'innerWidth', 'innerHeight',
  'process', 'Buffer', '__dirname', '__filename', 'require', 'module', 'exports',
  // Map engines and their plugins arrive as globals from a <script> tag, by design.
  'mapboxgl', 'maplibregl', 'MapboxGeocoder', 'MaplibreGeocoder', 'turf', 'html2canvas', 'jspdf', 'd3',
  // More of the standard library and DOM than the first draft listed — every one of these was found
  // by RUNNING this gate over the tree and reading what it flagged, which is the only way an
  // allowlist gets honest.
  'Function', 'customElements', 'ShadowRoot', 'ShadowRoot', 'CSS', 'self', 'Uint8Array', 'Uint16Array',
  'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer',
  'DataView', 'WeakRef', 'FinalizationRegistry', 'ClipboardItem', 'CSSStyleSheet', 'XMLSerializer',
  // Build-time defines: vite REPLACES these before the browser ever sees them (vite.config.js
  // `define`), so they are bound by the bundler rather than by the file.
  '__DOXA_TREE_NAME__', '__DOXA_QA__', '__DOXA_SHARE_BASE__',
  // Bound by the build too, but by a transform rather than `define`: with DX_SHIP_ONE_LOCALE the
  // i18nAreasPlugin prepends `const __DX_LOCALE_SRI__ = {…}` to library/i18n/index.js; without it the
  // name does not exist, which is why its one read sits behind `typeof … !== 'undefined'`.
  '__DX_LOCALE_SRI__',
  // Standard globals the first lists missed, found by extending the scan to internal/*.mjs: eval and
  // EvalError; Bun in scripts `bun` runs; and window members used inside page.evaluate() callbacks,
  // which run in the browser, not in Node.
  'eval', 'EvalError', 'Bun', 'scrollX', 'scrollY', 'scrollTo', 'Storage',
]
const PRELUDE = new Set([...VUE_MACROS, ...GLOBALS])

// ── scope tracking ───────────────────────────────────────────────────────────────────────────────
class Scope {
  constructor(parent, kind) { this.parent = parent; this.kind = kind; this.names = new Set() }
  declare(name) { if (name) this.names.add(name) }
  has(name) { return this.names.has(name) || (this.parent ? this.parent.has(name) : false) }
}

const isFn = (t) => t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression'

/** Every name a binding PATTERN introduces (destructuring, defaults, rest). */
function patternNames(node, out = []) {
  if (!node) return out
  switch (node.type) {
    case 'Identifier': out.push(node.name); break
    case 'ObjectPattern': for (const p of node.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out); break
    case 'ArrayPattern': for (const e of node.elements) patternNames(e, out); break
    case 'AssignmentPattern': patternNames(node.left, out); break
    case 'RestElement': patternNames(node.argument, out); break
  }
  return out
}

/** Hoist the declarations a scope owns, before walking its body — `foo()` above `function foo` is legal. */
function hoist(body, scope, { fnScope }) {
  for (const n of body || []) {
    if (!n) continue
    if (n.type === 'FunctionDeclaration' && n.id) scope.declare(n.id.name)
    else if (n.type === 'ClassDeclaration' && n.id) scope.declare(n.id.name)
    else if (n.type === 'VariableDeclaration') {
      const target = n.kind === 'var' ? fnScope : scope
      for (const d of n.declarations) for (const name of patternNames(d.id)) target.declare(name)
    } else if (n.type === 'ImportDeclaration') {
      for (const s of n.specifiers) scope.declare(s.local.name)
    } else if (n.type === 'ExportNamedDeclaration' && n.declaration) {
      hoist([n.declaration], scope, { fnScope })
    } else if (n.type === 'ExportDefaultDeclaration' && n.declaration && n.declaration.id) {
      scope.declare(n.declaration.id.name)
    } else if (n.type === 'LabeledStatement') {
      hoist([n.body], scope, { fnScope })
    } else if (n.type === 'ForStatement' || n.type === 'ForOfStatement' || n.type === 'ForInStatement') {
      // `var` in a for-init belongs to the function scope even though the loop makes a block.
      const init = n.init || n.left
      if (init && init.type === 'VariableDeclaration' && init.kind === 'var') {
        for (const d of init.declarations) for (const name of patternNames(d.id)) fnScope.declare(name)
      }
      if (n.body && n.body.type === 'BlockStatement') hoist(n.body.body, scope, { fnScope })
      else if (n.body) hoist([n.body], scope, { fnScope })
    } else if (n.type === 'IfStatement') {
      for (const b of [n.consequent, n.alternate]) {
        if (!b) continue
        if (b.type === 'BlockStatement') hoist(b.body, scope, { fnScope })
        else hoist([b], scope, { fnScope })
      }
    } else if (n.type === 'TryStatement') {
      if (n.block) hoist(n.block.body, scope, { fnScope })
      if (n.handler && n.handler.body) hoist(n.handler.body.body, scope, { fnScope })
      if (n.finalizer) hoist(n.finalizer.body, scope, { fnScope })
    } else if (n.type === 'BlockStatement') {
      hoist(n.body, scope, { fnScope })
    } else if (n.type === 'WhileStatement' || n.type === 'DoWhileStatement') {
      if (n.body && n.body.type === 'BlockStatement') hoist(n.body.body, scope, { fnScope })
    } else if (n.type === 'SwitchStatement') {
      for (const c of n.cases) hoist(c.consequent, scope, { fnScope })
    }
  }
}

function analyse(ast, seeded = []) {
  const free = []           // { name, line }
  const module = new Scope(null, 'module')
  for (const n of seeded) module.declare(n)
  hoist(ast.body, module, { fnScope: module })

  const walk = (node, scope, fnScope, parent, key) => {
    if (!node || typeof node.type !== 'string') return

    // Names that are NOT references.
    if (node.type === 'Identifier') {
      const isMemberProp = parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed
      const isPropKey = parent && parent.type === 'Property' && key === 'key' && !parent.computed
      const isMethodKey = parent && (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed
      const isLabel = parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label'
      const isMetaProp = parent && parent.type === 'MetaProperty'
      const isImportSpec = parent && /^(Import(Default|Namespace)?Specifier|ExportSpecifier)$/.test(parent.type)
      if (isMemberProp || isPropKey || isMethodKey || isLabel || isMetaProp || isImportSpec) return
      if (!scope.has(node.name) && !PRELUDE.has(node.name)) {
        free.push({ name: node.name, line: node.loc ? node.loc.start.line : 0 })
      }
      return
    }

    // Scopes.
    if (isFn(node.type)) {
      const s = new Scope(scope, 'function')
      if (node.type === 'FunctionExpression' && node.id) s.declare(node.id.name)
      for (const p of node.params) for (const n of patternNames(p)) s.declare(n)
      s.declare('arguments')
      // Defaults in params are evaluated in the function scope.
      for (const p of node.params) walk(p, s, s, node, 'params')
      if (node.body && node.body.type === 'BlockStatement') {
        hoist(node.body.body, s, { fnScope: s })
        for (const st of node.body.body) walk(st, s, s, node, 'body')
      } else {
        walk(node.body, s, s, node, 'body')
      }
      return
    }
    if (node.type === 'BlockStatement' && parent && !isFn(parent.type)) {
      const s = new Scope(scope, 'block')
      hoist(node.body, s, { fnScope })
      for (const st of node.body) walk(st, s, fnScope, node, 'body')
      return
    }
    if (node.type === 'CatchClause') {
      const s = new Scope(scope, 'catch')
      for (const n of patternNames(node.param)) s.declare(n)
      hoist(node.body.body, s, { fnScope })
      for (const st of node.body.body) walk(st, s, fnScope, node, 'body')
      return
    }
    if (node.type === 'ForStatement' || node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
      const s = new Scope(scope, 'block')
      const init = node.init || node.left
      if (init && init.type === 'VariableDeclaration') {
        for (const d of init.declarations) for (const n of patternNames(d.id)) s.declare(n)
      }
      for (const k of ['init', 'left', 'test', 'update', 'right', 'body']) {
        if (node[k]) {
          if (k === 'body' && node[k].type === 'BlockStatement') {
            hoist(node[k].body, s, { fnScope })
            for (const st of node[k].body) walk(st, s, fnScope, node[k], 'body')
          } else walk(node[k], s, fnScope, node, k)
        }
      }
      return
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const s = new Scope(scope, 'class')
      if (node.id) s.declare(node.id.name)
      if (node.superClass) walk(node.superClass, s, fnScope, node, 'superClass')
      if (node.body) for (const el of node.body.body) walk(el, s, fnScope, node, 'body')
      return
    }
    // A variable declarator's id is a binding, not a reference; its init is a reference site.
    if (node.type === 'VariableDeclarator') {
      // Defaults inside the pattern ARE references.
      const scanPattern = (p) => {
        if (!p) return
        if (p.type === 'AssignmentPattern') { walk(p.right, scope, fnScope, p, 'right'); scanPattern(p.left) }
        else if (p.type === 'ObjectPattern') for (const pr of p.properties) scanPattern(pr.type === 'RestElement' ? pr.argument : pr.value)
        else if (p.type === 'ArrayPattern') for (const e of p.elements) scanPattern(e)
      }
      scanPattern(node.id)
      if (node.init) walk(node.init, scope, fnScope, node, 'init')
      return
    }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'type') continue
      const v = node[k]
      if (Array.isArray(v)) for (const c of v) walk(c, scope, fnScope, node, k)
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, scope, fnScope, node, k)
    }
  }

  for (const st of ast.body) walk(st, module, module, ast, 'body')
  return free
}

// ── sweep ────────────────────────────────────────────────────────────────────────────────────────
function vueFiles(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) vueFiles(p, out)
    // ★ .js MODULES TOO, since the NEUTRAL P1 (2026-09-27). This gate read only .vue script blocks,
    // and the bug that emptied Big Picture's Religion and Region charts was a plain .js module:
    // useDashboardAggregations.js read NEUTRAL five times and never imported it. A bundle compiles
    // .js and .vue alike; the gate was seeing half of what ships.
    else if (e.endsWith('.vue') || e.endsWith('.js') || e.endsWith('.mjs')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => vueFiles(join(ROOT, r)))
const offenders = []
const unparsed = []
let scanned = 0

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  // A dated one-shot diagnostic (tagged @one-shot, see check-no-orphan-gates) is kept as a recipe, not run.
  if (/^\s*(?:\*|\/\/)\s*@one-shot\b/m.test(src.slice(0, 2600))) continue
  let descriptor
  if (file.endsWith('.js') || file.endsWith('.mjs')) {
    // A .js module is its own script block. Running it through the SFC parser is what broke the first
    // attempt at this: parseSFC found no <script>, the content came back shifted, and acorn reported
    // "Unexpected token (2:1)" — the second line of the file's own doc comment. offset 0 keeps the
    // reported line numbers the file's real ones.
    descriptor = { scriptSetup: null, script: { content: src, loc: { start: { offset: 0 } } } }
  } else {
    try { ({ descriptor } = parseSFC(src, { filename: file })) } catch (e) { unparsed.push([file, e.message]); continue }
  }
  // ★ BOTH SCRIPT BLOCKS, because an SFC may have both and they SHARE a scope. LegendTools.vue
  // exports a function from its plain <script> and uses it in <script setup>; reading only one
  // block reported that as a free identifier, which would have taught everyone to ignore this gate
  // on its first run. The plain block's top-level names are seeded into the module scope.
  const setup = descriptor.scriptSetup
  const plain = descriptor.script
  const block = setup || plain
  if (!block || !block.content.trim()) continue
  scanned++
  const parseJs = (code) => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true })
  let ast, seeded = []
  try {
    ast = parseJs(block.content)
    if (setup && plain && plain.content.trim()) {
      const other = parseJs(plain.content)
      const s2 = new Scope(null, 'module')
      hoist(other.body, s2, { fnScope: s2 })
      seeded = [...s2.names]
    }
  } catch (e) { unparsed.push([file, e.message]); continue }
  const free = analyse(ast, seeded)
  if (free.length) {
    // The script block starts partway down the file; report the file's own line numbers.
    const offset = src.slice(0, block.loc.start.offset).split('\n').length - 1
    const seen = new Set()
    for (const f of free) {
      const k = `${f.name}:${f.line}`
      if (seen.has(k)) continue
      seen.add(k)
      offenders.push({ file: relative(ROOT, file), name: f.name, line: f.line + offset })
    }
  }
}

console.log(`${TAG}: scanned ${scanned} single-file component(s) with a script block across ${ROOTS.join(', ')}.`)
for (const [f, m] of unparsed) console.log(`  ⚠ could not parse ${relative(ROOT, f)}: ${String(m).slice(0, 120)}`)

if (offenders.length) {
  console.log(`\n${TAG}: FAIL — ${offenders.length} reference(s) to a name that is never bound:`)
  for (const o of offenders.slice(0, 40)) console.log(`  ✗ ${o.file}:${o.line}  ${o.name}`)
  if (offenders.length > 40) console.log(`  … and ${offenders.length - 40} more`)
  console.log('\n  A free identifier is valid JavaScript until it RUNS, so it compiles, bundles and')
  console.log('  passes every gate that does not evaluate a setup function — then throws a')
  console.log('  ReferenceError and renders nothing. Usually a missing import.')
  process.exit(1)
}
if (unparsed.length) { console.log(`\n${TAG}: FAIL — ${unparsed.length} file(s) could not be parsed; a file this gate cannot read is a file it cannot vouch for.`); process.exit(2) }
console.log(`${TAG}: PASS — every name used is imported, declared, a parameter, or a known global.`)
