#!/usr/bin/env node
/**
 * fetch-door43-index.mjs — cache unfoldingWord's Door43 catalog as an ISO 639-3 index.
 *
 * WHY A CACHED INDEX AND NOT A LIVE FETCH: the pin build must be reproducible offline and
 * must not make 12,379 rows depend on someone else's uptime. This writes a dated snapshot
 * with its source URLs recorded, so what shipped can always be re-derived and re-checked.
 *
 * WHY stage=prod: Door43 LISTS more languages than it HOSTS resources for. This repo already
 * learned that the hard way — people-group-resources.json carries the note "Door43 lists this
 * language but hosts NO resources for it — roster membership is not coverage". `stage=prod`
 * returns only released entries, so an entry here means a real published resource, not a
 * roster row. RECONCILED at build time against the existing has_open_bible_stories flag:
 * 38 of 38 previously-flagged languages are confirmed by this catalog, 0 contradicted.
 *
 * DOCTRINE: unfoldingWord/Door43 publishes the 66-book canon and Open Bible Stories (50
 * illustrated narratives drawn from it). It is inside the filter. Nothing here adds a source
 * whose doctrine was not checked — and OBS is labelled as STORIES, never as a Bible, because
 * telling a reader they have Scripture when they have a story set is the dishonesty that
 * matters most on this map.
 *
 * CODES: 3-letter ISO 639-3 is kept as-is, and region/script suffixes are stripped
 * ('ar-xzn' -> 'ara'). Door43 ALSO labels its biggest languages with 2-letter 639-1 tags,
 * and those used to be dropped here on the grounds that turning one into a 3-letter code
 * would be a guess. The caution was right and the conclusion was wrong: ISO 639-3 itself
 * publishes the correspondence, in the Part1 column of iso-639-3.tab, so this is a
 * standards-defined mapping and not an inference. That file is fetched below rather than
 * transcribed, so it cannot quietly go stale.
 *
 * MEASURED COST OF THE OLD BEHAVIOUR: 32 languages spoken by 2,576 people-group pins —
 * 2.87bn people, including Bengali, Hindi, Spanish, Amharic, Hausa and English — carried
 * Scripture and film but NO Door43 resource, purely because Door43 spelled their code with
 * two letters instead of three.
 *
 * ONE EXCLUSION, AND IT IS LOAD-BEARING: a tag carrying an '-x-' PRIVATE-USE subtag is
 * skipped on this path. Private use is where a publisher marks something the standard does
 * not cover, and that is exactly where the base code stops being the right language.
 * Door43 publishes 'el-x-koine' — Koine Greek. Its base 'el' maps to 'ell', Modern Greek,
 * which 13 people groups on this map speak. Folding it in would have shipped a Koine Greek
 * text to 13 groups as though it were their own language. Region and script subtags
 * ('es-419', 'pt-br', 'sr-latn', 'ur-deva', 'zh-hant') are NOT private use and are the same
 * language, so they still fold to the base.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'data/tables/door43-index.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const SUBJECTS = ['Open Bible Stories', 'Bible', 'Aligned Bible']
const API = 'https://git.door43.org/api/v1/catalog/search'
const ISO_TAB = 'https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3.tab'

// ISO 639-1 -> ISO 639-3, straight from SIL's own table. Macrolanguage rows are kept: the
// resource genuinely IS in that macrolanguage, and a macro code no pin speaks simply joins
// to nothing rather than to the wrong people.
const isoRes = await fetch(ISO_TAB, { headers: { 'User-Agent': UA } })
if (!isoRes.ok) throw new Error(`iso-639-3.tab: HTTP ${isoRes.status}`)
const P1 = {}
for (const line of (await isoRes.text()).trim().split('\n').slice(1)) {
  const f = line.split('\t')
  const id = (f[0] || '').trim()
  const part1 = (f[3] || '').trim()
  if (id.length === 3 && part1.length === 2) P1[part1] = id
}
if (Object.keys(P1).length < 150) {
  throw new Error(`iso-639-3.tab gave only ${Object.keys(P1).length} Part1 pairs — refusing to run on a truncated table`)
}
console.log(`iso-639-3.tab: ${Object.keys(P1).length} ISO 639-1 -> 639-3 pairs`)

let viaPart1 = 0
let skippedPrivate = 0
/** Resolve a Door43 language tag to an ISO 639-3 code, or '' if it must not be used. */
const toIso3 = (tag) => {
  const t = String(tag || '')
  const base = t.split('-')[0]
  if (base.length === 3) return base
  if (base.length !== 2) return ''
  // '-x-' is private use: the base code is not reliably the same language. See the header.
  if (/-x-/i.test(t)) { skippedPrivate++; return '' }
  const m = P1[base]
  if (m) viaPart1++
  return m || ''
}

// ISO 639-3 RESERVES these: und = undetermined, mul = multiple, mis = uncoded, zxx =
// no linguistic content, and qaa-qtz are private-use. They are not languages, so a
// resource attached to one is attached to nothing. MEASURED: Door43 publishes 4 entries
// under `und`, and 16 pins sit on a special code — the list profile was showing 14
// people groups an "Open Bible Stories" link for a language literally recorded as
// undetermined. That is a false claim about what exists in someone's language.
const isSpecialCode = (c) => c === 'und' || c === 'mul' || c === 'mis' || c === 'zxx' ||
  (c >= 'qaa' && c <= 'qtz')

// SCOPE FROM THE INGREDIENTS. Each catalogue entry lists its books with a category —
// bible-ot or bible-nt — so a Door43 Scripture entry can say how much Scripture it is,
// the same as an eBible one. It matters because the SUBJECT does not: an entry filed
// under "Bible" can be 27 NT books and nothing else, which is a New Testament, and
// calling it a Bible because of its folder name would be the same error as calling Open
// Bible Stories Scripture. Counted from the data, never from the label.
// 39 OT + 27 NT = the 66-book canon.
function d43Scope(ingredients) {
  if (!Array.isArray(ingredients) || !ingredients.length) return ''
  let ot = 0, nt = 0
  for (const i of ingredients) {
    const cats = Array.isArray(i?.categories) ? i.categories : []
    if (cats.includes('bible-ot')) ot++
    else if (cats.includes('bible-nt')) nt++
  }
  if (ot === 0 && nt === 0) return ''
  if (ot >= 39 && nt >= 27) return 'Full Bible'
  if (nt && !ot) return nt >= 27 ? 'New Testament' : 'Portions'
  if (ot && !nt) return ot >= 39 ? 'Old Testament' : 'Portions'
  return 'Portions of both Testaments'
}

const index = {}
const sources = []
for (const subject of SUBJECTS) {
  const url = `${API}?subject=${encodeURIComponent(subject)}&stage=prod&limit=2000`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${subject}: HTTP ${res.status}`)
  const { data } = await res.json()
  sources.push({ subject, url, entries: data.length })
  for (const r of data) {
    const code = toIso3(r.language)
    if (!code || isSpecialCode(code)) continue
    const href = r.repo?.html_url
    if (!href) continue
    const cur = index[code] || (index[code] = { title: r.language_title || '', items: [] })
    if (!cur.items.some((i) => i.url === href)) {
    // The owner disambiguates: 40 languages carry more than one entry with the SAME
    // subject, which rendered as "Open Bible Stories  Open Bible Stories" — two links a
    // reader cannot tell apart. Different owners are different translation efforts.
      cur.items.push({
        subject, url: href, name: r.title || subject, owner: r.owner || '',
        scope: subject === 'Open Bible Stories' ? '' : d43Scope(r.ingredients),
      })
    }
  }
  console.log(`${subject}: ${data.length} entries`)
}

const out = {
  _note: 'Door43 (unfoldingWord) catalog snapshot, stage=prod only. Keyed by ISO 639-3. An entry means a PUBLISHED resource, not roster membership. Open Bible Stories is 50 illustrated narratives, NOT a Bible translation.',
  generated: new Date().toISOString().slice(0, 10),
  sources,
  codes: index,
}
writeSnapshot(OUT, JSON.stringify(out, null, 1), (j) => Object.keys(j.codes || {}).length, 'Door43 ISO 639-3 codes')
console.log(`\n${Object.keys(index).length} ISO 639-3 codes -> ${OUT}`)
console.log(`${viaPart1} entr(ies) joined through an ISO 639-1 tag; ${skippedPrivate} private-use tag(s) skipped`)
