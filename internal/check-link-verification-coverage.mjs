/**
 * check-link-verification-coverage.mjs — rule 4 of the brief, as a gate instead of a good habit.
 *
 * "Verify a URL resolves before shipping it." verify-gospel-links.mjs does the verifying and writes
 * the record; nothing asserted that the record COVERS what the build actually ships. So the honest
 * state of the corpus was a number somebody had to go and measure, and a number nobody re-measures
 * is a number that was true once.
 *
 * ⚠ THE URLS ARE DISCOVERED, NOT LISTED. Every other place in this bundle that walks the pin index
 * names the fields it reads — and that list has gone stale twice: `ga` (Words of Life) and `se`
 * (Scripture Earth) shipped unscreened because a field list written before those pools existed
 * could not see them, and the SUN block and the access table each had to be added after the fact.
 * This one recurses over the whole structure and treats ANY string that starts with http as a
 * shipped link. A new pool is then covered on the day it lands, without anyone remembering to come
 * here — which is the only kind of coverage check worth having.
 *
 * WHAT COUNTS AS A PASS:
 *   every shipped URL has an entry            — an unrecorded link has never been looked at
 *   no shipped URL is recorded BROKEN         — the builder drops dead links; if one survives, it
 *                                               is shipping against its own evidence
 *   `unknown` only on hosts that cannot be    — live.bible.is and knowgod.com answer 200 with
 *   checked by status, and always counted       identical bytes for any path, so a status check
 *                                               there is a false green, and the verifier says so
 *
 * Self-test: `--poison` adds a fabricated URL to the corpus, marks a shipped one broken, and moves
 * an `unknown` onto a host that IS checkable. All three arms must fire.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const POISON = process.argv.includes('--poison')

/* What cannot be proved by a status code, kept here as literals: a check that reads its own
   exemptions out of the file it is checking exempts whatever that file says.
   ⚠ THE LAST ENTRY IS A URL SHAPE, NOT A HOST, and that distinction is the whole point of the
   migration that preceded it: jesusfilm.org/watch/jesus/<slug> DOES discriminate (a bogus slug
   404s) and 2,049 film links became checkable because of it, while the older
   /watch/?languageId=<n> form renders byte-identical pages for any id, valid or bogus. Exempting
   the host would have re-blinded every one of those 2,049. */
const STATUS_BLIND = [
  { re: /^(https?:\/\/)?([a-z0-9-]+\.)*(live\.bible\.is|bible\.is)(\/|$)/i, why: '200 with identical bytes for any fileset' },
  { re: /^(https?:\/\/)?([a-z0-9-]+\.)*knowgod\.com(\/|$)/i, why: 'page bytes identical; proved through Cru\'s API instead' },
  { re: /^(https?:\/\/)?([a-z0-9-]+\.)*sun\.bible(\/|$)/i, why: '200 for /sun/<anything>; proved by content' },
  { re: /jesusfilm\.org\/watch\/\?languageId=/i, why: 'the pre-shareUrl form renders the same bytes for any id' },
]
const statusBlind = (u) => STATUS_BLIND.find((x) => x.re.test(u)) || null

/* ⚠ A CONTACT IS VERIFIED SOMEWHERE ELSE, and the recursive walk found that out the honest way:
   it reported 18 unrecorded links, all of them `cr.u` — the translator organisations' own
   homepages. They were fetched on the run that wrote them, but by verify-translator-org-links.mjs
   into its OWN record, so gospel-link-verification.json has never heard of them. Resolving them
   against that second record is right; declaring them exempt would not be. */
let orgVerified = new Set()
try {
  const orgs = JSON.parse(readFileSync(resolve(REPO, 'data/tables/translator-org-links.json'), 'utf8')).orgs || {}
  orgVerified = new Set(Object.values(orgs).filter((o) => o.state === 'verified').map((o) => o.url))
} catch { /* no org record: those URLs then have no evidence anywhere, and must fail below */ }

/* SUN IS THE THIRD RECORD, and its evidence is STRONGER than a status code rather than weaker:
   sun.bible answers 200 for /sun/<anything>, so fetch-sun-deaf-index.mjs proves each page by
   CONTENT against a catch-all control (a bogus path returns 904 characters; the New Testament page
   returns 22,043). The recursive walk found these three the same way it found the contacts — by not
   knowing which fields were supposed to hold links. */
/* PRAYER PAGES ARE PROVED BY A LISTING, NOT A FETCH — the fourth record, and the reason is in
   fetch-pray-index.mjs: pray.doxa.life answers 200 with identical bytes for ANY slug, so a status
   check there is a false green. Existence comes from doxa.life's own /api/people-groups/list, and
   every URL this build ships is built from a slug that listing returned. A pray.doxa.life URL that
   is NOT in that index is therefore a CONSTRUCTED one, and must fail here. */
let prayListed = new Set()
try {
  const pray = JSON.parse(readFileSync(resolve(REPO, 'data/tables/pray-index.json'), 'utf8')).byKey || {}
  for (const e of Object.values(pray)) if (e && e.u) prayListed.add(e.u.split('?')[0])
} catch { /* no prayer index: those URLs then have no evidence, and must fail below */ }
/* ⚠ THE INDEX IS A SUBSET AND THE ROSTER IS THE LISTING. pray-index.json holds only the 1,723
   groups whose (name, country) matched a pin; the access table ships a prayer link for all 2,107,
   so 809 of them were reported unrecorded here. They are not unproved — doxa-people-groups.json IS
   the API listing, one row per group with the slug doxa.life returned, and the index is that
   listing narrowed by a join this check has no business requiring. */
try {
  const roster = JSON.parse(readFileSync(resolve(REPO, 'data/tables/doxa-people-groups.json'), 'utf8')).rows || []
  for (const r of roster) if (r && r.pray_url) prayListed.add(String(r.pray_url).split('?')[0])
} catch { /* no roster: the subset above still covers what it covers */ }

let sunVerified = new Set()
try {
  const sun = JSON.parse(readFileSync(resolve(REPO, 'data/tables/sun-deaf-index.json'), 'utf8'))
  if ((sun.meta || {}).catch_all_control) sunVerified = new Set((sun.resources || []).map((r) => r.url))
} catch { /* no SUN record: its links then have no evidence, and must fail below */ }

const fails = []
const idx = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))
const verif = JSON.parse(readFileSync(resolve(REPO, 'data/tables/gospel-link-verification.json'), 'utf8')).links || {}

/** Every http string anywhere in the structure, with a breadcrumb of where it was found. */
const found = new Map()
const walk = (node, path) => {
  if (node == null) return
  if (typeof node === 'string') {
    /* A citation is not an offer. `source`, `_note` and everything under `meta` record WHERE the
       data came from — an API endpoint, a licence page — and no surface renders them as links. */
    if (/(^|\.)(meta|_note|source|sources|site|fetchedFrom|licenceSource|boundarySource|why|note)(\.|$|\[)/.test(path)) return
    if (/^https?:\/\//i.test(node) && !found.has(node)) found.set(node, path)
    return
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return }
  if (typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
}
walk(idx.codes, 'codes')
walk(idx.sun, 'sun')
walk(idx.bridges, 'bridges')
walk(idx.bridgeCandidates, 'bridgeCandidates')

/* ⚠ THE PIN INDEX IS NOT THE ONLY THING SHIPPED, and scoping this check to it repeated the very
   blind spot it was written to close: people-group-resources.json — the "Resources by People
   Group" tab — was serving 2,294 URL cells of which 1,412 were the retired jesusfilm
   ?languageId= form, links the site ignores, while the map beside it had been migrated onto
   Arclight shareUrls. Nothing saw it, because every check looked at one file.
 *
 * ⚠ AND THE SCOPE IS "WHAT A READER CAN CLICK", which is narrower than "what is staged". Reading
 * every staged file reported 6,115 unrecorded links and 53 broken ones, and NONE of them is
 * offered to anybody: they are API endpoints in `source` fields, and the raw upstream catalogues
 * (arclight-share-urls and friends) which are build CACHES that happen to sit in the same folder —
 * they still hold the 53 share URLs the verifier proved dead, which is exactly why the pin builder
 * drops them. Judging those as shipped would make this check red on correct behaviour, and a gate
 * that is red on correct behaviour gets switched off. So the scope is the tables the SURFACES
 * read, taken from the surfaces, plus provenance fields excluded by path. */
const SURFACES = [
  resolve(REPO, 'plugin-designs/gospel-resources/data-tables.vue'),
  resolve(REPO, 'plugin-designs/gospel-resources/resources-map.vue'),
  resolve(REPO, 'plugin-designs/gospel-resources/resources-list.vue'),
  resolve(REPO, 'plugin-designs/gospel-resources/charts.vue'),
]
const wanted = new Set()
for (const f of SURFACES) {
  let src = ''
  try { src = readFileSync(f, 'utf8') } catch { continue }
  for (const m of src.matchAll(/file:\s*'([a-z0-9-]+)'/gi)) wanted.add(`${m[1]}.json`)
  for (const m of src.matchAll(/tables\/([a-z0-9-]+)\.json/gi)) wanted.add(`${m[1]}.json`)
}
if (wanted.size < 5) fails.push(`only ${wanted.size} reader-facing table(s) found in the surfaces — the scope is not being derived, so this check would under-measure`)
const POOL = resolve(REPO, 'public', TREE_NAME, 'assets/tables')
for (const f of wanted) {
  /* The verification record is a LEDGER, deliberately keeping URLs proved dead; walking it would
     ask the record to vouch for itself. */
  if (f === 'gospel-link-verification.json') continue
  try { walk(JSON.parse(readFileSync(resolve(POOL, f), 'utf8')), `tables/${f}`) } catch (e) { fails.push(`${f} is read by a surface but could not be read here: ${e.message}`) }
}

if (POISON) found.set('https://ebible.org/this-was-never-verified/', 'codes.__poison.s')

const unrecorded = [], broken = [], unknownOnCheckable = []
let unknownBlind = 0, verified = 0, contacts = 0, byContent = 0, listed = 0
let poisonedBroken = false, poisonedUnknown = false
for (const [url, where] of found) {
  let e = verif[url]
  if (POISON && !poisonedBroken && e && e.state === 'verified') { e = { ...e, state: 'broken' }; poisonedBroken = true }
  else if (POISON && !poisonedUnknown && e && e.state === 'verified' && !statusBlind(url)) { e = { ...e, state: 'unknown' }; poisonedUnknown = true }
  if (!e && orgVerified.has(url)) { contacts++; continue }
  if (!e && sunVerified.has(url)) { byContent++; continue }
  /* The shipped URL may carry a tracking suffix the index does not (or vice versa); the SLUG is
     what the listing proved, so compare on origin+path. */
  if (!e && /pray\.doxa\.life/i.test(url)) {
    if (prayListed.has(url.split('?')[0])) { listed++; continue }
  }
  if (!e) { unrecorded.push(`${url} (${where})`); continue }
  if (e.state === 'broken') { broken.push(`${url} (${where})`); continue }
  if (e.state === 'unknown') {
    if (statusBlind(url)) unknownBlind++
    else unknownOnCheckable.push(`${url} — ${e.detail || 'no reason recorded'}`)
    continue
  }
  verified++
}

if (!found.size) fails.push('no URL found in the pin index at all — this check would pass vacuously')
if (unrecorded.length) fails.push(`${unrecorded.length} shipped link(s) have NO verification entry (e.g. ${unrecorded[0]})`)
if (broken.length) fails.push(`${broken.length} shipped link(s) are recorded BROKEN (e.g. ${broken[0]})`)
if (unknownOnCheckable.length) fails.push(`${unknownOnCheckable.length} link(s) are 'unknown' on a host that CAN be checked by status (e.g. ${unknownOnCheckable[0]})`)

if (POISON) {
  const want = ['have NO verification entry', 'recorded BROKEN', "'unknown' on a host that CAN be checked"]
  const missed = want.filter((w) => !fails.some((f) => f.includes(w)))
  if (missed.length) { console.error(`LINK-COVERAGE --poison: these arms did NOT fire: ${missed.join(' | ')}`); process.exit(1) }
  console.log(`LINK-COVERAGE --poison: PASS — all 3 arms fired (${fails.length} failure(s)).`)
  process.exit(0)
}
if (fails.length) {
  console.error(`LINK-COVERAGE: FAIL — ${fails.length} problem(s):`)
  for (const f of fails) console.error(`  ${f}`)
  console.error('  Fix: node plugin-designs/gospel-resources/scripts/verify-gospel-links.mjs')
  process.exit(1)
}
console.log(`LINK-COVERAGE: PASS — ${found.size} distinct shipped link(s): ${verified} verified by fetch, ` +
  `${contacts} translator contact(s) and ${byContent} SUN page(s) verified in their own records, ` +
  `${listed} prayer page(s) proved by doxa.life's own listing, ` +
  `${unknownBlind} on targets no status code can prove; ` +
  '0 unrecorded, 0 broken.')
