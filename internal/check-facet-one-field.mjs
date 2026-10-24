#!/usr/bin/env node
/**
 * check-facet-one-field.mjs — ONE ROW-FIELD PER FACET: no two facets may be the SAME AXIS TWICE.
 *
 * THE DEFECT THIS CATCHES (card BUG-PEOPLE-AND-AFFINITY-BLOC-ARE-THE-SAME-AXIS-TWICE).
 * The dashboard config once declared TWO facet keys over ONE row field: `affinity_bloc`, reading
 * the CODE of r.rop1, and `rop1`, reading the LABEL of the very same field. That produced two
 * controls for one axis — a "People" dropdown beside an "Affinity Bloc" tree tier — which could
 * never recognise each other, because filteredRows byte-matches each key against its OWN accessor.
 * The tree stored affinity_bloc='A012' while the dropdown stored rop1='South Asian Peoples', and
 * neither ever saw the other's selection. Seen from behaviour alone: there were duplicate
 * affinity blocks, one called People and one called Affinity Bloc, and they are the same thing.
 *
 * ★ WHY THIS GATE ASSERTS ON OUTPUT VALUES AND NOT ON FIELD READS — THE MEASUREMENT THAT DECIDED IT.
 * The obvious gate is "no two facets may read the same r.<field>". THAT GATE WOULD FAIL CORRECT
 * CODE. Measured against the live config, three fields are legitimately read twice:
 *
 *   r.religion         -> religion_family (family NAME, from the code's first letter)  + religion
 *   r.primary_language -> language_family (family NAME, via langFamilyByIso fallback)  + primary_language
 *   r.rop1             -> affinity_bloc   (the CODE 'A012')                            + rop1_name
 *
 * Every one of those is a deliberate tier-1/tier-2 pair or a search-only projection: two DIFFERENT
 * projections of one field, which is exactly how a two-tier tree is built. Field-sharing is normal.
 *
 * What is NOT normal is two facets that produce the SAME VALUE SET — that is one axis wearing two
 * names, and it is the actual defect. So the assertion is on the projected OUTPUT:
 *
 *   for each pair of facets, project both over the real rows; if their non-empty value sets are
 *   EQUAL (or one is a pure re-labelling of the other, same partition of the rows), FAIL.
 *
 * The tier pairs above pass cleanly: religion_family yields ~8 family names while religion yields
 * ~60 religions — different partitions, no collision. The old rop1 twin would FAIL, because
 * lbl(r.rop1) and code(r.rop1) partition the rows IDENTICALLY (a 1:1 relabelling), which is the
 * precise signature of a duplicate axis.
 *
 * ASSERTIONS
 *   A. NO DUPLICATE PARTITION — no two facets may induce the same partition of the rows. A pure
 *      relabelling (bijection between the two value sets) counts as the same partition.
 *   B. NO FACET IS DECLARED TWICE IN THE CONTROL LISTS — a key may appear in at most one of
 *      facetRail.drill / facetRail.facet, so one axis can never render as two rival controls.
 *   C. SEARCH-ONLY PROJECTIONS STAY OUT OF THE CONTROL LISTS — rop1_name exists so free-text
 *      search matches "South Asian" rather than 'A012'. Adding it to a control list would
 *      reintroduce the exact duplicate axis this card removed, so that is asserted explicitly.
 *
 * ── DATA ────────────────────────────────────────────────────────────────────────────────────
 * Rows come from internal/fixtures/facet-one-field-rows.json — 114 rows sampled from the live
 * pray-tools data, committed so the assertion runs identically on a fresh clone with no network
 * (regenerate: `node internal/check-facet-one-field.mjs --refresh-fixture`). A MISSING fixture is
 * a HARD FAILURE, never a fallback to generated rows: see the long note at loadRows() for the
 * three different verdicts this gate gave about one unchanged config while it had a synthetic
 * corpus. Hermetic — no network, no browser, no server.
 *
 * Run: node internal/check-facet-one-field.mjs        (--self-test for the NEGATIVE test)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF_TEST = process.argv.includes('--self-test')

const fail = []
const note = (s) => console.log('  ' + s)

// ── load the real config ────────────────────────────────────────────────────────────────────
// ★ WHY THE CONFIG IS EVALUATED, NOT IMPORTED. dashboard.config.js is written for VITE: its
// imports use the `@map` alias (-> library/, vite.config.js:127 — NOT a map bundle, despite the
// name), it imports .json without node's required import attribute, and its transitive graph
// reaches library/colors/_registry.js, which calls `import.meta.glob` — a vite-only primitive
// that throws under plain node. A first attempt resolved all of that with a source rewrite plus
// an ESM loader hook and STILL died on the glob, because the alias is transitive and the graph
// keeps widening with every hop.
//
// None of that graph is load-bearing HERE. This gate needs exactly one thing: the `facets`
// accessor table. So the config's module body is evaluated with its imports satisfied by the
// small set of real values the accessors actually call, and the vite-only modules never enter
// the picture. That keeps the gate fast, dependency-free, and immune to churn in unrelated
// build tooling.
//
// The values below are READ FROM THEIR REAL HOMES, never re-declared here — a hand-copied
// RELIGION_FAMILIES would drift from the map's and make this gate assert against a fiction.
function loadConfig() {
  const cfgPath = resolve(ROOT, 'plugin-designs/research-dashboard/dashboard.config.js')
  let src = readFileSync(cfgPath, 'utf8')

  const religionSrc = readFileSync(resolve(ROOT, 'library/colors/religion.js'), 'utf8')
  const famMatch = religionSrc.match(/RELIGION_FAMILIES\s*=\s*(\{[\s\S]*?\n\})/)
  if (!famMatch) throw new Error('RELIGION_FAMILIES not found in library/colors/religion.js')
  const RELIGION_FAMILIES = (0, eval)('(' + famMatch[1] + ')')

  const langSrc = readFileSync(resolve(ROOT, 'library/colors/language-family.js'), 'utf8')
  const canonMatch = langSrc.match(/function canonicalFamilyName[\s\S]*?\n\}/)
  const canonicalFamilyName = canonMatch ? (0, eval)('(' + canonMatch[0] + ')') : ((s) => s)

  const langFamilyByIso = JSON.parse(readFileSync(resolve(ROOT, 'library/data/langFamilyByIso.json'), 'utf8'))

  // lbl(): the aggregations helper's contract — a {value,label} pair renders as its LABEL.
  const lbl = (v) => (v && typeof v === 'object' ? (v.label ?? v.value ?? '') : (v ?? ''))

  // Drop the import statements (the names they bind are passed in as parameters instead) and
  // turn the default export into a return.
  src = src.replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
  const body = src.replace(/export\s+default\s+/, 'return ')
  const make = new Function('RELIGION_FAMILIES', 'canonicalFamilyName', 'langFamilyByIso', 'lbl', body)
  return make(RELIGION_FAMILIES, canonicalFamilyName, langFamilyByIso, lbl)
}

// ── THE ROWS MUST BE REAL, AND A MISSING FIXTURE IS A HARD FAILURE ──────────────────────────
// ★ THIS GATE SHIPPED TWICE ON SYNTHETIC DATA AND WAS WRONG BOTH TIMES, IN OPPOSITE DIRECTIONS.
// The recorded history, because the second symptom is the dangerous one:
//
//   v1  every field indexed by `i % 6` -> religion, country and language moved in LOCKSTEP, so
//       they induced identical partitions and the gate reported 15 DUPLICATE AXES in a config
//       that has none.
//   v2  distinct co-prime cycles -> down to three pairs, but THE PAIRS CHANGED BETWEEN RUNS on
//       unchanged source (region-vs-cluster one minute, language-vs-people-bloc the next). A real
//       duplicate-axis finding is ONE pair, not a rotating clique; a verdict that moves while the
//       subject is still is a verdict about the DATA, not the config.
//   v3  the same corpus then reported PASS. Same arithmetic coincidences, opposite answer.
//
// A PASS ON GENERATED DATA IS WORSE THAN THE FALSE POSITIVES WERE. Obvious nonsense gets ignored;
// a green line gets believed and acted on. In both directions the gate's answer was decided by its
// INPUT rather than by its SUBJECT, which makes it untrustworthy either way — the precise failure
// shape this repo keeps paying for.
//
// So the synthetic corpus is DELETED, not repaired. Rows come from a committed sample of the live
// pray-tools data, exactly as check-facet-cascade does, and a missing fixture EXITS 1 naming the
// regeneration command. It is never a fallback: on a fresh clone with no network, degrading to
// generated rows is precisely how a gate goes green without having measured anything.
const FIXTURE = resolve(ROOT, 'internal/fixtures/facet-one-field-rows.json')

function loadRows() {
  try {
    const j = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    const rows = Array.isArray(j) ? j : (j.rows || j.data || j.results)
    if (Array.isArray(rows) && rows.length) return rows
  } catch (_) { /* fall through to the hard failure below */ }
  console.error('FACET-ONE-FIELD: FAIL — missing fixture\n' +
    `  ${FIXTURE}\n` +
    '  This gate asserts on the PARTITION each facet induces over REAL rows. It has no synthetic\n' +
    '  fallback on purpose: generated rows made it report 15 duplicate axes, then 3 rotating\n' +
    '  pairs, then PASS — three different answers about one unchanged config.\n' +
    '  Regenerate with:  node internal/check-facet-one-field.mjs --refresh-fixture')
  process.exit(1)
}

/**
 * --refresh-fixture: rebuild internal/fixtures/facet-one-field-rows.json from the live API.
 *
 * ★ SAMPLED FOR BREADTH, NOT DEPTH — AND THAT IS WHY IT IS NOT check-facet-cascade's FIXTURE.
 * The obvious move is to reuse internal/fixtures/facet-cascade-rows.json (same source, same row
 * shape). MEASURED, IT WOULD SILENTLY SKIP HALF THIS GATE: that fixture is slimmed to the nine
 * fields cascade needs, and `religion`, `engagement_status` and `imb_language_family` are NOT
 * among them — 0 distinct values for each across its 73 rows. religion_family and language_family
 * are exactly the derived facets this gate most needs to see, so they would project to '' on every
 * row and be excluded from comparison entirely. Two gates, two different sampling requirements.
 *
 * Cascade needs DEPTH (rows spread across the children of a few parents, so a child count is
 * non-zero). This gate needs BREADTH: the partition test is only meaningful when each axis shows
 * its real spread of distinct values, so an under-sampled axis could look identical to another by
 * accident — which is the artifact this fixture exists to remove. Sampling therefore walks the
 * rows keeping any row that introduces a NEW value on ANY axis, which maximises distinct values
 * per axis at a small row count.
 */
async function refreshFixture() {
  const base = process.env.VITE_API_BASE_URL || 'https://pray.doxa.life'
  const FIELDS = 'slug,name,wagf_region,wagf_block,country_code,rop1,imb_reg_of_people_2,' +
                 'imb_reg_of_people_25,primary_language,imb_language_family,religion,engagement_status,people_praying'
  const res = await fetch(`${base}/api/people-groups/list?fields=${FIELDS}&lang=en`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
  })
  if (!res.ok) throw new Error(`list HTTP ${res.status}`)
  const json = await res.json()
  const all = Array.isArray(json) ? json : (json.posts || json.data || json.results || [])
  if (!all.length) throw new Error('live list returned 0 rows')

  const AXES = ['rop1', 'imb_reg_of_people_2', 'imb_reg_of_people_25', 'wagf_region', 'wagf_block',
                'country_code', 'primary_language', 'imb_language_family', 'religion', 'engagement_status']
  const val = (v) => (v && typeof v === 'object' ? (v.value ?? v.label ?? '') : (v ?? ''))
  // ★ PER-AXIS CAP, because uncapped "novel on any axis" is not a sample — it is the dataset.
  // Measured: with no cap this kept 1,932 of 2,107 rows (1.4 MB), because people_group alone has
  // 1,736 distinct values and every row introduces a new one. A 1.4 MB committed blob is not a
  // fixture, and fetching it defeats the point of committing one.
  //
  // The cap is safe because of what the assertion actually compares. Two axes can only be mistaken
  // for one another when they induce the SAME partition, which requires the same GROUP COUNT. The
  // deep axes do not need exhaustive coverage to be distinguishable — they need enough values to be
  // unmistakably finer-grained than the coarse ones. 40 per axis keeps every coarse axis COMPLETE
  // (rop1 16, wagf_region 7, wagf_block 25, imb_language_family 11, religion 31, engagement 2 —
  // all under the cap, so nothing is lost where confusion is actually possible) while truncating
  // only the three deep axes, which stay far above any coarse axis's group count.
  const CAP = 40
  const seen = Object.fromEntries(AXES.map((a) => [a, new Set()]))
  const keep = []
  for (const r of all) {
    let novel = false
    for (const a of AXES) {
      const v = String(val(r[a]))
      if (v && !seen[a].has(v) && seen[a].size < CAP) { seen[a].add(v); novel = true }
    }
    if (novel) keep.push(r)
  }
  const F = ['slug', 'name', ...AXES, 'people_praying']
  const slim = keep.map((r) => { const o = {}; for (const f of F) if (r[f] != null) o[f] = r[f]; return o })
  mkdirSync(dirname(FIXTURE), { recursive: true })
  writeFileSync(FIXTURE, JSON.stringify(slim))
  console.log(`fixture refreshed: ${slim.length} rows -> ${FIXTURE}`)
  for (const a of AXES) console.log(`  ${a.padEnd(24)} distinct=${seen[a].size}`)
}

const cfg = loadConfig()
const facets = cfg.facets || {}

if (process.argv.includes('--refresh-fixture')) { await refreshFixture(); process.exit(0) }

const rows = loadRows()
note(`rows: ${rows.length} from ${FIXTURE.replace(ROOT + '/', '')} (live sample, committed)`)

// ── project every facet over the rows ───────────────────────────────────────────────────────
const projections = new Map()   // facetKey -> array of per-row output values (strings)
for (const [key, f] of Object.entries(facets)) {
  if (typeof f?.get !== 'function') continue
  const vals = rows.map((r) => { try { const v = f.get(r); return v == null ? '' : String(v) } catch (_) { return '' } })
  projections.set(key, vals)
}
note(`facets projected: ${projections.size}`)

// ── A. NO TWO FACETS MAY INDUCE THE SAME PARTITION ──────────────────────────────────────────
// Two facets are the SAME AXIS when they group the rows identically, whatever they call the
// groups. So compare partitions, not values: build each facet's row-index signature and test for
// a bijection between the two labellings. This is what distinguishes a legitimate tier pair
// (religion_family vs religion — a COARSER partition) from a duplicate axis (code vs label of one
// field — the IDENTICAL partition under a different name).
function partitionOf(vals) {
  const g = new Map()
  vals.forEach((v, i) => { if (v === '') return; if (!g.has(v)) g.set(v, []); g.get(v).push(i) })
  return g
}
// same partition <=> every group of A is exactly a group of B (and counts match)
function samePartition(a, b) {
  const A = partitionOf(a), B = partitionOf(b)
  if (A.size !== B.size || A.size === 0) return false
  const bSigs = new Set([...B.values()].map((ix) => ix.join(',')))
  for (const ix of A.values()) if (!bSigs.has(ix.join(','))) return false
  return true
}

// ★ SCOPED TO CONTROL-REACHABLE FACETS, AND THE MEASUREMENT IS WHY.
// Run unscoped, this assertion flags `affinity_bloc` vs `rop1_name` — and it is RIGHT that the two
// induce the same partition (code vs label of r.rop1, a 1:1 relabelling: the exact historical
// defect's signature). But that pair is CORRECT in the config as it stands, because rop1_name is
// search-only and is never rendered as a control. Two projections of one field only become the
// "two rival controls" bug when BOTH are reachable as controls.
//
// So the invariant is not "no two facets may share a partition" — it is "no two facets that a user
// can both SELECT may share a partition". Assertion C is the other half: it pins the search-only
// keys OUT of the control lists, so the pair cannot become reachable without this gate firing.
// Widening A to every declared facet would fail correct code, which is the same class of mistake
// as asserting on duplicate field READS.
const controlKeys = new Set()
for (const sec of cfg.facetRail || []) {
  for (const k of (sec.drill ? sec.drill.filter(Boolean) : (sec.facet ? [sec.facet] : []))) controlKeys.add(k)
}
for (const k of cfg.researchFilters?.dropdowns || []) controlKeys.add(k)
for (const c of cfg.charts || []) if (c.facet) controlKeys.add(c.facet)

const keys = [...projections.keys()].filter((k) => controlKeys.has(k))
note(`control-reachable facets: ${keys.length} of ${projections.size} (rail + dropdowns + charts)`)
let dupFound = null
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    if (samePartition(projections.get(keys[i]), projections.get(keys[j]))) {
      dupFound = [keys[i], keys[j]]
      fail.push(`A. DUPLICATE AXIS: facets '${keys[i]}' and '${keys[j]}' induce the IDENTICAL ` +
                `partition of the rows — one axis declared twice. Two controls over one axis can ` +
                `never recognise each other's selection (each byte-matches its OWN accessor), so ` +
                `picking one silently ignores the other. Keep ONE key; make the other a display ` +
                `projection (optionLabel) or a search-only projection kept OUT of every control list.`)
    }
  }
}
if (!dupFound) note('A. no duplicate partition among ' + keys.length + ' facets — OK')

// ── B. NO FACET KEY APPEARS IN TWO CONTROL LISTS ────────────────────────────────────────────
const seen = new Map()
for (const sec of cfg.facetRail || []) {
  const declared = sec.drill ? sec.drill.filter(Boolean) : (sec.facet ? [sec.facet] : [])
  for (const k of declared) {
    if (seen.has(k)) {
      fail.push(`B. facet '${k}' is declared in TWO rail sections ('${seen.get(k)}' and '${sec.id}') — ` +
                `one axis rendering as two rival controls is the defect this gate exists for.`)
    } else seen.set(k, sec.id)
  }
}
if (!fail.some((f) => f.startsWith('B.'))) note(`B. ${seen.size} rail facet keys, each declared once — OK`)

// ── C. SEARCH-ONLY PROJECTIONS STAY OUT OF THE CONTROL LISTS ────────────────────────────────
// rop1_name is a LABEL projection of the same field affinity_bloc reads as a CODE. It exists only
// so free-text search matches "South Asian". If it ever enters a control list, the duplicate axis
// is back — and assertion A would not necessarily catch it first, because A is about the config's
// facet table while this is about the RAIL. Asserted by name, with the reason attached.
const SEARCH_ONLY = ['rop1_name']
for (const k of SEARCH_ONLY) {
  if (!facets[k]) continue
  if (seen.has(k)) {
    fail.push(`C. '${k}' is a SEARCH-ONLY projection but appears in rail section '${seen.get(k)}'. ` +
              `It re-declares an axis that already has a canonical key, which is exactly the ` +
              `People-vs-Affinity-Bloc duplicate the config comment warns against.`)
  }
}
if (!fail.some((f) => f.startsWith('C.'))) note('C. search-only projections absent from control lists — OK')

// ── SELF-TEST: the NEGATIVE test. Re-introduce the historical duplicate and REQUIRE a failure. ──
if (SELF_TEST) {
  console.log('\n--- SELF-TEST: re-introducing the historical `rop1` label twin ---')
  // The exact defect that was removed: a second facet over r.rop1 reading the LABEL where
  // affinity_bloc reads the CODE. A 1:1 relabelling => the identical partition.
  const twin = rows.map((r) => (r.rop1 && typeof r.rop1 === 'object' ? String(r.rop1.label || '') : ''))
  const canonical = projections.get('affinity_bloc')
  if (!canonical) { console.error('SELF-TEST INCONCLUSIVE: affinity_bloc not projected'); process.exit(1) }
  const caught = samePartition(canonical, twin)
  if (!caught) {
    console.error('SELF-TEST FAILED: the duplicate-axis check did NOT flag a pure relabelling of ' +
                  'affinity_bloc. The gate cannot detect the very defect it exists for.')
    process.exit(1)
  }
  console.log('SELF-TEST PASS: the duplicate partition WAS detected (gate can fail).')
  process.exit(0)
}

// ── verdict ─────────────────────────────────────────────────────────────────────────────────
console.log('')
if (fail.length) {
  console.error('FACET-ONE-FIELD: FAIL')
  for (const f of fail) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('FACET-ONE-FIELD: PASS — one row-field projection per facet, no axis declared twice.')
