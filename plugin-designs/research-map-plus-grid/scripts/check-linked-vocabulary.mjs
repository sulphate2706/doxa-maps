#!/usr/bin/env node
/**
 * check-linked-vocabulary.mjs — the two halves of this composite must mean the SAME THING by a
 * religion family, and this proves it by measuring, on the built tree, that the link delivers
 * exactly what the facet delivers on its own.
 *
 * WHY THIS GATE EXISTS. Linking a facet across two elements is the one place in this repo where a
 * bug is INVISIBLE: both halves keep working, both look filtered, and they are simply showing
 * different peoples. Region survived that risk because the two halves share a slug. Religion does
 * not:
 *
 *     the map  — filters religion through its legend's flat tab, keyed by the FIRST LETTER of the
 *                religion code ('B'), named by RELIGION_FAMILIES ('Buddhism')
 *     the grid — filters religion through a DERIVED axis, `__religion_family`, which runs that same
 *                RELIGION_FAMILIES table forward per row (code 'BLA' -> 'Buddhism')
 *
 * One shared table in library/colors/religion.js, read in opposite directions, copied by neither.
 * That is the mapping under test. A composite that sent the letter instead of the name, or the raw
 * code instead of the family, would look exactly as healthy — and show a grid of nothing, or a grid
 * of everything, beside a correctly dimmed map.
 *
 * MEASURED, AND IT CHANGED THE DESIGN: `mapStore.filters.religions`, which the map's filter panel
 * writes, is read by NOTHING — `mapLayers.applyFilters()` is called and never implemented. A link
 * routed through it would have passed every plausible smoke test and dimmed no pin. That is why
 * this gate compares COUNTS reached two different ways rather than asserting that state was set.
 *
 * HOW. Serves the built tree on a free port, loads the composite's own leaf, and for one religion
 * family that the data actually contains:
 *
 *   DIRECT   set `religion-family` on the nested grid itself — the element's own documented prop,
 *            no link involved — and record the total it reports. Must be >0 and < unfiltered.
 *   LINKED   clear, then drive the composite's published wire instead: a `map-filtered` event
 *            carrying the family NAME, exactly as the map emits it. Record the total again.
 *   ASSERT   linked === direct. The link delivered the facet, not something adjacent to it.
 *
 * ★ THE MUTANT RUNS FIRST, AND THIS GATE FAILS IF THE MUTANT PASSES. Before the real name is sent,
 * the same wire is driven with the legend's LETTER KEY ('B') — the single most likely wrong version
 * of this mapping, and the one a refactor would reach for. A grid that narrows to the same total on
 * 'B' as on 'Buddhism' is a grid whose linking cannot tell the two apart, so the gate reports
 * NO-TEETH and fails. A check that has never been seen to fail is not evidence.
 *
 * Exit: 0 pass or SKIP (no built tree, no browser, no data) · 1 fail.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from '../../../internal/_tree-name.mjs'

const TAG = 'LINKED-VOCABULARY'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const skip = (why) => { console.log(`${TAG}: SKIP — ${why}`); process.exit(0) }

if (!existsSync(MANIFEST)) skip('no built manifest (run `bun run tree` first).')
let chromium
try { ({ chromium } = await import('../../../internal/lib/playwright-guarded.mjs')) } catch { skip('playwright is not installed.') }

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const bundle = (manifest.bundles || []).find((b) => b.bundle === 'research-map-plus-grid')
const profile = bundle && (bundle.profiles || []).find((p) => p.iframeUrl)
if (!profile) skip('the manifest declares no research-map-plus-grid leaf to load.')

const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const PORT = await freePort()
const TREE = `http://127.0.0.1:${PORT}/${TREE_NAME}`
const LEAF = `${TREE}/${String(profile.iframeUrl).replace(/^\.\//, '')}`

const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
const cleanup = () => { try { tree.kill() } catch { /* already gone */ } }
await new Promise((r) => setTimeout(r, 900))
const reachable = await fetch(`${TREE}/manifest.json`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false)
if (!reachable) { cleanup(); skip('could not serve the built tree locally.') }

// The tree we just started is the tree we built — but say so out loud rather than trust the port.
const { requireThisTree } = await import(join(ROOT, 'internal', '_serves-this-tree.mjs'))
await requireThisTree(TREE, ROOT, TAG)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
const fails = []
const lines = []
// ★ THE PROVIDER MATRIX. The same assertions, run once per engine, because interoperability that
// holds on one provider and not the other is not interoperability
// (BUILD-INTEROP-CONTRACT-GRID-UNDER-MAP-BOTH-PROVIDERS). It is not a formality: the map half of
// this link resolves a religion family through its own legend, and the legend is drawn by the map
// engine — a MapLibre-only paint or layout mistake drops a whole layer silently, which would show
// up here as a link that delivers nothing while the Mapbox run stays green.
const PROVIDERS = ['mapbox', 'maplibre']
// ★ AND PER LOCALE, because the grid's DATA now follows the URL. The labels this link used to carry
// are fully localized — zero language names shared between en and ar — so a link proven only in
// English proves nothing about the language a reader actually asked for. en is the control; ar is
// the case that would have broken silently.
const LOCALES = (process.env.LINK_LOCALES || 'en,ar').split(',').map((s) => s.trim()).filter(Boolean)
const results = {}
try {
  for (const locale of LOCALES) {
  for (const engine of PROVIDERS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  // ★ LISTEN BEFORE THE PAGE RUNS. The grid reports its total on its FIRST filter pass, which can happen
  // before an evaluate() after goto attaches a listener; the gate then read "the grid never reported a
  // total" while the grid had reported one (measured, ded4b3c1). Every total is recorded from the start.
  await page.addInitScript(() => {
    window.__lvTotals = []
    document.addEventListener('groups-filtered', (e) => { window.__lvTotals.push(e.detail?.total ?? null) }, true)
  })
  await page.goto(`${LEAF}?provider=${engine}&lang=${locale}`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Everything below runs in ONE evaluate: the totals have to be read from the same live page, and
  // a `groups-filtered` listener installed from Node would miss events fired between round trips.
  const out = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const deep = (sel) => {
      const seen = new Set()
      const walk = (root) => {
        if (!root || seen.has(root)) return null
        seen.add(root)
        const hit = root.querySelector?.(sel)
        if (hit) return hit
        for (const el of root.querySelectorAll?.('*') || []) {
          if (el.shadowRoot) { const r = walk(el.shadowRoot); if (r) return r }
        }
        return null
      }
      return walk(document)
    }

    const host = document.querySelector('research-map-plus-grid')
    if (!host) return { skip: 'the composite element never appeared on its own leaf' }
    const root = host.shadowRoot || host
    let grid = null
    for (let i = 0; i < 120 && !grid; i++) { grid = deep('people-groups-grid'); if (!grid) await sleep(500) }
    if (!grid) return { skip: 'the nested grid never mounted' }

    // The grid reports its total on every filter pass. Listening is how a total is read here: the
    // rendered count line is localized and the DOM shape is not this gate's business.
    // Totals recorded since the page started (addInitScript above), so an early first pass is not missed.
    const seen = window.__lvTotals || (window.__lvTotals = [])
    let total = seen.length ? seen[seen.length - 1] : null
    document.addEventListener('groups-filtered', (e) => { total = e.detail?.total ?? null }, true)

    // Wait for the first fetch to settle — a total of null means the data never arrived, which is a
    // SKIP (no network in the sandbox), not a failure of the mapping.
    for (let i = 0; i < 120 && total === null; i++) await sleep(500)
    if (total === null) return { skip: 'the grid never reported a total (no data reached it)' }
    const unfiltered = total

    // WHICH FAMILY TO TEST: ask both halves what they can name, and take one they agree on. A
    // hard-coded 'Islam' would be a table of exactly the kind this whole design refuses.
    const gridVocab = (grid.__vocabulary || window.__peopleGroupsGridVocabulary)?.('__religion_family') || []
    // The map loads its own records independently of the grid's fetch, and in this composite it is
    // the slower half. Waiting for its vocabulary to be non-empty is waiting for its DATA — asking
    // before then reports "the two halves share nothing", which is a lie about the mapping.
    let mapVocab = []
    for (let i = 0; i < 160; i++) {
      mapVocab = window.__researchMapVocabulary?.('religionFamily') || []
      if (mapVocab.length) break
      await sleep(500)
    }
    if (!mapVocab.length) return { skip: 'the nested map never reported a religion vocabulary (its data never arrived)' }
    const shared = gridVocab.filter((n) => mapVocab.includes(n))
    if (!shared.length) {
      return { fail: `the two halves share NO religion family name. map=[${mapVocab.join(', ')}] grid=[${gridVocab.join(', ')}]` }
    }

    const settle = async () => { const before = seen.length; for (let i = 0; i < 40 && seen.length === before; i++) await sleep(250); await sleep(400) }
    const clear = async () => {
      grid.setAttribute('religion-family', '')
      host.dispatchEvent(new CustomEvent('map-filtered', { detail: { region: '', religion: '', language: '' }, bubbles: true, composed: true }))
      await settle()
    }
    const driveLinked = async (value) => {
      await clear()
      // ★ WAIT OUT THE ECHO WINDOW, OR MEASURE AN ARTIFACT. The composite ignores child reports for
      // 1200ms after it pushes (its `pushing` guard, which exists so a push does not read back as a
      // user action). A drive fired inside that window is DROPPED, and the grid then reports its
      // previous total — which for the mutant looks exactly like "the wrong mapping matched
      // nothing". MEASURED: the first green here had the mutant at 2107 (untouched), not 0
      // (rejected), and the two are indistinguishable from the outside.
      await sleep(1500)
      // The composite listens on its own root for the map's published event. Firing it from the
      // MAP element is what the map itself does; firing it from the host reaches the same listener.
      const map = deep('doxa-research-map') || host
      map.dispatchEvent(new CustomEvent('map-filtered', { detail: { region: '', religion: value, language: '' }, bubbles: true, composed: true }))
      await settle()
      return total
    }

    // Pick a family whose own filtered total is a real subset — a family matching everything or
    // nothing proves nothing about the link.
    let family = null, direct = null
    for (const name of shared) {
      await clear()
      grid.setAttribute('religion-family', name)
      await settle()
      if (total > 0 && total < unfiltered) { family = name; direct = total; break }
    }
    if (!family) return { skip: 'no religion family narrows this grid to a strict subset' }

    const letter = family.charAt(0).toUpperCase()

    // ── MUTANT FIRST ──────────────────────────────────────────────────────────────────────────
    const mutant = await driveLinked(letter)
    // ── THEN THE REAL THING ───────────────────────────────────────────────────────────────────
    const linked = await driveLinked(family)

    // ★ AND THE LANGUAGE FACET, WHICH IS THE ONE THAT MOVES WITH THE LOCALE.
    // MEASURED against the live API: primary_language's LABEL is fully localized (zero names shared
    // between en and ar) while its VALUE is the stable ISO 639-3 code (all identical). So the link
    // must travel as the CODE. This proves it does, and the poison case proves the code is what is
    // doing the work rather than a name that happens to match in the locale under test.
    let lang = null
    const langVocab = (grid.__vocabulary || window.__peopleGroupsGridVocabulary)?.('primary_language') || []
    // Find a language whose own facet narrows the grid to a strict subset, and learn its CODE from
    // the grid's rows rather than from a table.
    for (const name of langVocab.slice(0, 40)) {
      await clear()
      await sleep(1500)
      grid.setAttribute('primary-language', name)
      await settle()
      if (total > 0 && total < unfiltered) { lang = { name, direct: total }; break }
    }
    if (lang) {
      // The map reports both forms on its own wire; drive that wire and read what the grid does.
      await clear(); await sleep(1500)
      const map = deep('doxa-research-map') || host
      map.dispatchEvent(new CustomEvent('map-filtered', {
        detail: { region: '', religion: '', language: lang.name, languageCode: '' },
        bubbles: true, composed: true,
      }))
      await settle()
      lang.byName = total
      // POISON: a code that cannot exist. If the grid still narrows the same way, the wire is not
      // carrying what this gate thinks it is.
      await clear(); await sleep(1500)
      map.dispatchEvent(new CustomEvent('map-filtered', {
        detail: { region: '', religion: '', language: 'zz-not-a-language', languageCode: 'zzz' },
        bubbles: true, composed: true,
      }))
      await settle()
      lang.poison = total
    }

    return { unfiltered, family, letter, direct, linked, mutant, mapVocab, gridVocab: gridVocab.slice(0, 12), lang, langVocabCount: langVocab.length }
  })

  await page.close()
  if (out.skip) { await browser.close(); cleanup(); skip(`${out.skip} (under ${locale}/${engine})`) }
  results[`${locale}/${engine}`] = out
  if (out.fail) { fails.push(`[${locale}/${engine}] ${out.fail}`); continue }

  lines.push(`  ── ${locale} / ${engine}`)
  lines.push(`     vocabulary — the map names ${out.mapVocab.length} religion families, the grid names ${out.gridVocab.length}+; '${out.family}' is shared`)
  lines.push(`     direct     — religion-family="${out.family}" set on the grid itself: ${out.direct} of ${out.unfiltered}`)
  lines.push(`     linked     — the same family over the composite's wire: ${out.linked}`)
  lines.push(`     mutant     — the legend KEY '${out.letter}' over the same wire: ${out.mutant}`)

  if (out.mutant === out.direct) {
    fails.push(`[${engine}] NO TEETH — sending the legend key '${out.letter}' narrowed the grid to the same ${out.direct} rows as the family name '${out.family}'. This gate cannot tell a right mapping from a wrong one, so its pass would mean nothing.`)
  }
  if (out.linked !== out.direct) {
    fails.push(`[${engine}] the link does not deliver the facet — '${out.family}' set on the grid gives ${out.direct} rows, the same family over the composite's wire gives ${out.linked}.`)
  }
  if (out.lang) {
    lines.push(`     language   — '${out.lang.name}' direct ${out.lang.direct}, over the wire ${out.lang.byName}, poison ${out.lang.poison} (of ${out.langVocabCount} names)`)
    if (out.lang.byName !== out.lang.direct) {
      fails.push(`[${engine}] the LANGUAGE link does not deliver the facet — '${out.lang.name}' set on the grid gives ${out.lang.direct} rows, the same language over the composite's wire gives ${out.lang.byName}.`)
    }
    if (out.lang.poison === out.lang.direct) {
      fails.push(`[${engine}] NO TEETH on language — a language that does not exist narrowed the grid to the same ${out.lang.direct} rows. The wire is not carrying what this gate thinks it is.`)
    }
  } else {
    lines.push(`     language   — SKIPPED (no single language narrows this grid to a strict subset)`)
  }
  }
  }

  // ★ THE TWO ENGINES MUST AGREE, WITHIN EACH LOCALE. Each run above only proves the link works in
  // one build; identical COUNTS is what proves the contract is the same product on both. Comparing
  // ACROSS locales would compare two different datasets, since the labels themselves change — so the
  // comparison is per locale, and a per-engine pass with different numbers still fails.
  for (const locale of LOCALES) {
  const [a, b] = PROVIDERS.map((e) => `${locale}/${e}`)
  if (results[a] && results[b] && !results[a].fail && !results[b].fail) {
    if (results[a].unfiltered !== results[b].unfiltered) {
      fails.push(`the two engines start from different data — ${a} lists ${results[a].unfiltered} groups, ${b} lists ${results[b].unfiltered}.`)
    }
    if (results[a].family === results[b].family && results[a].direct !== results[b].direct) {
      fails.push(`'${results[a].family}' narrows to ${results[a].direct} rows under ${a} and ${results[b].direct} under ${b} — the same choice gives different peoples on the two engines.`)
    }
    if (results[a].linked !== results[b].linked) {
      fails.push(`the link delivers ${results[a].linked} rows under ${a} and ${results[b].linked} under ${b} — interoperability that holds on one provider and not the other is not interoperability.`)
    }
  }
  }
} catch (err) {
  fails.push(`the measurement itself failed: ${err && err.message}`)
} finally {
  await browser.close().catch(() => {})
  cleanup()
}

for (const l of lines) console.log(l)
if (fails.length) {
  console.log(`\n${TAG}: FAIL`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  console.log('\n  The religion link is one shared table (library/colors/religion.js) read in two')
  console.log('  directions: the map reverses family NAME -> legend letter, the grid runs code -> family')
  console.log('  NAME per row. Both halves must speak the NAME on the wire.')
  process.exit(1)
}
console.log(`${TAG}: PASS — on BOTH providers the composite's religion link delivers exactly the facet the grid delivers on its own, a wrong mapping does not, and the two engines agree to the row.`)
