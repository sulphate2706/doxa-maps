// check-share-policy — one written rule for WHICH MAPS CARRY A SHARE BUTTON.
//
// THE RULE: some maps need a map-level share button and some do not. The Prayer
// Progress map is the one intended for embedding on other people's websites, so it
// MUST have a share button. UPG-100 must not (the header already provides it).
// The per-map rule is decided and recorded here, then applied.
//
// The BEHAVIOUR already existed on both of those. What did not exist was the RULE,
// so nothing stopped the next agent adding a share button to a map that should not
// have one, or leaving a published map with no way to share it at all. Surveying
// all 11 map bundles found FOUR different patterns in use and two published maps
// with no sharing path by any mechanism.
//
// ⚠ WHAT THIS GATE CANNOT SEE — read this before trusting a green run.
// It counts <ShareButton> occurrences in SOURCE. A button that is present in source
// and RENDERS NOWHERE counts exactly the same as a working one. Measured twice:
//   - mutation test 2026-09-24: gating all-people-groups' toolbar off left this gate
//     reporting "1 button / own-button", green, with no button in the DOM;
//   - for real, same day: prayer-walk-planner mounts its SFC directly as the custom
//     element and so installed no i18n. ShareButton calls useI18n(), which THROWS in
//     setup(), and a thrown setup() removes the shadow-DOM subtree SILENTLY. Five
//     toolbar buttons rendered, the sixth did not exist, and this gate passed.
// smoke:share-all is the gate that catches that: it clicks the real control, follows
// the url, and asserts the SAME custom element reopens. Keep every published map in
// its list — this file decides the RULE, that one proves the BEHAVIOUR.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
// A map bundle must have EXACTLY ONE share affordance, and it belongs at the
// OUTERMOST surface a reader actually sees:
//
//   own-button   the map IS the product surface        -> <ShareButton> in the map
//   header       a composite wraps it with a header    -> the header owns sharing,
//                                                         the map omits the button
//   composite    a parent stacks it and overrides
//                shareUrl so the PARENT is shared      -> child button is fine,
//                                                         parent supplies the url
//   none         not published — nothing to share yet
//
// TWO share buttons on one surface is the defect this prevents (it shipped once:
// BUG-UPG100-DOUBLE-SHARE). ZERO on a published map is the opposite defect, and it
// is currently REAL on two bundles — recorded below as known debt rather than
// silently passing, so the count cannot drift without someone deciding.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

// Same fix as check-zone-census.mjs, same reason. DOXA_REPO still wins; only the FALLBACK moved
// off an absolute path into one author's worktree. check:no-abs-paths rejects those outright — "a
// clone must work on any machine" — and it runs inside build:unlocked, so the hardcoded default
// turned the whole build red for every builder. This is the idiom that gate names in its own
// failure text, and the one every sibling script here uses.
const REPO = process.env.DOXA_REPO
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGNS = join(REPO, 'plugin-designs')

// The decided policy, per bundle. A map bundle MUST appear here — an unlisted one
// fails, so adding a map forces the sharing decision rather than deferring it.
const POLICY = {
  'doxa-simple-map': 'own-button',        // Prayer Progress — the embed flagship
  'doxa-research-map': 'own-button',
  'country-posters': 'header',        // country-posters-mfe header owns it
  'cities-internet': 'own-button',
  'gospel-resources': 'own-button',
  'demo-map': 'own-button',
  'my-upg-100-list': 'header',            // upg-100-mfe.vue header owns it
  'research-map-plus-grid': 'composite',  // overrides child shareUrl to share itself
  'key-cities': 'none',                   // not published
  'template-bundle': 'none',              // the STARTER, not published: a copy adds ShareButton when it becomes a real map
  'all-people-groups': 'own-button',      // was debt-no-share; ShareButton added 2026-09-24
  'regions-dashboard': 'own-button',        // a map since its phone popup rules (2026-09-30); its one ShareButton
  // ⚠ prayer-walk-planner took a SECOND LOOK before this flipped, and the reason is worth
  // keeping: it builds a PERSONAL WALKING ROUTE from polygons the reader draws, so a share
  // link that silently drops them arrives as an empty planner — a button that reliably
  // produces a blank map is worse than none, because it LOOKS like sharing worked.
  // That read as a semantics question needing a ruling. It was not: the profile stores
  // polygons in localStorage and has NO BACKEND (its own file header says so), so a URL
  // CANNOT carry a route. There is no design freedom — the shareable artefact is the
  // planner itself, exactly as every other map shares its own page. The failure mode only
  // exists if the link CLAIMS to carry the route, so the button says "tool" and the status
  // strip tells the reader their zones stay on the device.
  'prayer-walk-planner': 'own-button',    // was debt-no-share; resolved 2026-09-24
}

const isMap = (src) => /mapboxgl|maplibregl|useMapInstance/.test(src)
const manifest = JSON.parse(readFileSync(join(REPO, 'public', TREE_NAME, 'manifest.json'), 'utf8'))
const published = new Set(manifest.bundles.map((b) => b.bundle))

const fails = []
const notes = []
const rows = []
for (const name of readdirSync(DESIGNS)) {
  const dir = join(DESIGNS, name)
  let vues = []
  try { vues = readdirSync(dir).filter((f) => f.endsWith('.vue')) } catch { continue }
  if (!vues.length) continue
  const src = vues.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  if (!isMap(src)) continue

  const buttons = (src.match(/<ShareButton/g) || []).length
  const want = POLICY[name]
  rows.push({ name, buttons, want, published: published.has(name) })

  if (!want) {
    fails.push(`${name}: a map bundle with no entry in POLICY — decide whether it shares, and record it`)
    continue
  }
  if (want === 'own-button' && buttons !== 1) {
    fails.push(`${name}: policy "own-button" but ${buttons} <ShareButton> — `
      + (buttons === 0 ? 'the embed surface has no way to be shared' : 'two affordances on one surface'))
  }
  if (want === 'header' && buttons !== 1) {
    // UPG-100's single button lives in the MFE header, not the map — still exactly one.
    fails.push(`${name}: policy "header" expects exactly one share affordance in the bundle, found ${buttons}`)
  }
  // ⚠ 'header' HAS A CONSEQUENCE FOR smoke:share-all, and it drifted once. The button is
  // in the MFE SHELL, so the bundle's LEAF url correctly has none — and smoke:share-all
  // was still pointing at the leaf for both header bundles, reporting 2 failures that
  // were the policy working as designed (measured 2026-09-24: 10/12, both failures
  // 'header'). When a bundle moves to 'header', its entry in smoke:share-all must move
  // from <bundle>/<leaf>/ to <bundle>/<mfe>/ or the suite tests a surface the policy
  // says should be empty.
  if (want === 'debt-no-share' && buttons !== 0) {
    fails.push(`${name}: listed as known debt (no sharing) but now has ${buttons} — update POLICY`)
  }
  if (want === 'none' && published.has(name)) {
    fails.push(`${name}: policy "none" assumes unpublished, but it IS published — it needs a share path`)
  }
}

console.log('  bundle                   published  buttons  policy')
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${r.name.padEnd(24)} ${(r.published ? 'yes' : 'no').padEnd(10)} ${String(r.buttons).padEnd(8)} ${r.want || '(UNDECIDED)'}`)
}
const debt = rows.filter((r) => r.want === 'debt-no-share')
if (debt.length) {
  console.log(`\n  known debt: ${debt.length} published map(s) with NO sharing path — `
    + debt.map((d) => d.name).join(', '))
}

// ── THE SHARE LINK CARRIES THE WHOLE VIEW, INCLUDING THE TYPED SEARCH ─────────────────────────
// The hash carried filterSet only, so a table narrowed by TYPING reopened with MORE ROWS than the
// sender saw — silently, since the recipient had no way to know their set was wider. For population
// data passed between teams that is worse than a link that plainly fails.
// DRIVEN, not asserted: the two pure functions are lifted from the kit source and RUN, so the
// guarantee is measured. Proving a string round-trips needs no browser.
{
  const SRC = 'library/composables/useShareableView.js'
  let src = ''
  try { src = readFileSync(resolve(REPO, SRC), 'utf8') } catch (_) { src = '' }
  if (!src) fails.push(`SHARE-VIEW  ${SRC} is missing — no dashboard can produce a shareable view.`)
  else {
    const pure = src.slice(src.indexOf('const slugify'), src.indexOf('export function useShareableView'))
    let serializeView, parseView, serializeQuery, parseQuery
    try {
      ;({ serializeView, parseView, serializeQuery, parseQuery } = new Function(`${pure.replace(/export /g, '')}; return { serializeView, parseView, serializeQuery, parseQuery }`)())
    } catch (e) {
      fails.push(`SHARE-VIEW  could not lift serializeView/parseView from ${SRC} (${e.message}) — keep them plain top-level functions so this stays measurable.`)
    }
    if (serializeView && parseView) {
      const L = (k) => ({ affinity_bloc: 'Malay Peoples' }[k])
      const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`SHARE-VIEW  ${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
      // An empty search box must write the hash the old code wrote, byte for byte, so every link
      // already sitting in a teammate's notes keeps working and keeps looking the same.
      eq('an empty search still writes the old format', serializeView({ religion_family: 'Hinduism' }, '', { labelFor: L }), '#f=religion_family:Hinduism')
      eq('the slug stays display-only', serializeView({ affinity_bloc: 'A008' }, '', { labelFor: L }), '#f=affinity_bloc:A008*malay-peoples')
      eq('a multi-value key still drops the slug', serializeView({ religion_family: ['Hinduism', 'Islam'] }, ''), '#f=religion_family:Hinduism,Islam')
      // The defect this arm exists for.
      eq('the typed search reaches the link', serializeView({}, 'bhutan'), '#f=&q=bhutan')
      eq('and comes back', parseView(serializeView({ religion_family: 'Hinduism' }, 'bhutan', { labelFor: L })), { filters: { religion_family: 'Hinduism' }, search: 'bhutan' })
      // Delimiters that occur inside real values: a people group with a comma, a search with an `&`.
      eq('a literal comma in a value survives', parseView(serializeView({ language: ['Arabic, Sudanese'] }, '')).filters, { language: 'Arabic, Sudanese' })
      eq('an ampersand in the search survives', parseView(serializeView({}, 'rice & beans')).search, 'rice & beans')
      // Links that already exist must keep opening.
      eq('a legacy JSON hash still restores', parseView('#f=' + encodeURIComponent(JSON.stringify({ affinity_bloc: 'A008' }))).filters, { affinity_bloc: 'A008' })
      eq('an old link with no q restores no search', parseView('#f=religion_family:Hinduism').search, '')
      // QUERY MODE, requested by the gospel-internet board: it already shares as ?access=…&band=…, restored before
      // first render, and writes only on its own leaves so a partner's address bar is never touched. A
      // hash-only composable would have given that board TWO URL states instead of replacing its glue.
      // The host-param case is the one that matters: writing must not eat a query the page already owns.
      eq('query writes one param per facet', serializeQuery({ access: 'low', band: '2g' }, ''), '?access=low&band=2g')
      eq('query preserves a host param', serializeQuery({ access: 'low' }, '', '?utm_source=partner'), '?utm_source=partner&access=low')
      eq('query replaces its own stale param', serializeQuery({ access: 'high' }, '', '?access=low&utm=x'), '?utm=x&access=high')
      eq('query round-trips filters and search', parseQuery(serializeQuery({ access: 'low', band: ['2g', '3g'] }, 'bhutan'), ['access', 'band']), { filters: { access: 'low', band: ['2g', '3g'] }, search: 'bhutan' })
      eq('query reads only declared facet keys', parseQuery('?access=low&panel=map', ['access']).filters, { access: 'low' })
      eq('query keeps a comma inside a value', parseQuery(serializeQuery({ language: ['Arabic, Sudanese'] }, ''), ['language']).filters, { language: 'Arabic, Sudanese' })
      // ★ AN ALIAS MAP, because a param name already published cannot be renamed. gospel-internet has shared
      // ?access= against a bus key of access_level; insisting the two match would have renamed every
      // param on adoption and broken every link already sitting on a partner page — the exact harm this
      // card exists to prevent, delivered by the thing meant to prevent it. Driven with its real names.
      const ALIAS = { access: 'access_level', app: 'messaging' }
      eq('alias writes the published param name', serializeQuery({ access_level: 'low', messaging: 'sms' }, '', '', { facetKeys: ALIAS }), '?access=low&app=sms')
      eq('alias reads an already-shared link', parseQuery('?access=low&app=sms', ALIAS), { filters: { access_level: 'low', messaging: 'sms' }, search: '' })
      eq('an undeclared bus key keeps its own name', serializeQuery({ country: 'BT' }, '', '', { facetKeys: ALIAS }), '?country=BT')
      eq('a host param survives under an alias map', serializeQuery({ access_level: 'low' }, '', '?utm=x', { facetKeys: ALIAS }), '?utm=x&access=low')
      // ★ BOTH SEPARATORS ON READ, ONE ON WRITE. The gospel-internet board has always written band=yes|partial and
      // those links are on partner pages; splitting only on ',' read that back as the single value
      // "yes|partial" and matched no row, so adopting this composable would have broken every multi-value
      // link they had already shared. Reserving `|` on write is what makes accepting it on read free.
      eq('an already-shared | link restores', parseQuery('?band=yes|partial', ['band']).filters, { band: ['yes', 'partial'] })
      eq('mixed separators in one link', parseQuery('?band=yes|partial&country=IND,CHN', ['band', 'country']).filters, { band: ['yes', 'partial'], country: ['IND', 'CHN'] })
      eq('we still write one canonical separator', serializeQuery({ band: ['yes', 'partial'] }, '', '', { facetKeys: ['band'] }), '?band=yes,partial')
      eq('a literal | inside a value is escaped, not split', parseQuery(serializeQuery({ x: 'a|b' }, '', '', { facetKeys: ['x'] }), ['x']).filters, { x: 'a|b' })
      if (!fails.some((f) => f.startsWith('SHARE-VIEW'))) notes.push('share link: filters AND the typed search round-trip in BOTH hash and query mode; old links, legacy JSON and a host page\'s own query all survive')
    }
  }
}
for (const n of notes) console.log('  · ' + n)

if (fails.length) {
  console.error(`\nSHARE-POLICY: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nSHARE-POLICY: PASS — ${rows.length} map bundles, each with exactly one decided sharing rule.`)
