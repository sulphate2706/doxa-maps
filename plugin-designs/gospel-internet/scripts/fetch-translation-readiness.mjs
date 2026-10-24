#!/usr/bin/env node
/**
 * fetch-translation-readiness.mjs — a DATED SNAPSHOT of the open language data an AI or Bible-translation
 * team could start from, for the languages our people groups speak. Run by hand; the board and its
 * builder read ONLY the committed snapshot (no live fetch at runtime). Card BUILD-TRANSLATION-READINESS-VIEW.
 *
 * Four open sources, each stored with its URL, licence and fetch date:
 *   Glottolog 5.x  "most extensive description" (MED) per languoid     CC BY 4.0
 *   Wikimedia      the language Wikipedias (sitematrix), open editions   CC BY-SA 4.0 (the text)
 *   Common Voice   validated speech hours per locale (Mozilla)           CC0 1.0
 *   FLORES+        the MT benchmark's languages (OLDI, Hugging Face)     CC BY-SA 4.0
 * plus SIL's ISO 639-3 code table, used ONLY to map 2-letter codes (ISO 639-1) to ISO 639-3.
 * (Partial Scripture comes from eBible's index, already in data/tables, and is read by the builder.)
 *
 * Codes are mapped EXPLICITLY and every code that cannot be mapped is COUNTED and listed, never dropped
 * silently.
 * Writes data/translation-readiness/snapshot.json. Refuses a much smaller snapshot than the last one.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/translation-readiness/snapshot.json')
const today = new Date().toISOString().slice(0, 10)

const SRC = {
  glottolog: { url: 'https://raw.githubusercontent.com/glottolog/glottolog-cldf/master/cldf/values.csv', licence: 'CC BY 4.0', name: 'Glottolog (CLDF): most extensive description (MED)' },
  sil: { url: 'https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3.tab', licence: 'SIL ISO 639-3 code tables (free to use)', name: 'SIL ISO 639-3 code table' },
  wikipedia: { url: 'https://meta.wikimedia.org/w/api.php?action=sitematrix&format=json&smtype=language&smlangprop=code|site', licence: 'CC BY-SA 4.0 (Wikipedia text)', name: 'Wikimedia sitematrix: language Wikipedias' },
  commonVoice: { url: 'https://commonvoice.mozilla.org/api/v1/stats/languages', licence: 'CC0 1.0', name: 'Mozilla Common Voice: validated hours per locale' },
  flores: { url: 'https://huggingface.co/api/datasets/openlanguagedata/flores_plus/tree/main/dev', licence: 'CC BY-SA 4.0', name: 'FLORES+ (OLDI) MT benchmark languages' },
}
const text = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'dx-maps readiness snapshot (open data)' } }); if (!r.ok) throw new Error(`${u} HTTP ${r.status}`); return r.text() }

// our languoids: every roster ISO code and its Glottolog id (from the committed tree snapshot)
const glotto = JSON.parse(readFileSync(resolve(REPO, 'data/glottolog/glottolog-subset.json'), 'utf8'))
const ourIds = new Map(glotto.languoids.filter((l) => l.iso).map((l) => [l.id, l.iso]))

// 1. MED for our languoids only (values.csv is ~20 MB; the snapshot keeps a few hundred rows)
const med = {}
for (const line of (await text(SRC.glottolog.url)).split('\n')) {
  if (!line.includes(',med,')) continue
  const [, lang, param, value, code] = line.split(',')
  if (param === 'med' && ourIds.has(lang)) med[ourIds.get(lang)] = { level: Number(value), code }
}

// 2. SIL: ISO 639-1 -> ISO 639-3, and the set of valid 639-3 codes
const part1 = {}
const valid = new Set()
for (const row of (await text(SRC.sil.url)).split('\n').slice(1)) {
  const c = row.split('\t')
  if (!c[0]) continue
  valid.add(c[0])
  if (c[3]) part1[c[3]] = c[0]
}
const toIso3 = (code) => { const b = String(code || '').toLowerCase().split(/[-_]/)[0]; return valid.has(b) ? b : part1[b] || '' }

// 3. Wikipedia editions (open ones), mapped to ISO 639-3
const sm = JSON.parse(await text(SRC.wikipedia.url)).sitematrix || {}
const wikipedia = {}
const wikiUnmapped = []
for (const [k, v] of Object.entries(sm)) {
  if (k === 'count' || !v || !v.site) continue
  const wp = v.site.find((s) => s.code === 'wiki' && !('closed' in s))
  if (!wp) continue
  const iso = toIso3(v.code)
  if (iso) wikipedia[iso] = v.code; else wikiUnmapped.push(v.code)
}

// 4. Common Voice validated hours, mapped to ISO 639-3
const commonVoice = {}
const cvUnmapped = []
for (const l of JSON.parse(await text(SRC.commonVoice.url))) {
  if (!(l.validatedHours > 0)) continue
  const iso = toIso3(l.locale)
  if (iso) commonVoice[iso] = Math.max(commonVoice[iso] || 0, l.validatedHours); else cvUnmapped.push(l.locale)
}

// 5. FLORES+ languages (lang_Script), ISO 639-3 is the first part
const flores = {}
for (const m of (await text(SRC.flores.url)).matchAll(/dev\/([a-z]{3})_([A-Z][a-z]{3})\.jsonl/g)) (flores[m[1]] ||= []).push(m[2])

const doc = {
  fetched: today,
  sources: Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, { ...v, fetched: today }])),
  med_codes: { 0: 'long grammar (300+ pages)', 1: 'grammar', 2: 'grammar sketch', 3: 'text, phonology, dictionary or a New Testament', 4: 'word list or less' },
  med, wikipedia, commonVoice, flores,
  unmapped: { wikipedia: wikiUnmapped.sort(), commonVoice: cvUnmapped.sort() },
  counts: { med: Object.keys(med).length, wikipedia: Object.keys(wikipedia).length, commonVoice: Object.keys(commonVoice).length, flores: Object.keys(flores).length,
    wikipedia_unmapped: wikiUnmapped.length, commonVoice_unmapped: cvUnmapped.length },
}
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  for (const k of ['med', 'wikipedia', 'commonVoice', 'flores']) {
    if (doc.counts[k] < 0.9 * (prev.counts?.[k] || 0)) { console.error(`REFUSING: ${k} dropped from ${prev.counts[k]} to ${doc.counts[k]} (a bad fetch?)`); process.exit(1) }
  }
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n')
console.log('ok', OUT.replace(REPO + '/', ''), JSON.stringify(doc.counts))
