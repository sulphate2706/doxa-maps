// verify-tables-complete.mjs — assert the table SET is whole, not just well-formed.
//
//   node verify-tables-complete.mjs
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Every other guard here checks tables it is GIVEN. None of them can notice a table
// that stopped being produced — a per-item check cannot catch a missing item. If a
// build script silently dropped `deaf-gap`, each remaining table would still verify
// clean and the app would simply render one fewer list, with nothing red anywhere.
//
// That is the same fail-open shape that hid two real defects in this repo on one day:
//   * verify-posters read crossing counts from a per-run manifest and treated an
//     ABSENT zone as zero — 173 sheets silently passed.
//   * verify-iso2-map read `map[k] && map[k] !== v`, so a DELETED country passed and
//     the guard printed "NER … all correct" about a code that no longer existed.
// In JS `if (lookup[key])` conflates absent / falsey / zero. In verification, ABSENT
// means UNVERIFIED and has to be loud.
//
// index.json already declares the expected table names AND row counts, so the
// contract exists — it was simply never asserted. This asserts it.
//
// PROVEN RED: delete a table file, or drop rows from one, and this must fail.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const T = join(__dirname, 'out', 'tables');

let failed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('TABLE COMPLETENESS — is the SET whole?');

const idxPath = join(T, 'index.json');
if (!existsSync(idxPath)) { console.error('FATAL: out/tables/index.json missing'); process.exit(1); }
const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
const declared = idx.tables || [];

if (declared.length < 12) fail(`index.json declares only ${declared.length} tables — expected >= 12`);
else ok(`index declares ${declared.length} tables`);

let totalRows = 0;
for (const t of declared) {
  const f = join(T, `${t.name}.json`);
  if (!existsSync(f)) { fail(`${t.name}.json is MISSING — declared in index.json but not on disk`); continue; }
  let rows;
  try { rows = (JSON.parse(readFileSync(f, 'utf8')).rows || []).length; }
  catch (e) { fail(`${t.name}.json will not parse: ${String(e.message).slice(0, 60)}`); continue; }
  totalRows += rows;
  // Row counts drift legitimately as sources update, so allow a band rather than an
  // exact match — but a COLLAPSE (empty, or under half) means the table broke.
  if (!rows) fail(`${t.name} has ZERO rows`);
  else if (t.rows && rows < t.rows * 0.5) fail(`${t.name} has ${rows} rows, index expected ~${t.rows} — collapsed`);
}
// AND THE OTHER DIRECTION. Checking declared->disk only proves nothing DECLARED went
// missing; it cannot see a table that EXISTS but was never declared. That is not
// pedantry: gaps-and-opportunities.json (2,106 rows, referenced by other tables'
// caveats) shipped for this whole flight while absent from index.json — so it was
// outside every completeness claim, and the earlier "12 tables / 18,795 rows" headline was
// wrong in every summary and record. An undeclared artifact is unverified by
// construction: nothing knows it should be there, so nothing notices if it breaks.
const declaredNames = new Set(declared.map((t) => t.name));
const onDisk = readdirSync(T)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => f.replace(/\.json$/, ''));
const undeclared = onDisk.filter((n) => !declaredNames.has(n));
if (undeclared.length) {
  for (const n of undeclared) fail(`${n}.json is on disk but NOT declared in index.json — it sits outside every completeness check`);
} else ok(`no undeclared tables (${onDisk.length} on disk == ${declared.length} declared)`);

if (!failed) ok(`all ${declared.length} declared tables present and populated (${totalRows.toLocaleString()} rows)`);

console.log(`\n${failed ? `FAILED — ${failed} problem(s)` : 'TABLE SET COMPLETE'}`);
process.exit(failed ? 1 : 0);
