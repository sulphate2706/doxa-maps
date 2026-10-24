#!/usr/bin/env node
/**
 * check-popup-escaping — the library's map popups cannot be made to run script by the DATA. Headless.
 *
 * CRITIC-3 (2026-09-26): generatePinPopupContent and generateRegionPopupContent (useMapEvents.js)
 * interpolated people-group and country fields raw into HTML handed to setHTML(). A name or description
 * like `<img src=x onerror=…>` from an API or a partner's list would run in the host page.
 * Mounts the real composable in a tiny Vue app and renders both popups from hostile data.
 * ASSERTS no raw tag, event-handler attribute or javascript: URL survives; ordinary text still shows.
 * EXIT 0 pass · 1 fail
 */
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
globalThis.__INTLIFY_JIT_COMPILATION__ = true
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { useMapEvents } = await import('../library/composables/useMapEvents.js')
const popup = JSON.parse(readFileSync(resolve(ROOT, 'library/i18n/locales/en/popup.json'), 'utf8'))
const EVIL = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
const pin = { name: 'Afar ' + EVIL, country: EVIL, status: EVIL, language: EVIL, languageFamily: EVIL, population: EVIL,
  description: EVIL, imageUrl: 'javascript:alert(3)' }
let out = {}
const app = createApp({ setup() {
  const ev = useMapEvents({ getNormalizedPeopleGroups: () => [{ countryIso: 'ETH', wagfRegionLabel: EVIL, wagfBlockLabel: EVIL }] })
  out.pin = ev.generatePinPopupContent(pin)
  out.region = ev.generateRegionPopupContent({ iso_3166_1_alpha_3: 'ETH', name_en: 'Ethiopia ' + EVIL })
  return () => h('div')
} })
app.use(createI18n({ legacy: false, locale: 'en', messages: { en: { popup } } }))
app.provide('uiStore', {})
const { renderToString } = await import('vue/server-renderer')
await renderToString(app)
let bad = 0
for (const [k, html] of Object.entries(out)) {
  const probs = []
  if (/<img src=x|<script>/i.test(html)) probs.push("a raw <img>/<script> tag from the data")
  if (/\son\w+\s*=\s*"alert/i.test(html)) probs.push('an event-handler attribute from the data')
  if (/javascript:/i.test(html)) probs.push('a javascript: URL')
  if (!/Afar|Ethiopia/.test(html)) probs.push('the ordinary text is gone')
  if (probs.length) bad++
  console.log(`  ${probs.length ? 'FAIL' : 'ok  '}  ${k} popup${probs.length ? ': ' + probs.join('; ') : ': hostile data shown as text, no markup or script'}`)
}
if (bad) { console.log(`POPUP-ESCAPING: FAIL — ${bad} popup(s) render data as HTML.`); process.exit(1) }
console.log('POPUP-ESCAPING: PASS — both library popups escape every data field and refuse non-http URLs.')
