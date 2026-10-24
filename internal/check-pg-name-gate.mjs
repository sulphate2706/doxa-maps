#!/usr/bin/env node
// check-pg-name-gate — a people group's localized name is shown only when it is a transliteration, never a word
// that a machine translated (Balantak → "Balance", Balo → "Sac à dos"). The rule lives in ONE place,
// library/utils/peopleGroupName.js; this gate holds it there and proves it on the REAL table. Headless. Asserts:
//   A. the table loads (data/pplr/pg-names.json, the file the tree serves as assets/pplr/pg-names.json);
//   B. REAL ROWS: Balantak, Balo, Abaga and Abai Sungai (translated as words) show English in every locale;
//      Balangao Bontoc (a transliteration) shows its own names; it and ro, which have no column, show English;
//   C. TWO-SIDED on planted rows, AT the threshold: EXACTLY two far Latin locales falls back, one is kept (the rule
//      is "two or more"); a row with only one Latin name to check is not trusted (no evidence → English);
//   D. the whole table falls back between 30% and 45% (measured 38.2%, 8,172 of 21,419). A similarity that
//      always says "same" (0%) or always "different" (100%) fails here even if B and C were tuned around;
//   E. THE ONE-READER RULE: a file in library/ or plugin-designs/ that names pg-names must take its names through
//      peopleGroupName.js, and must not index its rows itself (`.names[`) even when it imports the helper.
//      pplr-data-maps is the carded exception (its coverage views read raw rows on purpose). NEGATIVE CONTROLS: a
//      planted raw reader, and a planted file that imports the helper AND indexes rows, must both be caught.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(REPO, ...a)
const fails = [], notes = []
const ok = (cond, msg, note) => { if (!cond) fails.push(msg); else if (note) notes.push(`  ok    ${note}`) }

let H, table
try {
  H = await import(pathToFileURL(P('library/utils/peopleGroupName.js')).href)
  table = JSON.parse(readFileSync(P('data/pplr/pg-names.json'), 'utf8'))
} catch (e) {
  console.error(`PG-NAME-GATE: NOT MEASURED (exit 75) — an input did not load: ${e.message}`)
  process.exit(75)
}
const { locales, names } = table
const name = (code, lang) => H.peopleGroupName(names[code], locales, lang)

// ── A ──
ok(Array.isArray(locales) && locales.includes('en') && Object.keys(names).length > 20000,
  `the table has ${Object.keys(names || {}).length} rows and locales ${JSON.stringify(locales)}`,
  `the table loads: ${Object.keys(names).length} groups × ${locales.length} locales`)

// ── B: real rows ──
const TRANSLATED = { 220002: 'Balantak', 220017: 'Balo', 220044: 'Abaga', 220045: 'Abai Sungai' }
const wrong = []
for (const [code, en] of Object.entries(TRANSLATED)) {
  if (!names[code] || names[code][locales.indexOf('en')] !== en) { wrong.push(`${code} is not ${en} in this table`); continue }
  for (const l of ['fr', 'es', 'de', 'ar', 'hi', 'ru', 'zh']) if (name(code, l) !== en) wrong.push(`${en} in ${l} shows "${name(code, l)}"`)
}
ok(!wrong.length, `translated rows leak: ${wrong.slice(0, 5).join('; ')}`,
  `the 4 known translated rows (${Object.values(TRANSLATED).join(', ')}) show English in fr es de ar hi ru zh`)
const bb = names[220001], at = (l) => bb[locales.indexOf(l)]
ok(bb && name(220001, 'ar') === at('ar') && /[\u0600-\u06FF]/.test(name(220001, 'ar')) && name(220001, 'zh') === at('zh_CN') && name(220001, 'hi') === at('hi'),
  `Balangao Bontoc lost its own names: ar "${bb && name(220001, 'ar')}", zh "${bb && name(220001, 'zh')}"`,
  `Balangao Bontoc keeps its own names (ar "${name(220001, 'ar')}", zh "${name(220001, 'zh')}")`)
ok(name(220001, 'it') === 'Balangao Bontoc' && name(220001, 'ro') === 'Balangao Bontoc' && H.peopleGroupName(bb, locales, 'ar', 'Bontoc, Balangao') === at('ar')
  && H.peopleGroupName(names[220002], locales, 'fr', 'Balantak (Sulawesi)') === 'Balantak (Sulawesi)',
  'it/ro or the caller\'s English name are not honoured', 'it and ro show English; a fallback shows the CALLER\'s English name')

// ── C: planted rows, two-sided ──
const planted = (fn) => { const r = bb.slice(); fn(r); return r }
const twoFar = planted((r) => { r[locales.indexOf('fr')] = 'Sac à dos'; r[locales.indexOf('de')] = 'Rucksack' })
const oneFar = planted((r) => { r[locales.indexOf('fr')] = 'Sac à dos' })
const oneLatin = planted((r) => { for (const l of H.LATIN_LOCALES) if (l !== 'fr') r[locales.indexOf(l)] = '' })
const kept = (r) => (H.isTransliterated(r, locales) ? 'kept' : 'English')
ok(kept(twoFar) === 'English' && H.peopleGroupName(twoFar, locales, 'ar') === 'Balangao Bontoc' && kept(oneFar) === 'kept'
  && kept(oneLatin) === 'English' && H.peopleGroupName(oneLatin, locales, 'ar', 'Balangao Bontoc') === 'Balangao Bontoc',
  `planted rows: exactly two far → ${kept(twoFar)}, one far → ${kept(oneFar)}, one Latin name only → ${kept(oneLatin)}`,
  'planted, at the threshold: exactly two far Latin locales → English (ar too); one far → kept; only one Latin name to check → English')

// ── D: the whole table ──
let back = 0
for (const row of Object.values(names)) if (!H.isTransliterated(row, locales)) back++
const share = back / Object.keys(names).length
ok(share > 0.30 && share < 0.45, `${back} rows (${(share * 100).toFixed(1)}%) fall back; expected 30-45% (measured 38.2%)`,
  `${back} of ${Object.keys(names).length} rows (${(share * 100).toFixed(1)}%) fall back to English`)

// ── E: one reader ──
const EXEMPT = ['plugin-designs/pplr-data-maps/']
const rawReaders = (files) => files.filter(({ path, src }) => /pg-names/.test(src) && !EXEMPT.some((x) => path.startsWith(x))
  && (!/peopleGroupName(\.js)?['"]/.test(src) || /\.names\s*\[/.test(src)))
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue
    const p = join(dir, f), s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (/\.(m?js|vue)$/.test(f)) out.push({ path: relative(REPO, p).split('\\').join('/'), src: readFileSync(p, 'utf8') })
  }
  return out
}
const sources = [...walk(P('library')), ...walk(P('plugin-designs'))].filter((f) => f.path !== 'library/utils/peopleGroupName.js')
const PLANT_RAW = "fetch(base + '/pplr/pg-names.json').then((t) => t.names[code][3])"
const PLANT_BOTH = "import { peopleGroupName } from '@map/utils/peopleGroupName.js'\n" + PLANT_RAW
const PLANT_GOOD = "import { peopleGroupName } from '@map/utils/peopleGroupName.js'\nfetch(base + '/pplr/pg-names.json').then((t) => peopleGroupName(t.names && row, t.locales, lang, name))"
ok(rawReaders([{ path: 'plugin-designs/x/a.vue', src: PLANT_RAW }, { path: 'plugin-designs/x/b.vue', src: PLANT_BOTH }, { path: 'plugin-designs/x/c.vue', src: PLANT_GOOD }]).map((f) => f.path).join() === 'plugin-designs/x/a.vue,plugin-designs/x/b.vue',
  'NEGATIVE CONTROL: the one-reader scan missed a planted raw reader (or flagged a helper-only one)',
  'negative controls: a raw reader, and one that imports the helper AND indexes rows, are both caught; a helper-only reader passes')
const raw = rawReaders(sources).map((f) => f.path)
ok(!raw.length, `pg-names read outside peopleGroupName.js: ${raw.join(', ')}`,
  `no file outside peopleGroupName.js reads pg-names rows (${sources.length} sources; pplr-data-maps carded)`)

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('PG-NAME-GATE: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PG-NAME-GATE: PASS — a localized people-group name is shown only when it is a transliteration, decided in one place.')
