#!/usr/bin/env node
/**
 * build-people-group-pins.mjs — join people-group LOCATIONS to REAL gospel-resource URLs.
 *
 * THE JOIN, and why it is the only honest one available:
 *   data/people-groups/people-groups-slim.json   12,379 people-group-in-country rows, each with
 *                                                Lat/Long — this is WHERE a pin goes.
 *   data/tables/people-group-resources.json       2,106 LANGUAGE rows carrying the real
 *                                                scripture_url / film_url — this is WHAT exists.
 *   key: slim.LanguageCode  ==  resources.iso639_3   (ISO 639-3)
 *
 * A people group is reached in its LANGUAGE, not its nationality, so the language code is the real
 * join. MEASURED at build time and printed below: ~48% of pins join a resource record and ~41% join
 * one carrying a real URL. The other 59% is not a bug to hide — it IS the map's subject. A pin with
 * no resource is the most important pin on the map.
 *
 * URLS ARE NORMALISED, not duplicated. 12,379 pins share 862 language codes, so the URLs live once
 * in `codes` and each pin carries only its code. Inlining them would triple the file for nothing.
 *
 * PINS ARE ARRAYS, not objects: [name, lat, lng, iso3, code, population, tier]. Object keys repeated
 * 12,379 times cost more than the data.
 *   tier 2 = Scripture AND film · 1 = one of them · 0 = nothing found in the pools we checked
 *
 * NO URL IS INVENTED HERE. Every string is copied from the resources table, which records its own
 * provenance in checked_pools/unchecked_pools. This script adds no links of its own.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { hasReadableScripture } from '../gospel-resource-rows.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
// CANONICAL PATHS, and this cost a rebuild to learn: data/tables/ at the REPO ROOT is the
// published source — its md5 matches public/doxa-maps/assets/tables/. The plugin-local
// copy at plugin-designs/gospel-resources/data/tables/ is a STALE DIVERGENT duplicate
// (people-group-resources.json differs from the root copy) that nothing publishes. Reading
// the plugin copy silently joins against month-old data and ships a table no page fetches.
const SRC_RES = resolve(REPO, 'data/tables/people-group-resources.json')
const OUT = resolve(REPO, 'data/tables/people-group-pins.json')
const INDEX = resolve(REPO, 'data/tables/index.json')
const D43 = resolve(REPO, 'data/tables/door43-index.json')
const EBIBLE = resolve(REPO, 'data/tables/ebible-index.json')
const ARC = resolve(REPO, 'data/tables/arclight-index.json')
const ARC_SHARE = resolve(REPO, 'data/tables/arclight-share-urls.json')
const ZUME = resolve(REPO, 'data/tables/zume-index.json')
const VERIFY = resolve(REPO, 'data/tables/gospel-link-verification.json')
const FCBH = resolve(REPO, 'data/tables/fcbh-index.json')
const MACRO = resolve(REPO, 'data/tables/iso-macrolanguages.json')
const GODTOOLS = resolve(REPO, 'data/tables/godtools-index.json')
const SCRIPTUREEARTH = resolve(REPO, 'data/tables/scriptureearth-index.json')
const GRN = resolve(REPO, 'data/tables/grn-index.json')
const GAPSOPP = resolve(REPO, 'data/tables/gaps-and-opportunities.json')

// Two entries with the same subject rendered as "Open Bible Stories  Open Bible Stories"
// — two links a reader cannot tell apart. 40 languages are in that state, because a
// language can carry more than one independent translation effort. The OWNER is what
// distinguishes them, so it is appended only where it is needed to disambiguate.
function labelD43(items) {
  const bySubject = {}
  for (const i of items) (bySubject[i.subject] ||= []).push(i)
  return items.map((i) => ({
    s: bySubject[i.subject].length > 1 && i.owner ? `${i.subject} (${i.owner})` : i.subject,
    u: httpsify(i.url),
    // How much Scripture, counted from the entry's own book list. Open Bible Stories
    // carries none by design — it is 50 narratives, not a portion of the canon.
    ...(i.scope ? { sc: i.scope } : {}),
  }))
}

// ONE normalisation for every source, applied where a URL ENTERS the index rather than
// in each fetcher. Doing it per-source left 120 plain-http links behind — the curated
// scripture_url values, which fill-never-overwrite preserves and which therefore never
// passed through the catalogue's own normaliser. Scheme and host only; the path is
// case-sensitive and is left exactly as published.
// SCOPE, not just a title. "Ahirani Matthew and Mark" and "Bhadrawahi Bible" are both
// "Scripture" to the old label, and the difference between two Gospels and a whole Bible
// is the most decision-relevant fact a mobiliser reads on this map.
// 39 OT books + 27 NT = the 66-book canon; NT-only and portions are named as such rather
// than rounded up.
function scopeOf(ee) {
  if (!ee) return ''
  if (ee.full) return 'Full Bible'
  if (ee.nt && !ee.ot) return 'New Testament'
  if (ee.ot && !ee.nt) return 'Old Testament'
  if (ee.nt && ee.ot) return 'Portions of both Testaments'
  return 'Portions'
}

const httpsify = (u) => {
  const m = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(String(u || '').trim())
  return m ? `https://${m[1].toLowerCase()}${m[2] || ''}` : String(u || '').trim()
}

const rowsOf = (p) => {
  const d = JSON.parse(readFileSync(p, 'utf8'))
  if (Array.isArray(d)) return d
  for (const k of ['rows', 'data', 'records', 'items']) if (Array.isArray(d[k])) return d[k]
  for (const v of Object.values(d)) if (Array.isArray(v) && v[0] && typeof v[0] === 'object') return v
  throw new Error(`no rows in ${p}`)
}

const slim = rowsOf(resolve(REPO, 'data/people-groups/people-groups-slim.json'))
const res = rowsOf(SRC_RES)
// Door43 snapshot (scripts/fetch-door43-index.mjs). Optional: if the file is absent the
// build still runs and simply adds no Door43 links, rather than failing the whole table.
let d43 = {}
try { d43 = JSON.parse(readFileSync(D43, 'utf8')).codes || {} } catch { d43 = {} }
// eBible catalogue snapshot (scripts/fetch-ebible-index.mjs). Same optional contract.
let eb = {}
let ebByUrl = {}
try {
  const j = JSON.parse(readFileSync(EBIBLE, 'utf8'))
  eb = j.codes || {}
  ebByUrl = j.byUrl || {}
} catch { eb = {}; ebByUrl = {} }
// Arclight / JESUS Film snapshot (scripts/fetch-arclight-index.mjs).
let arc = {}
try { arc = JSON.parse(readFileSync(ARC, 'utf8')).codes || {} } catch { arc = {} }
// The REAL per-language deep link. ?languageId= is ignored by the site — measured in a
// browser, a real id and a bogus id render the same library page — so where a shareUrl
// exists it replaces that URL entirely rather than sitting alongside it.
let share = {}
try { share = JSON.parse(readFileSync(ARC_SHARE, 'utf8')).codes || {} } catch { share = {} }
/**
 * The share table answers in three shapes, and each means something different:
 *   a STRING   the JESUS Film deep link for this language
 *   an OBJECT  {u,t} a different JESUS Film Project feature — the JESUS component has no
 *              entry for this language — and t is what it must actually be called
 *   null       no feature exists at all; ship NO film rather than the retired ?languageId=
 *              URL, which nothing can verify and which claimed a film that is not there
 * undefined (never fetched) keeps the old behaviour and falls back to the roster URL.
 */
const shareEntry = (code, aa) => {
  const v = share[code]
  if (v === null) return { u: '', t: '' }
  if (v && typeof v === 'object') return { u: httpsify(v.u || ''), t: String(v.t || '') }
  return { u: httpsify(v || (aa ? aa.u : '')), t: '' }
}
const filmUrl = (code, aa) => shareEntry(code, aa).u
const filmTitle = (code, aa) => shareEntry(code, aa).t

// Zume Training snapshot (scripts/fetch-zume-index.mjs). Same optional contract as above.
// Zume is DISCIPLESHIP TRAINING, not Scripture and not film, so it is kept in its own
// field and deliberately does NOT move a group's tier: the tiers and the gap list mean
// "Scripture and/or film", and quietly folding a third kind of resource into them would
// shrink the gap count without anyone having translated anything.
// Link verification snapshot (scripts/verify-gospel-links.mjs). A URL that verification
// PROVED dead is dropped here rather than shipped with a warning: a field worker following
// a 404 has already lost, and "we knew it was broken and showed it anyway" is not a state
// this map should be able to reach. Optional like every other snapshot — with no file, no
// link is dropped, and the build still runs.
let dead = new Set()
try {
  const j = JSON.parse(readFileSync(VERIFY, 'utf8'))
  for (const [u, r] of Object.entries(j.links || {})) if (r && r.state === 'broken') dead.add(u)
} catch { dead = new Set() }

// Faith Comes By Hearing audio Scripture (scripts/fetch-fcbh-index.mjs). Same optional
// contract as every other snapshot.
let fcbh = {}
let fcbhVideo = {}
try {
  const j = JSON.parse(readFileSync(FCBH, 'utf8'))
  fcbh = j.codes || {}
  fcbhVideo = j.videoCodes || {}
} catch { fcbh = {}; fcbhVideo = {} }

// Cru gospel presentations (scripts/fetch-godtools-index.mjs).
let godtools = {}
try { godtools = JSON.parse(readFileSync(GODTOOLS, 'utf8')).codes || {} } catch { godtools = {} }

// Scripture Earth (scripts/fetch-scriptureearth-index.mjs). Optional like the rest: if the
// snapshot is absent the build still runs and simply offers less.
let scriptureEarth = {}
try { scriptureEarth = JSON.parse(readFileSync(SCRIPTUREEARTH, 'utf8')).byIso || {} } catch { scriptureEarth = {} }

// Global Recordings Network via 5fish (scripts/fetch-grn-index.mjs). Optional like the rest.
let grn = {}
let grnSeen = new Set()
try {
  const j = JSON.parse(readFileSync(GRN, 'utf8'))
  grn = j.byIso || {}
  // Every code the sweep has DECIDED — found or not found. A code it has not reached yet is
  // neither, and must not be described as searched.
  grnSeen = new Set([...Object.keys(grn), ...(j.none || [])])
} catch { grn = {}; grnSeen = new Set() }

let zume = {}
let zumeApprox = {}
try {
  const j = JSON.parse(readFileSync(ZUME, 'utf8'))
  zume = j.byIso || {}
  // Approximate matches ride in a SEPARATE field so no count, tier or gate can mistake
  // one for an exact join. They exist because "we publish in your language but cannot
  // say which variety" is a real answer and "nothing found" is not.
  zumeApprox = j.approx || {}
} catch { zume = {}; zumeApprox = {} }

// codes: one entry per ISO 639-3 that actually carries something worth linking to.
const codes = {}
for (const r of res) {
  const c = r.iso639_3
  if (!c) continue
  const s0 = r.scripture_url || ''
  const f = r.film_url || ''
  const dd = d43[c]
  const ee = eb[c]
  // FILL, NEVER OVERWRITE. An existing scripture_url was curated and verified by an
  // earlier pass; the catalogue is broad but not hand-checked, so it only supplies a
  // link where there was none. Curation beats coverage when the two disagree.
  const ebUrl = !s0 && ee ? ee.u : ''
  const aa = arc[c]
  const arcUrl = !f && aa ? filmUrl(c, aa) : ''
  codes[c] = {
    // Published Door43 resources, each a real browsable URL. `subject` travels with the
    // link so the UI can say "Stories" rather than implying a Bible translation.
    ...(dd && dd.items.length ? { d: labelD43(dd.items) } : {}),
    l: r.language || '',
    ...((s0 || ebUrl) && { s: httpsify(s0 || ebUrl) }),
    // Scope describes the translation we actually LINK TO. A curated scripture_url that
    // happens to be the same eBible page gets it too; one that points somewhere else does
    // NOT, because the catalogue's book counts would then be describing a different
    // publication. 643 entries were missing a scope purely because they were curated.
    // Identify the translation we ACTUALLY link to. Prefer the language index when the
    // URL is the catalogue's own pick; otherwise look the URL itself up, which names the
    // 24 curated links that point at an older edition than the catalogue's current
    // choice. Both resolve, so the curation is kept and only the description is added.
    ...(() => {
      const url = httpsify(s0 || ebUrl)
      const hit = ee && url === httpsify(ee.u) ? ee : ebByUrl[url]
      return hit ? { sv: hit.t || '', sf: hit.full ? 1 : 0, ss: scopeOf(hit) } : {}
    })(),
    ...((f || arcUrl) && { f: httpsify(f || arcUrl) }),
    // has_audio carries a meaningful third state: 'unknown' means a pool we could not
    // query (key-blocked), NOT a no. Collapsing it to a boolean would turn "we did not
    // look" into "there is nothing" — the exact dishonesty the sheet's note guards.
    // 1 = found · 0 = none found in checked pools · omitted = unknown.
    ...(r.has_audio === true || r.has_audio === 'Available' ? { a: 1 }
        : r.has_audio === false ? { a: 0 } : {}),
    ...(r.has_open_bible_stories ? { o: 1 } : {}),
    // Provenance travels with the record: which pools were searched, which were not.
    ...(r.checked_pools && { ck: r.checked_pools }),
    ...(r.unchecked_pools && { un: r.unchecked_pools }),
  }
}

// DOOR43-ONLY LANGUAGES. people-group-resources.json covers 862 codes; Door43 publishes for
// languages outside that set. Without this pass their pins stay tier 0 — the map telling a
// reader "nothing found" for a group that has a published resource, which is the one error
// this map must never make. MEASURED: 213 pins across ~64 languages were in exactly that state.
let d43Only = 0, ebOnly = 0
for (const [c, dd] of Object.entries(d43)) {
  if (codes[c] || !dd.items?.length) continue
  codes[c] = {
    l: dd.title || '',
    d: labelD43(dd.items),
    ck: 'door43',
    un: 'ebible, arclight, grn, api_bible, dbl, progress_bible',
  }
  d43Only++
}
// Same pass for eBible: 1,237 catalogued codes against 862 in the resources table, so most
// of the catalogue describes languages that have no row to attach a link to. Without this
// their pins keep saying "nothing found" while a published translation exists.
let arcOnly = 0, upgraded = 0
for (const [c, aa] of Object.entries(arc)) {
  // An existing film link that is the ignored ?languageId= form is REPLACED where a real
  // deep link exists: keeping it would mean curation preserving a URL that goes nowhere
  // specific, which is not what the fill-never-overwrite rule is protecting.
  /* The UPGRADE path reads the share table too, and read it RAW — so an {u,t} entry
     stringified straight into the URL field as "[object Object]" for ars, whose film is
     its only resource. Both readers go through shareEntry now; there is exactly one place
     that knows the three shapes. */
  if (codes[c]?.f && share[c] !== undefined && /[?&]languageId=/.test(codes[c].f)) {
    const e = shareEntry(c, null)
    if (e.u) { codes[c].f = e.u; if (e.t) codes[c].fT = e.t; upgraded++ }
    else if (share[c] === null) { delete codes[c].f; delete codes[c].fT }
  }
  const ft = filmTitle(c, aa)
  if (codes[c]) {
    if (!codes[c].f) { codes[c].f = filmUrl(c, aa); if (ft) codes[c].fT = ft }
    continue
  }
  codes[c] = { l: aa.n || '', f: filmUrl(c, aa), ck: 'arclight', un: 'ebible, door43, grn, api_bible, dbl, progress_bible' }
  if (ft) codes[c].fT = ft
  arcOnly++
}
for (const [c, ee] of Object.entries(eb)) {
  if (codes[c]) {
    // code exists but came from the Door43-only pass above and has no scripture yet
    if (!codes[c].s) { codes[c].s = httpsify(ee.u); codes[c].sv = ee.t || ''; codes[c].sf = ee.full ? 1 : 0; codes[c].ss = scopeOf(ee) }
    continue
  }
  // ss and httpsify belong here as much as anywhere. A previous edit tried to add them
  // and matched a string this line did not contain, so the patch reported success and
  // changed nothing — 523 entries kept a title and a full-Bible flag while silently
  // losing their scope. Every field the other branch sets, this branch sets.
  codes[c] = {
    l: ee.ln || '', s: httpsify(ee.u), sv: ee.t || '', sf: ee.full ? 1 : 0, ss: scopeOf(ee),
    ck: 'ebible', un: 'arclight, grn, api_bible, dbl, progress_bible',
  }
  ebOnly++
}

// NAME EVERY LANGUAGE, even one with no resource anywhere. A code only gets a `codes`
// entry when some pool carries something for it, so the groups with NOTHING — precisely
// the ones the gap list ranks — were rendering a blank language name next to their code.
// The slim dataset knows the name for every pin, so it is filled here and the entry is
// created when it does not exist. MEASURED: this is the sheet the gap list opens on, and
// "Language: (blank) cjy" for a 60-million-speaker group is the worst place to be vague.
// SIGN LANGUAGES ARE MARKED, because "Scripture · none found" means something different
// for them. A Deaf group cannot be served by a text translation at all — eBible is a text
// pool and was never the right place to look — so reporting its silence as an absence of
// Scripture describes our search, not their need. The flag lets the sheet say so.
//
// ★ AND THE DOCTRINE TRAP LIVES HERE. The largest producer of sign-language Bible content
// by a wide margin is the Watchtower/JW organisation, which is excluded by standing rule.
// A future maintainer filling this gap will meet jw.org first and it will look like the
// obvious answer. It is not: added canon. Legitimate partners to pursue instead are the
// Deaf Bible Society and DOOR International, both of which need credentials we do not
// have — deafbible.com is a key-gated app and doorinternational.org answers 403.
// sign.bible is NOT a source: it is a parked domain listed for sale.
const isSign = (n) => /\bsign language\b/i.test(n || '')
let signCodes = 0
let namedOnly = 0
for (const p of slim) {
  const c = p.LanguageCode
  const n = (p.LanguageName || '').trim()
  if (!c || c.length !== 3 || !n) continue
  if (!codes[c]) {
    // ★ THESE POOLS WERE CHECKED, and saying otherwise understates what we know.
    // A code reaching this pass is absent from the eBible, Arclight and Door43 catalogues
    // — all three were scanned in full, and this code is in none of them. Labelling that
    // "not checked" reads as "we do not know", when the truth is the stronger and more
    // useful "we searched three catalogues and it is not there". MEASURED: 2,608 of the
    // 3,457 gap rows, 75%, carried the weaker claim.
    // GRN, api.bible, DBL and Progress Bible genuinely were NOT searched — they need
    // credentials this build does not have — so they stay in the unchecked list.
    codes[c] = { l: n, ck: 'ebible, arclight, door43', un: 'grn, api_bible, dbl, progress_bible' }
    namedOnly++
  } else if (!codes[c].l) {
    codes[c].l = n
  }
  if (isSign(n) && !codes[c].sg) { codes[c].sg = 1; signCodes++ }
}

// LAST NAMING PASS. The slim dataset names only languages a people group speaks, so a
// code that exists purely in a catalogue — 377 of them, carrying 506 real resources —
// had no name at all and rendered as a bare ISO code in the resource table. Each
// catalogue knows the language name; take the first that does.
let catNamed = 0
for (const [c, v] of Object.entries(codes)) {
  if (v.l) continue
  const n = eb[c]?.ln || arc[c]?.n || d43[c]?.title || ''
  if (n) { v.l = n; catNamed++ }
}

// ★ ONE PROVENANCE PASS, APPLIED TO EVERY CODE. This build scans the eBible, Arclight and
// Door43 catalogues IN FULL, so for any code, absence from them is a searched-and-absent
// result rather than an unknown. The original records predate the Door43 pass and claim
// only "ebible, arclight"; 849 gap rows carried that weaker statement even though Door43
// had in fact been searched for them.
// The four that genuinely were NOT searched — GRN, api.bible, DBL, Progress Bible — need
// credentials this build does not have, and they are the ONLY things the unchecked list
// should ever name. A reader deciding where to work needs "we looked and it is not there"
// to be distinguishable from "nobody looked".
const SCANNED = 'ebible, arclight, door43, fcbh, scriptureearth, grn'
const NOT_SCANNED = 'api_bible, dbl, progress_bible, youversion'

// POOLS CONSIDERED AND REJECTED, with the measurement, so nobody spends another tick on
// them. Each was reachable and doctrinally fine — the reason is always coverage or the
// join key, never suspicion:
//   - AudioTreasure  9 languages, every one major (Arabic, Cantonese, Hindi, Mandarin,
//                    Polish, Punjabi, Tamil, Urdu). Zero overlap with the gap.
//   - Talking Bibles 177 languages, real audio Bibles, open robots.txt. They publish NO
//                    ISO code — the player keys languages by an internal numeric id — so a
//                    join would have to be by NAME, which this map refuses because names
//                    collide across unrelated languages. It did not matter in the end: of
//                    the 81 whose names match a language we carry, ZERO are in the gap, so
//                    even a perfect ISO join would add no coverage.
//   - Davar Partners a ministry site, not a catalogue. No per-language page and therefore
//                    no URL a worker could be sent to.
//   - Bible for Children (bibleforchildren.org) — checked 2026-09-26. Reachable, and the
//                    status code is meaningful: a wrong path 404s rather than returning the
//                    homepage, so it is not one of the app shells that defeated the others.
//                    Its index lists 118 languages as /languages/<name>/stories.php, with no
//                    pagination and no stated total, so 118 is what is published, not a page
//                    of something larger.
//                    OUT FOR THREE REASONS, IN THIS ORDER OF WEIGHT:
//                    (1) COVERAGE. Of the 294 languages in the Doxa gap, exactly ONE name
//                        matches a folder here. 82 of the 118 match a language this index
//                        carries somewhere, so the catalogue is real and overlaps us — it
//                        just does not overlap the part that has nothing, which is the only
//                        part a new pool is worth adding for.
//                    (2) THE JOIN KEY. No ISO code is published anywhere: not in the index,
//                        not on a story page. The folder IS the language name, so a join
//                        would be by name — the guess this build removed, and the guess that
//                        would have handed Akha in Laos one of three sub-varieties. The one
//                        gap match above is a name match and is worth nothing on its own.
//                    (3) DOCTRINE UNVERIFIED, not suspected. No statement of faith is served
//                        at /about.php, /aboutus.php, /faith.php or /beliefs.php — all 404.
//                        The rule is to leave a source out when its doctrine is
//                        unclear and say why, so that is what this is. It is NOT a finding
//                        against them; it is the absence of a finding either way.
//   - IBT (Institute for Bible Translation, ibtrussia.org) — NOT a pool, but the best LEAD
//                    on this map, and the distinction is the point. Found by asking why 36
//                    Doxa groups carry an IMB "audio Scripture exists" flag while every pool
//                    here says nothing: most are Dagestani and Caucasus languages, which the
//                    English-centred catalogues do not cover. IBT does. Their /languages page
//                    lists 54+ translation projects — Akhvakh, Andi, Bagvalal, Botlikh,
//                    Chamalal, Aghul, Adyghe, Avar — exactly the cluster in question, and
//                    their robots.txt is an ordinary Drupal one that allows all of it.
//                    WHY IT IS STILL NOT A POOL: the page gives a native-script name, a
//                    region and a language family, and NOTHING else. No ISO code, no
//                    per-language page, no publication URL. Joining it would mean matching
//                    "Akhvakh (ашвалӏи мицӏцІи)" to a code by NAME — the exact guess this
//                    build removed when Doxa's own API made it unnecessary, and the guess
//                    that would have handed Akha in Laos one of three sub-varieties.
//                    WHAT IT IS WORTH ANYWAY: the ask was for the people who do the
//                    translation work, so that a group with nothing can be handed to a team
//                    that already has the linguistic work and the relationships. For the
//                    Caucasus cluster, IBT is that team, by name. That belongs in a leads
//                    table with a human confirming each code — never auto-joined.
//   - YouVersion /   the brief names it and it is the largest catalogue of the lot, so it is
//     Bible.com      worth recording exactly why it stays out. Measured 2026-09-25:
//                    * nodejs.bible.com serves versions by language over plain HTTP with no
//                      key — and its robots.txt is `User-agent: * / Disallow: /`, allowing
//                      only /assets/. This repo obeys 5fish's Crawl-delay and reached GRN
//                      through their own public site rather than around their shield; a
//                      blanket Disallow gets the same respect. Not ours to take.
//                    * www.bible.com answers even /robots.txt with a "Client Challenge" bot
//                      wall, so there is no public catalogue page to read either.
//                    * and the unauthenticated slice would be wrong anyway: that endpoint
//                      returns 2 versions for eng and 3 for deu, against the dozens each
//                      really has. Shipping it would UNDERSTATE coverage while looking
//                      authoritative, which is worse than leaving it out.
//                    The honest route is a YouVersion API key, which is an owner task and
//                    not something an agent should work around. Until then this pool is
//                    named in the unchecked list, never in the checked one.
// GRN was the opposite case and is worth the contrast: also name-shy at first glance, but
// their 5fish site resolves by ISO 639-3 directly, which is why it is in and these are not.
// SIGN LANGUAGES GET THEIR OWN PROVENANCE, because the generic list is actively
// misleading for them. A Deaf group is not served by eBible (text), Door43 (text and
// stories) or FCBH audio, so listing those as "checked" implies a search that was never
// the right search — and the unchecked list named GRN, an AUDIO pool, while omitting the
// two organisations that actually publish for the Deaf.
// Measured this tick: Arclight carries 14 sign languages and every one is already in this
// index; FCBH carries none; deaf.bible and deafbible.com both return the same 3,894-byte
// app shell and door.international returns 114 bytes. So 136 of 150 sign languages here
// have nothing, and the honest statement is which pool could still have it.
const SIGN_SCANNED = 'arclight (14 sign languages, all captured), fcbh (none)'
const SIGN_NOT_SCANNED = 'deaf_bible_society, door_international — both key-gated'

// SIGN-LANGUAGE SOURCES CHECKED AND REJECTED, so the next agent does not re-probe them.
// This is the largest blocked population on the map — 183 groups and 55.2 million people —
// so it is worth saying exactly what was tried:
//   - deafbible.com      3,894 bytes, the same app shell for every URL — re-measured
//                        2026-09-25 and unchanged, including /sitemap.xml, which also
//                        returns the shell. Their robots.txt allows everything; there is
//                        simply nothing served to a fetch. api.deafbible.com answers 525,
//                        a Cloudflare origin failure, so even the app's own API is down.
//   - doorinternational.org  the REAL DOOR International domain (door.international below
//                        is not theirs). Answers 403 with a Cloudflare "Just a moment..."
//                        interstitial on every path INCLUDING robots.txt. That is a bot
//                        shield, and this repo does not circumvent shields — it reached GRN
//                        through their own public 5fish site rather than around it. Out on
//                        access, not on doctrine, and it needs a human asking them.
//   - door.international NOT DOOR International. Re-measured 2026-09-25: the domain is
//                        parked for sale on GoDaddy's aftermarket, and it now publishes an
//                        llms.txt saying exactly that. It looked like a lead precisely
//                        because it advertises an LLM policy. Their real site is
//                        doorinternational.org, above.
//   - Deaf Missions      a real ministry with a real site, but ASL ONLY — and ZERO of the
//                        183 sign-language groups in this gap speak ASL, so it adds nothing
//                        here even though it is doctrinally fine and genuinely useful.
//   - JW / Watchtower    produce a great deal of sign-language material and are EXCLUDED on
//                        doctrine, without exception. Not a coverage decision.
// So the sign codes stay blocked on an agreement rather than on a search, which is why the
// gap sheet calls them an access problem.
//
// ★ AND IT IS A BIGGER PROBLEM THAN THIS MAP WAS TREATING IT AS. Cross-checking Doxa's
// roster against IMB's own access flags: 122 of Doxa's 2,107 people groups are DEAF —
// 17.5 million people — and 92 of them have nothing in this index. For 33 of those 92 IMB
// records that material EXISTS, much of it dated 2021 with a translation level of
// "Selections" or "Stories": Armenian, Bulgarian, Myanmar, Cambodian, Cuban sign languages
// and more. That is a coordinated body of work this build cannot see, and the two
// organisations who hold it are both unreachable by fetch. It is the single largest
// identified-but-unreachable set on this map, and the route is someone asking them for
// access rather than another agent probing the same three hosts.

// Attach Zume where the language matches. A code with no other resource still gets an
// entry, because "training exists in your language" is a real answer to "what is there".
let zumeCodes = 0, zumeNew = 0
for (const [c, z] of Object.entries(zume)) {
  if (!codes[c]) { codes[c] = { l: z.name || '', ck: SCANNED, un: NOT_SCANNED }; zumeNew++ }
  codes[c].z = httpsify(z.url)
  zumeCodes++
}
// AUDIO SCRIPTURE. Unlike Zume, this one DOES lift a group off tier 0, because a people
// group with an audio Bible in their own language does not have "nothing" — for an
// oral-preference group it may be the most useful thing on the list. It does not by itself
// create tier 2, which stays reserved for text Scripture together with film.
let audioCodes = 0, audioNew = 0
for (const [c, a] of Object.entries(fcbh)) {
  if (!codes[c]) { codes[c] = { l: a.ln || '', ck: SCANNED, un: NOT_SCANNED }; audioNew++ }
  codes[c].au = { u: httpsify(a.u), n: a.n, ln: a.ln, m: a.m || 'audio' }
  audioCodes++
}

// BIBLE VIDEO. Typed and tiered apart from film: "film" on this map means the JESUS Film,
// and FCBH's video is Bible narrative whose scope is read per fileset — twelve Old Testament
// episodes for some languages, the book of Acts for others. It lifts a group off "nothing
// found" because that is true, and contributes nothing to the Scripture+film tier, because
// an Eden-to-wilderness narrative is not the gospel.
// Only shipped when it is a DIFFERENT page from the Scripture fileset; where they are the
// same bible.is fileset, one link already covers it.
let videoCodes = 0
let videoMerged = 0
for (const [c, v] of Object.entries(fcbhVideo)) {
  const u = httpsify(v.u)
  if (codes[c] && codes[c].au && codes[c].au.u === u) {
    // Same bible.is page. One link still, but it must SAY it carries video and what that
    // video covers — otherwise 1,379 languages whose Scripture page also holds the whole
    // New Testament on film-quality video advertise only "audio, text".
    const m = String(codes[c].au.m || '')
    if (!/video/.test(m)) codes[c].au.m = m ? `${m}, video` : 'video'
    codes[c].au.vsc = v.scope
    videoMerged++
    continue
  }
  if (!codes[c]) codes[c] = { l: v.ln || '', ck: SCANNED, un: NOT_SCANNED }
  codes[c].bv = { u, n: v.n, sc: v.scope }
  videoCodes++
}

// GOSPEL PRESENTATIONS. A short translated tract is not Scripture, not film and not a
// course, so it gets its own field and its own type. It does NOT lift a tier: measured, all
// 105 of these languages already have something, so it adds depth rather than coverage, and
// pretending otherwise would shrink the gap without anything having been translated.
let gospelCodes = 0
for (const [c, g] of Object.entries(godtools)) {
  if (!codes[c]) continue   // never invents a language; depth only, for groups already here
  codes[c].gp = { u: httpsify(g.u), n: g.n }
  gospelCodes++
}

// SCRIPTURE EARTH. SIL and its translation partners publish Scripture for small languages
// the big catalogues skip, which is why this pool reaches groups the others cannot. It DOES
// lift a group off tier 0, on the same footing as Door43 and audio: a person here is offered
// Scripture in their own language — PDF, recorded audio, a Scripture App Builder app, or the
// SFM text — so "nothing found" is simply untrue for them. It never reaches tier 2, which
// stays reserved for text Scripture together with the JESUS Film.
//
// The fetcher already threw away two kinds of false positive that would have shipped here:
// empty directories (most of the index) and directories holding only JESUSFilm-*.txt
// metadata stubs. What arrives in this file is content that was measured to exist.
let seCodes = 0
let seNew = 0
for (const [c, e] of Object.entries(scriptureEarth)) {
  if (!codes[c]) { codes[c] = { l: '', ck: SCANNED, un: NOT_SCANNED }; seNew++ }
  codes[c].se = { u: e.u, k: e.k }
  seCodes++
}

// GOSPEL AUDIO (GRN). For a language with no writing system this is the ONLY form the
// gospel can take, which is why it belongs in the gap rather than beside it. It lifts a
// group off tier 0 — a person can hear the gospel in their own language — and never reaches
// tier 2, which stays reserved for text Scripture together with the JESUS Film.
//
// Typed as Gospel audio, NEVER as Scripture: "Words of Life" is gospel messages and Bible
// stories with songs, not a translation of the canon. Calling it Scripture would be the
// same error as filing a story set under Scripture, and it is the error that matters most.
let grnCodes = 0
let grnNew = 0
let grnSignSkipped = 0
for (const [c, g] of Object.entries(grn)) {
  // NEVER on a sign language. GRN's catalogue is AUDIO recordings, and 5fish having a page
  // titled "Pakistan Sign Language" says they index the language, not that they hold signed
  // video. Attaching it anyway told 20 Deaf groups — 11.5M people — that gospel audio was
  // available to them, which is both unverified and, for this audience, useless. The rule
  // for an unclear source is to leave it out and say why, so it is left out here.
  if (codes[c] && codes[c].sg === 1) { grnSignSkipped++; continue }
  if (!codes[c]) { codes[c] = { l: g.n || '', ck: SCANNED, un: NOT_SCANNED }; grnNew++ }
  codes[c].ga = { u: g.u, n: g.n }
  grnCodes++
}

let zumeApproxCodes = 0
for (const [c, a] of Object.entries(zumeApprox)) {
  // Never overwrite an exact join with an approximate one, and never create a code that
  // does not already exist: an approximate match is extra information about a language
  // already on this map, not grounds for inventing a new one.
  if (!codes[c] || codes[c].z) continue
  codes[c].za = { u: httpsify(a.url), l: a.lang, n: a.note }
  zumeApproxCodes++
}

// PROVENANCE, AFTER EVERY SOURCE HAS ATTACHED. This loop used to run before the Scripture
// Earth and GRN attaches, so the 110 codes those fetchers CREATE kept the raw constant and
// claimed grn had been checked for them when it had not. It is the same ordering lesson as
// the dead-link drop below: a normalising pass that runs before the thing it normalises
// reports a tidy answer about a room that is still filling up.
// entries(), not values(): the GRN sweep is decided PER CODE, so this loop needs the code.
for (const [c, v] of Object.entries(codes)) {
  if (v.sg === 1) {
    v.ck = SIGN_SCANNED
    v.un = SIGN_NOT_SCANNED
    continue
  }
  // WHAT WAS ACTUALLY CHECKED FOR THIS CODE, not what the pipeline can check in general.
  // This line is read by a person deciding whether "nothing found" means anything, so a
  // pool named here must really have been searched FOR THEM.
  //
  // scriptureearth is unconditional: that sweep covered every code this map uses, and a
  // code absent from their index is a checked negative, not an unchecked one.
  //
  // grn is NOT. It is swept a batch at a time at the ten-second crawl delay their robots.txt
  // asks for, so most codes have not been looked at yet. Claiming it for all of them would
  // have told 2,100 groups their gap was searched in the largest gospel-audio pool there is
  // when it was not — the exact stale-caveat error this file has had to correct twice before.
  const had = String(v.ck || '').split(',').map((x) => x.trim()).filter(Boolean)
  const all = new Set([...had, 'ebible', 'arclight', 'door43', 'fcbh', 'scriptureearth'])
  const grnDecided = grnSeen.has(c)
  if (grnDecided) all.add('grn')
  else all.delete('grn')
  v.ck = [...all].sort().join(', ')
  v.un = grnDecided ? NOT_SCANNED : `${NOT_SCANNED}, grn (not yet swept)`
}

// ═══ AN IN-COUNTRY BRIDGE, FOR GROUPS WITH NOTHING OF THEIR OWN ══════════════════════
// The map could say "nothing found" and stop. For 212 of those groups that is not the whole
// truth: a language ALREADY SPOKEN WIDELY IN THEIR COUNTRY has Scripture or the film, which
// is the difference between "no way in" and "a way in that is not their heart language".
// Kimr in Sudan has nothing; Sudanese Arabic, spoken by 65 groups around them, has both.
//
// THIS IS NEVER A CLAIM THAT THEY HAVE SCRIPTURE, and the sheet must not let a reader
// skim it as one. A bridge is a second language: real enough to act on, never a substitute
// for a translation, and the reason the heart-language gap stays exactly as it was.
//
// TWO EXCLUSIONS, both measured:
//   - SIGN LANGUAGES. 14 of these rows offer a Deaf people group a SPOKEN bridge. Gawri
//     "has a film" is of no use to Deaf Pakistanis, and suggesting it would be the same
//     error as offering them recorded audio.
//   - WEAK BRIDGES. 65 rows carry the curated strength "weak — shared by few groups; may
//     not be a real lingua franca". A bridge the source itself doubts is not an answer.
const bridges = {}
let bridgeRows = 0
try {
  const go = JSON.parse(readFileSync(GAPSOPP, 'utf8'))
  for (const r of go.rows || []) {
    if (r.heart_has_any) continue
    if (!(r.bridge_has_scripture || r.bridge_has_film)) continue
    if (/^weak/.test(r.bridge_strength || '')) continue
    const code = r.heart_iso639_3
    const iso3 = r.iso3
    if (!code || !iso3) continue
    if (codes[code] && codes[code].sg === 1) continue
    bridges[`${code}|${iso3}`] = {
      l: r.bridge_language || '',
      c: r.bridge_iso639_3 || '',
      st: r.bridge_strength || '',
      n: r.bridge_groups_in_country || 0,
      s: !!r.bridge_has_scripture,
      f: !!r.bridge_has_film,
    }
    bridgeRows++
  }
} catch { /* the curated table is optional; without it the map simply says less */ }

// Drop anything verification proved dead. THIS MUST RUN AFTER EVERY SOURCE HAS ATTACHED:
// it used to sit before the audio merge, so 71 dead bible.is filesets were attached after
// the drop had already happened and shipped anyway, while the pass reported "dropped 0".
// A cleanup step that runs before the thing it cleans is worse than none, because its
// reassuring count is measuring an empty room.
let droppedDead = 0
if (dead.size) {
  for (const v of Object.values(codes)) {
    if (v.s && dead.has(v.s)) { delete v.s; delete v.sv; delete v.ss; droppedDead++ }
    if (v.f && dead.has(v.f)) { delete v.f; droppedDead++ }
    if (v.z && dead.has(v.z)) { delete v.z; droppedDead++ }
    if (v.za && dead.has(v.za.u)) { delete v.za; droppedDead++ }
    if (v.au && dead.has(v.au.u)) { delete v.au; droppedDead++ }
    if (v.bv && dead.has(v.bv.u)) { delete v.bv; droppedDead++ }
    if (v.gp && dead.has(v.gp.u)) { delete v.gp; droppedDead++ }
    if (v.se && dead.has(v.se.u)) { delete v.se; droppedDead++ }
    if (v.ga && dead.has(v.ga.u)) { delete v.ga; droppedDead++ }
    if (v.d) {
      const before = v.d.length
      v.d = v.d.filter((x) => !dead.has(x.u))
      droppedDead += before - v.d.length
    }
  }
}

// ═══ A RELATED VARIETY THAT DOES HAVE SOMETHING ═══════════════════════════════════════
// The largest entry in this map's gap list is "Chinese, Jinyu — 60.3M — nothing found",
// then Gan at 41.3M. Both statements are true about those ISO codes and both are misleading
// as PRIORITIES: ISO files them under macrolanguage `zho` beside `cmn`, which has Scripture,
// film, audio and training here. Read top-down, the gap list was sending a worker to the two
// places least likely to need them. Measured: 84 pins covering 140M people.
//
// THIS IS NOT A CLAIM OF INTELLIGIBILITY and must never be shown as one. Spoken Jinyu and
// spoken Mandarin are not mutually intelligible; what they share is a written standard. The
// only thing asserted is ISO's own relation, and the reader is told exactly that.
// It changes NO tier and closes NO gap: the group still has nothing in its own variety.
let macroOf = {}, macroMembers = {}
try {
  const j = JSON.parse(readFileSync(MACRO, 'utf8'))
  macroOf = j.macroOf || {}
  macroMembers = j.members || {}
} catch { macroOf = {}; macroMembers = {} }

const resCount = (v) => (v ? (v.s ? 1 : 0) + (v.f ? 1 : 0) + (v.au ? 1 : 0) + (v.bv ? 1 : 0) + ((v.d && v.d.length) ? 1 : 0) : 0)
let relatedCodes = 0
for (const [c, v] of Object.entries(codes)) {
  if (resCount(v)) continue                       // only for codes with nothing of their own
  const m = macroOf[c]
  if (!m) continue
  let best = null
  for (const sib of macroMembers[m] || []) {
    if (sib === c) continue
    const n = resCount(codes[sib])
    if (n && (!best || n > best.n)) best = { c: sib, n, l: codes[sib].l || sib }
  }
  if (!best) continue
  v.rel = { m, c: best.c, l: best.l }
  relatedCodes++
}

/**
 * ═══ ONE DEFINITION OF THE TIER, AND IT IS PUBLISHED PER CODE ═════════════════════════════
 *
 * The tier used to exist only ON A PIN, which meant a language with no pin had no tier at all.
 * That is not a rare corner: `codes` is keyed from the RESOURCE pools and `pins` from the
 * people-group dataset, so a language can be fully researched and carry no pin.
 *
 * MEASURED, and it was the worst case available. Gazan Arabs — 2,315,000 people, the second
 * largest population this map draws — speaks South Levantine Arabic (ajp). ZERO pins carry ajp,
 * so no tier existed for it; the roster's stored copy said 0, and the map painted 2.3 million
 * people RED as "nothing found" while the index held a Scripture Earth PDF and a Zume course in
 * their language, and the access table beside it already said "read". It was also, because of
 * that, the one group on the map shown as having nothing AND no way in.
 *
 * So the tier is computed here for EVERY code the index knows and published as `tiers`. Surfaces
 * read it. They do not re-derive it from the resource fields — that is the drift the surfaces
 * gate exists to stop, and a roster storing its own copy is the same drift with extra steps.
 */
/* ⚠ DEFINED ABOVE tierOfCode ON PURPOSE. tierOfCode calls it, and a const arrow declared later is
   in its temporal dead zone — the build threw "Cannot access 'hasReadableScripture' before
   initialization" and I read the UNCHANGED file afterwards and reported the fix as measured. It was
   not. Order matters here, so the order is stated rather than left to luck. */
/* Imported from ../gospel-resource-rows.js — see the note there on why this has one owner. */
const tierOfCode = (c) => {
  if (!c) return 0
  /* ⚠ THE TIER TESTED c.s WHILE THE REST OF THIS BUILD TESTED hasReadableScripture(). One field
     against four sources, in the most load-bearing function here: tier 2 means "Scripture AND
     film", and a language whose readable text is on the Faith Comes By Hearing record (au.m names
     the media it holds), on Scripture Earth, or in a Door43 translation was scored 1 — "some
     resource found" — while its own text and the JESUS Film both existed.
     Measured on this corpus: 602 codes and 2,001 of 12,379 groups move 1 -> 2. Tier 0 does not
     move at all (1,592 before and after), so nothing about who has NOTHING changes — the gap
     lists, the 369 zero-access groups and the bridge-reach table are untouched by this.
     Found by a cross-check of 20 languages with "no NT in the pools": 13 of the 20 had
     readable text all along, on a record this function could not see. */
  const hasS = hasReadableScripture(c), hasF = !!c.f
  const hasD = !!(c.d && c.d.length)
  const hasA = !!c.au, hasBV = !!c.bv, hasSE = !!c.se, hasGA = !!c.ga
  return hasS && hasF ? 2 : (hasS || hasF || hasD || hasA || hasBV || hasSE || hasGA) ? 1 : 0
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const pins = []
let joined = 0, withUrl = 0, noCoord = 0, liftedByD43 = 0, liftedByAudio = 0, liftedBySE = 0
for (const p of slim) {
  const lat = num(p.Lat), lng = num(p.Long)
  if (lat === null || lng === null) { noCoord++; continue }
  const code = p.LanguageCode || ''
  const c = codes[code]
  if (c) joined++
  const hasS = !!(c && c.s), hasF = !!(c && c.f)
  const hasD = !!(c && c.d && c.d.length)
  const hasA = !!(c && c.au)
  const hasBV = !!(c && c.bv)
  const hasSE = !!(c && c.se)
  const hasGA = !!(c && c.ga)
  if (hasS || hasF || hasD || hasA || hasBV || hasSE || hasGA) withUrl++
  if (!hasS && !hasF && hasD) liftedByD43++
  if (!hasS && !hasF && !hasD && (hasA || hasBV)) liftedByAudio++
  if (!hasS && !hasF && !hasD && !hasA && !hasBV && hasSE) liftedBySE++
  // tier 2 = Scripture AND film · 1 = SOMETHING found · 0 = nothing in any pool checked.
  // A Door43 resource lifts a group out of tier 0 because "nothing found" is then simply
  // untrue for them — but it never reaches tier 2, which is reserved for Scripture + film.
  const tier = tierOfCode(c)
  pins.push([
    p.Name || '',
    Math.round(lat * 100) / 100,
    Math.round(lng * 100) / 100,
    p.ISOAlpha3 || '',
    code,
    num(p.Population) || 0,
    tier,
  ])
}

/**
 * ═══ THE WEAKER COUSIN OF A BRIDGE, COMPUTED HERE SO BOTH SURFACES READ ONE SOURCE ══════
 *
 * `bridges` above comes from the curated gaps-and-opportunities table and covers 168 of
 * Doxa's 369 groups with nothing. For the rest a CANDIDATE is computable straight from this
 * index: the largest language in their country that carries both Scripture and the film.
 *
 * It lives here rather than in the access-table builder because the map sheet and the table
 * must not disagree about what a group's next step is — the same rule that put the tier in
 * one place. The access table used to compute this for itself, which meant the table offered
 * 107 groups a candidate while the map showed them nothing at all.
 *
 * NO STRENGTH IS ATTACHED, on purpose. Ranking needs "is this a lingua franca" and neither
 * proxy survives: by group count Oman picks Swahili for an Arabic-speaking people, and by
 * population share a 10% floor refuses Urdu in Pakistan. So the candidate ships with its
 * group count and its share of the country's pinned population, and the reader judges.
 *
 * NEVER FOR A SIGN LANGUAGE. A spoken bridge is not a bridge for a Deaf community — the same
 * reason GRN is skipped for them above.
 */
const bridgeCandidates = {}
/**
 * ONE definition of "this language has a readable Scripture", used by both pickers below.
 *
 * ⚠ WRITTEN OUT TWICE FIRST, AND THE SECOND COPY WAS A FIELD SHORT — it checked s, se and d and
 * forgot that Faith Comes By Hearing carries TEXT on the audio record (au.m says so). MEASURED:
 * Bambara has the JESUS Film and a 66-book FCBH text Bible, and was filtered out of Mali's
 * bridge candidates for lack of Scripture, handing the recommendation to French. Bambara is
 * Mali's vehicular language. That is the field-list-goes-stale bug the surfaces gate exists for,
 * reproduced inside a build script where no gate was watching.
 */
/* What each country actually speaks, with each language's share OF THE COUNTRY. Absent input is
   not fatal: every candidate then falls back to the pinned-population proxy, as before. */
let countryLangs = {}
try {
  countryLangs = JSON.parse(readFileSync(resolve(REPO, 'data/tables/country-languages.json'), 'utf8')).byCountry || {}
} catch { /* no CLDR table in this tree */ }

/**
 * ═══ CLDR NAMES A MACROLANGUAGE; SCRIPTURE IS PUBLISHED IN A VARIETY ══════════════════════
 *
 * This is why the Arabian peninsula fell back to the weak proxy, and it fell back badly:
 * Saudi Arabia was offered URDU. CLDR says Arabic (ara) is spoken by 100% of Saudi Arabia, 81%
 * of Oman, 74% of Libya, 100% of Kuwait — but `ara` is a MACROLANGUAGE and nothing is published
 * under it. The index keys resources under the varieties: arb has the JESUS Film, ara has
 * nothing. Same for Chinese in Taiwan — zho empty, the resources sit under cmn.
 *
 * So the join asked for a code that, by the standard's own design, no publisher uses. The five
 * countries this hit are among the least reached on earth, which is exactly where a bad bridge
 * recommendation costs the most.
 *
 * Resolved through SIL's own macrolanguage membership, never by guessing from names, and the
 * SHARE STAYS THE MACROLANGUAGE'S. "Arabic is spoken by 100% of this country" is the true
 * statement; "Standard Arabic is spoken by 100%" would not be, so the variety is carried
 * separately for the surfaces to word honestly.
 * Reuses the macroMembers already loaded above for the related-variety note — one read of SIL's
 * table, one meaning of membership.
 */
{
  const pool = {}
  const cpop = {}
  for (const p of pins) {
    const iso3 = p[3], code = p[4], pop = p[5] || 0
    if (!iso3 || !code) continue
    const c = codes[code]
    if (!c) continue
    cpop[iso3] = (cpop[iso3] || 0) + pop
    const e = (pool[iso3] ||= {})
    const slot = (e[code] ||= { n: 0, pop: 0, l: c.l || '', s: false, f: false })
    slot.n += 1
    slot.pop += pop
    slot.s = slot.s || hasReadableScripture(c)
    slot.f = slot.f || !!c.f
  }
  /**
   * ⚠ THE sg FLAG IS NOT ENOUGH, AND THE MAP WAS THE SURFACE THAT PAID FOR IT.
   *
   * sg is set from the sign-language catalogues, and a sign language absent from them never
   * gets it: codes.asf (Auslan) carries no sg at all. So this loop happily built a SPOKEN
   * bridge for three Deaf groups — Cocos Deaf, Deaf Christmas Islanders, Deaf Norfolk
   * Islanders — and the map offered it to them, because the map's own is_sign test reads the
   * same flag. The access table did not, because it also matches the group NAME, which is how
   * the disagreement surfaced: 182 rows had a bridge carrying Zume and only 179 could export
   * one.
   *
   * A spoken bridge is not a weak bridge for a Deaf community, it is not a bridge — the same
   * finding that already removed 89 of these. This suppresses on either signal, so the two
   * builders now agree and the map cannot offer what the table refuses.
   */
  const isDeafPin = (name, code) =>
    (codes[code] && codes[code].sg === 1) ||
    /sign language/i.test((codes[code] && codes[code].l) || '') ||
    /\bDeaf\b/i.test(name || '')

  for (const p of pins) {
    const iso3 = p[3], code = p[4]
    if (!iso3 || !code || p[6] !== 0) continue
    if (isDeafPin(p[0], code)) continue
    const key = `${code}|${iso3}`
    if (bridges[key] || bridgeCandidates[key]) continue
    /* ═══ ASK WHAT THE COUNTRY SPEAKS, NOT WHAT THE UNREACHED SPEAK ═══════════════════════
     * The pin-derived pick below answers "the biggest language among Doxa's UNREACHED groups
     * here", which is not the language a community shares with its neighbours. For Syenara
     * Senufo in Mali it proposed Minianka — one people group — while Mali's vehicular language
     * is Bambara at 46% of the country. CLDR is asked first, and only it can supply a share OF
     * THE COUNTRY, which is the denominator a reader assumes when they see a percentage.
     * Still filtered by what this index can actually offer: a bridge with no Scripture and no
     * film behind it is a name, not a way in. */
    /* Richest first, so a macrolanguage resolves to the variety with the most behind it rather
       than whichever member happens to sort first. */
    const offers = (cc) => codes[cc] && !!codes[cc].f && hasReadableScripture(codes[cc])
    const resolveMacro = (x) => {
      if (offers(x.c)) return { ...x }
      const members = macroMembers[x.c] || []
      const best = members.filter(offers)
        .sort((a, b) => Object.keys(codes[b]).length - Object.keys(codes[a]).length)[0]
      /* The percentage belongs to the macrolanguage, which is what CLDR measured; the variety is
         where the Scripture actually is. Both travel, so neither claim gets overstated. */
      return best ? { ...x, c: best, macro: x.c, macroName: x.l } : null
    }
    const spoken = (countryLangs[iso3] || [])
      .filter((x) => x.c !== code)
      .map(resolveMacro)
      .filter(Boolean)
      .filter((x) => x.c !== code)
    /* Official status breaks a tie between equal shares — Mali's French and Bambara are both
       46% — because the official one is the likelier second language to already be taught. */
    const ranked = spoken.sort((a, b) => (b.pct - a.pct) || (b.official - a.official))
    const cldrBest = ranked[0]
    if (cldrBest) {
      /* ⚠ WHEN TWO LANGUAGES ARE TIED, PICKING ONE IS AN EDITORIAL ACT, NOT A MEASUREMENT.
       * Mali is exactly this: French 46% and official, Bambara 46% and not. French is the
       * administrative language, Bambara is what people actually share in a market or a
       * village, and which one bridges better depends on whether the reader is handing over
       * a booklet or starting a conversation. The panel already says the choice is a local
       * question; so where a runner-up is within five points, BOTH are shipped and the reader
       * decides. A tie-break here would have quietly answered a question nobody asked it. */
      const alt = ranked[1] && (cldrBest.pct - ranked[1].pct) <= 5 ? ranked[1] : null
      const shape = (x) => ({
        l: codes[x.c]?.l || x.l,
        c: x.c,
        pct: x.pct,
        official: x.official,
        ...(x.macro ? { macro: x.macro, macroName: x.macroName } : {}),
      })
      bridgeCandidates[key] = { ...shape(cldrBest), src: 'cldr', ...(alt ? { alt: shape(alt) } : {}) }
      continue
    }
    /* FALLBACK, and it says so on the row. CLDR lists no language here that this index can
       offer, so the old proxy is better than nothing — but its percentage is a share of the
       PINNED population, a different denominator, and the surfaces read `src` to say which. */
    const best = Object.entries(pool[iso3] || {})
      .filter(([cc, s]) => cc !== code && s.s && s.f)
      .sort((a, b) => b[1].pop - a[1].pop)[0]
    if (!best) continue
    const tot = cpop[iso3] || 0
    bridgeCandidates[key] = {
      l: best[1].l, c: best[0], n: best[1].n,
      pct: tot ? Math.round((1000 * best[1].pop) / tot) / 10 : 0,
      src: 'pins',
    }
  }
}


/**
 * ═══ THE DEAF BRIDGE TRAVELS WITH THE INDEX ═══════════════════════════════════════════════
 *
 * SUN reached the access table and the CSV first, and the MAP — the surface a mobiliser
 * actually opens — still showed Deaf groups a panel that explained their situation and offered
 * no way out of it. That is the largest population on this map with nothing: 93 groups, 17.5
 * million people.
 *
 * Carried here rather than fetched by the leaf, for the same reason the bridges are: one
 * source, so the sheet and the table cannot disagree about what exists. It is a single small
 * object, not a per-language join — SUN is ONE signed language for all of them, which is the
 * whole point of it.
 *
 * Absent input is not fatal: the map simply shows what it showed before.
 */
let sun = null
try {
  const raw = JSON.parse(readFileSync(resolve(REPO, 'data/tables/sun-deaf-index.json'), 'utf8'))
  const pick = (k) => (raw.resources || []).find((r) => r.key === k)
  const scripture = pick('new_testament') || (raw.resources || [])[0]
  sun = {
    publisher: raw.meta?.publisher || '',
    scripture: scripture ? { u: scripture.url, t: scripture.label } : null,
    stories: (() => { const r = pick('bible_stories'); return r ? { u: r.url, t: r.label } : null })(),
    about: (() => { const r = pick('home'); return r ? r.url : '' })(),
    /* Country -> the local Deaf church or organisation already teaching it. A named partner is
       the difference between a resource and somebody to call. */
    byCountry: Object.fromEntries((raw.projects || []).map((p) => [
      String(p.country || '').toLowerCase().replace(/[^a-z]/g, ''), p.organisation,
    ])),
  }
} catch { /* no SUN index in this tree: the Deaf panel stays as it was */ }

/**
 * WHO TRANSLATED IT — AND HOW TO REACH THEM. Attribution for Scripture already in the index. The
 * NAME still comes from eBible exactly as eBible wrote it; the CONTACT URL comes only from
 * data/tables/translator-org-links.json, a hand-screened allowlist whose every entry this build
 * fetched. eBible's own homeDomain field is still not used, so no publisher can enter this map
 * through a data refresh without passing the doctrine screen.
 * It adds no resource and moves no tier; it is attached AFTER tierOfCode is defined precisely
 * because it must not participate in tiering.
 */
let credited = 0, contactable = 0
let orgLinks = {}
try {
  const t = JSON.parse(readFileSync(resolve(REPO, 'data/tables/translator-org-links.json'), 'utf8'))
  for (const [id, o] of Object.entries(t.orgs || {})) {
    /* Only what the verifier actually reached this run. `unknown` is not shipped and is not an
       error either — the credit simply keeps naming the org without a link. */
    if (o.state !== 'verified') continue
    orgLinks[id] = { url: o.url, match: (o.match || []).map((m) => new RegExp(m.s, m.f || '')) }
  }
} catch { /* no org table: credits stay names, which is what they were before */ }

/* THE EARLIEST NAME IN THE STRING WINS, not the first pattern in the file. "Pioneer Bible
   Translators and The Word for the World International" is led by Pioneer, and a credit's lead
   organisation is the one to ask; ordering by the allowlist instead would have answered TWFTW. */
const orgFor = (credit) => {
  let best = null
  for (const [id, o] of Object.entries(orgLinks)) {
    for (const re of o.match) {
      const m = re.exec(credit)
      if (m && (!best || m.index < best.at)) best = { id, url: o.url, at: m.index }
    }
  }
  return best
}

try {
  const cr = JSON.parse(readFileSync(resolve(REPO, 'data/tables/translation-credits.json'), 'utf8')).byCode || {}
  for (const [code, v] of Object.entries(cr)) {
    if (!codes[code] || !v.org) continue
    codes[code].cr = v.year ? { o: v.org, y: v.year } : { o: v.org }
    const org = orgFor(v.org)
    if (org) { codes[code].cr.u = org.url; codes[code].cr.g = org.id; contactable++ }
    credited++
  }
} catch { /* no credits table: the sheet simply does not name a translator */ }

/* ═══ WHERE THAT READABLE SCRIPTURE ACTUALLY IS ═══════════════════════════════════════════════
 * The tier now counts text the surfaces could not link, which would be its own lie: a group marked
 * "Scripture and film" whose sheet shows only a film. `sx` is the readable text with its source
 * named, computed ONCE here so no surface re-derives it — the same rule as the tier itself. */
for (const [, c] of Object.entries(codes)) {
  if (c.s) continue
  const fcbh = c.au && /text/.test(c.au.m || '') ? c.au : null
  if (fcbh) {
    /* ⚠ SAY WHAT IT IS, NOT ONLY THAT IT EXISTS. FCBH publishes its own verse scope as
       "N parts, FIRST to LAST" (au.vsc), and 567 of these 766 carry one: 400 New Testaments, 41
       full Bibles, the rest partial. A catalyst standing with a group needs to know whether the
       link is a whole Bible or two books, and the data said so all along. 27 and 66 are named;
       anything else is reported as the part count FCBH claims, never rounded up to a Testament.
       It is their claim, cited — nobody here has opened those filesets and counted books. */
    const m = /^(\d+) parts/.exec(String(fcbh.vsc || ''))
    const parts = m ? Number(m[1]) : 0
    /* ⚠ A NUMBER, NOT AN ENGLISH PHRASE. This first shipped scope as the words "full Bible" /
       "New Testament" / "N parts" — English baked into DATA, which no locale can translate and no
       catalogue owns. The part count is the fact; naming it is the surface's job. */
    c.sx = { u: fcbh.u, n: fcbh.n || '', src: 'Faith Comes By Hearing', parts }
    continue
  }
  if (c.se) { const u = typeof c.se === 'string' ? c.se : c.se.u; if (u) { c.sx = { u, n: '', src: 'Scripture Earth' }; continue } }
  const d43 = (c.d || []).find((d) => !/^Open Bible Stories/.test(d.s || ''))
  if (d43 && d43.u) c.sx = { u: d43.u, n: d43.s || '', src: 'Door43' }
}

if (process.env.SX_DEBUG) console.log('SX_DEBUG: codes with sx before tiers =', Object.values(codes).filter((c) => c.sx).length)
const tiers = {}
for (const [code, c] of Object.entries(codes)) tiers[code] = tierOfCode(c)

/* The same population and the same evidence the stale-claim gate uses, so a surface quoting these
   two numbers cannot disagree with the gate that judges the sentence they appear in. grnSeen is
   already that set — every code the sweep DECIDED, found or explicitly not found — and reusing it
   rather than rebuilding it is the point: a second copy could drift from the one the tiers were
   computed against. */
const grnGap = [...new Set(pins.filter((p) => tiers[p[4]] === 0 && p[4] && codes[p[4]] && codes[p[4]].sg !== 1).map((p) => p[4]))]
const grnPending = grnGap.filter((c) => !grnSeen.has(c))

const out = {
  tiers,
  sun,
  bridges,
  bridgeCandidates,
  _note: 'Generated by scripts/build-people-group-pins.mjs. pins=[name,lat,lng,iso3,code,pop,tier]; URLs live in codes[] by ISO 639-3. No URL is invented here.',
  generated: new Date().toISOString().slice(0, 10),
  /* ═══ HOW MUCH OF THE GRN SWEEP IS ACTUALLY LEFT ══════════════════════════════════════════
   * The surfaces carry a caveat saying the GRN pool is "partly read, the sweep is still running".
   * That is TRUE — check:no-stale-sweep-claim measures it and skips, because a code really is
   * undecided — and it is also badly misleading, because it is ONE code out of 1,184: a reader
   * discounts the whole audio column on the strength of 0.08%. The proportion is the honest form
   * of that sentence, so the numbers ship here and the surfaces can state them instead of
   * gesturing. Counted exactly as the gate counts: the codes the caveat SPEAKS FOR — tier 0, sign
   * languages excluded because GRN publishes audio for them — against what GRN has decided,
   * indexed or explicitly none. */
  counts: {
    pins: pins.length, joined, withUrl, liftedByD43, codes: Object.keys(codes).length, droppedNoCoord: noCoord,
    grnGapCodes: grnGap.length, grnPending: grnPending.length,
  },
  codes,
  pins,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out))

// Register in the table index so the count is discoverable the way every other table is.
const idx = JSON.parse(readFileSync(INDEX, 'utf8'))
const entry = idx.tables.find((t) => t.name === 'people-group-pins')
if (entry) entry.rows = pins.length
else idx.tables.push({ name: 'people-group-pins', rows: pins.length })
writeFileSync(INDEX, JSON.stringify(idx, null, 1))
const pct = (n) => `${((100 * n) / pins.length).toFixed(1)}%`
console.log(`pins            ${pins.length}`)
// NOT a coverage number. Since every language is now named, this is ~100% by construction
// and means only "has a codes entry". The coverage number is the next line.
console.log(`has a code entry ${joined} (${pct(joined)})  <- naming, NOT coverage`)
console.log(`REAL URL        ${withUrl} (${pct(withUrl)})`)
console.log(`language codes  ${Object.keys(codes).length}`)
console.log(`door43 codes    ${Object.keys(d43).length}  (${d43Only} new)`)
console.log(`ebible codes    ${Object.keys(eb).length}  (${ebOnly} new)`)
console.log(`arclight codes  ${Object.keys(arc).length}  (${arcOnly} new, ${upgraded} upgraded to a real deep link)`)
console.log(`share urls      ${Object.keys(share).length}`)
console.log(`fcbh codes       ${audioCodes}  (${audioNew} new codes)`)
console.log(`gospel tracts    ${gospelCodes}  (Cru/GodTools presentations; depth only, tier UNCHANGED)`)
console.log(`translators named ${credited}\t(${contactable} reach a screened, fetched organisation homepage; no tier change)`)
console.log(`tiers published ${Object.keys(tiers).length}\t(one per code, so a language with no pin still has a tier)`)
console.log(`bridge candidates ${Object.keys(bridgeCandidates).length}  (computed here so the map sheet and the access table cannot disagree)`)
console.log(`in-country bridge ${bridgeRows}  (groups with NOTHING of their own; a widely-spoken language around them has something — never counted as theirs)`)
console.log(`gospel audio     ${grnCodes}  (${grnNew} new codes; GRN via 5fish — heard, not read; ${grnSignSkipped} sign language(s) skipped)`)
console.log(`scripture earth  ${seCodes}  (${seNew} new codes; SIL partners — Scripture in their own language)`)
console.log(`related variety  ${relatedCodes}  (nothing of their own; an ISO macrolanguage sibling has something — tier UNCHANGED)`)
console.log(`fcbh bible video ${videoCodes}  (a separate page; never counted as film) + ${videoMerged} merged into the Scripture link`)
console.log(`dead links dropped ${droppedDead}  (verification proved them 404; ${dead.size} known broken)`)
console.log(`zume languages  ${zumeCodes}  (${zumeNew} new codes; training only, tier unchanged)`)
console.log(`zume approximate ${zumeApproxCodes}  (published in the language, variety not stated; never counted as an exact join)`)
console.log(`named from cat  ${catNamed}  (no pin speaks them; named from a catalogue)`)
console.log(`sign languages  ${signCodes}`)
console.log(`named-only      ${namedOnly}  (language named, no resource in any pool checked)`)
console.log(`lifted off 0    ${liftedByD43}  (had nothing; now have a published Door43 resource)`)
console.log(`lifted by fcbh  ${liftedByAudio}  (had nothing; now have Scripture from FCBH in their own language)`)
console.log(`dropped nocoord ${noCoord}`)
console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`)
