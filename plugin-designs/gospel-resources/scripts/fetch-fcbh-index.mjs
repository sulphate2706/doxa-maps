#!/usr/bin/env node
/**
 * fetch-fcbh-index.mjs — cache Faith Comes By Hearing's recordings database as an
 * ISO 639-3 index of AUDIO Scripture.
 *
 * THE GAP THIS FILLS. Every pin on this map has read "Audio - not searched (GRN)" for the
 * whole of its life, because Global Recordings Network sits behind Bunny Shield and answers
 * 403 to everything, robots.txt included. That is still true. But GRN is not the only audio
 * pool, and the brief names Faith Comes By Hearing / bible.is explicitly.
 *
 * WHERE THE DATA COMES FROM, AND WHY NOT THEIR API. api.scripture / 4.dbt.io need a key
 * (422 without one). No key is needed: the recordings-database page on their own site is
 * client-rendered and fetches a STATIC public file from their CDN,
 * cdn.faithcomesbyhearing.com/resources/fcbh/js/library/bible_recordings.json — 3,602 rows
 * of { iso, lang_name, bible_name, bible_id, country, video_date, audio_date, text_date }.
 * It is keyed by ISO 639-3 already, which is the join key this whole map is built on.
 *
 * ═══ A 200 FROM live.bible.is PROVES NOTHING, AND THIS ALMOST SHIPPED WRONG ═════════════
 * live.bible.is is a Next.js app that answers 200 for a fileset id that does not exist.
 * Measured:
 *     bible/OKEBSN  (real)  -> 200, content-length 15,996
 *     bible/KHEYBI  (real)  -> 200, content-length 76,547
 *     bible/ZZZZZZ  (bogus) -> 200, content-length  7,961
 *     bible/NOPE99  (bogus) -> 200, content-length  7,961
 * A bogus id returns a fixed-size not-found shell. So the discriminator is the BODY SIZE,
 * not the status — and HEAD returns content-length, so it costs one request and no payload.
 *
 * The shell size is NOT hard-coded. This script measures it at run time by asking for an id
 * that cannot exist, and treats any response of exactly that size as a miss. A magic 7,961
 * would rot silently the first time they change their 404 page; a self-calibrating control
 * cannot. If the probe ever comes back the same size as a KNOWN-GOOD id, the discriminator
 * has stopped discriminating and the run aborts rather than write 2,000 false greens.
 *
 * ═══ DOCTRINE ══════════════════════════════════════════════════════════════════════════
 * FCBH publishes straight Scripture audio, which the brief names as acceptable. The
 * publishers named in the data are Bible Societies, Biblica, Covenant and similar. The
 * name screen below is a guard for FUTURE data rather than a fix for anything present:
 * measured on this snapshot, 0 of 2,769 distinct translation names match it. Anything that
 * ever does is dropped and reported rather than silently included.
 *
 * ONE ROW PER LANGUAGE, AND ONE LINK. A fileset on bible.is is a single page that carries
 * whatever media that fileset has, so a language with audio AND text needs one link that
 * SAYS it has both, not two chips pointing at the same URL. Rows are therefore ranked by
 * how many media they carry, then by recency, and the winner records its media list.
 *
 * TEXT AND VIDEO ARE BOTH INCLUDED, AND VIDEO IS NOT FILM. `text_date` is unambiguous —
 * FCBH publishes Bible text on bible.is, and 698 codes carry text where this map had no
 * text Scripture at all, reaching 2,176 pins and 1.38bn people.
 *
 * `video_date` was left out of the first pass because the column does not say what the
 * video IS. That has now been established by rendering the pages and reading the API rather
 * than assuming, and it is NOT one thing:
 *   LAXCOV / GUGCV2 / SASCV2 -> fileset ...S2DV, 12 episodes: Intro & Garden of Eden,
 *     Noah, Abram ... After the Forty Years. The Covenant series — Old Testament narrative,
 *     Eden to the wilderness.
 *   ENGLFP / SINLFP          -> fileset ...P2DV, one book: Acts.
 * The suffix is therefore not a reliable label and the scope has to be read per fileset.
 * GET /api/bibles/<bible_id> returns name, iso AND the exact books array in one call, so
 * every video entry carries a real book list rather than a guess.
 *
 * IT IS TYPED "Bible video", NEVER "Film". On this map film means the JESUS Film, and
 * bible.is itself treats the two as different: its pages call a separate Arclight endpoint,
 * /api/arclight/jesus-film/languages?iso=..., to find the JESUS Film. A twelve-part Old
 * Testament narrative is also not the gospel, so counting it toward the Scripture+film tier
 * would overstate what a group has. It lifts a group off "nothing found", and no further.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'data/tables/fcbh-index.json')
const SRC = 'https://cdn.faithcomesbyhearing.com/resources/fcbh/js/library/bible_recordings.json'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SITE = 'https://live.bible.is/bible'

/** Added-canon and false-teaching publishers. Never included, however the row is labelled. */
const EXCLUDE = /watchtower|jehovah|new world translation|\bnwt\b|latter.?day|mormon|book of mormon|\blds\b|seventh.?day|adventist|christian science|unification church|clear word|joseph smith/i

const isSpecialCode = (c) => c === 'und' || c === 'mul' || c === 'mis' || c === 'zxx' ||
  (c >= 'qaa' && c <= 'qtz')

const sizeOf = async (url) => {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) })
    const n = Number(r.headers.get('content-length'))
    return Number.isFinite(n) ? n : -1
  } catch { return -1 }
}

// ═══ CALIBRATE THE DISCRIMINATOR BEFORE TRUSTING IT ═══
const shell = await sizeOf(`${SITE}/ZZZZZZ`)
const good = await sizeOf(`${SITE}/OKEBSN`)
if (shell < 0 || good < 0) {
  console.error('FCBH: ABORT — could not reach live.bible.is to calibrate the not-found shell.')
  process.exit(1)
}
if (shell === good) {
  console.error(`FCBH: ABORT — a bogus fileset and a real one both return ${shell} bytes. The size discriminator no longer discriminates, so nothing it says is worth writing down.`)
  process.exit(1)
}
console.log(`FCBH: calibrated — not-found shell is ${shell} bytes, a real fileset is ${good}.`)

// EVERY fetch in this script carries a timeout. One without it hung this run for thirteen
// minutes with no output and no progress — a stall that looks exactly like slow work.
const res = await fetch(SRC, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
if (!res.ok) throw new Error(`recordings json: HTTP ${res.status}`)
const rows = await res.json()
if (!Array.isArray(rows) || rows.length < 500) {
  console.error(`FCBH: ABORT — recordings json returned ${Array.isArray(rows) ? rows.length : 'no'} rows; refusing to run on a truncated file.`)
  process.exit(1)
}

const real = (v) => v && v !== 'NULL' ? String(v) : ''
let excluded = 0
let noMedia = 0
let special = 0
const best = {}
const bestVideo = {}
for (const r of rows) {
  const iso = String(r.iso || '').trim().toLowerCase()
  if (iso.length !== 3) continue
  if (isSpecialCode(iso)) { special++; continue }
  const media = []
  if (real(r.audio_date)) media.push('audio')
  if (real(r.text_date)) media.push('text')
  const hasVideo = real(r.video_date)
  if (!media.length && !hasVideo) { noMedia++; continue }
  if (EXCLUDE.test(String(r.bible_name || '')) || EXCLUDE.test(String(r.lang_name || ''))) { excluded++; continue }
  const id = String(r.bible_id || '').trim()
  if (!/^[A-Z0-9]{4,10}$/.test(id)) continue
  // Best VIDEO fileset per language, tracked apart from the Scripture one. Often it is the
  // same fileset, and then only one link ships; where they differ they are two genuinely
  // different things and both are worth having.
  if (hasVideo) {
    const cv = bestVideo[iso]
    if (!cv || real(r.video_date) > cv.date) {
      bestVideo[iso] = { id, date: real(r.video_date), name: String(r.bible_name || '').trim(), lang: String(r.lang_name || '').trim() }
    }
  }
  if (!media.length) continue

  const date = real(r.audio_date) || real(r.text_date)
  const cur = best[iso]
  // Rank: most media, then AUDIO present, then most recent. The middle term is not
  // decoration — without it a newer text-only fileset outranks an audio-only one on date
  // alone and the language silently loses its recording, which is the medium an
  // oral-preference group actually needs. Measured when it was missing: 3 codes lost audio.
  const rank = (m, dt) => [m.length, m.includes('audio') ? 1 : 0, dt]
  const a = rank(media, date)
  const b = cur ? rank(cur.media, cur.date) : null
  const better = !b || a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))
  if (better) {
    best[iso] = { id, date, media, name: String(r.bible_name || '').trim(), lang: String(r.lang_name || '').trim() }
  }
}

// ═══ VIDEO SCOPE, READ PER FILESET ═══ one call each, paced, and a fileset whose scope
// cannot be read is DROPPED rather than shipped with an invented description.
const videoCodes = {}
const vIsos = Object.keys(bestVideo)
let vOk = 0, vFail = 0
const VC = Number(process.env.FCBH_CONCURRENCY || 5)
const queue = [...vIsos]
const scopeWorker = async () => {
  for (;;) {
    const iso = queue.pop()
    if (!iso) return
    const b = bestVideo[iso]
    let books = null
    for (let attempt = 0; attempt < 3 && !books; attempt++) {
      try {
        const r = await fetch(`https://live.bible.is/api/bibles/${b.id}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })
        if (r.status === 403 || r.status === 429) { await new Promise((z) => setTimeout(z, 1200 * (attempt + 1))); continue }
        if (r.ok) {
          const j = await r.json()
          const arr = (j.data && j.data.books) || []
          books = arr.map((x) => String(x.name_short || x.name || x.book_id || '').trim()).filter(Boolean)
        } else break
      } catch { await new Promise((z) => setTimeout(z, 500 * (attempt + 1))) }
    }
    if (!books || !books.length) { vFail++; continue }
    vOk++
    if ((vOk + vFail) % 250 === 0) console.log(`  video scope ${vOk + vFail}/${vIsos.length}`)
    // The scope IS the book list. "12 parts, Intro & Garden of Eden to After the Forty
    // Years" tells a reader what they get; "video" does not.
    const scope = books.length === 1 ? books[0] : `${books.length} parts, ${books[0]} to ${books[books.length - 1]}`
    videoCodes[iso] = { u: `${SITE}/${b.id}`, n: b.name || 'Bible video', ln: b.lang, id: b.id, date: b.date, scope, books: books.length }
  }
}
await Promise.all(Array.from({ length: VC }, () => scopeWorker()))
console.log(`FCBH: video scope read for ${vOk} language(s); ${vFail} dropped because their book list could not be read.`)

const codes = {}
for (const [iso, b] of Object.entries(best)) {
  codes[iso] = { u: `${SITE}/${b.id}`, n: b.name || 'Scripture', ln: b.lang, id: b.id, date: b.date, m: b.media.join(', ') }
}

writeSnapshot(
  OUT,
  `${JSON.stringify(
    {
      _note: 'Faith Comes By Hearing recordings database, audio rows only, keyed by ISO 639-3. live.bible.is answers 200 for a bogus fileset, so links are checked by body size against a shell measured at run time, never by status.',
      source: SRC,
      generated: new Date().toISOString().slice(0, 10),
      shellBytes: shell,
      videoCodes,
      counts: { rows: rows.length, video: Object.keys(videoCodes).length, codes: Object.keys(codes).length, noMedia, special, excluded, audio: Object.values(codes).filter((c) => /audio/.test(c.m)).length, text: Object.values(codes).filter((c) => /text/.test(c.m)).length },
      codes,
    },
    null,
    1,
  )}\n`,
  // Both halves matter: a bad run can lose Scripture codes, video scopes, or both.
  (j) => Object.keys(j.codes || {}).length + Object.keys(j.videoCodes || {}).length,
  'FCBH code+video entries',
)

console.log(`FCBH: ${rows.length} rows -> ${Object.keys(codes).length} ISO 639-3 codes with Scripture (audio and/or text)`)
console.log(`  audio ${Object.values(codes).filter((c) => /audio/.test(c.m)).length}, text ${Object.values(codes).filter((c) => /text/.test(c.m)).length}; skipped ${noMedia} with neither, ${special} on an ISO reserved code, ${excluded} on the doctrine screen`)
console.log(`wrote ${OUT}`)
