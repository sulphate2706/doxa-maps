#!/usr/bin/env node
/**
 * build-lists.mjs — the membership of every people-group LIST, computed from data, never typed.
 *
 *   node library/scripts/people-groups/build-lists.mjs
 *
 * READS   library/lists/lists.json                     the lists, each a FILTER over IMB columns
 *         data/people-groups/people_groups.csv          IMB / peoplegroups.org, one row per group × country
 *         data/people-groups/doxa-groups-snapshot.json  DOXA's list (written by build-vision-funnel.mjs)
 * WRITES  data/people-groups/lists/<id>.json            per non-default list:
 *           { id, label, definition, filter, counts: { imb, doxa }, slugs: [the DOXA slugs in the list] }
 *
 * A DOXA group belongs to a list when its IMB row (matched by ROP3 + country, the join the Vision
 * Card funnel uses) passes the list's filter. `counts.imb` is the whole list as IMB counts it;
 * `counts.doxa` is how many of those DOXA carries: what a Tier A map shows (peopleGroupList.js).
 *
 * FILTER VOCABULARY (all optional, ANDed):
 *   lostness: [0..6]       IMB LostnessPriority (0 Frontier, 1 Pioneer, 2 Expanding Unreached, …)
 *   minPopulation: n       IMB Population >= n
 *   engagement: [..]       IMB EngagementStatus ('Engaged' | 'Unengaged')
 * An unknown key FAILS the run: a filter nobody applies would silently widen the list.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'library/lists/lists.json'), 'utf8'))
const CSV = join(ROOT, 'data/people-groups/people_groups.csv')
const SNAP = join(ROOT, 'data/people-groups/doxa-groups-snapshot.json')
const OUT = join(ROOT, 'data/people-groups/lists')

// Minimal RFC-4180 CSV parser (the same one build-vision-funnel.mjs uses).
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

const KNOWN = new Set(['lostness', 'minPopulation', 'engagement'])
function predicate(filter, id) {
  for (const k of Object.keys(filter || {})) if (!KNOWN.has(k)) { console.error(`list "${id}": unknown filter key "${k}"`); process.exit(1) }
  return (r) =>
    (!filter.lostness || filter.lostness.includes(Number(r.LostnessPriority))) &&
    (!filter.minPopulation || (Number(r.Population) || 0) >= filter.minPopulation) &&
    (!filter.engagement || filter.engagement.includes(r.EngagementStatus))
}

if (!existsSync(SNAP)) { console.error(`no DOXA snapshot at ${SNAP}: run build-vision-funnel.mjs first`); process.exit(1) }
const imb = parseCsv(readFileSync(CSV, 'utf8'))
const snapshot = JSON.parse(readFileSync(SNAP, 'utf8'))
const byKey = new Map(imb.map((r) => [r.ROP3Code + '|' + r.ISOAlpha3, r]))
mkdirSync(OUT, { recursive: true })

for (const l of REGISTRY.lists) {
  if (l.source === 'doxa' && !l.filter) continue          // the default list: every DOXA row, no file
  if (l.source !== 'imb') { console.error(`list "${l.id}": unknown source "${l.source}"`); process.exit(1) }
  const keep = predicate(l.filter, l.id)
  const slugs = snapshot.groups.filter((g) => { const r = byKey.get(g.rop3 + '|' + g.country); return r && keep(r) }).map((g) => g.slug).sort()
  const out = {
    id: l.id, label: l.label, definition: l.definition || '', filter: l.filter,
    sources: { imb: 'data/people-groups/people_groups.csv', doxa: `${snapshot.source} (fetched ${snapshot.fetched})` },
    counts: { imb: imb.filter(keep).length, doxa: slugs.length },
    slugs,
  }
  writeFileSync(join(OUT, `${l.id}.json`), JSON.stringify(out) + '\n')
  console.log(l.id.padEnd(14), String(out.counts.imb).padStart(6), 'in the list ·', String(out.counts.doxa).padStart(5), 'of them DOXA groups')
}
