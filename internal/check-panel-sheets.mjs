#!/usr/bin/env node
/**
 * check-panel-sheets — the shared panel geometry (library/components/poster/panelSheets.js). Headless.
 *
 * A poster too big for one sheet prints as several sheets, each trimmed edge laid over the next sheet's
 * join band. This pins:
 *   A. the two multi-sheet sizes: 60x96 = 3 × 60×36 stacked, 6 in joins (the Bless 5 × 8 ft poster);
 *      66x66 = 2 × 36×66 side by side, 6 in join (India); and a single sheet has no join;
 *   B. the sheets TILE the finished poster: what each sheet shows (itself minus the band the sheet before
 *      covers) covers every inch once, no gap, no double;
 *   C. sliceFor: with 'glue' the slices tile the poster; with 'bleed' neighbours repeat exactly joinIn;
 *   D. the print marks: a 'glue' join prints the red band; a 'bleed' join prints only a guide (a solid band
 *      would show through a misaligned trim); a screen preview always draws the red band; the trim line is on
 *      every sheet but the last; every sheet has its "s / N" tag;
 *   E. the Bless poster takes its sheets, bands and marks from this module (no private copy to drift): its
 *      5x8ft content bands equal the panels' content boxes, and blessPoster.js carries no glue band of its own.
 * Two-sided: each arm runs against a planted defect and must fail.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const real = await import(pathToFileURL(join(ROOT, 'library/components/poster/panelSheets.js')).href)
const bless = await import(pathToFileURL(join(ROOT, 'plugin-designs/wall-of-people-groups/src/blessPoster.js')).href)
const blessSrc = readFileSync(join(ROOT, 'plugin-designs/wall-of-people-groups/src/blessPoster.js'), 'utf8')
const eq = (a, b) => Math.abs(a - b) < 1e-9

const SIZES = {
  '60x96': { sheetW: 60, sheetH: 36, count: 3, direction: 'vertical', joinIn: 6, want: { w: 60, h: 96, at: [0, 30, 60] } },
  '66x66': { sheetW: 36, sheetH: 66, count: 2, direction: 'horizontal', joinIn: 6, want: { w: 66, h: 66, at: [0, 30] } },
  '36x36': { sheetW: 36, sheetH: 36, count: 1, direction: 'vertical', joinIn: 0, want: { w: 36, h: 36, at: [0] } },
}

function run(M) {
  const errs = []
  let checked = 0
  for (const [key, z] of Object.entries(SIZES)) {
    for (const joinFill of ['glue', 'bleed']) {
      const P = M.planPanels({ ...z, borderIn: 2, joinFill })
      const V = P.direction === 'vertical', along = V ? P.sheetH : P.sheetW, total = V ? P.finished.h : P.finished.w
      // A. geometry
      if (!eq(P.finished.w, z.want.w) || !eq(P.finished.h, z.want.h)) errs.push(`A ${key}: finished ${P.finished.w} × ${P.finished.h}, want ${z.want.w} × ${z.want.h}`)
      if (P.sheets.length !== z.count) errs.push(`A ${key}: ${P.sheets.length} sheets, want ${z.count}`)
      P.sheets.forEach((sh, s) => {
        const off = V ? sh.at.y : sh.at.x
        if (!eq(off, z.want.at[s])) errs.push(`A ${key}: sheet ${s + 1} starts at ${off} in, want ${z.want.at[s]}`)
        if ((s > 0) !== !!sh.band) errs.push(`A ${key}: sheet ${s + 1} ${sh.band ? 'has' : 'lacks'} a join band`)
        if (sh.band && !eq(V ? sh.band.h : sh.band.w, z.joinIn)) errs.push(`A ${key}: sheet ${s + 1}'s band is not ${z.joinIn} in deep`)
        if (sh.trimmed !== (s < z.count - 1)) errs.push(`A ${key}: sheet ${s + 1} trimmed=${sh.trimmed}`)
        const c = sh.content, lead = V ? c.y0 : c.x0, trail = along - (V ? c.y1 : c.x1)
        if (!eq(lead, s === 0 ? 2 : z.joinIn) || !eq(trail, s === z.count - 1 ? 2 : 0)) errs.push(`A ${key}: sheet ${s + 1}'s content box leaves ${lead} / ${trail} in`)
      })
      // B. the visible parts tile the finished poster (1/8 in samples)
      const hits = new Array(Math.round(total * 8)).fill(0)
      P.sheets.forEach((sh, s) => {
        const off = V ? sh.at.y : sh.at.x, from = off + (sh.band ? P.joinIn : 0), to = off + along
        for (let k = 0; k < hits.length; k++) { const t = (k + 0.5) / 8; if (t >= from && t < to) hits[k]++ }
      })
      const bad = hits.findIndex((h) => h !== 1)
      if (bad >= 0) errs.push(`B ${key}: at ${(bad + 0.5) / 8} in the poster is shown by ${hits[bad]} sheets, not 1`)
      // C. slices
      const sl = P.sheets.map((_, s) => M.sliceFor(P, s))
      for (let s = 1; s < sl.length; s++) {
        const endPrev = V ? sl[s - 1].y + sl[s - 1].h : sl[s - 1].x + sl[s - 1].w, start = V ? sl[s].y : sl[s].x
        const want = joinFill === 'bleed' ? endPrev - z.joinIn : endPrev
        if (!eq(start, want)) errs.push(`C ${key} ${joinFill}: slice ${s + 1} starts at ${start} in, want ${want}`)
      }
      const last = sl[sl.length - 1]
      if (!eq(V ? last.y + last.h : last.x + last.w, total) || !eq(V ? sl[0].y : sl[0].x, 0)) errs.push(`C ${key} ${joinFill}: the slices do not span the poster`)
      // D. marks
      P.sheets.forEach((sh, s) => {
        const pr = M.panelChromeHtml(P, s, {}), sc = M.panelChromeHtml(P, s, { screen: true })
        const solid = /class="glue[ "]/.test(pr.before), guide = /class="glue-guide/.test(pr.before)
        if (sh.band && joinFill === 'glue' && !solid) errs.push(`D ${key}: a glue join does not print its red band`)
        if (sh.band && joinFill === 'bleed' && (solid || !guide)) errs.push(`D ${key}: a bleed join prints ${solid ? 'a solid band' : 'no guide'}`)
        if (sh.band && !/class="glue[ "]/.test(sc.before)) errs.push(`D ${key}: the screen preview does not draw the red band`)
        if (!sh.band && (pr.before || sc.before)) errs.push(`D ${key}: sheet 1 draws a join band`)
        if (/class="trim/.test(pr.after) !== sh.trimmed) errs.push(`D ${key}: sheet ${s + 1}'s trim line is wrong`)
        if (!pr.after.includes(`>${s + 1} / ${z.count}<`)) errs.push(`D ${key}: sheet ${s + 1} has no "${s + 1} / ${z.count}" tag`)
      })
      checked++
    }
  }
  return { errs, checked }
}

const fails = []
const r = run(real)
fails.push(...r.errs)
if (r.checked < 6) fails.push(`only ${r.checked} of 6 size × fill cases ran`)
// E. the Bless consumer
const plan = bless.planPoster('5x8ft', 2107)
const P = real.planPanels({ sheetW: 60, sheetH: 36, count: 3, direction: 'vertical', joinIn: 6, borderIn: 6, joinFill: 'glue' })
plan.bands.forEach((bd, s) => {
  const c = P.sheets[s].content
  if (!eq(bd.y0 - (s === 0 ? plan.bannerH : 0), c.y0) || !eq(bd.y1 + (s === 2 ? plan.footerH + (plan.gapH || 0) : 0), c.y1)) fails.push(`E: Bless 5x8ft sheet ${s + 1}'s band is not the panels' content box`)
})
if (!eq(plan.posterW, P.finished.w) || !eq(plan.posterH, P.finished.h)) fails.push('E: the Bless poster\'s finished size is not the panels\'')
if (!/from '[./]+library\/components\/poster\/panelSheets\.js'/.test(blessSrc)) fails.push('E: blessPoster.js does not import panelSheets.js')
if (/class="glue"/.test(blessSrc) || /\.glue\{/.test(blessSrc)) fails.push('E: blessPoster.js carries its own glue band (a private copy to drift)')
if (!/class="glue"/.test(bless.buildBlessPosterHtml(Array.from({ length: 50 }, () => ({ name: 'x' })), '5x8ft', {}))) fails.push('E: the Bless 5x8ft print has no glue band')

// Two-sided: each arm against a planted defect.
const planted = {
  'A/B (the joins not subtracted)': { ...real, planPanels: (o) => { const p = real.planPanels(o); const V = p.direction === 'vertical'; return { ...p, finished: V ? { w: p.sheetW, h: p.count * p.sheetH } : { w: p.count * p.sheetW, h: p.sheetH } } } },
  'C (a glue slice keeps the band)': { ...real, sliceFor: (p, s) => real.sliceFor({ ...p, joinFill: 'bleed' }, s) },
  'D (a bleed join prints a solid band)': { ...real, panelChromeHtml: (p, s, o = {}) => real.panelChromeHtml(p, s, { ...o, screen: true }) },
  'D (no trim line)': { ...real, panelChromeHtml: (p, s, o) => { const h = real.panelChromeHtml(p, s, o); return { ...h, after: h.after.replace(/<div class="trim[^>]*><\/div>/, '') } } },
}
for (const [name, M] of Object.entries(planted)) {
  const want = name[0]
  if (!run(M).errs.some((e) => e.startsWith(want) || (want === 'A' && e.startsWith('B')))) fails.push(`SELF-TEST: the planted defect "${name}" was not caught`)
}

if (fails.length) { console.log('PANEL-SHEETS: FAIL'); for (const f of fails) console.log('  - ' + f); process.exitCode = 1 }
else console.log(`PANEL-SHEETS: PASS — ${r.checked} size × fill cases (60x96 stacked, 66x66 side by side, one sheet; glue and bleed): the sheets tile the finished poster, the slices tile or repeat exactly the join, the marks follow the fill, and the Bless 5x8ft takes its bands and marks from panelSheets.js; ${Object.keys(planted).length} planted defects caught.`)
