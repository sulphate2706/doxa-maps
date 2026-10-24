#!/usr/bin/env node
/**
 * check-language-code-link.mjs — the map's language selection must reach the grid, or narrow nothing.
 *
 * THE BUG (measured on main 49992a5d, MapLibre, BOTH locales). Languages > Language >
 * "Arabic": the map emitted `map-filtered` with {language:"Arabic", languageCode:""}, the composite
 * handed the grid an empty code, and the grid went 2,107 -> 0. An empty grid reads as "no results",
 * which is the worst shape a wiring bug can take — the reader believes the data.
 *
 * THE CAUSE, and it is one line. The emitter looked for a row whose language LABEL === the selected
 * name. A LANGUAGE NODE'S LABEL IS NOT A LABEL ANY ROW CARRIES: useLanguageFamilyLegendData builds
 * family > language > dialect and derives the language tier by splitting the API label at the comma.
 * MEASURED on the live source: 2,107 rows, all carrying primary_language as {value,label}, and NO
 * row whose label is "Arabic" — what exists is "Arabic, Sudanese", "Arabic, Levantine", "Arabic,
 * Gulf", 23 codes in all. The exact match could never hit, in any locale, which is why it failed
 * identically in en and ar.
 *
 * ★ THE NUMBERS THIS GATE PINS, measured on the committed fixture (864 distinct label/value pairs,
 * 805 base language tiers):
 *     OLD exact-label rule: 61 tiers resolved "" -> the grid went to zero. "Arabic" was one.
 *     NEW rule:            764 tiers resolve ONE code (the grid filters), 41 cover several and
 *                          abstain honestly.
 * The 41 are real ambiguity, not a bug: "Arabic" alone means 23 ISO codes, so no single value can
 * express it. Sending one of them would show a fraction of the selection while looking correct;
 * sending the tier NAME shows zero. Abstaining is the only option that does not lie, until
 * filterSet goes multi-value (SPEC-DASHBOARD-KIT D1).
 *
 * ★ ONE APPROXIMATION, STATED RATHER THAN HIDDEN. The gate derives the tier set by splitting each
 * label at the first comma. The legend derives `langKey` by a longer route (family lookup, suffix
 * patterns), so the two sets are close but not provably identical — a tier the legend shows and
 * this split does not would go unchecked. What IS exact is the part that broke: check B proves the
 * emitter's predicate and the legend's filter agree on every (label, tier) pair, so the two ends
 * cannot drift apart again whatever the tier set turns out to be.
 *
 * WHAT IT CHECKS — all of it against the SHIPPING SOURCE, lifted, never re-typed:
 *   A. the emitter's match rule exists and is the legend's three-arm rule (base / "base," prefix /
 *      " base" suffix), evaluated against the fixture.
 *   B. the legend's own filter expression still has those same three arms — because the ONE thing
 *      that caused this bug was two spellings of one rule drifting apart. A fourth spelling is the
 *      next bug, so the gate compares the two that exist.
 *   C. for every base tier: exactly one code -> a NON-EMPTY languageCode; several -> an EMPTY
 *      languageCode AND a populated languageCodes.
 *   D. the composite sends the WHOLE code set when a selection covers several (SPEC-DASHBOARD-KIT
 *      D1), and never the tier NAME. Before D1 the honest answer was to abstain, because the grid
 *      could hold one value; now that it takes a list, abstaining would leave a selection
 *      unexpressed that the receiving end can express. Asserted per tier: the joined set must
 *      select exactly the rows the map selected.
 *   E. no tier may produce a value that selects zero rows. That is the user-visible invariant and
 *      it is asserted directly, not inferred.
 *   F. a DIALECT reports a NAME and not a tree node id, and the emitter sends ONE event per
 *      settled selection rather than a burst. Both from a measured case.
 *   G. that ONE event is not the cascade's transient EMPTY state. Same case, second measurement:
 *      the coalescing worked and the single event was EMPTY in 3 of 4 runs.
 *
 * NO NETWORK, NO BROWSER (Playwright is the browser-QA lane's alone). The fixture is committed and was taken from
 * the live source; refresh it with --refresh-fixture when the source's language set changes.
 *
 * NEGATIVE-TESTED 2026-09-26, each FAILS:
 *   the emitter's rule reverted to `lab === base`        -> A, then C/E naming "Arabic"
 *   the comma-prefix arm dropped from the emitter        -> A (disagrees with the legend)
 *   the legend's filter arms changed without the emitter -> B
 *   gridLanguage() reverted to `value || label`          -> D
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'LANGUAGE-CODE-LINK'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const EMITTER = join(ROOT, 'plugin-designs/doxa-research-map/research-map.vue')
const COMPOSITE = join(ROOT, 'plugin-designs/research-map-plus-grid/research-map-plus-grid.vue')
const LEGEND = join(ROOT, 'library/composables/legends/useLanguageFamilyLegendData.js')
const FIXTURE = join(HERE, 'fixtures', 'language-codes.json')

const fails = []
const notes = []

// ── --refresh-fixture: the only thing here that touches the network ──────────────────────────
if (process.argv.includes('--refresh-fixture')) {
  const sources = JSON.parse(readFileSync(join(ROOT, 'library/api/sources.json'), 'utf8'))
  const cfg = sources.sources[sources.activeSource]
  const url = `https://pray.doxa.life${cfg.endpoints.bulk}?fields=${cfg.defaultFields.join(',')}&lang=en`
  const j = await (await fetch(url, { signal: AbortSignal.timeout(60000) })).json()
  const rows = j.posts || j.data || []
  // Deduplicate by the (label,value) PAIR — never sample. Both questions this fixture answers
  // (does the exact label exist; how many codes does this tier cover) must be asked of the
  // complete language set, or the counts above are about a sample and mean nothing.
  const seen = new Set(); const keep = []
  for (const r of rows) {
    const l = r.primary_language
    if (!l || !l.label || !l.value) continue
    const k = l.label + '\u0000' + l.value
    if (seen.has(k)) continue
    seen.add(k)
    keep.push({ primary_language: { value: l.value, label: l.label } })
  }
  writeFileSync(FIXTURE, JSON.stringify(keep) + '\n')
  console.log(`${TAG}: fixture refreshed — ${rows.length} api rows -> ${keep.length} distinct (label,value) pairs.`)
  process.exit(0)
}

if (!existsSync(FIXTURE)) { console.log(`${TAG}: SKIP — no fixture (run with --refresh-fixture).`); process.exit(0) }
const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const emitterSrc = readFileSync(EMITTER, 'utf8')
const compositeSrc = readFileSync(COMPOSITE, 'utf8')
const legendSrc = readFileSync(LEGEND, 'utf8')

// ── A. lift the emitter's match rule and run it ──────────────────────────────────────────────
// Lifted, not re-typed: a gate that carries its own copy of the rule passes while the product is
// broken, which is precisely how the bug above survived a green check:linked-vocabulary.
const mRule = /const matchesLanguage = \(lab, base\) =>\s*([\s\S]*?)\n\s*const selectedRows/.exec(emitterSrc)
let matchesLanguage = null
if (!mRule) {
  fails.push('A  research-map.vue: no `const matchesLanguage = (lab, base) =>` — the emitter\'s match rule moved or was renamed, so this gate is blind to the line that broke.')
} else {
  try { matchesLanguage = new Function('lab', 'base', `return (${mRule[1].trim()})`) } catch (e) {
    fails.push(`A  research-map.vue: the lifted match rule does not evaluate (${e.message}).`)
  }
}

// ── B. the legend's own filter must still be the same three arms ─────────────────────────────
// This is the drift guard. The bug was two spellings of one rule disagreeing; the fix mirrors the
// legend's expression in JS, so the gate's job is to notice when the original moves.
{
  const node = /id:\s*`lang:\$\{fam\.key\}__\$\{langKey\}`[\s\S]*?filter: \[([\s\S]*?)\],\n\s*children: \[\],/.exec(legendSrc)
  if (!node) {
    fails.push('B  useLanguageFamilyLegendData.js: could not find the `lang:` node\'s filter expression — the legend\'s own rule moved, and the emitter mirrors it.')
  } else {
    const f = node[1]
    const arms = [
      [/\['==', \['get', 'language'\], langKey\]/, 'exact match on the base name'],
      [/\['==', \['slice', \['get', 'language'\], 0, langKey\.length \+ 1\], langKey \+ ','\]/, 'the "base," comma-prefix arm'],
      [/\['in', ' ' \+ langKey, \['get', 'language'\]\]/, 'the " base" suffix-contains arm'],
    ]
    for (const [re, what] of arms) {
      if (!re.test(f)) fails.push(`B  useLanguageFamilyLegendData.js: the language node's filter no longer has ${what}. research-map.vue's matchesLanguage() mirrors these three arms — change both together, or the map and the grid select different rows again.`)
    }
    if (matchesLanguage) {
      // And prove the mirror on real data rather than on the text: the JS rule must agree with the
      // expression's semantics for every label in the fixture.
      const expr = (lab, base) => lab === base || lab.slice(0, base.length + 1) === base + ',' || lab.includes(' ' + base)
      let disagreements = 0
      const bases = new Set(rows.map((r) => String(r.primary_language.label).split(',')[0].trim()))
      for (const base of bases) for (const r of rows) {
        const lab = String(r.primary_language.label).trim()
        if (expr(lab, base) !== !!matchesLanguage(lab, base)) disagreements++
      }
      if (disagreements) fails.push(`B  the emitter's matchesLanguage() disagrees with the legend's filter on ${disagreements} (label, tier) pair(s).`)
      else notes.push(`match rule: agrees with the legend's three-arm filter on every one of ${bases.size} tiers x ${rows.length} labels`)
    }
  }
}

// ── C/E. every tier resolves to a code, or abstains — and never to an empty grid ──────────────
if (matchesLanguage) {
  const byBase = new Map()
  for (const r of rows) {
    const b = String(r.primary_language.label).split(',')[0].trim()
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(r)
  }
  let single = 0, many = 0
  const zeroSelecting = []
  for (const [base, tierRows] of byBase) {
    const selected = rows.filter((r) => matchesLanguage(String(r.primary_language.label).trim(), base))
    // E: the tier the user clicked must select SOMETHING. A tier that selects nothing is the
    // 2,107 -> 0 screen by another route.
    if (!selected.length) { zeroSelecting.push(base); continue }
    const codes = [...new Set(selected.map((r) => r.primary_language.value).filter(Boolean))]
    const languageCode = codes.length === 1 ? codes[0] : ''
    if (codes.length === 1) {
      single++
      if (!languageCode) fails.push(`C  "${base}" covers exactly one code but resolved an empty languageCode.`)
    } else {
      many++
      if (languageCode) fails.push(`C  "${base}" covers ${codes.length} codes but still emitted a single languageCode — one of them would show a fraction of the selection while looking correct.`)
      if (!codes.length) fails.push(`C  "${base}" resolved no codes at all.`)
      // D1: the SET is what the grid now filters on, so it has to select exactly the rows the map
      // selected. Asserted per tier rather than on one example, because a join that dropped or
      // duplicated a code would still look plausible on "Arabic".
      const joined = codes.join('|')
      const wants = new Set(joined.split('|'))
      const gridRows = rows.filter((r) => wants.has(r.primary_language.value))
      if (gridRows.length !== selected.length) {
        fails.push(`C  "${base}": the map selects ${selected.length} row(s) but the joined code set selects ${gridRows.length} — the two ends of the link disagree.`)
      }
    }
  }
  if (zeroSelecting.length) {
    fails.push(`E  ${zeroSelecting.length} language tier(s) select ZERO rows, so clicking them empties the grid: ${zeroSelecting.slice(0, 6).join(', ')}`)
  }
  notes.push(`tiers: ${byBase.size} — ${single} resolve one code, ${many} cover several and cross as the whole set (D1); every tier narrows the grid to the rows the map selected`)
  if (many === 0) fails.push('C  no tier in the fixture covers several codes, so the ambiguous path is untested — the fixture was sampled rather than deduplicated.')
}

// ── D. the composite fails OPEN ──────────────────────────────────────────────────────────────
{
  const g = /function gridLanguage\(\) \{([\s\S]*?)\n\}/.exec(compositeSrc)
  if (!g) {
    fails.push('D  research-map-plus-grid.vue: no gridLanguage() — the composite is back to sending `value || label`, which hands the grid a tier NAME no row carries and empties it.')
  } else {
    let fn = null
    try { fn = new Function('linked', `${g[1]}`) } catch (e) { fails.push(`D  gridLanguage() does not evaluate (${e.message}).`) }
    if (fn) {
      const many = { language: { value: '', label: 'Arabic', codes: ['apd', 'acm', 'ayl'] } }
      const one = { language: { value: 'ben', label: 'Bengali', codes: ['ben'] } }
      // ★ UPDATED FOR D1. This used to require '' for a multi-code tier, and that was the right
      // answer while the grid could hold one value: the map narrowed, the grid did not, and the
      // reader could see both. Now that valueMatches() takes a LIST, abstaining would be leaving a
      // selection unexpressed that the receiving end can express — so the whole code set crosses.
      // What has NOT changed, and is asserted below, is that it never sends the tier NAME: "Arabic"
      // matches no row reading "Arabic, Sudanese", and that is what emptied the grid originally.
      const got = fn(many)
      if (got !== 'apd|acm|ayl') fails.push(`D  gridLanguage() returned ${JSON.stringify(got)} for a selection covering 3 codes — it must send all three, pipe-joined, so the grid narrows to the same rows the map did. (`|` and not `,`: a language label routinely contains a comma.)`)
      if (/[A-Z]/.test(String(got))) fails.push(`D  gridLanguage() returned ${JSON.stringify(got)}, which looks like a display NAME rather than codes — a tier name matches no row and empties the grid.`)
      if (fn(one) !== 'ben') fails.push(`D  gridLanguage() returned ${JSON.stringify(fn(one))} for an unambiguous selection — it must send the single code.`)
      if (!fails.some((f) => f.startsWith('D'))) notes.push('composite: gridLanguage() sends the single code, or every code in the selection — never the tier name')
    }
  }
}

// ── E. the dialect tier: a name, and one event ───────────────────────────────────────────────
// Measured on BOTH engines in BOTH locales: clicking "Arabic, Sudanese" emitted the
// right languageCode and narrowed the grid in only ONE of four runs, while the `language` slot read
// ", Afro-Asiatic__Arabic__Sudanese".
//   THE NAME: selectedDialect.key is the TREE NODE ID (family__baseLang__dialect) and
//   selectedLanguage is empty by the time a dialect is active, so the template produced a leading
//   comma and an internal identifier. The labels the legend grouped are the right words, and they
//   are already in the reader's locale.
//   THE ONE EVENT: a dialect click changes several store values across ticks, so the watcher fired
//   three or four times and this element dispatched a BURST for one click. The composite ignores
//   anything arriving while it pushes state into its children — a guard it needs, because the grid
//   re-emits during a push — and that window is 1.2s. Whether the settled event landed inside it
//   was timing. Three runs lost it; one did not.
// Both are shapes, so both are asserted against the source and neither needs a browser.
{
  const src = emitterSrc
  const line = /language: ([^\n]*),\n/.exec(src.slice(src.indexOf('const detail = {')))
  if (!line) fails.push('E  research-map.vue: could not find the `language:` field of the map-filtered detail — this gate is blind to the name it reports.')
  else {
    if (/dialect\??\.key/.test(line[1])) fails.push(`E  the dialect's display name is built from selectedDialect.key, which is the TREE NODE ID (family__baseLang__dialect), not a name: ${line[1].trim()}`)
    if (!/dialectLabels/.test(line[1])) fails.push(`E  the dialect's display name does not come from dialectLabels (the original API labels, already localized): ${line[1].trim()}`)
  }
  if (!/clearTimeout\(_emitTimer\)[\s\S]{0,200}setTimeout\(emitFilterState/.test(src)) {
    fails.push('E  research-map.vue no longer coalesces map-filtered — one click emits a BURST, and the composite drops whatever arrives inside its 1.2s push window, so whether the settled state lands is timing.')
  } else {
    // ★ THE WATCHER LINE SPECIFICALLY, not the file. A first version searched the whole source for
    // `emitFilterStateSettled()`, which the helper's own declaration satisfies — so reverting the
    // WATCHER to the raw emit left the gate green while the burst came back. A check that its own
    // subject can satisfy is not a check.
    const w = /watch\(\(\) => \[mapStore\?\.selectedRegion[\s\S]{0,240}?\)\n/.exec(src)
    if (!w) fails.push('E  could not find the emitter watcher — this gate is blind to whether the burst is coalesced.')
    else if (!/emitFilterStateSettled\(\)/.test(w[0])) {
      fails.push('E  the settle helper exists but the WATCHER still calls the raw emit, so one click still dispatches a burst.')
    } else notes.push('dialect: named from its labels, and one event per settled selection')
  }
}

// ── G. an empty report after a filled one is re-taken, and the re-take is BOUNDED ────────────
// measured at 52eeb0db: coalescing landed — one event per click — and in 3 of 4 runs
// that one event was EMPTY, so the grid stayed at 2,107. The cascade behind a dialect click passes
// through a fully-cleared store state (mapStore.selectLanguage sets selectedDialect = null BEFORE
// setting the language), and the settle timer fired inside it.
// The first fix was a timeout, and a timeout was the wrong KIND of answer: 60ms was enough on my
// machine and not under headless swiftshader. Lengthening it moves the failure rather than removing
// it. So the guard is SEMANTIC — an all-empty read straight after a filled one is re-taken — and
// BOUNDED, because a genuine clear must always get through. Both halves are asserted: without the
// guard the transient ships, and without the bound a clear can never be reported at all.
{
  const src = emitterSrc
  if (!/_lastEmitWasFilled/.test(src) || !/const isEmpty/.test(src)) {
    fails.push('G  research-map.vue no longer guards an all-empty report. A dialect click passes through a fully-cleared store state, so the settled read can be taken mid-cascade and ship {language:"",languageCode:""} — which the composite correctly reads as "the reader cleared everything".')
  } else if (!/EMPTY_SETTLE_CEILING_MS/.test(src)) {
    // ★ THE BOUND'S SHAPE CHANGED AND THE INVARIANT DID NOT. It used to be a retry COUNT; it was
    // measured that 3 x 60ms catches the cascade on MapLibre and not on Mapbox, so the count became
    // a TIME CEILING — the difference being what the number is FOR. A count is a guess at how long
    // the cascade takes, which cannot be known from here; a ceiling is how long before a clear is
    // believed, which is a choice. What must never change is that SOME bound exists: without one a
    // genuine clear is deferred for ever and the grid can never be un-narrowed.
    fails.push('G  the empty guard is not BOUNDED — without a ceiling a genuine clear is deferred for ever and the grid can never be un-narrowed.')
  } else if (!/_emptyWaitStartedAt = 0/.test(src)) {
    fails.push('G  the wait window is never reset, so the guard protects only the first cascade of a session.')
  } else notes.push('empty guard: re-read until the state fills, with a ceiling before a clear is believed')
}

// ── H. the echo guard survives the coalescing ────────────────────────────────────────────────
// Measured: a region click emitted the selection and then an EMPTY event, passing only because
// the composite's 1.2s push window swallowed the second. emitFilterState has always opened with
// `if (applyingExternal) return` — a change pushed DOWN by the host is not a change to report back
// up — and that worked while the emit ran synchronously inside the watcher. Debouncing moved the
// emit 60ms later while applyingExternal is released on nextTick, so the flag was already false
// when the emit ran and the echo went out. The guard has to be read where the change happens.
{
  const src = emitterSrc
  const sched = /function emitFilterStateSettled\(\) \{([\s\S]*?)\n\}/.exec(src)
  if (!sched) fails.push('H  research-map.vue: emitFilterStateSettled() not found — this gate cannot see whether the echo guard survives the debounce.')
  // ★ COMMENTS STRIPPED FIRST, and this is the THIRD time the same hole has appeared in my own
  // checks. The body below explains the fix in prose that QUOTES the line it is asserting, so a
  // naive search matched the comment and stayed green after the code was deleted. A check that its
  // own documentation can satisfy is not a check; only executable lines count.
  else if (!/if \(applyingExternal\) return/.test(sched[1].split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'))) {
    fails.push('H  the settle scheduler does not check applyingExternal. The check inside emitFilterState runs 60ms later, and applyingExternal is released on nextTick — so a change the HOST pushed down is reported back up as if the reader had made it. That is an echo, and it reaches the composite as an empty report.')
  } else notes.push('echo guard: read at schedule time, where applyingExternal still means what it says')
}

for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`${TAG}: PASS — every language tier reaches the grid as a code, or honestly narrows nothing.`)
