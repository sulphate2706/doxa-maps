// fetch-connectivity.mjs — COUNTRY-level connectivity, from a citable public API.
//
//   node fetch-connectivity.mjs  ->  out/connectivity-by-country.json
//
// SOURCE: World Bank Open Data (api.worldbank.org, v2). Public, no key, no account
// — which satisfies the no-account privacy constraint (no signups).
//   IT.NET.USER.ZS  individuals using the internet, % of population
//   IT.CEL.SETS.P2  mobile cellular subscriptions per 100 people
//   SP.POP.TOTL     population
//
// ═══ WHY THIS IS COUNTRY-LEVEL AND NOT CITY-LEVEL ═══════════════════════════
// The brief asks for internet access PER CITY. There is no free, public, citable
// per-city connectivity dataset covering 175 countries — and inventing one by
// assuming "the city has whatever the country has" would be a guess wearing a
// citation. So this file records what the source ACTUALLY supports: a national
// figure, with its year, attached to each country.
//
// Each location cluster inherits its country's figure as CONTEXT, explicitly
// labelled `resolution: "country"`. A consumer can see it is not a city
// measurement. When per-city data is later sourced, it overwrites with
// `resolution: "city"` and its own citation.
// Constraint: every value cites its source; unknowns are marked unknown, never guessed.
//
// NOT FETCHED HERE: censorship / shutdown history. Those live in reports
// (OONI, Access Now #KeepItOn, Freedom on the Net) that are not machine-readable
// per-country APIs, so they are left `unknown` rather than approximated. Filling
// them is a per-country human-cited task, not something to automate badly.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');

const INDICATORS = {
  internet_pct: 'IT.NET.USER.ZS',
  mobile_per_100: 'IT.CEL.SETS.P2',
  population: 'SP.POP.TOTL',
};
const SOURCE = {
  name: 'World Bank Open Data',
  url: 'https://api.worldbank.org/v2',
  licence: 'CC BY 4.0',
  accessed: '2026-08-01',
};

const spine = JSON.parse(readFileSync(join(OUT, 'city-candidates.json'), 'utf8'));
const isos = [...new Set(spine.clusters.map((c) => c.iso3))].sort();

// Most-recent non-null observation in the window, with its YEAR — a figure without
// a year is not citable.
async function latest(iso3, indicator) {
  const url = `${SOURCE.url}/country/${iso3}/indicator/${indicator}?format=json&date=2018:2024&per_page=20`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    const obs = Array.isArray(body) && Array.isArray(body[1]) ? body[1] : [];
    for (const o of obs) {
      if (o && o.value !== null && o.value !== undefined) {
        return { value: o.value, year: o.date };
      }
    }
  } catch (_) { /* network failure is an UNKNOWN, never a zero */ }
  return null;
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const OUTFILE = join(OUT, 'connectivity-by-country.json');

// RESUMABLE + INCREMENTAL. The first run of this script fetched serially and only
// wrote at the end — it was killed at a 600s timeout and lost EVERY row. Two fixes:
// countries run in parallel batches, and the file is flushed as it goes, so a kill
// costs one batch rather than the whole run.
const out = existsSync(OUTFILE)
  ? (JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {})
  : {};
let ok = 0, unknown = 0;

const flush = () => writeFileSync(OUTFILE, JSON.stringify({
  stats: { countries: isos.length, resolved: ok, unknown, partial: Object.keys(out).length < isos.length, generated: '2026-08-01' },
  source: SOURCE,
  countries: out,
}, null, 1));

const BATCH = 8;              // polite to a public API; ~22 batches for 175 countries
const todo = isos.filter((i) => !out[i]);
console.log(`[connectivity] ${todo.length} to fetch (${isos.length - todo.length} already cached)`);

for (let b = 0; b < todo.length; b += BATCH) {
  const slice = todo.slice(b, b + BATCH);
  await Promise.all(slice.map(async (iso) => {
  const [net, mob, pop] = await Promise.all([
    latest(iso, INDICATORS.internet_pct),
    latest(iso, INDICATORS.mobile_per_100),
    latest(iso, INDICATORS.population),
  ]);

  // The yes/no/partial call is a THRESHOLD ON A CITED NUMBER, not a judgement.
  // Bands are stated here so a reader can disagree with them explicitly.
  let access = 'unknown';
  if (net) access = net.value >= 60 ? 'yes' : net.value >= 25 ? 'partial' : 'no';

  out[iso] = {
    iso3: iso,
    internet_access: access,
    internet_pct: net ? +net.value.toFixed(1) : null,
    internet_year: net ? net.year : null,
    mobile_per_100: mob ? +mob.value.toFixed(1) : null,
    mobile_year: mob ? mob.year : null,
    national_population: pop ? Math.round(pop.value) : null,
    population_year: pop ? pop.year : null,
    // Deliberately unfilled — see the header note.
    censorship: 'unknown',
    censorship_note: 'not machine-readable from this source; requires a cited report (OONI / Access Now / Freedom on the Net)',
    resolution: 'country',
    banding: 'yes >=60% · partial 25-59% · no <25% of population using the internet',
    source: SOURCE,
  };

  if (access === 'unknown') unknown++; else ok++;
  }));
  flush();                                    // survive a kill
  console.log(`[connectivity] ${Math.min(b + BATCH, todo.length)}/${todo.length} …`);
}

flush();
console.log(`[connectivity] ${ok} resolved, ${unknown} unknown -> out/connectivity-by-country.json`);
