#!/usr/bin/env node
/**
 * check-template-i18n — the starter template renders its text from the catalogue. Headless (SSR).
 *
 * template-bundle is what every new plugin copies, so it has to SHOW the i18n pattern, not just pass
 * it. Profile B is rendered through Vue's server renderer with the REAL template.json catalogue in en,
 * ar and zh, and must:
 *   - take its heading, its note line and its sentence from the catalogue of the page's language;
 *   - render "Served from {file} in the {bundle} bundle." as ONE key, in that language's own word order
 *     (zh puts the bundle first), with the file and bundle names as two <code dir="ltr"> islands;
 *   - show no raw key and no {placeholder}.
 * Two-sided: the same render in ar with the ENGLISH catalogue served as Arabic (a catalogue someone
 * forgot to translate, or a component that ignores the locale) must fail.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createSSRApp, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const cat = (lc) => ({ template: JSON.parse(readFileSync(join(ROOT, `library/i18n/locales/${lc}/template.json`), 'utf8')) })

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })

/** Render profile B in `lc`, serving `served` as that locale's catalogue; return what is wrong. */
async function check(B, lc, served, noteGiven) {
  const i18n = createI18n({ legacy: false, locale: lc, fallbackLocale: 'en', messages: { en: cat('en'), [lc]: served } })
  const app = createSSRApp(B); app.use(i18n); app.provide('profileConfig', ref(noteGiven ? { note: noteGiven } : {}))
  const html = await renderToString(app)
  const want = cat(lc).template.profileB
  const text = html.replace(/<[^>]+>/g, '')
  const errs = []
  if (!html.includes(want.title)) errs.push('the heading is not the catalogue\'s')
  if ((html.match(/<code dir="ltr"[^>]*>/g) || []).length !== 2) errs.push('the sentence does not keep its two <code dir="ltr"> islands')
  if (!html.includes('>template-map-b.vue<') || !html.includes('>template-bundle<')) errs.push('the islands do not carry the file and bundle names')
  const sentence = want.servedFrom.replace('{file}', 'template-map-b.vue').replace('{bundle}', 'template-bundle')
  if (!text.includes(sentence)) errs.push(`the sentence does not read in the catalogue's order ("${sentence}")`)
  if (!(noteGiven ? text.includes(want.note.replace('{note}', noteGiven)) : text.includes(want.noNote))) errs.push('the note line is not the catalogue\'s')
  if (/\{\w+\}|template\.profileB/.test(text)) errs.push('a raw placeholder or key shows')
  return { errs, text: text.replace(/\s+/g, ' ').trim() }
}

const fails = []
try {
  const B = (await server.ssrLoadModule('/plugin-designs/template-bundle/template-map-b.vue')).default
  for (const [lc, note] of [['en', ''], ['ar', 'مرحبا'], ['zh', 'hello']]) {
    const { errs, text } = await check(B, lc, cat(lc), note)
    console.log(`  ${errs.length ? 'FAIL' : 'ok  '}  ${lc}: ${text.slice(0, 120)}`)
    fails.push(...errs.map((e) => `${lc}: ${e}`))
  }
  const planted = await check(B, 'ar', cat('en'), '')
  if (!planted.errs.length) fails.push('SELF-TEST: the English catalogue served as Arabic was not caught')
} catch (e) { fails.push('could not render: ' + e.message) }
await server.close()

if (fails.length) { console.log('TEMPLATE-I18N: FAIL'); for (const f of fails) console.log('  - ' + f); process.exit(1) }
console.log('TEMPLATE-I18N: PASS — profile B renders from template.json in en, ar and zh, its sentence in each language\'s own order with both <code> islands; the English catalogue served as Arabic is caught.')
process.exit(0)
