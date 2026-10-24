#!/usr/bin/env node
/**
 * fetch-arclight-index.mjs — cache the JESUS Film Project's Arclight catalogue by ISO 639-3.
 *
 * THE SAME SHAPE THAT PAID OFF WITH EBIBLE. Arclight was ALREADY a checked pool, and only
 * 306 language codes carried a film link. The catalogue lists 2,330 media languages, 2,087
 * of them with a feature film. Being inside a pool is not the same as having been read.
 *
 * ★ featureFilm IS THE COVERAGE SIGNAL, NOT ROSTER MEMBERSHIP. A language appearing in
 * media-languages does not mean the film exists in it; counts.featureFilm >= 1 does. 21 of
 * the 2,330 are listed with no feature film and are dropped here.
 *
 * ★ THE WATCH URL CANNOT BE VERIFIED BY STATUS CODE, and this is the part worth reading.
 * https://www.jesusfilm.org/watch/?languageId=<id> is a single-page app: it answers 200 for
 * EVERY id, including `0` and `abcdef`. MEASURED — all three return 200. So a sample of
 * watch-URLs "resolving 200" is a check that cannot fail and proves nothing at all about
 * whether a film exists.
 *
 * The API is what discriminates: media-languages/<id> returns 200 with a real
 * counts.featureFilm for a genuine language and 404 for a bogus one. So existence is
 * established from the API, and the watch URL is the deep link for a language the API has
 * already confirmed. Verifying it the other way round would have shipped 1,781 links on the
 * strength of a status code that is always 200.
 *
 * ★ WHAT THE WATCH URL DOES AND DOES NOT DO — measured, because a confident wrong answer
 * is available in BOTH directions here.
 *   - It cannot be verified by fetching. `?languageId=<id>` is a query parameter on a
 *     client-rendered page: the server returns a byte-identical 867,227-byte shell for a
 *     real id, a bogus id and every language alike. Grading it by STATUS says ALIVE for
 *     everything; grading it by CONTENT says DEAD for everything, because the phrase
 *     "WatchNotFound" lives in an i18n bundle embedded in every page. Both checks are
 *     vacuous and each looks authoritative.
 *   - Rendered in a real browser it does NOT land on the film in that language: id 529,
 *     id 1304 and id 999999999 all render the same generic library page. So the link is
 *     real and the film's existence is real, but the URL is not a language deep link.
 *   - No constructible scheme works either. The legacy /watch/jesus.html/<slug>.html form
 *     is retired (english.html 404s, not just rare languages), and /watch/<slug>.html/videos
 *     — a shape the live page itself renders — also 404s to a fetch, because it resolves
 *     client-side.
 * THE API IS THE GROUND TRUTH, and the only thing here that discriminates: media-languages/<id>
 * returns a real counts.featureFilm for a genuine language and 404 for a bogus one. Existence
 * is asserted from that; the URL is offered as a way in, labelled for what it is.
 *
 * DOCTRINE: the JESUS Film is a dramatisation of Luke's Gospel by the JESUS Film Project.
 * Inside the filter, and named explicitly in the standing instruction. Only featureFilm is
 * taken; Arclight also carries short films and other media that are not screened here.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'data/tables/arclight-index.json')
const API = 'https://api.arclight.org/v2/media-languages'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const WATCH = (id) => `https://www.jesusfilm.org/watch/?languageId=${id}`

const all = []
let page = 1, pages = 1
do {
  const res = await fetch(`${API}?limit=1000&page=${page}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`arclight page ${page}: HTTP ${res.status}`)
  const d = await res.json()
  pages = d.pages && d.limit ? Math.ceil(d.total / d.limit) : 1
  all.push(...(d._embedded?.mediaLanguages || []))
  page++
} while (page <= pages && page < 20)

const stats = { fetched: all.length, noFeatureFilm: 0, noIso: 0, kept: 0 }
const codes = {}
for (const r of all) {
  const ff = Number(r?.counts?.featureFilm?.value || 0)
  if (ff < 1) { stats.noFeatureFilm++; continue }
  const iso = (r.iso3 || '').trim()
  if (iso.length !== 3) { stats.noIso++; continue }
  const prev = codes[iso]
  // more speakers wins when one ISO code maps to several Arclight languages
  const spk = Number(r?.counts?.speakerCount?.value || 0)
  if (!prev || spk > prev.spk) {
    codes[iso] = { u: WATCH(r.languageId), id: r.languageId, n: r.name || '', spk }
  }
}
stats.kept = Object.keys(codes).length

writeSnapshot(OUT, JSON.stringify({
  _note: 'Arclight (JESUS Film Project) catalogue by ISO 639-3. Only languages with counts.featureFilm >= 1. Existence is established from the API: the /watch/ URL answers 200 for ANY id and cannot verify anything.',
  generated: new Date().toISOString().slice(0, 10),
  source: API,
  stats,
  codes,
}), (j) => Object.keys(j.codes || {}).length, 'Arclight ISO 639-3 codes')
console.log(JSON.stringify(stats))
console.log(`${stats.kept} ISO 639-3 codes -> ${OUT}`)
