#!/usr/bin/env node
/**
 * check-no-eval — no bundle needs CSP 'unsafe-eval', and translations still render without it. Headless.
 *
 * CRITIC-4 (2026-09-26): vue-i18n's default message compiler builds every message with `new Function`,
 * so 20 of 25 bundles needed 'unsafe-eval' and a partner with a strict Content-Security-Policy got no
 * translated text. vite.config.js now defines __INTLIFY_JIT_COMPILATION__ (compile to an AST, no eval).
 *
 * ASSERTS  (1) BUILT: no bundle under public/<tree>/ contains `new Function(` or a bare `eval(`.
 *          (2) RUNTIME: vue-i18n in JIT mode, with the global Function constructor and eval DISABLED
 *              (they throw, as under a strict CSP), renders real catalogue messages — plain,
 *              {named} interpolation and plural — in en and ar, from library/i18n/locales.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
// ── (1) built output ──
const TREE = join(ROOT, 'public', TREE_NAME)
let bundles = 0
for (const d of existsSync(TREE) ? readdirSync(TREE) : []) {
  const f = join(TREE, d, `${d}.js`)
  if (!existsSync(f)) continue
  bundles++
  const src = readFileSync(f, 'utf8')
  const nf = (src.match(/new Function\s*\(/g) || []).length, ev = (src.match(/(^|[^\w$.])eval\s*\(/g) || []).length
  if (nf || ev) { bad++; console.log(`  FAIL  ${d}.js: ${nf} new Function, ${ev} eval — needs CSP 'unsafe-eval'`) }
}
if (!bundles) { bad++; console.log('  FAIL  no built bundles found (vacuous)') }
else console.log(`  ${bad ? '    ' : 'ok  '}  ${bundles} built bundle(s) scanned for new Function / eval`)

// ── (2) runtime, with eval unavailable ──
globalThis.__INTLIFY_JIT_COMPILATION__ = true
globalThis.__INTLIFY_DROP_MESSAGE_COMPILER__ = false
globalThis.__VUE_I18N_FULL_INSTALL__ = true
globalThis.__VUE_I18N_LEGACY_API__ = false
globalThis.__INTLIFY_PROD_DEVTOOLS__ = false
const { createI18n } = await import('vue-i18n')
const RealFunction = globalThis.Function
globalThis.eval = () => { throw new EvalError('CSP: eval blocked') }
globalThis.Function = new Proxy(RealFunction, { construct() { throw new EvalError('CSP: new Function blocked') }, apply() { throw new EvalError('CSP: Function blocked') } })
const cat = (lc, area) => JSON.parse(readFileSync(join(ROOT, 'library/i18n/locales', lc, `${area}.json`), 'utf8'))
const walk = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? walk(v, p + k + '.') : [[p + k, v]]))
for (const lc of ['en', 'ar']) {
  const messages = { [lc]: { studio: cat(lc, 'studio'), search: cat(lc, 'search') } }
  const i18n = createI18n({ legacy: false, locale: lc, messages, missingWarn: false, fallbackWarn: false })
  const t = i18n.global.t
  const keys = walk(messages[lc]).filter(([, v]) => typeof v === 'string')
  const named = keys.find(([, v]) => /\{\w+\}/.test(v))
  let n = 0
  try {
    for (const [k, v] of keys) {
      const vars = {}; for (const m of v.matchAll(/\{(\w+)\}/g)) vars[m[1]] = 'X'
      const out = t(k, vars)
      if (typeof out !== 'string' || !out) throw new Error(`${k}: rendered nothing`)
      if (/\{\w+\}/.test(out)) throw new Error(`${k}: placeholder left in "${out}"`)
      n++
    }
    const nv = named ? t(named[0], Object.fromEntries([...named[1].matchAll(/\{(\w+)\}/g)].map((m) => [m[1], 'Q']))) : ''
    console.log(`  ok    ${lc}: ${n} studio/search messages rendered with eval blocked${named ? ` (e.g. ${named[0]} → "${nv.slice(0, 50)}")` : ''}`)
  } catch (e) { bad++; console.log(`  FAIL  ${lc}: ${e.message}`) }
}
globalThis.Function = RealFunction
if (bad) { console.log(`NO-EVAL: FAIL — ${bad} problem(s).`); process.exit(1) }
console.log("NO-EVAL: PASS — no bundle needs 'unsafe-eval', and translations render with eval blocked.")
