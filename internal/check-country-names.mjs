/**
 * check-country-names.mjs — every ISO3 our data uses resolves to a localized country name.
 *
 * Guards the join, not the library. Intl.DisplayNames is the platform's; what can rot here is
 * OURS: library/data/iso3-to-alpha2.json (the alpha-3 -> alpha-2 bridge) drifting from
 * library/data/countries.json (the codes the data actually uses). A country added to one and not
 * the other renders as a bare code — a silent defect, because a code still looks like a value.
 *
 * ★ WHY IT ASSERTS THE ARMS THAT MUST FAIL TOO. A coverage gate that only counts hits passes just
 * as happily on a table of 242 correct entries as on one where every lookup quietly returns its
 * input. So the last block feeds it a code that does not exist and a code that is structurally
 * invalid, and FAILS if either is reported as resolved. Without that, this file proves nothing
 * about the 242 above it.
 */
import { readFileSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const table = read('../library/data/iso3-to-alpha2.json').map
const countries = read('../library/data/countries.json')

// ar and zh are the two the brief names, and they are the two worth naming: ar is our only RTL
// locale and zh uses a script where an untranslated Latin code is unmistakable on sight.
const LOCALES = ['en', 'ar', 'zh']
const fail = []

// ── 1. the bridge covers every code the data uses, in both directions ──────────────────────────
const dataCodes = countries.map((c) => c.value)
const missing = dataCodes.filter((c) => !table[c])
const orphans = Object.keys(table).filter((c) => !dataCodes.includes(c))
if (missing.length) fail.push(`${missing.length} code(s) in countries.json with no alpha-2: ${missing.slice(0, 8).join(', ')}`)
if (orphans.length) fail.push(`${orphans.length} code(s) in the table that the data never uses: ${orphans.slice(0, 8).join(', ')}`)

// ── 2. every code resolves to a real NAME, in every locale we check ────────────────────────────
const dn = {}
for (const l of LOCALES) {
  try { dn[l] = new Intl.DisplayNames([l], { type: 'region' }) } catch { fail.push(`Intl.DisplayNames unavailable for '${l}'`) }
}
let checked = 0
const unresolved = []
for (const iso3 of dataCodes) {
  const a2 = table[iso3]
  if (!a2) continue
  for (const l of LOCALES) {
    if (!dn[l]) continue
    let name = null
    try { name = dn[l].of(a2) } catch { name = null }
    // An unknown-but-well-formed region comes back as the INPUT. That is not a name.
    if (!name || name === a2) unresolved.push(`${iso3}->${a2} @${l}`)
    checked++
  }
}
if (unresolved.length) fail.push(`${unresolved.length} unresolved: ${unresolved.slice(0, 8).join(', ')}`)

// ── 3. THE ARMS THAT MUST FAIL — without these, everything above is unfalsifiable ──────────────
const mustNotResolve = [
  ['ZZZ', 'a code that is well-formed but assigned to nothing'],
  ['QQ',  'a two-letter code with no country behind it'],
]
for (const [code, why] of mustNotResolve) {
  let name = null
  try { name = dn.en ? dn.en.of(code) : null } catch { name = null }
  if (name && name !== code) fail.push(`NEGATIVE ARM BROKEN: '${code}' (${why}) resolved to "${name}" — this gate cannot distinguish a hit from a miss`)
}

if (fail.length) {
  console.error('COUNTRY-NAMES: FAIL')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`COUNTRY-NAMES: PASS — ${dataCodes.length} code(s) resolve in ${LOCALES.join('/')} (${checked} lookups), and both negative arms still fail.`)
