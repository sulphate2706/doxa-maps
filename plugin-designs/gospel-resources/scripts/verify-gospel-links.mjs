#!/usr/bin/env node
/**
 * verify-gospel-links.mjs — fetch EVERY link this map ships and record whether it resolves.
 *
 * The rule is that a URL is verified to resolve before it ships. This is the script that
 * discharges it, and it now checks the corpus the map actually holds rather than the one it
 * held in August.
 *
 * ═══ WHAT WAS WRONG BEFORE ══════════════════════════════════════════════════════════════
 * The previous table carried 426 entries against a corpus that has since grown to 3,603
 * links, and — worse — the UI matched only TWO of them. Two causes, both silent:
 *   1. Its eBible keys were written as http:// while the index now ships https:// (every
 *      URL passes through httpsify), so an exact key lookup missed all 120.
 *   2. Its 306 film keys were the old jesusfilm.org/watch/?languageId=N URLs, which were
 *      later replaced wholesale by Arclight shareUrl deep links. Those keys no longer
 *      exist in the index at all.
 * So the map displayed "unchecked" on links that HAD been verified, and a reader had no way
 * to tell that from a link nobody had ever looked at.
 *
 * ═══ THE FINDING THAT MAKES THIS POSSIBLE ═══════════════════════════════════════════════
 * The old note in this file said the film page was "unverifiable by fetch", and for the URL
 * shape it was written against that was exactly right:
 *
 *     jesusfilm.org/watch/?languageId=13562   (valid) -> 200, 1,024,615 bytes, md5 e8938c31
 *     jesusfilm.org/watch/?languageId=99999999 (bogus) -> 200, 1,024,615 bytes, md5 e8938c31
 *
 * Byte-identical: a status check there is a false green. But the index no longer ships that
 * shape. It ships Arclight's own shareUrl, which is a real PATH, and a path discriminates:
 *
 *     jesusfilm.org/watch/jesus/german-standard      -> 200, 944,516 bytes
 *     jesusfilm.org/watch/jesus/pashto-yusufzai      -> 200, 810,741 bytes  (distinct body)
 *     jesusfilm.org/watch/jesus/definitely-not-xyzzy -> 404
 *     jesusfilm.org/watch/jesus/                     -> 404
 *
 * Migrating to shareUrl made 2,049 film links checkable for the first time. The 5 remaining
 * ?languageId= URLs are still unverifiable by fetch and are recorded as `unknown` with that
 * reason — never as verified, and never as broken.
 *
 * ═══ METHOD PER HOST, EACH ONE MEASURED, NOT ASSUMED ════════════════════════════════════
 * Every host below was probed with a known-good and a known-bad URL before being trusted,
 * and all of them answer HEAD and discriminate 200/404:
 *   ebible.org, png.bible, alkitab.pw   real -> 200, bogus code -> 404
 *   jesusfilm.org /watch/jesus/<slug>   real -> 200, bogus slug -> 404
 *   arc.gt/<short>                      real -> 200 (redirects to a language page), bogus -> 404
 *   git.door43.org/<owner>/<repo>       real -> 200, bogus repo -> 404
 *   zume.training/<locale>              real -> 200, bogus locale -> 404
 * HEAD is used deliberately: a GET over 2,049 film pages is ~1.6GB off someone else's
 * bandwidth to learn a status code.
 *
 * ═══ THE CONTROLS ARE NOT OPTIONAL ══════════════════════════════════════════════════════
 * A check that cannot be shown to fail proves nothing, so both directions run IN BAND before
 * any result is trusted, and the script ABORTS rather than write a table if either arm
 * misbehaves. A negative control that starts passing is how a whole corpus quietly turns
 * green; a positive control that starts failing is how a network fault gets written down as
 * "every link is broken".
 *
 * ═══ THE TABLE IS A RECORD, NOT A SNAPSHOT ══════════════════════════════════════════════
 * A dead link is dropped from the index by the builder, which removes it from the corpus —
 * so a verifier that only ever checks "what is shipped today" forgets it, and the NEXT build
 * finds nothing recorded against it and puts it straight back. Measured: both links this
 * pass killed were restored by the very next build. The drop was self-erasing, and the
 * coverage floor could not see it because two unrecorded URLs out of 3,768 is 99.9%.
 *
 * So the corpus checked here is the shipped URLs PLUS every URL a previous run recorded
 * broken. Those keep being re-tested, which is also what lets a link the publisher later
 * fixes come back on its own rather than staying condemned forever.
 *
 * ═══ HOW TO RUN IT ══════════════════════════════════════════════════════════════════════
 *   node scripts/verify-gospel-links.mjs                 full pass, checkpointing as it goes
 *   VERIFY_MAX_AGE_H=24 ...                              resume: skip anything checked in 24h
 *   VERIFY_MISSING=1 ...                                 only URLs with no record at all
 *   VERIFY_RETRY_UNKNOWN=1 ...                           only the ones a host throttled
 *   VERIFY_LIMIT=N ...                                   smoke test; writes NOTHING
 *   VERIFY_BATCH / VERIFY_CONCURRENCY                    batch size and parallelism
 *
 * A full pass is ~6,500 requests over roughly a quarter of an hour, and it is long enough to
 * be killed — this one was, twice, by system memory pressure at around 2,500. Results used
 * to live only in memory until the final write, so each kill threw away every request it had
 * made. The file on disk survived, which is correct, but the pass never landed and the
 * bandwidth was spent for nothing.
 *
 * Now every record carries `at`, the moment it was checked, and the table is written after
 * each batch. A killed run loses at most one batch, and re-running with VERIFY_MAX_AGE_H
 * skips whatever already has a fresh stamp. Writing mid-pass is safe because a checkpoint
 * only ADDS to or REFRESHES records — it can never shrink the table, which is the failure
 * the snapshot guard exists for elsewhere.
 *
 * WHAT `verified` MEANS HERE, EXACTLY: the URL answered 200 to a HEAD that followed
 * redirects. It does NOT mean anyone read the page, and it does not re-check that the link
 * points at the right LANGUAGE — that join is established when the index is built, from the
 * publishers' own catalogues. This catches a dead or moved link, which is the failure a
 * field worker actually hits.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const OUT = resolve(REPO, 'data/tables/gospel-link-verification.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY || 8)
// Re-test ONLY the entries a previous run left "unknown" because the host throttled it.
// Pacing cut those from 466 to 48, and the last few are not worth another full pass over
// 5,958 URLs — but leaving 48 shipped links unproven is not the job either.
const RETRY_UNKNOWN = process.env.VERIFY_RETRY_UNKNOWN === '1'
// Verify only the shipped URLs that appear in NO record yet. The full pass takes a quarter
// of an hour; adding one resource should not.
const ONLY_MISSING = process.env.VERIFY_MISSING === '1'
const LIMIT = Number(process.env.VERIFY_LIMIT || 0) // 0 = all; used by the smoke run

/** A ?languageId= film URL cannot be checked by fetch. See the header. */
const UNVERIFIABLE = (u) => /jesusfilm\.org\/watch\/\?/i.test(u)

// live.bible.is answers 200 for a fileset that does not exist, returning a fixed-size
// not-found shell, so the PAGE cannot be judged by status. The first version of this check
// compared body sizes against a shell measured at run time. That worked, but it was a
// heuristic on a number the site controls, and it stopped working the moment their WAF
// started answering HEAD with a 403 whose body was 520 bytes for real and bogus alike.
//
// Their own API is the honest discriminator and needs no heuristic at all:
//     GET /api/bibles/OKEBSN  -> 200, 1,876 bytes   (real fileset)
//     GET /api/bibles/ZZZZZZ  -> 404,    75 bytes   (bogus)
// It 404s properly, it is a tenth of the page's weight, and it describes exactly the
// fileset the shipped page renders. So a bible.is link is verified by asking the API about
// its fileset id. GET is used rather than HEAD because HEAD is what their WAF blocks.
// knowgod.com is the same shape of problem as live.bible.is and the old jesusfilm
// ?languageId=: a client-rendered shell that answers 200 with IDENTICAL bytes for every
// URL, valid or not (measured: 3,864 bytes for /en/kgp, /sw/kgp and /zz/nosuchtool alike).
// Rendered it does discriminate — a bogus URL says "Failed to load the book" — but the
// existence proof comes from Cru's own API instead, which is cheaper and needs no browser:
// a (language, tool) pair exists exactly when the resource's latest-translations intersect
// that language's translations.
const IS_KNOWGOD = (u) => /(^|\.)knowgod\.com$/i.test((/^https?:\/\/([^/]+)/i.exec(u) || [, ''])[1] || '')
let cruPairs = null
const loadCru = async () => {
  if (cruPairs) return cruPairs
  cruPairs = new Set()
  try {
    const [L, R] = await Promise.all([
      fetch('https://mobile-content-api.cru.org/languages', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) }).then((r) => r.json()),
      fetch('https://mobile-content-api.cru.org/resources', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) }).then((r) => r.json()),
    ])
    const toolSet = new Map()
    for (const r of R.data || []) {
      const a = r.attributes && r.attributes.abbreviation
      if (a) toolSet.set(a, new Set(((r.relationships['latest-translations'] || {}).data || []).map((x) => x.id)))
    }
    for (const l of L.data || []) {
      const code = String(l.attributes.code || '')
      const mine = ((l.relationships.translations || {}).data || []).map((x) => x.id)
      for (const [abbr, set] of toolSet) if (mine.some((id) => set.has(id))) cruPairs.add(`${code}/${abbr}`)
    }
  } catch { cruPairs = null }
  return cruPairs
}
const knowgodCheck = async (u) => {
  const m = /knowgod\.com\/([^/]+)\/([^/?#]+)/i.exec(u)
  if (!m) return { status: 0, error: 'no language/tool pair in the URL' }
  const pairs = await loadCru()
  if (!pairs) return { status: 0, error: 'could not reach the Cru API to confirm the pair' }
  return { status: pairs.has(`${m[1]}/${m[2]}`) ? 200 : 404, cru: true }
}

// fivefish.org answers 200 for EVERY path, valid or not — the same client-rendered trap as
// live.bible.is and the old jesusfilm ?languageId=. Until now these 982 links fell through to
// the generic `status === 200 -> verified` branch, which on this host is a false green: a
// language 5fish retired would stay marked "checked" forever, and nothing would notice.
//
// Their REDIRECT discriminates, and it does so on a HEAD with no body at all (measured
// 2026-09-25, 10s apart as their robots.txt asks):
//     /cpx  -> 200, final https://fivefish.org/421?language=Chinese,%20Puxian
//     /mnp  -> 200, final https://fivefish.org/507?language=Hockchia
//     /zzq /qqz /xqx (bogus) -> 200, final https://fivefish.org/regions
// A real code lands on its numeric language page; anything they do not publish is swept to
// the region index. So the verdict is read from where the request ENDED, never from 200.
const IS_FIVEFISH = (u) => /(^|\.)fivefish\.org$/i.test((/^https?:\/\/([^/]+)/i.exec(u) || [, ''])[1] || '')
const fivefishLanded = (final) => /\/\d+\?language=/.test(String(final || ''))
const fivefishSwept = (final) => /\/regions(\?|#|$)/.test(String(final || ''))

const IS_BIBLE_IS = (u) => /(^|\.)live\.bible\.is$/i.test((/^https?:\/\/([^/]+)/i.exec(u) || [, ''])[1] || '')
const filesetOf = (u) => (/\/bible\/([A-Za-z0-9]+)/.exec(u) || [, ''])[1]
const bibleIsApi = async (u) => {
  const id = filesetOf(u)
  if (!id) return { status: 0, error: 'no fileset id in the URL' }
  for (let i = 0; i < 4; i++) {
    await pace('live.bible.is')
    try {
      const r = await fetch(`https://live.bible.is/api/bibles/${id}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) })
      if ((r.status === 403 || r.status === 429) && i < 3) { await sleep(1500 * (i + 1)); continue }
      return { status: r.status, api: true }
    } catch (e) {
      if (i === 3) return { status: 0, error: String(e.message || e).slice(0, 120) }
      await sleep(600 * (i + 1))
    }
  }
  return { status: 0, error: 'exhausted retries' }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hostOfUrl = (u) => (/^https?:\/\/([^/]+)/i.exec(u) || [, ''])[1].toLowerCase()

// PER-HOST PACING. The first full run over the FCBH corpus sent 2,192 requests at
// live.bible.is and collected 466 HTTP 403s — rate limiting, not dead links. Re-tested
// singly a moment later, the same URL answered 200. A 403 recorded as anything other than
// "unknown" would have been a lie either way, but leaving 466 links unproven is not the
// job. So each host is held to a minimum gap between requests, and a 403 is retried with
// backoff rather than believed.
// fivefish.org's robots.txt asks Crawl-delay: 10 and scripts/fetch-grn-index.mjs obeys it
// sequentially; a verifier re-reading the same catalogue is the same kind of traffic and gets
// the same manners. The cost is real — see SLOW_HOSTS below for what that means for a pass.
const MIN_GAP_MS = { 'live.bible.is': 120, 'fivefish.org': 10000 }
const nextFree = new Map()
const pace = async (host) => {
  const gap = MIN_GAP_MS[host] || 0
  if (!gap) return
  const now = Date.now()
  const at = Math.max(now, nextFree.get(host) || 0)
  nextFree.set(host, at + gap)
  if (at > now) await sleep(at - now)
}

const head = async (url, tries = 4) => {
  const host = hostOfUrl(url)
  for (let i = 0; i < tries; i++) {
    await pace(host)
    try {
      const ctl = AbortSignal.timeout(25000)
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': UA }, signal: ctl })
      // 403 and 429 from these hosts are throttling, not a verdict on the link.
      if ((r.status === 403 || r.status === 429) && i < tries - 1) { await sleep(1500 * (i + 1)); continue }
      const n = Number(r.headers.get('content-length'))
      return { status: r.status, final: r.url, size: Number.isFinite(n) ? n : -1 }
    } catch (e) {
      if (i === tries - 1) return { status: 0, error: String(e.message || e).slice(0, 120) }
      await sleep(600 * (i + 1))
    }
  }
  return { status: 0, error: 'exhausted retries' }
}

const classify = (u, r) => {
  if (UNVERIFIABLE(u)) return { state: 'unknown', detail: 'jesusfilm.org/watch/?languageId= renders the same bytes for any id, valid or bogus — a status check here would be a false green' }
  if (IS_KNOWGOD(u)) {
    if (r.status === 200) return { state: 'verified', detail: 'language/tool pair confirmed by Cru\'s mobile-content-api (knowgod.com itself answers 200 for any URL)' }
    if (r.status === 404) return { state: 'broken', detail: 'Cru\'s API lists no translation of this tool in this language' }
    return { state: 'unknown', detail: `could not be confirmed: ${r.error || 'HTTP ' + r.status}` }
  }
  if (IS_BIBLE_IS(u)) {
    if (r.status === 200) return { state: 'verified', detail: 'fileset confirmed by live.bible.is /api/bibles (the page itself answers 200 for any id)' }
    if (r.status === 404) return { state: 'broken', detail: 'live.bible.is /api/bibles returns 404 — no such fileset' }
    if (r.status === 0) return { state: 'unknown', detail: `could not be reached: ${r.error}` }
    return { state: 'unknown', detail: `live.bible.is /api/bibles answered HTTP ${r.status} — neither a clear yes nor a clear no` }
  }
  if (IS_FIVEFISH(u)) {
    if (r.status === 200 && fivefishLanded(r.final)) {
      return { state: 'verified', detail: `5fish redirected to its language page ${r.final} (the site answers 200 for any path)` }
    }
    if (r.status === 200 && fivefishSwept(r.final)) {
      return { state: 'broken', detail: '5fish swept this code to /regions — no recording published under it' }
    }
    if (r.status === 0) return { state: 'unknown', detail: `could not be reached: ${r.error}` }
    return { state: 'unknown', detail: `5fish answered HTTP ${r.status} landing on ${r.final || '(nowhere)'} — neither a clear yes nor a clear no` }
  }
  if (r.status === 200) return { state: 'verified', detail: `HTTP 200${r.final && r.final !== u ? ` (via ${r.final})` : ''}` }
  if (r.status === 0) return { state: 'unknown', detail: `could not be reached: ${r.error}` }
  if (r.status === 404 || r.status === 410) return { state: 'broken', detail: `HTTP ${r.status}` }
  return { state: 'unknown', detail: `HTTP ${r.status} — neither a clear yes nor a clear no` }
}

/** ═══ CONTROLS ═══ Each arm must come back as stated or the run aborts. */
const NEGATIVE = [
  ['https://ebible.org/zzq9x/', 'bogus eBible code'],
  ['https://jesusfilm.org/watch/jesus/definitely-not-a-language-xyzzy', 'bogus film slug'],
  ['https://git.door43.org/fa_gl/not_a_repo_xyzzy', 'bogus Door43 repo'],
  ['https://zume.training/zzz', 'bogus Zume locale'],
  ['https://arc.gt/zzzzz9', 'bogus arc.gt short link'],
  ['https://live.bible.is/bible/ZZZZZZ', 'bogus bible.is fileset'],
  ['https://knowgod.com/zz/nosuchtool-xyzzy', 'bogus knowgod language/tool pair'],
  ['https://fivefish.org/zzq', 'bogus 5fish language code'],
]
const POSITIVE = [
  ['https://ebible.org/tel2010/', 'real eBible translation'],
  ['https://jesusfilm.org/watch/jesus/german-standard', 'real film slug'],
  ['https://git.door43.org/fa_gl/lki_obs', 'real Door43 repo'],
  ['https://zume.training/de', 'real Zume locale'],
  ['https://arc.gt/w4k1c', 'real arc.gt short link'],
  ['https://live.bible.is/bible/OKEBSN', 'real bible.is fileset'],
  ['https://knowgod.com/en/kgp', 'real knowgod language/tool pair'],
  ['https://fivefish.org/cpx', 'real 5fish language code'],
]

// Prove IN BAND that the bible.is API still separates a real fileset from a bogus one,
// before a single bible.is link is classified by it.
{
  const bogus = await bibleIsApi('https://live.bible.is/bible/ZZZZZZ')
  const real = await bibleIsApi('https://live.bible.is/bible/OKEBSN')
  if (real.status === 200 && bogus.status === 404) {
    console.log('VERIFY-LINKS: live.bible.is API discriminates — real fileset 200, bogus 404.')
  } else {
    console.error(`VERIFY-LINKS: ABORT — live.bible.is /api/bibles gave ${real.status} for a real fileset and ${bogus.status} for a bogus one. It is not discriminating, so every bible.is link would be a false green.`)
    process.exit(1)
  }
}

// The same proof for 5fish, before a single one of its links is classified by where it
// landed: the redirect must still separate a published code from one they do not carry.
{
  const bogus = await head('https://fivefish.org/zzq')
  const real = await head('https://fivefish.org/cpx')
  if (fivefishLanded(real.final) && fivefishSwept(bogus.final)) {
    console.log('VERIFY-LINKS: fivefish.org redirect discriminates — real code lands on its language page, bogus swept to /regions.')
  } else {
    console.error(`VERIFY-LINKS: ABORT — fivefish.org sent a real code to ${real.final} and a bogus one to ${bogus.final}. The redirect no longer separates them, so every 5fish link would be decided by a 200 that means nothing.`)
    process.exit(1)
  }
}

const controls = { negative: [], positive: [] }
let abort = null
for (const [u, what] of NEGATIVE) {
  const c = classify(u, IS_KNOWGOD(u) ? await knowgodCheck(u) : IS_BIBLE_IS(u) ? await bibleIsApi(u) : await head(u))
  controls.negative.push({ url: u, what, state: c.state })
  if (c.state === 'verified') abort = `NEGATIVE CONTROL PASSED AS VERIFIED — ${what} (${u}). The check cannot distinguish a real link from a fake one, so nothing it says is worth writing down.`
}
for (const [u, what] of POSITIVE) {
  const c = classify(u, IS_KNOWGOD(u) ? await knowgodCheck(u) : IS_BIBLE_IS(u) ? await bibleIsApi(u) : await head(u))
  controls.positive.push({ url: u, what, state: c.state })
  if (c.state !== 'verified') abort = `POSITIVE CONTROL FAILED — ${what} (${u}) came back "${c.state}". Something is wrong with the network or the host, not with the corpus; refusing to mark 3,600 links broken on the strength of it.`
}
if (abort) {
  console.error(`VERIFY-LINKS: ABORT — ${abort}`)
  process.exit(1)
}
console.log(`VERIFY-LINKS: controls pass — ${NEGATIVE.length} negative all non-verified, ${POSITIVE.length} positive all verified.`)

if (RETRY_UNKNOWN) {
  let prev
  try { prev = JSON.parse(readFileSync(OUT, 'utf8')) } catch {
    console.error('VERIFY-LINKS: RETRY needs an existing table to retry from.')
    process.exit(1)
  }
  const links = prev.links || {}
  const todo = Object.entries(links).filter(([, r]) => r.state === 'unknown' && /HTTP 403|could not be reached/.test(r.detail || '')).map(([u]) => u)
  if (!todo.length) {
    console.log('VERIFY-LINKS: nothing to retry — no entry is unknown for a throttling reason.')
    process.exit(0)
  }
  console.log(`VERIFY-LINKS: retrying ${todo.length} throttled URL(s), one at a time.`)
  let fixed = 0
  for (const u of todo) {
    const r = classify(u, IS_KNOWGOD(u) ? await knowgodCheck(u) : IS_BIBLE_IS(u) ? await bibleIsApi(u) : await head(u, 6))
    if (r.state !== 'unknown') fixed++
    links[u] = r
    await sleep(700)
  }
  const st = {}
  for (const r of Object.values(links)) st[r.state] = (st[r.state] || 0) + 1
  prev.links = links
  prev.meta.summary = { ...prev.meta.summary, ...st }
  prev.meta.retried = { at: new Date().toISOString(), attempted: todo.length, resolved: fixed }
  writeFileSync(OUT, `${JSON.stringify(prev, null, 1)}\n`)
  console.log(`VERIFY-LINKS: ${fixed}/${todo.length} resolved. Table now ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
  process.exit(0)
}

// ═══ THE CORPUS ═══ every URL the pin index actually ships, deduplicated.
const pins = JSON.parse(readFileSync(PINS, 'utf8'))
const urls = new Set()
for (const v of Object.values(pins.codes)) {
  if (v.s) urls.add(v.s)
  if (v.f) urls.add(v.f)
  if (v.z) urls.add(v.z)
  if (v.za && v.za.u) urls.add(v.za.u)
  if (v.au && v.au.u) urls.add(v.au.u)
  if (v.bv && v.bv.u) urls.add(v.bv.u)
  if (v.gp && v.gp.u) urls.add(v.gp.u)
  if (v.se && v.se.u) urls.add(v.se.u)
  if (v.ga && v.ga.u) urls.add(v.ga.u)
  for (const d of v.d || []) if (d.u) urls.add(d.u)
}
// Carry forward everything a previous run proved dead, so dropping a link cannot erase the
// evidence that it is dead. See the header.
let carried = 0
try {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  for (const [u, r] of Object.entries(prev.links || {})) {
    if (r && r.state === 'broken' && !urls.has(u)) { urls.add(u); carried++ }
  }
} catch { /* no previous table: nothing to carry */ }
if (carried) console.log(`VERIFY-LINKS: re-testing ${carried} URL(s) a previous run recorded broken, though nothing ships them now.`)

let list = [...urls]
if (ONLY_MISSING) {
  let prevLinks = {}
  try { prevLinks = JSON.parse(readFileSync(OUT, 'utf8')).links || {} } catch { prevLinks = {} }
  const before = list.length
  list = list.filter((u) => !prevLinks[u])
  console.log(`VERIFY-LINKS: VERIFY_MISSING=1 — ${list.length} of ${before} shipped URL(s) have no record yet; the rest are kept as they are.`)
  if (!list.length) { console.log('VERIFY-LINKS: nothing missing. Table untouched.'); process.exit(0) }
}
// A FULL pass over fivefish is 982 links at a ten-second gap — nearly three hours, against a
// quarter of an hour for everything else put together. Re-reading a catalogue that changes
// slowly, that often, is not politeness and it is not information either. So in a full pass
// its ALREADY-RECORDED links are left alone; anything unrecorded is always checked, because
// an unproven shipped link is the thing this script exists to prevent. VERIFY_SLOW_HOSTS=1
// forces the whole host through, and internal/check-link-rot-sample.mjs samples it between
// times, which is the right shape for a host this expensive to ask.
const SLOW_HOSTS = new Set(['fivefish.org'])
if (!ONLY_MISSING && process.env.VERIFY_SLOW_HOSTS !== '1') {
  let prevLinks = {}
  try { prevLinks = JSON.parse(readFileSync(OUT, 'utf8')).links || {} } catch { prevLinks = {} }
  const before = list.length
  list = list.filter((u) => !(SLOW_HOSTS.has(hostOfUrl(u)) && prevLinks[u]))
  const held = before - list.length
  if (held) {
    console.log(`VERIFY-LINKS: holding back ${held} already-recorded link(s) on ${[...SLOW_HOSTS].join(', ')} (Crawl-delay: 10 makes a re-read of them ~${Math.round((held * 10) / 60)} minutes). VERIFY_SLOW_HOSTS=1 to include them.`)
  }
}

// A LIMIT run is a smoke test. It must NOT overwrite the real record: doing so silently
// threw away 3,700 results and the broken-link history along with them.
if (LIMIT) {
  list = list.slice(0, LIMIT)
  console.log(`VERIFY-LINKS: VERIFY_LIMIT=${LIMIT} — smoke run only, the table on disk will NOT be replaced.`)
}
if (!list.length) {
  console.error('VERIFY-LINKS: FAIL — the corpus is empty; every summary below would be vacuous.')
  process.exit(1)
}

// ═══ THE PASS IS RESUMABLE, BECAUSE A LONG ONE GETS KILLED ═══════════════════════════
// A full pass is ~6,500 requests over roughly a quarter of an hour, and this one was
// killed twice by system memory pressure at around 2,500. Because results lived only in
// memory until the final write, each kill threw away every request it had made — the file
// on disk was untouched, which is correct, but a quarter-hour of someone else's bandwidth
// was spent for nothing and the pass never landed.
//
// So every record is stamped with the moment it was checked, and the table is written
// after each batch. A killed run loses at most one batch, and re-running skips whatever
// already carries a fresh stamp. The checkpoint can only ADD to or REFRESH the table, never
// shrink it, which is what makes writing mid-pass safe.
const links = {}
try { Object.assign(links, JSON.parse(readFileSync(OUT, 'utf8')).links || {}) } catch { /* none */ }

const PASS_START = Date.now()
const MAX_AGE_H = Number(process.env.VERIFY_MAX_AGE_H || 0)
const BATCH = Number(process.env.VERIFY_BATCH || 500)
const freshEnough = (u) => {
  if (!MAX_AGE_H) return false
  const at = links[u] && links[u].at ? Date.parse(links[u].at) : NaN
  return Number.isFinite(at) && PASS_START - at < MAX_AGE_H * 3600 * 1000
}
if (MAX_AGE_H) {
  const before = list.length
  list = list.filter((u) => !freshEnough(u))
  console.log(`VERIFY-LINKS: resuming — ${before - list.length} URL(s) already checked within ${MAX_AGE_H}h, ${list.length} left to do.`)
  // No early exit when nothing is stale: the prune below still has to run, and skipping
  // straight past it is how 160 stale records survived a full pass that reported success.
  if (!list.length) console.log('VERIFY-LINKS: nothing stale to re-check; continuing to the prune and the summary.')
}

let done = 0
const passState = {}
const started = Date.now()
const checkpoint = () => {
  const prev = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')) } catch { return { meta: {}, links: {} } } })()
  prev.links = { ...(prev.links || {}), ...links }
  prev.meta = { ...(prev.meta || {}), checkpointAt: new Date().toISOString(), checkpointDone: done }
  writeFileSync(OUT, `${JSON.stringify(prev, null, 1)}\n`)
}
const worker = async (queue) => {
  for (;;) {
    const u = queue.pop()
    if (!u) return
    const r = classify(u, UNVERIFIABLE(u) ? {} : IS_KNOWGOD(u) ? await knowgodCheck(u) : IS_BIBLE_IS(u) ? await bibleIsApi(u) : await head(u))
    links[u] = { ...r, at: new Date().toISOString() }
    // What THIS pass checked, kept apart from the merged table. Counting a run's results
    // against the whole table produced "verified 6557 (65570.0%)" the first time.
    passState[r.state] = (passState[r.state] || 0) + 1
    if (++done % 250 === 0) process.stdout.write(`  ${done}/${list.length}\n`)
  }
}
const queue = [...list]
// Batched so a checkpoint lands between slices rather than only at the end.
while (queue.length) {
  const slice = queue.splice(Math.max(0, queue.length - BATCH), BATCH)
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(slice)))
  if (!LIMIT) { checkpoint(); process.stdout.write(`  checkpoint: ${done} done, ${queue.length} left\n`) }
}

// ═══ PRUNE WHAT NOTHING SHIPS ═══ so the table means exactly one thing: every URL this
// map currently ships, plus the history of everything ever proven dead. A record for a URL
// that is neither is cruft — and cruft is where a stale METHOD hides. 160 such records
// survived the switch from the body-size heuristic to the bible.is API, still asserting
// "verified" on the older basis for filesets no build has referenced since.
// Broken records are never pruned: forgetting a dead link is how it gets shipped again.
let pruned = 0
if (!ONLY_MISSING && !LIMIT) {
  for (const u of Object.keys(links)) {
    if (urls.has(u)) continue
    if (links[u] && links[u].state === 'broken') continue
    delete links[u]
    pruned++
  }
  if (pruned) console.log(`VERIFY-LINKS: pruned ${pruned} record(s) for URLs nothing ships and nothing proved dead.`)
}

const hostOf = (u) => hostOfUrl(u) || '?'
const byState = {}
const byHost = {}
for (const [u, r] of Object.entries(links)) {
  byState[r.state] = (byState[r.state] || 0) + 1
  const h = (byHost[hostOf(u)] ||= {})
  h[r.state] = (h[r.state] || 0) + 1
}
const broken = Object.entries(links).filter(([, r]) => r.state === 'broken').map(([u]) => u)

if (LIMIT) {
  const pct0 = (n) => `${((100 * n) / list.length).toFixed(1)}%`
  console.log(`VERIFY-LINKS: smoke run over ${list.length} URL(s) — ${Object.entries(passState).map(([k, v]) => `${k} ${v} (${pct0(v)})`).join(', ')}`)
  console.log('VERIFY-LINKS: table left untouched. Run without VERIFY_LIMIT to write it.')
  process.exit(0)
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      meta: {
        title: 'Gospel resource link verification',
        generated: new Date().toISOString(),
        method: 'HEAD, redirects followed. verified = HTTP 200. broken = 404/410. unknown = unreachable, an ambiguous status, or a URL shape that cannot be checked by fetch.',
        scope: 'Every URL in data/tables/people-group-pins.json, deduplicated.',
        states: {
          verified: 'the URL answered 200 to a HEAD that followed redirects',
          broken: 'the target does not exist (404/410)',
          unknown: 'could not be checked — never read as either working or broken',
        },
        controls,
        summary: { records: Object.keys(links).length, checkedThisPass: list.length, carriedForward: carried, pruned, ...byState },
        byHost,
      },
      links,
    },
    null,
    1,
  )}\n`,
)

const total = Object.keys(links).length
const pct = (n) => `${((100 * n) / total).toFixed(1)}%`
console.log(`VERIFY-LINKS: checked ${list.length} URL(s) this pass in ${((Date.now() - started) / 1000).toFixed(0)}s — ${Object.entries(passState).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'}`)
console.log(`VERIFY-LINKS: table now holds ${total} record(s):`)
for (const s of ['verified', 'broken', 'unknown']) {
  if (byState[s]) console.log(`  ${s.padEnd(9)} ${String(byState[s]).padStart(5)}  ${pct(byState[s])}`)
}
if (broken.length) {
  console.log(`  broken URLs (first 10):`)
  for (const u of broken.slice(0, 10)) console.log(`    ${u}`)
}
console.log(`wrote ${OUT}`)
