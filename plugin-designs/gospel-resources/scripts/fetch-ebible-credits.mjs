/**
 * fetch-ebible-credits.mjs — WHO translated the Scripture this map links to.
 *
 * WHY. The aim is real leads: real translators and the real organisations that do the
 * work, not just a URL. A mobiliser who finds a neighbouring language already has Scripture
 * wants to know who produced it, because that organisation is the one with the linguists, the
 * relationships and very often a field team already in that country. The link answers "where";
 * this answers "who to ask".
 *
 * eBible publishes its whole catalogue as CSV with a Copyright line on every row, and the join
 * is exact: 964 of the 964 eBible links in this index match a catalogue row by translation id,
 * with nothing unmatched. The organisations are real and countable — Wycliffe Bible Translators
 * on 899 rows, Bible Societies 89, Biblica 58, Pioneer Bible Translators 45, Seed Company 28.
 *
 * ⚠ NAMES ONLY. NO NEW LINKS. The catalogue also carries homeDomain and publicationURL, and
 * shipping those would put publishers into this map that the doctrine screen has never seen —
 * the screen is an allowlist precisely so a new host cannot arrive as a side effect of a data
 * refresh. A name is a lead a person can act on; a link is a claim this build has to stand
 * behind. So the name ships and the domain does not.
 *
 * It adds no resource and moves no tier. It is attribution for Scripture already in the index.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/translation-credits.json')
const SRC = 'https://ebible.org/Scriptures/translations.csv'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const res = await fetch(SRC, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90000) })
if (!res.ok) { console.error(`CREDITS: ${SRC} -> ${res.status}`); process.exit(1) }
const text = await res.text()

/* A CSV parser rather than a split on commas: Copyright lines contain commas inside quotes
   ("Wycliffe Bible Translators, Inc."), and splitting would cut every one of them in half. */
const parseCsv = (s) => {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const raw = parseCsv(text.replace(/^﻿/, ''))
const header = raw[0]
const col = (n) => header.indexOf(n)
const iLang = col('languageCode'), iId = col('translationId'), iTitle = col('title'), iCr = col('Copyright')
if (iLang < 0 || iId < 0 || iCr < 0) {
  console.error('CREDITS: the catalogue no longer has the columns this reads — refusing to write.')
  process.exit(1)
}

/** "Copyright © 2009 Wycliffe Bible Translators, Inc." -> { org, year } */
const split = (cr) => {
  const year = (cr.match(/\b(1[89]\d{2}|20\d{2})\b/) || [])[1] || ''
  const org = cr
    .replace(/^\s*copyright\s*/i, '')
    .replace(/©|\(c\)/gi, '')
    .replace(/\b(1[89]\d{2}|20\d{2})\b/g, '')
    .replace(/^[\s,.-]+|[\s,.]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { org, year }
}

const byId = {}
const byIdAll = {}
let withOrg = 0
for (const r of raw.slice(1)) {
  if (!r[iId]) continue
  byIdAll[r[iId]] = true
  const { org, year } = split(r[iCr] || '')
  /* ⚠ A LICENCE IS NOT A TRANSLATOR. 35 rows reduce to "public domain", which says how the text
     may be used and nothing about who produced it. Shipping that as a credit would answer "who
     to ask" with a legal status, so those rows are dropped and the group simply has no credit —
     which is the true state of what this catalogue tells us. */
  if (!org || /^(public domain|no copyright|copyrighted|licen[cs]e)\b/i.test(org)) continue
  withOrg++
  byId[r[iId]] = { lang: r[iLang] || '', title: r[iTitle] || '', org, year }
}

/* Only the translations this map actually links to are kept — the rest is somebody else's
   catalogue, and carrying it would grow the shipped payload for no reader. */
const idx = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))
const used = {}
let joined = 0, noRow = 0, licenceOnly = 0
for (const [code, c] of Object.entries(idx.codes || {})) {
  const m = /^https?:\/\/ebible\.org\/([^/]+)\/?$/.exec(c.s || '')
  if (!m) continue
  const hit = byId[m[1]]
  /* Two different silences, counted apart: the catalogue has no row for this translation, or it
     has one whose copyright is a licence rather than a body. Adding them together would hide
     which of the two is growing. */
  if (!hit) { if (byIdAll[m[1]]) licenceOnly++; else noRow++; continue }
  joined++
  used[code] = { org: hit.org, year: hit.year, title: hit.title }
}

if (!joined) {
  console.error('CREDITS: REFUSING TO WRITE — nothing joined; the URL shape or the catalogue changed.')
  process.exitCode = 1
} else {
  /* THROUGH THE SNAPSHOT GUARD. The refusal above fires only when NOTHING joins. A catalogue
     fetch that half-succeeds joins some, and would take the translator's name off the rest. */
  const body = `${JSON.stringify({
    meta: {
      title: 'Who translated it — attribution for the Scripture this map links to',
      source: SRC,
      generated: new Date().toISOString().slice(0, 10),
      catalogue_rows: raw.length - 1,
      rows_with_an_organisation: withOrg,
      codes_joined: joined,
      codes_with_no_catalogue_row: noRow,
      codes_whose_copyright_is_a_licence_not_a_translator: licenceOnly,
      note: 'Names only. The catalogue also carries homeDomain and publicationURL; those are ' +
        'deliberately not shipped, because a link would put a publisher into this map that the ' +
        'doctrine screen has never seen. Adds no resource and moves no tier.',
    },
    byCode: used,
  }, null, 1)}\n`
  writeSnapshot(OUT, body, (j) => Object.keys(j.byCode || {}).length, 'credited code(s)')
  console.log(`translation-credits: ${joined} code(s) with a named translator, ${licenceOnly} whose copyright is a licence, ${noRow} with no catalogue row, from ${raw.length - 1} rows`)
  console.log(`wrote ${OUT}`)
}
