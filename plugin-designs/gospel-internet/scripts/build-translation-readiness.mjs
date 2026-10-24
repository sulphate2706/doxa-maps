#!/usr/bin/env node
/**
 * build-translation-readiness.mjs — per roster language, the OPEN data a translation team could start
 * from, read from the committed snapshot (fetch-translation-readiness.mjs) and eBible's index. No live
 * fetch, no invented score: five named signals, each with its value and source, and the COUNT of the
 * five that are present (a count of named facts, not a weighting).
 *
 *   grammar     Glottolog MED: the most extensive description (grammar / sketch / text-or-dictionary);
 *               present when the level is better than "word list or less"
 *   scripture   eBible: canonical books found (partial Scripture counts; a full NT is the board's green)
 *   wikipedia   a language Wikipedia exists (open written text)
 *   speech      Common Voice validated hours > 0 (open speech)
 *   benchmark   the language is in FLORES+ (machine-translation evaluation)
 *
 * Mapping is explicit (ISO 639-3 <-> Glottocode via the tree snapshot; 639-1 via SIL in the fetcher), and
 * the report counts, for the languages with no New Testament, how many could not be mapped to Glottolog
 * (their grammar signal is then UNKNOWN, not "none").
 * Outputs data/tables/gospel-internet-readiness.json (+ the public copy). `--check` compares.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
const CHECK = process.argv.includes('--check')

const snap = JSON.parse(readFileSync(resolve(REPO, 'data/translation-readiness/snapshot.json'), 'utf8'))
const tree = T('gospel-internet-tree.json')
const gi = T('gospel-internet.json')
const ebible = T('ebible-index.json').codes || {}
const glotto = JSON.parse(readFileSync(resolve(REPO, 'data/glottolog/glottolog-subset.json'), 'utf8'))
const inGlottolog = new Set(glotto.languoids.filter((l) => l.iso).map((l) => l.iso))

const byIso = new Map()
for (const r of gi.rows) {
  const e = byIso.get(r.iso639_3) || { iso: r.iso639_3, language: r.language, groups: 0, people: 0 }
  e.groups++; e.people += Number(r.population) || 0
  byIso.set(r.iso639_3, e)
}
const stOf = new Map(tree.nodes.filter((n) => n.iso && n.st).map((n) => [n.iso, n.st]))

const rows = []
for (const e of byIso.values()) {
  const m = snap.med[e.iso]
  const eb = ebible[e.iso]
  const books = eb ? Number(eb.books) || 0 : 0
  const row = {
    iso: e.iso, language: e.language, groups: e.groups, people: e.people,
    nt: stOf.get(e.iso) === 'g',
    grammar_level: m ? m.level : null,                     // 0 long grammar .. 4 word list or less
    grammar: m ? snap.med_codes[m.level] : (inGlottolog.has(e.iso) ? '' : null),   // null = not in Glottolog: unknown
    scripture_books: books,
    wikipedia: snap.wikipedia[e.iso] || '',
    speech_hours: snap.commonVoice[e.iso] || 0,
    benchmark: (snap.flores[e.iso] || []).join(' '),
  }
  row.signals = [row.grammar_level !== null && row.grammar_level < 4, books > 0, !!row.wikipedia, row.speech_hours > 0, !!row.benchmark].filter(Boolean).length
  rows.push(row)
}
rows.sort((a, b) => a.iso.localeCompare(b.iso))

const noNt = rows.filter((r) => !r.nt)
const count = (f) => noNt.filter(f).length
const coverage = {
  languages: rows.length, without_new_testament: noNt.length,
  not_in_glottolog: count((r) => r.grammar === null),
  signal: { grammar: count((r) => r.grammar_level !== null && r.grammar_level < 4), scripture: count((r) => r.scripture_books > 0),
    wikipedia: count((r) => !!r.wikipedia), speech: count((r) => r.speech_hours > 0), benchmark: count((r) => !!r.benchmark) },
  by_signal_count: noNt.reduce((m, r) => { m[r.signals] = (m[r.signals] || 0) + 1; return m }, {}),
  source_codes_unmapped: snap.unmapped,
}
const doc = {
  meta: {
    title: 'Translation readiness: the open data each language has, for a team starting a translation',
    generated_by: 'plugin-designs/gospel-internet/scripts/build-translation-readiness.mjs',
    snapshot: snap.fetched,
    sources: { ...snap.sources, ebible: { name: 'eBible.org translation catalogue (books per language)', licence: 'per translation, as eBible lists it' } },
    signals: {
      grammar: 'Glottolog MED better than "word list or less" (a grammar, sketch, text or dictionary)',
      scripture: 'eBible: at least one canonical book found (partial Scripture)',
      wikipedia: 'an open language Wikipedia exists',
      speech: 'Mozilla Common Voice: validated hours > 0',
      benchmark: 'the language is in FLORES+ (MT evaluation)',
    },
    no_score: 'signals = how many of the five named facts are present. It is a count, not a weighting or a prediction.',
    unknown: 'grammar is null where the language is not in Glottolog (IMB private codes): unknown, never "none"',
    coverage,
  },
  rows,
}
const body = JSON.stringify(doc) + '\n'
const OUTS = ['data/tables', 'public/dx-maps/assets/tables'].map((d) => resolve(REPO, d, 'gospel-internet-readiness.json'))
if (CHECK) {
  let same = true
  for (const o of OUTS) { try { if (readFileSync(o, 'utf8') !== body) same = false } catch { same = false } }
  console.log(same ? 'ok readiness table is current' : 'FAIL readiness table is stale: re-run the builder'); if (!same) process.exitCode = 1
} else {
  for (const o of OUTS) writeFileSync(o, body)
  console.log('ok wrote gospel-internet-readiness.json:', rows.length, 'languages')
}
console.log(JSON.stringify(coverage))
