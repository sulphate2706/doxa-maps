#!/usr/bin/env node
/**
 * check-selection-kinds — a territory selected on the MAP must reach the packet.
 *
 * WHY THIS EXISTS: selecting countries on the map left the HUD showing a correct non-zero UUPG
 * total while Prayer list reported zero and refused to generate. Reported from mobile, 2026-09-28.
 * `selectedTerritories` holds THREE kinds — 'zone' (a legend row), 'adm0' (a country, key
 * 'adm0:<ISO3>') and 'adm1' (an India state / China province, key 'adm1:<name>') — and
 * `selectedLists()` kept only 'zone', so a map selection resolved to an empty list.
 *
 * ★ THE SHAPE WORTH PINNING IS THE DISAGREEMENT, not the zero. The HUD sums `t.count` straight off
 * the selection while the packet path goes through `selectedLists()`. TWO SOURCES OF TRUTH FOR ONE
 * SELECTION is why this read as a nonsense error rather than an empty state: the app said 87 and the
 * generator said 0. A gate that only asserted "a country selection yields slugs" would miss the
 * class; this one asserts every kind the resolver can EMIT is handled by the consumer.
 *
 * Headless, no network, no DOM. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const { evaluate } = await import(resolve(ROOT, 'plugin-designs/my-upg-100-list/data/selector-evaluator.js'))
const VUE = read('plugin-designs/my-upg-100-list/upg-100-list.vue')
const TERR = read('plugin-designs/my-upg-100-list/data/territory-counts.js')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// ── 1. EVERY KIND THE RESOLVER EMITS IS HANDLED DOWNSTREAM ─────────────────────────────────────
// ★ Read the kinds OUT OF resolveTerritory rather than listing them here. Listing them is how this
// bug survived: 'adm0' existed in the resolver and nowhere in the consumer, and no test noticed
// because the test would have been written from the same mental list as the consumer.
const kinds = [...new Set([...TERR.matchAll(/kind:\s*'([a-z0-9]+)'/g)].map((m) => m[1]))]
ok(kinds.includes('adm0') && kinds.includes('adm1'),
  `resolveTerritory no longer emits the kinds this gate knows about (found: ${kinds.join(', ')}) — re-read it before trusting the rest of this file`)
for (const k of kinds) {
  // Each kind must be named SOMEWHERE in the consumer — either resolved or explicitly refused.
  ok(new RegExp(`'${k}'`).test(VUE),
    `resolveTerritory emits kind '${k}' but upg-100-list.vue never mentions it — a territory of that kind will be silently dropped from the selection, which is exactly the "zero UPG" defect`)
}

// ── 2. A COUNTRY SELECTION RESOLVES TO ITS PEOPLE GROUPS ───────────────────────────────────────
// The adm0 key carries the ISO3, which IS `country_code` on a people-group row.
const rows = [
  { slug: 'ind-a', country_code: 'IND' },
  { slug: 'ind-b', country_code: 'IND' },
  { slug: 'npl-a', country_code: 'NPL' },
  { slug: 'mys-a', country_code: 'MYS' },
]
const codesFromKeys = (keys) => keys.filter((k) => k.startsWith('adm0:')).map((k) => k.slice(5))
const got = evaluate({ type: 'country_codes', values: codesFromKeys(['adm0:IND', 'adm0:NPL']) }, rows)
ok(got.size === 3, `two tapped countries resolved to ${got.size} people groups, expected 3`)
ok(!got.has('mys-a'), 'the selection leaked a group from a country that was not selected')

// A single country must work too — the common case on a phone, and the one that was reported.
ok(evaluate({ type: 'country_codes', values: ['IND'] }, rows).size === 2,
  'one tapped country did not resolve to its two people groups')

// ── 3. THE CONSUMER ACTUALLY WIRES IT ──────────────────────────────────────────────────────────
// The evaluator supporting country_codes proves nothing if selectionAsList never calls it.
ok(/selectedCountryCodes\s*\(/.test(VUE), 'selectedCountryCodes() is gone — map-tapped countries are unresolved again')
ok(/type:\s*'country_codes'/.test(VUE),
  'selectionAsList no longer builds a country_codes selector — a tapped country will resolve to nothing')
// ⚠ AND IT MUST NOT THROW ON A COUNTRY-ONLY SELECTION. The old guard was `if (!lists.length) throw`,
// which is TRUE for every country selection. The zero came from the guard, not from the data.
ok(/!lists\.length\s*&&\s*!codes\.length/.test(VUE),
  'the "nothing selected" guard tests lists alone again — a country-only selection will throw "nothing selected" while the reader looks at their own highlighted selection')

// ── 4. ADM1 IS REFUSED BY NAME, NOT ABSORBED ───────────────────────────────────────────────────
// ★ A people-group row has country_code and NO province field, so an India state cannot resolve —
// the evaluator has no adm1 case at all. Folding it into the country union would print a packet for
// the whole COUNTRY while the reader selected one STATE: a plausible packet that is quietly wrong,
// which is worse than a refusal. So it must be named in the error.
ok(/selectedAdm1Names\s*\(/.test(VUE), 'adm1 selections are no longer distinguished — they will be silently dropped or silently widened')
ok(/no people-group data for/.test(VUE),
  'the adm1 refusal no longer names the territory — "nothing selected" is a lie when the reader can see their selection on the map')
const adm1Cases = (read('plugin-designs/my-upg-100-list/data/selector-evaluator.js').match(/case 'adm1/g) || []).length
ok(adm1Cases === 0,
  'the evaluator now HAS an adm1 case — if provinces can resolve, stop refusing them and wire them in instead')

// ── 5. THE BUSY STATE SAYS WHICH ACTION IS RUNNING ─────────────────────────────────────────────
// A slow print gave no feedback at all. A disabled button is visually indistinguishable
// from an unresponsive one, so the label has to change — and it must be CLEARED in `finally`, or an
// error leaves the button reading "Working…" forever.
ok(/busyAction/.test(VUE), 'the busy indicator is gone — a slow packet build will look like a dead button again')
// ⚠ COUNT EVERY SETTER, NOT JUST THE LITERAL ONES. The first version of this matched
// `busyAction.value = 'packet'|'poster'` and so was blind to a ternary assignment — which is exactly
// what the legend path uses. A regex that enumerates the shapes it knows about will always miss the
// next shape; match the ASSIGNMENT and exclude the clear.
const finallys = (VUE.match(/finally\s*\{[^}]*busyAction\.value\s*=\s*''/g) || []).length
const setters = (VUE.match(/busyAction\.value\s*=\s*(?!'')/g) || []).length - finallys
ok(finallys >= setters && setters >= 3,
  `busyAction is set ${setters} times but cleared in only ${finallys} finally blocks — a failed print would leave the surface stuck on "Working…"`)

// ★ EVERY SLOW PRINT PATH, NOT JUST THE ONE THAT WAS REPORTED. The busy state was added to the
// selection HUD after a report that its buttons showed no sign of work; the LEGEND's Export path
// (onLegendExport → printPrayerPacket / printPoster) does the same slow work — two dynamic imports,
// a map-SVG fetch, a funnel fetch, a multi-sheet render — and had no busy state at all. It was found
// by sweeping for the CLASS rather than the instance, and this pins it so the surface cannot be
// forgotten again. Asserted per FUNCTION, because "some handler somewhere sets it" is what let the
// legend path stay uncovered while the file as a whole looked fine.
for (const fn of ['onLegendExport', 'makeSelectionPacket', 'makeSelectionPoster']) {
  const body = VUE.match(new RegExp(`async function ${fn}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,2600}?\\n\\}`))
  if (!body) { fails.push(`${fn}() not found — this gate can no longer see the print paths it guards`); continue }
  ok(/busyAction\.value\s*=/.test(body[0]),
    `${fn}() does slow work with NO busy state — a user gets no sign anything is happening, which is the defect already reported on the other print surface`)
  ok(/finally\s*\{/.test(body[0]),
    `${fn}() sets a busy state without a finally — a throw would leave the surface permanently busy and the control dead`)
}

// ── THE VARIANT REACHES THE RENDERER, ACROSS THE FILE BOUNDARY ─────────────────────────────────
// ★ THIS IS THE GATE FOR THE DEFECT THAT COST THE MOST. The packet ▾ was built into PosterWall,
// which the profile people actually open does not mount, so the feature was landed, served and
// invisible. Nothing caught it because every check looked INSIDE one file. The legend EMITS a
// string and the plugin PARSES it, and those two live in different files — so the only assertion
// that could have failed is one that reads BOTH and compares.
{
  const LEGEND = read('library/components/legends/SemanticTreeLegend.vue')
  // What the menu emits…
  const emitted = [...LEGEND.matchAll(/emitExport\('([a-z:]+)'\)/g)].map((m) => m[1])
  ok(emitted.includes('packet:full') && emitted.includes('packet:lightweight'),
    `the legend no longer offers both packets — it emits: ${emitted.join(', ') || '(none)'}`)
  ok(emitted.includes('poster'), 'the legend no longer offers the poster')
  // …and what the plugin understands. A bare 'packet' must keep working, so the consumer splits on
  // ':' rather than matching the two new literals — matching literals is how the next variant
  // silently becomes a no-op.
  ok(/String\(kind\)\.split\(':'\)/.test(VUE),
    'onLegendExport no longer splits the kind — a packet:<variant> emit would fall through as an unknown kind and print nothing')
  // The bases the handler BRANCHES on, read from it (`base === '<kind>'`), plus the poster it falls through
  // to — not a fixed pair. The legend's menu grows (the card deck joined it); a fixed list would either
  // reject the new kind or, widened by hand, stop checking that the handler actually handles it.
  // ⚠ ANCHORED ON `if (`: the busy label's ternary also reads `base === 'cards'`, and matching the bare
  // comparison counted that as a branch — the gate stayed green with the cards branch deleted.
  const handled = new Set(['poster', ...[...VUE.matchAll(/if \(base === '([a-z]+)'/g)].map((m) => m[1])])
  for (const kind of emitted) {
    const [base] = kind.split(':')
    ok(handled.has(base),
      `the legend emits '${kind}', but the plugin's handler has no branch for '${base}' (it branches on: ${[...handled].join(', ')})`)
  }
  // The variant must actually travel to the renderer. Asserting the split alone would pass while
  // the parsed value was dropped on the floor.
  // ⚠ ANCHOR ON `await`, WHICH ONLY A CALL HAS. The first version of this matched
  // `printPrayerPacket(zoneId,\s*variant`, and the DECLARATION — `async function
  // printPrayerPacket(zoneId, variant = 'full')` — matches that too. So when a mutant deleted the
  // ARGUMENT at the call site, the declaration alone kept the assertion green: true for the wrong
  // reason. Same family as a tautology, reached through ambiguity rather than derivation.
  ok(/await printPrayerPacket\(zoneId,\s*variant/.test(VUE),
    'the parsed variant is not passed to printPrayerPacket — the menu would offer two packets and print one')
  ok(/async function printPrayerPacket\([^)]*variant/.test(VUE),
    'printPrayerPacket does not accept a variant')
  // Any first argument: the call is asserted by SHAPE (the variant inside the options object), not by what
  // the zone variable happens to be called. It read `zone` literally, and a rename to `titled` (the zone with
  // its localized title) failed this while the variant was still forwarded.
  ok(/printPacket\(\w+,\s*\{[\s\S]{0,120}variant/.test(VUE),
    'printPrayerPacket does not forward the variant to printPacket — the choice would be parsed, held, and never used')
  // ⚠ AND THE STRINGS THE MENU RENDERS MUST EXIST. A missing key prints the raw key, which reads as
  // a broken translation rather than a missing string — and the explainer is the only place a
  // reader meets what a UPG 100 list IS.
  const EN_LEGEND = JSON.parse(read('library/i18n/locales/en/legend.json'))
  for (const k of ['packet', 'packetExplain', 'packetAria', 'packetFull', 'packetLightweight']) {
    ok(EN_LEGEND.export && EN_LEGEND.export[k],
      `legend.json export.${k} is missing — the menu would render the raw key`)
  }
}

// ── 4. A TAPPED FEATURE RESOLVES AT ITS REAL LEVEL, FROM ITS REAL PROPERTIES ──────────────────────
// Sections 1-2 start from hand-made KEYS ('adm0:IND'), so they could not see the resolver itself
// misfile a country: once the world ADM0 boundaries carried a shapeName, "shapeName → ADM1" turned
// every tapped country into a province (key 'adm1:Sudan', count null, 0 UUPG), and the Prayer List
// refused it (reported from a phone, 2026-09-30). These are the properties the map ACTUALLY hands the
// click handler (read off the live tapestry), so a resolver that keys on the wrong field fails here.
{
  const { resolveTerritory, COUNTRY_COUNTS, ADM1_COUNTS } = await import(resolve(ROOT, 'plugin-designs/my-upg-100-list/data/territory-counts.js'))
  const country = resolveTerritory({ shapeGroup: 'SDN', shapeName: 'Sudan', iso3: 'SDN', zoneKey: 'sudan', zoneLabel: 'Sudan' })
  ok(country && country.kind === 'adm0' && country.key === 'adm0:SDN',
    `a tapped COUNTRY (shapeName + iso3, no listId) resolved as ${JSON.stringify(country)}, not adm0:SDN — every country tap would count 0 UUPG`)
  ok(country && country.count === COUNTRY_COUNTS.SDN && country.count > 0,
    `a tapped country's count is ${country && country.count}, not its COUNTRY_COUNTS entry (${COUNTRY_COUNTS.SDN})`)
  const state = resolveTerritory({ iso3: 'IND', shapeGroup: 'IND', listId: 'asia-india-madhya-pradesh', shapeName: 'Madhya Pradesh', zoneKey: 'asia-india-madhya-pradesh' })
  ok(state && state.kind === 'adm1' && state.key === 'adm1:Madhya Pradesh' && state.count === ADM1_COUNTS['Madhya Pradesh'],
    `a tapped India STATE (listId + shapeName + iso3) resolved as ${JSON.stringify(state)}, not adm1 with its ADM1_COUNTS entry`)
  const nepal = resolveTerritory({ shapeGroup: 'NPL', shapeName: 'Nepal', iso3: 'NPL', zoneKey: 'asia-india-uttarakhand' })
  ok(nepal && nepal.kind === 'adm0' && nepal.key === 'adm0:NPL',
    `a country drawn inside an Asia zone (zone.adm0, no listId) resolved as ${JSON.stringify(nepal)}, not adm0:NPL`)
}

if (fails.length) {
  console.error('SELECTION-KINDS: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('SELECTION-KINDS: PASS — every kind resolveTerritory emits is handled by the consumer, a tapped country resolves to exactly its own people groups, the guard no longer throws on a country-only selection, a province is refused BY NAME rather than silently widened to its country, and the busy label is cleared on every exit path.')
