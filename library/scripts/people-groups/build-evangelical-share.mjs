#!/usr/bin/env node
/**
 * build-evangelical-share.mjs — each DOXA people group's published evangelical share, so a prayer
 * packet can state the share for ITS OWN groups.
 *
 * Writes data/people-groups/evangelical-by-slug.json: { slug: [bandMidpointPercent, population] }.
 *
 * WHY. The packet's "% evangelical" page says each box is a share of the people IN THIS LIST, but it
 * printed one DOXA-wide figure (christian-share.json, 0.6133% of 209,079,159 people) in every packet.
 * That file has no builder in the repo; this script is its METHOD made reproducible, per group:
 *   · the IMB people-group CSV joined to the DOXA snapshot by ROP3 + country (the Vision Card's join);
 *   · each group's published EvangelicalLevel BAND taken at its midpoint, 0 for "No Known Evangelicals";
 *   · the group's IMB population, which is what the share is weighted by.
 * The midpoint is derived from the band's own text, never typed per band, so a new band in the data
 * cannot silently take a wrong value.
 *
 * ⚠ NOT imb_gsec. The API's GSEC puts 225 groups at "no evangelicals" where EvangelicalLevel puts 1,444
 * at "No Known Evangelicals": GSEC's "less than 2%" band also carries church-planting status and absorbs
 * about 1,200 zero-evangelical groups. A share computed from it would sit on a different scale from the
 * page's own stated method and read higher than the figure it replaces.
 *
 * ★ SELF-CHECK: summed over every DOXA group, the table must reproduce christian-share.json exactly —
 * the same matched count, population, evangelical population and percentage. If it does not, the
 * per-group table is not the committed method and the script refuses to write.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DATA = join(REPO, 'data', 'people-groups')

// A small CSV reader for quoted fields (the IMB file quotes names that contain commas).
function parseCsv(text) {
  const out = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); out.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); out.push(row) }
  return out
}

/** The band's midpoint, from its own wording. null for a band this cannot read. */
export function bandMidpoint(band) {
  const b = String(band || '').trim()
  if (b === 'No Known Evangelicals') return 0
  let m = b.match(/^(\d+(?:\.\d+)?)% or Greater but Less than (\d+(?:\.\d+)?)%$/)
  if (m) return (Number(m[1]) + Number(m[2])) / 2
  m = b.match(/^Less than (\d+(?:\.\d+)?)%$/)
  if (m) return Number(m[1]) / 2
  m = b.match(/^(\d+(?:\.\d+)?)% or Greater$/)
  if (m) return (Number(m[1]) + 100) / 2
  return null
}

const rows = parseCsv(readFileSync(join(DATA, 'people_groups.csv'), 'utf8'))
const col = Object.fromEntries(rows[0].map((h, i) => [h.trim(), i]))
for (const need of ['ROP3Code', 'ISOAlpha3', 'EvangelicalLevel', 'Population']) {
  if (col[need] === undefined) { console.error(`[evangelical-share] the IMB CSV has no ${need} column`); process.exit(1) }
}
const imb = new Map()
for (const r of rows.slice(1)) {
  const key = `${String(r[col.ROP3Code] || '').trim()}|${String(r[col.ISOAlpha3] || '').trim()}`
  if (!imb.has(key)) imb.set(key, r)
}
const snapRaw = JSON.parse(readFileSync(join(DATA, 'doxa-groups-snapshot.json'), 'utf8'))
const snap = Array.isArray(snapRaw) ? snapRaw : (snapRaw.posts || snapRaw.groups || snapRaw.rows || [])

const groups = {}
const unreadable = new Set()
let pop = 0, ev = 0
for (const g of snap) {
  const r = imb.get(`${String(g.rop3 || '').trim()}|${String(g.country || '').trim()}`)
  if (!r || !g.slug) continue
  const mid = bandMidpoint(r[col.EvangelicalLevel])
  if (mid === null) { unreadable.add(r[col.EvangelicalLevel]); continue }
  const p = Math.round(Number(r[col.Population]) || 0)
  groups[g.slug] = [mid, p]
  pop += p; ev += (p * mid) / 100
}
if (unreadable.size) {
  console.error(`[evangelical-share] bands with no readable midpoint: ${[...unreadable].join(' | ')}`)
  process.exit(1)
}

// ★ THE SELF-CHECK: the per-group table must BE the committed method.
const committed = JSON.parse(readFileSync(join(DATA, 'christian-share.json'), 'utf8'))
const got = {
  groupsMatched: Object.keys(groups).length,
  population: pop,
  evangelicalPopulation: Math.round(ev),
  pctEvangelical: Math.round((10000 * ev) / pop) / 10000 * 100,
}
const want = {
  groupsMatched: committed.groupsMatched,
  population: committed.population,
  evangelicalPopulation: committed.evangelicalPopulation,
  pctEvangelical: committed.pctEvangelical,
}
const same = got.groupsMatched === want.groupsMatched && got.population === want.population
  && got.evangelicalPopulation === want.evangelicalPopulation
  && Math.abs((100 * ev) / pop - want.pctEvangelical) < 0.00005
if (!same) {
  console.error('[evangelical-share] REFUSING TO WRITE: the per-group table does not reproduce christian-share.json')
  console.error(`  computed : ${JSON.stringify(got)}`)
  console.error(`  committed: ${JSON.stringify(want)}`)
  process.exit(1)
}

const out = {
  _what: 'Each DOXA people group\'s evangelical share (band midpoint, percent) and population, for a prayer packet\'s own-groups figure. Summed over every group it reproduces christian-share.json exactly.',
  _method: 'IMB people-group CSV joined to the DOXA snapshot by ROP3Code + ISOAlpha3; EvangelicalLevel band at its midpoint (0 for No Known Evangelicals); IMB Population.',
  sources: { imb: 'data/people-groups/people_groups.csv', doxa: 'data/people-groups/doxa-groups-snapshot.json' },
  groups,
}
writeFileSync(join(DATA, 'evangelical-by-slug.json'), JSON.stringify(out) + '\n')
console.log(`[evangelical-share] ${got.groupsMatched} groups -> data/people-groups/evangelical-by-slug.json`)
console.log(`  reproduces christian-share.json: ${got.groupsMatched} matched · ${pop.toLocaleString('en')} people · ${Math.round(ev).toLocaleString('en')} evangelical · ${((100 * ev) / pop).toFixed(4)}%`)
