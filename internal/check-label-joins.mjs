#!/usr/bin/env node
/**
 * check-label-joins.mjs — assert no NEW label-keyed equality predicate enters the codebase.
 *
 * ★ WHY THIS EXISTS — a join is only as safe as the number of INDEPENDENT DERIVATIONS feeding it.
 *   A Mapbox filter of the shape  ['==', ['get', '<x>Label'], value]  compares a feature property
 *   against a value produced SOMEWHERE ELSE. If the two sides are derived by different fallback
 *   chains, the predicate silently matches ZERO features — a blank map, with no error anywhere.
 *
 *   TAXONOMY (measured across ~80 equality predicates in this repo, 2026-09-20):
 *     SAFE-1  compared against a LITERAL ('Available', true, '__none__') — no second derivation.
 *     SAFE-2  compared against a CODE/SLUG both sides read from the SAME field (affinityBlock,
 *             uniqueId, countryIso, doxaRegion) — ONE derivation, used twice.
 *     DANGER  compared against a LABEL derived by a DIFFERENT chain than wrote the property.
 *   Only the DANGER class needs guarding, and it is ENUMERABLE IN ONE GREP — which is the property
 *   that makes this checkable by someone who does not know the domain, and re-checkable after any
 *   change. (Framing is the weak half of a rule; the grep is the tool.)
 *
 * ★ THE FIX PATTERN when one appears: do NOT make the chains agree — that leaves N derivations and
 *   adds a constraint nothing enforces, which is the condition that produces the bug. CARRY THE
 *   VALUE THAT BUILT THE PROPERTY (see `originalLabels` on the dialect path: built by both producers,
 *   threaded through mapStore + GeocoderComponent to the filter, verified end-to-end). That removes
 *   N-1 derivations, converting DANGER into SAFE-2 — true by construction, not by discipline.
 *   PREFER FIXES THAT REMOVE A DERIVATION OVER FIXES THAT ADD A RULE.
 *
 * KNOWN/ACCEPTED: the two occurrences in useGeocoderSearch.js are a fallback branch that is never
 * reached (the code branch wins whenever blocCode/clusterCode is present, and useSearch.js attaches
 * them to every such event from fields the source contract DOES map). They are dead rather than
 * broken. Allow-listed with that reasoning so this gate starts GREEN and any NEW one fails loudly.
 *
 * Usage: node internal/check-label-joins.mjs   (exit 0 clean / 1 new danger found)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN = ['library', 'plugin-designs']
// ['==', ['get', 'somethingLabel'], …] — a label-keyed equality predicate.
const DANGER = /\[\s*'=='\s*,\s*\[\s*'get'\s*,\s*'([a-zA-Z_]*[Ll]abel)'\s*\]/g

// Accepted occurrences: "<relpath>:<property>" — each MUST carry a reason in the header above.
const ALLOW = new Set([
  'library/composables/useGeocoderSearch.js:affinityBlockLabel',
  'library/composables/useGeocoderSearch.js:clusterLabel',
])

const hits = []
const scan = (dir) => {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { scan(p); continue }
    if (!/\.(js|vue|mjs)$/.test(e.name)) continue
    const rel = relative(ROOT, p)
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      DANGER.lastIndex = 0
      let m
      while ((m = DANGER.exec(line))) hits.push({ rel, line: i + 1, prop: m[1] })
    })
  }
}
for (const d of SCAN) scan(join(ROOT, d))

const unexpected = hits.filter((h) => !ALLOW.has(`${h.rel}:${h.prop}`))
console.log(`LABEL-JOINS: scanned ${SCAN.join(' + ')} — ${hits.length} label-keyed equality predicate(s), ${ALLOW.size} allow-listed.`)
if (unexpected.length) {
  console.error(`LABEL-JOINS: FAIL — ${unexpected.length} NEW label-keyed equality predicate(s):`)
  for (const h of unexpected) console.error(`  ${h.rel}:${h.line}  ['==', ['get', '${h.prop}'], …]`)
  console.error("  A feature property compared against a value derived ELSEWHERE matches ZERO features when the")
  console.error("  two derivations diverge — silently. Either compare a CODE both sides read from one field, or")
  console.error("  CARRY the value that built the property (see originalLabels on the dialect path).")
  process.exit(1)
}
console.log('LABEL-JOINS: PASS — no new two-derivation label join.')
