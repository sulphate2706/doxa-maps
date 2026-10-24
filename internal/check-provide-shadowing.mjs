#!/usr/bin/env node
/**
 * check-provide-shadowing — a nested custom element keeps its OWN pinia, i18n and profileModules, and
 * says so deliberately instead of tripping Vue's overwrite warning 24 times.
 *
 * THE DEFECT (seen in a live console, 2026-09-28): 24 Vue warnings —
 *   'App already provides property with key "profileModules" / "appI18n" / "Symbol(pinia)" inherited
 *    from its parent element. It will be overwritten with the new value.'
 * eight of each, from a composite mounting child custom elements.
 *
 * ★ THE OVERWRITE IS THE POINT, WHICH IS WHY SILENCING IT WOULD HAVE BEEN WRONG AND FIXING IT BY NOT
 * PROVIDING WOULD HAVE BEEN WORSE. `profileModules` is the plugin's own .vue glob — a child rendering
 * its parent's components is a different bug; pinia is per-instance so two embeds never bleed state;
 * and the i18n instance is the one ProfileLoader drives from THIS element's profile-config, which is
 * the whole of the permanently-English fix landed the same day. Inheriting any of the three would be
 * the regression.
 *
 * So this asserts BOTH halves: the child still ends up with its OWN value (the fix is not undone), and
 * the inherited chain is left intact afterwards (the parent's OTHER values still resolve).
 *
 * Exercised against the REAL exported helpers, not a copy — a copied helper would pass while the
 * shipped one rotted. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { provideOwn, withoutInheritedProvides } =
  await import(resolve(ROOT, 'library/elements/provide-own.js'))

const fails = []
const ok = (what, cond, d = '') => { if (!cond) fails.push(`${what}${d ? `\n      ${d}` : ''}`) }

// A Vue-shaped app: provides inherits from the parent ELEMENT's provides, and app.provide() warns
// exactly as runtime-core does when the key is already reachable.
const makeApp = (parentProvides = {}) => {
  const provides = Object.create(parentProvides)
  const warnings = []
  return {
    warnings,
    _context: { provides },
    provide(key, value) {
      if (key in provides) warnings.push(String(key))
      provides[key] = value
    },
  }
}

// ── provideOwn: an inherited key is shadowed WITHOUT a warning ───────────────────────────────────
{
  const parent = { appI18n: 'PARENT-I18N', somethingElse: 'keep-me' }
  const app = makeApp(parent)
  provideOwn(app, 'appI18n', 'MY-I18N')
  ok('the child ends up with its OWN i18n', app._context.provides.appI18n === 'MY-I18N')
  ok('...as an OWN property, not the parent\'s', Object.hasOwn(app._context.provides, 'appI18n'))
  ok('...without a warning, because the shadow is deliberate', app.warnings.length === 0,
    `warned about: ${app.warnings.join(', ')}`)
  ok('the parent\'s OTHER values still resolve', app._context.provides.somethingElse === 'keep-me')
  ok('and the parent is NOT mutated', parent.appI18n === 'PARENT-I18N')
}
// ── provideOwn: an ABSENT key takes the ordinary public path ─────────────────────────────────────
{
  const app = makeApp({})
  provideOwn(app, 'profileModules', { a: 1 })
  ok('a key nobody provided is set through the public API', app._context.provides.profileModules.a === 1)
  ok('...and still does not warn, because there was nothing to overwrite', app.warnings.length === 0)
}
// ── withoutInheritedProvides: for a key we cannot name (pinia's symbol) ──────────────────────────
{
  const SYM = Symbol('pinia')
  const parent = { [SYM]: 'PARENT-PINIA', other: 'x' }
  const app = makeApp(parent)
  withoutInheritedProvides(app, () => app.provide(SYM, 'MY-PINIA'))
  ok('the child ends up with its own pinia', app._context.provides[SYM] === 'MY-PINIA')
  ok('...with no warning', app.warnings.length === 0, `warned about: ${app.warnings.map(String).join(', ')}`)
  ok('★ the inherited chain is RESTORED — the parent\'s other values resolve again',
    app._context.provides.other === 'x')
  ok('the parent is not mutated', parent[SYM] === 'PARENT-PINIA')
}
// ── and it restores the chain even when the callback throws ──────────────────────────────────────
{
  const parent = { other: 'x' }
  const app = makeApp(parent)
  try { withoutInheritedProvides(app, () => { throw new Error('install blew up') }) } catch { /* expected */ }
  ok('a throwing install still leaves the element able to see its parent',
    app._context.provides.other === 'x')
}
// ── the control: the naive call MUST warn, or these assertions prove nothing ─────────────────────
{
  const app = makeApp({ appI18n: 'PARENT' })
  app.provide('appI18n', 'MINE')
  ok('a plain app.provide() over an inherited key DOES warn (the behaviour being avoided)',
    app.warnings.length === 1)
}

if (fails.length) {
  console.error('PROVIDE-SHADOWING: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PROVIDE-SHADOWING: PASS — a nested element keeps its own pinia, i18n and profileModules with no '
  + 'overwrite warning, the parent\'s other provides still resolve, and the chain is restored even if install throws.')
