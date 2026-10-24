/**
 * fetch-grn-index.mjs — Global Recordings Network, via 5fish, joined on ISO 639-3.
 *
 * WHY THIS SOURCE, AND WHY IT WAS MISSING SO LONG. GRN records the gospel as AUDIO for
 * languages that have no written Scripture at all, which is precisely the population left
 * in this map's gap. It is named in the brief, and every previous attempt recorded it as
 * unreachable — globalrecordings.net sits behind a proof-of-work bot shield that answers
 * even robots.txt with a challenge page. That shield is an access control and is not worked
 * around here. Their own delivery site, 5fish.org, is NOT shielded and its robots.txt allows
 * everything except /abyss/, /app.xml and /PrayerApp.json, none of which this touches.
 *
 * WE OBEY THEIR CRAWL-DELAY. 5fish asks for `Crawl-delay: 10`. This fetcher is therefore
 * SEQUENTIAL with a ten-second gap and a per-run cap, and it is RESUMABLE so the work is
 * spread across runs rather than taken all at once. A full sweep of the gap is some hours of
 * wall clock at that rate; that is their rate to set, not ours, and this is a small ministry's
 * server. Do not add concurrency here.
 *
 * A 200 IS NOT AN ANSWER — MEASURED, WITH CONTROLS. The host never 404s. Three states were
 * observed and the title is what separates them:
 *   - "…| Learn about Christian beliefs in <Language>"  a real language page
 *   - "…| Languages Spoken in <Country>"                a GEO FALLBACK: /zzz-no-such-language
 *                                                       -xyzzy returns this, 200, 151,042 bytes
 *   - "…| The Gospel in Every Language" (bare)          no such language
 * Both of the two largest gap codes, cjy and gan, return the bare form, which is consistent
 * with their being in the gap at all. Taking HTTP 200 as existence would have marked every
 * code on earth as covered.
 *
 * WHAT IS CLAIMED. A hit means GRN publishes at least one audio program in that language —
 * typically "Words of Life", gospel messages and Bible stories with songs. It is typed as
 * Gospel audio and NEVER as Scripture: it is not a translation of the canon, and the same
 * care applies here as to Bible Stories. It lifts a group off tier 0, because a person can
 * hear the gospel in their own language, and it never reaches tier 2.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TABLES = resolve(HERE, '../../../data/tables')
const OUT = resolve(TABLES, 'grn-index.json')
const PINS = resolve(TABLES, 'people-group-pins.json')
const ORIGIN = 'https://fivefish.org'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** Their stated crawl-delay, in ms. Lowering this is a decision about someone else's server. */
const CRAWL_DELAY_MS = Number(process.env.GRN_DELAY_MS || 10000)
/** Codes probed per run. The sweep is resumable, so this bounds one sitting, not the total. */
const MAX = Number(process.env.GRN_MAX || 150)
const LIMIT_SMOKE = process.env.GRN_SMOKE === '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const titleOf = (html) => {
  const m = /<title>([^<]*)<\/title>/i.exec(html || '')
  return m ? m[1].trim() : ''
}

/**
 * ═══ WHERE THE REQUEST ENDED DECIDES; THE TITLE ONLY NAMES ══════════════════════════════
 *
 * This classified by TITLE alone, and its last rule was a catch-all: any title that matched
 * neither known pattern was recorded as "none". That is a default, not a finding, and it was
 * wrong often enough to matter. Caught by cross-checking IMB's own access flags against this
 * index: of six Doxa codes where IMB said recordings exist and this index said none, FOUR
 * had them — alk Alak, nos Nisu Eastern, jle Ngile, lma Limba East — each landing on its own
 * numbered 5fish language page.
 *
 * The redirect is the real discriminator and was already proved in band twice elsewhere in
 * this bundle, in verify-gospel-links.mjs and the rot sampler. A published code lands on
 * /<id>?language=<name>; a code they do not carry is swept to /regions. So the LANDING
 * decides state, and the title is demoted to what it is actually good at — supplying the
 * language's name. A page that lands on its language page is a hit even if its title is
 * phrased in a way nobody anticipated, which is exactly the case the catch-all was losing.
 */
const LANDED = (final) => /\/\d+\?language=/.test(String(final || ''))
const SWEPT = (final) => /\/regions(\?|#|$)/.test(String(final || ''))

/** @returns {'hit'|'none'|'geo'|'error'} and the language name when it is a hit. */
function classify(title, final) {
  if (LANDED(final)) {
    const m = /Learn about Christian beliefs in\s+(.+)$/i.exec(title)
    let name = m ? m[1].trim() : ''
    if (!name) {
      try { name = decodeURIComponent(String(final).split('language=')[1] || '').trim() } catch { name = '' }
    }
    return { state: 'hit', name }
  }
  if (SWEPT(final)) return { state: 'none' }
  /* Neither landing shape: do NOT default to "none" — that is the bug this replaced. */
  if (/Languages Spoken in/i.test(title)) return { state: 'geo' }
  return { state: 'error' }
}

async function probe(iso) {
  try {
    const r = await fetch(`${ORIGIN}/${encodeURIComponent(iso)}`, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return { state: 'error' }
    const html = await r.text()
    return classify(titleOf(html), r.url)
  } catch {
    return { state: 'error' }
  }
}

/* ── controls, in band, before anything is trusted ───────────────────────────────────── */
const neg = await probe('zzz-no-such-language-xyzzy')
await sleep(CRAWL_DELAY_MS)
const pos = await probe('amh')
if (neg.state === 'hit') {
  console.error('GRN: control FAILED — a nonsense code reported a real language page. Aborting.')
  process.exit(1)
}
if (pos.state !== 'hit') {
  console.error(`GRN: control FAILED — amh did not read as a language page (${pos.state}). Aborting.`)
  process.exit(1)
}
console.log(`GRN: controls pass — nonsense reads "${neg.state}", amh reads "${pos.name}".`)

/* ── what still needs deciding ───────────────────────────────────────────────────────── */
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { byIso: {}, none: [] }
const decided = new Set([...Object.keys(prev.byIso || {}), ...(prev.none || [])])

const pins = JSON.parse(readFileSync(PINS, 'utf8'))
/* The gap first, largest population first: a bounded run should buy the most people it can. */
const pop = {}
const gap = new Set()
for (const r of pins.pins) {
  const c = (r[4] || '').toLowerCase()
  if (!c) continue
  if (r[6] === 0) {
    gap.add(c)
    pop[c] = (pop[c] || 0) + (r[5] || 0)
  }
}
/* GRN_RECHECK=1 re-asks the codes this index recorded as "none" under the old title
   catch-all. They were not measured, they were defaulted, and the landing rule disagrees with
   enough of them to be worth the traffic. Scoped to a code list on GRN_CODES when given, so a
   run can be pointed at Doxa's roster rather than the whole corpus. */
const RECHECK = process.env.GRN_RECHECK === '1'
const ONLY = (process.env.GRN_CODES || '').split(/[,\s]+/).filter(Boolean)
let todo
if (RECHECK) {
  const pool = ONLY.length ? ONLY : [...(prev.none || [])]
  todo = pool.filter((c) => (prev.none || []).includes(c)).sort((a, b) => (pop[b] || 0) - (pop[a] || 0))
  console.log(`GRN: RECHECK — re-asking ${todo.length} code(s) previously recorded "none" under the title rule.`)
} else {
  todo = [...gap].filter((c) => !decided.has(c)).sort((a, b) => pop[b] - pop[a])
  console.log(`GRN: ${gap.size} gap code(s); ${decided.size} already decided; ${todo.length} left.`)
}

const batch = todo.slice(0, LIMIT_SMOKE ? 3 : MAX)
const byIso = { ...(prev.byIso || {}) }
let none = [...(prev.none || [])]
/* A recheck that could only ever ADD would be unable to correct the thing it exists for. */
const clearNone = (c) => { none = none.filter((x) => x !== c) }
let hits = 0
let errors = 0

for (let i = 0; i < batch.length; i++) {
  const iso = batch[i]
  await sleep(CRAWL_DELAY_MS)
  const r = await probe(iso)
  if (r.state === 'hit') {
    byIso[iso] = { u: `${ORIGIN}/${iso}`, n: r.name }
    clearNone(iso)          // a recheck must be able to take a code back out of "none"
    hits++
  } else if (r.state === 'none' || r.state === 'geo') {
    /* A geo fallback means the path did not resolve to a language, same as "none" for us. */
    if (!none.includes(iso)) none.push(iso)
  } else {
    /* An error leaves the code UNDECIDED rather than "none". Recording a failed request as
       an absence is how the old catch-all produced false negatives in the first place. */
    clearNone(iso)
    errors++
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${batch.length} (${hits} hit)`)
}

console.log(
  `GRN: probed ${batch.length}, ${hits} with audio, ${batch.length - hits - errors} without, ${errors} error(s).`,
)

if (LIMIT_SMOKE) {
  console.log('GRN: GRN_SMOKE=1 — writing nothing.')
  process.exit(0)
}

writeSnapshot(
  OUT,
  `${JSON.stringify(
    {
      source: `${ORIGIN}/<iso639-3> (5fish, Global Recordings Network)`,
      fetched: new Date().toISOString().slice(0, 10),
      _note:
        'GRN gospel AUDIO, typed as Gospel audio and never as Scripture — "Words of Life" is ' +
        'gospel messages and Bible stories, not a translation of the canon. The host never ' +
        '404s: a nonsense path returns a geo-located page with HTTP 200, so existence is read ' +
        'from the page title, with a negative and a positive control run in band every time. ' +
        'Their robots.txt asks for Crawl-delay: 10 and this fetcher obeys it, sequentially.',
      codes: Object.keys(byIso).length,
      decidedNone: none.length,
      byIso,
      none,
    },
    null,
    1,
  )}\n`,
  (j) => Object.keys(j.byIso || {}).length + (j.none || []).length,
  'GRN code(s) decided',
)
console.log(`wrote ${OUT}`)
