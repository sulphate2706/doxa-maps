#!/usr/bin/env node
/**
 * check-ring-vocabulary — the centered set's ring names say the same thing on the PRINTED sheet as
 * they do on the SCREEN.
 *
 * WHY THIS EXISTS: the same agreed vocabulary now lives in TWO catalogues, in eleven locales each.
 *   screen  library/i18n/locales/<lc>/gospelInternet.json   rings.band.* / rings.culture.*
 *   packet  library/scripts/posters/packet-strings.json     ring_band_* / ring_culture_*
 * They legitimately want different SHAPES — the screen renders the axes as standalone labels, the
 * packet composes them into one string per ring ("Same dialect, same people") — so neither can
 * simply import the other. But the WORDS must match, and nothing structural holds them together.
 *
 * ★ THE FAILURE THIS CATCHES IS QUIET AND WELL-SHAPED. One cell is still open ("same people" vs
 * "same culture", pending a product decision), and it appears in rings 1, 4 AND 7. Answer it in one file
 * and not the other and the printed packet and the screen legend state DIFFERENT THINGS about the
 * same ring — each looking perfectly correct in isolation, with no error anywhere. A reader holding
 * the sheet beside the app is the only thing that would notice.
 *
 * Headless, no network, no DOM. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))
const PACKET = read('library/scripts/posters/packet-strings.json')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// The two halves, paired. Read from ONE list so the gate cannot drift from itself.
const AXES = [
  ['ring_band_dialect', 'band', 'dialect'],
  ['ring_band_language', 'band', 'language'],
  ['ring_band_family', 'band', 'family'],
  ['ring_band_geography', 'band', 'geography'],
  ['ring_culture_same', 'culture', 'same'],
  ['ring_culture_near', 'culture', 'near'],
  ['ring_culture_different', 'culture', 'different'],
]

// ⚠ THE ONE SANCTIONED DIFFERENCE, and it is a difference of GRAMMAR, not of vocabulary. On screen a
// culture term is a standalone label ("Near culture"); in the packet it follows a comma mid-sentence
// ("Same dialect, near culture"). So the packet lowercases the FIRST CHARACTER of the culture half
// and nothing else — German common nouns stay capitalised ("gleiches Volk"), and zh/ar/hi have no
// case at all, where this is a no-op. Comparing case-insensitively instead would be the wrong fix:
// it would stop the gate seeing a real capitalisation divergence.
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)

const LOCALES = Object.keys(PACKET).filter((k) => k !== '_meta')
ok(LOCALES.length >= 11, `expected the packet catalogue to carry 11 locales, found ${LOCALES.length}`)

let compared = 0
for (const lc of LOCALES) {
  const p = `library/i18n/locales/${lc}/gospelInternet.json`
  if (!existsSync(resolve(ROOT, p))) {
    fails.push(`no screen catalogue for '${lc}' (${p}) — the packet names rings in a locale the screen cannot`)
    continue
  }
  const rings = read(p).rings
  if (!rings) { fails.push(`'${lc}' gospelInternet.json has no rings block`); continue }
  for (const [pk, group, leaf] of AXES) {
    const mine = PACKET[lc] && PACKET[lc][pk]
    const theirs = rings[group] && rings[group][leaf]
    // A missing key on either side is its own failure — "both absent" must not read as "they agree".
    if (mine === undefined) { fails.push(`packet-strings '${lc}' is missing ${pk}`); continue }
    if (theirs === undefined) { fails.push(`gospelInternet '${lc}' is missing rings.${group}.${leaf}`); continue }
    const want = group === 'culture' ? lowerFirst(theirs) : theirs
    compared++
    ok(mine === want,
      `'${lc}' ring vocabulary DIVERGED — the printed packet and the screen legend would name this ring differently:\n` +
      `        packet ${pk} = ${JSON.stringify(mine)}\n` +
      `        screen rings.${group}.${leaf} = ${JSON.stringify(theirs)}`)
  }
}
// ★ A COMPARISON THAT COMPARED NOTHING IS NOT A PASS. If the key names are ever renamed on either
// side, every lookup returns undefined, every pair is skipped, and a silent gate reports success.
ok(compared === LOCALES.length * AXES.length,
  `only ${compared} of ${LOCALES.length * AXES.length} pairs were actually compared — the gate is measuring less than it claims`)

if (fails.length) {
  console.error('RING-VOCABULARY: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`RING-VOCABULARY: PASS — the packet and the screen name every ring band and culture identically across ${LOCALES.length} locales (${compared} pairs compared), so settling the open cell in one catalogue alone cannot go unnoticed.`)
