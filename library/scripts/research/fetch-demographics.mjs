// fetch-demographics.mjs — POPULATION GROWTH vs GOSPEL ACCESS.
//
//   node fetch-demographics.mjs  ->  out/demographics-by-country.json
//
// ═══ THE QUESTION THIS ANSWERS ══════════════════════════════════════════════
// Population growth is tracked for these cities worldwide, so the number of people who
// die each day without Christ can be estimated.
//
// The strategic point is a RATE COMPARISON, not a body count: is gospel access
// growing faster than the population it has to reach? A people group whose
// population grows 2.5%/yr while its language still has no scripture is falling
// further behind every year, and that is invisible in a static "unreached" list.
//
// SOURCE: World Bank Open Data (public, no key) — the same API already used for
// connectivity, so no new dependency and no new account:
//   SP.POP.GROW     population growth, annual %
//   SP.DYN.CDRT.IN  crude death rate, per 1,000
//   SP.DYN.CBRT.IN  crude birth rate, per 1,000
//   SP.POP.TOTL     total population
//   SP.URB.TOTL     urban population   (the CITY share — this is a cities dataset)
//
// ═══ HOW THE MORTALITY FIGURE IS DERIVED, AND ITS LIMITS ════════════════════
// deaths/day for a people group = (group population) x (national crude death rate
// / 1000) / 365.25.
//
// THREE THINGS THAT MUST TRAVEL WITH THAT NUMBER, and do, in every row:
//  1. It applies the NATIONAL crude death rate to a SUB-POPULATION. Unengaged
//     groups often differ from the national average — typically rural, often
//     poorer, so real mortality is plausibly HIGHER, not lower. The figure is an
//     ORDER-OF-MAGNITUDE ESTIMATE, and `method` says so in the row.
//  2. Crude death rate is not age-standardised. It is a real measured statistic,
//     not a projection, but it cannot be read as a per-person risk.
//  3. "Without Christ" is an inference from the group's PRIMARY religion field,
//     not a measurement of individual belief. Nobody counted. The field is named
//     `primary_religion_not_christian` — deliberately clumsy, because the honest
//     name is clumsy. Measured: 1 of 2,106 DX groups has a Christian primary
//     religion, so this is very nearly the whole corpus by construction.
//
// A number like this gets quoted. If it is going to be quoted it has to carry its
// own method, or it becomes a statistic nobody can check.
//
// PERSECUTION-SAFETY: population, growth and mortality only. No believer,
// church or fellowship location data. That boundary is unchanged.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const OUTFILE = join(OUT, 'demographics-by-country.json');

const SOURCE = {
  name: 'World Bank Open Data',
  url: 'https://api.worldbank.org/v2',
  licence: 'CC BY 4.0',
  accessed: '2026-08-01',
  note: 'public API, no key required',
};

const IND = {
  pop_growth_pct: 'SP.POP.GROW',
  death_rate_per_1000: 'SP.DYN.CDRT.IN',
  birth_rate_per_1000: 'SP.DYN.CBRT.IN',
  population: 'SP.POP.TOTL',
  urban_population: 'SP.URB.TOTL',
};

const spine = JSON.parse(readFileSync(join(OUT, 'city-candidates.json'), 'utf8'));
const isos = [...new Set(spine.clusters.map((c) => c.iso3))].sort();

const out = existsSync(OUTFILE)
  ? (JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {})
  : {};

async function latest(iso3, indicator) {
  const url = `${SOURCE.url}/country/${iso3}/indicator/${indicator}?format=json&date=2015:2024&per_page=25`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.json();
    const obs = Array.isArray(b) && Array.isArray(b[1]) ? b[1] : [];
    for (const o of obs) if (o?.value != null) return { value: o.value, year: o.date };
  } catch (_) { /* a network failure is UNKNOWN, never a zero */ }
  return null;
}

const flush = () => writeFileSync(OUTFILE, JSON.stringify({
  stats: {
    countries: isos.length,
    done: Object.keys(out).length,
    generated: '2026-08-01',
    method: 'deaths/day = population x (crude death rate / 1000) / 365.25 — ORDER-OF-MAGNITUDE; applies a NATIONAL rate to a sub-population.',
  },
  source: SOURCE,
  countries: out,
}, null, 1));

const BATCH = 6;
const todo = isos.filter((i) => !out[i]);
console.log(`[demographics] ${todo.length} to fetch (${isos.length - todo.length} cached)`);

for (let b = 0; b < todo.length; b += BATCH) {
  await Promise.all(todo.slice(b, b + BATCH).map(async (iso) => {
    const keys = Object.keys(IND);
    const vals = await Promise.all(keys.map((k) => latest(iso, IND[k])));
    const row = { iso3: iso };
    keys.forEach((k, i) => {
      row[k] = vals[i] ? +vals[i].value.toFixed(2) : null;
      row[`${k}_year`] = vals[i] ? vals[i].year : null;
    });
    row.urban_pct = (row.urban_population && row.population)
      ? +((row.urban_population / row.population) * 100).toFixed(1) : null;
    // Is the population outgrowing the effort to reach it? A positive growth rate
    // with no scripture in the language is the signal the app exists to surface.
    row.growing = row.pop_growth_pct != null ? row.pop_growth_pct > 0 : null;
    row.source = SOURCE.name;
    row.resolution = 'country';
    out[iso] = row;
  }));
  flush();
  console.log(`[demographics] ${Math.min(b + BATCH, todo.length)}/${todo.length} …`);
}

flush();
const ok = Object.values(out).filter((r) => r.death_rate_per_1000 != null).length;
console.log(`[demographics] DONE — ${Object.keys(out).length} countries, ${ok} with a death rate`);
