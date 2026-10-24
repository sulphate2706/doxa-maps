#!/usr/bin/env node
/**
 * fetch-iso-macrolanguages.mjs — snapshot SIL's ISO 639-3 macrolanguage mappings.
 *
 * WHAT IT IS FOR. The single largest entry in this map's gap list is "Chinese, Jinyu —
 * 60.3 million people — nothing found", followed by Gan at 41.3M. Both are true statements
 * about those ISO codes and both are misleading as priorities: ISO 639-3 files them as
 * members of the macrolanguage `zho`, alongside `cmn` (Mandarin), which has Scripture, film,
 * audio and training here. A worker reading the gap list top-down would be sent to the two
 * places least likely to need them.
 *
 * Measured: 84 people-group pins covering 140M people sit at "nothing found" while a sibling
 * variety of their own ISO macrolanguage carries resources.
 *
 * WHAT THIS IS NOT. Macrolanguage membership is NOT a claim of mutual intelligibility, and
 * the map must never present it as one. Spoken Jinyu and spoken Mandarin are not mutually
 * intelligible; what they share is a written standard. ISO's own relation is the only thing
 * asserted here — "the standard files these as varieties of one language" — and the reader
 * is told exactly that, so they can judge it. It changes no tier and closes no gap.
 *
 * The table is fetched rather than transcribed so it cannot silently go stale, and it is
 * written through the snapshot guard like every other catalogue here.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'data/tables/iso-macrolanguages.json')
const SRC = 'https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3-macrolanguages.tab'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const res = await fetch(SRC, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
if (!res.ok) throw new Error(`macrolanguages.tab: HTTP ${res.status}`)
const text = await res.text()
const lines = text.trim().split('\n').slice(1)
if (lines.length < 300) throw new Error(`macrolanguages.tab gave only ${lines.length} rows — refusing to run on a truncated table`)

// I_Status 'A' is active; 'R' is retired. A retired membership is not a current fact.
const macroOf = {}
const members = {}
let retired = 0
for (const line of lines) {
  const [m, i, st] = line.split('\t')
  if ((st || '').trim() !== 'A') { retired++; continue }
  macroOf[i] = m
  ;(members[m] = members[m] || []).push(i)
}

writeSnapshot(
  OUT,
  `${JSON.stringify({
    _note: 'ISO 639-3 macrolanguage membership from SIL. Active memberships only. NOT a claim of mutual intelligibility — it is only what the standard files together.',
    source: SRC,
    generated: new Date().toISOString().slice(0, 10),
    counts: { rows: lines.length, active: Object.keys(macroOf).length, retired, macrolanguages: Object.keys(members).length },
    macroOf,
    members,
  }, null, 1)}\n`,
  (j) => Object.keys(j.macroOf || {}).length,
  'active ISO 639-3 macrolanguage memberships',
)
console.log(`ISO-MACRO: ${Object.keys(macroOf).length} active memberships across ${Object.keys(members).length} macrolanguages (${retired} retired rows skipped)`)
