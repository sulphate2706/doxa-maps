#!/usr/bin/env node
/* check-optional-t-equivalence.mjs — `bun run check:optional-t-equivalence`. Source-only, headless.
   EVERY LATER C4 WAVE EXTENDS THIS FILE (REGC4G): a wave that migrates a site without
   adding its row here is a wave whose behaviour nobody re-checks. Sections 1-6 are the helper's own
   contract; section 7 is the per-site register. */
// C4: does useOptionalT() behave like the twenty hand-written guarded translators it replaces?
//
// Same condition the shepherd set for C2 and C3: old pattern vs new, every branch, negative-tested.
// The old shape, verbatim from usePplrT.js before this migration:
//     const enLookup = (key) => String(key).replace(/^pplr\./,'').split('.').reduce(...enPplr)
//     const fill     = (str, params) => params ? str.replace(/\{(\w+)\}/g, ...) : str
//     try  { const i18n = useI18n(); return (k,p) => { const v = i18n.t(k,p||{}); return v===k ? fill(enLookup(k) ?? k, p) : v } }
//     catch (_) { return (k,p) => fill(enLookup(k) ?? String(k), p) }
//
// ★ WHY THIS CANNOT JUST IMPORT THE MODULE. useOptionalT.js imports vue-i18n and @map/i18n/index.js,
// and that index calls `import.meta.glob` — a Vite transform plain Node cannot run. So the source is
// EXTRACTED AND EXECUTED with tStatic and useI18n stubbed, the same approach check-provider-for.mjs
// uses for engineGlobal, and for the same reason: re-typing the function into the gate would test the
// copy rather than the thing that ships.
import { readFileSync } from 'node:fs'
import { codeOnly } from '../plugin-designs/regions-dashboard/scripts/strip-code.mjs'

let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

const src = readFileSync(new URL('../library/composables/useOptionalT.js', import.meta.url), 'utf8')
const body = src
  .replace(/^import .*$/gm, '')                 // drop the two un-runnable imports
  .replace(/^export default .*$/gm, '')         // and the default re-export (it is not a declaration)
  .replace(/^export /gm, '')
// The composable also imports getRuntimeLocale and cldrChoiceIndex from library/i18n/index.js, which
// cannot be imported here (vue-i18n and the @map alias). cldrChoiceIndex is lifted from that file's
// own text, so the plural rule under test is the shipped one; getRuntimeLocale is a bare host's: no
// locale set, which is the English path every section below exercises.
const i18nSrc = readFileSync(new URL('../library/i18n/index.js', import.meta.url), 'utf8')
const lift = (re, what) => { const m = i18nSrc.match(re); if (!m) throw new Error(`library/i18n/index.js no longer defines ${what}`); return m[0] }
const cldrChoiceIndex = new Function(
  lift(/^const CLDR_CATEGORY_ORDER = .*$/m, 'CLDR_CATEGORY_ORDER') + '\n'
  + lift(/^export function cldrChoiceIndex\([\s\S]*?\n\}$/m, 'cldrChoiceIndex').replace(/^export /, '')
  + '\nreturn cldrChoiceIndex;')()
const make = (tStatic, useI18n, getRuntimeLocale = () => '') => new Function('tStatic', 'useI18n', 'getRuntimeLocale', 'cldrChoiceIndex',
  body + '\nreturn { useOptionalT, useOptionalI18n, fillParams, qualify, pickPluralForm };')(tStatic, useI18n, getRuntimeLocale, cldrChoiceIndex)

// The English catalogue the old code imported, as a stub tree: messages.en.pplr equivalent.
const EN = { greeting: 'Hello {name}', nested: { deep: 'Deep value' } }
const tStatic = (path) => String(path).replace(/^pplr\./, '').split('.').reduce((o, k) => (o == null ? o : o[k]), EN)
const throwingI18n = () => { throw new Error('Need to install with `app.use` function') }
const hostI18n = (table) => () => ({ t: (k) => (k in table ? table[k] : k) })

// ── 1. no i18n on the host — the case seven bundles are actually in ─────────────────────────────
{
  const { useOptionalT } = make(tStatic, throwingI18n)
  const t = useOptionalT('pplr')
  ok(t('greeting', { name: 'Ada' }) === 'Hello Ada', 'bare host: falls back to the catalogue AND interpolates')
  ok(t('nested.deep') === 'Deep value', 'bare host: resolves a nested key')
  ok(t('missing.key') === 'missing.key', 'bare host: a missing key renders as the KEY, never blank')
  ok(t('pplr.greeting', { name: 'Ada' }) === 'Hello Ada', 'bare host: an already-qualified key is not double-prefixed')
}
// ── 2. host HAS i18n and has the string — the host must win ─────────────────────────────────────
{
  const { useOptionalT } = make(tStatic, hostI18n({ 'pplr.greeting': 'Bonjour' }))
  ok(useOptionalT('pplr')('greeting') === 'Bonjour', 'host i18n wins when it has the key -- a host managing locale keeps control')
}
// ── 3. host HAS i18n but LACKS the string: i18n.t returns the key unchanged ─────────────────────
{
  const { useOptionalT } = make(tStatic, hostI18n({}))
  const t = useOptionalT('pplr')
  ok(t('greeting', { name: 'Ada' }) === 'Hello Ada',
    'host i18n present but missing the key falls through to the catalogue -- the case every old copy handled with `v === key`')
}
// ── 4. the pure helpers ────────────────────────────────────────────────────────────────────────
{
  const { fillParams, qualify } = make(tStatic, throwingI18n)
  ok(fillParams('a {x} b', { x: 1 }) === 'a 1 b', 'fillParams interpolates')
  ok(fillParams('a {x} b', {}) === 'a {x} b', 'fillParams leaves an unknown placeholder visible rather than blanking it')
  ok(fillParams('a {x} b', { x: null }) === 'a {x} b',
    'fillParams leaves the placeholder for a NULL value -- a key-presence test would render the string "null" into the sentence')
  ok(fillParams('a {x} b', { x: 0 }) === 'a 0 b',
    'but 0 is a real value and must still substitute (a truthiness test would drop it)')
  ok(fillParams('plain') === 'plain', 'fillParams with no params is a no-op')
  ok(qualify('pplr', 'x') === 'pplr.x' && qualify('pplr', 'pplr.x') === 'pplr.x', 'qualify prefixes once, never twice')
}
// ── 5. EQUIVALENCE with the old hand-written implementation, branch for branch ──────────────────
{
  const fill = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m)) : s)
  const enLookup = (key) => String(key).replace(/^pplr\./, '').split('.').reduce((o, k) => (o == null ? o : o[k]), EN)
  const oldBare = (k, p) => fill(enLookup(k) ?? String(k), p)
  const { useOptionalT } = make(tStatic, throwingI18n)
  const neu = useOptionalT('pplr')
  for (const [k, p] of [['greeting', { name: 'Ada' }], ['nested.deep', null], ['missing.key', null], ['greeting', null]]) {
    ok(oldBare(k, p) === neu(k, p), `EQUIVALENT on the bare-host path for ${JSON.stringify(k)}: both give ${JSON.stringify(oldBare(k, p))}`)
  }
}
// ── 6. NEG CONTROLS ────────────────────────────────────────────────────────────────────────────
{
  const { useOptionalT } = make(() => undefined, throwingI18n)
  ok(useOptionalT('pplr')('greeting') === 'greeting',
    'NEG CONTROL: with a catalogue that knows nothing, the key comes back -- so the passes above were really reading the catalogue')
  const { useOptionalT: u2 } = make(tStatic, hostI18n({ 'pplr.greeting': 'Bonjour' }))
  ok(u2('pplr')('greeting') !== 'Hello Ada', 'NEG CONTROL: the host path and the catalogue path are distinguishable')
}
ok(/import \{[^}]*\btStatic\b[^}]*\} from '@map\/i18n\/index\.js'/.test(src), 'CONTROL: the shipped module really does route through tStatic (not a catalogue import of its own)')
// ★ codeOnly, because this assertion failed on its OWN DOCUMENTATION: useOptionalT.js's header QUOTES
// '@map/i18n/locales/en/pplr.json' as the import it removed, and a whole-file grep counted the prose as
// the thing it forbids. Fifth time this session that a detector has read a comment as code.
ok(!/locales\/en\//.test(codeOnly(src)), 'CONTROL: and it imports NO per-area English JSON in CODE -- the redundant second copy is gone')


// ── 7. THE PER-SITE REGISTER. One row per migrated site; later waves append here. ───────────────
// Each row asserts the two things a migration can get wrong: that the site actually routes through
// the shared guard, and that it still carries ITS OWN fallback rather than silently inheriting the
// catalogue. The second matters more than it looks: routing these through tStatic would change what
// seven bare-host bundles render, and would start translating strings that are English today.
import { readFileSync as rf, readdirSync } from 'node:fs'
const SITES = [
  // file, helper it must use, a fragment of the fallback it must still pass
  // On the {t, te, locale} form since formatList: the names list must follow its sentence's locale.
  ['library/components/legends/ApproxPinNote.vue',      'useOptionalI18n',  'APPROX_FALLBACK[key]'],
  ['library/components/search/FilterDropdown.vue',      'useOptionalT',     'FALLBACK[key]'],
  ['library/components/legends/SemanticTreeLegend.vue', 'useOptionalI18n',  'humanizeKey(k)'],
  ['library/components/poster/PosterWall.vue',          'useOptionalI18n',  'humanizeKey(k)'],
  ['library/components/hints/PinHint.vue',              'useOptionalI18n',  'PINHINT_FALLBACK[key]'],
  ['plugin-designs/pplr-data-maps/src/composables/usePplrT.js',        'useOptionalT', null],
  ['plugin-designs/upg-neighbor/src/composables/useNeighborT.js',      'useOptionalT', null],
  // wave 3a — gospel-resources. All four fell back to enLookup, i.e. the
  // SHIPPED ENGLISH, not the locale-aware catalogue; each passes that enLookup in, so a bare host
  // still renders English. Switching them to the catalogue default would make a bare host honour
  // ?lang=ar — a real improvement, and its owner's to make, not this migration's.
  // ★ gospel-resources' owner CHOSE the locale-honouring catalogue fallback (2026-09-26) rather than keeping
  // enLookup's English: "most partners will drop a custom element or an iframe and never install
  // vue-i18n ... an Arabic ministry site embedding this map serves its readers English while the
  // bundle already carries all 11 catalogues. That is a bug, not a decision." So these four take NO
  // fallback, and row 7b proves the Arabic actually arrives.
  ['plugin-designs/gospel-resources/charts.vue',         'useOptionalT', null],
  ['plugin-designs/gospel-resources/data-tables.vue',    'useOptionalT', null],
  ['plugin-designs/gospel-resources/resources-list.vue', 'useOptionalT', null],
  // ★ resources-map passes NO NAMESPACE: it uses keys in TWO areas (gospel.* and pins.*) and its
  // enLookup walks the catalogue ROOT to see both. useOptionalT('gospel', ...) would have qualified
  // pins.approximate into gospel.pins.approximate and broken the pins sentence — studio caught that
  // as a semantic conflict on main before it landed. The row asserts the '' explicitly so a later
  // edit cannot quietly re-add a namespace.
  ['plugin-designs/gospel-resources/resources-map.vue',  "useOptionalT(''", null],
  // wave 3b — cities-internet. All three were byte-identical in the guard block; each keeps its own
  // enLookup fallback, so a bare host renders the same English. Their local fill() used `k in params`,
  // so the shared fillParams also removes a way for them to print the literal "null".
  // ★ cities-internet's owner took the locale-honouring default (2026-09-26): the bundle already
  // carries all 11 catalogues, so a bare host getting English would be a bug. So these
  // three pass NO fallback, and their English-only enLookup + per-area catalogue import are deleted.
  ['plugin-designs/cities-internet/connectivity-list.vue', 'useOptionalT', null],
  ['plugin-designs/cities-internet/connectivity-map.vue',  'useOptionalT', null],
  ['plugin-designs/cities-internet/data-tables.vue',       'useOptionalT', null],
  // wave 3d — all-people-groups. Treated as UNOWNED, so the conservative reading wins:
  // its inline EN map stays the fallback rather than switching to the catalogue, because nobody is
  // available to decide that this bundle should start honouring the locale on a bare host -- THEN
  // the locale-honouring fallback was RULED for everywhere (2026-09-27; the goal: a bare-host
  // embed with ?lang=ar must render Arabic, now the embed contract in COMMON.md). So it takes
  // the catalogue default, its duplicate EN map is deleted, and section 9 keeps the ruling's PRECONDITION
  // true rather than measured once.
  // First site on the {t, te, locale} form: it needs locale for toLocaleString.
  // ⚠ null, NOT a fallback. This row came back as 'fallback: (full) =>' in a merge, because the branch it
  // merged from predates 0ded1a4e — the commit that carried out the embed-contract ruling here and deleted
  // the inline EN map. Taking a SITES array wholesale from another branch re-asserts ITS view of every
  // file in it, including the ones you changed; the gate caught it, which is the only reason it is right.
  ['plugin-designs/all-people-groups/all-people-groups.vue', 'useOptionalI18n', null],
  // wave 3c — my-upg-100-list. No namespace, since callers pass full keys.
  // ⚠ THE THIRD COLUMN IS null, NOT 'humanizeKey(k)', and that is a DEPARTURE from 4c05e589, which
  // kept the fallback. Correct as first written; wrong the moment the owner took the
  // product call (UPGHK, 2026-09-27) to delete it. A row asserting a fallback the code no longer
  // passes fails by design — the same hole flagged earlier in the opposite direction.
  // ★ WHY IT WAS DELETED. humanizeKey rendered a key's last segment title-cased, failing two ways: on
  // the messages keys it printed "Upg100 Wall Intro" where a whole sentence exists (wrong even in
  // English), and on the tabs keys it printed the RIGHT English by coincidence — those keys are named
  // after the words — so it looked correct forever while every non-English reader silently got
  // English. A fallback that agrees with en is indistinguishable from a working translation until
  // someone changes locale.
  // The premise for keeping it ("these keys are not fully catalogued") was MINE and was FALSE: seven
  // keys across both files, all string literals, every one present in all eleven locales, 0 gaps.
  // Same class of decision gospel-resources' owner took for its four sites above, and the OPPOSITE of the 3d
  // reading directly above — which is right, because that file is unowned and these two are not.
  ['plugin-designs/my-upg-100-list/poster-wall.vue',  'useOptionalT', null],
  ['plugin-designs/my-upg-100-list/upg-100-mfe.vue',  'useOptionalT', null],
]
// ★ ONE FILE KEEPS TWO BARE useI18n CALLS ON PURPOSE, and the count is asserted rather than waived.
// resources-map.vue reads the LOCALE twice (`useI18n().locale.value`) to decide isEnglish and the
// engine's language tag. That is a different fact from translating text: `locale` arrives as a ref OR
// a plain string depending on the host (PosterWall.vue records the same variance), so normalising it
// belongs in a deliberate helper change, not in a translator migration. Asserting EXACTLY 2 means a
// third bare call — a new unguarded translator — still fails this gate.
// ★ DELIBERATELY NOT IN THIS REGISTER, so nobody "completes" C4 by converting it:
//   plugin-designs/pplr-data-maps/src/components/SemanticTreeLegend.vue
// It still hand-rolls the guard, and its owner asked for it to stay that way: the file is carded for
// retirement (RETIRE-PPLR-SEMANTICTREELEGEND) in favour of the library component, so converting it is
// work that gets thrown away. A migration whose value expires before it lands is not worth the diff.
// Two more sites are their owners' to cut, not absent by oversight: country-posters-mfe.vue
// (into its single posters landing) and key-cities/cities-map.vue (gated).

const ALLOWED_BARE = { 'plugin-designs/gospel-resources/resources-map.vue': 2 }
for (const [file, helper, fallbackFrag] of SITES) {
  // ★ STRIP HTML COMMENTS TOO, for .vue files. codeOnly is a JS scanner: it knows /* */ and //, not
  // <!-- -->. resources-map.vue carries a long template comment that MENTIONS useI18n(), and counting
  // it made this register read 3 bare calls where the code has 2. Same lesson as the CSS-in-a-template
  // -literal case: the stripper has to match the LANGUAGE of the text it is reading.
  const raw = rf(new URL('../' + file, import.meta.url), 'utf8')
  const code = codeOnly(raw.replace(/<!--[\s\S]*?-->/g, ' '))
  const short = file.split('/').pop()
  ok(helper.includes('(') ? code.includes(helper) : new RegExp(`\\b${helper}\\(`).test(code),
    `${short}: routes through ${helper}${helper.includes('(') ? '' : '()'}`)
  const bare = (code.match(/useI18n\(/g) || []).length
  const allowed = ALLOWED_BARE[file] || 0
  ok(bare === allowed, allowed
    ? `${short}: exactly ${allowed} bare useI18n() left, the documented locale read(s) -- found ${bare}`
    : `${short}: no bare useI18n() left in CODE (comments explaining it are fine)`)
  if (fallbackFrag) {
    ok(code.includes(fallbackFrag),
      `${short}: still passes its OWN fallback (${fallbackFrag}) -- migrating it to the catalogue would change what a bare host renders`)
  } else {
    // ★ NOT "as it always did" for all of them. The two composables always resolved through the
    // catalogue; gospel's four used to resolve through enLookup's ENGLISH and were MOVED here by their
    // owner's decision. Saying "as it always did" for those four would be a false statement inside a
    // gate message, which is the one place a reader has no reason to doubt.
    // Which sites were MOVED to the catalogue by a decision, vs which always resolved there. Saying "as it
    // always did" about a moved file is a false statement inside a gate message, the one place a reader has
    // no reason to doubt. gospel-resources and cities-internet moved by their owners' decisions,
    // my-upg-100-list by a product call (UPGHK) deleting humanizeKey, and all-people-groups by
    // the embed-contract ruling (locale-honouring everywhere, 2026-09-27).
    const MOVED_BY = {
      'gospel-resources': "its owner moved it here from enLookup's English",
      'cities-internet': "its owner moved it here from enLookup's English",
      'my-upg-100-list': 'its owner moved it here from humanizeKey, a title-cased key segment',
      'all-people-groups': "the embed contract moved it here from its inline English map",
    }
    const mover = Object.keys(MOVED_BY).find((d) => file.includes(d))
    ok(!/fallback:/.test(code), mover
      ? `${short}: takes the locale-honouring CATALOGUE fallback (${MOVED_BY[mover]})`
      : `${short}: takes the CATALOGUE fallback, as it always did`)
  }
}

// ── 7b. gospel-resources' ASKED-FOR ROW, against the REAL catalogue ───────────────────────────────
// Their words: "a BARE host (no vue-i18n) with ?lang=ar must render pins.approximate in Arabic — not
// the key, not gospel.pins.approximate, not English." It covers their conditions 1 and 2 together: a
// namespace would corrupt the key, and an EN-only fallback would serve English to an Arabic reader.
// This reads the SHIPPED ar/ and en/ pins.json rather than a stub, and rebuilds tStatic's own
// resolution order (messages[want] ?? messages.en) over them, so it measures the real catalogue.
{
  const arPins = JSON.parse(rf(new URL('../library/i18n/locales/ar/pins.json', import.meta.url), 'utf8'))
  const enPins = JSON.parse(rf(new URL('../library/i18n/locales/en/pins.json', import.meta.url), 'utf8'))
  const messages = { ar: { pins: arPins }, en: { pins: enPins } }
  const realish = (want) => (path) => {
    const walk = (loc) => String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), messages[loc])
    const v = walk(want); return typeof v === 'string' ? v : walk('en')
  }
  const { useOptionalT } = make(realish('ar'), throwingI18n)
  const t = useOptionalT('')
  const got = t('pins.approximate')
  ok(got === arPins.approximate,
    'GOSPEL ROW: a BARE host under ar renders pins.approximate in ARABIC from the real catalogue')
  ok(got !== 'pins.approximate' && got !== 'gospel.pins.approximate',
    'and it is neither the raw key nor a namespace-mangled key')
  ok(got !== enPins.approximate,
    'and it is NOT the English -- which is exactly what enLookup used to serve every partner host')
  // the same call must still reach English when the locale has no entry
  const tEnOnly = useOptionalT('')
  ok(typeof arPins.approximate === 'string' && typeof enPins.approximate === 'string',
    'CONTROL: both catalogues really do carry the key, so the three assertions above are measuring a difference that exists')
  const { useOptionalT: uMissing } = make(realish('zz'), throwingI18n)
  ok(uMissing('')('pins.approximate') === enPins.approximate,
    'ENGLISH REMAINS THE LAST RESORT: an unknown locale falls back to en, as gospel required')
}

// ── 9. THE RULING'S PRECONDITION, kept true rather than measured once ───────────────────────────
// Dropping a site's own English fallback is only safe while the catalogue HAS every key that site asks
// for. Before the switch I measured it by hand: 11 keys, 11 locales, 0 gaps. A hand measurement protects
// the day it is taken; this protects every day after, which is the whole difference between a check and
// a note. If a key is added to the source and not catalogued, a bare host now renders the raw dotted
// key -- the exact failure upg100 described, and the reason they had advised keeping a fallback at all.
{
  const src = rf(new URL('../plugin-designs/all-people-groups/all-people-groups.vue', import.meta.url), 'utf8')
  // ★ RAW SOURCE, NOT codeOnly, AND THE ASYMMETRY IS THE REASON. For "does the catalogue hold every key
  // this file asks for", over-including a key (one that only appears in a comment) makes the check
  // STRICTER and can only cause a false red that a human resolves in seconds. UNDER-including one makes
  // it claim completeness it does not have, which is the failure this section exists to prevent.
  // It matters concretely: codeOnly loses `tr('pray')` in this file. That call lives inside a template
  // literal whose `https://` was read as a line comment, because the scanner had already lost template
  // state further up a 1000-line SFC. See the limitation note in strip-code.mjs. Six keys became seven
  // the moment the census stopped stripping.
  const code = src
  const literal = [...new Set([...code.matchAll(/\btr\(\s*'([A-Za-z][\w.]*)'/g)].map((m) => m[1]))]
  // ★ LITERALS ARE NOT ALL OF THEM, and a census that stopped here would have claimed completeness while
  // blind to a third of the keys. This file also calls tr(cat.id) and tr(c.id) -- the category ids from
  // the CATS array -- so four keys (doxa, frontier, unreached, reached) never appear as a literal
  // argument. Extract those ids too, and assert BOTH that they were found and that the dynamic call
  // sites still look the way this extraction assumes.
  const catIds = [...new Set([...code.matchAll(/\{\s*id:\s*'([a-z]+)'\s*,\s*color:/g)].map((m) => m[1]))]
  const dynamic = [...new Set([...code.matchAll(/\btr\(\s*([A-Za-z_$][\w.$]*)/g)].map((m) => m[1]))]
  ok(dynamic.length === 0 || catIds.length > 0,
    `the dynamic tr() arguments (${dynamic.join(', ') || 'none'}) are covered by the CATS ids (${catIds.join(', ') || 'NONE FOUND'})`)
  ok(catIds.length === 4,
    `found ${catIds.length} category ids -- if this changes, the dynamic keys this census covers have changed with it`)
  const used = [...new Set([...literal, ...catIds])]
  ok(used.length > literal.length,
    `all-people-groups: ${used.length} keys verified = ${literal.length} literal + ${catIds.length} reached only through tr(cat.id)`)
  // Locale FOLDERS only: the folder also holds a README.md (bba33e783), which is not a locale.
  const locales = readdirSync(new URL('../library/i18n/locales', import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name)
  const gaps = []
  for (const k of used) for (const loc of locales) {
    let v
    try { v = JSON.parse(rf(new URL(`../library/i18n/locales/${loc}/allPeopleGroups.json`, import.meta.url), 'utf8'))[k] } catch (_) { v = undefined }
    if (v === undefined || v === '') gaps.push(`${loc}:${k}`)
  }
  ok(gaps.length === 0,
    `every key it asks for exists in all ${locales.length} locales${gaps.length ? ` -- MISSING ${gaps.slice(0, 6).join(', ')}` : ''}`)
  let invented
  try { invented = JSON.parse(rf(new URL('../library/i18n/locales/en/allPeopleGroups.json', import.meta.url), 'utf8')).definitelyNotACataloguedKey } catch (_) {}
  ok(invented === undefined, 'NEG CONTROL: an invented key is absent, so the lookup above can actually fail')
}

// ── 8. the fallback option and te/locale, behaviourally ────────────────────────────────────────
{
  const { useOptionalT, useOptionalI18n } = make(tStatic, throwingI18n)
  const mine = useOptionalT('pplr', { fallback: (k) => (k === 'pplr.greeting' ? 'MINE {name}' : undefined) })
  ok(mine('greeting', { name: 'Ada' }) === 'MINE Ada',
    'opts.fallback WINS over the catalogue -- that is what keeps each migrated site rendering its own English')
  ok(mine('nested.deep') === 'nested.deep',
    'and when the site fallback has nothing, the KEY shows (it does NOT silently fall through to the catalogue)')
  const { te, locale } = useOptionalI18n('pplr')
  ok(te('greeting') === false, 'te() is FALSE on a bare host -- PinHint and SemanticTreeLegend depend on that to use their own defaults')
  ok(locale === 'en', 'locale defaults to en on a bare host, as PosterWall had it')
}
{
  const { useOptionalI18n } = make(tStatic, hostI18n({ 'pplr.greeting': 'Bonjour' }))
  const { te } = useOptionalI18n('pplr')
  ok(typeof te === 'function', 'te() is a function when the host HAS i18n')
}

// ── the PLURAL fallback: a bare host picks the form an installed vue-i18n would ─────────────────────
{
  const { pickPluralForm } = make(tStatic, throwingI18n)
  const en = '{n} list | {n} lists', ru = '{n} народ | {n} народа | {n} народов | {n} народа'
  ok(pickPluralForm(en, 1, 'en') === '{n} list' && pickPluralForm(en, 0, 'en') === '{n} lists' && pickPluralForm(en, 7, 'en') === '{n} lists',
    'English picks one|other by vue-i18n\'s own rule (0 and 7 plural, 1 singular)')
  ok(pickPluralForm(ru, 21, 'ru') === '{n} народ' && pickPluralForm(ru, 3, 'ru') === '{n} народа' && pickPluralForm(ru, 5, 'ru') === '{n} народов',
    'Russian picks by CLDR (21 one, 3 few, 5 many) — not by English\'s rule, which would give 21 the many form')
  ok(pickPluralForm('no pipes here', 3, 'ru') === 'no pipes here', 'a string with no plural forms is returned whole')
  const { useOptionalT } = make(tStatic, throwingI18n, () => 'ru')
  ok(useOptionalT('')('greeting', { name: 'Ada' }) === 'Hello Ada', 'a call WITHOUT a count is unchanged by the plural path')
}

console.log(fails ? `\nC4-OPTIONAL-T: ${fails} FAIL(s)` : '\nC4-OPTIONAL-T: the shared translator matches the hand-written guards on every branch')
process.exit(fails ? 1 : 0)
