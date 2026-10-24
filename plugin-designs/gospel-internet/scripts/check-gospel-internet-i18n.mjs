#!/usr/bin/env node
/**
 * check-gospel-internet-i18n.mjs — every catalogue key this bundle names EXISTS, in every locale, and
 * no locale's value is the English left in place.
 *
 * WHY A PLUGIN GATE when check:i18n-keys-exist exists: that gate finds aliases declared as
 * `const X = … tStatic(…)` one-liners, and this bundle's alias is `const T = useGiT()` (useOptionalT
 * underneath, so it follows a runtime locale change). Measured: a poisoned key passed it. Until the
 * shared gate learns that shape (reported to its owner), this one reads the bundle's own call sites:
 *   - literal keys: T('area.key', …) in src/ and the profile;
 *   - coded keys:   label(T, '<family>', code) for every code in model.LABELS_EN.
 * And it refuses a vacuous pass: fewer than 100 keys read means the parser broke, not that all is well.
 * `--poison` plants a missing key and requires a FAIL.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const REPO = resolve(PLUGIN, '../..')
const POISON = process.argv.includes('--poison')
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh']

const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'scripts') walk(p) } else if (/\.(vue|js)$/.test(f)) files.push(p) } }
walk(PLUGIN)

const keys = new Set()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\bT\(\s*'([A-Za-z_]\w*(?:\.[\w-]+)+)'/g)) keys.add(m[1])
}
const { LABELS_EN } = await import(join(PLUGIN, 'src/model.js'))
for (const [fam, codes] of Object.entries(LABELS_EN)) for (const c of Object.keys(codes)) keys.add(`gospelInternet.${fam}.${c}`)
if (POISON) keys.add('gospelInternet.poison.notInAnyCatalogue')

const cat = {}
const get = (lc, key) => {
  const [area, ...rest] = key.split('.')
  const k = `${lc}/${area}`
  if (!(k in cat)) { try { cat[k] = JSON.parse(readFileSync(join(REPO, 'library/i18n/locales', lc, area + '.json'), 'utf8')) } catch { cat[k] = null } }
  let v = cat[k]
  for (const p of rest) v = v && typeof v === 'object' ? v[p] : undefined
  return typeof v === 'string' ? v : undefined
}

// SETTLED, not deferred: the correct word in that language IS the English spelling. Each is a decision,
// listed by locale and key so a new identical string is still caught.
const SAME_ON_PURPOSE = new Set(['fr:res.source', 'fr:res.type', 'ro:tree.dialect', 'fr:facet.religion',
  'de:facet.region', 'de:facet.religion', 'de:tree.poster', 'it:tree.poster', 'ro:tree.poster', 'de:col.openWiki', 'es:col.openWiki', 'it:col.openWiki', 'ro:col.openWiki', 'de:rings.ring'])

let fails = 0
if (keys.size < 100) { console.log(`NOT MEASURED: read only ${keys.size} keys (expected 100+); the parser is broken, not the bundle`); process.exitCode = 75 }
else {
  for (const key of [...keys].sort()) {
    const en = get('en', key)
    if (en === undefined) { fails++; console.log(`FAIL ${key}: missing from en`); continue }
    for (const lc of LOCALES) {
      if (lc === 'en') continue
      const v = get(lc, key)
      if (v === undefined) { fails++; console.log(`FAIL ${key}: missing from ${lc}`) }
      // Only this bundle's own area is required to differ: shared keys (buttons.*, aria.*) are their
      // owners' to judge, and a proper noun may legitimately match.
      else if (key.startsWith('gospelInternet.') && v === en && /[a-z]{4,}/i.test(en) && !SAME_ON_PURPOSE.has(`${lc}:${key.slice(15)}`) && !/^(Audio|Video|Film)$/.test(en)) {
        fails++; console.log(`FAIL ${key}: ${lc} is the English left in place ("${en}")`)
      }
    }
  }
  if (POISON) {
    console.log(fails ? `POISON OK: planted key caught (${fails})` : 'POISON FAILED: a missing key passed')
    process.exitCode = fails ? 0 : 1
  } else {
    console.log(fails ? `FAIL check-gospel-internet-i18n: ${fails}` : `PASS check-gospel-internet-i18n: ${keys.size} keys x ${LOCALES.length} locales`)
    process.exitCode = fails ? 1 : 0
  }
}
