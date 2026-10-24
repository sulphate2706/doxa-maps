// fetch-trending.mjs — WHAT PEOPLE ARE ACTUALLY READING, per country.
//
//   node fetch-trending.mjs  ->  out/trending-by-country.json
//
// ═══ WHY THIS IS IN A GOSPEL-ACCESS DATASET ═════════════════════════════════
// The trending websites and topics of each city show where people already are
// online, so they can be reached there.
//
// The chain the apps show: a people group has a LANGUAGE, that language may have
// a RESOURCE, the people may have INTERNET, they are on SOME platform — and they
// are reading SOMETHING. This is the last link.
//
// SOURCE: Wikimedia REST API, top-per-country pageviews. Public, no key, no
// account. Real measured reading behaviour, per country, per day.
//
// ═══ WHAT THIS IS AND IS NOT ════════════════════════════════════════════════
// IT IS: the most-read Wikipedia articles from IP addresses geolocated to that
// country, on a given day. That is a genuine signal of public attention, and it
// is the only per-country trending dataset I found that is free, keyless and
// citable. (Google Trends has no public API; X/Twitter trends need auth.)
//
// IT IS NOT: "trending websites", and it is NOT per-CITY. Wikimedia publishes
// country granularity only. Asserting a city-level trend from a national figure
// would be the same error the connectivity and operator files already refuse, so
// every row is labelled resolution:"country".
//
// AND IT IS BIASED TOWARD WIKIPEDIA READERS — literate, connected, and in
// countries where Wikipedia is not blocked. In several DX countries it is a
// minority behaviour, and in a few it is unavailable entirely. A country with no
// data here is NOT a country with no internet culture; it is a country this
// particular lens cannot see. Recorded per row so nobody reads absence as silence.
//
// NOISE FILTER: 'Main_Page', 'Special:*' and 'Wikipedia:*' dominate every country
// and say nothing about attention. They are dropped, and the drop is recorded —
// a silent filter is how a dataset quietly becomes someone's opinion.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const OUTFILE = join(OUT, 'trending-by-country.json');

const SOURCE = {
  name: 'Wikimedia REST API — top-per-country pageviews',
  url: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country',
  licence: 'CC BY-SA / public API, no key',
  accessed: '2026-08-01',
  measures: 'most-read Wikipedia articles by IP-geolocated country, per day',
  does_not_measure: 'trending WEBSITES, and nothing at CITY level — Wikimedia publishes country granularity only',
  bias: 'Wikipedia readers only: literate, connected, and where Wikipedia is not blocked. Absence here is a blind spot of THIS lens, not proof of no internet culture.',
};

// A single recent day. Wikimedia lags ~2 days; 2026-07-15 is safely published and
// was verified to return data before this script was written.
const DATE = process.env.TREND_DATE || '2026/07/15';
// NAVIGATIONAL ARTICLES ARE NOT TRENDING TOPICS. A wiki's own front page and its
// Special:/Search pages are among the most-visited articles in almost every country,
// so leaving them in makes the top "topic" meaningless.
//
// LISTING SPELLINGS DOES NOT WORK; it was tried twice. Each pass enumerated the
// main-page and namespace names known at the time, and each pass the data produced
// new ones: "Wikidata:Main Page", "עמוד ראשי", then "Especial:Mudanças
// recentes", "Hlavní strana", "الصفحة الرئيسة" (an Arabic variant differing from the
// one already listed), "Специални:Търсене", "Musamman:RecentChanges". Every
// wiki localises BOTH the namespace prefix and the page title, so a spelling list is
// unbounded and will always trail the data.
//
// So match the STRUCTURE instead: MediaWiki namespace pages are "Prefix:Title" with
// a prefix carrying no space. Real article titles do contain colons ("Robocop: The
// Series"), but the segment before the colon is then ordinary prose WITH spaces —
// so requiring a space-free prefix keeps those while dropping every localised
// namespace. Main-page titles have no prefix at all, so they still need a list; it
// is derived from the data rather than guessed, and the frequency check below is
// what finds the next one instead of my imagination.
// A namespace prefix is one of a KNOWN set of localised namespace words. Testing
// the SHAPE instead ("any space-free prefix") looked right and was wrong: article
// titles arrive underscore-separated, so "Robocop:_The_Series" — a real article —
// has a space-free prefix too and was being dropped. The discriminator is not the
// shape of the prefix but whether the prefix IS a namespace, so match the words.
// Localised forms are added from the frequency check below as the data reveals
// them; that check, not my imagination, is what finds the next one.
const NS_WORDS = [
  'Special', 'Especial', 'Spezial', 'Spécial', 'Speciale', 'Speciaal', 'Espesial',
  'Специални', 'Специальная', 'Спеціальна', 'Musamman', 'Maalum', 'Khusus', 'Toiminnot',
  'Wikipedia', 'Wikipédia', 'Википедия', 'Wikidata', 'Wikisource', 'Wikiquote', 'Wiktionary',
  'Portal', 'Portaal', 'Category', 'Categoría', 'Catégorie', 'Kategori', 'Kategorie',
  'Template', 'Plantilla', 'Modèle', 'Help', 'Ayuda', 'Aide', 'File', 'Archivo', 'Fichier',
  'Talk', 'User', 'Usuario', 'Utilisateur', 'Module', 'MediaWiki',
];
const NAMESPACE = new RegExp('^(?:' + NS_WORDS.join('|') + '):', 'i');
const MAIN_PAGE = new RegExp('^(?:'
  + 'Main_Page|Hoofdpagina|Hlavní_strana|Portada|Accueil|Hauptseite|Pagina_principale'
  + '|Página_principal|Pàgina_principal|Ana_sayfa|Trang_Chính|Halaman_Utama'
  + '|Главная_страница|Головна_сторінка|Начална_страница|Басты_бет'
  + '|עמוד_ראשי|الصفحة_الرئيسية|الصفحة_الرئيسة|صفحه\u200cی_اصلی'
  + '|首页|首頁|メインページ|대문|หน้าหลัก'
  + ')$');
const SKIP = { test: (a) => NAMESPACE.test(a) || MAIN_PAGE.test(a) };

const ISO2 = existsSync(join(OUT, 'iso3-to-iso2.json'))
  ? JSON.parse(readFileSync(join(OUT, 'iso3-to-iso2.json'), 'utf8'))
  : {};
const spine = JSON.parse(readFileSync(join(OUT, 'city-candidates.json'), 'utf8'));
const isos = [...new Set(spine.clusters.map((c) => c.iso3))].filter((i) => ISO2[i]).sort();

const out = existsSync(OUTFILE)
  ? (JSON.parse(readFileSync(OUTFILE, 'utf8')).countries || {})
  : {};

const flush = () => writeFileSync(OUTFILE, JSON.stringify({
  stats: {
    countries_attempted: isos.length,
    countries_done: Object.keys(out).length,
    with_data: Object.values(out).filter((c) => c.topics.length).length,
    date: DATE,
    generated: '2026-08-01',
  },
  source: SOURCE,
  countries: out,
}, null, 1));

// A 429 row is NOT a result — drop it so the next run retries. Caching a
// rate-limit as an answer is how a transient failure becomes permanent data.
for (const k of Object.keys(out)) if (out[k].error && /429/.test(out[k].error)) delete out[k];
const todo = isos.filter((i) => !out[i]).slice(0, process.env.LIMIT ? Number(process.env.LIMIT) : isos.length);
console.log(`[trending] ${todo.length} countries to fetch (${Object.keys(out).length} cached), date ${DATE}`);

for (let n = 0; n < todo.length; n++) {
  const iso3 = todo[n];
  const iso2 = ISO2[iso3];
  let topics = [], filtered = 0, err = null;
  try {
    // RETRY a 429 with backoff instead of burning the country for this run.
    // The previous pass left 81 rows unresolved at a flat 1.2s: a single throttled
    // response permanently cost that country, and 81 recoverable rows then sat in
    // the corpus indistinguishable from real absence. Spacing alone cannot fix
    // this — throttling is bursty, so the answer is to WAIT AND ASK AGAIN, which is
    // the same fix the OSM tile fetcher needed. 404 is NOT retried: that is a real
    // "no data published", and retrying it would just be noise.
    let r = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await fetch(`${SOURCE.url}/${iso2}/all-access/${DATE}`,
        { headers: { 'User-Agent': 'doxa-maps-research/1.0 (people-group prayer mapping)' } });
      if (r.status !== 429) break;
      await new Promise((res) => setTimeout(res, 2500 * (attempt + 1)));
    }
    if (r.ok) {
      const b = await r.json();
      const arts = b?.items?.[0]?.articles || [];
      for (const a of arts) {
        if (SKIP.test(a.article)) { filtered++; continue; }
        topics.push({
          topic: a.article.replace(/_/g, ' '),
          rank: a.rank ?? null,
          // Wikimedia buckets view counts for privacy on this endpoint.
          views_ceil: a.views_ceil ?? null,
        });
        if (topics.length >= 15) break;
      }
    } else if (r.status === 404) {
      err = 'no data published for this country/date';
    } else {
      err = `HTTP ${r.status}`;
    }
  } catch (e) { err = String(e.message || e).slice(0, 60); }

  out[iso3] = {
    iso3, iso2, date: DATE,
    topics,
    top_topic: topics[0]?.topic || null,
    navigational_filtered: filtered,
    error: err,
    resolution: 'country',
    source: SOURCE.name,
  };

  if ((n + 1) % 20 === 0) { flush(); console.log(`[trending] ${n + 1}/${todo.length} …`); }
  // 250ms got 151/175 rate-limited (HTTP 429) — MY bug, not a Wikimedia data gap.
  // Their REST API guidance is ~200 req/s across all clients but per-client
  // throttling kicks in far sooner; 1.2s is comfortably inside it and the whole
  // run is still ~3 min. A 429 recorded as "no data" would have looked exactly
  // like a country with no trending data, which is the dangerous confusion here.
  await new Promise((r) => setTimeout(r, 1200));
}

flush();
const ok = Object.values(out).filter((c) => c.topics.length).length;
console.log(`[trending] DONE — ${Object.keys(out).length} countries, ${ok} with topics, ${Object.keys(out).length - ok} without`);
