/**
 * columns.js — the grid's columns and the CSV's columns: ONE list, so what a reader sees is what the file
 * holds (see ../README.md, "Columns and export"). `hidden` columns are off in the grid until the
 * picker turns them on, and the CSV exports exactly the columns that are ON.
 *
 * `csv` is the raw value (codes, numbers, URLs) — a spreadsheet joins on it, so it is never translated.
 * `show` is the display text and may be translated. Engagement, workers, teams: never a column (section 13).
 */
import { label } from './model.js'

export function buildColumns(T) {
  const band = (v) => label(T, 'band', v)
  const detail = (v) => label(T, 'detail', v)
  const kind = (v) => label(T, 'kind', v)
  const pct = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString() + '%')
  return [
    { key: 'people_group', header: 'people_group', label: T('legend.columns.name', 'Name'), w: 190, sticky: true },
    { key: 'country', header: 'country', label: T('gospelInternet.col.country', 'Country'), w: 130 },
    { key: 'province', header: 'province_approximate', label: T('gospelInternet.col.province', 'State / province (approx.)'), w: 150 },
    { key: 'language', header: 'language', label: T('gospelInternet.col.language', 'Language'), w: 150,
      show: (r) => r.language ? `${r.language} (${r.iso639_3})` : '' },
    { key: 'iso639_3', header: 'iso639_3', label: 'ISO 639-3', w: 80, hidden: true },
    { key: 'population', header: 'population', label: T('legend.columns.population', 'Population'), w: 110, num: true,
      show: (r) => r.population == null ? '' : Number(r.population).toLocaleString() },
    { key: 'access_detail', header: 'access_in_own_language', label: T('gospelInternet.col.access', 'In own language'), w: 170,
      show: (r) => detail(r.access_detail), dot: true },
    { key: 'resource_kinds', header: 'resources_in_own_language', label: T('gospelInternet.col.resources', 'Resources found'), w: 170,
      show: (r) => (r.resource_kinds ? r.resource_kinds.split('|').map(kind).join(' · ') : '') },
    { key: 'way_in', header: 'way_in', label: T('gospelInternet.col.wayIn', 'Way in'), w: 190,
      show: (r) => wayInText(r, T), csv: (r) => wayInCsv(r) },
    { key: 'internet_pct', header: 'country_internet_pct', label: T('gospelInternet.col.internet', 'Country online'), w: 115, num: true,
      show: (r) => r.internet_pct == null ? T('gospelInternet.band.nodata', 'No data') : `${pct(r.internet_pct)} (${r.internet_year})` },
    { key: 'internet_year', header: 'country_internet_year', label: T('gospelInternet.col.internetYear', 'Year'), w: 70, hidden: true },
    { key: 'internet_band', header: 'internet_band', label: T('gospelInternet.col.band', 'Internet band'), w: 115, show: (r) => band(r.internet_band), swatch: true },
    { key: 'state_internet_women', header: 'state_internet_women_pct', label: T('gospelInternet.col.stateWomen', 'State online: women'), w: 130, num: true, hidden: true, show: (r) => pct(r.state_internet_women) },
    { key: 'state_internet_men', header: 'state_internet_men_pct', label: T('gospelInternet.col.stateMen', 'State online: men'), w: 130, num: true, hidden: true, show: (r) => pct(r.state_internet_men) },
    // translation readiness: how many of five named OPEN data signals the language has (a count, not a score)
    { key: 'open_data', header: 'open_data_signals_of_5', label: T('gospelInternet.col.openData', 'Open data (of 5)'), w: 120, num: true,
      show: (r) => (r.open_data == null ? '' : r.open_data.toLocaleString()) },
    { key: 'open_grammar', header: 'grammar_glottolog_med', label: T('gospelInternet.col.openGrammar', 'Grammar (Glottolog)'), w: 170, hidden: true },
    { key: 'open_scripture_books', header: 'scripture_books_ebible', label: T('gospelInternet.col.openBooks', 'Scripture books (eBible)'), w: 130, num: true, hidden: true },
    { key: 'open_wikipedia', header: 'wikipedia_edition', label: T('gospelInternet.col.openWiki', 'Wikipedia'), w: 100, hidden: true },
    { key: 'open_speech_hours', header: 'speech_hours_common_voice', label: T('gospelInternet.col.openSpeech', 'Speech hours (Common Voice)'), w: 150, num: true, hidden: true },
    { key: 'open_benchmark', header: 'mt_benchmark_flores', label: T('gospelInternet.col.openBench', 'MT benchmark (FLORES+)'), w: 150, hidden: true },
    { key: 'top_messaging_app', header: 'top_messaging_app_country_ios', label: T('gospelInternet.col.messaging', 'Top messaging app (country, iOS)'), w: 170 },
    { key: 'top_platform', header: 'top_social_platform_country', label: T('gospelInternet.col.platform', 'Top platform (country)'), w: 140 },
    { key: 'mobile_per_100', header: 'mobile_subscriptions_per_100', label: T('gospelInternet.col.mobile', 'Mobile per 100'), w: 110, num: true, hidden: true },
    { key: 'translated_by', header: 'scripture_translated_by', label: T('gospelInternet.col.translatedBy', 'Translated by'), w: 170, hidden: true },
    { key: 'training_url', header: 'training_url', label: T('gospelInternet.col.training', 'Training (own language)'), w: 160, hidden: true, url: true },
    { key: 'bridge_training_url', header: 'bridge_training_url', label: T('gospelInternet.col.bridgeTraining', 'Training (bridge)'), w: 160, hidden: true, url: true },
    { key: 'deaf_bridge_publisher', header: 'deaf_bridge_publisher', label: T('gospelInternet.col.deafPublisher', 'Sign-language publisher'), w: 170, hidden: true },
    { key: 'people_praying', header: 'people_praying', label: T('gospelInternet.col.praying', 'People praying'), w: 110, num: true, hidden: true,
      show: (r) => r.people_praying == null ? '' : Number(r.people_praying).toLocaleString() },
    { key: 'pray_url', header: 'pray_url', label: T('buttons.prayForThem', 'Pray for them'), w: 120, url: true, linkText: T('buttons.prayForThem', 'Pray for them') },
  ]
}

export function wayInText(r, T) {
  if (r.way_in === 'bridge') {
    const s = r.bridge_strength ? ' · ' + label(T, 'strength', r.bridge_strength) : ''
    return `${r.bridge_language}${s}`
  }
  if (r.way_in === 'candidate') return T('gospelInternet.wayIn.candidateText', '{lang} (candidate, {pct}% of country)', { lang: r.bridge_candidate, pct: r.bridge_candidate_pct_of_country ?? '?' })
  if (r.way_in === 'deaf') return T('gospelInternet.wayIn.deafText', '{lang} (sign language)', { lang: r.deaf_bridge })
  return ''
}
function wayInCsv(r) {
  if (r.way_in === 'bridge') return `bridge:${r.bridge_language}${r.bridge_strength ? ' (' + r.bridge_strength + ')' : ''}`
  if (r.way_in === 'candidate') return `candidate:${r.bridge_candidate}`
  if (r.way_in === 'deaf') return `deaf:${r.deaf_bridge}`
  return ''
}
