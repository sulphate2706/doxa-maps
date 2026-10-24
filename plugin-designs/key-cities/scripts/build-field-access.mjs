#!/usr/bin/env node
/**
 * build-field-access.mjs — the PRIVATE field-access table, built from the research inputs in
 * library/scripts/research/out/ (run fetch + derive there first).
 *
 * This file lives in plugin-designs/key-cities/, which the public export removes
 * (deployment/cloud/public-exclusions.txt), so the public research script carries no trace of the table. The
 * table is NEVER written inside the repo: set DOXA_PRIVATE_DIR to a folder OUTSIDE the checkout to keep it for
 * internal analysis; without it the table is built, checked and discarded.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', '..', 'library', 'scripts', 'research', 'out');
const PRIVATE_DIR = process.env.DOXA_PRIVATE_DIR ? resolve(process.env.DOXA_PRIVATE_DIR) : null;
const read = (f) => JSON.parse(readFileSync(join(OUT, f), 'utf8'));
const has = (f) => existsSync(join(OUT, f));

function writePrivate(name, rows, columns, meta, assert) {
  if (!rows.length) throw new Error(`[private] ${name}: EMPTY — refusing to write an empty table`);
  const fields = columns.map((c) => c.field);
  for (const r of rows.slice(0, 50)) for (const f of fields) if (!(f in r)) throw new Error(`[private] ${name}: row missing declared column '${f}'`);
  if (assert) assert(rows);
  if (!PRIVATE_DIR) { console.log(`[private] ${name}: ${rows.length} rows built and checked; not kept (set DOXA_PRIVATE_DIR, outside the repo)`); return }
  const real = (p) => resolve(p);
  if (real(PRIVATE_DIR).startsWith(real(resolve(__dirname, '..', '..', '..')) + '/')) throw new Error('[private] DOXA_PRIVATE_DIR is inside the checkout; it must be outside it');
  const dir = join(PRIVATE_DIR, 'tables');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ meta, columns, rows }, null, 1));
  console.log(`[private] ${name}: ${rows.length} rows → ${dir}`);
}

// ═══ TABLE 12 — FIELD ACCESS: visa requirements into DX countries ══════════
// Per place: laws and visa restrictions for nomadic travellers and tourists.
//
// SOURCE: the passport-index open dataset (ilyankou/passport-index-dataset on
// GitHub) — 39,601 passport x destination rows, PUBLIC, no key. A numeric value is
// the visa-free stay in DAYS; the rest are visa-required / e-visa / visa-on-arrival
// / eta / visa-free.
//
// WHY THIS IS SHAPED AROUND A FEW PASSPORTS AND NOT ALL 199:
// The question is not "the full 199x199 matrix" — that is 39,601 rows of mostly
// irrelevance. It is "can a labourer holding a common sending passport REACH the
// places where these people groups live?" So this emits one row per
// DX-COUNTRY x SENDING-PASSPORT for a small set of widely-held passports, which is
// the shape the question actually has.
//
// ═══ WHAT THIS IS NOT — READ BEFORE ACTING ═════════════════════════════════
// This is TOURIST/VISITOR entry policy. It is NOT permission to do religious work,
// NOT residency, and NOT a safety assessment. A country can be visa-free and still
// be somewhere this work carries real risk — those are orthogonal facts and this
// table only carries the first. Anyone reading "visa free" as "open" would be
// making exactly the inference this dataset cannot support.
//
// LAWS per city remain NOT DONE. No free, keyless, machine-readable source for
// religious-freedom or assembly law was found; the honest sources (USCIRF, Open
// Doors, Freedom House) publish PDF/HTML reports requiring a cited human pass.
if (existsSync(join(OUT, 'passport-index.csv'))) {
  const csv = readFileSync(join(OUT, 'passport-index.csv'), 'utf8').trim().split('\n');
  const iso2to3 = {};
  try {
    const m = JSON.parse(readFileSync(join(OUT, 'iso3-to-iso2.json'), 'utf8'));
    for (const [i3, i2] of Object.entries(m)) iso2to3[i2] = i3;
  } catch (_) { /* no map = no table */ }

  // Widely-held sending passports. Named explicitly so the choice is visible and
  // arguable, rather than an unexplained subset.
  const SENDING = { US: 'United States', GB: 'United Kingdom', BR: 'Brazil', KR: 'South Korea',
                    NG: 'Nigeria', IN: 'India', PH: 'Philippines', ZA: 'South Africa' };

  const spine5 = has('city-candidates.json') ? read('city-candidates.json') : { clusters: [] };
  const dxIso3 = new Set(spine5.clusters.map((c) => c.iso3));
  const groups = {};
  for (const c of spine5.clusters) {
    groups[c.iso3] = groups[c.iso3] || { g: 0, country: c.country, region: c.region };
    groups[c.iso3].g += c.people_group_count;
  }

  const rows = [];
  for (let i = 1; i < csv.length; i++) {
    const [pass, dest, req] = csv[i].split(',').map((x) => x.trim());
    if (!SENDING[pass]) continue;
    const dIso3 = iso2to3[dest];
    if (!dIso3 || !dxIso3.has(dIso3)) continue;
    const meta = groups[dIso3] || {};
    // "-1" is passport-index's sentinel for SAME COUNTRY — a national entering their
    // own country. It is not a visa requirement and there is no field-access question
    // to answer, but it was rendering in the table as though "-1" were a requirement
    // (6 rows: India<-India, Brazil<-Brazil, Nigeria<-Nigeria, USA, South Africa,
    // Philippines). Same class as a wrong-but-populated row: a meaningless value
    // presented as a real one gets read as one. Drop the row rather than surface it.
    if (req === '-1' || req === -1) continue;
    const days = /^\d+$/.test(req) ? Number(req) : null;
    rows.push({
      destination: meta.country || dIso3,
      dest_iso3: dIso3,
      region: meta.region || '',
      passport: SENDING[pass],
      passport_iso2: pass,
      requirement: days != null ? `visa free ${days} days` : req,
      visa_free: days != null || req === 'visa free',
      visa_free_days: days,
      needs_visa_in_advance: req === 'visa required',
      on_arrival_or_evisa: req === 'visa on arrival' || req === 'e-visa' || req === 'eta',
      people_groups: meta.g || 0,
      scope_note: 'TOURIST/VISITOR entry only — NOT permission for religious work, NOT residency, NOT a safety assessment',
      source: 'passport-index open dataset (public, no key)',
    });
  }
  if (rows.length) {
    rows.sort((a, b) => b.people_groups - a.people_groups || a.destination.localeCompare(b.destination));
    writePrivate('field-access-visas', rows, [
      { title: 'Destination', field: 'destination', type: 'string' },
      { title: 'ISO3', field: 'dest_iso3', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
      { title: 'Passport', field: 'passport', type: 'string' },
      { title: 'Requirement', field: 'requirement', type: 'string' },
      { title: 'Visa free', field: 'visa_free', type: 'boolean' },
      { title: 'Visa-free days', field: 'visa_free_days', type: 'number' },
      { title: 'Visa in advance', field: 'needs_visa_in_advance', type: 'boolean' },
      { title: 'On arrival / e-visa', field: 'on_arrival_or_evisa', type: 'boolean' },
      { title: 'People groups', field: 'people_groups', type: 'number' },
      { title: 'Scope', field: 'scope_note', type: 'string' },
    ], {
      title: 'Field Access — Visa Requirements',
      grain: 'one row per DX destination x sending passport',
      passports_chosen: Object.values(SENDING).join(', ') + ' — a deliberate subset of widely-held sending passports, not the full 199x199 matrix (39,601 rows of mostly irrelevance).',
      HARD_SCOPE_LIMIT: 'TOURIST/VISITOR entry policy ONLY. NOT permission to do religious work, NOT residency, and NOT a safety assessment. A country can be visa-free AND a place where this work carries real risk — orthogonal facts, and only the first is here.',
      laws_not_done: 'Religious-freedom / assembly LAW per country is NOT in this corpus. No free keyless machine-readable source was found; USCIRF, Open Doors and Freedom House publish reports that need a cited human pass.',
      source: 'https://github.com/ilyankou/passport-index-dataset (public, no key)',
    }, (r) => {
      const bad = r.find((x) => x.visa_free && x.needs_visa_in_advance);
      if (bad) throw new Error('validation: a row is both visa-free and visa-required');
    });
  }
}
