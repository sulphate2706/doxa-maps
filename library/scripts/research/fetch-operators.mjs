// fetch-operators.mjs — CORPUS C: the network OPERATORS, by name, per country.
//
//   node fetch-operators.mjs           # all countries in the spine (resumable)
//   LIMIT=20 node fetch-operators.mjs  # cap the run
//
// SOURCE: RIPEstat (stat.ripe.net) — public, no key, no account.
//   country-resource-list  -> the ASNs registered to a country
//   as-overview            -> the HOLDER name for each ASN
// An ASN holder IS the operator: AS327756 -> "AIRTEL TCHAD", AS37462 -> "PRESTABIST".
// So this answers "list ISPs and carriers BY NAME" from registry data rather than
// from a marketing page that may be stale or unciteable.
//
// ═══ WHAT AN ASN IS AND IS NOT ══════════════════════════════════════════════
// An ASN is an ORGANISATION that announces IP space in that country. That set
// includes ISPs and mobile carriers — the thing asked for — but ALSO banks,
// universities, government departments and hosting resellers. This file does NOT
// pretend to have classified them: every operator carries `kind:"unclassified"`
// unless its name matches an obvious carrier pattern, and the match is recorded as
// a HEURISTIC so a reader knows it is a hint, not a verified fact.
//
// AND IT IS COUNTRY-RESOLUTION, NOT CITY. ASN registration is national. There is
// no public dataset mapping operators to individual cities at this scale, and
// asserting "this city is served by X" from a national registry would be a guess
// wearing a citation — the same error the connectivity file already refuses. Each
// row is therefore labelled resolution:"country".
//
// This is honest partial delivery of the brief's "ISP names + cell carriers by
// name": the NAMES are real and cited; the per-CITY attribution is not available
// and is left undone rather than fabricated.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const SPINE = join(OUT, 'city-candidates.json');
const OUTFILE = join(OUT, 'operators-by-country.json');

const SOURCE = {
  name: 'RIPEstat',
  url: 'https://stat.ripe.net/data',
  endpoints: ['country-resource-list', 'as-overview'],
  licence: 'RIPE NCC public data',
  accessed: '2026-08-01',
  note: 'no key, no account required',
};

// ISO3 -> ISO2, needed because RIPEstat keys on ISO2 while the DX corpus uses ISO3.
// DERIVED, not hand-typed: one gazetteer lookup per country (Nominatim, the same
// cited source that named the 277 population centres) rather than a 175-row table
// typed from memory, which is exactly where a silent mis-mapping would enter.
const ISO2 = existsSync(join(OUT, 'iso3-to-iso2.json'))
  ? JSON.parse(readFileSync(join(OUT, 'iso3-to-iso2.json'), 'utf8'))
  : {};

// Carrier-name heuristics. Recorded as HINTS — see the header note.
const CARRIER_HINT = /\b(airtel|vodafone|vodacom|orange|mtn|tigo|zain|etisalat|ooredoo|telecom|telkom|telecel|mobile|cellular|gsm|celtel|safaricom|glo|9mobile|smart|viettel|unitel|movitel|africell|moov|expresso|sudatel|zamtel|econet|halotel|digicel)\b/i;

const spine = JSON.parse(readFileSync(SPINE, 'utf8'));
const isos = [...new Set(spine.clusters.map((c) => c.iso3))].filter((i) => ISO2[i]).sort();

const out = existsSync(OUTFILE)
  ? (JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {})
  : {};

const flush = () => writeFileSync(OUTFILE, JSON.stringify({
  stats: {
    countries_attempted: isos.length,
    countries_done: Object.keys(out).length,
    total_operators: Object.values(out).reduce((n, c) => n + (c.operators?.length || 0), 0),
    generated: '2026-08-01',
    resolution: 'country — ASN registration is national; no public per-city operator dataset exists at this scale',
  },
  source: SOURCE,
  countries: out,
}, null, 1));

const j = async (url) => {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const todo = isos.filter((i) => !out[i]).slice(0, process.env.LIMIT ? Number(process.env.LIMIT) : isos.length);
console.log(`[operators] ${todo.length} countries to fetch (${Object.keys(out).length} cached, ${isos.length} total)`);

for (let n = 0; n < todo.length; n++) {
  const iso3 = todo[n];
  const iso2 = ISO2[iso3];
  const list = await j(`${SOURCE.url}/country-resource-list/data.json?resource=${iso2}`);
  const asns = list?.data?.resources?.asn || [];

  // Cap per country: some large economies register thousands of ASNs, and the
  // point here is naming the operators, not enumerating every registered org.
  const take = asns.slice(0, 60);
  const operators = [];
  for (const asn of take) {
    const ov = await j(`${SOURCE.url}/as-overview/data.json?resource=AS${asn}`);
    const holder = ov?.data?.holder;
    if (!holder) continue;
    operators.push({
      asn: `AS${asn}`,
      name: holder,
      kind: CARRIER_HINT.test(holder) ? 'likely_carrier_or_isp' : 'unclassified',
      classification_method: 'name-pattern HEURISTIC — not verified',
    });
    await sleep(120);
  }

  out[iso3] = {
    iso3, iso2,
    asn_count: asns.length,
    sampled: take.length,
    operators,
    likely_carriers: operators.filter((o) => o.kind !== 'unclassified').map((o) => o.name),
    resolution: 'country',
    source: SOURCE.name,
  };

  flush();
  console.log(`[operators] ${n + 1}/${todo.length}  ${iso3}  ${asns.length} ASNs -> ${operators.length} named, ${out[iso3].likely_carriers.length} likely carriers`);
  await sleep(250);
}

flush();
console.log(`[operators] DONE — ${Object.keys(out).length} countries -> out/operators-by-country.json`);
