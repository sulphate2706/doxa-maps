#!/usr/bin/env node
/**
 * check-list-pattern-doc — the numbers in PATTERN-A-LIST-OF-ZONES.md must still be true.
 *
 * That document tells the next agent how to turn a project list (7000/4700/2000/700) into ~100
 * zones, and it does it by QUOTING MEASUREMENTS: 28 leaf zones, 5 registry lists, 7 selector types,
 * four membership files with specific slug counts. Prose like that is the first thing to rot — the
 * data moves, the sentence does not, and a confident wrong number in a how-to is worse than no
 * how-to, because the reader has no reason to doubt it.
 *
 * ★ IT RE-DERIVES EVERY NUMBER FROM THE SOURCE AND COMPARES TO THE DOC'S OWN TEXT. It does not
 * assert the numbers are 28/5/7 — hardcoding the expected value on both sides is the tautology this
 * whole class of gate falls into, where the check restates the doc instead of testing it. One side
 * is parsed out of the markdown, the other is computed from clusters.json / lists.json / the
 * membership files. They must agree.
 *
 * So this gate fails in BOTH useful directions:
 *   · someone adds a zone or a list and does not update the doc  → mismatch
 *   · someone edits the doc's numbers without the data changing  → mismatch
 *
 * ⚠ The deaf collapse (29 cluster entries → 28 leaves) is asserted explicitly, because it is the
 * exact discrepancy that has already caused two real errors: a zone count of 27 that forgot `deaf`,
 * and a delete of 30 files in the belief there were 28.
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PLUGIN = join(REPO, 'plugin-designs/my-upg-100-list')
const DOC = join(PLUGIN, 'documentation/PATTERN-A-LIST-OF-ZONES.md')

const fails = []
const notes = []
const ok = (label, got) => notes.push(`  ok    ${label.padEnd(58)} ${got}`)
const bad = (label, expected, got) => fails.push(`${label}\n      doc says:  ${expected}\n      source is: ${got}`)

if (!existsSync(DOC)) {
  console.error('LIST-PATTERN: NOT MEASURED (exit 75) — the document is absent; nothing to check.')
  process.exit(75)
}
const doc = readFileSync(DOC, 'utf8')

// ── 1. leaf zones. The doc's headline count, and the one with a history of being wrong. ──────────
const clusters = JSON.parse(readFileSync(join(PLUGIN, 'data/clusters.json'), 'utf8'))
const tree = await import(join(PLUGIN, 'data/legend-tree.js'))

// ⚠ buildLegendNodes THROWS on a malformed zone (assertUniformLeafShape guards the consumer shape),
// and an uncaught throw here would exit 1 — the same code as a real FAIL, so "the doc is wrong" and
// "the data will not even load" would look identical to a reader and to CI. They need different
// answers: one is a doc to fix, the other is a broken clusters.json that this gate cannot speak to
// at all. Found by mutation-testing: adding a zone without its `count` field crashed the run with a
// stack trace and exit 1, which I would otherwise have read as the gate correctly failing.
let leaves
try {
  leaves = tree.leafZones(tree.buildLegendNodes(clusters))
} catch (e) {
  console.error('LIST-PATTERN: NOT MEASURED (exit 75) — clusters.json does not build a legend tree,')
  console.error('  so nothing can be said about whether the document matches it. Fix the data first;')
  console.error('  the zone-shape gate (assertUniformLeafShape) is the one describing the problem:')
  console.error(`  ${e.message.split('\n').slice(0, 3).join('\n  ')}`)
  process.exit(75)
}

const docLeaves = Number((doc.match(/⇒\s*(\d+)/) || [])[1])
if (docLeaves !== leaves.length) bad('leaf-zone count', docLeaves, leaves.length)
else ok('leaf zones, re-derived through leafZones()', leaves.length)

// The entry count, and that the difference is exactly the deaf collapse.
const entries = Object.values(clusters).filter(Array.isArray).flat().length
const docEntries = Number((doc.match(/(\d+)\s+entries,\s+\d+\s+zones/) || [])[1])
if (docEntries !== entries) bad('clusters.json entry count', docEntries, entries)
else ok('clusters.json list entries', entries)

const deafLeaves = leaves.filter((z) => /deaf/i.test(z.id || z.key || ''))
const deafEntries = (clusters.deaf_lists || []).length
if (deafLeaves.length !== 1) bad('the deaf collapse yields ONE leaf', 1, deafLeaves.length)
else if (entries - leaves.length !== deafEntries - 1) {
  bad('entries minus leaves is explained by the deaf collapse alone', `${deafEntries - 1}`, `${entries - leaves.length}`)
} else ok('the 29→28 collapse is exactly the deaf buckets merging', `${deafEntries} entries → 1 leaf`)

// ── 2. the registry. Every list the doc tables must exist, with those aliases. ────────────────────
const registry = JSON.parse(readFileSync(join(REPO, 'library/lists/lists.json'), 'utf8'))

/**
 * Slice the markdown to ONE table, by the heading it sits under.
 * ⚠ NOT OPTIONAL. The first version of this gate matched `^| \`id\` |` across the WHOLE document
 * and swept up the SELECTOR table too, reporting `union` as an unknown registry list — a false
 * failure against a correct doc. Two tables in one file share a row shape; the only thing that
 * distinguishes them is where they are.
 */
function section(fromHeading, toHeading) {
  const a = doc.indexOf(fromHeading)
  if (a < 0) return ''
  const b = toHeading ? doc.indexOf(toHeading, a + 1) : -1
  return doc.slice(a, b < 0 ? undefined : b)
}
const listSection = section('## Half 1', '## Half 2')
const zoneSection = section('## Half 2', '## What you get')

const docIds = [...listSection.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1])
const realIds = registry.lists.map((l) => l.id)
const missing = realIds.filter((id) => !docIds.includes(id))
const extra = docIds.filter((id) => !realIds.includes(id))
if (missing.length) bad('every registry list appears in the doc table', `missing ${missing.join(', ')}`, realIds.join(', '))
else if (extra.length) bad('the doc table lists only real registry ids', `unknown ${extra.join(', ')}`, realIds.join(', '))
else ok('registry lists, all present in the doc table', realIds.length)

if (registry.default !== 'doxa') bad('the default list', 'doxa', registry.default)
else ok('the default list is the unfiltered one', registry.default)

// ── 3. selector types. The doc's table is the vocabulary the pattern hands the next author. ───────
const selCounts = {}
for (const v of Object.values(clusters)) {
  if (!Array.isArray(v)) continue
  for (const l of v) {
    const t = l?.selector?.type
    if (t) selCounts[t] = (selCounts[t] || 0) + 1
  }
}
for (const [type, n] of Object.entries(selCounts)) {
  const row = zoneSection.match(new RegExp(`^\\|\\s*\`${type}\`\\s*\\|\\s*(\\d+)\\s*\\|`, 'm'))
  if (!row) bad(`selector type "${type}" has a row in the doc`, 'a row', `${n} zones use it, undocumented`)
  else if (Number(row[1]) !== n) bad(`selector "${type}" zone count`, row[1], n)
}
const docSelTypes = [...zoneSection.matchAll(/^\|\s*`(\w+)`\s*\|\s*\d+\s*\|/gm)].map((m) => m[1])
  .filter((t) => t in selCounts || /^(wagf_|country_|union|pg_slugs|deaf_)/.test(t))
for (const t of docSelTypes) {
  if (!(t in selCounts)) bad(`doc documents selector "${t}"`, 'in use', 'no zone uses it')
}
if (!fails.length) ok('selector types and their zone counts', Object.keys(selCounts).length + ' types')

// ── 4. membership files. The doc quotes four slug counts; doxa must have none. ────────────────────
const MEM = join(REPO, 'public/dx-maps/assets/people-groups/lists')
if (!existsSync(MEM)) {
  console.error('LIST-PATTERN: NOT MEASURED (exit 75) — membership directory absent, so the counts')
  console.error(`  in the doc cannot be checked either way: ${MEM}`)
  process.exit(75)
}
for (const f of readdirSync(MEM).filter((f) => f.endsWith('.json'))) {
  const id = f.replace(/\.json$/, '')
  const n = (JSON.parse(readFileSync(join(MEM, f), 'utf8')).slugs || []).length
  const row = listSection.match(new RegExp(`^${id}\\s+(\\d+)`, 'm'))
  if (!row) bad(`membership "${id}" is quoted in the doc`, 'a row', `${n} slugs, undocumented`)
  else if (Number(row[1]) !== n) bad(`membership "${id}" slug count`, row[1], n)
}
if (existsSync(join(MEM, 'doxa.json'))) {
  bad('doxa has NO membership file (it is the unfiltered default)', 'absent', 'present')
} else ok('doxa has no membership file, as the default requires', 'absent')

// ── report ───────────────────────────────────────────────────────────────────────────────────────
for (const n of notes) console.log(n)
if (fails.length) {
  console.error('LIST-PATTERN: FAIL — PATTERN-A-LIST-OF-ZONES.md disagrees with the data it describes.')
  for (const f of fails) console.error(`  ✗ ${f}`)
  console.error('\n  Fix whichever is wrong. If the DATA changed, update the doc; if the DOC drifted,')
  console.error('  correct the number. Do not delete the claim to make this pass.')
  process.exit(1)
}
console.log(`LIST-PATTERN: PASS — ${notes.length} claims in PATTERN-A-LIST-OF-ZONES.md re-derived from clusters.json, lists.json and the membership files.`)
