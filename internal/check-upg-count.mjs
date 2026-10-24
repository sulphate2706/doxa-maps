#!/usr/bin/env node
// check-upg-count — UPG-100 never writes its list's TOTAL into a sentence. The wall's intro printed "2,106" in all
// eleven languages after the list had grown to 2,107, because the number lived inside the translated text. Now every
// sentence takes it as {n}, from the funnel's last step (plugin-designs/my-upg-100-list/data/upg-total.js), formatted
// for the reader's locale. Headless. Asserts:
//   A. the total is known (vision-funnel.json's last step) and upgTotal() reads it;
//   B. no upgMap value in any of the 11 locales contains the total (or the stale 2,106) in ANY digit system: Latin
//      with any separator, Arabic-Indic, Devanagari. A built-in NEGATIVE CONTROL plants "2,106" and must be caught;
//   C. upgMap.wallIntroA carries {n} in all 11 locales;
//   D. the consumers pass the live total: poster-wall.vue reads upgMap.wallIntroA with n (not the frozen
//      messages.upg100WallIntroA), and upg-100-list.vue passes no number literal to fetchingUupgs;
//   E. ONE SENTENCE, ONE DIGIT SYSTEM: the wall intro, rendered through each locale's real catalogue, writes its
//      numbers in one digit system (ar: Arabic-Indic, so ٢٬١٠٧ beside ٢٧ and ٩:١٤). A NEGATIVE CONTROL renders ar the
//      old way (plain Intl 'ar', which CLDR formats Western) and must be flagged as mixed.
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(REPO, ...a)
const fails = [], notes = []
const ok = (cond, msg, note) => { if (!cond) fails.push(msg); else if (note) notes.push(`  ok    ${note}`) }
const LANGS = ['en', 'es', 'fr', 'pt', 'de', 'it', 'ro', 'ru', 'ar', 'hi', 'zh']

let upgTotal, formatCount, countInSentence, funnel
try {
  ;({ upgTotal, formatCount, countInSentence } = await import(pathToFileURL(P('plugin-designs/my-upg-100-list/data/upg-total.js')).href))
  funnel = JSON.parse(readFileSync(P('data/people-groups/vision-funnel.json'), 'utf8'))
} catch (e) {
  console.error(`UPG-COUNT: NOT MEASURED (exit 75) — an input did not load: ${e.message}`)
  process.exit(75)
}

// ── A ──
const total = upgTotal(funnel)
ok(total > 1000, `the list's total reads as ${total} from vision-funnel.json`, `the list's total is ${total}, from the funnel`)

// ── B: a digit-system-blind scan ──
const NATIVE = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9 }
const numbersIn = (s) => String(s).replace(/[٠-٩०-९]/g, (d) => NATIVE[d])
  .replace(/(\d)[,.'\u0020\u00A0\u202F\u2009\u066C](?=\d{3}\b)/g, '$1')   // drop thousands separators (fr U+202F, ru U+00A0, ar U+066C)
  .match(/\d+/g) || []
const FORBIDDEN = new Set([String(total), '2106'])
const hasTotal = (s) => numbersIn(s).some((n) => FORBIDDEN.has(n))
ok(hasTotal('We did the same with the 2,106 unreached') && hasTotal('فعلنا المثل مع ٢١٠٦ شعوب') && hasTotal(`mit den ${String(total).replace(/(\d)(\d{3})$/, '$1.$2')} Gruppen`)
  && hasTotal(`les ${new Intl.NumberFormat('fr').format(total)} groupes`) && hasTotal(`из ${new Intl.NumberFormat('ru').format(total)} групп`),
  'NEGATIVE CONTROL: the scanner missed a planted total, so it cannot guard anything', 'negative control: a planted 2,106 / ٢١٠٦ / 2.107 / fr 2 107 / ru 2 107 is caught')
const leaks = []
for (const l of LANGS) {
  const cat = JSON.parse(readFileSync(P('library/i18n/locales', l, 'upgMap.json'), 'utf8'))
  for (const [k, v] of Object.entries(cat)) if (typeof v === 'string' && hasTotal(v)) leaks.push(`${l} upgMap.${k}`)
}
ok(!leaks.length, `the total is written into a sentence: ${leaks.slice(0, 6).join(', ')}`, `no upgMap sentence in the 11 locales carries the total (${total}) or the stale 2,106`)

// ── C ──
const noN = LANGS.filter((l) => !String(JSON.parse(readFileSync(P('library/i18n/locales', l, 'upgMap.json'), 'utf8')).wallIntroA || '').includes('{n}'))
ok(!noN.length, `upgMap.wallIntroA has no {n} in: ${noN.join(', ')}`, 'the wall intro takes the total as {n} in all 11 locales')

// ── D ──
const wall = readFileSync(P('plugin-designs/my-upg-100-list/poster-wall.vue'), 'utf8')
const map = readFileSync(P('plugin-designs/my-upg-100-list/upg-100-list.vue'), 'utf8')
ok(/countInSentence\(t, 'upgMap\.wallIntroA', upgTotal\(/.test(wall) && !/t\('messages\.upg100WallIntroA'\)/.test(wall),
  'poster-wall.vue does not render the intro from upgMap.wallIntroA with the live total', 'the wall intro renders the live total')
ok(!/fetchingUupgs', \{ n: \d/.test(map) && /countInSentence\(t, 'messages\.fetchingUupgs', upgTotal\(/.test(map),
  'upg-100-list.vue passes a number literal to fetchingUupgs', 'the fetching status shows the live total')

// ── E: one sentence, one digit system ──
const SYSTEMS = [['latn', /[0-9]/], ['arab', /[\u0660-\u0669]/], ['arabext', /[\u06F0-\u06F9]/], ['deva', /[\u0966-\u096F]/], ['beng', /[\u09E6-\u09EF]/]]
const systemsIn = (s) => SYSTEMS.filter(([, re]) => re.test(String(s))).map(([nu]) => nu)
const trFor = (l) => {
  const c = JSON.parse(readFileSync(P('library/i18n/locales', l, 'upgMap.json'), 'utf8'))
  return (k, p = {}) => String(c[k.replace(/^upgMap\./, '')] ?? k).replace(/\{(\w+)\}/g, (m, x) => (p[x] != null ? String(p[x]) : m))
}
const arOld = trFor('ar')('upgMap.wallIntroA', { n: formatCount(total, 'ar') })
ok(systemsIn(arOld).length > 1, `NEGATIVE CONTROL: the old ar render reads as ONE digit system (${systemsIn(arOld).join('+')}), so this check cannot see the defect`,
  `negative control: the old ar render (plain Intl 'ar' = "${formatCount(total, 'ar')}") is flagged as mixed (${systemsIn(arOld).join('+')})`)
const mixed = []
for (const l of LANGS) {
  const s = countInSentence(trFor(l), 'upgMap.wallIntroA', total, l)
  if (systemsIn(s).length > 1) mixed.push(`${l} ${systemsIn(s).join('+')}`)
  if (!numbersIn(s).includes(String(total))) mixed.push(`${l} does not show ${total}`)
}
const arNew = countInSentence(trFor('ar'), 'upgMap.wallIntroA', total, 'ar')
ok(!mixed.length, `the wall intro: ${mixed.join('; ')}`,
  `the wall intro shows ${total} in ONE digit system in all 11 locales (ar: "${(arNew.match(/[\u0660-\u0669٬]{3,}/) || ['?'])[0]}")`)

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('UPG-COUNT: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`UPG-COUNT: PASS — the list's total (${total}) lives in one place and every sentence takes it as {n}.`)
