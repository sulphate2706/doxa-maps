#!/usr/bin/env node
/**
 * fetch-zume-index.mjs — cache Zume Training's own language list as an ISO 639-3 index.
 *
 * WHY THIS EXISTS. The brief names zume.training explicitly and estimates ~40 languages.
 * An earlier pass recorded the list as unobtainable because /api/ is Disallow'ed in
 * robots.txt and the homepage's language switcher is client-rendered with no anchors.
 * Both of those are true and neither matters: robots.txt DECLARES a sitemap, and the
 * publisher maintains a page whose whole purpose is this list. Nothing here touches a
 * Disallow'ed path.
 *
 * TWO SOURCES, BECAUSE NEITHER IS COMPLETE ON ITS OWN:
 *   1. https://zume.training/sitemap.xml -> a per-locale sitemap for every locale that has
 *      public pages. This is the set that can be LINKED to.
 *   2. https://zume.training/articles/zume-languages -> the publisher's own table of
 *      English name, native name and language code ("All Zume languages (59)"). This is
 *      the set that is NAMED, and it is where the real names come from.
 * They disagree in both directions: Dari and Pashto ship public sites but are missing from
 * the article's table, and several article rows have no public pages yet. So the union is
 * collected and every landing URL is then FETCHED — a locale ships a link only if its own
 * page actually answers 200. Naming and linking are kept as separate facts.
 *
 * DOCTRINE. Zume Training is discipleship material built on the 66-book canon and is named
 * in the brief as acceptable. Only zume.training URLs are emitted; no other host appears.
 *
 * THE ISO 639-3 MAP IS THE LOAD-BEARING PART, so every non-obvious entry is justified below
 * and the join key is checked against the codes the people-group data actually uses (which
 * are individual codes, never macrolanguages — 'ara', 'zho', 'kur', 'msa', 'nep', 'ori',
 * 'pus' and 'swa' are all absent from it).
 *
 * AMBIGUOUS LOCALES ARE NOT JOINED. 'pus' (Pashto) has three individual codes in the data
 * — pbu, pbt, pst — and the publisher gives nothing that picks one. Per the standing rule,
 * an unclear mapping is left out rather than guessed: the locale still ships with its
 * verified URL, it simply carries no ISO code and so attaches to no people group.
 */
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'data/tables/zume-index.json')
const ORIGIN = 'https://zume.training'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Zume locale -> ISO 639-3. Obvious two-letter codes are omitted from the comments;
 * the ones a reader would otherwise have to take on trust are justified here.
 */
const ISO = {
  asl: 'ase', // publisher names it "American Sign Language"
  am: 'amh',
  ar: 'arb', // the article states this row is Modern Standard Arabic
  ar_jo: 'ajp', // Jordanian -> South Levantine Arabic
  ar_ma: 'ary', // Moroccan
  ar_tn: 'aeb', // Tunisian
  hy: 'hye',
  az: 'azj', // Latin-script Azerbaijani of the republic -> North
  bn: 'ben',
  bho: 'bho',
  bs: 'bos',
  bg: 'bul',
  my: 'mya',
  zhhk: 'yue', // publisher names it "Cantonese (Traditional)", not a Mandarin variant
  zhcn: 'cmn', // Simplified script; the language is Mandarin
  zhtw: 'cmn', // Traditional script, same language -> both locales join one code
  hr: 'hrv',
  prs: 'prs', // Dari
  en: 'eng',
  fo: 'fao',
  fr: 'fra',
  de: 'deu',
  gu: 'guj',
  ha: 'hau',
  hi: 'hin',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  kn: 'kan',
  ko: 'kor',
  ky: 'kir',
  ku: 'ckb', // native name is written in Arabic script and the article lists Kurdish as
  //            right-to-left; that is Central Kurdish (Sorani), not Latin-script Kurmanji
  lo: 'lao',
  lv: 'lvs',
  mai: 'mai',
  ms: 'zlm', // "Bahasa Malaysia"; the people-group data carries zlm "Malay", not zsm
  ml: 'mal',
  mr: 'mar',
  mn: 'khk', // Mongolian of Mongolia -> Halh
  ne: 'npi',
  or: 'ory',
  fa: 'pes', // Persian/Farsi -> Western Farsi
  pl: 'pol',
  pt: 'por',
  pa: 'pan', // Eastern Punjabi
  pa_pk: 'pnb', // "Punjabi (Western)"
  ro: 'ron',
  ru: 'rus',
  sl: 'slv',
  so: 'som',
  es: 'spa',
  swa: 'swh',
  tl: 'tgl',
  ta: 'tam',
  te: 'tel',
  th: 'tha',
  tr: 'tur',
  uk: 'ukr',
  ur: 'urd',
  vi: 'vie',
  yo: 'yor',
}

/** Locales deliberately left unjoined, with the reason recorded in the output. */
const UNJOINED = {
  pus: 'Pashto has three individual codes in the people-group data (pbu, pbt, pst) and the publisher gives nothing that selects one',
}

/**
 * APPROXIMATE matches, kept STRICTLY apart from the exact joins above.
 *
 * An unjoined locale is not the same as an absent resource, and conflating the two is how
 * 13 people groups covering 47.6M speakers came to be told "not in Zume's 54" while
 * https://zume.training/pus was live and in Pashto the whole time.
 *
 * WHAT WAS CHECKED BEFORE WRITING THIS DOWN. The publisher's launch article scopes Pashto
 * as "Afghanistan's other official language and a major language of northwestern Pakistan,
 * especially Khyber Pakhtunkhwa and parts of Balochistan" — territory that spans all three
 * codes rather than selecting one. The pages themselves declare no language metadata at
 * all: no hreflang alternates, no BCP-47 tag, and og:locale is the site-wide en_US on every
 * locale including this one. So nothing promotes this to an exact join.
 *
 * WHY IT IS STILL WORTH SHIPPING. Zume in Pashto is a WRITTEN course in Pashto script, and
 * written Pashto is one literary standard; the pbu/pbt/pst split is largely spoken variety.
 * Contrast the JESUS Film, which is already in this index under separate per-variety dubs
 * (pashto-yusufzai, pashto-southern) because a dub genuinely differs by pronunciation. The
 * medium decides, so this is recorded as approximate and labelled as such everywhere it is
 * shown, never folded into the exact counts and never used to move a tier.
 *
 * This is a curated list, not a fuzzy name match at runtime — an approximate join that a
 * reader cannot see and a gate cannot check is the one that eventually ships a wrong link.
 */
const APPROX = {
  pus: {
    iso: ['pbu', 'pbt', 'pst'],
    lang: 'Pashto',
    note: 'Published in Pashto; the publisher does not say which variety, and this group speaks one of three',
  },
}

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}

const locsIn = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

async function sitemapLocales() {
  const idx = await get(`${ORIGIN}/sitemap.xml`)
  const out = new Set()
  for (const u of locsIn(idx)) {
    const m = /\/sitemap\/([a-z_]{2,6})\.xml$/.exec(u)
    if (m) out.add(m[1])
  }
  return out
}

/** The article's table is three <td> cells per row: English name, native name, code. */
async function articleRows() {
  const html = await get(`${ORIGIN}/articles/zume-languages`)
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim(),
  )
  const rows = []
  for (let i = 0; i + 2 < cells.length; i += 3) {
    const [name, native, code] = [cells[i], cells[i + 1], cells[i + 2]]
    if (/^[a-z_]{2,6}$/.test(code)) rows.push({ code, name, native })
  }
  return rows
}

/** A locale ships a link only if its own landing page answers 200. */
async function resolves(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' })
    return r.status === 200
  } catch {
    return false
  }
}

const smap = await sitemapLocales()
const rows = await articleRows()
const named = new Map(rows.map((r) => [r.code, r]))

const all = [...new Set([...smap, ...named.keys()])].sort()
const entries = []
let live = 0

for (const code of all) {
  const url = `${ORIGIN}/${code}`
  const ok = await resolves(url)
  if (ok) live++
  const meta = named.get(code)
  const e = {
    locale: code,
    name: meta ? meta.name : null,
    native: meta && meta.native !== meta.name ? meta.native : null,
    iso: ISO[code] || null,
    url: ok ? url : null,
    listed: Boolean(meta),
    sitemap: smap.has(code),
  }
  if (!e.iso) e.why = UNJOINED[code] || 'no ISO 639-3 mapping recorded for this locale'
  entries.push(e)
}

/** ISO 639-3 -> the single best Zume landing page for that language. */
const byIso = {}
for (const e of entries) {
  if (!e.iso || !e.url) continue
  const prev = byIso[e.iso]
  // zhcn and zhtw both resolve to cmn; prefer the locale the publisher named first
  if (!prev) byIso[e.iso] = { locale: e.locale, name: e.name || e.locale, url: e.url }
}

// Approximate joins, resolved against what actually came back live.
const approx = {}
for (const [locale, a] of Object.entries(APPROX)) {
  const e = entries.find((x) => x.locale === locale)
  if (!e || !e.url) continue
  for (const iso of a.iso) approx[iso] = { locale, lang: a.lang, note: a.note, url: e.url }
}

const unjoined = entries.filter((e) => !e.iso).map((e) => e.locale)
const dead = entries.filter((e) => !e.url).map((e) => e.locale)

writeSnapshot(
  OUT,
  `${JSON.stringify(
    {
      source: `${ORIGIN}/sitemap.xml + ${ORIGIN}/articles/zume-languages`,
      fetched: new Date().toISOString().slice(0, 10),
      locales: entries.length,
      live,
      codes: Object.keys(byIso).length,
      approxCodes: Object.keys(approx).length,
      byIso,
      approx,
      entries,
    },
    null,
    1,
  )}\n`,
  (j) => Object.keys(j.byIso || {}).length,
  'Zume ISO 639-3 codes',
)

console.log(
  `ZUME: ${entries.length} locales (${smap.size} in sitemap, ${rows.length} in the article), ` +
    `${live} with a landing page that answers 200, ${Object.keys(byIso).length} joined to ISO 639-3.`,
)
if (unjoined.length) console.log(`ZUME: not joined -> ${unjoined.join(', ')}`)
if (Object.keys(approx).length) {
  console.log(`ZUME: approximate -> ${Object.entries(approx).map(([i, a]) => `${i} (${a.locale})`).join(', ')}`)
}
if (dead.length) console.log(`ZUME: no live page -> ${dead.join(', ')}`)
