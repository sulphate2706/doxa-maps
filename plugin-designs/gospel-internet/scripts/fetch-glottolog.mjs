#!/usr/bin/env node
/**
 * fetch-glottolog.mjs — the language TREE's source: a snapshot of Glottolog (CLDF) cut to the languoids
 * our people groups need.
 *
 * WHY GLOTTOLOG. It is the open, citable catalogue that classifies every languoid as a family, a
 * language or a dialect, with its full path from the family root (Max Planck Institute for Evolutionary
 * Anthropology, CC BY 4.0). IMB's LanguageFamily and library/data/langFamilyByIso.json stop at ONE level
 * ("Indo-European"), which cannot draw a tree. Glottolog also publishes each subtree in NEWICK, the
 * standard text format for trees, so this board invents no graph language of its own.
 *
 * WHAT IS KEPT: every language whose ISO 639-3 code a DOXA group uses, every ancestor on its path, and
 * every dialect under it. Codes Glottolog does not carry (IMB private-use 'q' codes) are LISTED in the
 * snapshot, never dropped silently.
 *
 * Network: raw.githubusercontent.com/glottolog/glottolog-cldf (master). Writes
 * data/glottolog/glottolog-subset.json. Refuses to overwrite a snapshot with a much smaller one.
 * Usage: node plugin-designs/gospel-internet/scripts/fetch-glottolog.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/glottolog/glottolog-subset.json')
const BASE = 'https://raw.githubusercontent.com/glottolog/glottolog-cldf/master/cldf/'

/** RFC-4180 CSV: quoted fields may hold commas, quotes ("") and newlines. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

async function get(name) {
  const res = await fetch(BASE + name)
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`)
  return res.text()
}

const meta = JSON.parse(await get('cldf-metadata.json'))
const languages = parseCsv(await get('languages.csv'))
const values = parseCsv(await get('values.csv'))
const classification = new Map()
for (const v of values) if (v.Parameter_ID === 'classification') classification.set(v.Language_ID, v.Value)

const byId = new Map(languages.map((l) => [l.ID, l]))
const byIso = new Map(languages.filter((l) => l.ISO639P3code).map((l) => [l.ISO639P3code, l]))
const access = JSON.parse(readFileSync(resolve(REPO, 'data/tables/doxa-gospel-access.json'), 'utf8')).rows
const wanted = [...new Set(access.map((r) => r.iso639_3).filter(Boolean))].sort()

const keep = new Set()
const missing = []
for (const iso of wanted) {
  const l = byIso.get(iso)
  if (!l) { missing.push(iso); continue }
  keep.add(l.ID)
  for (const g of (classification.get(l.ID) || '').split('/').filter(Boolean)) keep.add(g)
}
// every dialect under a kept language (a dialect's path runs through its language)
for (const l of languages) {
  if (l.Level !== 'dialect') continue
  const path = (classification.get(l.ID) || '').split('/')
  if (l.Language_ID && keep.has(l.Language_ID)) { keep.add(l.ID); for (const g of path) if (g) keep.add(g) }
}

const languoids = [...keep].sort().map((id) => {
  const l = byId.get(id)
  const path = (classification.get(id) || '').split('/').filter(Boolean)
  return { id, name: l ? l.Name : id, level: l ? l.Level : 'family', iso: l?.ISO639P3code || '', parent: path.length ? path[path.length - 1] : '',
    family: l?.Family_ID || '', language: l?.Language_ID || '' }
})

const doc = {
  source: meta['dc:title'] || 'Glottolog (CLDF)',
  citation: meta['dc:bibliographicCitation'] || '',
  licence: meta['dc:license'] || 'https://creativecommons.org/licenses/by/4.0/',
  url: 'https://glottolog.org',
  fetched: new Date().toISOString().slice(0, 10),
  scope: 'languoids needed by the ISO 639-3 codes of DOXA\'s people groups: each language, every ancestor on its classification path, every dialect under it',
  wanted: wanted.length,
  not_in_glottolog: missing,
  languoids,
}

if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  if (languoids.length < 0.9 * (prev.languoids || []).length) {
    console.error(`REFUSING: ${languoids.length} languoids would replace ${prev.languoids.length} (a >10% drop looks like a bad fetch)`)
    process.exit(1)
  }
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(doc) + '\n')
const lv = languoids.reduce((m, l) => { m[l.level] = (m[l.level] || 0) + 1; return m }, {})
console.log(`ok ${OUT.replace(REPO + '/', '')}: ${languoids.length} languoids`, lv, `${wanted.length - missing.length}/${wanted.length} codes found; not in Glottolog: ${missing.length}`)
