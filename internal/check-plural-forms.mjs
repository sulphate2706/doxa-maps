/**
 * check-plural-forms.mjs — the three things a CLDR pluralRules map can silently break.
 *
 * Installing a pluralRules map changes how EVERY existing pipe string is indexed, so this gate is
 * the precondition for that map and the guard afterwards. Three assertions, all of which can fail:
 *
 *  1. FORM COUNT. A locale's pipe string must supply as many forms as its CLDR categories, or the
 *     pick runs off the end of the list and silently clamps — ru needs 3+, ar needs 6.
 *  2. THE tStatic PATH. Seven bundles install no vue-i18n at all and read strings through tStatic,
 *     which does no plural selection whatsoever: a pipe string reaches the page as the literal
 *     "a | b | c". So no pipe key may be read through tStatic/useOptionalT.
 *  3. ZERO. vue-i18n's 3-form default is zero|one|many, but CLDR for en is one|other — so an
 *     English string written "none | one | {n}" changes MEANING at n=0 under the map. Every pipe
 *     key is rendered at 0 and must not regress.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOC_DIR = new URL('../library/i18n/locales/', import.meta.url).pathname
const SRC_DIRS = [new URL('../plugin-designs/', import.meta.url).pathname, new URL('../library/', import.meta.url).pathname]
// DIRECTORIES ONLY. This listed every entry, so a README.md beside the locale folders entered
// the locale list, passed the existsSync below (a file does exist) and crashed readdirSync on a
// non-directory. A note explaining a catalogue belongs beside it; the gate has to tolerate one.
const LOCALES = readdirSync(LOC_DIR).filter((d) => !d.startsWith('.') && statSync(join(LOC_DIR, d)).isDirectory())
const fail = []

// Collect every pipe-bearing catalogue value, as ns.key -> { locale: value }
const pipes = {}
for (const loc of LOCALES) {
  const dir = join(LOC_DIR, loc)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const ns = f.slice(0, -5)
    let doc
    try { doc = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
    const walk = (o, path) => {
      if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k) }
      else if (typeof o === 'string' && o.includes('|')) {
        // A literal pipe inside prose is not a plural form; require the vue-i18n " | " shape.
        if (!/\s\|\s/.test(o)) return
        ;(pipes[`${ns}.${path}`] ||= {})[loc] = o
      }
    }
    walk(doc, '')
  }
}

// ── 1. FORM COUNT vs CLDR categories ──────────────────────────────────────────────────────────
const catCount = (loc) => {
  try { return new Intl.PluralRules(loc).resolvedOptions().pluralCategories.length } catch { return 2 }
}
for (const [key, byLoc] of Object.entries(pipes)) {
  for (const [loc, val] of Object.entries(byLoc)) {
    const forms = val.split(/\s\|\s/).length
    const need = catCount(loc)
    if (forms < need) fail.push(`FORM COUNT ${key} @${loc}: ${forms} form(s) for ${need} CLDR categories — the pick clamps`)
  }
}

// ── 1b. AUTHORING ORDER — the forms must be in the locale's CLDR order, not English's ──────────
// vue-i18n's own rule for English reads zero|one|other; every other locale is picked by CLDR into its
// OWN categories (de one|other, es one|many|other). A string copied in English order therefore picks the
// wrong form while its form COUNT looks fine — measured: German printed "27 Land", Spanish "1 países".
// Two signatures of English order, both impossible in a correctly ordered string:
//   · 3 forms in a locale with 2 categories (de, hi): the extra form is English's zero
//   · 3 forms in a 3-category locale where the first equals the last and the middle differs: "N plural |
//     N singular | N plural" is English's zero|one|other, never CLDR's one|many|other
for (const [key, byLoc] of Object.entries(pipes)) {
  for (const [loc, val] of Object.entries(byLoc)) {
    if (loc === 'en') continue
    const f = val.split(/\s\|\s/)
    const need = catCount(loc)
    if ((f.length === 3 && need === 2) || (f.length === 3 && need === 3 && f[0] === f[2] && f[1] !== f[0])) {
      fail.push(`ORDER ${key} @${loc}: authored in English zero|one|other order — CLDR picks the wrong form (write it as the locale's own categories: ${(() => { try { return new Intl.PluralRules(loc).resolvedOptions().pluralCategories.join('|') } catch { return '?' } })()})`)
    }
  }
}

// ── 2. no pipe key on the tStatic / useOptionalT path ─────────────────────────────────────────
const sources = []
const collect = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) collect(p)
    else if (/\.(vue|js|mjs)$/.test(e.name)) sources.push(p)
  }
}
for (const d of SRC_DIRS) if (existsSync(d)) collect(d)
for (const key of Object.keys(pipes)) {
  for (const p of sources) {
    const src = readFileSync(p, 'utf8')
    if (new RegExp(`(?:tStatic|optionalT|useOptionalT)\\s*\\(\\s*['"\`]${key.replace('.', '\\.')}`).test(src)) {
      fail.push(`tStatic PATH ${key} read in ${p.split('/').slice(-2).join('/')} — tStatic does no plural selection, the page would show "a | b | c"`)
    }
  }
}

// ── 3. ZERO is rendered for every pipe key ────────────────────────────────────────────────────
// Asserted structurally: a locale whose CLDR set has an explicit `zero` category must author one,
// and any string relying on a bare 0-form must say so rather than lean on vue-i18n's old index.
for (const [key, byLoc] of Object.entries(pipes)) {
  for (const [loc, val] of Object.entries(byLoc)) {
    let cats = []
    try { cats = new Intl.PluralRules(loc).resolvedOptions().pluralCategories } catch { cats = [] }
    if (cats.includes('zero') && val.split(/\s\|\s/).length < cats.length) {
      fail.push(`ZERO ${key} @${loc}: locale has an explicit CLDR 'zero' category and the string does not author it`)
    }
  }
}

if (fail.length) {
  console.error('PLURAL-FORMS: FAIL')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
const n = Object.keys(pipes).length
console.log(`PLURAL-FORMS: PASS — ${n} plural key(s) across ${LOCALES.length} locale(s): form counts cover their CLDR categories and are written in the locale's own order, none is read through tStatic, and every zero-category locale authors its zero form.`)
