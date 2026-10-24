// fetch-top-apps.mjs — THE APPS PEOPLE ACTUALLY INSTALL, per country.
//
//   node fetch-top-apps.mjs  ->  out/top-apps-by-country.json
//
// ═══ WHY THIS EXISTS: STATCOUNTER HAS A WESTERN BLIND SPOT ══════════════════
// The research looks beyond the typical Western social platforms.
//
// MEASURED — the COMPLETE list StatCounter tracks across all 175 countries:
//   Facebook, Instagram, Twitter, YouTube, Pinterest, reddit, LinkedIn, Tumblr,
//   news.ycombinator.com, VKontakte, Fark.
// That is the entire universe it can see. There is NO WhatsApp, NO WeChat, NO
// Telegram, NO TikTok, NO LINE, NO Viber, NO imo, NO Zalo, NO Snapchat — i.e. none
// of the platforms that actually dominate in most of the countries in this corpus.
//
// The reason is structural: StatCounter measures PAGE-VIEW REFERRALS. A messaging
// app generates almost no web referrals, so a channel can carry a whole country's
// communication and register ~0%. Reading "Facebook 91.7%" as "this is where
// Pakistanis are" would be exactly wrong.
//
// SOURCE HERE: Apple's App Store RSS (rss.applemarketingtools.com) — public, no
// key, no account, per-country top-free rankings. An app in the top free chart is
// an app people are INSTALLING, which is a different and more honest signal than
// referral share for messaging-first countries.
//
// ═══ WHAT THIS IS NOT ═══════════════════════════════════════════════════════
//  * iOS ONLY. Most of these countries are Android-majority, sometimes
//    overwhelmingly. Google publishes no equivalent keyless feed, so this is one
//    eye open. A ranking absent here is NOT absent from the country.
//  * A RANKING, not usage. #1 free means most-downloaded recently, not most-used.
//  * NOT per-city. Apple publishes country storefronts only.
//  * STOREFRONT-BOUND. Countries without an Apple storefront return nothing, and
//    that includes some of the hardest places in this dataset.
// All four caveats ride in the row, because a "top apps" list looks authoritative
// in a way that invites over-reading.
//
// The CLASSIFIER below tags the categories that matter for reachability
// (messaging / social / video). It is a NAME-AND-KEYWORD HEURISTIC over a known
// list — honest, and flagged as a heuristic, not a verified taxonomy.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify, isComms } from './app-kind.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const OUTFILE = join(OUT, 'top-apps-by-country.json');

const SOURCE = {
  name: 'Apple App Store RSS — top free apps by country',
  url: 'https://rss.applemarketingtools.com/api/v2/{cc}/apps/top-free/50/apps.json',
  licence: 'public Apple marketing feed, no key',
  accessed: '2026-08-01',
  measures: 'most-downloaded free apps in a country storefront, right now',
  does_not_measure: 'Android (no keyless equivalent), actual usage, anything per-city',
  why: 'StatCounter tracks only Western referral platforms and cannot see WhatsApp/WeChat/Telegram/TikTok/LINE/Viber/imo/Zalo — the channels that dominate most of this corpus',
};

// The classifier (KIND / classify) is shared with build-tabulator-tables.mjs: see app-kind.mjs.

const ISO2 = existsSync(join(OUT, 'iso3-to-iso2.json'))
  ? JSON.parse(readFileSync(join(OUT, 'iso3-to-iso2.json'), 'utf8'))
  : {};
const spine = JSON.parse(readFileSync(join(OUT, 'city-candidates.json'), 'utf8'));
const isos = [...new Set(spine.clusters.map((c) => c.iso3))].filter((i) => ISO2[i]).sort();

const out = existsSync(OUTFILE)
  ? (JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {})
  : {};
// A transient failure must never be cached as an answer — the lesson from the
// trending 429s, applied up front this time.
for (const k of Object.keys(out)) if (out[k].error && /HTTP (429|5\d\d)/.test(out[k].error)) delete out[k];

const flush = () => writeFileSync(OUTFILE, JSON.stringify({
  stats: {
    countries_attempted: isos.length,
    countries_done: Object.keys(out).length,
    with_data: Object.values(out).filter((c) => (c.apps || []).length).length,
    generated: '2026-08-01',
  },
  source: SOURCE,
  countries: out,
}, null, 1));

const todo = isos.filter((i) => !out[i]).slice(0, process.env.LIMIT ? Number(process.env.LIMIT) : isos.length);
console.log(`[apps] ${todo.length} countries to fetch (${Object.keys(out).length} cached)`);

for (let n = 0; n < todo.length; n++) {
  const iso3 = todo[n];
  const cc = ISO2[iso3].toLowerCase();
  let apps = [], err = null;
  try {
    const r = await fetch(`https://rss.applemarketingtools.com/api/v2/${cc}/apps/top-free/50/apps.json`,
      { headers: { 'User-Agent': 'doxa-maps-research/1.0' }, redirect: 'follow' });
    if (r.ok) {
      const b = await r.json();
      apps = (b?.feed?.results || []).map((a, i) => ({
        rank: i + 1, name: a.name, kind: classify(a.name), url: a.url || null,
      }));
    } else {
      err = `HTTP ${r.status}`;              // 404 = no storefront for this country
    }
  } catch (e) { err = String(e.message || e).slice(0, 60); }

  const comms = apps.filter((a) => isComms(a.kind));
  out[iso3] = {
    iso3, iso2: ISO2[iso3],
    apps: apps.slice(0, 25),
    // The whole point: which COMMUNICATION channels rank, in order.
    comms_apps: comms.map((a) => ({ rank: a.rank, name: a.name, kind: a.kind })),
    top_messaging: comms.find((a) => a.kind === 'messaging')?.name || null,
    top_social: comms.find((a) => a.kind === 'social')?.name || null,
    top_short_video: comms.find((a) => a.kind === 'short-video')?.name || null,
    error: err,
    platform_bias: 'iOS only — most of these countries are Android-majority; absence here is not absence in-country',
    resolution: 'country',
    classification_method: 'name-keyword HEURISTIC, not a verified taxonomy',
    source: SOURCE.name,
  };

  if ((n + 1) % 20 === 0) { flush(); console.log(`[apps] ${n + 1}/${todo.length} …`); }
  await new Promise((r) => setTimeout(r, 350));
}

flush();
const ok = Object.values(out).filter((c) => (c.apps || []).length).length;
console.log(`[apps] DONE — ${Object.keys(out).length} countries, ${ok} with a storefront`);
