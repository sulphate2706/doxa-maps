#!/usr/bin/env node
/**
 * check-vision-card-numbers — the DOXA Vision Card shows the numbers the DATA gives, nothing typed.
 *
 * USAGE:   node internal/check-vision-card-numbers.mjs                (data only, no browser, ~2 s)
 *          node internal/check-vision-card-numbers.mjs --url <card>   (also read the RENDERED card)
 * Exit 0 = every number matches · 1 = a mismatch.
 *
 * INDEPENDENT RECOMPUTATION. It does not import build-vision-funnel.mjs: it re-reads the raw CSV with
 * its own column lookup and re-applies the published rules (HOW-THE-NUMBERS-ARE-COUNTED.md) to the
 * saved DOXA list, then compares with (1) data/people-groups/vision-funnel.json, which the card
 * compiles in, and (2) with --url, the numbers actually painted in the card's bars. A typed-in
 * number, a stale funnel file or a rendering bug each makes it fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const text = readFileSync(resolve(ROOT, 'data/people-groups/people_groups.csv'), 'utf8')

// Own CSV reader: split records on newlines outside quotes, fields on commas outside quotes.
const records = []; { let cur = ''; let q = false; for (const ch of text) { if (ch === '"') q = !q; if (ch === '\n' && !q) { records.push(cur); cur = '' } else cur += ch } if (cur.trim()) records.push(cur) }
const split = (line) => { const out = []; let f = ''; let q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { f += '"'; i++ } else q = !q } else if (c === ',' && !q) { out.push(f); f = '' } else if (c !== '\r') f += c } out.push(f); return out }
const head = split(records[0]).map((h) => h.replace(/^﻿/, ''))
const col = (n) => head.indexOf(n)
const L = col('LostnessPriority'), R3 = col('ROP3Code'), ISO = col('ISOAlpha3')
const data = records.slice(1).map(split).filter((f) => f.length === head.length)
const expect = {
  all: data.length,
  unreached: data.filter((f) => ['0', '1', '2'].includes(f[L])).length,
  frontier: data.filter((f) => f[L] === '0').length,
}
const snap = JSON.parse(readFileSync(resolve(ROOT, 'data/people-groups/doxa-groups-snapshot.json'), 'utf8'))
const lost = new Map(data.map((f) => [f[R3] + '|' + f[ISO], f[L]]))
expect.doxa = snap.groups.length
expect.doxaFrontier = snap.groups.filter((g) => lost.get(g.rop3 + '|' + g.country) === '0').length

const funnel = JSON.parse(readFileSync(resolve(ROOT, 'data/people-groups/vision-funnel.json'), 'utf8'))
const got = Object.fromEntries(funnel.steps.map((s) => [s.id, s.groups]))
got.doxaFrontier = funnel.steps.find((s) => s.id === 'doxa').frontier
const bad = []
for (const k of Object.keys(expect)) {
  const ok = expect[k] === got[k]
  console.log((ok ? 'ok   ' : 'FAIL ') + k.padEnd(13) + ' recomputed ' + String(expect[k]).padStart(6) + '   vision-funnel.json ' + got[k])
  if (!ok) bad.push(k)
}

const i = process.argv.indexOf('--url')
if (i > -1) {
  // Measure THIS build, or measure nothing (exit 75 = NOT MEASURED; see a9550858 / _serves-this-tree.mjs).
  const { requireThisTree } = await import('./_serves-this-tree.mjs')
  await requireThisTree(process.argv[i + 1], ROOT, 'VISION-CARD-NUMBERS')
  const { chromium } = await import('./lib/playwright-guarded.mjs')
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 900, height: 1000 } })
  await p.goto(process.argv[i + 1], { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  const shown = await p.evaluate(() => { const el = document.querySelector('doxa-vision-card'); const r = el && el.shadowRoot; return r ? [...r.querySelectorAll('.vc-n')].map((n) => n.textContent.trim()) : [] })
  const note = await p.evaluate(() => { const r = document.querySelector('doxa-vision-card')?.shadowRoot; return r ? r.querySelector('.vc-step-doxa .vc-note')?.textContent || '' : '' })
  await b.close()
  const want = [expect.all, expect.unreached, expect.frontier, expect.doxa].map((n) => new Intl.NumberFormat('en').format(n))
  const okBars = JSON.stringify(shown) === JSON.stringify(want)
  console.log((okBars ? 'ok   ' : 'FAIL ') + 'rendered bars ' + JSON.stringify(shown) + (okBars ? '' : '  expected ' + JSON.stringify(want)))
  const okNote = note.includes(new Intl.NumberFormat('en').format(expect.doxaFrontier))
  console.log((okNote ? 'ok   ' : 'FAIL ') + 'rendered DOXA note "' + note.trim() + '"')
  if (!okBars) bad.push('rendered bars'); if (!okNote) bad.push('rendered note')
}
console.log(bad.length ? 'VISION-CARD-NUMBERS: FAIL — ' + bad.join(', ') : 'VISION-CARD-NUMBERS: PASS — every number matches the data')
process.exit(bad.length ? 1 : 0)
