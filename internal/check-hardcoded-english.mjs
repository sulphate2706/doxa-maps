#!/usr/bin/env node
/**
 * check-hardcoded-english — user-visible English that never reaches a translator. Headless.
 *
 * ONE GATE INSTEAD OF FOUR PRIVATE SCANNERS. sr, upg100, gospel and regions each wrote one of these
 * on 2026-09-28 and each found real defects; four copies means four sets of blind spots and four
 * allow-lists drifting apart. This is the merge, and every rule below earns its place from a defect
 * one of those scanners actually caught.
 *
 * ★ PARSED, NEVER REGEXED. A regex for string literals matches from the CLOSING quote of one to the
 * OPENING quote of the next, so a file with adjacent imports yields phantom "strings" — the first
 * version of regions' scanner reported 137 of them. Templates go through @vue/compiler-sfc and
 * scripts through @babel/parser.
 *
 * ★ ALIASES ARE DISCOVERED, NOT LISTED. `const t2 = t` defeats a callee-name check, and that cost a
 * false positive. The alias set is read out of each file (`const X = t`), so a rename cannot make
 * translated text look hardcoded.
 *
 * ★ te()-GUARDED FALLBACKS ARE NOT LEAKS. `te(key) ? t(key) : 'Some English'` is the documented way
 * to fall back when a key is absent; the English is reachable only when no translation exists. A
 * literal inside a conditional whose test calls te() is therefore allowed (sr's pattern).
 *
 * ⚠ SECOND BLIND SPOT, AND IT BIT ON THE FIRST DAY. A guarded fallback is judged by its SHAPE, not
 * by whether the lookup it guards actually works. `msg !== 'messages.engineMissing' ? msg : 'English'`
 * is treated as a fallback — but if the key is looked up with the wrong prefix, the lookup ALWAYS
 * misses and the English arm becomes the NORMAL path, in every locale, while this gate stays quiet.
 * That is exactly what a later review found in cities-internet after the same line had been triaged as
 * "not a leak". A hardcoded-English scan cannot see a misconfigured lookup; check:i18n-keys-exist and a
 * locale render are what catch that. Treat a guarded fallback as "not a leak HERE", never as "this
 * string is not reaching users".
 *
 * ⚠ KNOWN BLIND SPOT, STATED SO NOBODY READS A GREEN RUN AS MORE THAN IT IS: THIS CANNOT SEE
 * SINGLE-WORD STRINGS. A bare 'Other' used as a fallback label is user-visible English and this gate
 * will not report it — regions found eight of them by grep, not with this tool. Single words carry
 * too many non-prose meanings (ids, class fragments, enum values) to flag without drowning the
 * signal. If that trade is ever revisited, the missing piece is context (what the value is ASSIGNED
 * to), not a longer word list.
 *
 * Exit 0 clean, 1 with findings, 2 on a parse error. `--self-test` runs the planted cases only.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { parse } from '@vue/compiler-sfc'
import * as babel from '@babel/parser'
import { productionForGating, stageReason } from './lib/effective-stage.mjs'

// ── what counts as user-visible ─────────────────────────────────────────────────────────────────
const VISIBLE_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label'])
const isProse = (s) => /[A-Za-z]/.test(s) && /[A-Za-z]{2,}/.test(s.trim())

// ── the allow-list: SHAPES first, names only where a shape cannot express it ─────────────────────
// Each entry records the class and why it is not a leak. A shape is preferred over a literal so the
// list does not need editing every time a new font or status code appears.
const ALLOW = [
  { why: 'CSS: declarations, selectors, at-rules — read by the DOM, not by a person',
    test: (s) => /[{}]/.test(s) || /[a-z-]+\s*:\s*[^;]+;/.test(s) || /^\s*@(media|supports|keyframes|font-face)/.test(s) || /^\s*[.#][a-zA-Z]/.test(s) || /^\s*\[[a-z-]+[~|^$*]?=/.test(s) },
  { why: 'HTML fragments: these plugins build popup markup in template literals, so a quasi is often '
       + 'a tag, or the seam between two attributes ("\" alt=\"" / "\" loading=\"lazy\">")',
    test: (s) => /<\/?[a-zA-Z][^>]*>?/.test(s)
      // dir and lang join the list (SR-DIRLANG): `'" dir="'` is the seam between two
      // attributes in a print page assembled by concatenation, and every RTL-aware page writes both.
      // They are the same class as class= and href= — attribute NAMES, not text a reader sees.
      || /\b(class|href|src|alt|loading|width|height|style|id|target|rel|dir|lang)\s*=/.test(s)
      || /^["'>\s]*$/.test(s) || /^<\/|^["']?\s*>/.test(s) },
  { why: 'URLs and url fragments, absolute OR relative (gospel: a relative URL was reported as prose)',
    test: (s) => /^(https?:|\/\/|\/|\?|&|#)/.test(s)
      || /^\.{0,2}\/[^\s]*$/.test(s)
      || (/^[^\s]+\.(json|js|css|svg|png|jpe?g|webp|geojson|csv|html?)$/i.test(s)) },
  { why: 'CSS class/id SUFFIXES built by interpolation (gospel: `${x}-fill`, `${x}-line` read as prose)',
    test: (s) => /^[-_][a-z0-9][a-z0-9-]*$/.test(s) },
  { why: 'custom-element tag names: lowercase and hyphenated, a tag is not a sentence',
    test: (s) => /^<?\/?[a-z][a-z0-9]*(-[a-z0-9]+)+>?$/.test(s) },
  { why: 'BCP-47 locale extensions and language tags (e.g. the latin-digits override)',
    test: (s) => /^-?[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s) || /-u-[a-z]{2}-/.test(s) },
  { why: 'developer error text: a bracketed module prefix or an HTTP status, for the console',
    test: (s) => /^\[[a-z0-9-]+\]/i.test(s) || /^HTTP\b/.test(s) },
  { why: 'DOM id / class / data-key fragments: hyphenated or BEM identifiers, alone or as a class LIST',
    // Every token must carry a separator. That is what tells `rd-card is-open` from `the map`:
    // prose words do not contain hyphens, and this codebase's classes always do. A class list with
    // no hyphen anywhere (`card open`) is deliberately NOT allowed — flagging is the safe direction.
    // A trailing separator is allowed because that is the shape of an id PREFIX built by
    // interpolation — `id="country-${code}"` leaves the quasi "country-".
    test: (s) => s.split(/\s+/).every((tok) => /^[a-z][a-z0-9]*(?:[-_]{1,2}[a-z0-9]*)+$/.test(tok)) },
  { why: 'CSS FUNCTION FRAGMENTS left by splitting a template literal. A quasi is judged alone, so '
       + '`url(${base}/x.svg)` is tested as "url(" and "/x.svg)", and `repeat(${n}, minmax(0, 1fr))` '
       + 'as "repeat(" and ", minmax(0, 1fr))". The WHOLE string is obviously CSS and the existing CSS '
       + 'shape matches it, but no fragment carries a brace or a colon-value pair, so each one fell '
       + 'through and was reported as English. Measured 2026-09-29: this was 3 of my 94 findings.',
    test: (s) => /^[a-z-]+\($/.test(s)
      || /^[,)\s]*[a-z-]+\([^)]*\)[,)\s]*$/.test(s)
      || /^[,)\s]+$/.test(s) },
  // ★ DECLARATION SEAMS, the other half of the same split (I18N-EXP-PLAN). Splitting
  // `width:${w}px;height:${h}px` leaves the quasi "px;height:" — a seam BETWEEN two declarations,
  // carrying the tail of one value and the head of the next property. It has a colon but no value
  // and no brace, so every CSS shape above misses it. exp measured these as false leaks in
  // upg-neighbor and prayer-walk-planner once the gate runs over experimental bundles in report mode.
  //
  // ⚠ THE `;` IS WHAT KEEPS PROSE OUT, and it is load-bearing: "12 people:" and "Access in their own
  // language:" have the colon but no semicolon-separated declaration before it. Verified on the case
  // that worries me most — "Pools checked; nothing found:" HAS a semicolon and still stays loud,
  // because the segments either side are not `property: value` pairs.
  { why: 'CSS DECLARATION SEAMS left by splitting a template literal: "px;height:", "; background:"',
    test: (s) => /^[a-z%]*\s*;\s*(?:[a-z-]+\s*:\s*[^;]*;\s*)*[a-z-]+\s*:\s*$/.test(s) },
  { why: 'ID PREFIXES ending in a COLON, built by interpolation: `fam:${x}`, `dial:${x}`, and '
       + 'localStorage keys like `pgg-cards-per-row:${profile}`. The hyphen rule below covers a '
       + 'trailing separator but not a colon, so these read as prose. A prefix is not a sentence: '
       + 'it is one lowercase token, no spaces, ending at the separator.',
    test: (s) => /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*:$/.test(s) },
  { why: 'font family names: typeface identifiers, never translated',
    test: (s) => /^(Bebas Neue|Poppins|Oswald|Figtree|Segoe UI|Helvetica Neue|Times New Roman)$/.test(s) },
  { why: 'engine/provider tokens and well-known proper nouns that are not prose',
    test: (s) => /^(mapbox|maplibre|mercator|globe|Mapbox|MapLibre)$/.test(s) },
  // ★ A SEPARATOR AND A BRAND IS NOT A SENTENCE. `{{ t('gospel.res.gospelAudio') }} · GRN` splits
  // into a keyed half and the text node "· GRN", and only the second reaches this scan. gospel
  // counted 33 findings of that shape (their HARDCODED-ENGLISH-CLASSES, class 1).
  //
  // ⚠ THE NAMES ARE LISTED, NOT PATTERNED. "punctuation then a capitalised word" would swallow
  // "· Not found in any pool" — a real caveat, and exactly the class gospel found 12 live defects
  // hiding in. A name earns its place here by being a publisher or standard that is the same word
  // in every language; anything else stays counted. The separator must be leading: "GRN · and the
  // rest of the sentence" is prose that happens to start with a brand.
  { why: 'a leading separator followed only by never-translate publisher/standard names',
    test: (s) => {
      const NAMES = /^(eBible\.org|PNG\.Bible|Faith Comes By Hearing|JESUS Film|Arclight|Glottolog|Open Bible Stories|Door43|GRN|Zume|Cru|GodTools|Scripture Earth|Deaf Bible Society|DOOR International|knowgod\.com|ISO 639-3|Joshua Project|OpenStreetMap|geoBoundaries)$/
      const m = /^[\s·•|,\-–—]+(.+?)[\s·•|,\-–—]*$/.exec(s)
      return !!m && NAMES.test(m[1].trim())
    } },
  { why: 'CSS MEDIA QUERIES passed to matchMedia, and bare CSS keyword VALUES. Translating a query '
       + 'silently breaks the feature it guards — "(prefers-reduced-motion: reduce)" rendered in '
       + 'another language matches nothing, so motion safety turns off for exactly the readers who '
       + 'asked for it. A query is parenthesised feature:value; a value is CSS keywords only.',
    test: (s) => /^\(\s*(?:prefers-|min-|max-|orientation|hover|pointer|display-mode|forced-colors)[a-z-]*\s*:/.test(s)
      || /^(?:top|bottom|left|right|center|start|end)(?:\s+(?:top|bottom|left|right|center|start|end))?$/.test(s) },
  { why: 'LICENCE ATTRIBUTION for map tiles. The credit a data licence requires is the one string '
       + 'that must stay exactly as the licensor wrote it, in every language. These render only when '
       + 'the live sources cannot be read, which is the case a licence never allows to come out empty.',
    test: (s) => /^©/.test(s) && /(OpenStreetMap|OpenFreeMap|OpenMapTiles|Mapbox|Maxar|Esri)/.test(s) },
  { why: 'the PRODUCT NAME: a proper noun, never translated, used as the last-resort poster title',
    test: (s) => /^Doxa Maps?$/.test(s) },
]
const allowedBy = (s) => ALLOW.find((a) => a.test(s))

// ── localisation calls: base names plus aliases discovered per file ──────────────────────────────
function localizedNames(code) {
  // tStatic is the library's own translator for code outside a component's setup (imported from
  // @map/i18n), and leaving it out meant `tStatic('grid.search') || 'English'` — correct, guarded,
  // fully translated code — read as a leak wherever it was used directly rather than behind a wrapper.
  // keyedError(key, 'English', params) (library/i18n/keyedError.js) is a translator call too: its English is
  // the FALLBACK of a catalogue key that errorText() shows in the reader's language, so it is judged like
  // T(key, 'English') — quiet when the key resolves in every locale, a finding when it does not. As a plain
  // call it would have counted every keyed error as a leak, and exempting it like new Error() would have
  // hidden a typo'd key.
  const names = new Set(['t', 'tf', '$t', 'tStatic', 'keyedError'])
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(t|tf)\b\s*(?![(.])/g)) names.add(m[1])
  // WRAPPERS ARE TRANSLATORS TOO. `const T = (key, en) => tStatic(key) || en` is the shape most of
  // these components use, and matching only `const X = t` missed every one of them — the wrapper's
  // own English argument then read as a leak. Recognised by the BODY calling a known translator.
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*([^\n]*)/g)) {
    if (/\b(?:t|tf|\$t|tStatic)\s*\(/.test(m[2])) names.add(m[1])
  }
  return names
}
// Some wrappers bake in an AREA: `const L = (key, en) => tStatic('dashboard.' + key) || en` is
// called as L('align_dashboard') but the catalogue holds dashboard.align_dashboard. Without the
// prefix the key looks unresolvable and a correct fallback keeps counting.
function keyPrefixes(code) {
  const out = new Map()
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*[^\n]*?\b(?:t|tf|\$t|tStatic)\s*\(\s*['"]([\w.\-]+\.)['"]\s*\+/g)) {
    out.set(m[1], m[2])
  }
  return out
}
// ★ A DOM QUERY ARGUMENT IS A SELECTOR, NOT PROSE — and a selector made of custom-element tags
// reads as English only because the tag names are English words. gospel found
// `querySelector("gospel-resources-dashboard, gospel-resources-map")` reported as user-visible text:
// the single-tag rule matched neither, because it is a comma-separated LIST. Exempting by CALL SITE
// is the right shape (as with developer strings) — the site is the fact, and no content rule can
// reliably tell a tag list from a sentence.
const DOM_QUERY = new Set([
  'querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById',
  'getElementsByClassName', 'getElementsByTagName', 'getElementsByName',
])
function isDomQuerySite(parent) {
  return !!parent && parent.type === 'CallExpression'
    && parent.callee?.type === 'MemberExpression'
    && DOM_QUERY.has(parent.callee.property?.name || '')
}

// A literal that is an argument to one of these never reaches a reader, whatever it says.
// ★ CONCATENATION HIDES A DEVELOPER SITE FROM ITS OWN GUARD. `throw new Error(\`head\` + rest)`
// puts a BinaryExpression between the literal and the NewExpression, so the parent check below sees
// the `+` and not the `new Error`. Measured on legend-tree.js:392, a thrown message reported as a
// leak. It is NOT a .js-path bug — a .vue file concatenating inside a throw hits it identically; the
// .js scan just surfaced a shape that is rarer in templates.
//
// Only `+` chains are walked: a string built with + is still the same argument to the same call,
// whereas any other expression type between the two is a different construct and should be judged
// on its own site.
function developerSiteAncestor(parent, stack) {
  if (isDeveloperSite(parent)) return true
  if (!parent || parent.type !== 'BinaryExpression' || parent.operator !== '+') return false
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i]
    if (n.type === 'BinaryExpression' && n.operator === '+') continue
    return isDeveloperSite(n)
  }
  return false
}

function isDeveloperSite(parent) {
  if (!parent) return false
  if (parent.type === 'CallExpression' && parent.callee?.object?.name === 'console') return true
  if (parent.type === 'NewExpression' && /^[A-Z]\w*Error$|^Error$/.test(parent.callee?.name || '')) return true
  if (parent.type === 'CallExpression' && /^[A-Z]\w*Error$|^Error$/.test(parent.callee?.name || '')) return true
  return false
}
const calleeName = (node) => node?.callee?.type === 'Identifier' ? node.callee.name
  : node?.callee?.type === 'MemberExpression' ? (node.callee.property?.name || '') : ''

// ── CROSS-AREA KEYS THROUGH A NAMESPACED TRANSLATOR ─────────────────────────────────────────────
// ★ A REAL BUG, FOUND TWICE IN ONE DAY (pplr a56d06c8, cities-internet 7b3fb78d5), that no gate saw.
// `const t = useOptionalT('connectivity')` then `t('messages.engineMissing')` — qualify() makes that
// `connectivity.messages.engineMissing`, which cannot exist, so the English fallback is the NORMAL
// path in every locale. check:i18n-keys-exist passes it because the key AS WRITTEN does exist; the
// key as QUALIFIED is what misses. The user-visible outcome is identical to a hardcoded string,
// which is why it belongs in this gate: a reader sees English where their language was promised.
// Detected by SHAPE — qualified key absent AND unqualified key present — so it cannot fire on an
// ordinary missing key, which is check:i18n-keys-exist's job, not this one.
const qualifyKey = (ns, key) => (ns && !key.startsWith(`${ns}.`) ? `${ns}.${key}` : key)

const CATALOGUES = new Map()
function catalogueFor(locale, root = '.') {
  const hit = CATALOGUES.get(locale)
  if (hit) return hit
  const cat = {}
  const dir = join(root, `library/i18n/locales/${locale}`)
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try { cat[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { /* skip */ }
    }
  }
  CATALOGUES.set(locale, cat)
  return cat
}
function catalogue(root = '.') { return catalogueFor('en', root) }
// Every locale that ships, read from the tree rather than hardcoded, so adding a locale tightens
// this check automatically instead of silently leaving the new one unguarded.
let LOCALES = null
function locales(root = '.') {
  if (LOCALES) return LOCALES
  const dir = join(root, 'library/i18n/locales')
  LOCALES = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : []
  return LOCALES
}
// `a.b.c` resolves as area `a` then path b.c inside it — the shape library/i18n/index.js builds.
function resolveKey(key, root = '.', locale = 'en') {
  const cat = catalogueFor(locale, root)
  const [area, ...rest] = String(key).split('.')
  let node = cat[area]
  if (node === undefined) return undefined
  for (const seg of rest) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[seg]
    if (node === undefined) return undefined
  }
  return node
}

// ★ A FALLBACK BEHIND A KEY THAT REALLY RESOLVES IS NOT A LEAK. `T('dashboard.map_loading', 'Research
// map loading…')` is the idiom this codebase uses everywhere: the second argument is what shows if the
// catalogue ever loses the key, so the English is a SAFETY NET, not the string the reader gets. Counting
// it made ~19% of the remaining findings correct code, and sent owners off to write translations that
// already existed (sr, 2026-09-29).
//
// The exemption is earned, never assumed, because an unresolved fallback is a REAL leak wearing the
// same shape — a typo'd key renders English forever and looks perfectly correct at the call site. So
// the key must resolve to a non-empty string in EVERY shipped locale, and in no non-English locale may
// it merely echo the English: both of those mean a reader somewhere still sees English, which is the
// defect this gate exists to find. Anything less than fully translated keeps counting.
// Words a translator would actually have to render: placeholders, punctuation and bare numbers are
// not translatable, so "{label} · {count} · {pct}%" counts as zero and never reads as untranslated.
function translatableWords(s) {
  return String(s)
    .replace(/\{[^}]*\}/g, ' ')          // {label} interpolation holes
    .split(/\s+/)
    .filter((w) => /[A-Za-z]{2,}/.test(w))
    .length
}

function fallbackFullyResolved(key, root = '.') {
  const locs = locales(root)
  if (!locs.length) return false                       // no catalogue to vouch for it: cannot exempt
  const en = resolveKey(key, root, 'en')
  if (typeof en !== 'string' || !en.trim()) return false
  for (const loc of locs) {
    const v = resolveKey(key, root, loc)
    if (typeof v !== 'string' || !v.trim()) return false      // missing in one locale = still a leak
    // ★ IDENTICAL-TO-EN IS ONLY EVIDENCE WHEN THERE IS SOMETHING TO TRANSLATE. Measured across this
    // catalogue, the identical entries are overwhelmingly CORRECT: cognates a locale really does
    // share ("Normal" in de, "Auto" in fr, "Total" in es), proper nouns, and format-only strings like
    // "{label} · {count} · {pct}%" that contain no translatable words at all. Failing on every echo
    // would call all of those leaks. A multi-word English SENTENCE reproduced verbatim is the case
    // that actually means untranslated, so that is the one that keeps counting.
    if (loc !== 'en' && v === en && translatableWords(en) >= 3) return false
  }
  return true
}

// ★ THE KEY OF A LOOKUP TABLE IS AN IDENTIFIER, NOT A LABEL. gospel's resources-list has
//     const RES_KEY = { 'Bible video': 'gospel.res.bibleVideo', ... }
//     title: RES_KEY[r.title] ? tr(RES_KEY[r.title]) : r.title
// so the English on the LEFT is matched against a value that arrives in the DATA, and the string a
// reader sees comes from the key on the right. Translating the left side would make every lookup
// miss and fall through to the raw data value — the count would drop while the display broke, which
// is the worst shape a gate finding can have.
//
// Earned, not assumed, exactly as the fallback exemption is: the property's VALUE must be an i18n
// key that really resolves. A table pointing at a key nobody wrote is a real defect — the lookup
// succeeds and hands t() a key the catalogue has never heard of — so that still counts.
// ★ A STRING COMPARED AGAINST DATA IS A VALUE, NOT A LABEL. `scope === 'Full Bible'` tests a cell
// of the shipped resource table; the reader never sees that literal, and the row it selects is
// rendered through a key. Translating it makes the comparison miss and the feature silently stop —
// the same inversion as a lookup-table key, which is why gospel classed them together (their
// HARDCODED-ENGLISH-CLASSES, class 4). Only === and !== count: a loose == against a string is rare
// enough here that leaving it reported costs nothing, and `.includes('…')` is NOT this shape — it
// can be a substring test on user-visible prose.
function isDataComparison(node, parent) {
  if (!parent || parent.type !== 'BinaryExpression') return false
  if (parent.operator !== '===' && parent.operator !== '!==') return false
  return parent.left === node || parent.right === node
}

// ★ A PURE DATA MAP'S KEYS ARE JOIN VALUES, NOT LABELS. territory-counts.js is
//     export const ADM1_COUNTS = { 'Andhra Pradesh': 81, 'Assam': 15, … }
// and those keys are matched against `props.shapeName` off the map data. Translating one breaks the
// join silently — the count goes missing and nothing errors. Same inversion as a lookup table whose
// values are i18n keys, which isResolvedLookupKey already covers; this is the case where the values
// are NUMBERS, so there is no key to resolve and that rule cannot vouch for it.
//
// ⚠ JUDGED ON THE WHOLE OBJECT, NOT ON ONE PROPERTY. A single numeric value proves nothing — a map
// of sentences with one count in it would exempt the sentences. Every value must be a non-key
// literal, and there must be enough of them that the shape is a table rather than a couple of
// options. Below that floor the object is judged property by property, as before.
//
// ⚠ AND THE KEYS THEMSELVES MUST LOOK LIKE IDENTIFIERS, NOT PROSE. "Andhra Pradesh" is a name; "A
// resource not found means NOT FOUND in the pools checked" is a sentence that happens to be used as
// a key, and that is a real leak — gospel found twelve defects hiding in exactly that kind of
// already-classified bucket. Anything with sentence punctuation stays loud whatever its value is.
// ★ REGION IDENTITIES, EXEMPT ONLY WHILE THEY ARE TRANSLATABLE (R26).
// legend-tree's REGION_OF maps a zone slug to a region NAME, and that name is an identity: node ids
// derive from it, and every surface that shows one translates it at render through REGION_KEY —
// upg-100-list.vue:440 `REGION_KEY[english] ? t(\`poster.${…}\`) : english`, poster-wall.vue:129 the
// same. So the English never reaches a reader.
//
// ⚠ THE EXEMPTION IS CONDITIONAL, AND THAT IS THE WHOLE POINT. It holds only for a name that IS a
// key of REGION_KEY. A new region added to REGION_OF without a REGION_KEY entry falls through that
// `|| english` and renders English in all eleven locales — which is precisely the defect upg100
// already shipped once with Americas and Europe. So the rule flags it, and the gate keeps working as
// the table grows instead of blessing the file.
//
// Deliberately NOT "object values" and NOT "legend-tree.js": either would exempt the next table
// nobody has checked. The membership test is what makes this safe to have at all.
function regionKeyNames(code) {
  // ⚠ NO NEWLINE REQUIREMENT. The first version anchored on `\n}` and so never matched a REGION_KEY
  // written on ONE LINE — regionKeyNames returned null, the rule exited early, and BOTH two-sided
  // cases passed without the exemption ever running. Found by poisoning the membership test and
  // seeing nothing fail.
  const m = /\bREGION_KEY\s*=\s*\{([\s\S]*?)\}/.exec(code)
  if (!m) return null
  return new Set([...m[1].matchAll(/'([^']+)'\s*:/g)].map((x) => x[1]))
}
function isTranslatedRegionIdentity(text, code) {
  const names = regionKeyNames(code)
  if (!names || !names.has(text)) return false
  // it must actually be used as a region identity in this file, not merely share a spelling
  return /const REGION_OF\s*=/.test(code) || /regionFor\s*=/.test(code)
}

const DATA_MAP_MIN_ENTRIES = 6
function isPureDataMapKey(node, parent, grand) {
  if (!parent || parent.type !== 'ObjectProperty' || parent.key !== node) return false
  if (!grand || grand.type !== 'ObjectExpression') return false
  const props = grand.properties || []
  if (props.length < DATA_MAP_MIN_ENTRIES) return false
  // every value a plain non-key literal: a number, a boolean, or a short bare token
  const allData = props.every((p) => {
    if (p.type !== 'ObjectProperty') return false
    const v = p.value
    if (v?.type === 'NumericLiteral' || v?.type === 'BooleanLiteral' || v?.type === 'NullLiteral') return true
    if (v?.type === 'UnaryExpression' && v.argument?.type === 'NumericLiteral') return true   // -1
    // a short lowercase token ('scripture', 'film') is an identifier, not a sentence
    if (v?.type === 'StringLiteral') return /^[a-z][\w-]{0,24}$/.test(v.value)
    return false
  })
  if (!allData) return false
  // the KEY must read as a name or an identifier, never as a sentence
  const key = node.value
  if (/[.!?;:]|\s—\s|\bthe\b.*\bthe\b/i.test(key)) return false
  // Eight, not six: "Dādra and Nagar Haveli and Damān and Diu" is one real Indian union territory
  // and the longest key in a 46-entry join table. A place name is still not a sentence — the
  // punctuation test above is what separates them, not the length.
  return key.split(/\s+/).length <= 8
}

function isResolvedLookupKey(node, parent, grand) {
  // the literal must BE the property's key, not its value
  if (!parent || parent.type !== 'ObjectProperty' || parent.key !== node) return false
  if (!grand || grand.type !== 'ObjectExpression') return false
  const v = parent.value
  if (v?.type !== 'StringLiteral') return false
  // a dotted key shape, and it has to resolve — a bare category like 'scripture' is not a key
  // A dotted key resolves directly. A BARE key is a SUFFIX the caller prefixes — legend-tree's
  // REGION_KEY maps 'Middle East' -> 'region_middle_east' and the call site reads
  // t(`poster.${REGION_KEY[english]}`). Try the bare value against every area rather than
  // rejecting it, so a suffix table is exempt on the same terms: the key it names must resolve.
  if (/^[a-z][\w-]*(\.[\w-]+)+$/i.test(v.value)) return fallbackFullyResolved(v.value)
  if (/^[a-z][\w]*(_[\w]+)*$/i.test(v.value)) {
    for (const area of Object.keys(catalogue())) {
      if (fallbackFullyResolved(`${area}.${v.value}`)) return true
    }
  }
  return false
}

// The `T('a.key', 'English')` / `L('key', 'English')` / `tStatic('a.key') || 'English'` shapes, seen
// from the English literal looking outward. `names` is the set of translator identifiers already
// resolved for this file, so an alias is recognised without being named here.
function resolvedFallbackOf(node, parent, stack, names, root = '.') {
  // form 1: the literal is the SECOND argument of a translator call
  if (parent && parent.type === 'CallExpression' && names.has(calleeName(parent)) &&
      parent.arguments.length >= 2 && parent.arguments[1] === node) {
    const k = parent.arguments[0]
    if (k?.type === 'StringLiteral') return k.value
  }
  // form 2: the literal is the RIGHT side of `t(…) || 'English'` or `t(…) ?? 'English'`
  const lg = stack[stack.length - 1]
  if (lg && lg.type === 'LogicalExpression' && (lg.operator === '||' || lg.operator === '??') && lg.right === node) {
    // `||` is left-associative, so `config || t('key') || 'English'` parses with the whole
    // `config || t('key')` on the left. The translator is the LAST alternative before the English,
    // which is the rightmost call down that spine — a real shape here: an instance may override the
    // wording, otherwise the catalogue, and the English only if neither exists.
    let call = lg.left
    while (call?.type === 'LogicalExpression' && (call.operator === '||' || call.operator === '??')) call = call.right
    if (call?.type === 'CallExpression' && names.has(calleeName(call))) {
      const k = call.arguments[0]
      if (k?.type === 'StringLiteral') return k.value
    }
  }
  return null
}

// ★ WRAPPER FACTORIES CARRY THE NAMESPACE ONE INDIRECTION AWAY, and missing that is why the first
// version of this check caught cities-internet but NOT pplr — the bug it was written for. pplr does
// `const t = usePplrT()` with NO argument, and usePplrT() is `return useOptionalT('pplr')`. A check
// that only reads a literal argument sees no namespace and stays silent on the exact defect twice
// over. So wrappers are resolved from source first.
let WRAPPERS = null
function wrapperNamespaces(root = '.') {
  if (WRAPPERS) return WRAPPERS
  WRAPPERS = {}
  const roots = [join(root, 'library/composables'), join(root, 'plugin-designs')]
  const visit = (d, depth = 0) => {
    if (depth > 4 || !existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|dist/.test(e.name)) visit(f, depth + 1); continue }
      if (!e.name.endsWith('.js')) continue
      let src = ''
      try { src = readFileSync(f, 'utf8') } catch { continue }
      for (const m of src.matchAll(/export\s+function\s+(use[A-Za-z]*T)\s*\([^)]*\)\s*\{[^}]*useOptionalT\s*\(\s*['"]([^'"]+)['"]/g)) {
        WRAPPERS[m[1]] = m[2]
      }
    }
  }
  roots.forEach((r) => visit(r))
  return WRAPPERS
}

// `const t = useOptionalT('connectivity')` → { t: 'connectivity' }
// `const t = usePplrT()`                   → { t: 'pplr' }, via the wrapper map above
function namespacedTranslators(code, root = '.') {
  const map = {}
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*use[A-Za-z]*T\s*\(\s*['"]([^'"]+)['"]/g)) map[m[1]] = m[2]
  const wrappers = wrapperNamespaces(root)
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(use[A-Za-z]*T)\s*\(\s*\)/g)) {
    if (wrappers[m[2]]) map[m[1]] = wrappers[m[2]]
  }
  return map
}

export function crossAreaKeys(code, file, root = '.') {
  const out = []
  const ns = namespacedTranslators(code, root)
  if (!Object.keys(ns).length) return out
  let ast
  try { ast = babel.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true }) } catch { return out }
  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return
    const name = node.callee?.type === 'Identifier' ? node.callee.name : ''
    if (!ns[name]) return
    const arg = node.arguments?.[0]
    if (arg?.type !== 'StringLiteral' || !arg.value.includes('.')) return
    const qualified = qualifyKey(ns[name], arg.value)
    if (resolveKey(qualified, root) !== undefined) return          // resolves: fine
    if (resolveKey(arg.value, root) === undefined) return          // plain missing key: keys-exist's job
    out.push({ file, kind: 'cross-area-key', text: `${name}('${arg.value}') → ${qualified} (never resolves; '${arg.value}' does)` })
  })
  return out
}

// ── LITERAL STRINGS PASSED AS PROPS ─────────────────────────────────────────────────────────────
// ★ THE THIRD FALSE-NEGATIVE CLASS, and the gate is structurally unable to confirm it (gospel).
// poster-wall.vue passes `unit="UPG" item-noun="list"` to <PosterWall>, and PosterWall.vue renders
// `{{ itemNoun }}` and `{{ unit }}` as visible text. Neither file shows a leak to a template scan:
// in the plugin it is an attribute VALUE, in the library it is an interpolation of a VARIABLE. The
// English and the render live in different files, so no single-file rule can join them.
// Reported as SUSPECT, never counted as a leak, because whether the child renders the prop is not
// knowable from here — the child may use it as a key, an id, or an event name. A suspect is a
// question for a human, and calling it a defect would make the count untrustworthy in the other
// direction.
const PROP_HINT = /noun|label|title|unit|text|heading|intro|placeholder|caption/i
// Component tags only: PascalCase, or hyphenated custom elements. A plain <div> takes attributes,
// not props, and its visible ones are already covered by VISIBLE_ATTRS.
const isComponentTag = (tag) => /^[A-Z]/.test(tag) || /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)

function literalProps(node, file, out) {
  if (node.type !== 1 || !isComponentTag(node.tag || '')) return
  for (const p of node.props || []) {
    if (p.type !== 6 || !p.value?.content) continue          // static attribute only
    if (!PROP_HINT.test(p.name)) continue
    const text = String(p.value.content).trim()
    if (!text.length || !isProse(text) || allowedBy(text)) continue
    out.push({ file, kind: `suspect-prop:${p.name}`, text: `<${node.tag} ${p.name}="${text}">`, suspect: true, line: p.loc?.start?.line ?? node.loc?.start?.line ?? 0 })
  }
}

// ── the walk ────────────────────────────────────────────────────────────────────────────────────
function walkAst(node, visit, parent = null, stack = []) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent, stack)
  const next = [...stack, node]
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue
    const v = node[k]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walkAst(c, visit, node, next) }
    else if (v && typeof v.type === 'string') walkAst(v, visit, node, next)
  }
}
// A literal is a GUARDED FALLBACK — reachable only when a translation is absent — in two shapes:
//   · te(key) ? t(key) : 'English'        the documented existence check (sr)
//   · t.search || 'Search…'               a PROXY t whose member read misses (people-groups-grid)
// Both mean "the catalogue had nothing", so the English is the designed last resort rather than a
// string that skipped translation. Ancestors are walked, not just the immediate parent, because the
// fallback is often nested (`a ?? (te(k) ? t(k) : 'X')`).
function guardedFallback(stack, names) {
  return stack.some((n) => {
    if (n.type !== 'ConditionalExpression' && n.type !== 'LogicalExpression') return false
    let found = false
    walkAst(n.test || n.left, (x) => {
      if (x.type === 'CallExpression' && /^te$/.test(calleeName(x))) found = true
      // a member read on a localisation object or alias: t.search, i18n.t.search
      if (x.type === 'MemberExpression' && x.object?.type === 'Identifier' && names.has(x.object.name)) found = true
      // THE "DID t() RETURN THE KEY?" IDIOM. vue-i18n returns the key itself when it is missing, so
      // `msg !== 'messages.engineMissing' ? msg : 'English'` is a miss check and its English arm is a
      // fallback. Matched on the KEY SHAPE (dotted, no spaces) rather than on any string comparison,
      // so an ordinary `x !== 'yes'` is not mistaken for one. (cities-internet, triaged 2026-09-28.)
      if (x.type === 'BinaryExpression' && /^[!=]==?$/.test(x.operator)) {
        for (const side of [x.left, x.right]) {
          if (side?.type === 'StringLiteral' && /^[a-z][\w-]*(\.[\w-]+)+$/.test(side.value)) found = true
        }
      }
    })
    return found
  })
}

// A node's own line, shifted into file coordinates. Babel counts from 1, so a block that itself
// starts at line N puts its first line at N, not N+1 — hence the -1. Missing loc (errorRecovery can
// produce it) degrades to the block start rather than to a confident 0.
function lineOf(node, lineBase) {
  const l = node?.loc?.start?.line
  return typeof l === 'number' ? l + lineBase - (lineBase ? 1 : 0) : (lineBase || 0)
}

// ★ A FINDING WITHOUT A LINE COSTS THE READER THE SEARCH. Reporting only file + text means every
// owner re-derives the site by grepping the string, and the FIRST textual match is very often a
// comment that discusses the string rather than the code that renders it — sr triaged two findings
// to the wrong site that way before adding this. `lineBase` maps a parsed block's own coordinates
// back onto the file: 0 for a whole script block that starts at line 1, the block's start line
// otherwise, and the attribute's line for a bound expression (which is re-parsed standalone, so its
// internal numbering describes the fragment and not the file).
function scanScript(code, file, out, lineBase = 0) {
  const names = localizedNames(code)
  const prefixes = keyPrefixes(code)
  const ast = babel.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true })
  walkAst(ast, (node, parent, stack) => {
    const isStr = node.type === 'StringLiteral'
    const isTpl = node.type === 'TemplateLiteral'
    if (!isStr && !isTpl) return
    // ★ THE KEY ARGUMENT IS EXEMPT; THE FALLBACK ARGUMENT MUST EARN IT. `t('a.key')` is never a leak,
    // but `T('a.key', 'English')` is only correct if that key resolves — a typo'd key renders the
    // English forever while looking right at the call site. Exempting every argument of a translator
    // call, as this rule used to, made the gate structurally unable to see that defect. The fallback
    // argument therefore falls through to the resolution test below.
    if (parent && parent.type === 'CallExpression' && names.has(calleeName(parent))) {
      const isFallbackArg = parent.arguments.length >= 2 && parent.arguments[1] === node
      if (!isFallbackArg) return   // t('…')
    }
    // ★ DEVELOPER STRINGS ARE EXEMPT BY CALL SITE, NOT BY CONTENT (upg100). `throw new Error('…')`
    // and console.* never reach a reader, and judging them by their text means inventing a rule for
    // every sentence a developer might write. The SITE is the fact; the wording is not.
    if (developerSiteAncestor(parent, stack) || isDomQuerySite(parent)) return
    if (parent && /Import|Export/.test(parent.type)) return
    if (parent && parent.type === 'TaggedTemplateExpression') return
    if (guardedFallback(stack, names)) return
    // A fallback whose key really resolves everywhere is correct code. An unresolved one is not,
    // and keeps counting — so the key is looked up, not merely observed to be present.
    const fbKey = resolvedFallbackOf(node, parent, stack, names)
    if (fbKey !== null) {
      const callee = parent?.type === 'CallExpression' ? calleeName(parent) : calleeName(stack[stack.length - 1]?.left)
      const full = (prefixes.get(callee) || '') + fbKey
      if (fallbackFullyResolved(full)) return
    }
    // An English key in a table whose value is a real i18n key: an identifier the data is matched
    // against, never a string the reader sees.
    // stack's last entry IS the parent, so the enclosing object is one further back.
    if (isResolvedLookupKey(node, parent, stack[stack.length - 2])) return
    // A pure data map's keys are join values — see isPureDataMapKey.
    if (isPureDataMapKey(node, parent, stack[stack.length - 2])) return
    // A literal tested against data with === is a value the reader never sees.
    if (isDataComparison(node, parent)) return

    if (isStr) {
      const text = node.value.trim()
      if (!text.length || !isProse(text)) return   // gospel: empty matches were being reported
      if (!/\s/.test(text)) return                 // ⚠ the single-word blind spot, documented above
      if (allowedBy(text)) return
      // A region identity translated at render — exempt only while REGION_KEY names it.
      if (isTranslatedRegionIdentity(text, code)) return
      out.push({ file, kind: 'script-string', text, line: lineOf(node, lineBase) })
      return
    }
    // ★ ONE TEMPLATE LITERAL IS ONE FINDING (upg100). Reporting each quasi separately turned a single
    // string into 'polys ·', 'zones ·', 'px;' — three hits for one defect, which inflates every count
    // and makes a triage list read as worse than the code is. Each quasi is still JUDGED on its own,
    // so an allow-listed fragment cannot drag a whole literal in; only the REPORT is joined.
    const quasis = node.quasis.map((q) => String(q.value.cooked ?? q.value.raw ?? ''))
    const leaks = quasis.some((raw) => {
      const text = raw.trim()
      return text.length && isProse(text) && !allowedBy(text)
    })
    if (!leaks) return
    const whole = quasis.map((q) => q.trim()).filter(Boolean).join(' {…} ').trim()
    out.push({ file, kind: 'template-literal', text: whole, line: lineOf(node, lineBase) })
  })
}

// ★ BOUND ATTRIBUTES HIDE LEAKS FROM A TEMPLATE WALKER. `:title="`Sort by ${col}`"` is a DIRECTIVE
// whose value is an EXPRESSION, not a static attribute, so a scan that reads only static attrs sees
// nothing — a blind spot every one of the four private scanners shared (sr, 2026-09-28; real case
// DashboardDataTable.vue:884). The expression is parsed with the same rules as a script block, so a
// literal inside t()/tf(), or behind a te() guard, still passes.
// Just the translator DECLARATION lines of a script block — never the whole block, whose own strings
// would then be re-reported once per bound expression in the file. Each is rewritten to a bare stub:
// only the NAME and any baked-in key prefix matter to the fallback test, and a stub carries no English
// of its own to be counted.
function translatorDecls(code) {
  const out = []
  for (const name of localizedNames(code)) {
    if (name === 't' || name === 'tf' || name === '$t') continue
    const pfx = keyPrefixes(code).get(name)
    // NB the stub must contain no `||`/`??` and no te() guard of its own: guardedFallback keys on
    // exactly those shapes, so a stub written the natural way exempts every fallback in the file
    // whether its key resolves or not — the over-exemption this whole check exists to avoid.
    out.push(pfx ? `const ${name} = (k, en) => t('${pfx}' + k)` : `const ${name} = t`)
  }
  return out.join('\n')
}

// ★ A BOUND EXPRESSION IS PARSED ALONE, SO IT CANNOT SEE ITS OWN TRANSLATOR. `{{ T('a.key', 'English') }}`
// is scanned as the fragment `(T('a.key', 'English'))`, where `T` is an unknown identifier — the
// component's `const T = (key, en) => …` lives in the script block, which is not in the fragment. The
// translator declarations are therefore carried in and prepended, so the template half of a file judges
// a fallback by exactly the rules the script half does. Without this the exemption fired in <script>
// and not in <template>, which is the worse of the two possible inconsistencies: it reads as though the
// gate has an opinion about WHERE a correct idiom is allowed.
function scanBoundExpr(expr, file, attrName, out, line = 0, decls = '') {
  const code = String(expr || '').trim()
  if (!code) return
  const found = []
  try { scanScript(`${decls}\n;(${code})`, file, found) } catch { return }   // not parseable as an expression: skip
  // The fragment was parsed alone, so `f.line` numbers the fragment; the ATTRIBUTE's line is the
  // fact the reader needs. A multi-line bound expression therefore reports its opening line.
  for (const f of found) out.push({ file, kind: `bind:${attrName}`, text: f.text, line })
}

// ★ dir="ltr" MARKS TEXT THAT IS MEANT TO STAY ENGLISH. gospel's plugins use it as the island
// marker for content ruled to stay English (a BLUF, a source citation), so flagging it as a
// leak would ask someone to "fix" a deliberate decision. Such findings are marked deliberate, listed
// SEPARATELY, and excluded from the count a gate would fail on — visible, but not a defect.
// Inherited down the subtree: a dir="ltr" wrapper covers everything inside it.
// ★ ONLY A STATIC dir="ltr" MARKS AN ISLAND, and getting this wrong blinded a whole plugin.
// The first version also accepted a BOUND :dir whose expression merely CONTAINED 'ltr' — which
// matches `:dir="isRTL ? 'rtl' : 'ltr'"`, the correct locale-aware direction switch that every
// RTL-ready component puts on its ROOT. The effect was that such a component's entire template was
// treated as deliberate English and every leak in it silenced. regions-dashboard read 0 for exactly
// that reason: not clean, BLIND. A dynamic direction switch is the OPPOSITE of "this stays English"
// — it is the component promising to follow the reader's locale.
const hasLtr = (node) => (node.props || []).some((p) =>
  p.type === 6 && p.name === 'dir' && p.value?.content === 'ltr')

function walkTemplate(node, file, out, ltr = false, decls = '') {
  if (!node) return
  // ★ NAME THE ISLAND THAT SUPPRESSED A STRING, not just the fact of suppression. The deliberate
  // bucket is the one place where over-claiming costs nothing and shows nothing: a 74-line island
  // hiding 27 strings and a one-line <bdi> read identically in a flat count. gospel found exactly
  // that on their own card — an island they believed was a caveat turned out to cover the honesty
  // prose as well. An island is an object with a size, so the report gives it one.
  const own = node.type === 1 && hasLtr(node)
  const inLtr = ltr || own
  const island = own
    ? { file, line: node.loc?.start?.line ?? 0, endLine: node.loc?.end?.line ?? 0, tag: node.tag || 'element' }
    : (ltr && typeof ltr === 'object' ? ltr : null)
  if (node.type === 2) {
    const raw = String(node.content || '').trim()
    if (raw.length && isProse(raw) && !allowedBy(raw)) out.push({ file, kind: 'template-text', text: raw, deliberate: !!inLtr, island, line: node.loc?.start?.line ?? 0 })
  }
  if (node.type === 1) literalProps(node, file, out)
  if (node.type === 1) for (const p of node.props || []) {
    if (p.type === 6 && VISIBLE_ATTRS.has(p.name)) {
      const v = p.value && p.value.content
      if (v && isProse(v) && !allowedBy(v)) out.push({ file, kind: `attr:${p.name}`, text: v, deliberate: !!inLtr, island, line: p.loc?.start?.line ?? node.loc?.start?.line ?? 0 })
    }
    // (interpolations are handled below, on the node itself)
    // type 7 = DIRECTIVE. v-bind carries the attribute name in `arg`.
    if (p.type === 7 && p.name === 'bind' && p.exp?.content) {
      const attrName = p.arg?.content || 'bind'
      // :style and :class carry CSS and identifiers, never prose. Skipping them by ATTRIBUTE is
      // better than allow-listing their contents: `background-image: url(` has no semicolon and so
      // slipped the CSS shape test, and widening that test to catch it would start swallowing real
      // sentences that happen to contain a colon.
      if (attrName !== 'style' && attrName !== 'class') {
        const before = out.length
        scanBoundExpr(p.exp.content, file, attrName, out, p.loc?.start?.line ?? node.loc?.start?.line ?? 0, decls)
        for (let i = before; i < out.length; i++) { out[i].deliberate = !!inLtr; out[i].island = island }
      }
    }
  }
  // type 5 = INTERPOLATION. `{{ cond ? 'Yes' : 'No' }}` is the same defect as a bound attribute —
  // a literal the reader sees, assembled in an expression the template walker would otherwise skip.
  // `{{ t('Foo') }}` stays quiet because the expression is parsed with the same translator rules.
  if (node.type === 5 && node.content?.content) {
    const before = out.length
    scanBoundExpr(node.content.content, file, 'interpolation', out, node.loc?.start?.line ?? 0, decls)
    for (let i = before; i < out.length; i++) { out[i].deliberate = !!inLtr; out[i].island = island }
  }
  for (const c of node.children || []) walkTemplate(c, file, out, island || inLtr, decls)
}

export function scanSfc(src, file) {
  const out = []
  const { descriptor, errors } = parse(src, { filename: file })
  if (errors && errors.length) throw new Error(`${file}: ${errors[0].message}`)
  const scriptSrc = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n')
  if (descriptor.template && descriptor.template.ast) walkTemplate(descriptor.template.ast, file, out, false, translatorDecls(scriptSrc))
  // ★ SCANNED SEPARATELY, NOT JOINED. Concatenating <script> and <script setup> made every line
  // number in the second block wrong by the length of the first, which is worse than no line at
  // all — a confident wrong site sends the reader to unrelated code. Each block carries its own
  // start line, so each is parsed in its own coordinates. crossAreaKeys still reads the joined
  // text, because it matches key STRINGS and never reports a position.
  for (const blk of [descriptor.script, descriptor.scriptSetup]) {
    if (blk?.content) scanScript(blk.content, file, out, blk.loc?.start?.line ?? 0)
  }
  const code = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n')
  if (code) out.push(...crossAreaKeys(code, file))
  return out
}

// ── production plugins: the scope this gate defends ─────────────────────────────────────────────
// Read from the built manifest so the list cannot drift from what actually ships.
// ★ EFFECTIVE stage, not declared stage. A production leaf composes other bundles at runtime, so a
// reader on a production page sees code from bundles that declare themselves experimental — and
// scoping by the declared stage held that code to the experimental bar. The rule and the graph live
// in lib/effective-stage.mjs, shared with check:frozen-labels so the two gates cannot disagree about
// what "production" means.
function productionPluginDirs(root = '.') {
  const mf = join(root, 'public/dx-maps/manifest.json')
  if (!existsSync(mf)) return []
  const m = JSON.parse(readFileSync(mf, 'utf8'))
  MANIFEST = m
  return productionForGating(m).map((n) => join(root, 'plugin-designs', n)).filter((d) => existsSync(d))
}
let MANIFEST = null
const sfcsIn = (dir) => {
  const out = []
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) { if (!/node_modules|dist|snapshots|fixtures/.test(e.name)) walk(p) }
    else if (e.name.endsWith('.vue') || e.name.endsWith('.js')) out.push(p)
  } }
  walk(dir); return out
}

// ── self-test: the gate must be shown able to SEE, and able to stay quiet ────────────────────────
const PLANTED_BAD = `<template>
  <div :dir="isRTL ? 'rtl' : 'ltr'">
    <h2>Prayer Coverage</h2>
    <button title="Reset the map">x</button>
    <th :title="\`Sort this table by \${col}\`">h</th>
    <button :title="'Reset the view'">r</button>
    <span>{{ ok ? 'Everything loaded' : 'Nothing loaded' }}</span>
    <PosterWall unit="UPG" item-noun="list" event-name="doxa:show-on-map" />
    <p dir="ltr">Counted BY LANGUAGE, so groups collapse.</p>
    <div dir="ltr"><em>Source: eBible, checked 2026-09</em></div>
    <p><bdi dir="ltr">Of {{ tally.langs }} sign languages on this map, covering {{ tally.people }} people,
      {{ tally.both }} have both a film and a text Scripture.</bdi></p>
  </div>
</template>
<script setup>
import { a } from './a.js'
import { b } from '../b/c.js'
const msg = 'No results were found'
const kerr = keyedError('dashboard.no_such_key_at_all', 'this sentence has no catalogue key')
const split = \`\${a} polys · \${b} zones · \`
const ctx = \`\${n} countries\`
</script>`
const PLANTED_GOOD = `<template>
  <div class="rd-card is-open">
    <h2>{{ t('Prayer Coverage') }}</h2>
    <th :title="t('Sort this table')" :class="\`rd-card \${x}\`" :id="\`country-\${code}\`">h</th>
    <span>{{ t('Prayer Coverage') }}</span>
    <span>{{ n }} {{ t('Countries') }}</span>
  </div>
</template>
<script setup>
import { alpha } from './alpha.js'
import { beta } from '../beta/gamma.js'
const t2 = t
const viaAlias = t2('All Regions')
const guarded = te(key) ? t(key) : 'Regions List'
const cls = 'rd-card is-open'
const url = 'https://example.test/a/b'
const lang = \`\${l}-u-nu-latn\`
const err = \`HTTP \${res.status}\`
const lone = 'Other'
const proxyMiss = t.search || 'Search names, country, religion…'
const keyMiss = msg !== 'messages.engineMissing' ? msg : 'The map engine did not load.'
const devThrow = () => { throw new Error('table not found for this request') }
const keyed = () => { throw keyedError('dashboard.map_loading', 'Loading the map for you') }
const devWarn = () => console.warn('boundaries failed to load for this map')
const host = document.querySelector('gospel-resources-dashboard, gospel-resources-map')
const one = el.closest('regions-dashboard, doxa-simple-map')
</script>`

const XAREA_BAD = `const t = useOptionalT('regions')
const msg = t('messages.engineMissing')`
// The wrapper shape: no literal namespace at the call site, so it is only detectable by resolving
// usePplrT() back to useOptionalT('pplr'). This is the shape pplr actually had.
const XAREA_WRAPPED = `const t = usePplrT()
const msg = t('messages.mapUnavailable')`
const XAREA_GOOD = `const t = useOptionalT('messages')
const msg = t('engineMissing')
const t2 = useOptionalT('regions')
const ok2 = t2('Countries')`

// ★ EFFECTIVE STAGE: a production leaf pulls experimental bundles into the production bar.
const STAGE_FIXTURE = {
  bundles: [
    { bundle: 'leaf-prod', stage: 'production', composes: ['mid-exp', 'pair/with-profile'] },
    { bundle: 'mid-exp', stage: 'experimental', composes: ['deep-exp'] },
    { bundle: 'deep-exp', stage: 'experimental' },
    { bundle: 'pair', stage: 'experimental' },
    { bundle: 'lonely-exp', stage: 'experimental' },
    // ★ CYCLES ARE REAL IN THIS MANIFEST, not hypothetical: six edges are self-composition via the
    // bundle/profile form (country-posters, my-upg-100-list, regions-dashboard all compose
    // themselves), and upg100 measured that a naive recursive walk hangs on it TODAY. The header
    // claimed termination in prose and never tested it, which is the same gap as an untested
    // fallback — so a self-cycle and a mutual cycle are both in the fixture. If the closure ever
    // regresses to recursion this test does not fail, it HANGS, which is its own loud signal.
    { bundle: 'selfie', stage: 'production', composes: ['selfie/one', 'selfie/two', 'ring-a'] },
    { bundle: 'ring-a', stage: 'experimental', composes: ['ring-b'] },
    { bundle: 'ring-b', stage: 'experimental', composes: ['ring-a'] },
  ],
}

function selfTest() {
  let fails = 0
  const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }
  // ★ THE FIXTURES MUST PARSE, ASSERTED FIRST. sr's first planted sample was malformed Vue, so the
  // scan found nothing in it and LOOKED blind — a broken fixture and a broken scanner produce the
  // same silence. parse() surfaces template errors that scanSfc would otherwise throw on.
  for (const [name, src] of [['planted-bad', PLANTED_BAD], ['planted-good', PLANTED_GOOD]]) {
    const { errors } = parse(src, { filename: `${name}.vue` })
    ok(!errors || errors.length === 0, `FIXTURE ${name}.vue is valid Vue${errors && errors.length ? ': ' + errors[0].message : ''}`)
  }
  const bad = scanSfc(PLANTED_BAD, 'planted-bad.vue')
  const good = scanSfc(PLANTED_GOOD, 'planted-good.vue')
  ok(bad.some((f) => f.kind === 'template-text' && f.text === 'Prayer Coverage'), 'SEES a hardcoded heading in the TEMPLATE')
  ok(bad.some((f) => f.kind === 'attr:title'), 'SEES a hardcoded title= attribute')
  ok(bad.some((f) => f.kind === 'script-string' && f.text === 'No results were found'), 'SEES a hardcoded sentence in a SCRIPT BLOCK')
  ok(bad.some((f) => f.kind === 'template-literal' && f.text === 'countries'), 'SEES English inside a TEMPLATE LITERAL (the class that held a real defect)')
  ok(bad.some((f) => f.kind === 'bind:title' && /Sort this table by/.test(f.text)), 'SEES a TEMPLATE LITERAL inside a bound attribute (sr: every scanner missed this)')
  ok(bad.some((f) => f.kind === 'bind:title' && f.text === 'Reset the view'), "SEES a quoted '…' literal inside a bound attribute (both quote styles)")
  ok(bad.some((f) => f.kind === 'bind:interpolation' && /Everything loaded|Nothing loaded/.test(f.text)), 'SEES a literal inside an INTERPOLATION expression')
  // ★ EVERY FINDING CARRIES A LINE, AND THE LINE MUST HOLD THE STRING. Asserting only that a line
  // is PRESENT would pass on a confidently wrong number, which is the failure this exists to stop:
  // sr sent itself to two comment lines that merely discussed a string while the rendering code sat
  // elsewhere. So the fixture's own source is the oracle — read the reported line back and require
  // the text (or, for a split literal, its first fragment) to be on it. An off-by-one from a block
  // offset, or a fragment's local numbering leaking out of a bound expression, fails here.
  const badLines = PLANTED_BAD.split('\n')
  ok(bad.every((f) => typeof f.line === 'number' && f.line > 0), 'every finding carries a LINE')
  const misplaced = bad.filter((f) => {
    const src = badLines[f.line - 1] || ''
    // A suspect's text is SYNTHESISED (`<Tag prop="value">`) and so is not on any line verbatim;
    // its prop VALUE is the part the source actually holds.
    const m = /^<\S+ \S+="(.*)">$/.exec(String(f.text))
    const needle = (m ? m[1] : String(f.text).split(' {…} ')[0]).trim()
    return needle && !src.includes(needle)
  })
  ok(misplaced.length === 0,
    `every reported line actually CONTAINS its string (${misplaced.length} misplaced${misplaced.length ? ': ' + misplaced.map((f) => `${f.kind}@${f.line} ${JSON.stringify(f.text.slice(0, 28))}`).join('; ') : ''})`)
  // ★ THE FALLBACK EXEMPTION, BOTH SIDES. A resolved key makes its English a safety net; an
  // unresolved one makes it the string the reader actually gets. Asserting only the quiet side
  // would pass on a gate that exempts every fallback, which is precisely the bug this replaced:
  // the old blanket "any argument of a translator call is exempt" rule could not see a typo'd key.
  const FB = `<template>
  <p>{{ W('dashboard.map_loading', 'Research map loading…') }}</p>
  <p :title="W('dashboard.map_loading', 'Research map loading…')">x</p>
  <p>{{ W('dashboard.no_such_key_at_all', 'This fallback is the only thing a reader sees') }}</p>
</template>
<script setup>
const W = (key, en) => tStatic(key) || en
const a = W('dashboard.map_loading', 'Research map loading…')
const b = W('dashboard.no_such_key_at_all', 'This fallback is the only thing a reader sees')
const c = t('dashboard.map_loading')
</script>`
  const fb = scanSfc(FB, 'fallbacks.vue')
  ok(!fb.some((f) => /Research map loading/.test(f.text)),
    'QUIET on a t(key, English) fallback whose key resolves in every locale')
  ok(fb.filter((f) => /only thing a reader sees/.test(f.text)).length === 2,
    `COUNTS a fallback whose key does not resolve — in template AND script (got ${fb.filter((f) => /only thing a reader sees/.test(f.text)).length}/2)`)
  ok(!fb.some((f) => f.text === 'dashboard.map_loading'),
    'and the KEY argument itself is never a finding')
  // tStatic is used directly, not only behind a wrapper, and the same two-sided rule has to hold there.
  const TS = `<template><p>{{ x }}</p></template>
<script setup>
import { tStatic } from '@map/i18n/index.js'
const a = tStatic('dashboard.map_loading') || 'Research map loading…'
const b = tStatic('dashboard.no_such_key_at_all') || 'This one has no key and must still count'
</script>`
  const ts = scanSfc(TS, 'tstatic.vue')
  ok(!ts.some((f) => /Research map loading/.test(f.text)),
    'QUIET on a tStatic(key) || English fallback whose key resolves')
  ok(ts.some((f) => /must still count/.test(f.text)),
    'COUNTS a tStatic fallback whose key does not resolve')
  // `config || t('key') || 'English'` — an instance may override the wording, else the catalogue,
  // else the English. The translator is not the immediate left operand, so the spine is walked.
  const CH = `<template><p>{{ x }}</p></template>
<script setup>
import { tStatic } from '@map/i18n/index.js'
const a = cfg.x || tStatic('dashboard.map_loading') || 'Research map loading…'
const b = cfg.y || tStatic('dashboard.no_key_here') || 'This chain has no resolving key and must count'
const c = cfg.z || 'A plain config fallback with no translator at all must count'
</script>`
  const ch = scanSfc(CH, 'chain.vue')
  ok(!ch.some((f) => /Research map loading/.test(f.text)),
    'QUIET on config || t(key) || English when the key resolves')
  ok(ch.some((f) => /no resolving key/.test(f.text)) && ch.some((f) => /no translator at all/.test(f.text)),
    'COUNTS the same chain when the key is missing, and when there is no translator in it')
  // ★ LOOKUP-TABLE KEYS. gospel's RES_KEY matches a value that arrives in the DATA and returns the
  // i18n key to render. Wrapping the left side in t() would make every lookup miss and fall through
  // to the raw data value: the count drops while the display breaks. Exempt only when the target
  // really resolves — a table pointing at a key nobody wrote is a genuine defect.
  const LK = `<template><p>{{ x }}</p></template>
<script setup>
const RES_KEY = { 'JESUS Film': 'gospel.res.jesusFilm', 'Bible video': 'gospel.res.bibleVideo' }
const BROKEN  = { 'Gospel audio': 'gospel.res.no_such_key_at_all' }
const KIND    = { 'Bible Stories': 'scripture' }
</script>`
  const lk = scanSfc(LK, 'lookup.vue')
  ok(!lk.some((f) => /JESUS Film|Bible video/.test(f.text)),
    'QUIET on a lookup-table key whose mapped i18n key resolves in every locale')
  ok(lk.some((f) => f.text === 'Gospel audio'),
    'COUNTS a lookup-table key whose mapped i18n key does not exist')
  ok(lk.some((f) => f.text === 'Bible Stories'),
    "and COUNTS one whose value is a category, not a key — the gate can only vouch for what it can resolve")
  // ★ PURE DATA MAPS. Keys joined against map data (territory-counts.js) are join VALUES; a
  // sentence used as a key, or rendered as a value, is still a leak.
  const DM = `<template><p>{{ x }}</p></template>
<script setup>
const ADM1_COUNTS = { 'Andhra Pradesh': 81, 'Assam': 15, 'Bihar': 22, 'Goa': 3, 'Kerala': 9, 'Punjab': 7 }
const PROSE_KEYS = { 'A resource not found means it was not in the pools checked': 1, 'Another whole sentence here': 2, 'Third sentence for the floor': 3, 'Fourth sentence for the floor': 4, 'Fifth sentence for the floor': 5, 'Sixth sentence for the floor': 6 }
const RENDERED = { africa: 'A sentence the reader actually sees here', asia: 'Another sentence the reader sees', c: 'x', d: 'y', e: 'z', f: 'w' }
</script>`
  const dm = scanSfc(DM, 'datamap.vue').map((f) => f.text)
  ok(!dm.includes('Andhra Pradesh') && !dm.includes('Kerala'),
    'QUIET on the keys of a pure data map whose values are all numbers')
  ok(dm.some((t) => /A resource not found means/.test(t)),
    'COUNTS a real SENTENCE used as a data-map key — a name is not a sentence')
  ok(dm.some((t) => /A sentence the reader actually sees/.test(t)),
    'COUNTS a sentence used as a data-map VALUE — only the keys are join values')
  // ⚠ THE allData CHECK IS WHAT STOPS A LABEL MAP BEING READ AS A DATA MAP. Keys that look like
  // names, values that are prose a reader sees: the keys must STILL count, because this is a
  // label table, not a join table. Without this case the allData guard can be removed and every
  // test still passes — measured by poisoning it.
  // ★ REGION IDENTITIES (R26): exempt ONLY while REGION_KEY names them. A region added
  // without a key falls through `|| english` and renders English in eleven locales — the defect
  // upg100 already shipped once with Americas and Europe. The conditional IS the rule.
  {
    const KEYED = "const REGION_KEY={'Africa':'region_africa','Middle East':'region_middle_east','India':'region_india','Other':'region_other','China + Mongolia':'region_china_mongolia','Central Asia':'region_central_asia'}"
    const mk = (of) => `<template><p>{{ x }}</p></template>\n<script setup>\n${KEYED}\nconst REGION_OF = ${of}\n</script>`
    ok(!scanSfc(mk("{ 'west-africa': 'Africa', 'middle-east-core': 'Middle East' }"), 'rg.vue').some((f) => f.text === 'Africa'),
      'QUIET on a region identity that REGION_KEY names')
    ok(scanSfc(mk("{ 'west-africa': 'Africa', 'new-place': 'Antarctica Region' }"), 'rb.vue').some((f) => f.text === 'Antarctica Region'),
      'COUNTS a region with NO REGION_KEY entry — it would render English through the fallback')
  }
  ok(scanSfc(`<template><p>{{ x }}</p></template>
<script setup>
const REGION_LABELS = { 'Andhra Pradesh': 'Southern India, sixth largest', 'Assam': 'North-east, tea country here', 'Bihar': 'Northern plains along the Ganges', 'Goa': 'West coast, smallest by area', 'Kerala': 'South-west, high literacy rate', 'Punjab': 'North-west, the five rivers' }
</script>`, 'labels.vue').map((f) => f.text).includes('Andhra Pradesh'),
    'COUNTS a data-map key when the VALUES are prose — that is a label table, not a join table')
  ok(scanSfc(`<template><p>{{ x }}</p></template>
<script setup>
const TOO_FEW = { 'Tamil Nadu': 81, 'Assam': 15 }
</script>`, 'few.vue').map((f) => f.text).includes('Tamil Nadu'),
    'COUNTS the same key in a THREE-entry object — two options are not a table')
  // ★ THE TWO CLASSES gospel ASKED FOR, both sides each. Their 12 real defects were hiding inside 88
  // findings they had already called "mostly deliberate", so the danger in teaching the gate a class
  // is that it silences the next 12 too. Each quiet case is paired with the nearest thing that must
  // stay loud: a caveat after the same separator, prose that merely begins with a brand, and a real
  // English sentence used as a table key.
  const CLS = `<template>
  <p>{{ t('gospel.res.gospelAudio') }} · GRN</p>
  <p>{{ t('gospel.res.x') }} · Not found in any pool</p>
  <p>GRN · and the rest of this sentence is prose</p>
</template>
<script setup>
const a = scope === 'Full Bible'
const LOOKUP = { 'Bible video': 'gospel.res.bibleVideo' }
const REAL = { 'A whole English sentence used as a key': 'not.a.real.key.anywhere' }
const c = label.includes('Some readable prose here')
</script>`
  const cls = scanSfc(CLS, 'classes.vue')
  const txt = cls.map((f) => f.text)
  ok(!txt.includes('· GRN'), 'QUIET on a separator followed only by a never-translate name')
  ok(!txt.some((t) => /Full Bible/.test(t)), 'QUIET on a string compared with === against table data')
  ok(txt.includes('· Not found in any pool'),
    'COUNTS a real caveat after the same separator — the name list is a list, not a punctuation rule')
  ok(txt.includes('GRN · and the rest of this sentence is prose'),
    'COUNTS prose that merely BEGINS with a brand — the separator has to be leading')
  ok(txt.includes('A whole English sentence used as a key'),
    'COUNTS a real sentence used as a table key when its value resolves to nothing')
  ok(txt.includes('Some readable prose here'),
    'COUNTS an .includes() argument — a substring test can be against prose a reader sees')
  // ⚠ CONCATENATION IS A BinaryExpression TOO. Accepting any operator instead of just ===/!== would
  // silence `greeting + 'Welcome to the prayer map'` — a sentence assembled for the reader, which is
  // the opposite of a value tested against data. Found by poisoning the operator check and seeing
  // nothing fail; this is the case that makes it fail.
  const CAT = `<template><p>{{ x }}</p></template>
<script setup>
const a = greeting + 'Welcome to the prayer map'
</script>`
  ok(scanSfc(CAT, 'concat.vue').some((f) => f.text === 'Welcome to the prayer map'),
    'COUNTS a sentence built by CONCATENATION — only an equality test means "compared against data"')
  // ★ CSS DECLARATION SEAMS (I18N-EXP-PLAN), tested on the SHAPE rather than through a fixture.
  // A seam like "px;height:" only exists as a separate string if a quasi is judged alone, and this
  // gate deliberately judges a split template literal as ONE string — so a .vue fixture can never
  // produce one, and an assertion written that way passes whether or not the rule exists. I wrote
  // that version first and it stayed green with the rule disabled, which is the whole failure mode
  // this file exists to refuse. The rule is real for any caller that does judge quasis separately;
  // asserting it at the shape is the only way to prove it can fail.
  ok(!!allowedBy('px;height:') && !!allowedBy('; background:'),
    'a CSS declaration seam is allowed')
  ok(!allowedBy('12 people:'),
    'prose ending in a colon is NOT — the seam shape needs a semicolon-separated declaration')
  ok(!allowedBy('Pools checked; nothing found:'),
    'prose with a semicolon AND a colon is NOT — the segments must be property:value pairs')
  // ★ HTML ATTRIBUTE SEAM (SR-DIRLANG). `'<html lang="' + l + '" dir="' + d + '">'`
  // leaves the quasi `" dir="`, an attribute seam rather than a declaration seam. dir and lang were
  // the only standard attributes missing from the HTML shape. Asserted on the shape for the same
  // reason as the CSS seam: the gate judges a split literal as ONE string, so no fixture reaches it.
  ok(!!allowedBy('" dir="') && !!allowedBy('" lang="'),
    'an HTML attribute seam on dir/lang is allowed')
  ok(!allowedBy('Direction: left to right'),
    'prose ABOUT direction is NOT — the shape needs an attribute name followed by =')
  // ★ A DEVELOPER SITE REACHED THROUGH CONCATENATION. `throw new Error(\`head\` + rest)` puts a
  // BinaryExpression between the literal and the NewExpression, so the parent-only check missed it
  // and reported a thrown message as a leak (legend-tree.js:392). Not a .js-path bug — a .vue file
  // concatenating inside a throw hits it identically.
  const DEV = `<template><p>{{ x }}</p></template>
<script setup>
throw new Error(\`legend-tree L15: \${n} leaf nodes violate the shape\` + detail)
const shown = 'A sentence a reader actually sees' + suffix
</script>`
  const dev = scanSfc(DEV, 'dev.vue').map((f) => f.text)
  ok(!dev.some((t) => /leaf nodes violate/.test(t)),
    'QUIET on a thrown developer message built by CONCATENATION')
  ok(dev.some((t) => /A sentence a reader actually sees/.test(t)),
    'COUNTS a concatenated sentence that is NOT at a developer site')
  // the catalogue-side rule, tested directly: the two facts that make a fallback safe
  ok(fallbackFullyResolved('dashboard.map_loading'),
    'a key present and really translated in all 11 locales counts as resolved')
  ok(!fallbackFullyResolved('dashboard.no_such_key_at_all'),
    'a key absent from the catalogue does NOT count as resolved')
  ok(translatableWords('{label} · {count} · {pct}%') === 0,
    'a format-only string has no translatable words, so an identical rendering is not "untranslated"')
  ok(translatableWords('This fallback is the only thing a reader sees') >= 3,
    'an English sentence does have translatable words')
  const splits = bad.filter((f) => /polys|zones/.test(f.text))
  ok(splits.length === 1, `a split template literal is ONE finding, not one per fragment (got ${splits.length})`)
  ok(splits.length === 1 && /polys.*\{…\}.*zones/.test(splits[0].text), 'and it is reported as the WHOLE string with its holes marked')
  // ★ literal props handed to a component that may render them (gospel's poster-wall case)
  const sus = bad.filter((f) => f.suspect)
  ok(sus.some((f) => f.kind === 'suspect-prop:unit' && /UPG/.test(f.text)), 'SEES a literal prop whose name suggests it is rendered (unit=)')
  ok(sus.some((f) => f.kind === 'suspect-prop:item-noun'), 'and one named item-noun')
  ok(!sus.some((f) => /event-name/.test(f.kind)), 'QUIET on a prop whose name does not suggest rendering (event-name=)')
  ok(!bad.filter((f) => !f.deliberate && !f.suspect).some((f) => /UPG|item-noun/.test(f.text)),
    'a SUSPECT is reported separately and is NOT counted as a leak — the child may never render it')
  const ltr = bad.filter((f) => f.deliberate && !f.suspect)
  ok(ltr.some((f) => /Counted BY LANGUAGE/.test(f.text)), 'marks text inside dir="ltr" as DELIBERATE, not a leak')
  ok(ltr.some((f) => /Source: eBible/.test(f.text)), 'and INHERITS the marker down the subtree')
  // ★ a suppressed string must name the island that suppressed it, so an over-broad island is
  // visible as an object with a size rather than as part of a flat total.
  ok(ltr.every((f) => f.island && typeof f.island.line === 'number'),
    'every suppressed string carries the ISLAND that suppressed it (file, line, tag)')
  ok(new Set(ltr.map((f) => f.island && f.island.line)).size >= 2,
    'and distinct islands are distinguished, not merged into one bucket')
  // ★ gospel's real case: an island SPLIT BY INTERPOLATIONS. Each run between two {{ }} is its own
  // text node, so a check that only marked a whole-text island reported the pieces as separate
  // leaks — and they nearly got translated. <bdi dir="ltr"> is the element they actually use.
  const splitIsland = bad.filter((f) => /sign languages on this map|both a film/.test(f.text))
  ok(splitIsland.length > 0, 'sees the pieces of an interpolation-split island at all')
  ok(splitIsland.every((f) => f.deliberate),
    `every piece of an interpolation-split dir="ltr" island is DELIBERATE (got ${splitIsland.filter((f) => !f.deliberate).length} not marked)`)
  ok(bad.filter((f) => !f.deliberate).some((f) => f.text === 'Prayer Coverage'), 'while a leak OUTSIDE the island is still counted')
  // ★ THE FIXTURE ROOT CARRIES :dir="isRTL ? 'rtl' : 'ltr'" — the correct locale-aware switch every
  // RTL-ready component puts on its root. An earlier version matched any bound :dir containing the
  // text 'ltr' and so treated the WHOLE component as deliberate English, silencing every leak in it.
  // regions-dashboard read 0 for that reason: not clean, blind. Every assertion above now runs inside
  // such a component, so the blindness cannot come back without the whole self-test failing.
  ok(bad.filter((f) => !f.deliberate).length >= 4,
    `a DYNAMIC :dir switch is not an English island — leaks inside it are still counted (got ${bad.filter((f) => !f.deliberate).length})`)
  ok(!good.some((f) => f.text === 'All Regions'), 'QUIET on a call through an ALIAS of t()')
  ok(!good.some((f) => f.text === 'Regions List'), 'QUIET on a te()-guarded fallback')
  ok(!good.some((f) => String(f.kind).startsWith('bind:')), 'QUIET on a bound attribute that IS a translator call')
  ok(!good.some((f) => /Search names/.test(f.text)), 'QUIET on a proxy-t member miss (t.search || …) — a fallback, not a leak')
  ok(!good.some((f) => f.kind === 'bind:interpolation'), 'QUIET on interpolations that are translator calls or bare values')
  ok(!good.some((f) => /map engine did not load/.test(f.text)), 'QUIET on the "did t() return the key?" miss idiom (msg !== \'a.dotted.key\')')
  ok(!good.some((f) => /table not found/.test(f.text)), 'QUIET on a throw new Error(…) argument — exempt by CALL SITE')
  ok(!good.some((f) => /Loading the map for you/.test(f.text)), 'QUIET on keyedError(key, English) whose key resolves in every locale')
  ok(bad.some((f) => /this sentence has no catalogue key/.test(f.text)), 'SEES keyedError(key, English) whose key does NOT resolve — its English is what the reader gets')
  ok(!good.some((f) => /boundaries failed/.test(f.text)), 'QUIET on a console.warn(…) argument')
  ok(!good.some((f) => /gospel-resources-dashboard|regions-dashboard, doxa/.test(f.text)),
    'QUIET on a DOM query selector, including a comma-separated list of custom-element tags')
  ok(!good.some((f) => /rd-card|example\.test|nu-latn|HTTP/.test(f.text)), 'QUIET on css, urls, locale extensions and developer error text')
  ok(good.length === 0, `QUIET overall on a correct file (got ${good.length}${good.length ? ': ' + JSON.stringify(good[0]) : ''})`)
  // The blind spot is PINNED, not merely mentioned: if single-word detection is ever added, this
  // fails and whoever adds it must update the header rather than leave it claiming a gap that closed.
  ok(!good.some((f) => f.text === 'Other'), 'DOCUMENTED BLIND SPOT: a single-word leak is NOT reported (see header)')
  // ★ CROSS-AREA KEYS: a real bug found twice in one day, and the shape both instances had.
  const xb = crossAreaKeys(XAREA_BAD, 'planted-xarea.vue')
  const xg = crossAreaKeys(XAREA_GOOD, 'planted-xarea-ok.vue')
  ok(xb.length === 1 && /never resolves/.test(xb[0].text),
    'SEES a cross-area key through a namespaced t() (qualified misses, unqualified exists)')
  ok(xg.length === 0, `QUIET when the key resolves under its own namespace (got ${xg.length})`)
  const xw = crossAreaKeys(XAREA_WRAPPED, 'planted-xarea-wrapped.vue')
  ok(xw.length === 1 && /pplr\.messages\.mapUnavailable/.test(xw[0].text),
    'SEES it through a WRAPPER factory with no literal namespace (usePplrT() → useOptionalT(\'pplr\'))')
  const eff = productionForGating(STAGE_FIXTURE)
  ok(eff.includes('mid-exp'), 'an experimental bundle COMPOSED by a production leaf is production-for-gating')
  ok(eff.includes('deep-exp'), 'and TRANSITIVELY — composition nests, so one pass is not enough')
  ok(eff.includes('pair'), "a composes entry of the form 'bundle/profile' resolves to its BUNDLE")
  ok(!eff.includes('lonely-exp'), 'CONTROL: an experimental bundle nobody composes stays out of scope')
  ok(stageReason(STAGE_FIXTURE, 'mid-exp').startsWith('composed by'), 'and the report can say WHY it is in scope')
  ok(eff.includes('selfie'), 'a SELF-COMPOSING bundle resolves rather than looping (6 such edges exist in the real manifest)')
  ok(eff.includes('ring-a') && eff.includes('ring-b'), 'and a MUTUAL cycle terminates, marking both members')
  console.log(fails ? `\nSELF-TEST: ${fails} FAIL(s)` : '\nSELF-TEST: the gate can see planted leaks and stays quiet on correct code')
  return fails
}

// Short HEAD sha plus a dirty marker, or 'unknown' outside a checkout.
function treeStamp() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return dirty ? `${sha}+dirty(${dirty.split('\n').length} file(s))` : sha
  } catch { return 'unknown (not a git checkout)' }
}

// ── CANARY MODE: turn "plugin X = 0" from a claim into a proven 0 ───────────────────────────────
// ★ WHY THIS EXISTS. Both serious bugs in this gate made it QUIETER — the single-word blind spot and
// the dynamic-:dir island bug, which silenced a whole plugin's template. A scan that under-reports is
// indistinguishable from code that is fine, so a zero is only worth what its detector is worth ON
// THAT FILE. Canary mode plants a known leak in each production SFC and requires it to be caught:
// a plugin that cannot catch a planted leak cannot be trusted to report zero.
//
// IN MEMORY, NOT IN A TEMP DIR. scanSfc takes a source string, so nothing is copied to disk — there
// is no cleanup to get wrong, nothing to leave behind on a box that has been short of space all day,
// and no chance of scanning a stale copy.
const CANARY = 'Canary sentinel sentence that must be reported'

// Injected as a text node INSIDE the template root, so it inherits whatever the root carries. That
// is deliberate: if a plugin's root marks it as a deliberate-English island, the canary is reported
// as deliberate rather than as a leak, and the run says so — which is exactly the state that made
// regions-dashboard read 0 while being blind.
// ★ INSIDE THE ROOT ELEMENT, AND LOCATED BY THE PARSER. Two earlier attempts were wrong for the
// same reason in different ways. Injecting after <template> made the canary a SIBLING of the root,
// so it inherited none of the root's attributes — and a root-level attribute is exactly what blinded
// regions-dashboard, so that canary would have passed a plugin it could not see. Then finding the
// root tag with a regex broke on `:group-by="(item) => regionFor(item.id)"`, because the `>` of the
// arrow function ends the match mid-attribute and corrupts the file.
// A REGEX CANNOT TOKENISE MARKUP ANY MORE THAN IT CAN TOKENISE JAVASCRIPT — the third time that has
// cost something today — so the parser locates the root's first child and the canary goes there.
function withCanary(src, file) {
  let descriptor
  try { ({ descriptor } = parse(src, { filename: file })) } catch { return null }
  const root = descriptor?.template?.ast?.children?.find((c) => c.type === 1 || c.type === 2)
  const first = root && root.type === 1 ? (root.children || [])[0] : root
  const at = first?.loc?.start?.offset
  if (typeof at !== 'number') return null
  // template.ast offsets are relative to the whole file for compiler-sfc's parse, so slice directly.
  return src.slice(0, at) + `<span>${CANARY}</span>` + src.slice(at)
}

function canaryMode() {
  const dirs = productionPluginDirs('.')
  let fails = 0, checked = 0
  const skipped = []
  console.log('  CANARY: planting one known leak per SFC and requiring it to be caught\n')
  for (const d of dirs) {
    const plugin = d.split('/').pop()
    const files = sfcsIn(d)
    const bad = []
    for (const f of files) {
      const src = withCanary(readFileSync(f, 'utf8'), f)
      // ★ A SKIP IS NOT A PASS, and hiding it would repeat the mistake this whole mode exists to
      // prevent: a file nobody could plant a canary in is a file whose zero is unproven. Reported.
      if (src === null) {
        // ★ TRIAGE THE SKIP. "Unplantable" is two different states and they carry opposite risk: a
        // component with no text surface has nothing to leak, while one that hands literal English
        // to a child has a leak this gate cannot confirm. Reporting them together would bury the
        // second in the first — which is how gospel's poster-wall case sat inside a bland count.
        let why = 'no text surface'
        try {
          const probe = scanSfc(readFileSync(f, 'utf8'), f)
          const sp = probe.filter((x) => x.suspect)
          if (sp.length) why = `PASSES ${sp.length} LITERAL PROP(S) — ${sp.map((x) => x.text).join(', ')}`
        } catch { why = 'unparseable' }
        skipped.push(`${plugin}/${f.split('/').pop()} — ${why}`)
        continue
      }
      checked++
      let found
      try { found = scanSfc(src, f) } catch (e) { bad.push(`${f.split('/').pop()} (parse: ${e.message})`); continue }
      const hit = found.find((x) => String(x.text).includes(CANARY))
      if (!hit) bad.push(`${f.split('/').pop()} (NOT CAUGHT)`)
      else if (hit.deliberate) bad.push(`${f.split('/').pop()} (caught but marked DELIBERATE — this plugin is islanded at its root)`)
    }
    if (bad.length) { fails++; console.log(`  FAIL ${plugin}: ${bad.join('; ')}`) }
    else console.log(`  ok   ${plugin}: ${files.length} SFC(s), every canary caught as a leak`)
  }
  if (skipped.length) {
    console.log(`\n  ${skipped.length} SFC(s) SKIPPED — no plantable first child, so their zero is UNPROVEN:`)
    for (const f of skipped) console.log(`   · ${f}`)
  }
  console.log(fails
    ? `\nCANARY: ${fails} plugin(s) cannot be trusted to report zero  ·  tree ${treeStamp()}`
    : `\nCANARY: every production plugin catches a planted leak (${checked} of ${checked + skipped.length} SFCs; ${skipped.length} unproven)  ·  tree ${treeStamp()}`)
  return fails
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
// RUN ONLY WHEN INVOKED DIRECTLY. Without this guard, `import`ing the module to reuse scanSfc() runs
// the whole production scan as a side effect — which is how I first "verified" it against sr's real
// example and got a full gate run instead of one file's findings. A gate that cannot be imported
// cannot be unit-tested by whoever owns it.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (!isMain) { /* imported: expose scanSfc and do nothing */ }
else main()

function main() {
if (process.argv.includes('--canary')) process.exit(canaryMode() ? 1 : 0)
const selfOnly = process.argv.includes('--self-test')
let fails = selfTest()
if (fails) { console.log('\nHARDCODED-ENGLISH: self-test failed — findings below would not be trustworthy'); process.exit(1) }
if (selfOnly) process.exit(0)

const dirs = productionPluginDirs('.')
const findings = []
let files = 0
try {
  for (const d of dirs) for (const f of sfcsIn(d)) {
    files++
    const src = readFileSync(f, 'utf8')
    if (f.endsWith('.js')) { const out = []; scanScript(src, f, out); findings.push(...out) }
    else findings.push(...scanSfc(src, f))
  }
} catch (e) { console.error('HARDCODED-ENGLISH: parse error —', e.message); process.exit(2) }

const deliberate = findings.filter((f) => f.deliberate && !f.suspect)
const suspects = findings.filter((f) => f.suspect)
const leaks = findings.filter((f) => !f.deliberate && !f.suspect)
// ★ THE RUN NAMES ITS OWN SHA. Three reports today were true of an older artifact than the one in
// hand, and each cost someone a wasted investigation — the last one nearly had a working island
// check "fixed". gospel's corollary is that the reader cannot check what the writer did not say, so
// the tool says it: any number quoted from this output carries the tree it was measured on, and a
// dirty tree is marked because then the sha alone does not describe what ran.
//
// ★ AND IT PROVED ITSELF WITHIN THE HOUR, in the case that justifies it better than the one it was
// built for. gospel and I compared counts and disagreed — 185/169/155 against 178/168/147 — and
// spent the exchange assuming one set was stale. Neither was: SAME SCRIPT SHA, DIFFERENT SOURCE
// TREES, twelve scanned SFCs apart. Both numbers were honest measurements of different bytes.
// "7 production plugin(s), 19 SFC(s) scanned" describes the SHAPE of a scan and says nothing about
// WHICH BYTES, so two correct runs are indistinguishable in a report. The stamp is therefore not
// only for the writer who forgets to name a sha — it is what lets a READER tell two runs apart at
// all. When counts disagree, compare the tree line before anything else.
const composed = MANIFEST ? dirs.map((d) => d.split('/').pop()).filter((n) => stageReason(MANIFEST, n).startsWith('composed')) : []
console.log(`\n  ${dirs.length} production-for-gating plugin(s), ${files} SFC(s) scanned  ·  tree ${treeStamp()}`)
if (composed.length) {
  // Named, because "why is this experimental bundle in a production scan?" is the first question a
  // reader will have, and the answer is a fact about the composition graph rather than a judgement.
  console.log(`  including ${composed.length} reached only by composition: ${composed.map((n) => `${n} (${stageReason(MANIFEST, n)})`).join('; ')}`)
}
for (const f of leaks) console.log(`   ${f.kind.padEnd(16)} ${f.file.replace(/^.*plugin-designs\//, '')}:${f.line ?? 0}  ${JSON.stringify(f.text).slice(0, 90)}`)
if (deliberate.length) {
  // Listed so nobody wonders where they went, but NOT counted: dir="ltr" is the plugin's own marker
  // for content ruled to stay English. Asking someone to "fix" these would be asking them
  // to undo a decision.
  // PER ISLAND, LARGEST FIRST. A big island is not automatically wrong, but it is the shape an
  // over-broad one has, and a flat total cannot show it. Size is reported in LINES as well as
  // strings, because "one attribute covering 74 lines" is the fact that makes someone look.
  const byIsland = new Map()
  for (const f of deliberate) {
    const k = f.island ? `${f.island.file}:${f.island.line}` : '(unattributed)'
    const e = byIsland.get(k) || { k, n: 0, island: f.island }
    e.n++
    byIsland.set(k, e)
  }
  const islands = [...byIsland.values()].sort((a, b) => b.n - a.n)
  console.log(`\n  ${deliberate.length} inside dir="ltr" islands — DELIBERATE English, not counted, across ${islands.length} island(s):`)
  for (const i of islands.slice(0, 10)) {
    const loc = i.island ? `${i.island.file.replace(/^.*plugin-designs\//, '')}:${i.island.line}` : i.k
    const lines = i.island && i.island.endLine > i.island.line ? `, ${i.island.endLine - i.island.line + 1} lines` : ''
    console.log(`   · ${loc}  <${i.island?.tag ?? '?'}>  ${i.n} string(s)${lines}`)
  }
  if (islands.length > 10) console.log(`   · …and ${islands.length - 10} more island(s)`)
}
if (suspects.length) {
  // NOT counted. Whether the child renders the prop is not knowable from here, so this is a question
  // for a human rather than a defect. It is the only visibility we have into a class the gate cannot
  // confirm: the English is in one file and the render is in another.
  console.log(`\n  ${suspects.length} SUSPECT literal prop(s) — English handed to a component that may render it:`)
  for (const f of suspects) console.log(`   ? ${f.file.replace(/^.*plugin-designs\//, '')}  ${f.text}`)
}
// ★ THE STAMP GOES ON THE LINE PEOPLE QUOTE, not only on the header. gospel's qualification is that
// they investigated our mismatch because the ARITHMETIC WOULD NOT CLOSE — an eight-hit gap was too
// large to rationalise — and that a gap of one or two would have been shrugged off as drift. So the
// residual failure is a discrepancy SMALL ENOUGH TO EXPLAIN AWAY, and provenance in a header the
// quoter skips does nothing for it. The verdict line is the one that gets pasted into a report, so
// the tree travels with the number rather than three lines above it.
console.log(leaks.length
  ? `\nHARDCODED-ENGLISH: ${leaks.length} user-visible English string(s) not going through t()  [tree ${treeStamp()}]`
  : `\nHARDCODED-ENGLISH: PASS — no user-visible hardcoded English in any production plugin  [tree ${treeStamp()}]`)
process.exit(leaks.length ? 1 : 0)
}
