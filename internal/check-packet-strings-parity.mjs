#!/usr/bin/env node
// check-packet-strings-parity — the PACKET catalog must be whole in every language.
//
// ★ THE GAP THIS CLOSES. check:i18n-parity guards library/i18n/locales — the APP
// catalogs — and nothing guarded library/scripts/posters/packet-strings.json, which
// is a separate file with its own shape. Six gates READ it (check-packet-render,
// check-card-deck, check-print-geometry, check-packet-browser, check-locale-reachable,
// check-poster-prints) and not one checks that a language block is complete.
//
// That matters because the packet is where the 12 PRAYER POINTS and the PRAYER WHEEL
// live, and those are a stated requirement: they must be translatable into every
// locale doxa-life needs. A point silently dropped from one block renders that slot
// through the per-key English fallback — correct runtime behaviour, invisible defect.
//
// ⚠ IT ASSERTS PRESENCE, NOT TRANSLATEDNESS, and that distinction is load-bearing.
// check-packet-render prints "19 strings translated" and only ever asserted
// `translated === 0`, so a locale regressing from 19 to 1 passed silently. The fix is
// NOT to pin 19: measured 2026-09-24, de translates 18 and fr 17 of the same 19 keys
// because a word or two legitimately matches English ("Metacamp", "Status"). Pinning a
// count fails correct catalogs. What DOES hold for every locale is that every English
// key EXISTS in every block — a structural fact no translation choice can change.
//
// THE ONE DECLARED EXCEPTION is point4_passage + point4_passage_credit: Mark 5:1-20 in
// full, absent from all ten non-English blocks. That is a LICENSING decision, not an
// oversight — the English is deliberately public-domain (World English Bible) and most
// major translations are copyrighted, so it is tracked as
// DECIDE-MARK5-SCRIPTURE-IS-ENGLISH-IN-EVERY-TRANSLATED-PACKET. It is named here
// rather than silently tolerated, so the day someone lands a licensed translation the
// exception can be deleted and the gate tightens by itself.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.DOXA_REPO
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = process.env.PACKET_STRINGS
  || join(REPO, 'library/scripts/posters/packet-strings.json')

if (!existsSync(CATALOG)) {
  console.error(`PACKET-STRINGS-PARITY: FAIL — no catalog at ${CATALOG}`)
  process.exit(1)
}
const cat = JSON.parse(readFileSync(CATALOG, 'utf8'))
const en = cat.en
if (!en) { console.error('PACKET-STRINGS-PARITY: FAIL — no English block to compare against'); process.exit(1) }

// Keys deliberately absent from translated blocks, with the reason. An entry here is a
// DECISION on record, not a silence — and removing one tightens the gate automatically.
const DECLARED_ABSENT = {
  // ⚠ STILL DECLARED, BUT FOR FIVE FEWER LOCALES (2026-09-27). ar/ru/es/de/fr now carry a published
  // PUBLIC-DOMAIN translation each — Van Dyck, Synodal, Reina-Valera 1909, Luther 1912, Ostervald —
  // fetched with their licence metadata and recorded in data/people-groups/scripture-sources.json.
  // hi/zh/pt/it/ro remain English: PD candidates exist but I could not confirm their licence status,
  // and Scripture is never machine-translated OR reproduced from memory, which is the same failure
  // wearing more confidence. This entry shrinks as each locale's text is cited, not as a batch.
  point4_passage: 'Mark 5:1-20 — awaiting a CITED public-domain translation for hi/zh/pt/it/ro',
  point4_passage_credit: 'the attribution line for the passage above',
  point4_passage_bold: 'verse 19, verbatim from the passage above (so only where that passage is on file)',
  // Numbers 6:24-26 on the lightweight list's first page: ro and hi have no strict public-domain text on the
  // pipeline that vetted the other nine, so they print the English per key rather than an unvetted rendering.
  blessing_text: 'Numbers 6:24-26 — no strict public-domain text for ro (only a Cyrillic-script 1924) or hi',
  blessing_credit: 'the attribution line for the blessing above',
  // ── The new packet pages, 2026-09-27: a 100-year life calendar, the same grid shaded by
  // the evangelical share of these groups' population, and the funnel's equation sidebar + tip.
  // ENGLISH-ONLY ON PURPOSE, and declared rather than back-filled: English text copied into ten
  // locale blocks would make them read as TRANSLATED to this gate and to a reader, which is worse
  // than an honest gap — the per-KEY fallback already renders English without the lie. These come out
  // of this list one at a time as real translations arrive.
}

// Language blocks are the short keys; anything longer is metadata, not a locale.
const locales = Object.keys(cat).filter((k) => k !== 'en' && k.length <= 3)
const strKeys = Object.keys(en).filter((k) => typeof en[k] === 'string')

const fails = []
const notes = []
const rows = []

for (const loc of locales) {
  const b = cat[loc]
  const missing = strKeys.filter((k) => typeof b[k] !== 'string' && !(k in DECLARED_ABSENT))
  const absentOk = strKeys.filter((k) => typeof b[k] !== 'string' && (k in DECLARED_ABSENT))
  if (missing.length) {
    fails.push(`${loc} is missing ${missing.length} string key(s): ${missing.slice(0, 4).join(', ')}`)
  }

  // ── THE 12 PRAYER POINTS ──────────────────────────────────────────────────
  // Structure, not prose: twelve of them, each carrying every field the renderer
  // reads. A point with no `text` prints an empty block on a page the reader is
  // meant to pray through.
  const pts = b.points
  if (!Array.isArray(pts)) {
    fails.push(`${loc} has no points array — the 12 prayer points would fall back wholesale to English`)
  } else if (pts.length !== en.points.length) {
    fails.push(`${loc} has ${pts.length} prayer points, expected ${en.points.length}`)
  } else {
    for (let i = 0; i < pts.length; i++) {
      const missF = Object.keys(en.points[i]).filter((f) => pts[i][f] === undefined)
      if (missF.length) fails.push(`${loc} point ${i + 1} is missing ${missF.join(', ')}`)
      if (typeof pts[i].text === 'string' && !pts[i].text.trim()) {
        fails.push(`${loc} point ${i + 1} has an EMPTY text — a blank prayer point is worse than an English one`)
      }
    }
  }

  // ── THE PRAYER WHEEL ──────────────────────────────────────────────────────
  // Twelve rhythms, keyed the same as English. check-packet-render already asserts
  // all twelve RENDER; this asserts the catalog can supply them in the first place.
  const rh = b.rhythms
  if (!rh || typeof rh !== 'object') {
    fails.push(`${loc} has no rhythms block — the prayer wheel would be English in a ${loc} packet`)
  } else {
    const missR = Object.keys(en.rhythms).filter((k) => typeof rh[k] !== 'string')
    if (missR.length) fails.push(`${loc} is missing ${missR.length} wheel rhythm(s): ${missR.slice(0, 4).join(', ')}`)
  }

  const translated = strKeys.filter((k) => typeof b[k] === 'string' && b[k] !== en[k]).length
  const present = strKeys.filter((k) => typeof b[k] === 'string').length
  rows.push({ loc, present, translated, absentOk: absentOk.length })
  // Reported, never failed: a locale sharing a word with English is normal, but a
  // locale sharing ALL of them is indistinguishable from an untranslated block.
  if (present && translated === 0) {
    fails.push(`${loc} has ${present} string(s) and NOT ONE differs from English — `
      + 'the block is present but untranslated, which a reader cannot tell from a missing one')
  }
}

// ── SCRIPTURE ADDRESSES ARE ENGLISH'S, AND THE THEMES ARE WHOLE ───────────────────
// A point's refs are canonical addresses: a language may not keep an older set (point 12 kept Acts 2 / Matthew 28
// in ten languages after English moved to John 17). The prayer themes are seven and the scenes three in every
// language, or the page falls back to English for the whole list.
for (const loc of locales) {
  const b = cat[loc]
  ;(b.points || []).forEach((pt, i) => {
    if (pt && pt.refs !== undefined && JSON.stringify(pt.refs) !== JSON.stringify((en.points[i] || {}).refs)) {
      fails.push(`${loc} point ${i + 1} carries references ${JSON.stringify(pt.refs)}, not English's ${JSON.stringify((en.points[i] || {}).refs)}`)
    }
  })
  if (!Array.isArray(b.themes) || b.themes.length !== 7 || b.themes.some((x) => typeof x !== 'string' || !x.trim())) fails.push(`${loc} needs 7 prayer themes`)
  if (!Array.isArray(b.scenes) || b.scenes.length !== 3 || b.scenes.some((x) => typeof x !== 'string' || !x.trim())) fails.push(`${loc} needs 3 prayer scenes`)
}
if (!Array.isArray(en.scene_refs) || en.scene_refs.length !== 3 || en.scene_refs.some((r) => !Array.isArray(r) || r.length !== 2)) fails.push('en scene_refs must give each of the 3 scenes two references')

// ── ARABIC: NO ALEF WASLA (U+0671) ─────────────────────────────────────────────
// The Van Dyck texts write the article with alef wasla (ٱ). A device whose fonts lack U+0671 printed it as a
// BOX, three times in the blessing and eight in Mark 5. The stored ar text uses plain alef (U+0627), the
// ordinary print form: display only, no word or vowel changes (_meta.note_on_blessing). Asserted on EVERY ar
// value, nested ones included, so the next passage pasted from the same source cannot bring it back.
{
  const hits = []
  const walk = (v, path) => {
    if (typeof v === 'string') { const n = [...v].filter((ch) => ch === '\u0671').length; if (n) hits.push(`${path} (${n})`) }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`)
  }
  walk(cat.ar || {}, 'ar')
  if (hits.length) fails.push(`ar carries U+0671 alef wasla, which prints as a box where a font lacks it — store plain alef (U+0627): ${hits.slice(0, 4).join(', ')}`)
  else notes.push('ar: no U+0671 alef wasla in any value (plain alef, the print form every Arabic font draws)')
}

console.log('PACKET-STRINGS-PARITY')
console.log(`  catalog : ${CATALOG.replace(REPO + '/', '')}`)
console.log(`  locales : ${locales.length} (${locales.join(' ')})`)
console.log(`  shape   : ${strKeys.length} string key(s) + ${en.points.length} prayer points + `
  + `${Object.keys(en.rhythms).length} wheel rhythms`)
for (const r of rows) {
  console.log(`  ${r.loc.padEnd(3)} ${String(r.present).padStart(2)}/${strKeys.length} present`
    + `  ${String(r.translated).padStart(2)} translated`
    + (r.absentOk ? `  (${r.absentOk} declared-absent)` : ''))
}
if (Object.keys(DECLARED_ABSENT).length) {
  console.log('\n  declared absent from every translated block, on record:')
  for (const [k, why] of Object.entries(DECLARED_ABSENT)) console.log(`    ${k} — ${why}`)
}
for (const n of notes) console.log('  ' + n)

if (fails.length) {
  console.error(`\nPACKET-STRINGS-PARITY: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPACKET-STRINGS-PARITY: PASS — every language block carries the whole packet: '
  + 'all string keys, all 12 prayer points with every field, and all 12 wheel rhythms.')
