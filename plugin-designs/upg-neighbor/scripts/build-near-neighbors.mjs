#!/usr/bin/env node
/**
 * build-near-neighbors.mjs — for every unreached people group, the REACHED groups whose believers are
 * culturally nearest to it, measured on Ralph D. Winter's E-scale.
 *
 *   node plugin-designs/upg-neighbor/scripts/build-near-neighbors.mjs
 *
 * READS   data/people-groups/people_groups.csv   peoplegroups.org public download (see its meta)
 * WRITES  data/tables/near-neighbors.json         served as assets/tables/near-neighbors.json
 *
 * THE FRAMEWORK, in our words. Winter (Lausanne 1974) measured evangelism by the cultural distance a
 * witness has to cross: E-1 inside one's own language and culture, E-2 into a NEAR culture, E-3 into
 * a DISTANT one. His companion P-scale measures the same distance from the other side: how far a
 * people has to go to find a church. The strategic point is that believers in a near culture can
 * reach a people far more naturally than anyone else, so the first mobilization question for an
 * unreached group is "who are its E-1 and E-2 believers?". That is what this table answers.
 *
 * HOW EACH LEVEL IS DECIDED FROM THE DATA (a reached group R, an unreached group U):
 *   E-1  R speaks U's language (same LanguageCode, ISO 639-3). Same ROP25 code as well means the
 *        SAME people living in another country (a diaspora): flagged `samePeople`.
 *   E-2  a different language, but a near culture: the same ROP2 people cluster, or the same language
 *        family inside the same ROP1 affinity bloc.
 *   E-3  none of those, but geographically close: within NEAR_KM, or in the same country.
 *   P-level of U = the smallest E-level any reached group reaches it at (P-1 when an E-1 neighbor
 *   exists, P-2 when only E-2, P-3 when only E-3 or none).
 *   These are proxies. Language code and IMB's people taxonomy stand in for "culture"; they are the
 *   best public signal there is, not a field survey.
 *
 * REACHED / UNREACHED follow the IMB definition the source uses: EvangelicalLevel >= 2% is reached
 * (GSEC 4-6 in this file), below 2% or "No Known Evangelicals" is unreached.
 * `believersEst` = Population x the midpoint of the evangelical band. It is an ORDER OF MAGNITUDE for
 * sizing a media audience, never a count.
 *
 * STRICT. The run FAILS on a band it does not know, on a row without coordinates, and on an empty
 * result, so a changed source cannot silently produce a thinner table.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexReached, closestReached, ringCounts } from '../src/rings.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CSV = join(ROOT, 'data/people-groups/people_groups.csv')
const OUT = join(ROOT, 'data/tables/near-neighbors.json')
// DX's own people-group set ({ slug, rop3, country: ISO3 }): gives each row the slug DX pages key on.
const DX_SNAPSHOT = join(ROOT, 'data/people-groups/doxa-groups-snapshot.json')

const NEAR_KM = 600          // E-3 radius: close enough to share a region, a market, a media footprint
const KEEP = { 1: 6, 2: 6, 3: 4 }  // neighbors kept per unreached group, per E-level (best first)

const fail = (msg) => { console.error('build-near-neighbors: FAIL — ' + msg); process.exit(1) }

// A quoted-field CSV reader (names and descriptions contain commas, quotes and newlines).
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const head = rows.shift().map((h) => h.replace(/^﻿/, ''))
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

// Evangelical band -> [reached?, midpoint %]. Every band the source uses must be listed here.
const BAND = {
  'No Known Evangelicals': [false, 0],
  'Less than 2%': [false, 1],
  '2% or Greater but Less than 5%': [true, 3.5],
  '5% or Greater but Less than 10%': [true, 7.5],
  '10% or Greater but Less than 15%': [true, 12.5],
  '15% or Greater but Less than 20%': [true, 17.5],
  '20% or Greater but Less than 30%': [true, 25],
  '30% or Greater but Less than 40%': [true, 35],
  '40% or Greater but Less than 50%': [true, 45],
  '50% or Greater but Less than 75%': [true, 62.5],
  '75% or Greater': [true, 80],
}
const avail = (v) => (v === 'Available' ? 1 : 0)

const src = parseCsv(readFileSync(CSV, 'utf8'))
if (!src.length) fail('no rows in people_groups.csv')

const groups = src.map((r, i) => {
  const band = BAND[r.EvangelicalLevel]
  if (!band) fail(`unknown EvangelicalLevel "${r.EvangelicalLevel}" (${r.PGID})`)
  const lat = Number(r.Lat), lng = Number(r.Long)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail(`no coordinates for ${r.PGID}`)
  const pop = Number(r.Population) || 0
  return {
    i, pgid: r.PGID, rop3: r.ROP3Code, name: r.DisplayName || r.Name, iso3: r.ISOAlpha3, country: r.CountryDisplayName || r.CountryName,
    lat, lng, pop, reached: band[0], evPct: band[1], believers: band[0] ? Math.round(pop * band[1] / 100) : 0,
    lang: (r.LanguageCode || '').trim(), langName: r.LanguageName || '', family: (r.LanguageFamily || '').trim(),
    ethne: r.ROP25Code, cluster: r.ROP2Code, clusterName: r.ROP2Name, bloc: r.ROP1Code, blocName: r.ROP1Name,
    religion: r.ReligionDisplayName || r.ReligionName || '', engaged: r.EngagementStatus === 'Engaged' ? 1 : 0,
    // what already exists in this group's language: the content a campaign could point to
    bible: avail(r.BibleAvailability), film: avail(r.JesusFilmAvailability), audio: avail(r.AudioResourceAvailability),
    radio: avail(r.RadioProgramAvailability),
    // IMB's GSEC (0-6), the one reachedness NUMBER: the prayer packet's description prints its level
    // sentence from it (library/packets/describeGroup, desc_gsec_<n>, 11 locales). Named as it reads it.
    imb_gsec: /^[0-6]$/.test(String(r.GSEC).trim()) ? Number(r.GSEC) : null,
  }
})

const reached = groups.filter((g) => g.reached)
const unreached = groups.filter((g) => !g.reached)
const index = (key) => {
  const m = new Map()
  for (const g of reached) { const k = key(g); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(g) }
  return m
}
const byLang = index((g) => g.lang)
const byCluster = index((g) => g.cluster)
const byFamilyBloc = index((g) => (g.family ? g.family + '|' + g.bloc : ''))

const R = Math.PI / 180
function km(a, b) {
  const dLat = (b.lat - a.lat) * R, dLng = (b.lng - a.lng) * R
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLng / 2) ** 2
  return Math.round(12742 * Math.asin(Math.sqrt(h)))
}
// Best first by a GRAVITY score: estimated believers, discounted by distance (halved at ~500 km). A
// large church far away and a small one next door are both real options; this weighs them the way a
// mobilizer would (audience size, but a shared region matters). `tier` puts a stronger kind of match
// first inside one E-level (E-2: same people cluster before same language family only).
const HALF_KM = 500
const score = (x) => x.g.believers / (1 + (x.km / HALF_KM) ** 2)
const rank = () => (a, b) => (a.tier - b.tier) || (score(b) - score(a))

const links = {}
const pCount = { 1: 0, 2: 0, 3: 0, none: 0 }
const used = new Set()
for (const u of unreached) {
  const seen = new Set()
  const pick = (level, cands, tierOf = () => 0) => {
    const out = []
    for (const g of cands || []) { if (seen.has(g.i) || g.i === u.i) continue; out.push({ g, km: km(u, g), tier: tierOf(g) }) }
    out.sort(rank())
    const kept = out.slice(0, KEEP[level])
    for (const x of kept) seen.add(x.g.i)
    return kept.map((x) => [x.g.i, level, x.km, x.g.ethne === u.ethne ? 1 : 0])
  }
  const e1 = u.lang ? pick(1, byLang.get(u.lang)) : []
  const e2 = pick(2, [...new Set([...(byCluster.get(u.cluster) || []), ...(u.family ? byFamilyBloc.get(u.family + '|' + u.bloc) || [] : [])])],
    (g) => (g.cluster === u.cluster ? 0 : 1))
  const near = []
  for (const g of reached) { if (seen.has(g.i)) continue; const d = km(u, g); if (d <= NEAR_KM || g.iso3 === u.iso3) near.push(g) }
  const e3 = pick(3, near)
  const all = [...e1, ...e2, ...e3]
  const p = e1.length ? 1 : e2.length ? 2 : e3.length ? 3 : 0
  pCount[p || 'none']++
  if (all.length) { links[u.i] = all; for (const l of all) used.add(l[0]) }
}
if (!Object.keys(links).length) fail('no unreached group has any reached neighbor (vacuous run)')

// BRIDGE LANGUAGES — the mass-media view. A language spoken both by reached groups (believers who can
// be mobilized in it) and by unreached groups (the people they would reach, at E-1). One campaign in
// that language, aimed where the believers are, mobilizes all of them at once. Ranked by the
// unreached population it can reach. Computed over EVERY reached speaker, not only the linked ones.
const bridges = []
for (const [lang, rs] of byLang) {
  const us = unreached.filter((u) => u.lang === lang)
  if (!us.length) continue
  const any = (k) => (rs.some((g) => g[k]) || us.some((g) => g[k]) ? 1 : 0)
  bridges.push({
    lang, rs, us,
    believers: rs.reduce((a, g) => a + g.believers, 0),
    unreachedPop: us.reduce((a, g) => a + g.pop, 0),
    res: [any('bible'), any('film'), any('audio'), any('radio')],
  })
}
bridges.sort((a, b) => (b.unreachedPop - a.unreachedPop) || (b.believers - a.believers))
for (const b of bridges) for (const g of b.rs) used.add(g.i)

// CENTERED-SET RINGS (brief §B). One ring per unreached group, plus the reached group that sets it, over
// EVERY reached group (links above keep only the top few per E-level, so they would miss rings 4-6).
// The rule lives in src/rings.js, so the chart and the packet place a group exactly as this build does.
const ringIdx = indexReached(reached)
const ringOfU = new Map()
for (const u of unreached) {
  const { ring, neighbor } = closestReached(u, ringIdx)
  if (!ring) continue
  ringOfU.set(u.i, [ring, neighbor.i])
  used.add(neighbor.i)
}
const ringCount = ringCounts(unreached, (u) => ringOfU.get(u.i)?.[0])

// slug = the DX people-group slug for this row (null when the group is not in DX's set). Joined on
// rop3 + ISO3, the key both sources carry. It lets a DX page (gospel's bounded/centered sets) join by
// the key its own rows hold, with no second file to fetch or keep in step.
const dxSlug = new Map()
for (const d of JSON.parse(readFileSync(DX_SNAPSHOT, 'utf8')).groups || []) {
  const k = d.rop3 + '|' + d.country
  if (dxSlug.has(k)) fail(`two DX slugs for rop3+country ${k} (${dxSlug.get(k)}, ${d.slug})`)
  dxSlug.set(k, d.slug)
}
// Every DX group ships too, reached or not, so a DX page never reads a reached group as "not in the table".
for (const g of groups) if (dxSlug.has(g.rop3 + '|' + g.iso3)) used.add(g.i)

// Ship only the groups a view can show: every unreached group, plus the reached groups some link or
// bridge uses.
const shipped = groups.filter((g) => !g.reached || used.has(g.i))
const newIdx = new Map(shipped.map((g, j) => [g.i, j]))
const COLS = ['pgid', 'name', 'iso3', 'country', 'lat', 'lng', 'pop', 'reached', 'evPct', 'believers', 'lang', 'langName',
  'family', 'ethne', 'cluster', 'clusterName', 'bloc', 'blocName', 'religion', 'engaged', 'bible', 'film', 'audio', 'radio',
  // rop3 + iso3 is the join key other plugins hold (DX groups: rop3 + country). ring = centered-set ring 1-10
  // (0 = REACHED, the centre; -1 = unreached with no relation, unplaced: never drawn as a ring); ringNb = the shipped row of the reached group that sets it (-1 = none).
  'rop3', 'ring', 'ringNb', 'slug', 'imb_gsec']
// Repeated strings are dictionary-encoded (the value in the row is an index into dict[col]); this
// halves the file. A reader decodes with dict[col][row[j]].
const DICT_COLS = ['iso3', 'country', 'lang', 'langName', 'family', 'cluster', 'clusterName', 'bloc', 'blocName', 'religion']
const dict = Object.fromEntries(DICT_COLS.map((c) => [c, []]))
const dictIdx = Object.fromEntries(DICT_COLS.map((c) => [c, new Map()]))
const enc = (c, v) => { const m = dictIdx[c]; if (!m.has(v)) { m.set(v, dict[c].length); dict[c].push(v) } return m.get(v) }
const rows = shipped.map((g) => COLS.map((c) => {
  if (c === 'slug') return dxSlug.get(g.rop3 + '|' + g.iso3) ?? null
  const rg = ringOfU.get(g.i)
  if (c === 'ring') return rg ? rg[0] : g.reached ? 0 : -1   // 0 = reached (the centre), -1 = unplaced
  if (c === 'ringNb') return rg ? newIdx.get(rg[1]) : -1
  const v = g[c]
  if (DICT_COLS.includes(c)) return enc(c, v)
  if (typeof v === 'boolean') return v ? 1 : 0
  if (c === 'lat' || c === 'lng') return Math.round(v * 100) / 100
  return v
}))
const outLinks = {}
for (const [ui, ls] of Object.entries(links)) outLinks[newIdx.get(+ui)] = ls.map(([ri, e, d, same]) => [newIdx.get(ri), e, d, same])

const outBridges = bridges.map((b) => ({
  lang: b.lang, believers: b.believers, unreachedPop: b.unreachedPop, res: b.res,
  reached: b.rs.map((g) => newIdx.get(g.i)), unreached: b.us.map((g) => newIdx.get(g.i)),
}))
const out = {
  meta: {
    title: 'Near neighbors: reached groups nearest to each unreached group, on the E-scale',
    grain: 'rows = one per people group x country (peoplegroups.org grain), columns in cols; dictionary columns hold an index into dict[col]. links[u] = [reachedRow, eLevel, km, samePeople] for unreached row u',
    framework: 'Ralph D. Winter\'s E-scale (E-1 same language and culture, E-2 near culture, E-3 distant culture) and P-scale, Lausanne 1974. Levels here are PROXIES from language code and the IMB people taxonomy, not field assessments.',
    rules: {
      reached: 'EvangelicalLevel >= 2% (IMB definition; GSEC 4-6)',
      e1: 'same LanguageCode (ISO 639-3); samePeople = same ROP25 ethne in another country',
      e2: 'different language, same ROP2 people cluster, or same LanguageFamily within the same ROP1 affinity bloc',
      e3: `none of the above, within ${NEAR_KM} km or in the same country`,
      p: 'P-level of an unreached group = the smallest E-level any reached neighbor reaches it at',
      rings: 'columns ring + ringNb on every row (ring 0 = reached, the centre; ring -1 = unreached with no relation, unplaced; ringNb -1 = none). 1-3 same LanguageCode, 4-6 same LanguageName root (text before the comma), 7-9 same LanguageFamily, each x culture same ROP25 / near ROP2 / different; 10 = same country or within 600 km. Closest = lowest ring, then believers / (1 + (km/500)^2). Rule: src/rings.js',
      kept: KEEP, rank: `inside one E-level: stronger match kind first (E-2: people cluster before language family), then estimated believers / (1 + (km/${HALF_KM})^2)`,
    },
    believersEst: 'Population x midpoint of the evangelical band: an order of magnitude for sizing an audience, not a count',
    bridgeRule: 'bridges = languages spoken by at least one reached AND one unreached group; reached/unreached = row indexes; res = [bible, film, audio, radio] available in that language for any of them; ranked by unreached population',
    counts: { bridges: bridges.length, groups: groups.length, reached: reached.length, unreached: unreached.length, shipped: shipped.length, unreachedWithNeighbors: Object.keys(links).length, pLevel: pCount, rings: ringCount },
    source: {
      name: 'peoplegroups.org — people_groups.csv (IMB)',
      url: 'https://peoplegroups.org/wp-content/uploads/people_groups.csv',
      attribution: 'People group data: peoplegroups.org',
    },
    generated_by: 'plugin-designs/upg-neighbor/scripts/build-near-neighbors.mjs',
  },
  cols: COLS,
  dict,
  rows,
  links: outLinks,
  bridges: outBridges,
}
writeFileSync(OUT, JSON.stringify(out) + '\n')
const bytes = Buffer.byteLength(JSON.stringify(out))
console.log(`build-near-neighbors: ${bridges.length} bridge languages · ${unreached.length} unreached · ${reached.length} reached · ${Object.keys(links).length} with neighbors · P-1 ${pCount[1]} · P-2 ${pCount[2]} · P-3 ${pCount[3]} · none ${pCount.none} · rings ${JSON.stringify(ringCount)} · ${shipped.length} rows shipped · ${(bytes / 1e6).toFixed(2)} MB`)
