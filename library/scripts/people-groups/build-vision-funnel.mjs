#!/usr/bin/env node
/**
 * build-vision-funnel.mjs — every number on the DOXA Vision Card, computed from data, never typed.
 *
 *   node library/scripts/people-groups/build-vision-funnel.mjs            (refresh the DOXA snapshot too)
 *   node library/scripts/people-groups/build-vision-funnel.mjs --offline  (reuse the saved snapshot)
 *
 * READS   data/people-groups/people_groups.csv        IMB / peoplegroups.org, one row per group × country
 *         https://pray.doxa.life/api/people-groups/list  the live DOXA list (saved as a snapshot below)
 * WRITES  data/people-groups/doxa-groups-snapshot.json   the DOXA list as fetched: slug, ROP3, country
 *         data/people-groups/vision-funnel.json          the four funnel steps, counts and populations
 *
 * THE RULES (documented for readers in plugin-designs/doxa-vision-card/HOW-THE-NUMBERS-ARE-COUNTED.md):
 *   people groups  every row of the IMB dataset (a people group in one country)
 *   unreached      IMB Lostness Priority 0–2  (Frontier / Pioneer / Expanding Unreached: < 2% evangelical)
 *   frontier       IMB Lostness Priority 0    ("Frontier Unreached People Group": < 0.1% evangelical)
 *   DOXA groups    every group on the live DOXA list, matched to the IMB row by (ROP3, country)
 * The first three NEST (each is a subset of the one before). DOXA groups do not nest inside frontier,
 * so the card says how many of them are frontier rather than implying all are.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CSV = resolve(ROOT, 'data/people-groups/people_groups.csv')
const SNAP = resolve(ROOT, 'data/people-groups/doxa-groups-snapshot.json')
const OUT = resolve(ROOT, 'data/people-groups/vision-funnel.json')
const OFFLINE = process.argv.includes('--offline')

// Minimal RFC-4180 CSV parser (quoted fields, doubled quotes, newlines inside quotes).
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const head = rows.shift().map((h) => h.replace(/^﻿/, ''))
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const rows = parseCsv(readFileSync(CSV, 'utf8'))
const pop = (r) => Number(r.Population) || 0
const lostness = (r) => Number(r.LostnessPriority)
const isUnreached = (r) => lostness(r) >= 0 && lostness(r) <= 2
const isFrontier = (r) => lostness(r) === 0
const sum = (xs) => xs.reduce((a, r) => a + pop(r), 0)

// The DOXA list: live unless --offline, always saved so the numbers can be re-derived later.
let snapshot = null
if (!OFFLINE) {
  try {
    const url = 'https://pray.doxa.life/api/people-groups/list?fields=slug,imb_reg_of_people_3,country_code'
    // pray.doxa.life answers 403 to a script User-Agent (AGENT-BRIEF): send a browser one.
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const posts = (await res.json()).posts || []
    const cc = (p) => (p.country_code && typeof p.country_code === 'object' ? p.country_code.value : p.country_code) || ''
    snapshot = {
      source: 'https://pray.doxa.life/api/people-groups/list',
      fetched: new Date().toISOString().slice(0, 10),
      groups: posts.map((p) => ({ slug: p.slug, rop3: String(p.imb_reg_of_people_3 || ''), country: cc(p) })).sort((a, b) => a.slug.localeCompare(b.slug)),
    }
    writeFileSync(SNAP, JSON.stringify(snapshot, null, 1) + '\n')
  } catch (e) {
    console.warn('DOXA list unreachable (' + e.message + '); using the saved snapshot')
  }
}
if (!snapshot) {
  if (!existsSync(SNAP)) { console.error('no DOXA snapshot and the list is unreachable'); process.exit(1) }
  snapshot = JSON.parse(readFileSync(SNAP, 'utf8'))
}

const byKey = new Map(rows.map((r) => [r.ROP3Code + '|' + r.ISOAlpha3, r]))
const doxaRows = []
let unmatched = 0
for (const g of snapshot.groups) {
  const r = byKey.get(g.rop3 + '|' + g.country)
  if (r) doxaRows.push(r); else unmatched++
}
const unreached = rows.filter(isUnreached)
const frontier = rows.filter(isFrontier)
const captured = rows.map((r) => String(r.CaptureDate || '').slice(0, 10)).filter(Boolean).sort().pop() || ''

const out = {
  sources: {
    imb: { file: 'data/people-groups/people_groups.csv', publisher: 'IMB / peoplegroups.org', captured },
    doxa: { file: 'data/people-groups/doxa-groups-snapshot.json', source: snapshot.source, fetched: snapshot.fetched },
  },
  steps: [
    { id: 'all', groups: rows.length, population: sum(rows) },
    { id: 'unreached', groups: unreached.length, population: sum(unreached) },
    { id: 'frontier', groups: frontier.length, population: sum(frontier) },
    {
      id: 'doxa',
      groups: snapshot.groups.length,
      population: sum(doxaRows),
      frontier: doxaRows.filter(isFrontier).length,
      unreached: doxaRows.filter(isUnreached).length,
      matched: doxaRows.length,
      unmatched,
    },
  ],
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
for (const s of out.steps) console.log(s.id.padEnd(10), String(s.groups).padStart(6), 'groups ·', (s.population / 1e9).toFixed(2), 'bn' + (s.id === 'doxa' ? ` · ${s.frontier} frontier · ${s.unreached} unreached · ${s.unmatched} unmatched` : ''))
