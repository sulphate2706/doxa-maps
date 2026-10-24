#!/usr/bin/env node
// check-india-states — India's states-and-union-territories table (data/people-groups/india-states.json) stays
// TRUE to the stamping it is derived from, and the served copy is the pinned one.
//
// WHY: UPG-100's batch selection finds a state's people groups in it, and Country Posters builds one poster per
// state / union territory from it. When the people-group data changes, the stamping is redone
// (pip-stamp.mjs → admin-membership.json) and this table must follow; a table that silently kept the old
// membership would print confident, wrong posters. Headless, no network. Asserts:
//   A. SHAPE: all 36 divisions of ISO 3166-2:IN, 28 'state' + 8 'union_territory', unique iso and id
//      (india-<code>), each with a sane bbox inside India, count == slugs.length; Nagaland + Mizoram present
//      even with no people groups (each consumer decides what an empty division shows).
//   B. MEMBERSHIP: the union of every division's slugs == admin-membership.json's India slugs (855 today), and
//      every slug sits in exactly ONE division.
//   C. SHAPES MATCH: every shapeName is a feature of the served geometry (and of the full geometry it is cut from),
//      so a poster can highlight its shape by the exact property.
//   D. NO DRIFT: re-deriving the table from today's inputs gives the committed bytes, and the input sha384s
//      recorded in meta are the files on disk — a changed stamping without a re-emit FAILS here.
//   E. PIN: INDIA_STATES_SHA384 == sha384(the committed bytes) == sha384(the served copy in the tree); size ceiling.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(REPO, ...a)
const fails = []
const notes = []
const ok = (cond, msg, note) => { if (!cond) fails.push(msg); else if (note) notes.push(`  ok    ${note}`) }
const sha = (buf) => 'sha384-' + createHash('sha384').update(buf).digest('base64')

const TABLE = P('data/people-groups/india-states.json')
const SERVED = P('public/dx-maps/assets/people-groups/india-states.json')
const SIZE_CEILING = 24 * 1024
let raw, table, membership, emitter, pin, full, web
try {
  raw = readFileSync(TABLE)
  table = JSON.parse(raw)
  membership = JSON.parse(readFileSync(P('plugin-designs/my-upg-100-list/data/admin-membership.json'), 'utf8'))
  emitter = await import(pathToFileURL(P('plugin-designs/my-upg-100-list/data/emit-india-states.mjs')).href)
  ;({ INDIA_STATES_SHA384: pin } = await import(pathToFileURL(P('library/data/indiaStates.integrity.js')).href))
  full = JSON.parse(readFileSync(P('data/boundaries/gb-IND-ADM1-full.geojson'), 'utf8'))
  web = JSON.parse(readFileSync(P('data', table.meta.served_geometry), 'utf8'))
} catch (e) {
  console.error(`INDIA-STATES: NOT MEASURED (exit 75) — an input did not load: ${e.message}`)
  process.exit(75)
}
const states = table.states || []

// ── A. shape ─────────────────────────────────────────────────────────────────────────────────────
const isos = states.map((s) => s.iso), ids = states.map((s) => s.id)
const kinds = { state: 0, union_territory: 0 }
for (const s of states) kinds[s.kind] = (kinds[s.kind] || 0) + 1
ok(states.length === 36 && new Set(isos).size === 36 && isos.every((i) => emitter.IN_DIVISIONS[i]),
  `the table has ${states.length} divisions (${new Set(isos).size} distinct ISO codes); ISO 3166-2:IN has 36`)
ok(kinds.state === 28 && kinds.union_territory === 8 && Object.keys(kinds).length === 2,
  `kinds are ${JSON.stringify(kinds)}, expected 28 state + 8 union_territory`, 'all 36 divisions: 28 states + 8 union territories, unique ISO codes')
ok(new Set(ids).size === 36 && states.every((s) => s.id === 'india-' + s.iso.slice(3).toLowerCase()),
  'ids are not the unique india-<code> form', 'ids are india-<code>, unique (wall cards, packet file names)')
const badBox = states.filter((s) => !(Array.isArray(s.bbox) && s.bbox.length === 4 && s.bbox[0] < s.bbox[2] && s.bbox[1] < s.bbox[3]
  && s.bbox[0] >= 67 && s.bbox[2] <= 98 && s.bbox[1] >= 6 && s.bbox[3] <= 38)).map((s) => s.iso)
ok(!badBox.length, `bboxes out of shape or outside India: ${badBox.join(', ')}`)
const badCount = states.filter((s) => !Array.isArray(s.slugs) || s.count !== s.slugs.length).map((s) => s.iso)
ok(!badCount.length, `count != slugs.length for ${badCount.join(', ')}`, 'every bbox sits inside India; every count is its slugs\' length')
ok(['IN-NL', 'IN-MZ'].every((i) => isos.includes(i)), 'Nagaland or Mizoram is missing: an empty division must still be listed')

// ── B. membership ────────────────────────────────────────────────────────────────────────────────
const india = Object.entries(membership).filter(([, m]) => m && m.country === 'IND').map(([s]) => s).sort()
const seen = new Map()
for (const s of states) for (const slug of s.slugs || []) seen.set(slug, (seen.get(slug) || 0) + 1)
const twice = [...seen].filter(([, n]) => n > 1).map(([s]) => s)
const missing = india.filter((s) => !seen.has(s)), extra = [...seen.keys()].filter((s) => !india.includes(s))
ok(!twice.length, `slugs in more than one division: ${twice.slice(0, 6).join(', ')}`)
ok(!missing.length && !extra.length,
  `membership differs from admin-membership.json: missing ${missing.slice(0, 5).join(', ') || '-'}; extra ${extra.slice(0, 5).join(', ') || '-'}`,
  `the ${india.length} India people groups, each in exactly one division (= admin-membership.json)`)

// ── C. shapes match the geometry ─────────────────────────────────────────────────────────────────
const webNames = new Set(web.features.map((f) => f.properties[table.meta.shape_property]))
const fullNames = new Set(full.features.map((f) => f.properties.shapeName))
const noShape = states.filter((s) => !webNames.has(s.shapeName) || !fullNames.has(s.shapeName)).map((s) => s.shapeName)
ok(!noShape.length, `shapeNames not in ${table.meta.served_geometry}: ${noShape.join(', ')}`,
  `every shapeName is a feature of ${table.meta.served_geometry}`)

// ── D. no drift ──────────────────────────────────────────────────────────────────────────────────
for (const [k, inp] of Object.entries(table.meta.inputs || {})) {
  const now = existsSync(P(inp.path)) ? sha(readFileSync(P(inp.path))) : 'MISSING'
  ok(now === inp.sha384, `meta.inputs.${k} (${inp.path}) changed since the table was emitted: re-run node plugin-designs/my-upg-100-list/data/emit-india-states.mjs`)
}
let rebuilt = null
try { rebuilt = emitter.buildIndiaStates().text } catch (e) { fails.push(`re-deriving the table threw: ${e.message}`) }
ok(rebuilt === raw.toString('utf8'), 'the committed table is not what the emitter derives from today\'s inputs: re-run the emitter',
  'NO DRIFT: re-derived from today\'s inputs it is byte-identical, and meta\'s input sha384s are the files on disk')

// ── E. pin + served copy ─────────────────────────────────────────────────────────────────────────
ok(pin === sha(raw), `INDIA_STATES_SHA384 (${String(pin).slice(0, 20)}…) is not the table's sha384 (${sha(raw).slice(0, 20)}…): re-run the emitter`)
ok(existsSync(SERVED) && sha(readFileSync(SERVED)) === pin, existsSync(SERVED)
  ? 'the served copy (public/dx-maps/assets/people-groups/india-states.json) is not the pinned table: run bun run tree'
  : 'the table is not in the tree (public/dx-maps/assets/people-groups/india-states.json): add it to generate-tree\'s allowlist and run bun run tree',
  'pin == the table == the served copy')
ok(raw.length <= SIZE_CEILING, `the table is ${raw.length} B, over the ${SIZE_CEILING} B ceiling`, `${raw.length} B (ceiling ${SIZE_CEILING})`)

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('INDIA-STATES: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('INDIA-STATES: PASS — 36 divisions, every India people group in exactly one, shapes match the served geometry, no drift from the stamping, and the served copy is the pinned one.')
