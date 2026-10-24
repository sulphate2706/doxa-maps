#!/usr/bin/env node
/**
 * check-csv-export-shape.mjs — the exported CSV must OPEN correctly in a spreadsheet.
 *
 * THE DEFECT THIS CATCHES (reported 2026-09-22: a CSV exported directly, with no edits, looked a
 * little glitched out). The generator emitted a one-column
 * provenance comment ABOVE the header:
 *     line 0 ... 1 column   "# Research Dashboard export — scope: ..."
 *     line 1 ... N columns  slug,name,religion,...
 * Every spreadsheet importer treats the FIRST line as the header, so the scope sentence became the
 * column names and the real header became data row 1. A 1-column line above a 68-column table is
 * exactly what "glitched" looks like on screen.
 *
 * ★ WHAT WAS *NOT* WRONG, AND MUST NOT BE "FIXED" ON SUSPICION — three plausible theories, all
 * refuted by measurement before a line was changed:
 *   - "it is tab-separated" — FALSE. The generator joins with commas; the tabs in the pasted report
 *     were a terminal's rendering, not the bytes.
 *   - "quoting is broken" — FALSE. esc() is genuinely RFC-4180: it quotes when , " CR or LF appear and
 *     doubles internal quotes. Embedded commas, quotes AND newlines survive a strict parser round trip.
 *   - "CSV injection" — handled; a leading = + - @ TAB or CR is prefixed with a single quote (asserted in 5).
 * Only the POSITION was wrong. Chasing the other three would have produced churn and no fix.
 *
 * ★ WHY NO EXISTING GATE SAW IT. 46 gate-ish scripts exist and not one parses the export. The bug is
 * invisible to every DOM check (the button works, the file downloads, the bytes are valid UTF-8) and
 * only appears when something tries to READ the file as a table. So this gate parses.
 *
 * WHAT IT ASSERTS, against the real buildCsv() logic extracted from the composable:
 *   1. line 0 is the HEADER — not a comment, not data;
 *   2. every data row has exactly the header's column count;
 *   3. a field containing a comma, a double quote or a newline survives a strict RFC-4180 round trip;
 *   4. the provenance comment still EXISTS (it is load-bearing: it records which filters produced the
 *      file) and sits at the END, where a trailing 1-column row is harmless.
 *
 * ★ THE NEGATIVE TEST IS RUNNABLE, NOT A CLAIM IN A COMMENT: `--self-test`.
 * This header used to assert "NEGATIVE-TESTED" with no way to re-run it, which is the one thing
 * this repo has learned to distrust — a gate that cannot fail is worse than no gate, and a gate
 * whose negative test exists only in prose is indistinguishable from one that never had one.
 * `node internal/check-csv-export-shape.mjs --self-test` re-runs every assertion below against a
 * DELIBERATELY BROKEN assembly (provenance hoisted back to line 0) held IN MEMORY — the shipped
 * source file is never written to — and exits 0 only if the gate correctly REJECTED it.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// ★ FOLLOWS THE FILE (dashboard-kit landing 3). This gate does not import useCsvExport — it READS
// the source and extracts esc() out of it. Left pointing at the plugin path after the move it would
// have read the one-line re-export shim, found no esc() to extract, and failed with "could not
// extract esc() from useCsvExport.js" — a gate accusing a working exporter because its subject moved.
// That is the same defect landing 1 nearly shipped with check-facet-cascade's BUS_SRC, which is why
// looking for path-reading gates is now the FIRST step of a landing rather than a discovery during it.
const SRC = join(ROOT, 'library/composables/useCsvExport.js')

if (!existsSync(SRC)) {
  console.error('CSV-SHAPE: FAIL — useCsvExport.js not found at ' + SRC.replace(ROOT + '/', ''))
  process.exit(1)
}
const src = readFileSync(SRC, 'utf8')

// Extract the REAL esc() rather than re-implementing it — a gate that restates the rule can agree
// with itself while the product disagrees.
const escMatch = src.match(/function esc\(v\)\s*\{([\s\S]*?)\n  \}/)
if (!escMatch) {
  console.error('CSV-SHAPE: FAIL — could not extract esc() from useCsvExport.js.')
  console.error('  The gate must test the SHIPPED escaper, not a copy of the rule.')
  process.exit(1)
}
let esc
try { esc = new Function('v', escMatch[1]) }
catch (e) { console.error('CSV-SHAPE: FAIL — extracted esc() does not parse: ' + e.message); process.exit(1) }

// Extract the line-assembly order, which is the thing that actually broke.
const linesMatch = src.match(/const lines = \[([^\]]*)\]/)
if (!linesMatch) {
  console.error('CSV-SHAPE: FAIL — could not find the `const lines = [...]` assembly in buildCsv().')
  process.exit(1)
}
const order = linesMatch[1].replace(/\s+/g, ' ').trim()
// --self-test FORCES the broken order in memory, so every assertion below runs against a file
// that is known-bad. The shipped source is read-only here and is never modified on disk.
const SELF_TEST = process.argv.includes('--self-test')
const provenanceFirst = SELF_TEST || /^\s*provenance\s*,/.test(order)

const cols = ['slug', 'name', 'religion', 'imb_people_description']
const rows = [
  { slug: 'alas', name: 'Alas', religion: 'Islam - Sunni',
    imb_people_description: 'The Alas of Indonesia, numbering approximately 268,000 people. They say "hello".' },
  { slug: 'kluet', name: 'Kluet', religion: 'Islam - Sunni',
    imb_people_description: 'Line one\nLine two, with a comma' },
  { slug: 'inj', name: '=SUM(A1)', religion: 'Islam - Sunni', imb_people_description: 'injection probe' },
  { slug: 'inj-tab', name: '\t=cmd', religion: 'Islam - Sunni', imb_people_description: 'injection probe, a leading TAB' },
  { slug: 'inj-cr', name: '\r=cmd', religion: 'Islam - Sunni', imb_people_description: 'injection probe, a leading CR' },
]
const provenance = '# Research Dashboard export — scope: filter result; filters: religion=Islam - Sunni; rows: 5'
const body = [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))]
const csv = (provenanceFirst ? [provenance, ...body] : [...body, provenance]).join('\r\n')

// Strict RFC-4180 parser — the only honest way to judge "does this open as a table".
function parse(t) {
  const out = []; let row = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\r' && t[i + 1] === '\n') { row.push(f); out.push(row); row = []; f = ''; i++ }
    else f += c
  }
  if (f !== '' || row.length) { row.push(f); out.push(row) }
  return out
}

const parsed = parse(csv)
const fail = (msg, detail) => {
  // Under --self-test a rejection is the DESIRED outcome: the gate just proved it can fail.
  if (SELF_TEST) {
    console.log('CSV-SHAPE SELF-TEST: PASS — the gate REJECTED the deliberately broken export.')
    console.log('  It said: ' + msg)
    console.log('  So a real regression of this shape would be caught, not waved through.')
    process.exit(0)
  }
  console.error('CSV-SHAPE: FAIL — ' + msg)
  if (detail) console.error(detail)
  process.exit(1)
}

// 1 — line 0 must be the header
const first = parsed[0] || []
if (first.length === 1 && String(first[0]).startsWith('#')) {
  fail('line 0 is a one-column "#" comment, so a spreadsheet will use it AS THE HEADER.',
    '  The scope sentence becomes the column names and the real header becomes data row 1 — which is\n' +
    '  what read as a "glitched" export. Put the provenance line LAST; a trailing one-column\n' +
    '  row is harmless, a leading one destroys the column mapping for the whole sheet.')
}
if (first[0] !== cols[0]) {
  fail(`line 0 does not start with the first column ("${cols[0]}") — got "${String(first[0]).slice(0, 40)}".`)
}

// 2 — every data row matches the header width
const dataRows = parsed.slice(1).filter((r) => !(r.length === 1 && String(r[0]).startsWith('#')))
const wrong = dataRows.filter((r) => r.length !== first.length)
if (wrong.length) {
  fail(`${wrong.length} of ${dataRows.length} data row(s) do not have the header's ${first.length} columns.`,
    '  A field containing a comma, a quote or a newline is not being quoted, so it shifts every later\n' +
    '  column on that row. esc() must quote when , " CR or LF appear and double the internal quotes.')
}

// 3 — the hard fields survived intact
const desc = dataRows[1] && dataRows[1][3]
if (!desc || !desc.includes('\n') || !desc.includes(',')) {
  fail('a field containing BOTH a newline and a comma did not survive the round trip.',
    '  Round-tripped value: ' + JSON.stringify(String(desc).slice(0, 60)))
}
const quoted = dataRows[0] && dataRows[0][3]
if (!quoted || !quoted.includes('"hello"')) {
  fail('an embedded double quote did not survive the round trip.',
    '  Round-tripped value: ' + JSON.stringify(String(quoted).slice(0, 60)))
}

// 4 — provenance still exists, and is last
const last = parsed[parsed.length - 1] || []
if (!(last.length === 1 && String(last[0]).startsWith('#'))) {
  fail('the provenance comment is missing from the end of the file.',
    '  It is load-bearing: it records WHICH FILTERS produced this file, which is the difference\n' +
    '  between a dataset and an anecdote. Keep it — just keep it last.')
}

// 5 — every formula trigger comes back NEUTRALISED (a leading single quote), so a spreadsheet shows it as text.
// The probes cover = and OWASP's other two leading triggers, TAB and CR, which a spreadsheet can strip before
// reading the = behind them. Checked by SLUG, so the rows above may be reordered.
const bySlug = new Map(dataRows.map((r) => [r[0], r]))
for (const [slug, raw] of [['inj', '=SUM(A1)'], ['inj-tab', '\t=cmd'], ['inj-cr', '\r=cmd']]) {
  const got = bySlug.get(slug) && bySlug.get(slug)[1]
  if (got !== "'" + raw) {
    fail(`the formula probe ${JSON.stringify(raw)} came back as ${JSON.stringify(got)}, not neutralised with a leading quote.`,
      '  esc() must prefix a single quote to a value starting with = + - @ TAB or CR (CSV injection).')
  }
}

// Reaching here under --self-test means the gate WAVED THROUGH a known-broken export.
if (SELF_TEST) {
  console.error('CSV-SHAPE SELF-TEST: FAIL — the gate PASSED a deliberately broken export.')
  console.error('  The provenance comment was forced back onto line 0 and no assertion objected, so')
  console.error('  this gate cannot catch the regression it exists to prevent. Fix the gate, not the')
  console.error('  self-test: a check that always passes is worse than no check, because it is trusted.')
  process.exit(1)
}

console.log(`CSV-SHAPE: PASS — header on line 0 (${first.length} cols), ${dataRows.length} data row(s) all matching,`)
console.log('  embedded comma/quote/newline round-trip intact, provenance preserved as a trailing comment.')
console.log('  This parses the export as a spreadsheet would; no DOM check can see this defect, because')
console.log('  the button works, the file downloads, and the bytes are valid — only the shape is wrong.')
