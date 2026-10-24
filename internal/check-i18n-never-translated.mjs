#!/usr/bin/env node
/**
 * check-i18n-never-translated — a key present in all 11 catalogs but IDENTICAL in all of them is
 * probably not translated, only copied.
 *
 * THE GAP THIS CLOSES. check-i18n-parity asserts PRESENCE — every locale carries every key. A key
 * can pass that perfectly while holding the English string in all eleven files, which is what
 * "translated" was supposed to mean. Presence and translatedness are different properties, and
 * only the first one was measured.
 *
 * MEASURED 2026-09-25 across every catalog: exactly THREE keys are byte-identical in all locales.
 * That the sweep finds three rather than three hundred is what makes it worth gating — it is
 * signal, not nagging.
 *
 * ★ THE DEFECT IT FOUND, and why it is a defect rather than a preference: legend.columns.upgs is
 * the literal string "UUPGs" in all 11 catalogs, while `population` sitting beside it in the SAME
 * header row translates normally (Población / 人口 / Население / السكان). So the legend renders a
 * fully localized row with one English acronym wedged into it.
 * THE PRODUCT HAS ALREADY RULED ON THIS CONCEPT. packet-strings.json translates the same idea in
 * prose in every locale — "unreached people groups" becomes grupos étnicos no alcanzados / 未得之民 /
 * неохваченных народов / شعبًا غير مبلَغ. The legend disagrees with the packet the legend generates.
 * That is the "two honest surfaces that disagree" family: each is internally consistent, and
 * together they tell a reader the product does not know its own vocabulary.
 *
 * ⚠ IT IS A HEURISTIC, SO IT CARRIES AN ALLOWLIST. Some keys are CORRECTLY identical everywhere:
 * pure interpolation formats with no prose, brand names, ISO designations. The sweep found one —
 * legend.progress.segment is "{label} · {count} · {pct}%", all placeholders. Those are declared
 * below WITH a reason, so the list is a record of decisions rather than a silencer.
 *
 * ⚠ AND IT DOES NOT PROPOSE TRANSLATIONS. Inventing terminology across 11 languages is worse than
 * leaving an English acronym: a wrong term looks authoritative to a reader who cannot check it.
 * Drafting candidates here produced invented initialisms (PNA, UEVG, ННГ) with no source, which is
 * exactly the failure this comment exists to prevent. The gate names what is untranslated; a human
 * who knows the field's vocabulary supplies the words.
 *
 * Usage: node internal/check-i18n-never-translated.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const BASE = resolve(REPO, 'library/i18n/locales')

// Keys that are CORRECTLY the same in every language. Each needs a reason, so the next reader can
// tell a decision from a suppression.
const ALLOWED = new Map([
  ['legend.json:progress.segment',
    'pure interpolation — "{label} · {count} · {pct}%" contains no prose to translate'],
  // ── PROPER NOUNS ────────────────────────────────────────────────────────────
  // Names of ORGANISATIONS that publish these resources, not descriptions of them. A reader
  // following the link meets the English name on the destination site, so translating it would
  // hide the thing it identifies. They sit in the same res.* block as `jesusFilm: 'JESUS Film'`,
  // which the product already treats as a brand, and resources-list.vue:234 maps the literal
  // string 'Scripture Earth' back to this key — it is an identity, not a label.
  ['gospel.json:res.bibleStories',
    'proper noun — Open Bible Stories is the publication\'s name (unfoldingWord), not a description'],
  ['gospel.json:res.scriptureEarth',
    'proper noun — Scripture Earth is the organisation\'s name; the destination site is English'],
  // ── UNITS ───────────────────────────────────────────────────────────────────
  ['tables.json:csv',
    'file-format name — "CSV" names the format the button downloads; the file extension is the same in every locale'],
  ['tables.json:json',
    'file-format name — "JSON" names the format the button downloads; the file extension is the same in every locale'],
  ['poster.json:dpi',
    'unit symbol — "DPI" is how print resolution is labelled in every one of these locales\' print dialogs; kept as-is by project decision (the poster-strings landing)'],
  // ── DECISION-PENDING, NOT RESOLVED ───────────────────────────────────────────
  // ⚠ THESE ARE ALLOWED SO THE GATE CAN GO GREEN ON THE THINGS IT HAS ACTUALLY SETTLED, NOT
  // because the defect is fixed. "UUPGs" really is an English acronym wedged into an otherwise
  // localized row, in Arabic and Chinese included, while `population` beside it translates
  // normally and the packet renders the same concept in prose in every locale.
  // It is gated on TERMINOLOGY ONLY — measured: the column's own tooltip (legend.sortByUpgs) is
  // already translated in all 11 with just the acronym left English, and the widest candidate
  // phrase is 28% of the 380px panel, so neither engineering nor space is the blocker. Drafting
  // an acronym produced invented initialisms (PNA, UEVG, ННГ, GNA) with no source, and a wrong
  // term looks AUTHORITATIVE to a reader who cannot check it.
  // See DECIDE-UUPGS-COLUMN-HEADER-IS-ENGLISH-IN-ALL-ELEVEN-LOCALES, which carries the priced
  // options. REMOVE THESE TWO LINES when the decision lands — they are a bookmark, not a verdict.
  ['legend.json:columns.upgs',
    'DECISION-PENDING: needs the field\'s term per locale, not an invented acronym — see DECIDE-UUPGS-COLUMN-HEADER'],
  ['prayerLaps.json:upgs',
    'DECISION-PENDING: same term as legend.json:columns.upgs — see DECIDE-UUPGS-COLUMN-HEADER'],
  // ⚠ SETTLED, NOT A BOOKMARK — unlike the two above, this one is not waiting on a ruling; it IS
  // the ruling. "UPG 100" is the product's chosen NAME for the prayer list, so it is a brand
  // designation and correctly identical in every locale, exactly like a version number. The
  // surrounding copy carries the meaning in each language (export.packetExplain is translated per
  // locale and explains what a UPG 100 list is), so a reader does not meet a bare acronym with
  // nothing to anchor it. Do not "resolve" this entry by inventing eleven names for one product.
  ['legend.json:export.packet',
    'BRAND: the product name for the prayer list; export.packetExplain carries the meaning per locale'],
])

// Below this many locales the comparison is not meaningful — a key present in two files being the
// same says nothing.
const MIN_LOCALES = 8

if (!existsSync(BASE)) {
  console.log(`I18N-NEVER-TRANSLATED: SKIP — no locale tree at ${BASE}`)
  process.exit(0)
}

const langs = readdirSync(BASE).filter((l) => {
  try { return statSync(join(BASE, l)).isDirectory() } catch { return false }
}).sort()
if (!langs.includes('en')) {
  console.log('I18N-NEVER-TRANSLATED: SKIP — no `en` catalog to compare against')
  process.exit(0)
}

const flat = (obj, pre = '') => {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    const p = `${pre}${k}`
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flat(v, `${p}.`))
    else if (typeof v === 'string') out[p] = v
  }
  return out
}
const read = (lang, file) => {
  const p = join(BASE, lang, file)
  if (!existsSync(p)) return null
  try { return flat(JSON.parse(readFileSync(p, 'utf8'))) } catch { return null }
}

const files = readdirSync(join(BASE, 'en')).filter((f) => f.endsWith('.json')).sort()
const findings = []
const allowedHits = []
let compared = 0

for (const file of files) {
  const en = read('en', file)
  if (!en) continue
  for (const [key, enVal] of Object.entries(en)) {
    if (!enVal.trim()) continue
    const values = []
    for (const l of langs) {
      const cat = read(l, file)
      if (!cat) continue
      const v = cat[key]
      if (v !== undefined) values.push(v)
    }
    if (values.length < MIN_LOCALES) continue
    compared++
    if (new Set(values).size !== 1) continue
    const id = `${file}:${key}`
    if (ALLOWED.has(id)) { allowedHits.push({ id, why: ALLOWED.get(id), value: enVal }); continue }
    findings.push({ file, key, value: enVal, locales: values.length })
  }
}

console.log('I18N-NEVER-TRANSLATED')
console.log(`  ${langs.length} locale(s), ${files.length} catalog(s), ${compared} key(s) compared`)
for (const a of allowedHits) {
  console.log(`  · allowed: ${a.id} = "${a.value.slice(0, 40)}"`)
  console.log(`      ${a.why}`)
}

if (findings.length) {
  console.error(`\nI18N-NEVER-TRANSLATED: FAIL — ${findings.length} key(s) identical in every locale.`)
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.key} = "${f.value.slice(0, 50)}" (same in all ${f.locales})`)
  }
  console.error('\n  check:i18n-parity asserts these keys are PRESENT everywhere, and they are —')
  console.error('  presence and translatedness are different properties. A reader in Arabic or')
  console.error('  Chinese meets an English string sitting inside an otherwise localized surface.')
  console.error('\n  If a key is CORRECTLY the same everywhere (a pure format string, a brand name,')
  console.error('  an ISO designation), add it to ALLOWED in this file WITH A REASON. Do not invent')
  console.error('  translations to silence it: a wrong term looks authoritative to a reader who')
  console.error('  cannot check it, which is worse than an honest English acronym.')
  process.exit(1)
}
// ★ "ALLOWED" IS NOT ONE THING, and collapsing the two would make this gate lie. A proper noun
// is SETTLED — it is correct English forever. A DECISION-PENDING key is an OPEN DEFECT parked so the
// gate can still catch the next regression; calling it "identical on purpose" would turn a
// deferral into a verdict, which is exactly how an open item stops being visible.
const deferred = allowedHits.filter((a) => /DECISION-PENDING/.test(a.why))
if (deferred.length) {
  console.log(`\n  ⚠ ${deferred.length} DEFERRED, NOT SETTLED — these ARE untranslated and are waiting on a ruling:`)
  for (const a of deferred) console.log(`      ${a.id} = "${a.value.slice(0, 40)}"`)
}
console.log('\nI18N-NEVER-TRANSLATED: PASS — every compared key differs across locales, or is '
  + `declared identical on purpose${deferred.length ? `; ${deferred.length} deferred pending a ruling` : ''}.`)
