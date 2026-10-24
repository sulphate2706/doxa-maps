/**
 * check-translator-contacts.mjs — the credit line now LINKS the translating organisation, and
 * this is the gate on that link. Static, sub-second, no browser.
 *
 * WHAT IT WOULD CATCH. A contact URL is a link this map stands behind, so it has to clear the
 * same bar as a resource link and one more besides:
 *   1. Every cr.u in the pin index is on an organisation the DOCTRINE SCREEN lists. The screen's
 *      pattern is read out of internal/verify-gospel-map.mjs, never re-typed here — two copies of
 *      an allowlist drift, and the copy that drifts is the one nobody is looking at.
 *   2. Every cr.u was actually FETCHED: it must appear in translator-org-links.json as `verified`.
 *      An org the verifier could not reach must stay a name.
 *   3. No contact host is also serving a RESOURCE. wycliffe.org is a fine place to write to and
 *      is not a publisher this map reads text from; if one ever appears as a scripture or film
 *      link, that is a new publisher arriving sideways.
 *   4. The leaf RENDERS it as a link. The data can carry 838 URLs while the template shows none.
 * Self-test: `--poison` injects a JW contact, an unverified org, and a leaf with the anchor
 * removed, and every arm must fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const POISON = process.argv.includes('--poison')

const idx = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))
const orgs = JSON.parse(readFileSync(resolve(REPO, 'data/tables/translator-org-links.json'), 'utf8')).orgs || {}
const gate = readFileSync(resolve(REPO, 'internal/verify-gospel-map.mjs'), 'utf8')
let leaf = readFileSync(resolve(REPO, 'plugin-designs/gospel-resources/resources-map.vue'), 'utf8')

/* The screen, lifted from the gate rather than restated. */
const m = /^const ALLOWED_CONTACT = (\/.+\/i)$/m.exec(gate)
if (!m) { console.error('TRANSLATOR-CONTACTS: verify-gospel-map.mjs no longer declares ALLOWED_CONTACT — refusing to invent one.'); process.exit(1) }
const CONTACT = new RegExp(m[1].slice(1, -2), 'i')
const RESOURCE = /^const ALLOWED = (\/.+\/i)$/m.exec(gate)
const ALLOWED = new RegExp(RESOURCE[1].slice(1, -2), 'i')

const codes = { ...(idx.codes || {}) }
if (POISON) {
  codes.__p1 = { cr: { o: 'Watchtower', u: 'https://www.jw.org/' } }
  codes.__p2 = { cr: { o: 'Some Org', u: 'https://this-was-never-fetched.example/' } }
  codes.__p3 = { s: 'https://www.wycliffe.org/', cr: { o: 'x' } }
  leaf = leaf.replace(/class="gm-org"/g, 'class="gm-plain"')
}

const verified = new Set(Object.values(orgs).filter((o) => o.state === 'verified').map((o) => o.url))
const fails = []
let contacts = 0
const contactHosts = new Set()
for (const [c, v] of Object.entries(codes)) {
  const u = v.cr && v.cr.u
  if (u) {
    contacts++
    contactHosts.add(new URL(u).host.replace(/^www\./, ''))
    if (!CONTACT.test(u)) fails.push(`${c}: contact ${u} is not on the screened organisation list`)
    if (!verified.has(u)) fails.push(`${c}: contact ${u} is not recorded as verified in translator-org-links.json`)
  }
}
for (const [c, v] of Object.entries(codes)) {
  for (const u of [v.s, v.f, v.z, v.au && v.au.u, v.bv && v.bv.u, v.ga && v.ga.u, v.se && (v.se.u || v.se)]) {
    if (!u) continue
    if (CONTACT.test(u) && !ALLOWED.test(u)) fails.push(`${c}: ${u} is a CONTACT host serving a resource link`)
  }
}
if (!contacts) fails.push('no contact URL in the index at all — this check would pass vacuously')
if (!/class="gm-org"/.test(leaf)) fails.push('resources-map.vue renders no .gm-org anchor — the data carries contacts the sheet never shows')
if (!/credit\.u/.test(leaf)) fails.push('resources-map.vue never reads credit.u')

if (POISON) {
  const want = ['not on the screened organisation list', 'not recorded as verified', 'CONTACT host serving a resource link', 'renders no .gm-org anchor']
  const missed = want.filter((w) => !fails.some((f) => f.includes(w)))
  if (missed.length) { console.error(`TRANSLATOR-CONTACTS --poison: these arms did NOT fire: ${missed.join(' | ')}`); process.exit(1) }
  console.log(`TRANSLATOR-CONTACTS --poison: PASS — all 4 arms fired (${fails.length} failure(s)).`)
  process.exit(0)
}
if (fails.length) {
  console.error(`TRANSLATOR-CONTACTS: FAIL — ${fails.length} problem(s)`)
  for (const f of fails.slice(0, 12)) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`TRANSLATOR-CONTACTS: PASS — ${contacts} credit(s) link an organisation, across ${contactHosts.size} screened host(s); each one verified by fetch and rendered as a link.`)
