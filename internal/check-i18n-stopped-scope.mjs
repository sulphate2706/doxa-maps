#!/usr/bin/env node
/**
 * check-i18n-stopped-scope.mjs — createAppI18n() must succeed while a STOPPED effect scope is current.
 *
 * WHY (P0, seen in a live console, 2026-09-27): in Plugin Studio's gallery every tab after the first threw
 * "SyntaxError: Unexpected error" from createI18n inside createAppI18n. vue-i18n's createGlobal() runs in
 * scope.run() and throws UNEXPECTED_ERROR when that returns undefined; Vue 3.5 creates a new EffectScope
 * INACTIVE when the currently active one is stopped; and a custom element's connectedCallback ->
 * configureApp -> createAppI18n can run while the released tab's stopped scope is still current.
 *
 * The CONTROL comes first: a bare createI18n() inside the same stopped scope must THROW, or this harness
 * does not reproduce the failure and a green result would prove nothing. Then createAppI18n() inside it
 * must succeed, translate, and keep reacting to a locale change.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + got}`) }

const { createServer } = await import('vite')
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, resolve: { alias: { '@map': join(ROOT, 'library') } } })
try {
  globalThis.__INTLIFY_JIT_COMPILATION__ = true
  const { effectScope } = await import('vue')
  const { createI18n } = await import('vue-i18n')
  const mod = await server.ssrLoadModule('/library/i18n/index.js')
  // Set AFTER vue loads (runtime-dom probes `document` at import). These are the two page facts
  // createAppI18n reads, the URL and <html lang>, as a plain English page would give them.
  globalThis.window ??= { location: { search: '' } }
  globalThis.document ??= { documentElement: { lang: 'en', dir: '' } }

  // A scope that ran, was stopped, and is still the current one — the released tab's.
  const stopped = effectScope()
  stopped.run(() => {})
  stopped.stop()
  const inStopped = (fn) => { stopped.on(); try { return fn() } finally { stopped.off() } }

  let controlThrew = false
  try { inStopped(() => createI18n({ legacy: false, locale: 'en', messages: { en: { a: 'b' } } })) } catch { controlThrew = true }
  check('CONTROL: a bare createI18n() inside a stopped scope throws (the harness reproduces the bug)', controlThrew, 'it did not throw')

  let i18n = null, err = null
  try { i18n = inStopped(() => mod.createAppI18n()) } catch (e) { err = e }
  check('createAppI18n() succeeds inside a stopped scope', !!i18n && !err, err && String(err))
  if (i18n) {
    check('and it translates', i18n.global.t('buttons.close') !== 'buttons.close', i18n.global.t('buttons.close'))
    i18n.global.locale.value = 'ar'
    await new Promise((r) => setTimeout(r, 0))
    check('and its locale watcher is live (the static reader follows a runtime switch)', mod.getRuntimeLocale() === 'ar', mod.getRuntimeLocale())
    // The bundle entries that still provide appI18n themselves after app.use(i18n) must not make Vue warn.
    const { createApp } = await import('vue')
    const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(a.join(' '))
    try { const app = createApp({}); app.use(i18n); app.provide('appI18n', i18n) } finally { console.warn = warn }
    check('a bundle providing appI18n again after app.use(i18n) raises no Vue warning', !warns.some((w) => /appI18n/.test(w)), warns.join(' | '))
  }
} finally {
  await server.close()
}

if (bad) { console.error(`\nI18N-STOPPED-SCOPE: FAIL — ${bad} assertion(s)`); process.exit(1) }
console.log('\nI18N-STOPPED-SCOPE: PASS — the app i18n is created live even while a stopped effect scope is current.')
