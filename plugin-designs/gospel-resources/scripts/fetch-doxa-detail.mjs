/**
 * fetch-doxa-detail.mjs — Doxa's own coordinates and language code, per people group.
 *
 * ═══ WHAT THIS REPLACES, AND WHY THAT MATTERS ═══════════════════════════════════════════
 * The roster list endpoint carries no coordinates and no language code, so the map got both
 * by matching the group's NAME against the pin dataset. That join left 285 of Doxa's 2,107
 * unplaceable and unsearchable: no code means no key to look them up by in any pool, and the
 * access table had to report them as "not searched" rather than "nothing found", because
 * nobody had been able to ask.
 *
 * The per-group endpoint has both, from Doxa's own record:
 *     /api/people-groups/detail/<slug>  ->  primary_language {value:"ahk"}, latitude, longitude
 * Measured on four groups the name join had failed: Akha -> ahk, Akeu -> byo, Alxa Mongols ->
 * xal, Ajja -> krs, every one with coordinates. So the name matching goes away entirely — not
 * improved, REMOVED. A name match was always a guess dressed as a join; this is the publisher
 * saying which language their group speaks.
 *
 * It also carries IMB's own access fields (bible, JESUS Film, gospel recordings, audio
 * Scripture, Bible stories, translation level and year) and their engagement fields
 * (congregation existing, church planting, believers, work in local language, disciple and
 * church multiplication). Those are kept for a second opinion against what this build finds
 * independently — where they disagree, that disagreement is worth a look, and neither side
 * should be quietly overwritten by the other.
 *
 * MANNERS. pray.doxa.life's robots.txt is "User-Agent: * / Disallow:" — nothing disallowed —
 * and this is Doxa's own API serving their own roster. It is still 2,107 requests, so they go
 * sequentially with a pause, and the run checkpoints so a kill costs one record rather than
 * the whole pass.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const ROSTER = resolve(REPO, 'data/tables/doxa-people-groups.json')
const OUT = resolve(REPO, 'data/tables/doxa-detail.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const GAP = Number(process.env.DOXA_GAP_MS || 250)
const MAX = Number(process.env.DOXA_MAX || 0)

const roster = JSON.parse(readFileSync(ROSTER, 'utf8')).rows
const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { bySlug: {} }
const out = { ...prior.bySlug }

const val = (f) => (f && typeof f === 'object' ? f.value : f)
const lab = (f) => (f && typeof f === 'object' ? f.label : f)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

/* IN-BAND CONTROL, both directions, before a single record is trusted: a slug that exists
   must return a language, and a slug that cannot exist must not return a record. Without the
   negative arm a site that answers 200 with an empty object for everything would fill this
   table with silence and call it data. */
const one = async (slug) => {
  const r = await fetch(`https://pray.doxa.life/api/people-groups/detail/${slug}`, {
    headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) return null
  const t = await r.text()
  try { return JSON.parse(t) } catch { return null }
}
{
  const real = await one('akha')
  const bogus = await one('zzz-no-such-people-group-xyzzy')
  const realOk = real && val(real.primary_language) && num(real.latitude) != null
  const bogusOk = !bogus || !val(bogus.primary_language)
  if (!realOk || !bogusOk) {
    console.error('DOXA-DETAIL: ABORT — the endpoint is not discriminating.')
    console.error(`  real slug gave language=${val(real?.primary_language)} lat=${real?.latitude}`)
    console.error(`  impossible slug gave language=${val(bogus?.primary_language)}`)
    process.exit(1)
  }
  console.log('DOXA-DETAIL: controls pass — a real slug returns a language and coordinates, an impossible one does not.')
}

let fetched = 0, cached = 0, missing = 0, i = 0
for (const g of roster) {
  i++
  if (out[g.slug]) { cached++; continue }
  if (MAX && fetched >= MAX) break
  const d = await one(g.slug)
  if (!d) { missing++; await new Promise((r) => setTimeout(r, GAP)); continue }
  out[g.slug] = {
    iso639_3: val(d.primary_language) || '',
    language: lab(d.primary_language) || '',
    lat: num(d.latitude),
    lng: num(d.longitude),
    jp_id: d.joshua_project_id ?? null,
    evangelical_pct: num(d.evangelical_pct),
    believers: num(d.believers_count),
    engagement: lab(d.engagement_status) || '',
    congregation: val(d.imb_congregation_existing),
    church_planting: val(d.imb_church_planting),
    local_language_work: val(d.work_in_local_language),
    multiplication: val(d.disciple_and_church_multiplication),
    /* IMB's own view of access, kept SEPARATE from what this build finds. */
    imb: {
      bible: val(d.imb_bible_available),
      jesus_film: val(d.imb_jesus_film_available),
      recordings: val(d.imb_gospel_recordings_available),
      audio: val(d.imb_audio_scripture_available),
      stories: val(d.imb_bible_stories_available),
      total: num(d.imb_total_resources_available),
      translation_level: lab(d.imb_bible_translation_level) || '',
      year: num(d.imb_bible_year_published),
    },
  }
  fetched++
  if (fetched % 100 === 0) {
    // CHECKPOINT-WRITE-OK — resumes from this file as a cache, so it only ever grows.
    writeFileSync(OUT, JSON.stringify({ _note: 'Partial; rerun to resume.', bySlug: out }))
    console.log(`  ... ${i}/${roster.length}  fetched=${fetched} cached=${cached} missing=${missing}`)
  }
  await new Promise((r) => setTimeout(r, GAP))
}

const withCode = Object.values(out).filter((v) => v.iso639_3).length
const withCoords = Object.values(out).filter((v) => v.lat != null && v.lng != null).length
writeSnapshot(
  OUT,
  `${JSON.stringify({
    _note:
      "Per-group detail from Doxa's own API: the ISO 639-3 their record gives for the group, " +
      'their coordinates, and IMB\'s access and engagement fields. This REPLACES name matching ' +
      'against the pin dataset, which left 285 of the roster unplaceable and unsearchable.',
    source: 'https://pray.doxa.life/api/people-groups/detail/<slug>',
    generated: new Date().toISOString().slice(0, 10),
    counts: { records: Object.keys(out).length, withLanguageCode: withCode, withCoordinates: withCoords, missing },
    bySlug: out,
  }, null, 1)}\n`,
  (j) => Object.keys(j.bySlug || {}).length,
  'Doxa detail record(s)',
)
console.log(`DOXA-DETAIL: ${Object.keys(out).length} record(s) — ${withCode} with a language code, ${withCoords} with coordinates, ${missing} missing`)
