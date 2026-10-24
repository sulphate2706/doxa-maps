// fetch-social-platforms.mjs — WHICH PLATFORMS PEOPLE ACTUALLY USE, per country.
//
//   node fetch-social-platforms.mjs  ->  out/social-platforms-by-country.json
//
// ═══ WHY THIS IS PART OF A GOSPEL-ACCESS DATASET ════════════════════════════
// For each country: the social platforms in use, alongside its ISPs, gospel resources
// and languages.
//
// The chain the app is built to show: a people group has a LANGUAGE, that language
// may or may not have a RESOURCE, the people have INTERNET or not, and if they do,
// they are reachable on SOME platform — but not the same platform everywhere.
// Assuming a global default is how digital outreach misses an entire country.
//
// SOURCE: StatCounter GlobalStats (gs.statcounter.com) — public CSV export, no key,
// no account. Measured share of page views by social platform, per country, monthly.
//
// ═══ TWO THINGS THIS MEASURES, AND ONE IT DOES NOT ══════════════════════════
// IT MEASURES: referral/pageview share among platforms StatCounter tracks. That is
// a real, sampled, dated measurement — good for "is Facebook or Instagram dominant
// here", which is the question being asked.
//
// IT DOES NOT MEASURE: messaging apps. WhatsApp, Telegram, WeChat, Signal, IMO and
// Viber barely appear in referral data because they do not generate web referrals,
// and in several of these countries messaging is THE dominant channel. So a low
// total here means "little web-referral traffic", NOT "these people are offline".
// That caveat is recorded in every row, because a reader optimising for reach could
// otherwise conclude exactly the wrong thing.
//
// THE EMPTY-MONTH TRAP, hit and handled: the CURRENT month returns all zeros
// because StatCounter has not published it yet. Reading the last row blindly would
// have reported "Facebook 0%, Instagram 0%" for every country — a clean-looking
// total fabrication. This script therefore walks BACKWARD to the most recent month
// whose shares actually sum to a plausible total, and records WHICH month that was.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const OUTFILE = join(OUT, 'social-platforms-by-country.json');

const SOURCE = {
  name: 'StatCounter GlobalStats',
  url: 'https://gs.statcounter.com/social-media-stats',
  licence: 'StatCounter GlobalStats — free for use with attribution',
  accessed: '2026-08-01',
  measures: 'share of page-view referrals by social platform',
  does_not_measure: 'messaging apps (WhatsApp/Telegram/WeChat/Signal/Viber) — they generate few web referrals but may be the DOMINANT channel',
};

const ISO2 = existsSync(join(OUT, 'iso3-to-iso2.json'))
  ? JSON.parse(readFileSync(join(OUT, 'iso3-to-iso2.json'), 'utf8'))
  : {};
const spine = JSON.parse(readFileSync(join(OUT, 'city-candidates.json'), 'utf8'));
const isos = [...new Set(spine.clusters.map((c) => c.iso3))].filter((i) => ISO2[i]).sort();

const out = existsSync(OUTFILE)
  ? (JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {})
  : {};

const flush = () => writeFileSync(OUTFILE, JSON.stringify({
  stats: { countries_attempted: isos.length, countries_done: Object.keys(out).length, generated: '2026-08-01' },
  source: SOURCE,
  countries: out,
}, null, 1));

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;
  const cut = (l) => l.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
  const head = cut(lines[0]);
  // Walk BACKWARD to the last month with real data — see the empty-month note.
  for (let i = lines.length - 1; i > 0; i--) {
    const cells = cut(lines[i]);
    const shares = {};
    let total = 0;
    for (let c = 1; c < head.length; c++) {
      const v = parseFloat(cells[c]);
      if (Number.isFinite(v) && v > 0) { shares[head[c]] = v; total += v; }
    }
    if (total > 50) return { month: cells[0], shares, total: +total.toFixed(1) };
  }
  return null;
}

const todo = isos.filter((i) => !out[i]).slice(0, process.env.LIMIT ? Number(process.env.LIMIT) : isos.length);
console.log(`[social] ${todo.length} countries to fetch (${Object.keys(out).length} cached)`);

for (let n = 0; n < todo.length; n++) {
  const iso3 = todo[n];
  const iso2 = ISO2[iso3];
  const url = 'https://gs.statcounter.com/social-media-stats/chart.php'
    + '?device=Desktop%20%26%20Mobile%20%26%20Tablet%20%26%20Console'
    + '&device_hidden=desktop%2Bmobile%2Btablet%2Bconsole'
    + `&statType_hidden=social_media&region_hidden=${iso2}`
    + '&granularity=monthly&statType=Social%20Media'
    + '&fromInt=202601&toInt=202608&csv=1';

  let parsed = null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'doxa-maps-research/1.0' } });
    if (r.ok) parsed = parseCsv(await r.text());
  } catch (_) { /* unknown, never zero */ }

  const ranked = parsed
    ? Object.entries(parsed.shares).sort((a, b) => b[1] - a[1]).map(([name, pct]) => ({ name, pct }))
    : [];

  out[iso3] = {
    iso3, iso2,
    month: parsed ? parsed.month : null,
    top_platform: ranked[0]?.name || null,
    top_platform_pct: ranked[0]?.pct ?? null,
    platforms: ranked.slice(0, 8),
    // Explicitly NOT a claim about messaging apps.
    messaging_apps: 'unknown — not measured by this source',
    resolution: 'country',
    source: SOURCE.name,
  };

  if ((n + 1) % 10 === 0) { flush(); console.log(`[social] ${n + 1}/${todo.length} …`); }
  await new Promise((r) => setTimeout(r, 400));
}

flush();
const ok = Object.values(out).filter((c) => c.top_platform).length;
console.log(`[social] DONE — ${Object.keys(out).length} countries, ${ok} with platform data`);
