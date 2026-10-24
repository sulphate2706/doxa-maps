#!/usr/bin/env node
// emit-india-states.mjs — India's states and union territories, each with the people groups inside it.
//
//   node plugin-designs/my-upg-100-list/data/emit-india-states.mjs
//
// ONE table, two consumers: UPG-100's batch selection (a state selection finds its people groups) and Country
// Posters' India section (one poster per state / union territory). It is SERVED, not bundled: the tree ships it
// as assets/people-groups/india-states.json and library/data/indiaStates.js fetches it only when a state is
// needed, checked against the sha384 pin this script writes in the SAME run (so a re-emit can never leave a
// stale pin behind).
//
// DERIVED, NOT RE-STAMPED. The membership comes from the committed admin-membership.json (pip-stamp.mjs: a
// point-in-polygon of every live record's coordinates against the ADM1 shapes, with a nearest-centroid fallback
// for border slivers). Re-stamping here would re-place all 2,106 records from today's data and move the counts
// baked from that file; deriving keeps the two in step, and check:india-states fails if they ever drift (it
// compares the input sha384s recorded in meta with the files on disk).
//
// The ids, codes, kinds and English names are fixed by ISO 3166-2:IN (28 states + 8 union territories). The
// shape names come from the geometry, so a poster can highlight its shape by the exact feature property.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const MEMBERSHIP = join(HERE, 'admin-membership.json')
const GEOMETRY = join(REPO, 'data', 'boundaries', 'gb-IND-ADM1-full.geojson')
const SERVED_GEOMETRY = 'boundaries/gb-IND-ADM1-full-web.geojson'   // what a poster fetches; the same 36 shapeNames
const OUT = join(REPO, 'data', 'people-groups', 'india-states.json')
const PIN = join(REPO, 'library', 'data', 'indiaStates.integrity.js')

// ISO 3166-2:IN — code → [English name, kind]
export const IN_DIVISIONS = {
  'IN-AN': ['Andaman and Nicobar Islands', 'union_territory'], 'IN-AP': ['Andhra Pradesh', 'state'],
  'IN-AR': ['Arunachal Pradesh', 'state'], 'IN-AS': ['Assam', 'state'], 'IN-BR': ['Bihar', 'state'],
  'IN-CH': ['Chandigarh', 'union_territory'], 'IN-CT': ['Chhattisgarh', 'state'],
  'IN-DH': ['Dadra and Nagar Haveli and Daman and Diu', 'union_territory'], 'IN-DL': ['Delhi', 'union_territory'],
  'IN-GA': ['Goa', 'state'], 'IN-GJ': ['Gujarat', 'state'], 'IN-HP': ['Himachal Pradesh', 'state'],
  'IN-HR': ['Haryana', 'state'], 'IN-JH': ['Jharkhand', 'state'], 'IN-JK': ['Jammu and Kashmir', 'union_territory'],
  'IN-KA': ['Karnataka', 'state'], 'IN-KL': ['Kerala', 'state'], 'IN-LA': ['Ladakh', 'union_territory'],
  'IN-LD': ['Lakshadweep', 'union_territory'], 'IN-MH': ['Maharashtra', 'state'], 'IN-ML': ['Meghalaya', 'state'],
  'IN-MN': ['Manipur', 'state'], 'IN-MP': ['Madhya Pradesh', 'state'], 'IN-MZ': ['Mizoram', 'state'],
  'IN-NL': ['Nagaland', 'state'], 'IN-OR': ['Odisha', 'state'], 'IN-PB': ['Punjab', 'state'],
  'IN-PY': ['Puducherry', 'union_territory'], 'IN-RJ': ['Rajasthan', 'state'], 'IN-SK': ['Sikkim', 'state'],
  'IN-TG': ['Telangana', 'state'], 'IN-TN': ['Tamil Nadu', 'state'], 'IN-TR': ['Tripura', 'state'],
  'IN-UP': ['Uttar Pradesh', 'state'], 'IN-UT': ['Uttarakhand', 'state'], 'IN-WB': ['West Bengal', 'state'],
}

const sha = (buf) => 'sha384-' + createHash('sha384').update(buf).digest('base64')
const rel = (p) => relative(REPO, p).split('\\').join('/')

export function buildIndiaStates() {
  const membershipRaw = readFileSync(MEMBERSHIP)
  const geometryRaw = readFileSync(GEOMETRY)
  const membership = JSON.parse(membershipRaw)
  const features = JSON.parse(geometryRaw).features
  const bySlugState = new Map()
  for (const [slug, m] of Object.entries(membership)) if (m && m.country === 'IND') bySlugState.set(slug, m.admin1)
  const bbox = (geom) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]) } else for (const x of c) walk(x) }
    walk(geom.coordinates)
    return [w, s, e, n].map((v) => Math.round(v * 1000) / 1000)
  }
  const states = features
    .map((f) => ({ iso: f.properties.shapeISO, shapeName: f.properties.shapeName, geom: f.geometry }))
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .map(({ iso, shapeName, geom }) => {
      const def = IN_DIVISIONS[iso]
      if (!def) throw new Error(`the geometry has ${iso} (${shapeName}), which is not an ISO 3166-2:IN division`)
      const slugs = [...bySlugState].filter(([, st]) => st === shapeName).map(([s]) => s).sort()
      return { id: 'india-' + iso.slice(3).toLowerCase(), iso, kind: def[1], name: def[0], shapeName, bbox: bbox(geom), count: slugs.length, slugs }
    })
  const meta = {
    what: 'India\'s 28 states and 8 union territories, each with the UPG-100 people groups located inside it (slugs). The term is "states and union territories", never "provinces".',
    regenerate: 'node plugin-designs/my-upg-100-list/data/emit-india-states.mjs (after pip-stamp.mjs re-stamps admin-membership.json)',
    inputs: {
      membership: { path: rel(MEMBERSHIP), sha384: sha(membershipRaw) },
      geometry: { path: rel(GEOMETRY), sha384: sha(geometryRaw) },
    },
    served_geometry: SERVED_GEOMETRY,
    shape_property: 'shapeName',
    counts: { states: states.filter((s) => s.kind === 'state').length, union_territories: states.filter((s) => s.kind === 'union_territory').length,
      people_groups: states.reduce((a, s) => a + s.count, 0) },
  }
  // One division per line: small enough to review as a diff, and still one fetch of ~17 KB.
  const text = '{\n"meta":' + JSON.stringify(meta, null, 1) + ',\n"states":[\n'
    + states.map((s) => JSON.stringify(s)).join(',\n') + '\n]}\n'
  return { text, meta, states }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { text, meta } = buildIndiaStates()
  writeFileSync(OUT, text)
  const pin = sha(Buffer.from(text, 'utf8'))
  writeFileSync(PIN, '// GENERATED by plugin-designs/my-upg-100-list/data/emit-india-states.mjs, in the same run that writes\n'
    + '// data/people-groups/india-states.json: the sha384 of its exact bytes. library/data/indiaStates.js refuses a served\n'
    + '// copy that does not match. Do not edit by hand; re-run the emitter.\n'
    + `export const INDIA_STATES_SHA384 = '${pin}'\n`)
  console.log(`emit-india-states: ${meta.counts.states} states + ${meta.counts.union_territories} union territories, ${meta.counts.people_groups} people groups`)
  console.log(`  wrote ${rel(OUT)} (${Buffer.byteLength(text)} B) + ${rel(PIN)} (${pin.slice(0, 20)}…)`)
}
