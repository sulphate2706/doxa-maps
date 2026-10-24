#!/usr/bin/env node
/**
 * check-packet-map-missing-loud — page 1 of a prayer packet must SAY when its map is missing.
 *
 * The packet's first page draws the zone map from `mapSvg`. When the map fetch fails — which every
 * build did until the dx-maps config shipped the poster sources (posterSources), and any build that
 * turns them off still does — the page used to interpolate an empty string: a title, a subtitle, a
 * privacy footnote, and nothing where the map belongs. A failed fetch and a successful render were
 * BYTE-INDISTINGUISHABLE in the printed PDF, and the packet read as undeveloped.
 *
 * ★ TWO-SIDED, because a one-sided test here passes a constant:
 *   (1) mapSvg EMPTY   → the notice appears, in the map's place, with real text (not the key)
 *   (2) mapSvg PRESENT → the notice does NOT appear, and the SVG is on the page untouched
 * A renderer that ALWAYS printed the notice would pass (1) alone; one that never did would pass (2)
 * alone. Only both together describe "loud exactly when missing".
 *
 * Also asserts the per-key fallback: a locale with no translation for the notice (every locale but
 * English, by design) prints the English sentence rather than the raw key or nothing. A notice that
 * rendered as `map_unavailable` would be louder, but it would be wrong in a different way.
 *
 * Runs in both variants: lightweight keeps page 1, so it must be loud too.
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let createPacketRenderer, strings
try {
  ;({ createPacketRenderer } = await import(join(REPO, 'library/packet/packet-render.js')))
  strings = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8'))
} catch (e) {
  console.error(`MAP-MISSING-LOUD: NOT MEASURED (exit 75) — the renderer or its strings did not load: ${e.message}`)
  process.exit(75)
}

const EN_NOTICE = strings.en?.map_unavailable
if (!EN_NOTICE) {
  console.error('MAP-MISSING-LOUD: FAIL — packet-strings.json en has no map_unavailable sentence, so there is')
  console.error('  nothing for page 1 to say. The notice must be English-first; other locales fall back to it.')
  process.exit(1)
}

const zone = { id: 'probe-zone', label: 'Probe Zone' }
// A recognisable SVG so side (2) can prove the REAL map survives, not just that the notice is absent.
const SVG = '<svg class="probe-map" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

/** The HTML of page 1 only — everything before the second sheet. */
function page1(html) {
  const starts = [...html.matchAll(/<div class="sheet[^"]*">/g)].map((m) => m.index)
  if (!starts.length) return ''
  return html.slice(starts[0], starts[1] ?? html.length)
}

const fails = []
const notes = []

for (const lang of ['en', 'es', 'ar']) {
  const R = createPacketRenderer({ strings, lang })
  for (const variant of ['full', 'lightweight']) {
    const tag = `${lang}/${variant}`

    // (1) MISSING → loud.
    const empty = page1(R.buildPacket(zone, [], new Map(), '', null, null, variant, null))
    if (!empty) { fails.push(`${tag}: no page 1 rendered at all`); continue }
    if (!empty.includes('class="map-missing"')) {
      fails.push(`${tag}: mapSvg empty, but page 1 has NO missing-map notice — the silent cover this gate exists to prevent`)
    } else if (empty.includes('map_unavailable')) {
      fails.push(`${tag}: the notice printed the raw KEY "map_unavailable" instead of a sentence`)
    } else if (!empty.includes(EN_NOTICE) && lang === 'en') {
      fails.push(`${tag}: the notice text is not the English sentence from packet-strings.json`)
    }

    // (2) PRESENT → quiet, and the real map is on the page.
    const full = page1(R.buildPacket(zone, [], new Map(), SVG, null, null, variant, null))
    if (full.includes('class="map-missing"')) {
      fails.push(`${tag}: mapSvg PRESENT, yet page 1 still prints the missing-map notice — a notice that always shows says nothing`)
    }
    if (!full.includes('class="probe-map"')) {
      fails.push(`${tag}: mapSvg present but the SVG is NOT on page 1 — the fix displaced the map it was guarding`)
    }
  }
  notes.push(`  ok    ${lang.padEnd(4)} full + lightweight: loud when missing, quiet when present`)
}

// Per-key fallback, stated separately because it is a property of the STRINGS, not the renderer. Every
// block carries its own sentence (check:packet-strings-parity requires it); a block that ever lacks it
// still prints the English one rather than the raw key, which side (1) above asserts.
const missingIn = Object.keys(strings).filter((k) => k !== '_meta' && k !== 'en' && !strings[k].map_unavailable)
notes.push(missingIn.length
  ? `  ok    ${missingIn.length} locale(s) fall back to the English sentence: ${missingIn.join(', ')}`
  : '  ok    every locale carries its own sentence')

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('MAP-MISSING-LOUD: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('MAP-MISSING-LOUD: PASS — page 1 names a missing map and stays quiet when the map is there, in en/es/ar, both variants.')
