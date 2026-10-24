/**
 * check-gospel-english-leaks.mjs — a translated key must not render in English.
 *
 * THE METHOD, taken from the browser review. A string is a LEAK when the catalogue has a
 * DIFFERENT value for the locale and the page still shows the English one. That is a render
 * or wiring fault, and it is a different thing from an untranslated string, which is a
 * catalogue gap. Only the first is this check's business.
 *
 * WHAT IT DOES NOT COUNT, so the number means something:
 *   - third-party strings, e.g. the Mapbox and geoBoundaries attributions, which are licence
 *     obligations and must never be translated;
 *   - DATA, the people-group and place names that come from the publishers;
 *   - PLACEHOLDER-ONLY strings;
 *   - the explanatory PROSE this bundle deliberately keeps in English, which is declared by
 *     being absent from the catalogue entirely — if there is no translated value, there is
 *     nothing to leak.
 *
 * SCOPE: THE LEAF, AND THAT BOUNDARY IS THE POINT. Six keys were reported leaking in the
 * gallery. Measured here, the standalone leaf is clean in ar, zh, ru and hi — and the
 * gallery's iframe src is built without a lang parameter, so the embedded leaf never learns
 * the locale and correctly falls back to English. That is an embedder defect, not a bundle
 * one, and a check that conflated them would have sent someone to translate strings that are
 * already translated.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveReaped } from './_serve-reaped.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PORT = Number(process.env.PORT || 5399)
const BASE = process.env.BASE_URL || ('http://127.0.0.1:' + PORT)
const LOCALES = (process.env.LOCALES || 'ar,zh,ru,hi').split(',')
const LEAVES = ['resources-map', 'resources-list', 'data-tables', 'charts']
/* The eight values the links table's Type column actually carries. Listed so the positive arm
   asks about the enumerated column and nothing else; it is checked against the data below. */
const TYPE_VALUES = new Set(['Scripture', 'Film', 'Audio Scripture', 'Bible video',
  'Discipleship training', 'Bible Stories', 'Gospel presentation', 'Gospel audio'])

let srv = null
if (!process.env.BASE_URL) srv = serveReaped(resolve(REPO, 'public'), PORT)

const cat = (lc) => JSON.parse(readFileSync(resolve(REPO, 'library/i18n/locales/' + lc + '/gospel.json'), 'utf8'))
const flat = (o, p = []) => Object.entries(o).flatMap(([k, v]) =>
  k.startsWith('_') ? [] : (v && typeof v === 'object' ? flat(v, [...p, k]) : [[[...p, k].join('.'), String(v)]]))

let browser
try {
  browser = await chromium.launch()
  const en = Object.fromEntries(flat(cat('en')))
  const leaks = []
  const unmeasured = []
  let compared = 0

  for (const leaf of LEAVES) {
    for (const lc of LOCALES) {
      const loc = Object.fromEntries(flat(cat(lc)))
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.goto(BASE + `/${TREE_NAME}/gospel-resources/` + leaf + '/index.html?lang=' + lc,
        { waitUntil: 'networkidle', timeout: 90000 })
      await page.waitForTimeout(8000)
      /* ═══ READ ONLY THE CHROME, NOT THE DECLARED-ENGLISH PROSE ═══════════════════════
       * The first version read the whole shadow root and reported 113 leaks, nearly all
       * false: "JESUS Film" and "Scripture" appear inside the explanatory paragraphs this
       * bundle deliberately keeps in English, and three-letter catalogue entries like "for"
       * match inside ordinary English sentences. Both are noise, and a gate that cries 113
       * when 0 are real is worse than none — someone would have gone and "fixed" strings
       * that were already correct.
       * Every English prose block in this bundle declares itself with dir="ltr". So the
       * chrome is everything OUTSIDE those subtrees, which is exactly the population a
       * translated key is supposed to reach. */
      /* ═══ WHOLE LABELS, NOT SUBSTRINGS — the third correction, and the last ═══════════
       * Substring matching over the rendered blob reported keys that were never rendered at
       * all: "Language" matched inside the DATA — the people-group language "Sign Language" —
       * and "Region" inside a region name. Those are exactly the data strings the method
       * excludes, and no amount of length filtering separates a label from a word that
       * happens to sit inside one.
       * So the unit is an ELEMENT'S OWN LABEL: the trimmed text a leaf element renders. A
       * leak is a label that EQUALS the English value when a different translated value
       * exists. That is the same population a translated key is supposed to reach, and a
       * language name can no longer impersonate one. */
      /* ═══ THE ROOT'S dir IS THE LOCALE, NOT A PROSE DECLARATION — fourth correction ═════
       * The rule above ("English prose declares itself with dir=ltr") is right about the
       * PROSE and wrong about the ROOT, and that made this gate blind in every left-to-right
       * locale it was pointed at.
       *
       * The embedded-RTL fix sets direction on the plugin's OWN root element, as it should —
       * dir="rtl" under ar, dir="ltr" under zh, ru, hi and en. So under ar the root was not
       * prose and the walk ran normally; under every other locale the root itself matched the
       * prose test and the ENTIRE leaf was skipped as declared-English.
       *   MEASURED on data-tables: identical DOM in both locales — 1,359 elements walked, 589
       *   carrying their own text. Under ar, 1 element sat in a prose subtree. Under zh, all
       *   1,359 did, and the gate collected nothing.
       *
       * It then reported that silence as "rendered no labels at all", which reads as a product
       * failure. It is not: the zh leaf renders correctly, Chinese title and all — confirmed by
       * screenshot. This gate could only ever see Arabic, and said nothing about it.
       *
       * Prose is always marked INSIDE the leaf (a <p class="gm-note">, a caveat <div>, an
       * explanatory <span>); the root carries the locale's base direction and nothing else. So
       * dir is honoured below the root and ignored on it. */
      const labels = await page.evaluate(() => {
        const sr = document.querySelector('gospel-resources-map')?.shadowRoot
        if (!sr) return []
        const out = new Set()
        /* ═══ SETTLED: ORGANISATION AND PRODUCT NAMES STAY ENGLISH ═══════════════════════
         * Ruled 2026-09-25, not inferred here: proper nouns are published as proper nouns in a
         * localised product, exactly as res.bibleStories (Open Bible Stories, unfoldingWord)
         * and res.scriptureEarth are already exempted in check-i18n-never-translated. Scope of
         * the ruling is the Source column and product names ONLY.
         * It is a VERDICT, not a bookmark — nothing here is waiting on anyone.
         * Note what it does NOT cover: res.jesusFilm still has to render translated where it is
         * used as a resource-type LABEL, and does. The structural rule below is what lets both
         * be true at once — the same words are a name in a Source cell and a label in the
         * chrome, and only the position tells them apart.
         *
         * ═══ A TABLE CELL IS DATA, NOT CHROME — fifth correction ════════════════════════
         * This gate's own heading says it reads the CHROME. Table cells are the data, and
         * judging them produced two false findings that were each a real English string
         * sitting exactly where it belongs:
         *   · Source cells hold ORGANISATION names — "JESUS Film", "Faith Comes By Hearing",
         *     "Door43". Proper nouns; translating them would be the defect.
         *   · Scope cells describe what a resource CONTAINS, and one of the 114 distinct
         *     values is the words "Full Bible". Most of the rest are already in the target
         *     language ("27 parts, Matta to Lwaḥi"), which is what a scope column should be.
         * Whole-label equality was supposed to stop data impersonating a label, and it stops
         * a label impersonating a WORD, which is a different thing. A cell whose entire text
         * equals an English term is indistinguishable from chrome by text alone — so the
         * boundary has to be structural, and the DOM already draws it.
         * The enumerated Type column is still covered, by the positive arm below: it is the
         * one cell column that carries catalogue labels rather than data. */
        const walk = (node, inProse, depth) => {
          for (const child of node.childNodes) {
            if (child.nodeType !== 1) continue
            if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT') continue
            if (child.classList && child.classList.contains('tabulator-cell')) continue
            const declares = depth > 0 && child.getAttribute && child.getAttribute('dir') === 'ltr'
            const prose = inProse || declares
            const own = [...child.childNodes].filter((n) => n.nodeType === 3)
              .map((n) => n.textContent.trim()).filter(Boolean).join(' ').trim()
            if (own && !prose) out.add(own)
            walk(child, prose, depth + 1)
          }
        }
        walk(sr, false, 0)
        return [...out]
      })
      /* ═══ THE TYPE COLUMN, THE ONE CELL COLUMN THAT CARRIES CATALOGUE LABELS ═════════
       * Cells are excluded from the chrome walk above, so Type needs its own arm — it is the
       * only column whose values are labels the catalogue translates rather than data.
       *
       * ⚠ ASKED THE OTHER WAY ROUND FIRST, AND THAT WAS WRONG. Requiring every translated
       * type to be PRESENT failed on res.gospelAudio in all four locales: 1,027 rows carry
       * "Gospel audio" and none of them was on the first page of fifty. The gate was reporting
       * pagination as a translation defect.
       * So it asks the answerable question instead — no cell may equal one of the eight
       * ENUMERATED type strings when a translation exists. A type that is off-screen is
       * silent, which is correct; a type that is on-screen and English fails.
       * Restricted to those eight, which is what makes it safe next to the columns that
       * legitimately hold English: "JESUS Film" and "Full Bible" are a Source name and a Scope
       * description, and neither is one of the eight. */
      const typeCells = await page.evaluate(() => {
        const sr = document.querySelector('gospel-resources-map')?.shadowRoot
        if (!sr) return []
        return [...new Set([...sr.querySelectorAll('.tabulator-cell')].map((c) => c.textContent.trim()))]
      })
      if (leaf === 'data-tables') {
        if (!typeCells.length) unmeasured.push(leaf + ' ' + lc + ': no table cells rendered')
        const seen = new Set(typeCells)
        for (const [k, e] of Object.entries(en)) {
          if (!k.startsWith('res.') || !TYPE_VALUES.has(e)) continue
          const t = loc[k]
          if (!t || t === e) continue
          if (seen.has(e)) leaks.push(leaf + ' ' + lc + ' ' + k + ': the Type column still reads English "' + e + '"')
        }
      }
      await page.close()
      /* Silence is NOT MEASURED, never a leak: it means this gate could not see the leaf, which
         is a different thing from the leaf being wrong. Reporting it as a leak is what sent me
         looking for a rendering bug that did not exist. */
      if (!labels.length) { unmeasured.push(leaf + ' ' + lc + ': the walk collected no labels'); continue }
      const labelSet = new Set(labels)
      /* ═══ AN INTERPOLATED STRING NEVER EQUALS ITS CATALOGUE ENTRY ════════════════════
       * Whole-label equality is the right unit for a fixed label and blind to a sentence
       * carrying a number: the catalogue holds "Across all {n} languages in the corpus." and
       * the screen shows "Across all 5,067 languages in the corpus." Those are never equal, so
       * three chart subtitles could have shipped untranslated in eleven locales with this gate
       * reporting PASS — coverage I would have claimed and not had.
       * So a placeholder becomes a wildcard and the comparison is by pattern. Everything else
       * is still compared by equality, which is what keeps a word inside a sentence from
       * impersonating a label. */
      const PLACEHOLDER = /\{\w+\}/
      const asPattern = (str) => new RegExp('^' + str.split(/\{\w+\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.{1,40}') + '$')
      const someLabelMatches = (str) => {
        const re = asPattern(str)
        for (const l of labelSet) if (re.test(l)) return true
        return false
      }
      for (const [key, e] of Object.entries(en)) {
        const t = loc[key]
        if (!t || t === e) continue
        compared++
        if (PLACEHOLDER.test(e)) {
          if (someLabelMatches(e) && !someLabelMatches(t)) {
            leaks.push(leaf + ' ' + lc + ' ' + key + ': an interpolated label reads English "' + e.slice(0, 40) + '"')
          }
          continue
        }
        if (labelSet.has(e) && !labelSet.has(t)) leaks.push(leaf + ' ' + lc + ' ' + key + ': a label reads English "' + e.slice(0, 40) + '"')
      }
    }
  }

  console.log('  compared ' + compared + ' key/locale pair(s) across ' + LEAVES.length + ' leaves and ' + LOCALES.length + ' locales')
  /* Reported before the verdict and separately from it: a leaf this gate could not read is not
     a leaf that passed, and the two must never be added together. */
  if (unmeasured.length) {
    console.error('GOSPEL-ENGLISH-LEAKS: NOT MEASURED — ' + unmeasured.length + ' leaf/locale pair(s):')
    for (const u of unmeasured) console.error('  ' + u)
  }
  if (leaks.length) {
    /* exitCode, NOT process.exit(). process.exit() terminates before pending stdout/stderr
       writes flush, and this gate proved it on itself: its first real run returned 1 with
       every explanatory line missing, so it failed without saying why. A gate that cannot
       explain its own failure is barely better than no gate. */
    console.error('GOSPEL-ENGLISH-LEAKS: FAIL — ' + leaks.length + ' translated key(s) rendering in English:')
    for (const l of leaks.slice(0, 12)) console.error('  ' + l)
    process.exitCode = 1
  } else if (unmeasured.length) {
    console.error('GOSPEL-ENGLISH-LEAKS: NOT MEASURED — no leak found, but ' + unmeasured.length +
      ' pair(s) were never read, so this is not a pass.')
    process.exitCode = 2
  } else {
    console.log('GOSPEL-ENGLISH-LEAKS: PASS — every key with a translation renders in it, ' +
      'across ' + LEAVES.length + ' leaves and ' + LOCALES.length + ' locales.')
  }
} finally {
  await browser?.close()
  srv?.stop()
}
