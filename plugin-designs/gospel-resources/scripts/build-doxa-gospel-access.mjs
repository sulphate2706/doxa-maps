/**
 * build-doxa-gospel-access.mjs — the table this whole map is for.
 *
 * ═══ THE QUESTION THIS MAP ANSWERS ════════════════════════════════════════════════
 * Which of the Doxa people groups have resources and which do not is the key question
 * the map has to answer. And the deliverable is not a picture: it must export, hand
 * it to a team, and turn it into QR codes, pamphlets and posters on the noticeboards of the
 * key towns. So this is ONE ROW PER DOXA PEOPLE GROUP, every resource it has, every URL
 * openable, and an access status a person can sort on.
 *
 * ═══ WHY IT IS NOT THE LINKS TABLE ══════════════════════════════════════════════════════
 * gospel-resource-links is keyed by RESOURCE across 4,231 languages — what exists, anywhere.
 * This is keyed by the PEOPLE GROUP Doxa actually carries, and it is scoped to their 2,107.
 * A mobiliser working Doxa's list cannot use a table that is 80% other people's groups, and
 * a team planning a translation cannot use a table that hides the ones with nothing.
 *
 * ═══ THE ACCESS LADDER, AND WHY IT IS NOT A SCORE ═══════════════════════════════════════
 * Every rung says what a person can DO, because that is what decides what you send:
 *   read and watch   text Scripture AND film in their own language
 *   read             text, no film
 *   watch or hear    film, audio, Bible video or Words of Life — but NO text
 *   stories only     Bible stories or a gospel presentation, no Scripture and no film
 *   nothing found    no pool this build can reach holds anything
 * "Watch or hear, cannot read" is called out because it is the translation brief: those
 * groups can already receive the gospel and cannot yet study it, and the first believers
 * among them cannot be trained from a text that does not exist.
 *
 * NOT PLACED IS NOT ABSENT. 285 of the roster have no coordinates in this build, so they
 * are invisible on the map. They are IN this table, with placed:false, because the roster is
 * Doxa's and a list that quietly loses 14% of it would be its own kind of lie.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resourceRows } from '../gospel-resource-rows.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
const credits = (() => {
  try { return T('translation-credits.json').byCode || {} } catch { return {} }
})()

/**
 * ═══ THE ONE BRIDGE A DEAF COMMUNITY CAN ACTUALLY CROSS ═══════════════════════════════════
 *
 * The block below refuses to offer a Deaf group a spoken bridge, and that refusal is right.
 * But it left 93 groups and 17.5 million people as the only population on this map with
 * nothing AND no way in — the largest untouched number in the dataset, and untouched for a
 * structural reason rather than an unlucky one.
 *
 * SUN is the answer that fits the shape of the problem: a signed language built to be learnt
 * across sign languages, with Scripture in it. It is a bridge in exactly the sense the spoken
 * ones are — it has to be learnt, and it is no substitute for Scripture in a group's own sign
 * language — so it is carried in its own columns and never folded into `access`, which stays
 * the honest "nothing found in their language".
 */
const sun = (() => {
  try { return T('sun-deaf-index.json') } catch { return null }
})()
/** The Zume course in whichever bridge this row is actually offered — curated first, then the
 *  computed candidate, mirroring the order the sheet shows them in. */
const bridgeTrainingUrl = (g, br, cand) => {
  const b = br || cand
  if (!b || !b.c) return ''
  /* `codes` is destructured below; this helper only runs inside the row map, which is after
     that, so the reference resolves. */
  const c = codes[b.c]
  return (c && c.z) || ''
}

const sunScripture = sun ? (sun.resources.find((r) => r.key === 'new_testament') || sun.resources[0]) : null
/* Countries where SUN is already being taught, and by whom. A named local Deaf church is the
   difference between "this resource exists" and "here is who to call". */
const sunOrg = {}
const normCountry = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '')
for (const p of (sun?.projects || [])) sunOrg[normCountry(p.country)] = p.organisation

const doxa = T('doxa-people-groups.json')
const { codes, bridges, bridgeCandidates } = T('people-group-pins.json')

/* The candidate is computed ONCE, in build-people-group-pins.mjs beside the curated bridge,
   and read here. It used to be computed in this file, which meant the table could offer a
   group a next step the map did not show — the same disagreement the tier rule exists to
   prevent. One source, two surfaces. */

const TYPE_ORDER = ['Scripture', 'Film', 'Audio Scripture', 'Bible video', 'Bible Stories', 'Gospel presentation', 'Gospel audio', 'Discipleship training']
const first = (rows, type) => rows.find((r) => r.type === type) || null

const rows = doxa.rows.map((g) => {
  const c = g.iso639_3 ? codes[g.iso639_3] : null
  const res = c ? resourceRows(c) : []
  const byType = {}
  for (const t of TYPE_ORDER) byType[t] = res.filter((r) => r.type === t)

  const hasText = byType.Scripture.length > 0
  const hasFilm = byType.Film.length > 0
  /* A Scripture row whose scope names audio is hearable too — that is the same FCBH record, now
     typed by its text because text is what "can read" turns on. Without this clause, fixing the
     type would have moved a group from "cannot read" to "read" and quietly dropped "can hear". */
  const audioScripture = byType['Audio Scripture'].length > 0 || byType.Scripture.some((r) => /audio/i.test(r.scope || ''))
  const canHear = audioScripture || byType['Bible video'].length > 0 || byType['Gospel audio'].length > 0 || hasFilm
  const hasStories = byType['Bible Stories'].length > 0 || byType['Gospel presentation'].length > 0

  /* NO LANGUAGE CODE IS NOT "NOTHING FOUND". The first run of this table collapsed the two
     and reported 566 groups with nothing, when 281 had been searched and come back empty and
     285 had never been searchable at all — no ISO 639-3, so there is no key to look them up
     by in any pool. Reporting those as "nothing found" would have told a mobiliser that 285
     peoples have no gospel in their language when the truth is that nobody has been able to
     ask. They are their own rung, and it is an identification problem before it is a
     translation one. */
  let access = g.iso639_3 ? 'nothing found' : 'no language code — not searched'
  if (hasText && hasFilm) access = 'read and watch'
  else if (hasText) access = 'read'
  else if (canHear) access = 'watch or hear, cannot read'
  else if (hasStories) access = 'stories only'

  const link = (t) => (first(res, t)?.url || '')
  const name = (t) => (first(res, t)?.title || '')

  /* ═══ THE BRIDGE, FOR A GROUP WITH NOTHING OF THEIR OWN ════════════════════════════════
   * The table could say "nothing found" and stop. For 168 of Doxa's 369 that is not the
   * whole truth: a language ALREADY SPOKEN WIDELY IN THEIR COUNTRY has Scripture and the
   * film. Afitti in Sudan has nothing; Sudanese Arabic, spoken by 65 groups around them,
   * has both. That is the difference between "no way in" and "a way in that is not their
   * heart language", and it is the next action a mobiliser can actually take — which is why
   * it belongs in the EXPORT and not only in the map's sheet.
   *
   * IT CLOSES NO GAP, and the column names say so. A bridge is a way in, not a translation:
   * these groups still have nothing in the language they think in, they are still counted in
   * "nothing found", and the first believers among them still cannot be trained from a text
   * that does not exist. Keyed by code|country, because the same language bridges differently
   * in different countries. */
  /* ═══ A SPOKEN BRIDGE IS NOT A BRIDGE FOR A DEAF COMMUNITY ═══════════════════════════
   * Caught before shipping: the candidate logic was offering 89 Deaf groups a spoken
   * language — "Deaf Afghans -> Turkmen", "Deaf Arubans -> Dutch". That is not a weak
   * bridge, it is not a bridge at all, and a mobiliser acting on it would be sent to do
   * something that cannot reach the people. This build already refuses to search GRN for
   * sign languages because GRN publishes audio; the same reasoning applies here and the
   * candidate logic had simply inherited the gap.
   * A real bridge for a Deaf group would be another SIGN language, or written text in a
   * language that community actually reads — and Deaf literacy in a surrounding written
   * language varies far too much to assert from here. So no bridge is offered, which is the
   * honest answer, and their gap is named as the access problem it is. */
  /* ⚠ ANCHORED TO THE START OF THE NAME, THIS MISSED ONE. "Cocos Deaf" is a Deaf group whose
     language is "Auslan" — a name containing neither "sign language" nor a leading "Deaf ", and
     whose code carries no sg flag because that ISO never reached the resource index. It was the
     single group left with nothing and no bridge after SUN landed, which is how it surfaced.
     A word boundary catches it; Doxa names every Deaf group with the word somewhere. */
  const isSign = c?.sg === 1 || /sign language/i.test(g.language || '') || /\bDeaf\b/i.test(g.name || '')
  const br = !isSign && g.iso639_3 ? bridges[`${g.iso639_3}|${g.iso3}`] : null
  /* Only where the curated bridge has nothing to say, and only for a group with nothing. */
  const cand = !isSign && !br && access === 'nothing found'
    ? (bridgeCandidates[`${g.iso639_3}|${g.iso3}`] || null) : null

  /* Offered only where the group is Deaf AND has nothing: a group that already has Scripture
     in its own sign language does not need to learn a second one. */
  const sunFor = isSign && access === 'nothing found' && sunScripture ? sunScripture : null
  const sunWhere = sunFor ? (sunOrg[normCountry(g.country)] || '') : ''

  return {
    people_group: g.name,
    country: g.country,
    iso3: g.iso3,
    region: g.region,
    language: g.language || '',
    iso639_3: g.iso639_3 || '',
    population: g.population,
    religion: g.religion,
    access,
    resources: res.length,
    scripture: name('Scripture'),
    /* WHO MADE IT, in the artifact that leaves this map. The sheet names the translator on
       screen; a team printing posters or building QR codes exports this CSV and never sees the
       sheet, so the lead has to travel with the row or it does not travel at all. Empty where
       the catalogue names a licence rather than a body — see fetch-ebible-credits. */
    translated_by: (credits[g.iso639_3] && credits[g.iso639_3].org) || '',
    translated_year: (credits[g.iso639_3] && credits[g.iso639_3].year) || '',
    scripture_url: link('Scripture'),
    film_url: link('Film'),
    audio_url: link('Audio Scripture'),
    bible_video_url: link('Bible video'),
    stories_url: link('Bible Stories'),
    gospel_audio_url: link('Gospel audio'),
    training_url: link('Discipleship training'),
    bridge_language: br ? br.l : '',
    bridge_iso639_3: br ? br.c : '',
    bridge_strength: br ? br.st : '',
    bridge_groups_speaking: br ? br.n : 0,
    bridge_has_scripture: br ? !!br.s : false,
    bridge_has_film: br ? !!br.f : false,
    bridge_candidate: cand ? cand.l : '',
    bridge_candidate_iso: cand ? cand.c : '',
    /* ⚠ "Candidate groups" IS GONE, NOT RENAMED. It counted people groups speaking the
       candidate language, which only the old pins-derived proxy could produce. Candidates now
       come from CLDR and carry no such count, so the column shipped as 0 on all 108 candidate
       rows — an empty column in an exported CSV reads as missing data, not as a column that
       stopped applying. What CLDR does give is whether the language is OFFICIAL there, which
       is a real fact about how likely it already is to be taught. */
    bridge_candidate_official: cand ? (cand.official ? 'yes' : 'no') : '',
    bridge_candidate_pct_of_country: cand ? cand.pct : 0,
    /* ═══ THE TRAINING, IN THE ARTIFACT THAT LEAVES THIS MAP ═════════════════════════════
       The sheet and the country list both say when the bridge carries the Zume course; the
       CSV is what a team prints onto a poster or turns into a QR code, and it was the one
       place that did not. 182 rows have it. Same URL already verified and already screened —
       nothing new is fetched here. */
    bridge_training_url: bridgeTrainingUrl(g, br, cand),
    deaf_bridge: sunFor ? 'SUN (universal signed language)' : '',
    deaf_bridge_url: sunFor ? sunFor.url : '',
    deaf_bridge_publisher: sunFor ? (sun?.meta?.publisher || '') : '',
    deaf_bridge_programme: sunWhere,
    pray_url: g.pray_url,
    people_praying: g.people_praying,
    placed: g.mapped,
  }
})

const tally = {}
for (const r of rows) tally[r.access] = (tally[r.access] || 0) + 1
const noCode = rows.filter((r) => !r.iso639_3).length

writeSnapshot(
  resolve(REPO, 'data/tables/doxa-gospel-access.json'),
  `${JSON.stringify({
    meta: {
      title: 'Doxa people groups — what the gospel is available in, and what is missing',
      grain: 'one row per people group on Doxa\'s roster',
      source: 'pray.doxa.life roster joined to the resource index by ISO 639-3',
      generated: new Date().toISOString().slice(0, 10),
      groups: rows.length,
      by_access: tally,
      without_a_language_code: noCode,
      definition:
        'Access says what a person in this group can DO in their own language. "Nothing ' +
        'found" means no pool this build can reach holds anything for their language — ' +
        'never a claim that nothing exists. "Watch or hear, cannot read" is the translation ' +
        'brief: they can receive the gospel and cannot yet study it. A BRIDGE LANGUAGE is a ' +
        'language already spoken widely in their country that does have Scripture and the ' +
        'film. It is a way in, not a translation: a group with a bridge is still counted as ' +
        'having nothing, because they still have nothing in the language they think in. A ' +
        'BRIDGE CANDIDATE is weaker still: it is the largest language in their country that ' +
        'has Scripture and the film, offered with its group count and its share so a reader ' +
        'can judge it. It is NOT ranked or scored, because neither proxy available here ' +
        'survives contact — by group count Oman picks Swahili for an Arabic-speaking people, ' +
        'and by population share a 10% floor refuses Urdu in Pakistan. Evidence, not advice.',
    },
    columns: [
      { title: 'People group', field: 'people_group', type: 'string' },
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
      { title: 'Language', field: 'language', type: 'string' },
      { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
      { title: 'Population', field: 'population', type: 'number' },
      { title: 'Religion', field: 'religion', type: 'string' },
      { title: 'Gospel access', field: 'access', type: 'string' },
      { title: 'Resources', field: 'resources', type: 'number' },
      { title: 'Scripture', field: 'scripture', type: 'string' },
      { title: 'Translated by', field: 'translated_by', type: 'string' },
      { title: 'Year', field: 'translated_year', type: 'string' },
      { title: 'Scripture link', field: 'scripture_url', type: 'url' },
      { title: 'Film link', field: 'film_url', type: 'url' },
      { title: 'Audio link', field: 'audio_url', type: 'url' },
      { title: 'Bible video', field: 'bible_video_url', type: 'url' },
      { title: 'Bible stories', field: 'stories_url', type: 'url' },
      { title: 'Gospel audio', field: 'gospel_audio_url', type: 'url' },
      { title: 'Training', field: 'training_url', type: 'url' },
      { title: 'Bridge language', field: 'bridge_language', type: 'string' },
      { title: 'Bridge ISO', field: 'bridge_iso639_3', type: 'string' },
      { title: 'Bridge strength', field: 'bridge_strength', type: 'string' },
      { title: 'Groups speaking it', field: 'bridge_groups_speaking', type: 'number' },
      { title: 'Bridge candidate', field: 'bridge_candidate', type: 'string' },
      { title: 'Candidate ISO', field: 'bridge_candidate_iso', type: 'string' },
      { title: 'Candidate is official', field: 'bridge_candidate_official', type: 'string' },
      { title: 'Candidate % of country', field: 'bridge_candidate_pct_of_country', type: 'number' },
      { title: 'Training in the bridge', field: 'bridge_training_url', type: 'url' },
      { title: 'Deaf bridge', field: 'deaf_bridge', type: 'string' },
      { title: 'Deaf bridge link', field: 'deaf_bridge_url', type: 'url' },
      { title: 'Deaf bridge publisher', field: 'deaf_bridge_publisher', type: 'string' },
      { title: 'Deaf programme in country', field: 'deaf_bridge_programme', type: 'string' },
      { title: 'Pray', field: 'pray_url', type: 'url' },
      { title: 'People praying', field: 'people_praying', type: 'number' },
      { title: 'On the map', field: 'placed', type: 'string' },
    ],
    rows,
  }, null, 1)}\n`,
  (j) => (j.rows || []).length,
  'Doxa gospel-access row(s)',
)
console.log(`doxa-gospel-access: ${rows.length} group(s)`)
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
const withBridge = rows.filter((r) => r.access === 'nothing found' && r.bridge_language).length
const noneTotal = rows.filter((r) => r.access === 'nothing found').length
console.log(`  ${noCode} row(s) carry no language code, so no pool can be searched for them`)
const withCand = rows.filter((r) => r.access === 'nothing found' && r.bridge_candidate).length
/* READ THE COLUMN, DO NOT RE-DERIVE IT. This line used to run its own copy of the sign-language
   test, still anchored at /^Deaf / after the row logic had moved to a word boundary — so it
   would have reported a number the table itself disagreed with. Same shape as the tier bug the
   surfaces gate exists for, one console.log instead of a whole view. */
const deafBridged = rows.filter((r) => r.deaf_bridge).length
const isolated = noneTotal - withBridge - withCand - deafBridged
console.log(`  of the ${noneTotal} with nothing: ${withBridge} curated bridge, ${withCand} computed candidate, ` +
  `${deafBridged} Deaf offered SUN (no spoken bridge can reach them), ${isolated} neither`)
const deafPeople = rows.filter((r) => r.deaf_bridge).reduce((n, r) => n + (r.population || 0), 0)
const deafProg = rows.filter((r) => r.deaf_bridge_programme).length
console.log(`  the Deaf bridge reaches ${deafPeople.toLocaleString()} people; ` +
  `${deafProg} of those groups are in a country where SUN is already being taught, by a named local organisation`)
