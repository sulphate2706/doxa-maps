/**
 * fetch-scriptureearth-index.mjs — Scripture Earth, joined on ISO 639-3.
 *
 * WHY THIS SOURCE. Scripture Earth (SIL International and its translation partners)
 * publishes Scripture for minority languages that the big catalogues miss. eBible,
 * Arclight, Door43 and FCBH between them still leave 2,901 of our people groups with
 * nothing at all, and those groups are small-language groups almost by definition —
 * exactly the population this portal serves. Its content is straight Scripture
 * translation, which passes the doctrinal filter on the same footing as eBible.
 *
 * WHAT IS AND IS NOT EVIDENCE HERE — this is the whole point of the file.
 * The portal exposes an open Apache index at /data/, listing 3,477 ISO-639-3
 * directories. THE DIRECTORY EXISTING MEANS NOTHING. Measured: of the 622 directories
 * matching a tier-0 code, 582 are empty stubs — a bare parent link, 646 bytes. Trusting
 * the listing alone would have shipped 716 people groups a link to an empty folder.
 * So a code counts only when its directory actually holds an artefact directory.
 *
 * NOR IS EVERY ARTEFACT A RESOURCE. A `video/` directory here contains only
 * JESUSFilm-<iso>.<lang>.txt metadata stubs, not playable film — 17 of the 40 non-empty
 * tier-0 codes had nothing but those. A person sent there finds a text file. So `video`
 * alone never qualifies a code; only PDF, audio, sab (Scripture App Builder), study and
 * viewer (SFM scripture text) do. Verified by hand before this was written:
 * data/bkc/PDF/Baka-AT-01.pdf is 14,366,830 bytes of application/pdf, and a nonexistent
 * sibling returns 404 — so a 200 here is real.
 *
 * We do not touch their search endpoints. LSearch.php and livesearch.php answer "Hack!"
 * to a query string; the open directory index is the part of the site meant to be read,
 * and robots.txt disallows nothing.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TABLES = resolve(HERE, '../../../data/tables')
const OUT = resolve(TABLES, 'scriptureearth-index.json')
const PINS = resolve(TABLES, 'people-group-pins.json')
const ORIGIN = 'https://scriptureearth.org'

/** Their host rejects a bare client; this is the same UA a reader would arrive with. */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

/** An empty language directory is 646 bytes of Apache chrome. Anything real is larger. */
const EMPTY_DIR_BYTES = 700

/**
 * Directories that represent something a person can actually open. `video` is deliberately
 * absent: see the header — it holds Jesus Film metadata stubs, not film.
 */
const REAL_KINDS = new Set(['PDF', 'audio', 'sab', 'study', 'viewer'])

const CONCURRENCY = Number(process.env.SE_CONCURRENCY || 4)
const LIMIT = Number(process.env.SE_LIMIT || 0)

async function get(url, timeoutMs = 20000) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  }
}

/** Child directory names in an Apache index, ignoring the sort links and the parent. */
function childDirs(html) {
  const out = []
  for (const m of html.matchAll(/href="([^"?/][^"]*)\/"/g)) out.push(decodeURIComponent(m[1]))
  return out
}

const root = await get(`${ORIGIN}/data/`, 60000)
if (!root) {
  console.error('SCRIPTUREEARTH: /data/ did not answer — leaving the previous snapshot alone.')
  process.exit(1)
}
const listed = childDirs(root).filter((d) => /^[a-z]{3}$/.test(d))
console.log(`SCRIPTUREEARTH: ${listed.length} ISO-639-3 directories listed.`)

/* Only codes our own map can join to. Scanning the other ~200 would be traffic for
   nothing — we could not attach the result to any people group. */
const pins = JSON.parse(readFileSync(PINS, 'utf8'))
const ours = new Set(Object.keys(pins.codes || {}).map((s) => s.toLowerCase()))
let targets = listed.filter((d) => ours.has(d))
if (LIMIT) targets = targets.slice(0, LIMIT)
console.log(`SCRIPTUREEARTH: ${targets.length} of them are codes this map uses.`)

const byIso = {}
let scanned = 0
let empty = 0
let videoOnly = 0

async function worker(queue) {
  for (;;) {
    const iso = queue.shift()
    if (!iso) return
    const html = await get(`${ORIGIN}/data/${iso}/`)
    scanned++
    if (scanned % 250 === 0) console.log(`  ${scanned}/${targets.length}`)
    if (!html || html.length < EMPTY_DIR_BYTES) {
      empty++
      continue
    }
    const kinds = childDirs(html)
    const real = kinds.filter((k) => REAL_KINDS.has(k))
    if (!real.length) {
      videoOnly++
      continue
    }
    byIso[iso] = { u: `${ORIGIN}/data/${iso}/`, k: real.sort() }
  }
}

const queue = [...targets]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

console.log(
  `SCRIPTUREEARTH: ${Object.keys(byIso).length} code(s) hold a real artefact; ` +
    `${empty} empty stub(s), ${videoOnly} with only Jesus Film metadata.`,
)

if (LIMIT) {
  console.log('SCRIPTUREEARTH: SE_LIMIT set — smoke run, writing nothing.')
  process.exit(0)
}

writeSnapshot(
  OUT,
  `${JSON.stringify(
    {
      source: `${ORIGIN}/data/ (open Apache index, robots.txt disallows nothing)`,
      fetched: new Date().toISOString().slice(0, 10),
      _note:
        'A listed directory is NOT a resource: most are empty stubs, and a video/ directory ' +
        'holds JESUSFilm-*.txt metadata rather than film. Only codes with PDF, audio, sab, ' +
        'study or viewer content are kept. Publisher is SIL International and its translation ' +
        'partners — straight Scripture, same doctrinal footing as eBible.',
      listed: listed.length,
      scanned: targets.length,
      emptyStubs: empty,
      metadataOnly: videoOnly,
      codes: Object.keys(byIso).length,
      byIso,
    },
    null,
    1,
  )}\n`,
  (j) => Object.keys(j.byIso || {}).length,
  'Scripture Earth code(s)',
)
console.log(`wrote ${OUT}`)
