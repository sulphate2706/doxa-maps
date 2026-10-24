#!/usr/bin/env node
/**
 * check-facet-changes-map.mjs — THE GATE FOR BUG-PRAYER-FILTER-NOT-APPLYING-TO-THE-MAP.
 *
 * ★ WHAT IT ASSERTS, and why each assertion exists rather than the obvious one.
 *
 *   THE OBVIOUS ASSERTION — "selecting a facet changes the map's feature COUNT" — PASSES TODAY AND
 *   PASSED WHILE THE BUG WAS PLAINLY VISIBLE. That is measured, not hypothetical: selecting
 *   "Has Prayer" already narrowed rd-bubbles 2107 -> 689 features, disjoint from "Needs Prayer"
 *   (1418), summing exactly to 2107 and round-tripping on clear. The filter was never broken.
 *   What was broken is that every dot was painted the SAME flat orange ('circle-color' read back
 *   off the live layer as the bare string '#ef6c00', not an expression), so a prayer question got
 *   an answer with no prayer information in it. The report was a COLOUR request:
 *     sorting by Has Prayer must SHOW WHICH ONES HAVE PRAYER AND WHICH DO NOT, and the dots
 *     were not changing with that filter.
 *   So this gate asserts BOTH halves, because either one alone is a false pass:
 *     1. SET     — the selection changes WHICH dots are on the map (count + identity).
 *     2. MEANING — the surviving dots all genuinely satisfy the selected level.
 *     3. COLOUR  — while a prayer selection is active the dot colour is a DATA-DRIVEN EXPRESSION,
 *                  not a flat literal, and it reads the property the features actually carry.
 *
 *   ★ ASSERTION 3 IS THE ONE THAT WOULD HAVE CAUGHT THE REPORTED BUG. Assertions 1 and 2 were
 *   already green when it was reported.
 *
 * ★ IDENTITY, NOT JUST COUNT. The first five slugs are BYTE-IDENTICAL before and after, because
 *   the filter removes from the tail of an alphabetical list. A gate that eyeballed the head of the
 *   list, or that compared only counts, would report "looks the same" / "looks fine" for the wrong
 *   reason. We compare SETS of slugs and require a strict, non-empty subset relation.
 *
 * ★ WHY THE COLOUR CHECK IS CONDITIONAL. Orange (#ef6c00) is a product decision with a contrast
 *   analysis behind it and is correct with NO prayer filter active; the 3-tier prayer ramp is
 *   correct WITH one. So the gate requires a literal before and an expression after — asserting the
 *   SWITCH, which is the actual contract, rather than hardcoding either colour as always-right.
 *
 * ★ SHADOW DOM DOES NOT PIERCE. Every lookup is a recursive walk with a seen-Set, re-injected after
 *   each interaction (a re-render drops anything defined earlier). The heavy tab LAZY-MOUNTS, so we
 *   click it and then WAIT FOR THE MAP SOURCE TO BE POPULATED — querying earlier returns 0 features
 *   and reads as "no bug".
 *
 * ★ NEGATIVE-TESTED. `--self-test` reverts the fix IN THE LIVE PAGE (repoints circle-color at the
 *   flat literal and strips peoplePraying from the features) and requires this gate to FAIL. A gate
 *   nobody has broken is a gate nobody knows works — and this repo has shipped one before.
 *
 * USAGE
 *   node internal/check-facet-changes-map.mjs              # against BASE_URL (default dev 5173)
 *   node internal/check-facet-changes-map.mjs --self-test  # NEGATIVE test: the gate must FAIL
 *   BASE_URL=http://127.0.0.1:4173 PROBE_PATH=/<TREE_NAME>/... node internal/check-facet-changes-map.mjs
 */
import { chromium } from './lib/playwright-guarded.mjs'
// The in-page helper lives in a browser-free module so check:facet-shape can test the same string headlessly.
import { WALK } from './lib/facet-walk.mjs'

// Defaults to the DEV server, because this gate drives a live interaction and the dev surface is
// the one that always reflects current source. Point BASE_URL/PROBE_PATH at the built tree
// (`bun run serve` on 4173) to run it against a built leaf or the cap-5 shell.
//
// ⚠ THE DEV DEFAULT IS FLAKY UNDER LOAD, AND A FLAKY GATE IS WORSE THAN A FAILING ONE — it
// teaches you to re-run until green. MEASURED 2026-09-24 on a box with several agents working:
//   dev 5173  -> 1 PASS, 3 FAIL in four consecutive runs ("the map never populated after 90s")
//   built 4173 -> PASS, PASS
// The product is fine; the VARIANCE is the dev server's. A dev page load pulls 88 unbundled
// module requests against the built leaf's 3, and Vite compiles them on demand — so the wait
// this gate already retries THREE TIMES at 90s can still lose. Raising the timeout is the wrong
// fix for the same reason: it is not one slow moment, it is contention.
//
// SO: when you need a trustworthy answer rather than a quick one, run it against the BUILT tree:
//   BASE_URL=http://127.0.0.1:4173 \
//   PROBE_PATH=/<TREE_NAME>/research-dashboard/research-dashboard/index.html \
//   node internal/check-facet-changes-map.mjs
// The built tree can be stale — that is the trade — but it is DETERMINISTIC, which is what a gate
// needs. The dev default is kept because it is right for hand-running against uncommitted source.
// This is also why the gate is NOT wired into a wave: a wave step that is green 1 run in 4 would
// train everyone to ignore the wave.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173'
const PATH_ = process.env.PROBE_PATH || '/'

// ⚠ THE SERVER THAT ANSWERS IS NOT NECESSARILY THIS CHECKOUT. Several worktrees of this repo
// run on one machine and a default port belongs to whichever started first — measured
// 2026-09-24 on :4173. This gate reports on how a map's source data changes when a facet is
// picked, so a run against another tree describes somebody else's data flow. The fingerprint
// is public/<TREE_NAME>/manifest.json; a dev server serves it straight off disk, so this stays
// quiet in the normal `bun run dev` case and only speaks when the bytes really differ.
{
  const { servesThisTree } = await import('./_serves-this-tree.mjs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const tree = await servesThisTree(BASE, repo)
  if (/DIFFERENT build/.test(tree.why)) {
    console.log('FACET-CHANGES-MAP: SKIP — the server is not serving THIS build.')
    console.log(`  ${tree.why}`)
    console.log('  Point BASE_URL at this checkout (bun run dev, or bun run serve).')
    process.exit(0)
  }
}
const TAB = process.env.PROBE_TAB || 'research-dashboard'
const SELF_TEST = process.argv.includes('--self-test')
// WHICH HALF OF THE FIX TO REVERT in --self-test. Default 'colour' reverts ONLY the paint, leaving
// the feature properties intact — that is the EXACT bug reported (a correct filter whose
// dots all look the same), and it isolates assertion 3, the one assertions 1-2 cannot catch.
// 'props' strips peoplePraying instead; 'both' does the lot; 'frozen' blocks the source update
// entirely, simulating "the filter never reaches the map" and negative-testing assertion 1.
const SELF_TEST_MODE = (process.env.SELF_TEST_MODE || 'colour').toLowerCase()

// The SwiftShader launch — without these a headless Chromium here has NO GL context, the map never
// paints, and this gate cannot see the layer at all. Same flags as verify-map-paint.mjs.
const GL_ARGS = [
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--no-sandbox',
]


// ★ THE SELF-TEST INVERTS THE EXIT CODE, and it must do so HERE rather than at the end.
// Every assertion below calls fail() and exits immediately, so a self-test run that correctly
// DETECTS the reverted bug would otherwise exit 1 and look like a broken gate. In --self-test a
// detection is the PASS: we print what was caught and exit 0. If the run instead reaches the end
// without ever calling fail(), the gate missed the bug and THAT exits 1 (see the tail of run()).
const fail = (m) => {
  if (SELF_TEST) {
    console.log('FACET-CHANGES-MAP: SELF-TEST OK — the gate REJECTED the reverted build:')
    console.log('  caught: ' + m)
    process.exit(0)
  }
  console.error('FACET-CHANGES-MAP: FAIL — ' + m)
  process.exit(1)
}
const ok = (m) => console.log('  ok  ' + m)

// The prayer levels, and the predicate each one promises about a surviving dot. Kept in step with
// library/colors/prayer-progress.js (threshold 144) — the ONE owner of the split.
const FULL_PRAYER_THRESHOLD = 144
const LEVELS = [
  { label: 'Has Prayer', holds: (n) => Number(n) > 0 },
  { label: 'Needs Prayer', holds: (n) => !(Number(n) > 0) },
]

async function reinject(page) { await page.addScriptTag({ content: WALK }) }

// Read __state(), tolerating a STALE map handle: if the panel re-created its Map mid-interaction
// we wait for the new one to populate and read again, rather than reporting a product failure for
// what is our own dangling reference. Only a state that is still stale after the grace period is
// treated as real — and it is reported as an infrastructure fault, not a filter bug.
async function readState(page, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const st = await page.evaluate('__state()')
    if (!st.stale) return st
    if (attempt === 0) console.log(`  …${label}: map handle went stale (re-render); waiting for the new instance`)
    try {
      await page.waitForFunction(`(() => {
        const m = window.__rdashMap; if (!m) return false;
        try { const f = __srcFeatures(m, 'rd-bubbles'); return !!(f && f.length > 0) }
        catch (e) { return false }
      })()`, { timeout: 30000 })
    } catch (e) { /* fall through to a final attempt */ }
    await page.waitForTimeout(1500)
    await reinject(page)
  }
  const final = await page.evaluate('__state()')
  if (final.stale) fail(`${label}: the map was torn down and never came back — cannot measure (infrastructure, not a filter verdict)`)
  return final
}

const run = async () => {
  const browser = await chromium.launch({ args: GL_ARGS })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const url = BASE + PATH_
  console.log(`FACET-CHANGES-MAP: ${url} (tab "${TAB}")${SELF_TEST ? '  [SELF-TEST: the gate MUST fail]' : ''}`)

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  } catch (e) {
    console.error('FACET-CHANGES-MAP: SKIP — cannot reach ' + url + ' (' + e.message + ')')
    console.error('  start the surface first:  bun run dev   (or `bun run serve` + BASE_URL=http://127.0.0.1:4173)')
    await browser.close(); process.exit(2)
  }
  await page.waitForTimeout(2500)
  await reinject(page)

  // The heavy tab LAZY-MOUNTS: querying before this click returns 0 and reads as "no bug".
  await page.evaluate(`(() => {
    const els = __walk('[role=tab], .vtl-tab, button');
    const hit = els.find((e) => (e.textContent || '').includes(${JSON.stringify(TAB)}));
    if (hit) hit.click();
  })()`)

  // Wait for the map to EXIST and be POPULATED. Measuring earlier reads "no map" and would make
  // every before/after comparison below meaningless.
  try {
    await page.waitForFunction(`(() => {
      const m = window.__rdashMap; if (!m) return false;
      let s; try { s = m.getSource('rd-bubbles') } catch (e) { return false }
      if (!s) return false;
      const f = __srcFeatures(m, 'rd-bubbles'); return !!(f && f.length > 0);
    })()`, { timeout: 90000 })
  } catch (e) {
    // ★ DISTINGUISH "THIS ENGINE CANNOT BE MEASURED HERE" FROM "THE PRODUCT IS BROKEN".
    // This gate reads the source's CURRENT GeoJSON off `_data`, a private Mapbox internal. MEASURED
    // on one dashboard, one build, only the engine differing, by calling the app's own setData() to
    // shrink 2107 features to 5:
    //     mapbox    _data 2107 -> 5      _options.data 2107 -> 2107   (_data is LIVE)
    //     maplibre  _data never an FC    _options.data 2107 -> 2107   (NEITHER is live)
    // So under MapLibre no private field tracks setData and the wait above can never succeed —
    // and the gate then reported "the map never populated" about a dashboard that visibly renders
    // all 2107 dots with a working choropleth. A control that accuses correct code is worse than no
    // control; the same false-FAIL shape was just removed from check:filter-width.
    // Everything below is SELF-CONTAINED page code on purpose: an earlier attempt at this called a
    // node-side helper from inside a page-evaluated string, where it is simply undefined.
    let diag = null
    try {
      diag = await page.evaluate(`(() => {
        const m = window.__rdashMap; if (!m) return { noMap: true };
        let s = null; try { s = m.getSource('rd-bubbles') } catch (e) {}
        let engine = 'unknown';
        try { engine = m.getContainer && m.getContainer().classList.contains('maplibregl-map') ? 'maplibre' : 'mapbox' } catch (e) {}
        const f = __srcFeatures(m, 'rd-bubbles');
        return { engine, hasSource: !!s, payloadReadable: !!f, layer: !!m.getLayer('rd-bubble-layer') };
      })()`)
    } catch (_) { /* page gone — fall through to the original failure */ }
    // ★ THE MAPLIBRE SKIP IS GONE, because the reason for it is. This branch used to bail out with
    // "SKIP — this gate reads the GeoJSON source through a private Mapbox field (_data) that
    // MapLibre does not keep live", exiting 0 while announcing SKIP — NOT MEASURED, correct for the
    // limitation but a gate that never looks at half the product. __srcFeatures() unwraps
    // MapLibre's {geojson} wrapper, so the features ARE readable on both engines now and a failure
    // here is a real one.
    // If payloadReadable is still false with a source present, that is a NEW condition (a url-backed
    // source, or an engine shape neither bundle documents) and it should be investigated, not
    // skipped past — so it now falls through to the ordinary failure below, with the diagnostic.
    if (diag && diag.hasSource && !diag.payloadReadable) {
      await browser.close()
      fail(`the ${diag.engine} source 'rd-bubbles' exists but its features could not be read `
        + `(payload unreadable — a remote/url source, or a shape neither engine bundle documents). `
        + `This is NOT the old MapLibre _data limitation: that is fixed.`)
    }
    await browser.close(); fail('the map never populated (no rd-bubbles features after 90s)')
  }
  await page.waitForTimeout(2500)
  await reinject(page)

  // ── THE SELF-TEST: put the BUG back, in the live page. ────────────────────────────────────────
  // Reverts BOTH halves of the fix — the flat literal colour AND the missing property — which is
  // exactly the state this gate exists to reject.
  if (SELF_TEST) {
    console.log(`  [self-test] reverting the fix in-page, mode = ${SELF_TEST_MODE}`)
    await page.evaluate(`((mode) => {
      const m = window.__rdashMap;
      const s = m.getSource('rd-bubbles');
      const killColour = mode === 'colour' || mode === 'both';
      const killProps  = mode === 'props'  || mode === 'both';
      if (killColour) {
        // Pin circle-color at the flat literal so the app's own applyPaint() cannot undo the
        // revert mid-run. This alone IS the reported bug: the filter still works, every dot orange.
        m.setPaintProperty('rd-bubble-layer', 'circle-color', '#ef6c00');
        const orig = m.setPaintProperty.bind(m);
        m.setPaintProperty = (layer, prop, val) => {
          if (layer === 'rd-bubble-layer' && prop === 'circle-color') return orig(layer, prop, '#ef6c00');
          return orig(layer, prop, val);
        };
      }
      if (killProps) {
        const strip = (data) => { for (const f of ((data && data.features) || [])) { delete f.properties.peoplePraying } return data };
        strip(s._data); s.setData(s._data);
        const os = s.setData.bind(s);
        s.setData = (data) => os(strip(data));
      }
      if (mode === 'frozen') {
        // The map never learns about the filter — the shape the brief hypothesised as (a)/(c).
        s.setData = () => {};
      }
    })(${JSON.stringify(SELF_TEST_MODE)})`)
    await page.waitForTimeout(500)
    await reinject(page)
  }

  const before = await readState(page, 'baseline')
  if (before.err) { await browser.close(); fail('before-state: ' + before.err) }
  if (!before.n) { await browser.close(); fail('the map had 0 dots before any filter — nothing to compare') }
  ok(`baseline: ${before.n} dots, circle-color = ${before.colorJson}`)

  // A flat literal with NO prayer filter active is CORRECT (the pin's own orange identity).
  if (before.colorIsExpression) {
    ok('baseline colour is already data-driven (acceptable; the switch below is what matters)')
  }

  let checked = 0
  for (const lvl of LEVELS) {
    if (!(await page.evaluate('__openPrayer()'))) { await browser.close(); fail('no "Prayer" dropdown found — the facet is not reachable as a control') }
    await page.waitForTimeout(900)
    await reinject(page)
    const picked = await page.evaluate(`__pickPrayer(${JSON.stringify(lvl.label)})`)
    if (picked !== 'ok') { await browser.close(); fail(`could not select "${lvl.label}": ${picked}`) }
    await page.waitForTimeout(5000)
    await reinject(page)

    const after = await readState(page, `after "${lvl.label}"`)
    if (after.err) { await browser.close(); fail(`after "${lvl.label}": ` + after.err) }

    // ── 1. THE SET CHANGED (count) ──
    if (after.n === before.n) {
      await browser.close()
      fail(`selecting "${lvl.label}" did not change the map: still ${after.n} dots. The filter is not reaching the map's bubble source.`)
    }
    if (after.n === 0) { await browser.close(); fail(`selecting "${lvl.label}" emptied the map (0 dots) — a filter that matches nothing`) }

    // ── 1b. THE SET CHANGED (identity — count alone can coincide) ──
    const sBefore = new Set(before.slugs)
    const subset = after.slugs.every((s) => sBefore.has(s))
    if (!subset) { await browser.close(); fail(`"${lvl.label}" produced dots that were not in the unfiltered set — the map is not a subset of its own data`) }
    const removed = before.slugs.filter((s) => !new Set(after.slugs).has(s)).length
    if (!removed) { await browser.close(); fail(`"${lvl.label}" removed no dots by identity`) }

    // ── 2. THE SURVIVORS MEAN WHAT THE LABEL SAYS ──
    const bad = after.praying.filter((n) => !lvl.holds(n)).length
    if (bad) {
      await browser.close()
      fail(`"${lvl.label}" left ${bad}/${after.n} dots that do NOT satisfy it — the dots shown are not the dots asked for`)
    }

    // ── 3. THE DOTS CARRY THEIR PRAYER STATE, AND THE COLOUR READS IT ──
    const missing = after.praying.filter((v) => v === undefined || v === null).length
    if (missing) {
      await browser.close()
      fail(`"${lvl.label}": ${missing}/${after.n} dots carry no peoplePraying property, so the colour expression has nothing to read (every dot would paint as the default)`)
    }
    if (!after.colorIsExpression) {
      await browser.close()
      fail(`"${lvl.label}": circle-color is the flat literal ${after.colorJson} — every dot paints the same regardless of prayer, so the map cannot "show which ones have prayer". It must be a data-driven expression while a prayer filter is active.`)
    }
    if (!after.colorJson.includes('peoplePraying')) {
      await browser.close()
      fail(`"${lvl.label}": circle-color is an expression but never reads peoplePraying (${after.colorJson.slice(0, 120)}) — it is not painting prayer state`)
    }

    ok(`"${lvl.label}": ${before.n} -> ${after.n} dots (${removed} removed), all satisfy the level, colour is data-driven on peoplePraying`)
    checked++

    // clear for the next level (the chip's x), and confirm the map restores
    await page.evaluate(`(() => { const x = __walk('.sfh__chip-x')[0]; if (x) x.click() })()`)
    await page.waitForTimeout(4000)
    await reinject(page)
    const cleared = await readState(page, `clearing "${lvl.label}"`)
    if (cleared.err) { await browser.close(); fail('after clearing: ' + cleared.err) }
    if (cleared.n !== before.n) {
      await browser.close()
      fail(`clearing "${lvl.label}" left ${cleared.n} dots, expected the full ${before.n} — the filter does not round-trip`)
    }
    ok(`"${lvl.label}" cleared: restored to ${cleared.n} dots`)
  }

  await browser.close()

  if (!checked) fail('no prayer levels were exercised')

  // Reaching here in self-test means NO assertion fired while the bug was present in the page.
  if (SELF_TEST) {
    console.error('FACET-CHANGES-MAP: SELF-TEST FAILED — the bug was reverted in the page and this gate still PASSED.')
    console.error('  A gate that cannot fail is worse than no gate. Fix the gate, not the product.')
    process.exit(1)
  }
  console.log(`FACET-CHANGES-MAP: PASS — ${checked} prayer level(s): the dots change, mean what they say, and carry their prayer colour.`)
}

run().catch((e) => {
  // An EXCEPTION is not a detection. In self-test we require the gate to fail through one of its
  // own assertions (fail()), not to crash — a crash would "pass" the self-test for the wrong
  // reason and would hide a genuinely broken gate.
  console.error('FACET-CHANGES-MAP: ERROR — ' + e.message)
  process.exit(1)
})
