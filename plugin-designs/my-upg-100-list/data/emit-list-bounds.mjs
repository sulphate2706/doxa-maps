// emit-list-bounds.mjs — a bbox per 100-list, so a poster frames its own region.
//
// WHY THIS EXISTS
// The poster wall renders each list as a map image, but it owns NO map: it is a
// sibling profile, not a map profile. Without bounds every poster rendered the
// default world camera — 27 identical world views. The true zone geometry comes
// from resolveAllZones(zones, deps), which needs the adm0/adm1 geojson pipeline the
// MAP profile builds. Duplicating that in the wall would make the wall a second map.
//
// So: precompute the bounds ONCE, here, at build time, and ship them in
// clusters.json. The wall stays independent of the map pane being alive, which also
// means a poster can be rendered from a page where no map is mounted at all.
//
// WHY PIN BOUNDS RATHER THAN POLYGON BOUNDS
// A poster is about the PEOPLE GROUPS in a list, not the administrative outline of
// the land. Framing on the pins keeps the subject filling the sheet; framing on
// polygons pulls in empty territory (a country's uninhabited interior, an ADM1 that
// stretches far past its people). Pin bounds are also computable from data this
// profile already caches, with no geojson dependency.
//
// Run:  node data/emit-list-bounds.mjs [--force]
// Writes: clusters.json  (adds a `bbox` [west, south, east, north] to every list)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import evaluate from './selector-evaluator.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = '/tmp/upg-live-records-full.json'
const CLUSTERS = join(HERE, 'clusters.json')

const API = 'https://pray.doxa.life/api/people-groups/list' +
  '?fields=slug,name,country_code,wagf_region,wagf_block,primary_language,rop1,population,latitude,longitude' +
  '&lang=en'

// A single people group is a point, not an area. Padding gives the poster some
// breathing room instead of a camera clamped exactly onto one pin.
const MIN_SPAN_DEG = 4
const PAD_RATIO    = 0.12

async function records() {
  if (existsSync(CACHE) && !process.argv.includes('--force')) {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'))
    const rows = Array.isArray(c) ? c : (c.posts || c.records || [])
    if (rows.length) { console.log(`[bounds] cache hit: ${rows.length} records`); return rows }
  }
  console.log('[bounds] fetching live records…')
  const res = await fetch(API)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = await res.json()
  const rows = json.posts || json.records || json
  writeFileSync(CACHE, JSON.stringify(rows))
  console.log(`[bounds] fetched ${rows.length} records`)
  return rows
}

// The API returns nested {value,label} objects for its taxonomy fields, but the
// shared selector-evaluator reads FLAT strings (r.country_code === 'MYS'). Flatten
// once here so the evaluator sees the shape it expects — this is why an unflattened
// run matched zero members for every geographic list.
function flatten(rec) {
  const f = { ...rec }
  for (const k of ['country_code', 'wagf_region', 'wagf_block', 'wagf_member', 'rop1', 'primary_language']) {
    const v = rec[k]
    if (v && typeof v === 'object' && 'value' in v) f[k] = v.value
  }
  return f
}

// Coordinates arrive as flat strings on this API; normalise once.
function coord(rec) {
  const lat = Number(rec.latitude ?? rec.lat)
  const lng = Number(rec.longitude ?? rec.lng ?? rec.lon)
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
    ? [lng, lat] : null
}

function bboxOf(members) {
  const pts = members.map(coord).filter(Boolean)
  if (!pts.length) return null

  // ANTIMERIDIAN. A naive min/max longitude is wrong for any group straddling
  // +/-180: oceania-indonesia has Tonga at -175 and Fiji at +178, which reads as a
  // 360-degree span (the whole globe) when the real cluster is ~15 degrees wide.
  // Fix: also measure the span in a 0..360 frame and keep whichever is tighter,
  // emitting a WEST > EAST box when the wrapped frame wins. Mapbox fitBounds
  // handles a wrapped box correctly; a 360-degree one just shows the world.
  const xs  = pts.map(p => p[0])
  const xs2 = xs.map(x => (x < 0 ? x + 360 : x))
  const spanA = Math.max(...xs)  - Math.min(...xs)
  const spanB = Math.max(...xs2) - Math.min(...xs2)
  const wrapped = spanB < spanA
  let w, e
  if (wrapped) {
    w = Math.min(...xs2); e = Math.max(...xs2)
    if (w > 180) w -= 360
    if (e > 180) e -= 360
  } else {
    w = Math.min(...xs); e = Math.max(...xs)
  }
  let s = Math.min(...pts.map(p => p[1]))
  let n = Math.max(...pts.map(p => p[1]))
  const hit = true

  // Pad, then enforce a minimum span so a 1-2 pin list is not a pinhole camera.
  // Pad on the ACTUAL span, which for a wrapped box is measured the short way.
  const spanX = wrapped ? (spanB) : (e - w)
  const padX = Math.max(spanX * PAD_RATIO, 0.5)
  const padY = Math.max((n - s) * PAD_RATIO, 0.5)
  w -= padX; e += padX; s -= padY; n += padY
  if (!wrapped && (e - w) < MIN_SPAN_DEG) { const c = (e + w) / 2; w = c - MIN_SPAN_DEG / 2; e = c + MIN_SPAN_DEG / 2 }
  if (n - s < MIN_SPAN_DEG) { const c = (n + s) / 2; s = c - MIN_SPAN_DEG / 2; n = c + MIN_SPAN_DEG / 2 }

  // Clamp to the valid Mercator window — fitBounds throws on out-of-range latitude.
  // Clamp latitude to the Mercator window; longitude is left as-is so a wrapped
  // box (west > east) survives — clamping it would silently un-wrap the fix above.
  return [
    +Math.max(-180, w).toFixed(4), +Math.max(-85, s).toFixed(4),
    +Math.min(180, e).toFixed(4),  +Math.min(85,  n).toFixed(4),
  ]
}

const recs = (await records()).map(flatten)
const clusters = JSON.parse(readFileSync(CLUSTERS, 'utf8'))

let done = 0, skipped = []
for (const key of ['lists', 'asia_lists', 'uncovered_lists']) {
  for (const list of (clusters[key] || [])) {
    if (!list?.selector) { skipped.push(`${list?.id} (no selector)`); continue }
    // evaluate() returns a Set of SLUGS, not records — map back to full rows.
    // pg_slugs is a selector type the shared evaluator does not implement (it is
    // an explicit member list used by the India/China province partitions), so
    // handle it directly rather than widening the shared evaluator for one caller.
    let slugs
    if (list.selector.type === 'pg_slugs') {
      slugs = new Set(list.selector.values || [])
    } else {
      try { slugs = evaluate(list.selector, recs) }
      catch (err) { skipped.push(`${list.id} (evaluate: ${err.message})`); continue }
    }
    const members = recs.filter(r => slugs.has(r.slug))
    const bbox = bboxOf(members)
    if (!bbox) { skipped.push(`${list.id} (0 geocoded of ${members.length} members)`); continue }
    list.bbox = bbox
    done++
    console.log(`[bounds] ${list.id.padEnd(28)} ${String(members.length).padStart(4)} pgs  ${bbox.join(', ')}`)
  }
}

writeFileSync(CLUSTERS, JSON.stringify(clusters, null, 2) + '\n')
console.log(`\n[bounds] wrote bbox for ${done} lists`)
if (skipped.length) console.log(`[bounds] SKIPPED ${skipped.length}: ${skipped.join(' · ')}`)
