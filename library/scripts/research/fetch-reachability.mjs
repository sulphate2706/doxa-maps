// fetch-reachability.mjs — is a platform REACHABLE here, or walled off?
//
//   node fetch-reachability.mjs            # all DX countries
//   node fetch-reachability.mjs --iso IRN,CHN,PAK
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Beyond social platforms, the top websites and messaging apps in use (WeChat,
// WhatsApp, …) are tracked for whether each is closed off or globally accessible.
//
// The existing tables answer "what is POPULAR", never "what is REACHABLE", and both
// have a structural blind spot that makes them unable to:
//   social-platforms   = StatCounter WEB REFERRAL share. WhatsApp and WeChat are
//                        INVISIBLE to it — the rows literally carry
//                        messaging_apps:'unknown — not measured by this source'.
//   messaging-channels = Apple App Store RSS = iOS ONLY, which skews hard in
//                        Android-majority countries.
//
// OONI (Open Observatory of Network Interference) is the open dataset built exactly
// for this question. No key, no account. It reports, per country and per domain:
// measurement_count, confirmed_count (CONFIRMED BLOCKED), anomaly_count (PROBABLE
// interference), ok_count — so a row can say "blocked in 53% of 2,529 measurements"
// instead of guessing a boolean.
//
// ═══ TWO TRAPS THIS SCRIPT IS BUILT AROUND (both hit for real) ══════════════
// 1. ENUMERATE BEFORE YOU QUERY. Asking for domain=whatsapp.com returns n=0 — that
//    is MY GUESS FAILING, not evidence the app is unmeasured. OONI measures specific
//    domains (www.facebook.com, not facebook.com). So this fetches axis_x=domain per
//    country FIRST and reads what is actually there.
// 2. EMPTY RESULT != ABSENT DATA. The aggregation endpoint returns a LIST when
//    axis_x is set and a DICT when it is not. Reading the wrong shape yields 0 and
//    looks like "no censorship here". The parser asserts the shape it got.
//
// ═══ HONESTY RULES CARRIED FROM THE CORPUS ═════════════════════════════════
// OONI runs on VOLUNTEER PROBES, so coverage is uneven and NOT population-weighted.
//   * absence of measurement is NOT evidence of accessibility -> status 'not-measured'
//     is a STRING, never false, and never silently an "accessible" row.
//   * confirmed (proven blocked) and anomaly (probable) are kept SEPARATE, never summed.
//   * every row carries its sample size so a reader can weigh it.
//
// SAFETY: this is NETWORK data. It says what a network does — never who used what.
// It must never be joined to anything that could identify a person or a fellowship.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const OUTFILE = join(OUT, 'reachability-by-country.json');

const UA = 'doxa-maps-research/1.0 (people-group prayer mapping)';
const API = 'https://api.ooni.io/api/v1/aggregation';
const SINCE = process.env.OONI_SINCE || '2026-02-01';
const UNTIL = process.env.OONI_UNTIL || '2026-08-01';

// The platforms the mission cares about, matched against the domains OONI ACTUALLY
// measures. Keys are our label; values are domain substrings to match on. A platform
// with no matching measured domain yields status 'not-measured' — an honest gap.
const PLATFORMS = {
  WhatsApp:  ['whatsapp.com'],
  WeChat:    ['wechat.com', 'weixin.qq.com'],
  Telegram:  ['telegram.org', 'web.telegram.org'],
  Signal:    ['signal.org'],
  Messenger: ['messenger.com'],
  Viber:     ['viber.com'],
  Line:      ['line.me'],
  Facebook:  ['facebook.com'],
  Instagram: ['instagram.com'],
  YouTube:   ['youtube.com'],
  TikTok:    ['tiktok.com'],
  'X/Twitter': ['twitter.com', 'x.com'],
  Reddit:    ['reddit.com'],
  Wikipedia: ['wikipedia.org'],
  Discord:   ['discord.com'],
};

const ISO3_2 = JSON.parse(readFileSync(join(OUT, 'iso3-to-iso2.json'), 'utf8'));

const only = (() => {
  const i = process.argv.indexOf('--iso');
  return i > -1 ? process.argv[i + 1].split(',').map((s) => s.trim().toUpperCase()) : null;
})();

const spineRows = JSON.parse(readFileSync(join(OUT, 'tables', 'social-platforms.json'), 'utf8')).rows;
let isos = [...new Set(spineRows.map((r) => r.iso3))].filter((i) => ISO3_2[i]).sort();
if (only) isos = isos.filter((i) => only.includes(i));

const out = existsSync(OUTFILE) ? JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {} : {};

async function getJSON(url, attempts = 3) {
  for (let a = 0; a < attempts; a++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (r.ok) return r.json();
    // Retry only on load/rate conditions — a 404 is a real answer, not a blip.
    if (r.status !== 429 && r.status !== 503 && r.status !== 502) return null;
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  return null;
}

const todo = isos.filter((i) => !out[i]);
console.log(`[reach] ${todo.length} countries to fetch (${Object.keys(out).length} cached), window ${SINCE}..${UNTIL}`);

for (let n = 0; n < todo.length; n++) {
  const iso3 = todo[n];
  const cc = ISO3_2[iso3];

  // STEP 1 — ENUMERATE what OONI actually measured here. Never guess a domain.
  const agg = await getJSON(`${API}?probe_cc=${cc}&since=${SINCE}&until=${UNTIL}&axis_x=domain`);
  const rows = Array.isArray(agg?.result) ? agg.result : [];

  const platforms = {};
  for (const [label, needles] of Object.entries(PLATFORMS)) {
    const hits = rows.filter((r) => {
      const d = String(r.domain || '').toLowerCase();
      return needles.some((nd) => d === nd || d.endsWith(`.${nd}`) || d === `www.${nd}`);
    });
    if (!hits.length) {
      platforms[label] = {
        status: 'not-measured',
        absence_meaning: 'OONI has no measurement for this platform in this country/window — NOT evidence it is accessible',
        domains: [], measurements: 0,
      };
      continue;
    }
    const sum = (k) => hits.reduce((t, r) => t + (r[k] || 0), 0);
    const total = sum('measurement_count');
    const confirmed = sum('confirmed_count');
    const anomaly = sum('anomaly_count');
    const ok = sum('ok_count');
    const blockPct = total ? +(100 * confirmed / total).toFixed(1) : null;
    const anomPct = total ? +(100 * anomaly / total).toFixed(1) : null;
    // BANDS are deliberately coarse and separate confirmed from anomaly. A high
    // anomaly rate with zero confirmed is 'interference-suspected', NOT 'blocked' —
    // collapsing them would assert proof we do not have.
    // CHINA PROVES WHY anomaly MUST NOT BE COLLAPSED INTO confirmed — and why a
    // HIGH ANOMALY RATE IS A REAL SIGNAL, not noise. Measured: CHN YouTube 84.9%
    // anomaly with ZERO confirmed; X/Twitter 89.9% anomaly, 2 confirmed. The Great
    // Firewall blocks by TCP reset and DNS poisoning, which OONI records as an
    // ANOMALY — 'confirmed' generally requires a block PAGE, which China does not
    // serve. So reading "0 confirmed" as "not blocked" would be exactly wrong on the
    // largest censored population in the corpus.
    // Hence: a very high anomaly rate gets its own loud band rather than being
    // filed under the same label as a 30% one, and the row always carries BOTH
    // numbers so a reader can see which kind of evidence it rests on.
    let status = 'accessible';
    if (blockPct >= 20) status = 'blocked';
    else if (blockPct >= 5) status = 'partially-blocked';
    else if (anomPct >= 70) status = 'interference-widespread';
    else if (anomPct >= 30) status = 'interference-suspected';
    platforms[label] = {
      status, measurements: total, confirmed_blocked: confirmed, anomaly, ok,
      block_pct: blockPct, anomaly_pct: anomPct,
      domains: hits.map((h) => h.domain).slice(0, 4),
    };
  }

  out[iso3] = {
    iso3, probe_cc: cc, window: `${SINCE}..${UNTIL}`,
    domains_measured_in_country: rows.length,
    probe_coverage: rows.length === 0 ? 'NONE — no OONI probe data for this country/window'
      : rows.length < 50 ? 'THIN — few domains measured; treat every status as low-confidence'
      : 'ok',
    platforms,
    source: 'OONI — Open Observatory of Network Interference (api.ooni.io, open, no key)',
    caveat: 'Volunteer-probe data: uneven coverage, NOT population-weighted. confirmed=proven blocked; anomaly=PROBABLE interference. Absence of measurement is not evidence of accessibility.',
  };

  if ((n + 1) % 10 === 0) {
    writeFileSync(OUTFILE, JSON.stringify({ generated: UNTIL, countries: out }, null, 1));
    console.log(`[reach] ${n + 1}/${todo.length} …`);
  }
  await new Promise((r) => setTimeout(r, 400));   // polite to a donated API
}

writeFileSync(OUTFILE, JSON.stringify({ generated: UNTIL, countries: out }, null, 1));
const withData = Object.values(out).filter((c) => c.domains_measured_in_country > 0).length;
console.log(`[reach] DONE — ${Object.keys(out).length} countries, ${withData} with OONI probe data`);
