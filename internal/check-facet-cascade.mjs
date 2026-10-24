#!/usr/bin/env node
/**
 * check-facet-cascade.mjs — A CHILD FACET SELECTION MUST NOT OUTLIVE ITS PARENT.
 *
 * THE DEFECT THIS CATCHES (reported 2026-09-22): with a language selected, deselecting its language
 * family did not deselect the language. Selecting a new language family then showed nothing on the
 * map, and the only visible reason was in the selected section header.
 *
 * ★ WHY THIS IS A DATA-TRUST BUG, NOT A NIT. filterSet is AND-stacked — filteredRows keeps a row
 * only when EVERY active key matches. An orphaned child keeps filtering, so after the parent is
 * gone, picking a DIFFERENT parent can never satisfy both predicates and the map returns EMPTY.
 * Nothing errors. Nothing looks broken. The product quietly reports "there are no people groups
 * here" when the truth is "your filter state is inconsistent". A silent wrong result about the
 * world is worse than a crash, because the user believes it.
 *
 * ★ WHAT THIS GATE ASSERTS THAT A DOM CHECK CANNOT. This is a STATE bug. The UI is perfectly
 * well-behaved throughout: the chips render, the buttons respond, the map paints. Only the
 * RESULT COUNT is wrong. So this gate drives the real bus over the real config and asserts on
 * row counts — never on appearance.
 *
 * ASSERTIONS
 *   A. HIERARCHY DERIVATION — every parent's descendant list is the TRANSITIVE closure of its
 *      config drill, nearest-first. A one-level cascade looks fixed from the top tier while
 *      leaving the identical orphan one rung down, so depth is asserted explicitly.
 *   B. NO ORPHANS — for each hierarchy, set every tier, clear the TOP, and assert no descendant
 *      key survives in filterSet.
 *   C. THE REPORTED SEQUENCE, asserted on counts (the step that reproduces what was seen):
 *        1. select parent P, then child C within P   -> record N1 (must be > 0)
 *        2. clear P                                   -> assert C is gone from filterSet
 *        3. select a DIFFERENT parent Q               -> assert count > 0 AND == Q-alone count
 *      Steps 1-2 can pass while the user-visible failure survives; step 3 is the one that fails
 *      on the un-fixed code (it returns 0).
 *   D. EVERY CLEAR PATH — the tree rail, the dropdowns, the per-chip X and Clear All / breadcrumb
 *      all route through setFilter(k,null) / clearFilters(). Each is driven here, because a fix
 *      in one component would leave the bug reachable through the other three buttons.
 *   E. SETTING IS NOT CASCADING — a child selected with no parent set must STAND (it is strictly
 *      narrower, never wrong) and restoring a shared #f= hash with parent+child intact must keep
 *      BOTH. This pins the invariant as one-directional so a future "fix" cannot over-reach and
 *      break share links.
 *
 * NEGATIVE-TESTED, and the negative test is part of this file: `--self-test` copies the bus, strips
 * the cascade line back out, re-runs every assertion against the reverted copy and requires the
 * gate to FAIL. Measured: 13 assertions fail, including "after switching to Q=… the map is EMPTY
 * (Showing 0)" for all three hierarchies — i.e. it reproduces the report exactly. A gate
 * nobody has broken is a gate nobody knows works.
 *
 * ── HERMETIC BY CONSTRUCTION (it runs inside build:unlocked) ──────────────────────────────────
 * No network, no browser, no server, no vite. ~0.7s. Two things make that true:
 *   - rows come from internal/fixtures/facet-cascade-rows.json, a committed 73-row sample of the
 *     live pray-tools data (regenerate: `node internal/check-facet-cascade.mjs --refresh-fixture`);
 *   - dashboard.config.js is read as TEXT, never imported, because it transitively reaches
 *     `import.meta.glob()` — a VITE macro that throws in plain Node (see readFacetRail).
 * `LIVE=1` opts into the full live dataset for production-scale numbers; the default never does.
 *
 * A MISSING FIXTURE IS A FAILURE, NOT A SKIP. An earlier draft fetched live rows and skipped the
 * count assertions when offline — so on a fresh clone with no network, C3 (the assertion that
 * reproduces the reported empty map) silently did not run and the build still went green. That is
 * a gate that cannot fail, which is worse than no gate. Now every assertion runs everywhere.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF_TEST = process.argv.includes('--self-test')
const OFFLINE = process.argv.includes('--offline')
const REFRESH = process.argv.includes('--refresh-fixture')

const fails = []
const notes = []
const ok = (label) => notes.push(`  ok   ${label}`)
const bad = (label, detail) => { fails.push(`${label}${detail ? ` — ${detail}` : ''}`); notes.push(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
const eq = (label, got, want) => (String(got) === String(want) ? ok(`${label} = ${got}`) : bad(label, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`))

// ── load the REAL modules under test ──────────────────────────────────────────────────────────
// The BUS is imported for real — it is plain JS over vue's `reactive`/`ref`, so Node runs it as-is,
// and importing it (rather than reimplementing it) is the whole point: a gate that restates the
// logic it checks cannot catch a drift between the gate and the product.
//
// ★ THE CONFIG IS READ AS TEXT, NOT IMPORTED — and that is deliberate, not a shortcut.
// `dashboard.config.js` transitively reaches `@map/colors/_registry.js`, which calls
// `import.meta.glob()` — a VITE COMPILE-TIME MACRO that does not exist in Node ("glob is not a
// function"). Importing the config therefore cannot work outside a vite build, and shimming the
// macro would mean this gate exercises a hand-written fake of vite's resolution whose semantics
// could drift from the real thing.
//
// The data this gate needs — `facetRail[].drill` and the facet accessors — are plain literals in
// that file, so they are extracted from its SOURCE. The config file remains the single source of
// truth (edit a drill array and this gate sees it on the next run); only the evaluation strategy
// changed. The accessors are re-derived here from the same row fields the config declares, and
// assertion A cross-checks the extracted drill arrays against EXPECT, so a silent extraction
// failure shows up as a named failure rather than a skipped check.
const BUS_SRC = join(ROOT, 'library/composables/useSelectionBus.js')
const CFG_SRC = join(ROOT, 'plugin-designs/research-dashboard/dashboard.config.js')

const pathToUrl = (p) => 'file://' + p + '?t=' + Date.now()

/**
 * Extract `facetRail: [ { drill: [...] }, … ]` from the config SOURCE.
 * Only the fields the cascade depends on; everything else in the config is irrelevant here.
 */
function readFacetRail(src) {
  const start = src.indexOf('facetRail:')
  if (start < 0) throw new Error('facetRail not found in dashboard.config.js')
  // walk to the matching close bracket of the array literal
  const open = src.indexOf('[', start)
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('facetRail array is unterminated')
  const body = src.slice(open, end + 1)
  const sections = []
  // One entry per object at the TOP level of that array, found by brace depth. A `{[^{}]*}` regex
  // matched only objects with no braces inside, and 53e2c662 gave every section a getter title
  // (`get title() { return tStatic(…) || 'People' }`): the four drill sections stopped parsing, the
  // bus was built with no hierarchy, and this gate reported 21 "orphans" in a dashboard that cascades
  // correctly. Braces inside quoted strings are skipped, for the same reason.
  const objs = []
  for (let i = 1, d = 0, st = -1, q = null; i < body.length - 1; i++) {
    const c = body[i]
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '{') { if (d === 0) st = i; d++ }
    else if (c === '}') { d--; if (d === 0 && st >= 0) { objs.push(body.slice(st, i + 1)); st = -1 } }
  }
  for (const obj of objs) {
    const id = /id:\s*'([^']+)'/.exec(obj)?.[1]
    const drillRaw = /drill:\s*\[([^\]]*)\]/.exec(obj)?.[1]
    const drill = drillRaw ? [...drillRaw.matchAll(/'([^']+)'/g)].map((x) => x[1]) : undefined
    const facet = /facet:\s*'([^']+)'/.exec(obj)?.[1]
    sections.push({ id, drill, facet })
  }
  if (!sections.length) throw new Error('no facetRail sections parsed')
  // A section with neither a drill nor a facet is one this parser could not read: fail loudly
  // rather than test a hierarchy that is not the dashboard's.
  const unread = sections.filter((x) => !x.id || (!x.drill && !x.facet))
  if (unread.length) throw new Error(`facetRail: ${unread.length} section(s) could not be read (${unread.map((x) => x.id || '?').join(', ')})`)
  return sections
}

async function loadModules(busPath) {
  const { createSelectionBus, deriveHierarchy } = await import(pathToUrl(busPath))
  const config = { facetRail: readFacetRail(readFileSync(CFG_SRC, 'utf8')) }
  return { createSelectionBus, deriveHierarchy, config }
}

// ── hierarchies under test, named from the config's own facetRail drill arrays ────────────────
// Declared here ONLY as the expectation to compare the derivation against.
const EXPECT = {
  affinity_bloc: ['cluster', 'people_group'],          // People — THREE deep
  cluster: ['people_group'],
  wagf_region: ['wagf_block', 'country_code'],         // Place — THREE deep (bloc sits between)
  wagf_block: ['country_code'],
  language_family: ['primary_language'],               // Language — two deep
  religion_family: ['religion'],
}

// ── rows for the count assertions ─────────────────────────────────────────────────────────────
// ★ A COMMITTED FIXTURE, NOT THE NETWORK. This gate runs inside build:unlocked, so it must be
// hermetic: no network, no browser, no server. It reads internal/fixtures/facet-cascade-rows.json,
// a 73-row sample of the live pray-tools data (regenerate with --refresh-fixture).
//
// WHY A FIXTURE AND NOT "fetch, else skip". The earlier version fetched live rows and SKIPPED the
// count assertions when offline — which meant that on a fresh clone with no network, C3 (the
// assertion that actually reproduces the reported empty map) silently did not run and the build
// still went green. That is the "a gate that cannot fail is worse than no gate" shape: decorative
// in exactly the situation where it matters. With the fixture committed, every assertion runs
// everywhere, always, in ~1s.
//
// The sample keeps the top-2 parents of each chain and a spread of their distinct children, so
// P+C, P-alone and Q-alone all have real non-zero counts and P+C < P-alone. The ABSOLUTE numbers
// are smaller than production's, which is fine: the invariant under test is relational
// ("switching to Q returns Q-alone, not 0"), never a specific total.
const FIXTURE = resolve(ROOT, 'internal/fixtures/facet-cascade-rows.json')
const CACHE = resolve(ROOT, '../_qa-cycle/.cache/pray-tools-rows.json')
const FIELDS = 'slug,name,wagf_region,wagf_block,country_code,rop1,imb_reg_of_people_2,imb_reg_of_people_25,primary_language,imb_language_family,religion,engagement_status'

async function loadRows() {
  // LIVE=1 opts into the full live dataset (or its scratch cache) — useful when you want the
  // production-scale numbers. The default path touches neither the network nor _qa-cycle.
  if (!process.env.LIVE) {
    if (existsSync(FIXTURE)) return JSON.parse(readFileSync(FIXTURE, 'utf8'))
    return null
  }
  if (existsSync(CACHE)) {
    try { return JSON.parse(readFileSync(CACHE, 'utf8')) } catch (_) { /* refetch */ }
  }
  if (OFFLINE) return null
  const base = process.env.VITE_API_BASE_URL || 'https://pray.doxa.life'
  try {
    const res = await fetch(`${base}/api/people-groups/list?fields=${FIELDS}&lang=en`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
    })
    if (!res.ok) return null
    const json = await res.json()
    const rows = Array.isArray(json) ? json : (json.posts || json.data || json.results || [])
    if (!rows.length) return null
    try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(rows)) } catch (_) { /* scratch optional */ }
    return rows
  } catch (_) { return null }
}

// ── the facet accessors ─────────────────────────────────────────────────────────────────────
// Mirrors dashboard.config.js `facets[k].get` for the keys in the three hierarchies. Written
// out here because the config cannot be imported in Node (see the note on readFacetRail); the
// field names and the {value,label} projections are copied from it verbatim.
//   - most axes return the LABEL (lbl)
//   - the People tiers return the CODE, because that is the value the tree filters on
//   - language_family is API-value-first with a langFamilyByIso FALLBACK (the raw field is
//     populated on only 34/2107 rows; the fallback lifts it to ~2057, and without it the
//     Language chain would have too few rows to test meaningfully)
const lbl = (v) => (v && typeof v === 'object' ? (v.label ?? v.value ?? '') : (v ?? ''))
const codeOf = (v) => (v && typeof v === 'object' ? (v.value ?? v.label ?? '') : (v ?? ''))
const isoMap = JSON.parse(readFileSync(join(ROOT, 'library/data/langFamilyByIso.json'), 'utf8'))
const { canonicalFamilyName } = await import(pathToUrl(join(ROOT, 'library/colors/language-family.js')))
const ACC = {
  affinity_bloc: (r) => codeOf(r.rop1),
  cluster: (r) => codeOf(r.imb_reg_of_people_2),
  people_group: (r) => codeOf(r.imb_reg_of_people_25),
  wagf_region: (r) => lbl(r.wagf_region),
  wagf_block: (r) => lbl(r.wagf_block),
  country_code: (r) => lbl(r.country_code),
  religion: (r) => lbl(r.religion),
  engagement_status: (r) => lbl(r.engagement_status),
  primary_language: (r) => lbl(r.primary_language),
  language_family: (r) => {
    const api = lbl(r.imb_language_family)
    if (api) return canonicalFamilyName(api)
    const iso = r.primary_language && typeof r.primary_language === 'object' ? r.primary_language.value : null
    const hit = iso && isoMap[iso]
    return hit ? canonicalFamilyName(hit) : ''
  },
}

/**
 * --refresh-fixture: rebuild internal/fixtures/facet-cascade-rows.json from the live API.
 * Keeps the top-2 parents of each chain (ranked by distinct-child count, matching the ranking
 * `fixture()` uses below) and up to CAP rows spread across their distinct children, so every
 * count assertion has real non-zero values. Recorded as a command rather than a one-off script so
 * the fixture is REGENERABLE and not an unexplained blob.
 */
async function refreshFixture() {
  const base = process.env.VITE_API_BASE_URL || 'https://pray.doxa.life'
  const res = await fetch(`${base}/api/people-groups/list?fields=${FIELDS}&lang=en`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
  })
  if (!res.ok) throw new Error(`list HTTP ${res.status}`)
  const json = await res.json()
  const rows = Array.isArray(json) ? json : (json.posts || json.data || json.results || [])
  const CAP = 14
  const keep = new Set()
  for (const [pk, ck] of [['affinity_bloc', 'cluster'], ['wagf_region', 'wagf_block'], ['language_family', 'primary_language']]) {
    const byP = new Map()
    for (const r of rows) {
      const p = ACC[pk](r), c = ACC[ck](r)
      if (!p) continue
      if (!byP.has(p)) byP.set(p, { rows: [], kids: new Set() })
      byP.get(p).rows.push(r); if (c) byP.get(p).kids.add(c)
    }
    const ranked = [...byP].filter(([, e]) => e.kids.size > 0).sort((a, b) => b[1].kids.size - a[1].kids.size)
    for (const [, e] of ranked.slice(0, 2)) {
      const byKid = new Map()
      for (const r of e.rows) { const c = ACC[ck](r) || '∅'; if (!byKid.has(c)) byKid.set(c, []); byKid.get(c).push(r) }
      let n = 0
      for (const [, rs] of byKid) { for (const r of rs.slice(0, 3)) { if (n++ >= CAP) break; keep.add(r) } if (n >= CAP) break }
    }
  }
  const F = ['slug', 'wagf_region', 'wagf_block', 'country_code', 'rop1', 'imb_reg_of_people_2', 'imb_reg_of_people_25', 'primary_language', 'imb_language_family']
  const slim = [...keep].map((r) => { const o = {}; for (const f of F) if (r[f]) o[f] = r[f]; return o })
  mkdirSync(dirname(FIXTURE), { recursive: true })
  writeFileSync(FIXTURE, JSON.stringify(slim))
  console.log(`fixture refreshed: ${slim.length} rows -> ${FIXTURE}`)
}

async function run(busPath) {
  fails.length = 0; notes.length = 0
  const { createSelectionBus, deriveHierarchy, config } = await loadModules(busPath)

  // ── A. hierarchy derivation is the TRANSITIVE closure of config.facetRail[].drill ───────────
  const derived = deriveHierarchy(config)
  for (const [parent, want] of Object.entries(EXPECT)) {
    const got = derived[parent] || []
    eq(`A hierarchy ${parent}`, JSON.stringify(got), JSON.stringify(want))
  }
  // depth is load-bearing: assert the 3-deep chains explicitly, by name
  eq('A People chain is THREE deep (bloc clears cluster AND people_group)', (derived.affinity_bloc || []).length, 2)
  eq('A Place chain is THREE deep (region clears bloc AND country)', (derived.wagf_region || []).length, 2)
  // a flat section must contribute nothing
  eq('A flat facet (engagement_status) has no descendants', (derived.engagement_status || []).length, 0)

  // accessors are module-level (see ACC above) — shared with --refresh-fixture
  const rows = await loadRows()
  const countWith = (fset) => {
    const keys = Object.keys(fset)
    return (rows || []).filter((r) => keys.every((k) => (ACC[k] ? ACC[k](r) === fset[k] : true))).length
  }

  const newBus = () => { const b = createSelectionBus(); b.configureHierarchy(config); return b }

  // ── B. no orphans: set every tier, clear the top, assert nothing below survives ─────────────
  const CHAINS = [
    { name: 'People  (affinity_bloc -> cluster -> people_group)', tiers: ['affinity_bloc', 'cluster', 'people_group'] },
    { name: 'Place   (wagf_region -> wagf_block -> country_code)', tiers: ['wagf_region', 'wagf_block', 'country_code'] },
    { name: 'Language(language_family -> primary_language)', tiers: ['language_family', 'primary_language'] },
  ]
  for (const { name, tiers } of CHAINS) {
    const bus = newBus()
    tiers.forEach((t, i) => bus.setFilter(t, `V${i}`))
    bus.setFilter(tiers[0], null)
    const survivors = tiers.filter((t) => t in bus.filterSet)
    if (survivors.length) bad(`B no orphan after clearing top of ${name}`, `survived: ${survivors.join(', ')}`)
    else ok(`B no orphan after clearing top of ${name}`)

    // and from the MIDDLE tier, for the 3-deep chains
    if (tiers.length === 3) {
      const b2 = newBus()
      tiers.forEach((t, i) => b2.setFilter(t, `V${i}`))
      b2.setFilter(tiers[1], null)
      const s2 = tiers.slice(1).filter((t) => t in b2.filterSet)
      if (s2.length) bad(`B no orphan after clearing MIDDLE of ${name}`, `survived: ${s2.join(', ')}`)
      else ok(`B no orphan after clearing MIDDLE of ${name}`)
      if (!(tiers[0] in b2.filterSet)) bad(`B clearing a child must NOT clear its parent (${name})`)
      else ok(`B clearing a child leaves the parent intact (${name})`)
    }
  }

  // ── C. the reported sequence, asserted on RESULT COUNTS ───────────────────────────────────
  if (!rows) {
    // NOT a skip. The committed fixture is what makes C/D run everywhere, so its absence is a
    // BROKEN GATE, not an excusable environment gap — silently skipping the assertions that
    // reproduce the reported bug is how a gate becomes decorative. Only --offline with LIVE=1
    // (an explicit opt-in to the live dataset with no cache) is allowed to degrade.
    if (process.env.LIVE && OFFLINE) notes.push('  SKIP C/D — LIVE=1 --offline with no cache (explicitly opted out of the fixture)')
    else bad('C/D count assertions could not run', `missing fixture ${FIXTURE} — regenerate with --refresh-fixture`)
  } else {
    // pick real fixtures from the data: a parent with >=1 child, and a DIFFERENT non-empty parent
    const fixture = (parentKey, childKey) => {
      const byParent = new Map()
      for (const r of rows) {
        const p = ACC[parentKey](r), c = ACC[childKey](r)
        if (!p) continue
        if (!byParent.has(p)) byParent.set(p, new Set())
        if (c) byParent.get(p).add(c)
      }
      const ranked = [...byParent].filter(([, cs]) => cs.size > 0).sort((a, b) => b[1].size - a[1].size)
      if (ranked.length < 2) return null
      return { P: ranked[0][0], C: [...ranked[0][1]][0], Q: ranked[1][0] }
    }
    for (const { name, tiers } of CHAINS) {
      const [pk, ck] = tiers
      const f = fixture(pk, ck)
      if (!f) { notes.push(`  SKIP C ${name} — not enough distinct parents in the data`); continue }
      const bus = newBus()
      // 1. select parent P, then child C within P
      bus.setFilter(pk, f.P); bus.setFilter(ck, f.C)
      const n1 = countWith(bus.filterSet)
      if (n1 > 0) ok(`C1 ${name}: P=${f.P} + C=${f.C} -> Showing ${n1}`)
      else bad(`C1 ${name}`, `expected >0 rows for P+C, got ${n1}`)
      // 2. clear P -> C must be gone
      bus.setFilter(pk, null)
      if (ck in bus.filterSet) bad(`C2 ${name}`, `child ${ck} ORPHANED (=${bus.filterSet[ck]}) after clearing ${pk}`)
      else ok(`C2 ${name}: clearing ${pk} removed ${ck}`)
      // 3. select a DIFFERENT parent Q -> must be >0 and == Q alone  ← the step that reproduces the bug
      bus.setFilter(pk, f.Q)
      const n3 = countWith(bus.filterSet)
      const nQ = countWith({ [pk]: f.Q })
      if (n3 === 0) bad(`C3 ${name}`, `after switching to Q=${f.Q} the map is EMPTY (Showing 0) — the orphan is still filtering`)
      else if (n3 !== nQ) bad(`C3 ${name}`, `Showing ${n3} but Q alone is ${nQ} — a stale predicate is still ANDed`)
      else ok(`C3 ${name}: Q=${f.Q} -> Showing ${n3} (== Q alone)`)
    }

    // ── D. every clear path obeys the cascade ─────────────────────────────────────────────────
    // tree rail + dropdown + chip X all call setFilter(k, null); Clear All calls clearFilters();
    // the breadcrumb popTo() calls setFilter(k, null) over a key slice.
    const seed = (b) => { b.setFilter('affinity_bloc', 'A012'); b.setFilter('cluster', 'C1'); b.setFilter('people_group', 'P1') }

    const bTree = newBus(); seed(bTree); bTree.setFilter('affinity_bloc', null)
    eq('D tree-rail / dropdown / chip-X path leaves keys', Object.keys(bTree.filterSet).length, 0)

    const bAll = newBus(); seed(bAll); bAll.clearFilters()
    eq('D Clear All leaves keys', Object.keys(bAll.filterSet).length, 0)

    // breadcrumb popTo(k): clears k and every key AFTER it in insertion order. With the cascade,
    // clearing the bloc crumb must not leave cluster/people_group behind even though popTo would
    // have cleared them anyway — assert the bloc crumb ALONE is sufficient.
    const bCrumb = newBus(); seed(bCrumb)
    bCrumb.setFilter('affinity_bloc', null)
    eq('D breadcrumb pop to a parent crumb leaves keys', Object.keys(bCrumb.filterSet).length, 0)

    // a SIBLING axis must be untouched by another axis's cascade
    const bSib = newBus(); seed(bSib); bSib.setFilter('wagf_region', 'Asia')
    bSib.setFilter('affinity_bloc', null)
    eq('D sibling axis survives an unrelated cascade', bSib.filterSet.wagf_region, 'Asia')
  }

  // ── E. setting is NOT cascading (one-directional invariant) ─────────────────────────────────
  const bChild = newBus()
  bChild.setFilter('primary_language', 'Marathi')
  eq('E a child with no parent set STANDS ALONE', bChild.filterSet.primary_language, 'Marathi')
  eq('E setting a child does not invent a parent', 'language_family' in bChild.filterSet, 'false')

  // restoring a shared #f= hash replays setFilter per key — parent AND child must both survive
  const bHash = newBus()
  Object.entries({ language_family: 'Indo-European', primary_language: 'Marathi' }).forEach(([k, v]) => bHash.setFilter(k, v))
  eq('E share-link restore keeps parent', bHash.filterSet.language_family, 'Indo-European')
  eq('E share-link restore keeps child', bHash.filterSet.primary_language, 'Marathi')

  return fails.length === 0
}

// ── --self-test: the NEGATIVE test. Patch the cascade back OUT and require this gate to FAIL. ──
// A gate you have not broken is a gate you do not know works.
async function selfTest() {
  // The broken copy MUST live beside the original, not in /tmp: package.json's `type: module`
  // scope stops at the repo root, so a /tmp copy loads as CJS and dies on `import` before a
  // single assertion runs — which exits 0 and reads as a pass. (First attempt did exactly that.)
  // Same directory also keeps `vue` resolvable from the repo's node_modules.
  const broken = join(dirname(BUS_SRC), '.useSelectionBus.negative-test.js')
  cpSync(BUS_SRC, broken)
  const src = readFileSync(broken, 'utf8')
  const needle = '      for (const child of childFacets[key] || []) delete filterSet[child]\n'
  if (!src.includes(needle)) {
    console.error('SELF-TEST INCONCLUSIVE: the cascade line moved; update the needle in check-facet-cascade.mjs')
    rmSync(broken, { force: true })
    process.exit(2)
  }
  writeFileSync(broken, src.replace(needle, ''))          // ← revert the fix
  const passed = await run(broken)
  const observed = notes.slice()
  rmSync(broken, { force: true })
  console.log('── NEGATIVE TEST (cascade reverted) ──')
  observed.filter((l) => l.includes('FAIL')).forEach((l) => console.log(l))
  if (passed) { console.error('\nSELF-TEST FAILED: the gate PASSED against reverted code — it cannot detect the bug.'); process.exit(1) }
  console.log(`\nSELF-TEST OK: gate caught the reverted cascade (${fails.length} assertions failed).`)
  process.exit(0)
}

if (REFRESH) { await refreshFixture(); process.exit(0) }

if (SELF_TEST) { await selfTest() } else {
  const passed = await run(BUS_SRC)
  console.log('── facet cascade: a child selection must not outlive its parent ──')
  notes.forEach((l) => console.log(l))
  if (!passed) { console.error(`\nFAIL check-facet-cascade: ${fails.length} assertion(s)\n` + fails.map((f) => '  - ' + f).join('\n')); process.exit(1) }
  console.log('\nOK check-facet-cascade: all hierarchies cascade-clear on every clear path.')
}
