#!/usr/bin/env node
/**
 * build-gospel-internet.mjs — the Gospel x Internet board's ONE table: one row per people group,
 * joining what the gospel sources hold for that group's language to how much of its country (or
 * Indian state) is online.
 *
 * No new source. Every column is read from a table another owner already builds:
 *   data/tables/doxa-gospel-access.json                    access ladder, resources, ways in
 *   data/tables/doxa-people-groups.json                    slug, lat/lng, pray link
 *   data/tables/country-connectivity.json  (World Bank)     internet %, year, mobile per 100
 *   data/tables/internet-by-country.json   (cities-internet) top platform
 *   data/tables/internet-by-adm1.json      (cities-internet) India by state, NFHS-5
 *   data/tables/messaging-channels.json    (cities-internet) top free apps per country (Apple, iOS only)
 *   data/tables/social-platforms.json      (cities-internet) social referral share per country (StatCounter)
 *   data/tables/gospel-by-province-groups.json each IND/CHN group's province (approximate)
 *   data/tables/gospel-by-province.json                    the aggregates that per-group file must sum to
 *
 * ★ IT FAILS, IT NEVER DROPS. Every join is counted, and the build exits non-zero if the output has
 * fewer rows than the access table, if a key is duplicated, or if a group's country has no
 * connectivity row. A board that quietly lost 40 groups would say "nothing here" about real people.
 *
 * ★ THE PROVINCE IS READ, NEVER RE-DERIVED. The Gospel Resources build publishes each placed group's province
 * (gospel-by-province-groups.json, reconciled with its aggregates before either is written). This build
 * keeps ONE cheap assertion, the one recommended: sum(aggregate groups) == per-group rows,
 * which catches a stale copy of one file beside a fresh copy of the other. Every IND/CHN group must be
 * either placed there or listed in the aggregate's `unassigned`, so none is silently province-less.
 * (It replaces this builder's own point-in-polygon, which agreed with theirs group for group.)
 *
 * ★ WHAT IS NEVER READ: doxa-people-groups.rows.engagement, or anything that says who works where
 * (see ../README.md, "Honesty"). Nothing from plugin-designs/key-cities/.
 *
 * Codes, not labels, cross into the plugin: access_level own|bridge|zero, access_detail
 * read_watch|hear|read|stories|none, internet_band yes|partial|no|nodata. The plugin translates.
 *
 * Usage: node plugin-designs/gospel-internet/scripts/build-gospel-internet.mjs [--check]
 *   --check  build in memory and compare with the committed file; exit 1 if it would change.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
const OUTS = [
  resolve(REPO, 'data/tables/gospel-internet.json'),
  resolve(REPO, 'public/dx-maps/assets/tables/gospel-internet.json'),
]
const CHECK = process.argv.includes('--check')

const failures = []
const fail = (m) => failures.push(m)

const access = T('doxa-gospel-access.json')
const roster = T('doxa-people-groups.json')
const conn = T('country-connectivity.json')
const ibc = T('internet-by-country.json')
const adm1 = T('internet-by-adm1.json')
const byProvince = T('gospel-by-province.json')
const byGroup = T('gospel-by-province-groups.json')
// The language tree's source, credited on the board like every other (CC BY 4.0 requires it)
const glotto = JSON.parse(readFileSync(resolve(REPO, 'data/glottolog/glottolog-subset.json'), 'utf8'))
const msg = T('messaging-channels.json')
const social = T('social-platforms.json')

// ── join 1: access <-> roster on name + iso3 (the key the spec measured at 2,107 / 2,107) ──────────
const key = (name, iso3) => `${name}|${iso3}`
const rosterBy = new Map()
for (const r of roster.rows) {
  const k = key(r.name, r.iso3)
  if (rosterBy.has(k)) fail(`roster key duplicated: ${k}`)
  rosterBy.set(k, r)
}

// ── join 2/3: country connectivity + top platform, by iso3 ─────────────────────────────────────────
const connBy = new Map(conn.rows.map((r) => [r.iso3, r]))
const ibcBy = new Map(ibc.countries.map((r) => [r.iso3, r]))

// The band rule, read from the table's own `banding` text rather than retyped: yes >=60, partial 25-59,
// no <25. A null figure is its own band, never folded into "no".
const band = (pct) => (pct == null || !Number.isFinite(Number(pct))) ? 'nodata' : pct >= 60 ? 'yes' : pct >= 25 ? 'partial' : 'no'
const bandingText = conn.rows.find((r) => r.banding)?.banding || ''
if (!/60/.test(bandingText) || !/25/.test(bandingText)) fail(`country-connectivity banding text no longer names the 60/25 cut-offs: "${bandingText}"`)

// ── join 4: India state internet (NFHS-5), women and men kept apart, never averaged ────────────────
const adm1By = new Map()
for (const r of adm1.rows) {
  if (r.measure !== 'ever_used_internet' || r.area !== 'total' || !r.adm1) continue
  const k = `${r.iso3}|${r.adm1}`
  const a = adm1By.get(k) || { year: r.year, source: r.source }
  a[r.sex] = r.value
  adm1By.set(k, a)
}

// ── province: the per-group assignment, keyed like join 1 (name + iso3) ─────────────────
const PROVINCE_COUNTRIES = new Set(['IND', 'CHN'])
const provinceBy = new Map()
for (const g of byGroup.rows || []) {
  const k = key(g.people_group, g.iso3)
  if (provinceBy.has(k)) fail(`gospel-by-province-groups key duplicated: ${k}`)
  provinceBy.set(k, g.province)
}
const aggSum = (byProvince.rows || []).reduce((n, p) => n + (p.groups || 0), 0)
if (aggSum !== provinceBy.size) fail(`gospel-by-province sums to ${aggSum} groups but gospel-by-province-groups has ${provinceBy.size}: one file is stale`)
const unassignedKeys = new Set((byProvince.unassigned || []).map((u) => key(u.people_group, u.iso3)))

// ── how many groups share each coordinate (the honest pin notice counts them) ──────────────────────
const coordCount = new Map()
for (const r of roster.rows) if (r.lat != null && r.lng != null) {
  const k = `${r.lat},${r.lng}`
  coordCount.set(k, (coordCount.get(k) || 0) + 1)
}

// ── platforms, per country (the Platforms view). Each source's caveats travel with it, verbatim. ─────
// Messaging: Apple's top-free feed is iOS ONLY and a RANK of downloads, not use; `kind` is a name
// heuristic. Social: StatCounter referral share CANNOT SEE messaging apps. Neither is ever blended.
const platformsBy = {}
const pf = (iso3) => (platformsBy[iso3] ||= { messaging: [], top_messaging: '', in_app_feed: false, social: [], social_month: '' })
for (const r of msg.rows) {
  const c = pf(r.iso3)
  c.in_app_feed = true
  if (r.kind === 'messaging') c.messaging.push({ app: r.app, rank: r.rank })
  if (r.is_top_messaging) c.top_messaging = r.app
}
for (const r of social.rows) {
  const c = pf(r.iso3)
  c.social.push({ platform: r.platform, pct: r.share_pct })
  if (r.month) c.social_month = r.month
}
for (const c of Object.values(platformsBy)) {
  c.messaging = c.messaging.sort((a, b) => a.rank - b.rank).slice(0, 3)
  c.social = c.social.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 3)
}

const DETAIL = { 'read and watch': 'read_watch', 'watch or hear, cannot read': 'hear', 'read': 'read', 'stories only': 'stories', 'nothing found': 'none' }

const rows = []
const seenSlug = new Set()
let noRoster = 0, noConn = 0
for (const a of access.rows) {
  const r = rosterBy.get(key(a.people_group, a.iso3))
  if (!r) { noRoster++; fail(`no roster row for ${a.people_group} (${a.iso3})`); continue }
  if (seenSlug.has(r.slug)) fail(`slug duplicated: ${r.slug}`)
  seenSlug.add(r.slug)
  const c = connBy.get(a.iso3)
  if (!c) { noConn++; fail(`no country-connectivity row for ${a.iso3}`) }
  const p = ibcBy.get(a.iso3)
  const detail = DETAIL[a.access]
  if (!detail) fail(`unknown access value "${a.access}" (${a.people_group})`)
  const wayIn = a.bridge_language ? 'bridge' : a.bridge_candidate ? 'candidate' : a.deaf_bridge ? 'deaf' : ''
  const level = detail !== 'none' ? 'own' : wayIn ? 'bridge' : 'zero'
  const kinds = [
    a.scripture_url && 'scripture', a.film_url && 'film', (a.audio_url || a.gospel_audio_url) && 'audio',
    a.bible_video_url && 'video', a.stories_url && 'stories',
  ].filter(Boolean)
  const province = PROVINCE_COUNTRIES.has(a.iso3) ? (provinceBy.get(key(a.people_group, a.iso3)) || '') : ''
  if (PROVINCE_COUNTRIES.has(a.iso3) && !province && !unassignedKeys.has(key(a.people_group, a.iso3))) {
    fail(`${a.people_group} (${a.iso3}) is neither placed in a province nor listed as unassigned`)
  }
  const st = province && a.iso3 === 'IND' ? adm1By.get(`IND|${province}`) : null
  rows.push({
    slug: r.slug,
    people_group: a.people_group,
    country: a.country,
    iso3: a.iso3,
    region: a.region || '',
    province,
    language: a.language,
    iso639_3: a.iso639_3,
    population: a.population,
    religion: a.religion,
    access_level: level,
    access_detail: detail || '',
    resource_kinds: kinds.join('|'),
    scripture: a.scripture,
    translated_by: a.translated_by,
    scripture_url: a.scripture_url, film_url: a.film_url, audio_url: a.audio_url,
    bible_video_url: a.bible_video_url, stories_url: a.stories_url, gospel_audio_url: a.gospel_audio_url,
    training_url: a.training_url,
    way_in: wayIn,
    bridge_language: a.bridge_language, bridge_iso639_3: a.bridge_iso639_3, bridge_strength: a.bridge_strength,
    bridge_has_scripture: !!a.bridge_has_scripture, bridge_has_film: !!a.bridge_has_film,
    bridge_candidate: a.bridge_candidate, bridge_candidate_iso: a.bridge_candidate_iso,
    bridge_candidate_pct_of_country: a.bridge_candidate_pct_of_country ?? null,
    bridge_training_url: a.bridge_training_url,
    deaf_bridge: a.deaf_bridge, deaf_bridge_url: a.deaf_bridge_url, deaf_bridge_publisher: a.deaf_bridge_publisher,
    internet_pct: c?.internet_pct ?? null,
    internet_year: c?.internet_year || '',
    internet_band: band(c?.internet_pct),
    mobile_per_100: c?.mobile_per_100 ?? null,
    mobile_year: c?.mobile_year || '',
    top_platform: p?.top_platform || '',
    top_platform_pct: p?.top_platform_pct ?? null,
    top_messaging_app: platformsBy[a.iso3]?.top_messaging || '',
    state_internet_women: st?.women ?? null,
    state_internet_men: st?.men ?? null,
    state_internet_year: st?.year || '',
    lat: Number(r.lat), lng: Number(r.lng),
    shares_point: Math.max(0, (coordCount.get(`${r.lat},${r.lng}`) || 1) - 1),
    pray_url: a.pray_url || r.pray_url || '',
    people_praying: a.people_praying ?? r.people_praying ?? null,
  })
}

// ── coverage: every group in, and the province placement agrees with gospel-by-province ────────────
if (rows.length !== access.rows.length) fail(`rows ${rows.length} != access rows ${access.rows.length}`)
const unplaced = rows.filter((r) => PROVINCE_COUNTRIES.has(r.iso3) && !r.province)
if (rows.filter((r) => r.province).length !== provinceBy.size) fail(`placed ${rows.filter((r) => r.province).length} groups but gospel-by-province-groups has ${provinceBy.size}`)

const count = (f) => rows.reduce((m, r) => { m[r[f]] = (m[r[f]] || 0) + 1; return m }, {})
const zeroOwn = rows.filter((r) => r.access_detail === 'none')
const coverage = {
  groups: rows.length,
  joined_roster: rows.length - noRoster,
  with_connectivity_row: rows.length - noConn,
  by_access_level: count('access_level'),
  by_access_detail: count('access_detail'),
  by_internet_band: count('internet_band'),
  nothing_in_own_language_by_band: zeroOwn.reduce((m, r) => { m[r.internet_band] = (m[r.internet_band] || 0) + 1; return m }, {}),
  with_province: rows.filter((r) => r.province).length,
  ind_chn_without_province: unplaced.length,
  on_a_shared_point: rows.filter((r) => r.shares_point > 0).length,
}

if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error('FAIL ' + f)
  console.error(`FAIL build-gospel-internet: ${failures.length} problem(s); nothing written`)
  process.exitCode = 1
} else {
  const doc = {
    meta: {
      title: 'Gospel x Internet — what exists in each people group\'s language, and how much of their country is online',
      grain: 'one row per people group on DOXA\'s roster',
      generated_by: 'plugin-designs/gospel-internet/scripts/build-gospel-internet.mjs',
      inputs_generated: {
        'doxa-gospel-access': access.meta?.generated || '', 'doxa-people-groups': roster.generated || '',
        'country-connectivity': conn.meta?.source?.accessed || '', 'internet-by-country': ibc.stats?.generated || '',
        'gospel-by-province': byProvince.meta?.generated || '', 'gospel-by-province-groups': byGroup.meta?.generated || '',
      },
      coverage,
      band_rule: bandingText,
      internet_note: 'internet_pct is the COUNTRY\'s figure (World Bank), never the group\'s. state_internet_* is India\'s state figure from NFHS-5 (2019-21): the share of women and of men aged 15-49 who have EVER used the internet, kept apart, never averaged, never on a scale with subscriptions per 100.',
      province_note: 'province is read from gospel-by-province-groups.json: placed by point-in-polygon on the group\'s coordinate, which marks a PEOPLE group, not a town. It is approximate, and near a border it can fall on the wrong side; it is never a fact about connectivity in that state.',
      access_note: 'access_detail says what exists in the group\'s OWN language in the sources checked; "none" means nothing was found there, never that nothing exists. access_level: own = something in their language; bridge = nothing in their language but a bridge, candidate or Deaf way in; zero = neither.',
      platforms: {
        messaging_source: msg.meta?.source?.name || '', messaging_accessed: msg.meta?.source?.accessed || '',
        ios_caveat: msg.meta?.ios_caveat || '', ranking_caveat: msg.meta?.ranking_caveat || '', classification_caveat: msg.meta?.classification_caveat || '',
        social_source: social.meta?.source?.name || '', social_accessed: social.meta?.source?.accessed || '',
        social_measures: social.meta?.measures || '', social_caveat: social.meta?.critical_caveat || '',
      },
      never_read: 'engagement, workers, teams, agencies: who works where is not shown (a safety default, pending a product decision).',
      // Rows omit empty fields ('' / null / false / a zero shares_point) to keep the fetch small for
      // partner embeds (2.65 MB -> 1.76 MB); `columns` is the full schema, so an absent key means
      // "empty", never "unknown column". A reader fills the default; it never guesses a value.
      columns: Object.keys(rows[0] || {}),
      sources: [
        'DOXA (pray.doxa.life)',
        access.meta?.source || '',
        'World Bank Open Data (CC BY 4.0)',
        adm1.meta?.sources?.nfhs5?.attribution || '',
        'geoBoundaries (CC BY 2.5 IN for India)',
        msg.meta?.source?.name || '', social.meta?.source?.name || '',
        glotto.source ? `${glotto.source.replace(/ as CLDF$/, '').replace(/^glottolog\/glottolog: /, '')} (CC BY 4.0), language tree` : '',
      ].filter(Boolean),
    },
    // One entry per country in the rows: the Platforms view reads it; rows carry only the top app.
    countries: Object.fromEntries([...new Set(rows.map((r) => r.iso3))].sort().filter((i) => platformsBy[i]).map((i) => [i, platformsBy[i]])),
    rows: rows.map((r) => Object.fromEntries(Object.entries(r)
      .filter(([k, v]) => v !== '' && v !== null && v !== false && !(k === 'shares_point' && v === 0)))),
  }
  const body = JSON.stringify(doc) + '\n'
  if (CHECK) {
    let same = true
    for (const o of OUTS) { try { if (readFileSync(o, 'utf8') !== body) same = false } catch { same = false } }
    console.log(same ? 'ok gospel-internet.json is current' : 'FAIL gospel-internet.json is stale: re-run the builder')
    if (!same) process.exitCode = 1
  } else {
    for (const o of OUTS) writeFileSync(o, body)
    console.log(`ok wrote gospel-internet.json: ${rows.length} rows`)
  }
  console.log(JSON.stringify(coverage, null, 1))
}
