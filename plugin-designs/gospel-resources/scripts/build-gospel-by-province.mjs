/**
 * build-gospel-by-province.mjs — gospel access BELOW the national border, for the two countries
 * that hold half the roster.
 *
 * WHY ONLY INDIA AND CHINA. 855 of Doxa's 2,107 groups are in India and 154 in China: 47.9% of
 * everything this map draws, rendered until now as two flat fills. A mobiliser choosing between
 * Bihar and Tamil Nadu got nothing from the map. No other country comes close — the third is
 * Sudan at 105 — so this is not the start of a worldwide ADM1 project, it is the two countries
 * where a national border is useless.
 *
 * ⚠ CHINA'S ADM1 FILE IS A SUBSET AND THAT TURNS OUT TO BE THE RIGHT SUBSET. It carries 12
 * provinces, not China's 31+ — Yunnan, Guizhou, Tibet, Sichuan, Xinjiang, Guangxi, Hainan,
 * Hunan, Qinghai, Gansu, Inner Mongolia, Heilongjiang. I expected that to lose groups and
 * measured instead: 152 of 154 Chinese groups fall inside them, and ALL TWELVE are used. The
 * file was cut to the provinces where the unreached peoples actually are.
 *
 * ⚠ AND THE ASSIGNMENT IS ONLY AS GOOD AS THE PIN. A group's province comes from a
 * point-in-polygon test on a coordinate that marks a PEOPLE group, not a settlement, and whose position
 * is approximate — 108 groups even share a coordinate with another group. Near a border that point can fall on
 * the wrong side. So every row carries `approximate: true`, the unassigned are COUNTED rather
 * than dropped, and no surface may present a province as a fact about a group.
 *   Measured: 9 of 855 Indian groups and 2 of 154 Chinese ones land outside every polygon.
 *   They are reported, not hidden.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/gospel-by-province.json')
const OUT_GROUPS = resolve(REPO, 'data/tables/gospel-by-province-groups.json')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
const BOUND = (f) => JSON.parse(readFileSync(resolve(REPO, 'public/dx-maps/assets/boundaries', f), 'utf8'))

const { tiers = {}, codes = {}, bridges = {}, bridgeCandidates = {}, sun } = T('people-group-pins.json')
const roster = T('doxa-people-groups.json').rows || []

/* Ray casting, with holes honoured: a point inside an inner ring is outside the polygon. */
const ringHas = (ring, x, y) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
const polyHas = (poly, x, y) => {
  if (!ringHas(poly[0], x, y)) return false
  for (let k = 1; k < poly.length; k++) if (ringHas(poly[k], x, y)) return false
  return true
}
const featHas = (f, x, y) => {
  const g = f.geometry
  if (!g) return false
  if (g.type === 'Polygon') return polyHas(g.coordinates, x, y)
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => polyHas(p, x, y))
  return false
}
/* A bbox pre-filter: without it this is 1,009 groups x 46 polygons of full ray casting. */
const bboxOf = (f) => {
  const m = [180, 90, -180, -90]
  const walk = (a) => {
    if (typeof a[0] === 'number') {
      m[0] = Math.min(m[0], a[0]); m[1] = Math.min(m[1], a[1])
      m[2] = Math.max(m[2], a[0]); m[3] = Math.max(m[3], a[1])
    } else a.forEach(walk)
  }
  walk(f.geometry.coordinates)
  return m
}

/* The same Deaf test the leaf and both builders use — three signals, never the sg flag alone. */
const isDeaf = (code, name) => {
  const c = codes[code]
  return (c && c.sg === 1) || /sign language/i.test((c && c.l) || '') || /\bDeaf\b/i.test(name || '')
}
const wayIn = (code, iso3, name) => {
  if (!code || !iso3) return ''
  if (isDeaf(code, name)) return sun ? 'SUN (signed)' : ''
  const b = bridges[`${code}|${iso3}`] || bridgeCandidates[`${code}|${iso3}`]
  return b ? b.l : ''
}

/* ═══ PRAYER, AT THE GRAIN A TEAM IS ACTUALLY SENT TO ═══════════════════════════════════════
 * The country sheet already ends in a prayer move. A country is not where anyone is sent — a state
 * is — so the province carries the same two numbers. The JOIN IS BY NAME+COUNTRY, not by language,
 * because you pray for a people in a place; that is doxa.life's own key and the one place in this
 * build where a name match is correct rather than forbidden.
 *
 * ⚠ THE DENOMINATOR IS THE GROUPS WITH A PRAYER PAGE, never the province. doxa.life publishes a
 * page for 1,723 of the roster, so "nobody praying" can only be said of groups that HAVE one, and
 * both numbers ship so no surface can quote the first without the second.
 */
let pray = {}
try { pray = T('pray-index.json').byKey || {} } catch { /* no index: the columns ship as null, never as zero */ }
const prayKey = (name, iso3) =>
  `${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(iso3 || '').toUpperCase()}`

/* ⚠ INDIA READS THE -full FILE, NOT gb-IND-ADM1.geojson. The unsuffixed file is the UPG-100
   list's own curated partition — 34 listId-tagged units — and this table was built on it for one
   build, which is why eleven groups had no province: they were standing in states the partition
   does not draw. gb-IND-ADM1-full.geojson is the complete ADM1 (36 states, geoBoundaries via
   DataMeet India, CC BY 2.5 IN). A partition of somebody else's list is not a country's states,
   even when the filename looks like it is. */
/* ⚠ THE WEB-SIZED GEOMETRY, BECAUSE THE MAP DRAWS THAT ONE. f728831d switched the interactive
   maps to the -web boundaries (232 KB against 1.84 MB, which matters on a leaf meant for thousands
   of embeds), and this builder kept reading the full-precision file — so the map would have drawn
   provinces from one outline while the table counted them from another. My own staged-assets gate
   caught it on the merge, which is what it was written for.
   Measured before following: same 36 states, same names, 0 groups move province, 0 dropped, and 2
   GAINED — Great Andamanese and the Sentinelese, whose points fell just outside the detailed island
   coastline, land inside Andaman and Nicobar on the simplified one. A coarser outline is not a
   worse answer here; it is a more forgiving one at the scale a coordinate is honest to. */
const COUNTRIES = [
  { iso3: 'IND', file: 'gb-IND-ADM1-full-web.geojson', country: 'India' },
  { iso3: 'CHN', file: 'gb-CHN-ADM1.geojson', country: 'China' },
]

/** Kilometres from a point to a feature's nearest outline vertex — enough for a 15 km tolerance,
    and deliberately not a full point-to-segment distance: at this scale the difference is smaller
    than the error in the coordinate being tested. */
const distanceKm = (x, y, f) => {
  const cos = Math.cos((y * Math.PI) / 180)
  let best = Infinity
  const walk = (a) => {
    if (typeof a[0] === 'number') {
      const d = Math.hypot((a[0] - x) * 111 * cos, (a[1] - y) * 111)
      if (d < best) best = d
      return
    }
    a.forEach(walk)
  }
  walk(f.geometry.coordinates)
  return best
}
const NEAR_KM = 15

const rows = []
const unassigned = []
const nearAssigned = []
const assignments = []
let provincesAvailable = 0
for (const c of COUNTRIES) {
  const feats = BOUND(c.file).features.map((f) => ({ f, b: bboxOf(f), name: f.properties.shapeName }))
  provincesAvailable += feats.length
  const groups = roster.filter((r) => r.iso3 === c.iso3 && r.mapped && r.lat != null && r.lng != null)
  const by = new Map()
  for (const r of groups) {
    const x = r.lng, y = r.lat
    let hit = null
    for (const cand of feats) {
      if (x < cand.b[0] || x > cand.b[2] || y < cand.b[1] || y > cand.b[3]) continue
      if (featHas(cand.f, x, y)) { hit = cand.name; break }
    }
    /* ═══ A BORDER PEOPLE'S ONE COORDINATE CAN LAND OUTSIDE ITS OWN COUNTRY ═══════════════════
     * Two groups fell in no province: Jing and Pana. The note here used to say they were "outside
     * the twelve-province subset", and that was WRONG — Guangxi and Yunnan are both in the file.
     * Measured: Jing sits 8.7 km outside Guangxi's outline and Pana 5.4 km outside Yunnan's, i.e.
     * across the border. Sourcing China's COMPLETE 34-unit ADM1 changes neither distance by a
     * metre (same source geometry, 22 more provinces, none of them theirs), so better data is not
     * the answer here and nobody needs to repeat that experiment.
     *
     * A single coordinate for a whole people is not precise to 9 km, and this table already says
     * every placement is approximate — so a point within 15 km of exactly ONE province joins it,
     * flagged per row and counted in meta. Ambiguous cases (two provinces within the tolerance)
     * stay unassigned: a near-miss is a hint, and a hint between two answers is not one. */
    if (!hit) {
      const near = []
      for (const cand of feats) {
        const d = distanceKm(x, y, cand.f)
        if (d <= NEAR_KM) near.push({ name: cand.name, d })
      }
      near.sort((a, b) => a.d - b.d)
      if (near.length === 1 || (near.length > 1 && near[1].d - near[0].d > 3)) {
        hit = near[0].name
        nearAssigned.push({ people_group: r.name, province: hit, km: Math.round(near[0].d * 10) / 10 })
        r._nearKm = Math.round(near[0].d * 10) / 10
      } else {
        unassigned.push({ country: c.country, iso3: c.iso3, people_group: r.name, lat: r.lat, lng: r.lng })
        continue
      }
    }
    /* THE PER-GROUP ROW, published beside the aggregate so no other build has to repeat this
       point-in-polygon. gospel-internet was running the identical ray-casting over the identical
       two geometry files and refusing to write unless its counts matched these; a second
       implementation of the same geometry is a second place for it to drift. */
    assignments.push({
      people_group: r.name,
      country: c.country,
      iso3: c.iso3,
      province: hit,
      iso639_3: r.iso639_3 || '',
      population: r.population || 0,
      tier: tiers[r.iso639_3] ?? r.tier ?? 0,
      approximate: true,
      /* Present ONLY on the rows the tolerance placed, so a consumer can tell a point inside a
         province from a point 9 km outside one. gospel-internet reads this file. */
      ...(r._nearKm ? { near_border_km: r._nearKm } : {}),
    })
    if (!by.has(hit)) by.set(hit, [])
    by.get(hit).push(r)
  }
  for (const [province, list] of by) {
    const zero = list.filter((r) => (tiers[r.iso639_3] ?? r.tier ?? 0) === 0)
    /* ═══ A WAY IN CHOSEN FOR THIS PROVINCE, NOT FOR THE COUNTRY ══════════════════════════
     * The caveat this table used to carry said it plainly: Arunachal Pradesh, in the far
     * north-east, was offered TELUGU — a South Indian language — because the curated bridge
     * table is keyed by country and a curated bridge outranks a computed one. India's computed
     * default is Hindi, defensible nationally and wrong for much of the north-east.
     *
     * So the province answers for itself. The candidates are the languages of groups STANDING
     * IN THIS PROVINCE that already have Scripture AND film (tier 2), ranked by how many people
     * here already hold them. That is a measured neighbour, not a national average: a language
     * with 4 million people in this state is a plausible second language for its neighbours in a
     * way that a language from 1,500 km away is not.
     *
     * It never invents one. A province with no tier-2 language of its own keeps the country-level
     * answer and SAYS so, because "no local bridge exists" is itself worth reading.
     */
    const localTier2 = new Map()
    for (const r of list) {
      const code = r.iso639_3
      if (!code || (tiers[code] ?? r.tier ?? 0) !== 2) continue
      if (isDeaf(code, r.name)) continue
      const cur = localTier2.get(code) || { code, language: (codes[code] && codes[code].l) || code, people: 0, groups: 0 }
      cur.people += r.population || 0
      cur.groups += 1
      localTier2.set(code, cur)
    }
    const local = [...localTier2.values()].sort((a, b) => b.people - a.people).slice(0, 3)

    /* Counted over the groups in THIS province that have a prayer page. */
    let prayPages = 0, noPray = 0, noPrayPeople = 0
    let move = null, moveRank = -1
    for (const r of list) {
      const e = pray[prayKey(r.name, r.iso3)]
      if (!e) continue
      prayPages++
      if (e.praying > 0) continue
      noPray++
      noPrayPeople += r.population || 0
      /* THE MOVE: need first, then size — the same order the country sheet uses, so a reader
         drilling from country to province is not handed two different rankings. */
      const rank = ((tiers[r.iso639_3] ?? r.tier ?? 0) === 0 ? 1e12 : 0) + (r.population || 0)
      if (rank > moveRank) {
        moveRank = rank
        move = { name: e.n || r.name, url: e.u, people: r.population || 0, has_nothing: (tiers[r.iso639_3] ?? r.tier ?? 0) === 0 }
      }
    }
    rows.push({
      country: c.country,
      iso3: c.iso3,
      province,
      groups: list.length,
      people: list.reduce((n, r) => n + (r.population || 0), 0),
      zero_access_groups: zero.length,
      zero_access_people: zero.reduce((n, r) => n + (r.population || 0), 0),
      /* Named so a reader of the CSV can act without opening the map. */
      zero_access_examples: zero.sort((a, b) => (b.population || 0) - (a.population || 0))
        .slice(0, 3).map((r) => r.name).join('; '),
      prayer_pages: prayPages,
      /* The URL comes from the prayer index, which took it from doxa.life's OWN listing (a slug is
         never constructed here: pray.doxa.life answers 200 for anything). */
      pray_first: move,
      nobody_praying_groups: noPray,
      nobody_praying_people: noPrayPeople,
      ways_in: local.length
        ? local.map((l) => `${l.language} (${l.people.toLocaleString('en-US')} here)`).join('; ')
        : [...new Set(zero.map((r) => wayIn(r.iso639_3, r.iso3, r.name)).filter(Boolean))].join('; '),
      /* WHICH QUESTION THE WAY IN ANSWERED. Without this column the two kinds of answer are
         indistinguishable on the page, and a country-level answer read as a local one is exactly
         how Telugu ends up looking like advice about Arunachal Pradesh. */
      ways_in_basis: local.length ? 'in this province' : 'country-level — no local language here has both Scripture and film',
      ways_in_country: [...new Set(zero.map((r) => wayIn(r.iso639_3, r.iso3, r.name)).filter(Boolean))].join('; '),
      approximate: true,
    })
  }
}
rows.sort((a, b) => b.zero_access_groups - a.zero_access_groups || b.groups - a.groups)

const assigned = rows.reduce((n, r) => n + r.groups, 0)
if (!assigned || assigned < 900) {
  console.error(`GOSPEL-BY-PROVINCE: REFUSING TO WRITE — only ${assigned} group(s) assigned.`)
  console.error('  India and China hold 1,009 mapped groups; a collapse this large means the')
  console.error('  geometry or the coordinates changed shape, not that the answer moved.')
  process.exitCode = 1
} else {
  /* ═══ THE TWO FILES MUST AGREE, ASSERTED HERE ════════════════════════════════════════════
   * The aggregate says a province holds N groups; the per-group file lists them. Published
   * separately (the map fetches only the aggregate, lazily, and has no use for 1,005 rows), which
   * means they CAN disagree — so they are reconciled before either is written. gospel-internet
   * built its own copy of this point-in-polygon and refused to write unless its counts matched
   * ours; it should not have to, and it should not have to trust us either.
   */
  const perProvince = new Map()
  for (const a of assignments) perProvince.set(`${a.iso3}|${a.province}`, (perProvince.get(`${a.iso3}|${a.province}`) || 0) + 1)
  const disagree = rows.filter((r) => (perProvince.get(`${r.iso3}|${r.province}`) || 0) !== r.groups)
  if (disagree.length || assignments.length !== assigned) {
    console.error(`GOSPEL-BY-PROVINCE: REFUSING TO WRITE — the per-group file and the aggregate disagree on ${disagree.length} province(s); ${assignments.length} assignments vs ${assigned} counted.`)
    process.exit(1)
  }
  writeSnapshot(
    OUT_GROUPS,
    `${JSON.stringify({
      meta: {
        title: 'Which province each people group falls in — India and China',
        why: 'Published so no other build has to repeat this point-in-polygon. gospel-internet ran ' +
          'the identical ray-casting over the identical geometry and could only check itself against ' +
          'our aggregates; a second implementation of the same geometry is a second place for it to drift.',
        generated: new Date().toISOString().slice(0, 10),
        grain: 'one row per PLACED people group; the four that fall outside every polygon are in the aggregate file\'s `unassigned`',
        rows: assignments.length,
        agrees_with: 'gospel-by-province.json — per-province counts and the assigned total are reconciled at build time, and neither file is written if they differ',
        approximate: 'Every row is approximate. The coordinate marks a PEOPLE group, not a ' +
          'settlement; its position is approximate, and near a border it can fall on the wrong side. No surface may present a ' +
          'province as a fact about a group.',
      },
      columns: [
        { title: 'People group', field: 'people_group', type: 'string' },
        { title: 'Country', field: 'country', type: 'string' },
        { title: 'Province', field: 'province', type: 'string' },
        { title: 'Language code', field: 'iso639_3', type: 'string' },
        { title: 'People', field: 'population', type: 'number' },
        { title: 'Tier', field: 'tier', type: 'number' },
      ],
      rows: assignments,
    }, null, 1)}\n`,
    (j) => (j.rows || []).length,
    'province assignment(s)',
  )
  writeSnapshot(
    OUT,
    `${JSON.stringify({
      meta: {
        title: 'Gospel access by province — India and China',
        why: 'These two countries hold 47.9% of Doxa\'s roster (855 + 154 of 2,107). No other ' +
          'country is close; the third is Sudan at 105. A national fill cannot answer "where would ' +
          'a team go" for half the map.',
        generated: new Date().toISOString().slice(0, 10),
        provinces_with_groups: rows.length,
        provinces_available: provincesAvailable,
        groups_assigned: assigned,
        groups_unassigned: unassigned.length,
        per_group_file: 'gospel-by-province-groups.json — one row per placed group, reconciled with these counts at build time',
        india_note: 'India is read from the COMPLETE ADM1 (36 states, geoBoundaries via DataMeet ' +
          'India, CC BY 2.5 IN). The first build of this table read gb-IND-ADM1.geojson, which is ' +
          'the UPG-100 list\'s curated 34-unit partition, and eleven groups came out with no ' +
          'province because they stood in states that partition does not draw. Switching the file ' +
          'moved 998 assigned to 1,005 and 44 province rows to 46, and turned the province names ' +
          'into India\'s own states.',
        groups_placed_by_nearest_province: nearAssigned.length,
        near_border_note: 'NONE unassigned now, and two rows say why. Jing and Pana fell in no ' +
          'province: measured 8.7 km outside Guangxi and 5.4 km outside Yunnan — across the border, ' +
          'not outside the file, which is what an earlier version of this note wrongly said (both ' +
          'provinces are in it). Sourcing China\'s complete 34-unit ADM1 moved neither distance: same ' +
          'source geometry, 22 more provinces, none of them theirs — so better data is not the answer ' +
          'and nobody need repeat it. A point within 15 km of exactly ONE province now joins it and ' +
          'carries near_border_km; two provinces within the tolerance leave it unassigned, because a ' +
          'hint between two answers is not one. A single coordinate for a whole people is not precise ' +
          'to 9 km, which is why this is a correction and not a guess.',
        china_note: 'China\'s ADM1 file carries 12 provinces, not 31+. Measured rather than ' +
          'assumed: 152 of 154 Chinese groups fall inside them and all twelve are used, so the ' +
          'file is cut to the provinces where the unreached peoples are.',
        ways_in: 'Chosen FOR THE PROVINCE where the province can answer: the languages of groups ' +
          'standing in it that already have Scripture AND film, ranked by the people here who ' +
          'already hold them. The column says which basis was used. This replaces a country-level ' +
          'answer that produced a measured absurdity — Arunachal Pradesh, in the far north-east, ' +
          'was offered TELUGU, because the curated bridge table is keyed by country and a curated ' +
          'bridge outranks a computed one. A province with no tier-2 language of its own still ' +
          'falls back to the country answer, and ways_in_basis says so rather than hiding it. ' +
          'It is a NEIGHBOUR, not a recommendation: whether a group actually speaks it is a ' +
          'question for someone on the ground.',
        approximate: 'A province is assigned by point-in-polygon on the group\'s coordinate, and ' +
          'that coordinate marks a PEOPLE group, not a settlement; its position is approximate, and 108 ' +
          'groups across the roster even share a coordinate with another group. Near a border the point can fall on ' +
          'the wrong side. Every row is flagged approximate and the unassigned are counted, never ' +
          'dropped. No surface may present a province as a fact about a group.',
      },
      columns: [
        { title: 'Country', field: 'country', type: 'string' },
        { title: 'Province', field: 'province', type: 'string' },
        { title: 'People groups', field: 'groups', type: 'number' },
        { title: 'People', field: 'people', type: 'number' },
        { title: 'Groups with nothing', field: 'zero_access_groups', type: 'number' },
        { title: 'People with nothing', field: 'zero_access_people', type: 'number' },
        { title: 'Largest with nothing', field: 'zero_access_examples', type: 'string' },
        { title: 'Nobody praying', field: 'nobody_praying_groups', type: 'number' },
        { title: 'Of those with a prayer page', field: 'prayer_pages', type: 'number' },
        { title: 'People nobody is praying for', field: 'nobody_praying_people', type: 'number' },
        { title: 'Ways in', field: 'ways_in', type: 'string' },
        { title: 'Basis', field: 'ways_in_basis', type: 'string' },
        { title: 'Ways in (country-level)', field: 'ways_in_country', type: 'string' },
        { title: 'Placement approximate', field: 'approximate', type: 'string' },
      ],
      rows,
      unassigned,
    }, null, 1)}\n`,
    (j) => (j.rows || []).length,
    'province row(s)',
  )
  console.log(`gospel-by-province: ${rows.length} province(s) with groups, ${assigned} assigned, ${unassigned.length} unassigned`)
  console.log(`  zero-access provinces: ${rows.filter((r) => r.zero_access_groups).length}`)
  console.log(`wrote ${OUT}`)
}
