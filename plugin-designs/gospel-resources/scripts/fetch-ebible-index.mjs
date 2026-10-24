#!/usr/bin/env node
/**
 * fetch-ebible-index.mjs — cache eBible.org's translation catalogue as an ISO 639-3 index.
 *
 * THE FINDING THIS EXISTS FOR. eBible was ALREADY one of the two pools this repo checked,
 * but only 120 language codes carried an eBible link. The catalogue lists 1,550 translations
 * across 1,239 codes with canonical books — the pool had been harvested at roughly a tenth
 * of its content, and ~1,600 people groups were reading "nothing found" because of it.
 *
 * CANON TEST: a row is kept only if OTbooks + NTbooks > 0. A publication that is
 * deuterocanonical ONLY is not the 66-book canon and is dropped. (Measured on this
 * snapshot: 1,547 of 1,550 rows pass, 0 are DC-only — the 3 dropped carry no books at all.)
 * DCbooks alongside OT/NT is NOT a reason to drop: many canon publications append them, and
 * the 66 books are present either way. The type is what matters, not the appendix.
 *
 * DOCTRINE SCREEN ON THE PUBLICATION DOMAIN, not just on eBible's reputation — publicationURL
 * does not always point at ebible.org. Four domains appear in this catalogue and each was
 * checked by fetching it:
 *   ebible.org   1242  — the pool already in use, public-domain and openly-licensed Bibles
 *   png.bible     302  — "Papua New Guinea Scriptures", Holy Bible in PNG languages
 *   alkitab.pw      3  — serves eBible.org's own site; a mirror
 *   inscript.org    1  — EXCLUDED. "inScript Bible Browser" and nothing else; its page
 *                        establishes no publisher or doctrinal provenance, and the standing
 *                        rule is that an unclear source is left out. Cost: one row.
 * Any domain not on the allow-list below is dropped, so a future catalogue update cannot
 * silently introduce a publisher nobody screened.
 *
 * ONE TRANSLATION PER LANGUAGE: the one with the most canonical books, tie-broken by verses.
 * A language with a full Bible should not be represented by a single-gospel portion.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'data/tables/ebible-index.json')
const SRC = 'https://ebible.org/Scriptures/translations.csv'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const ALLOWED = new Set(['ebible.org', 'png.bible', 'alkitab.pw'])

const res = await fetch(SRC, { headers: { 'User-Agent': UA } })
if (!res.ok) throw new Error(`ebible catalogue: HTTP ${res.status}`)
const text = await res.text()

// minimal RFC4180 parse — titles contain commas and quoted quotes
function parseCsv(s) {
  const rows = []; let row = [], f = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { f += '"'; i++ }
      else if (c === '"') q = false
      else f += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); f = ''; rows.push(row); row = [] }
    else if (c !== '\r') f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const head = rows.shift().map((h) => h.replace(/^﻿/, '').trim())
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

// HTTPS, and the host lower-cased. The catalogue publishes plain http:// for all 1,237
// of these and spells the host `eBible.org` on 6 of them. Every host here serves https
// directly (verified 12/12 on a sample) and redirects http there anyway, so the plain
// link only buys a redirect hop and a downgraded scheme in a field worker's browser.
// ONLY the scheme and the HOST are normalised — the path is left exactly as published,
// because a path is case-sensitive and "fixing" it would break the link.
const httpsify = (u) => {
  const m = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(String(u || '').trim())
  if (!m) return String(u || '').trim()
  return `https://${m[1].toLowerCase()}${m[2] || ''}`
}

const num = (v) => (String(v).trim().match(/^\d+$/) ? Number(v) : 0)
const rows = parseCsv(text)
// badUrl is kept SEPARATE from badDomain: they are different defects and folding them
// together hid one. MEASURED in this snapshot: nko and nlx publish 'http:///nkoNT/' — a
// malformed URL with an EMPTY host, broken in eBible's own catalogue. A loose check for
// the 'http://' prefix passes it happily; requiring a non-empty host is what rejects it.
// Two broken links out of 1,550 is the difference between shipping real resources and
// shipping a 'real' link that resolves nowhere.
const stats = { total: rows.length, noCanon: 0, badUrl: 0, badDomain: 0, kept: 0 }
const best = {}
for (const r of rows) {
  const code = (r.languageCode || '').trim()
  const url = httpsify(r.publicationURL || '')
  if (!code || code.length !== 3 || !url) continue
  const books = num(r.OTbooks) + num(r.NTbooks)
  if (books === 0) { stats.noCanon++; continue }
  const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1]?.toLowerCase()
  if (!host) { stats.badUrl++; (stats.malformed ||= []).push(`${code} ${url}`); continue }
  if (!ALLOWED.has(host)) {
    stats.badDomain++
    ;(stats.excluded ||= []).push(`${code} ${host} ${(r.shortTitle || '').slice(0, 30)}`)
    continue
  }
  const verses = num(r.OTverses) + num(r.NTverses)
  const cur = best[code]
  if (!cur || books > cur.books || (books === cur.books && verses > cur.verses)) {
    best[code] = {
      u: url,
      t: (r.shortTitle || r.title || '').trim(),
      // The LANGUAGE name, distinct from the translation title. Without it a language
      // that no people group speaks has no name anywhere, and its table row reads as a
      // bare ISO code — which tells a reader searching for that language nothing.
      ln: (r.languageNameInEnglish || r.languageName || '').trim(),
      books,
      verses,
      nt: num(r.NTbooks) > 0,
      ot: num(r.OTbooks) > 0,
      full: num(r.OTbooks) >= 39 && num(r.NTbooks) >= 27,
    }
  }
}
stats.kept = Object.keys(best).length

// ALSO KEYED BY URL. The language index answers "what is the best translation for this
// code"; it cannot answer "what is THIS link". 24 curated scripture_urls point at an
// older edition than the catalogue's current pick — tel2010 where the catalogue says
// tel2017 — and both resolve, so the curated choice is kept. Indexed by URL they can
// still be NAMED and SCOPED, instead of being the only rows on the map with no scope.
const byUrl = {}
for (const r of rows) {
  const url = httpsify(r.publicationURL || '')
  const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1]
  if (!url || !host || !ALLOWED.has(host)) continue
  const ot = num(r.OTbooks), nt = num(r.NTbooks)
  if (ot + nt === 0) continue
  byUrl[url] = {
    t: (r.shortTitle || r.title || '').trim(),
    ln: (r.languageNameInEnglish || r.languageName || '').trim(),
    nt: nt > 0, ot: ot > 0, full: ot >= 39 && nt >= 27,
  }
}

const out = {
  _note: 'eBible.org translation catalogue, keyed by ISO 639-3. One translation per language (most canonical books). Rows with no OT/NT books are dropped; publication domains are allow-listed after a doctrine screen. inscript.org excluded: no established provenance.',
  generated: new Date().toISOString().slice(0, 10),
  source: SRC,
  allowed_domains: [...ALLOWED],
  stats,
  codes: best,
  byUrl,
}
writeSnapshot(OUT, JSON.stringify(out), (j) => Object.keys(j.codes || {}).length, 'eBible ISO 639-3 codes')
console.log(JSON.stringify(stats))
console.log(`${stats.kept} ISO 639-3 codes -> ${OUT}`)
