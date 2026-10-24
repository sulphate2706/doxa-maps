/**
 * verify-translator-org-links.mjs — turn the translator CREDIT into someone a mobiliser can reach.
 *
 * WHY. fetch-ebible-credits.mjs already answers "who translated this" and the sheet already says
 * those are "the likeliest people to ask" — but it names them and stops. A name is not a contact.
 * The mobiliser reading a zero-access group is one step from the organisation that has linguists,
 * relationships and very often a field team in that country, and the map makes them go and find it.
 *
 * ⚠ WHY THIS IS A HAND-WRITTEN ALLOWLIST AND NOT THE CATALOGUE'S OWN FIELD. eBible ships
 * homeDomain and publicationURL on every row, and fetch-ebible-credits.mjs deliberately drops
 * both: a refresh of somebody else's catalogue must never be able to put a new publisher on this
 * map, because the doctrine screen is an allowlist for exactly that reason. So the URL comes from
 * here, where every entry was screened by hand, or it does not ship at all.
 *
 * ⚠ WHAT IS DELIBERATELY ABSENT. National Bible Societies hold 89+ of the credits and NONE of
 * them is linked here. Not doubt about the Societies — the filter is the 66-book canon only,
 * and several UBS members publish editions that include the deuterocanonicals, so
 * whether a Society CONTACT is inside or outside that line is a product decision to make and not
 * this script's. They stay named-without-a-link until it is made, and the count is reported so the
 * gap is visible rather than quiet. Same for the orgs whose doctrine I could not establish: they
 * are listed in `unscreened` with the reason, never linked.
 *
 * ⚠ VERIFIED MEANS FETCHED. Every URL below was fetched by this script on the run that wrote the
 * table. Several of these hosts sit behind a bot challenge that answers a datacentre IP with 403
 * or 429 while serving a real site to a browser; for those the check falls to robots.txt, which
 * those same hosts answer, and the state records WHICH method proved it. Both controls run in band
 * and the script refuses to write if either misbehaves.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/translator-org-links.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/* ── THE ALLOWLIST ────────────────────────────────────────────────────────────────────────────
   `match` is tested against the credit string as eBible wrote it, in order, first hit wins — so
   the country arms of a family come BEFORE the family ("Wycliffe Bible Translators of Canada"
   must not resolve to the US office). `why` is the doctrine note: what this organisation is, in
   one line, so the screen can be re-read by a human without leaving the file.                   */
const ORGS = [
  { id: 'wycliffe-ca', name: 'Wycliffe Bible Translators of Canada', url: 'https://www.wycliffe.ca/',
    match: [/wycliffe[^,]*\bcanada\b/i], why: 'Bible translation agency, Canadian office of the Wycliffe Global Alliance.' },
  { id: 'wycliffe-au', name: 'Wycliffe Bible Translators Australia', url: 'https://wycliffe.org.au/',
    match: [/wycliffe[^,]*australian?\b/i], why: 'Bible translation agency, Australian office of the Wycliffe Global Alliance.' },
  { id: 'wycliffe', name: 'Wycliffe Bible Translators', url: 'https://www.wycliffe.org/',
    match: [/\bwycliffe\b/i], why: 'Bible translation agency; translates the 66-book canon, no added scripture.' },
  { id: 'twftw', name: 'The Word for the World', url: 'https://www.twftw.org/',
    match: [/word for the world/i, /\bTWFTW\b/], why: 'Bible translation agency working through national translators.' },
  { id: 'biblica', name: 'Biblica', url: 'https://www.biblica.com/',
    match: [/\bbiblica\b/i], why: 'Bible publisher and translator (NIV); 66-book canon.' },
  { id: 'pioneer', name: 'Pioneer Bible Translators', url: 'https://pioneerbible.org/',
    match: [/pioneer bible translators/i, /traducteurs pionniers de la bible/i, /\bPBT\b/],
    why: 'Bible translation agency working in languages with no Scripture.' },
  { id: 'seed', name: 'The Seed Company', url: 'https://seedcompany.com/',
    match: [/seed company/i], why: 'Bible translation agency, affiliate of Wycliffe USA.' },
  { id: 'sim', name: 'SIM', url: 'https://www.sim.org/',
    match: [/\bSIM\b/, /society for international ministries/i], why: 'Evangelical mission agency; translation among its field work.' },
  { id: 'bible-league', name: 'Bible League International', url: 'https://www.bibleleague.org/',
    match: [/world bible translation cent(er|re)/i, /bible league/i, /liga b[ií]blica/i],
    why: 'Scripture publisher; absorbed the World Bible Translation Center, whose name the credits still carry.' },
  /* The credit strings name Door43 itself ("Door43 World Missions Community"), and door43.org
     answers a plain GET while unfoldingword.org rate-limits a datacentre IP — so the link goes
     to the platform the credit actually names. */
  { id: 'unfoldingword', name: 'Door43 / unfoldingWord', url: 'https://door43.org/',
    match: [/door\s?43/i, /unfoldingword/i], why: 'Open-licensed Bible translation resources; the Door43 community platform.' },
  { id: 'bridgeconn', name: 'Bridge Connectivity Solutions', url: 'https://www.bridgeconn.com/',
    match: [/bridge conn?ectivity/i, /bridge communication systems/i],
    why: 'Indian Bible-translation technology and translation services group.' },
  { id: 'btl-kenya', name: 'Bible Translation and Literacy', url: 'https://www.btlkenya.org/',
    match: [/bible translation and literacy/i], why: 'Kenyan Bible translation agency, Wycliffe Global Alliance member.' },
  { id: 'kartidaya', name: 'Yayasan Kartidaya', url: 'https://kartidaya.org/',
    match: [/kartidaya/i], why: 'Indonesian Bible translation agency, Wycliffe Global Alliance member.' },
  { id: 'liebenzell', name: 'Liebenzell Mission', url: 'https://www.liebenzell.org/',
    match: [/liebenzel+l? mission/i], why: 'German evangelical mission agency (Free Church tradition).' },
  { id: 'sil', name: 'SIL Global', url: 'https://www.sil.org/',
    match: [/\bSIL\b/], why: 'Language development organisation; the linguistic partner behind much of this corpus.' },
  { id: 'lockman', name: 'The Lockman Foundation', url: 'https://www.lockman.org/',
    match: [/lockman foundation/i], why: 'Scripture publisher (NASB, LBLA); 66-book canon.' },
]

/* Credits that are NOT linked, and why. Counted in the table so the silence is legible. */
const HELD = [
  { pattern: /bible society|biblical society|bibelselskab|bibelsellskap|soci(e|é)t(y|é) b[ií]blica|sociedad b[ií]blica|lembaga alkitab|united bible societies|sirk[əe]ti|bible societies/i,
    reason: 'national Bible Society — several UBS members publish editions containing the deuterocanonicals, so whether a Society contact sits inside the 66-book filter is a product ruling, not this script\'s' },
  { pattern: /artists for israel|k[äa]rnbibeln|sanskritbible|gilakmedia|tarifit|gSungrab|audiobiblia/i,
    reason: 'doctrine not established from published material — left out rather than guessed' },
]

const fetchOnce = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25000) })
    const body = await r.text()
    return { status: r.status, final: r.url, bytes: body.length, body }
  } catch (e) { return { status: 0, final: url, bytes: 0, body: '', error: String(e.message || e) } }
}
const isRobots = (b) => /(^|\n)\s*(user-agent|sitemap)\s*:/i.test(b) && b.length < 20000

/** Homepage first. If a bot challenge answers instead, robots.txt on the same host is the fallback. */
const verify = async (url) => {
  const home = await fetchOnce(url)
  if (home.status === 200 && home.bytes > 400) return { state: 'verified', method: 'homepage-get', detail: `HTTP 200, ${home.bytes} bytes`, final: home.final }
  const robots = await fetchOnce(new URL('/robots.txt', url).href)
  if (robots.status === 200 && isRobots(robots.body)) {
    return { state: 'verified', method: 'robots-txt', detail: `homepage HTTP ${home.status} (bot challenge from a datacentre IP), robots.txt HTTP 200, ${robots.bytes} bytes`, final: home.final }
  }
  return { state: 'unknown', method: 'none', detail: `homepage HTTP ${home.status}${home.error ? ` (${home.error})` : ''}, robots.txt HTTP ${robots.status}`, final: home.final }
}

/* ── CONTROLS, IN BAND ─────────────────────────────────────────────────────────────────────── */
const posc = await verify('https://seedcompany.com/')
if (posc.state !== 'verified') { console.error(`ORG-LINKS: positive control failed (${posc.detail}) — a network fault would write every org off as unreachable. Refusing.`); process.exit(1) }
const negc = await verify('https://this-org-does-not-exist-doxa-maps.example/')
if (negc.state === 'verified') { console.error('ORG-LINKS: negative control PASSED verification — the check cannot fail, so it proves nothing. Refusing.'); process.exit(1) }
const robotsc = await fetchOnce('https://www.biblica.com/definitely-not-robots-xyzzy.txt')
if (robotsc.status === 200 && isRobots(robotsc.body)) { console.error('ORG-LINKS: the robots fallback accepts a path that is not robots.txt. Refusing.'); process.exit(1) }
console.log(`controls: positive ${posc.method}, negative "${negc.state}", robots-shape rejected non-robots path`)

const out = {}
let verified = 0, unknown = 0
for (const o of ORGS) {
  const v = await verify(o.url)
  if (v.state === 'verified') verified++; else unknown++
  out[o.id] = { name: o.name, url: o.url, why: o.why, state: v.state, method: v.method, detail: v.detail,
    /* source + flags as two fields, not a string with a suffix: a pattern is reconstructed by
       the builder, and a suffix convention is one escaping bug away from a silently different
       regex. */
    match: o.match.map((r) => ({ s: r.source, f: r.flags })) }
  console.log(`  ${v.state === 'verified' ? 'ok  ' : 'HELD'} ${o.id.padEnd(15)} ${v.method.padEnd(12)} ${o.url}`)
}
if (!verified) { console.error('ORG-LINKS: nothing verified — refusing to write.'); process.exitCode = 1 } else {
  /* THROUGH THE SNAPSHOT GUARD, and this script is the reason it exists in miniature: three of
     these hosts answered 429 on an earlier probe in the same hour. A rate-limited run would
     verify four orgs instead of sixteen and quietly take the contact off ~600 credits. */
  const body = `${JSON.stringify({
    meta: {
      title: 'Who to contact — screened, fetched homepages for the organisations named in the credits',
      generated: new Date().toISOString().slice(0, 10),
      grain: 'one entry per organisation, matched to a credit string by the regexes it carries',
      verified_orgs: verified,
      orgs_that_did_not_answer: unknown,
      states: {
        verified: 'this script fetched it on the run that wrote this file — homepage 200, or robots.txt 200 where a bot challenge answers a datacentre IP',
        unknown: 'did not answer this run; NOT shipped, and never read as broken',
      },
      not_linked: HELD.map((h) => ({ reason: h.reason })),
      note: 'Hand-screened allowlist. eBible\'s own homeDomain/publicationURL fields are deliberately NOT used: a refresh of someone else\'s catalogue must not be able to put a publisher on this map.',
    },
    held: HELD.map((h) => ({ pattern: h.pattern.source, reason: h.reason })),
    orgs: out,
  }, null, 1)}\n`
  writeSnapshot(OUT, body, (j) => Object.values(j.orgs || {}).filter((o) => o.state === 'verified').length, 'verified organisation(s)')
  console.log(`translator-org-links: ${verified} verified, ${unknown} did not answer`)
  console.log(`wrote ${OUT}`)
}
