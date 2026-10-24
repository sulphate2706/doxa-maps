/**
 * check-link-rot-sample.mjs — do the links we already verified still work?
 *
 * THE RISK. The verification table records that a URL resolved ON THE DAY IT WAS CHECKED.
 * Nothing re-tests a link once it passes, so a publisher can retire a page and the map will
 * keep offering it indefinitely, still labelled "link checked". Clause L of the coverage gate
 * guards the freshness of the RECORD; it cannot notice that the web moved underneath it.
 *
 * WHY A SAMPLE. 8,394 verified links is a lot of traffic to aim at a handful of ministries for
 * a maintenance check. A stratified sample — up to 25 per host, taken at a fixed stride so the
 * same run is repeatable — is enough to tell "nothing is rotting" from "a publisher has
 * reorganised", which is the decision this check exists to inform. A full re-verify is
 * scripts/verify-gospel-links.mjs and is the right tool once this finds something.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE USED TO SAY, AND WHY IT WAS WRONG. The first version excluded four hosts on
 * the grounds that they "NEVER 404" and so could not be re-checked by status. That belief was
 * inherited, not measured, and it quietly exempted 5,760 of 8,394 shipped links — 69% of the
 * corpus, including the two largest hosts on the map — while the bundle's own verifier had
 * ALREADY solved three of the four. Measured on 2026-09-25, on the exact URL SHAPE the map
 * actually ships, and reconciled against scripts/verify-gospel-links.mjs, which is the
 * authority on per-host method and should be read before adding a host here:
 *
 *   jesusfilm.org   /watch/jesus/<slug>   real 200 · three different bogus slugs ALL 404,
 *                   by HEAD as well as GET. It does 404. The exclusion here was inherited
 *                   from the OLD /watch/?languageId=N shape, which really was byte-identical
 *                   for a valid and a bogus id — scripts/verify-gospel-links.mjs migrated to
 *                   the Arclight shareUrl path and has been checking these for some time.
 *                   Only this file never learned. 2,049 links.
 *   live.bible.is   /bible/<filesetId>    the page always answers 200, so it cannot be judged
 *                   at all. Its API can: /api/bibles/<filesetId> returns 200 with the fileset
 *                   for a real id and a 75-byte 404 for a bogus one. Same discriminator the
 *                   verifier uses, same in-band abort. 2,636 links.
 *   fivefish.org    /<iso639-3>           always 200, but the REDIRECT discriminates and
 *                   does it on a HEAD: a published code lands on its numbered language page
 *                   (/cpx -> /421?language=Chinese,%20Puxian), one they do not carry is swept
 *                   to /regions. Same rule scripts/verify-gospel-links.mjs now classifies
 *                   them by. Their robots.txt asks Crawl-delay: 10, so this band is SMALL on
 *                   purpose — six links, a minute — and the full re-read lives in the
 *                   verifier behind VERIFY_SLOW_HOSTS=1. 1,022 links.
 *   knowgod.com     /<path>               byte-identical 3,864-byte page for a real path and
 *                   a nonsense one, so the PAGE proves nothing. Cru's own API does prove it —
 *                   a (language, tool) pair exists when the resource's latest translations
 *                   intersect that language's — and the verifier already checks them that
 *                   way. Not reproduced here yet. 94 links.
 *
 * The lesson is the one this repo keeps relearning: a claim about the outside world decays,
 * and an exclusion is a claim. Each host below carries the measurement that justifies its
 * band, so the next person can re-measure rather than re-inherit.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * IT IS SHOWN TO BE ABLE TO FAIL. Every band runs its controls in band, every run:
 *   - status band: URLs that must not exist, one per host shape. Any 2xx and the check
 *     reports that it proved nothing and exits non-zero rather than reporting a pass.
 *   - mapped band: a real fileset must answer 200 from the API AND an impossible one must not
 *     (or the check is either a false green across the host or a libel on every link in it).
 *   - landing band: a published code must land on its language page AND one they do not carry
 *     must be swept away, or the redirect has stopped separating them.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const TABLE = resolve(REPO, 'data/tables/gospel-link-verification.json')

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** Hosts whose HTTP status is real evidence. Measured, not assumed — see the header. */
const STATUS_MEANINGFUL = new Set([
  'ebible.org', 'alkitab.pw', 'png.bible', 'git.door43.org',
  'scriptureearth.org', 'zume.training', 'arc.gt',
  'jesusfilm.org', 'www.jesusfilm.org',
])

/**
 * Hosts where the PAGE cannot be judged but a sibling URL carries an honest status.
 *
 * This is not a heuristic on a number the site controls. An earlier draft of this band
 * compared the page's body size against an empty shell measured at run time; it separated
 * cleanly the day it was written (7,860b shell against 13.5–85 KB of real page) and it is
 * still the technique scripts/fetch-fcbh-index.mjs used to BUILD the index. But the verifier
 * had already abandoned it for this host, and says why: their WAF started answering HEAD with
 * a 403 whose body was 520 bytes for real and bogus alike, and the size rule silently agreed
 * that everything was dead. A rule that survives only while the front door behaves is not a
 * rule. The API 404s properly, costs a tenth of the page, and describes exactly the fileset
 * the shipped page renders.
 */
const URL_MAPPED = {
  'live.bible.is': {
    /* /bible/ENGKJV -> /api/bibles/ENGKJV */
    map: (u) => u.replace('/bible/', '/api/bibles/'),
    mustExist: 'https://live.bible.is/api/bibles/ENGKJV',
    mustNotExist: 'https://live.bible.is/api/bibles/ZZZZZZ',
  },
}

/**
 * Hosts that answer 200 for everything but send a request they do not serve somewhere else.
 * The verdict is read from where the request ENDED, never from the status.
 */
const LANDING = {
  'fivefish.org': {
    alive: (final) => /\/\d+\?language=/.test(String(final || '')),
    dead: (final) => /\/regions(\?|#|$)/.test(String(final || '')),
    mustExist: 'https://fivefish.org/cpx',
    mustNotExist: 'https://fivefish.org/zzq',
    /* Their robots.txt asks Crawl-delay: 10. Six links plus two controls is eighty seconds. */
    perHost: Number(process.env.ROT_FIVEFISH || 6),
    gapMs: 10000,
  },
}

/** Hosts left out, with the reason, so the exclusion stays a measurement and not a habit. */
const NOT_CHECKED_HERE = {
  'knowgod.com': "page bytes are identical; the verifier proves these via Cru's API, not reproduced here",
}

/** Must not exist. If one of these passes, the check cannot see death and says so. */
const CONTROLS = [
  'https://ebible.org/zzz-no-such-translation-xyzzy/',
  'https://scriptureearth.org/data/zzz/PDF/nope.pdf',
  'https://git.door43.org/unfoldingWord/no-such-repo-xyzzy',
  /* The shipped shape, not a plausible-looking one: /watch/jesus/<language-slug>. */
  'https://jesusfilm.org/watch/jesus/zzz-no-such-language-xyzzy',
]

const PER_HOST = Number(process.env.ROT_PER_HOST || 25)

async function get(url, method = 'GET') {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    })
    const body = method === 'GET' ? await r.text() : ''
    return { status: r.status, len: body.length, final: r.url }
  } catch {
    return { status: 0, len: 0, final: '' }
  }
}

/* A 808 KB film page times 25 is 20 MB of somebody else's bandwidth to learn one number that
   HEAD already carries. Status hosts are asked with HEAD; the shell band needs the body. */
const status = (url, method = 'HEAD') => get(url, method).then((r) => r.status)

let table
try { table = JSON.parse(readFileSync(TABLE, 'utf8')) } catch {
  console.error('LINK-ROT: NOT MEASURED — no verification table to sample.')
  process.exit(1)
}

const verified = Object.entries(table.links || {})
  .filter(([, r]) => r && r.state === 'verified')
  .map(([u]) => u)

const byHost = new Map()
let skipped = 0
for (const u of verified) {
  let h
  try { h = new URL(u).host } catch { continue }
  if (!STATUS_MEANINGFUL.has(h) && !URL_MAPPED[h] && !LANDING[h]) { skipped++; continue }
  if (!byHost.has(h)) byHost.set(h, [])
  byHost.get(h).push(u)
}

/* Fixed stride, sorted input: the same sample every run, so a change is a change in the web
   rather than a change in which links we happened to pick. */
const sample = []
for (const [host, urls] of [...byHost].sort((a, b) => a[0].localeCompare(b[0]))) {
  urls.sort()
  const want = (LANDING[host] && LANDING[host].perHost) || PER_HOST
  const step = Math.max(1, Math.floor(urls.length / want))
  for (let i = 0; i < urls.length && sample.filter((s) => s.host === host).length < want; i += step) {
    sample.push({ host, url: urls[i] })
  }
}

/* ── controls: the status band ──────────────────────────────────────────────────────────── */
const ctl = []
for (const u of CONTROLS) ctl.push([u, await status(u)])
const blind = ctl.filter(([, s]) => s >= 200 && s < 300)
if (blind.length) {
  console.error('LINK-ROT: PROVED NOTHING — a URL that cannot exist answered 2xx:')
  for (const [u, s] of blind) console.error(`  ${s} ${u}`)
  console.error('  This check cannot tell a live link from a dead one today. Fix it before')
  console.error('  trusting any pass it reports.')
  process.exit(1)
}
console.log(`LINK-ROT: status controls pass — ${ctl.length} impossible URL(s), none answered 2xx.`)

/* ── controls: the mapped band, both directions ────────────────────────────────────────── */
for (const [host, cfg] of Object.entries(URL_MAPPED)) {
  if (!byHost.has(host)) continue
  const yes = await status(cfg.mustExist, 'GET')
  const no = await status(cfg.mustNotExist, 'GET')
  if (!(yes >= 200 && yes < 300) || no === 200) {
    console.error(
      `LINK-ROT: PROVED NOTHING — ${host} answered ${yes} for a fileset that exists and ` +
        `${no} for one that cannot. It is not discriminating.`,
    )
    console.error('  A pass here would be a false green across every link on the host, and a')
    console.error('  fail would condemn links that are fine. Neither is worth reporting.')
    process.exit(1)
  }
  console.log(`LINK-ROT: ${host} controls pass — real fileset ${yes}, impossible fileset ${no}.`)
}

/* ── controls: the landing band, both directions ──────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [host, cfg] of Object.entries(LANDING)) {
  if (!byHost.has(host)) continue
  const yes = await get(cfg.mustExist, 'HEAD')
  await sleep(cfg.gapMs)
  const no = await get(cfg.mustNotExist, 'HEAD')
  await sleep(cfg.gapMs)
  if (!cfg.alive(yes.final) || !cfg.dead(no.final)) {
    console.error(
      `LINK-ROT: PROVED NOTHING — ${host} sent a real code to ${yes.final || '(nowhere)'} and ` +
        `an impossible one to ${no.final || '(nowhere)'}. The redirect no longer separates them.`,
    )
    console.error('  Every link on this host would be decided by a 200 that means nothing.')
    process.exit(1)
  }
  console.log(`LINK-ROT: ${host} controls pass — real code landed on its language page, impossible one swept away.`)
}

/* ── the sample ─────────────────────────────────────────────────────────────────────────── */
const dead = []
for (const { host, url } of sample) {
  const land = LANDING[host]
  if (land) {
    const r = await get(url, 'HEAD')
    await sleep(land.gapMs)
    if (!land.alive(r.final)) dead.push([url, `landed on ${r.final || '(nowhere)'}`])
    continue
  }
  const cfg = URL_MAPPED[host]
  /* GET on the mapped band: their WAF blocks HEAD, which is how the old size rule broke. */
  const st = cfg ? await status(cfg.map(url), 'GET') : await status(url)
  if (!(st >= 200 && st < 300)) {
    dead.push([url, cfg ? `${st} from ${cfg.map(url)}` : st || 'no response'])
  }
}

console.log(
  `LINK-ROT: re-checked ${sample.length} verified link(s) across ${byHost.size} host(s) ` +
    `(${skipped} link(s) not sampled here: ` +
    `${Object.entries(NOT_CHECKED_HERE).map(([h, why]) => `${h} — ${why}`).join('; ')}).`,
)
if (dead.length) {
  console.error(`LINK-ROT: FAIL — ${dead.length} link(s) we call "checked" no longer resolve:`)
  for (const [u, why] of dead.slice(0, 10)) console.error(`  ${why} ${u}`)
  console.error('  Re-run scripts/verify-gospel-links.mjs to re-test the whole corpus; the')
  console.error('  build drops anything it proves dead.')
  process.exit(1)
}
console.log('LINK-ROT: PASS — every sampled link still resolves.')
