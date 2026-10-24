#!/usr/bin/env node
/**
 * check-leaf-english-leaks — a translated key must not render in English, on ANY leaf.
 *
 * THE METHOD comes from the browser review and is already proven in
 * check-gospel-english-leaks.mjs. A string is a LEAK when the catalogue has a DIFFERENT value
 * for the locale and the page still shows the English one. That is a render or wiring fault,
 * and it is a different thing from an untranslated string, which is a catalogue gap.
 * Only the first is this check's business.
 *
 * ★ WHY A SECOND FILE RATHER THAN A FOURTH COPY OF THE LOGIC. The gospel gate hardcodes its four
 * leaves, its element tag (`gospel-resources-map`) and its single catalogue file (gospel.json).
 * Pointed at another bundle it finds no shadow root and silently compares nothing. This one takes
 * the leaf, the tag and the locales as arguments and compares against EVERY catalogue area,
 * because a COMPOSITE has no t() calls of its own — its chrome comes from the children it nests,
 * so restricting the comparison to one area would miss most of what it renders.
 *
 * THREE CORRECTIONS CARRIED OVER, each of which cost a false reading in the gospel gate before it
 * was right. They are the reason this is a copy of a method rather than a fresh idea:
 *   1. READ ONLY THE CHROME. Reading the whole shadow root reported 113 leaks, nearly all false:
 *      brand names and short catalogue entries match inside explanatory English prose. Prose
 *      blocks declare themselves with dir="ltr"; the chrome is everything outside them.
 *   2. WHOLE LABELS, NOT SUBSTRINGS. Substring matching reported keys never rendered at all —
 *      "Language" matched inside the DATA ("Sign Language"), "Region" inside a region name. The
 *      unit is an element's OWN trimmed text.
 *   3. A PAGE THAT RENDERED NOTHING IS NOT A CLEAN PAGE. Zero labels is reported, never passed.
 *
 * ⚠ AND ONE ADDED HERE: a locale with NOTHING to leak cannot prove anything. If no catalogue
 * value for a locale differs from English among the labels actually on the page, the comparison
 * is vacuous and says so, rather than counting as a clean result.
 *
 * Usage:
 *   node internal/check-leaf-english-leaks.mjs <bundle>/<leaf>:<tag> [more...]
 *   LOCALES=ar,zh,ru,hi  BASE_URL=http://127.0.0.1:4173
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const LOCALES = (process.env.LOCALES || 'ar,zh,ru,hi').split(',').map((s) => s.trim()).filter(Boolean)
// ★ --self-test PROVES THE EXCLUSIONS DO NOT BLIND THE GATE.
// The numeric-sibling rule is GENERAL: "an element whose own text sits beside a sibling rendering
// a number is enumerating data". A general exclusion can go green by excluding too much, which is
// the same failure as never checking — and this one shipped before it was ever confirmed by a run.
// So the self-test INJECTS a real chrome leak in the exact position the rule is most likely to
// swallow: an English catalogue value in a label that HAS a numeric sibling, plus one with no
// numeric sibling as a control. The first MUST still be caught; if it is not, the rule is too
// broad and the gate is lying.
const SELF_TEST = process.argv.includes('--self-test')

// <bundle>/<leaf>:<custom-element-tag>
// ⚠ FILTER THE FLAGS OUT. Every non-flag argv is a target, so `--self-test` was consumed as a
// leaf path and all four locales reported HTTP 404 — the NOT MEASURED guard caught it instead of
// reporting a clean run over nothing, which is exactly what that guard is for.
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const TARGETS = (ARGS.length ? ARGS : [
  'dashboard-plus-grid/dashboard-plus-grid:dashboard-plus-grid',
  'research-map-plus-grid/research-map-plus-grid:research-map-plus-grid',
]).map((s) => {
  const [path, tag] = s.split(':')
  return { path, tag: tag || path.split('/').pop() }
})

const LOC_DIR = resolve(REPO, 'library/i18n/locales')
const flat = (o, p = []) => Object.entries(o).flatMap(([k, v]) =>
  k.startsWith('_') ? [] : (v && typeof v === 'object' ? flat(v, [...p, k]) : [[[...p, k].join('.'), String(v)]]))
// EVERY area, not one file — a composite's chrome comes from the children it nests.
const catalogue = (lc) => {
  const dir = join(LOC_DIR, lc)
  if (!existsSync(dir)) return {}
  const out = {}
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try { Object.assign(out, Object.fromEntries(flat(JSON.parse(readFileSync(join(dir, f), 'utf8')))
      .map(([k, v]) => [f.replace(/\.json$/, '') + '.' + k, v]))) } catch { /* unreadable area */ }
  }
  return out
}

let reachable = false
try { const r = await fetch(`${BASE}/${TREE_NAME}/manifest.json`, { signal: AbortSignal.timeout(4000) }); reachable = r.ok } catch { /* precondition */ }
if (!reachable) { console.log(`LEAF-ENGLISH-LEAKS: SKIP — nothing served at ${BASE}.`); process.exit(0) }
const treeCheck = await servesThisTree(BASE, REPO)
if (!treeCheck.ok) { console.error(`LEAF-ENGLISH-LEAKS: NOT MEASURED — ${treeCheck.why}`); process.exit(2) }
console.log('LEAF-ENGLISH-LEAKS')
console.log(`  tree identity: OK (served manifest matches this checkout)`)

const en = catalogue('en')
// A value that IS translated in every locale, so it is a genuine leak when it renders in English.
// Chosen from the catalogue rather than invented, so the self-test exercises the same comparison
// the real run does.
const SELF_TEST_KEY = 'buttons.prayerList'
const SELF_TEST_VALUE = en[SELF_TEST_KEY] || 'Prayer List'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const rows = []
const fails = []

for (const t of TARGETS) {
  for (const lc of LOCALES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 110)))
    let labels = []
    try {
      const res = await page.goto(`${BASE}/${TREE_NAME}/${t.path}/index.html?lang=${lc}`,
        { waitUntil: 'load', timeout: 60000 })
      if (!res || !res.ok()) { rows.push({ t: t.path, lc, skipped: `HTTP ${res ? res.status() : '?'}` }); await page.close(); continue }
      await page.waitForTimeout(16000)
      if (SELF_TEST) {
        await page.evaluate(([tag, enVal]) => {
          const host = document.querySelector(tag)
          const sr = host && host.shadowRoot
          if (!sr) return
          const mk = (withNumber) => {
            const row = document.createElement('div')
            const lbl = document.createElement('span')
            lbl.textContent = enVal
            row.appendChild(lbl)
            if (withNumber) { const n = document.createElement('b'); n.textContent = '1,234'; row.appendChild(n) }
            sr.appendChild(row)
          }
          mk(true)   // the hard case: a leak sitting beside a count
          mk(false)  // control: a leak with no numeric sibling
        }, [t.tag, SELF_TEST_VALUE])
      }
      labels = await page.evaluate((tag) => {
        const host = document.querySelector(tag)
        const sr = host && host.shadowRoot
        if (!sr) return []
        const out = new Set()
        const walk = (node, excluded) => {
          for (const child of node.childNodes) {
            if (child.nodeType !== 1) continue
            if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT') continue
            // ⚠ DATA CELLS ARE NOT CHROME, and this cost a false finding before it was here.
            // The first run reported 3 "leaks" x 4 locales on dashboard-plus-grid: "Unengaged"
            // and "Other". Both ARE translated in every catalogue, so they looked like textbook
            // wiring faults — until the hits turned out to sit in .rd-td inside .rd-grid, i.e.
            // TABLE DATA. people-groups-grid.vue:150 records the field as
            // {value:'unengaged', label:'Unengaged'}, 2 distinct values, 100% populated, and
            // dashboard.config.js:132 counts 2,081 Unengaged / 27 Engaged. They are API VALUES
            // that happen to equal a catalogue string.
            // That is the population the method excludes by name ("DATA, the people-group and
            // place names that come from the publishers"). Whole-label matching stops a substring
            // impersonating a label; it cannot stop a DATA CELL rendering the same text. So the
            // table body is excluded by ROLE, the way prose already is.
            const cls = (child.className && typeof child.className === 'string') ? child.className : ''
            const isData = /\b(rd-td|rd-row|rd-grid|rd-cell|pg-cell|cell-value)\b/.test(cls)
              || child.getAttribute?.('role') === 'cell' || child.tagName === 'TD'
            // ⚠ A FACET VALUE IS DATA WEARING A LABEL'S CLOTHES — the second false finding, and
            // subtler than the table cells. `regions.Other` was reported leaking in all four
            // locales from span.fr-lbl in the facet rail. But that template is
            // `<span class="fr-lbl">{{ r.label }}</span>` with `{{ r.count }}` beside it, and the
            // component's own comment calls it "the 'Other' bucket": the string comes from the
            // ROW DATA, not from t('regions.Other'). Whether that bucket ought to be localised is
            // a real product question, but it is NOT "a translated key rendering in English".
            // EXCLUDED BY THE COUNT, NOT BY THE CLASS: a rail row that reports a tally is
            // enumerating data. Excluding .fr-lbl wholesale would also blind this to the rail's
            // own section headings, which ARE chrome and SHOULD be caught.
            // ⚠ AND THE SAME SHAPE APPEARS IN THE CHART LEGEND AND THE BAR LABELS — the third
            // false finding, which is why this is now a RULE rather than a third special case.
            // Tracing the gate's own walk (rather than re-scanning the page, which kept showing
            // me the facet hits I had already excluded) found the survivors in .rd-lt inside
            // .rd-li and .rd-bl inside .rd-bar. DashboardChartsRail.vue renders
            // `<span class="rd-lt">{{ s.key }}</span><b>{{ s.value }}</b>` over chart.geometry:
            // a DATA KEY beside its VALUE, exactly like the facet rail's label beside its count.
            //
            // THE GENERAL RULE: an element whose own text sits beside a sibling rendering a
            // NUMBER is enumerating data, not naming the UI. A legend entry, a facet row and a
            // bar label are all the same thing wearing different class names, and chasing them
            // one class at a time is how I got this wrong three times.
            // Section headings and column titles have no numeric sibling, so they stay in scope.
            const numericSibling = (() => {
              const sibs = child.parentElement ? [...child.parentElement.children] : []
              return sibs.some((s) => s !== child
                && /^[\d,.\s%]+$/.test((s.textContent || '').trim())
                && (s.textContent || '').trim().length > 0)
            })()
            const isEnumeratedValue = numericSibling
            const skip = excluded || isData || isEnumeratedValue
              || (child.getAttribute && child.getAttribute('dir') === 'ltr')
            const own = [...child.childNodes].filter((n) => n.nodeType === 3)
              .map((n) => n.textContent.trim()).filter(Boolean).join(' ').trim()
            if (own && !skip) out.add(own)
            // Cross nested shadow roots too: a composite's chrome lives inside its children.
            if (child.shadowRoot) walk(child.shadowRoot, skip)
            walk(child, skip)
          }
        }
        walk(sr, false)
        return [...out]
      }, t.tag)
    } catch (e) {
      rows.push({ t: t.path, lc, skipped: String(e.message || e).slice(0, 60) })
      await page.close(); continue
    }
    await page.close()

    if (!labels.length) { fails.push(`${t.path} ${lc}: rendered no labels at all — nothing was measured`); rows.push({ t: t.path, lc, labels: 0 }); continue }
    const loc = catalogue(lc)
    const labelSet = new Set(labels)
    const leaks = []
    let comparable = 0
    for (const [key, e] of Object.entries(en)) {
      const tr = loc[key]
      if (tr === undefined || tr === e) continue      // no translated value -> nothing to leak
      if (!labelSet.has(e) && !labelSet.has(tr)) continue // this key is not on the page at all
      comparable++
      if (labelSet.has(e) && !labelSet.has(tr)) leaks.push(`${key} reads English "${e.slice(0, 38)}"`)
    }
    rows.push({ t: t.path, lc, labels: labels.length, comparable, leaks: leaks.length, errs: errs.length })
    // ⚠ A LOCALE WITH NOTHING COMPARABLE PROVES NOTHING. Saying "0 leaks" over an empty
    // comparison set is the same failure as passing a page that rendered nothing.
    if (!comparable) { fails.push(`${t.path} ${lc}: 0 comparable keys on the page — the comparison is vacuous, not clean`); continue }
    for (const l of leaks) fails.push(`${t.path} ${lc}: ${l}`)
    if (errs.length) fails.push(`${t.path} ${lc}: ${errs.length} page error(s) — ${errs[0]}`)
  }
}
await browser.close()

for (const r of rows) {
  if (r.skipped) { console.log(`  ${r.t} @ ${r.lc}  SKIP — ${r.skipped}`); continue }
  console.log(`  ${r.t} @ ${r.lc}  labels ${r.labels} · comparable ${r.comparable ?? 0} · `
    + `${r.leaks ? `LEAKS ${r.leaks}` : 'no leaks'} · ${r.errs ?? 0} error(s)`)
}
// ── SELF-TEST VERDICT ───────────────────────────────────────────────────────
// Inverted on purpose: here a CAUGHT leak is the pass. Two were injected per leaf x locale — one
// beside a number (the case the numeric-sibling rule could swallow) and one without (the control).
// Both must be caught. Catching only the control would mean the rule is too broad and every real
// leak that happens to sit beside a count is invisible.
if (SELF_TEST) {
  const caught = fails.filter((f) => f.includes(SELF_TEST_KEY)).length
  const expected = rows.filter((r) => !r.skipped).length
  console.log(`\nSELF-TEST: injected 2 leaks per combination (one beside a number, one not).`)
  console.log(`  combinations measured : ${expected}`)
  console.log(`  ${SELF_TEST_KEY} caught: ${caught}`)
  if (!expected) { console.error('SELF-TEST: NOT MEASURED — no combination rendered.'); process.exit(2) }
  if (caught < expected) {
    console.error(`\nSELF-TEST: FAIL — the gate missed the injected leak in `
      + `${expected - caught} of ${expected} combination(s). An exclusion is too broad: a real leak`)
    console.error('  beside a count would be invisible. Narrow the rule rather than shipping it.')
    process.exit(1)
  }
  console.log(`\nSELF-TEST: PASS — every injected leak was caught, including the one beside a `
    + 'number, so the data/facet/enumerated exclusions narrow the population without blinding it.')
  process.exit(0)
}

if (fails.length) {
  console.error(`\nLEAF-ENGLISH-LEAKS: FAIL — ${fails.length} problem(s)`)
  for (const f of fails.slice(0, 20)) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\nLEAF-ENGLISH-LEAKS: PASS — ${rows.filter((r) => !r.skipped).length} leaf x locale `
  + `combination(s) in ${LOCALES.join('/')}; every translated key that reaches the page renders translated.`)
