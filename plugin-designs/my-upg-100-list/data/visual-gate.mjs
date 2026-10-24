// visual-gate.mjs — slice 09b-6 §1(g) Playwright-FIREFOX visual gate
//
//   node plugin-designs/my-upg-100-list/data/visual-gate.mjs
//
// FIREFOX ONLY (hard rule: always Firefox, never Chrome). NEVER
// chromium / mcp-chrome. Loads the live dev bundle, asserts the tapestry paints
// in both themes, the headline Nepal-uncovered zone isolates, and the map
// controls are present. Screenshots land in data/visual-gate-shots/ for the
// the brief's eye — per the no-images rule this script NEVER reads the PNGs
// back; every assertion is programmatic (map.queryRenderedFeatures counts,
// canvas pixel sampling, DOM presence).
//
// Exit 0 = all checks PASS; non-zero = at least one FAIL.

import { firefox } from '../../../internal/lib/playwright-guarded.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
// toolA (09b shift-select-copy): the SAME name→count tables the profile uses,
// imported in NODE so check (13) recomputes the expected running total
// INDEPENDENTLY of the page's JS (the gate must be able to fail).
import { resolveTerritory } from './territory-counts.js';
// slice 09b-9 §3 (L18/L29 idle gate): the SAME override map the profile's
// tapestry paint now resolves through. Imported in NODE so check (1e) recomputes
// the EXPECTED idle fill-color INDEPENDENTLY of the page (the gate must be able to
// fail). zone-colors.json holds the region-inherited strategy.
import { colorForZone } from './zone-colors.js';
import ZONE_COLOR_OVERRIDES from './zone-colors.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, 'visual-gate-shots');
mkdirSync(SHOTS, { recursive: true });

const URL = process.env.UPG_URL || 'http://localhost:5180/plugin-designs/my-upg-100-list/';
const EL = 'my-upg-100-list-map';

let fails = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
}

// Count tapestry-fill features. Primary = the source's backing FeatureCollection
// (viewport-independent, survives setStyle re-add); the filter (isolation) is
// applied to the LAYER not the source, so for isolate checks we also intersect
// with the active filter via queryRenderedFeatures. Returns the source count when
// queryRenderedFeatures yields 0 only because features sit outside the viewport.
// Negative codes signal the layer/source isn't present yet.
async function tapestryFeatureCount(page) {
  return page.evaluate(() => {
    const m = window.__UPG_MAP__;
    if (!m || typeof m.queryRenderedFeatures !== 'function') return -1;
    try {
      if (!m.getLayer || !m.getLayer('tapestry-fill')) return -2;
      // rendered (respects the isolation filter + viewport)
      const rendered = m.queryRenderedFeatures({ layers: ['tapestry-fill'] }).length;
      if (rendered > 0) return rendered;
      // viewport may exclude features → fall back to the source FeatureCollection
      const src = m.getSource && m.getSource('tapestry');
      const data = src && src._data;
      const total = data && Array.isArray(data.features) ? data.features.length : 0;
      return total > 0 ? total : 0;
    } catch { return -3; }
  });
}

// Count features that match the CURRENT isolation filter (source-level, viewport
// independent). Reads the layer's filter expression and applies it to the source
// FeatureCollection so an isolated zone is provable even when zoomed out.
async function isolatedFeatureCount(page) {
  return page.evaluate(() => {
    const m = window.__UPG_MAP__;
    if (!m || !m.getLayer || !m.getLayer('tapestry-fill')) return -2;
    try {
      const filter = m.getFilter('tapestry-fill'); // ['in',['get','zoneKey'],['literal',[...]]] or null
      const src = m.getSource('tapestry');
      const feats = (src && src._data && src._data.features) || [];
      if (!filter) return feats.length; // no isolation
      // extract the literal key set from the ['in', ['get','zoneKey'], ['literal', keys]] expr
      let keys = null;
      const lit = Array.isArray(filter) ? filter.find((p) => Array.isArray(p) && p[0] === 'literal') : null;
      if (lit && Array.isArray(lit[1])) keys = new Set(lit[1]);
      if (!keys) return -3;
      let n = 0;
      for (const f of feats) if (keys.has(f.properties && f.properties.zoneKey)) n++;
      return n;
    } catch { return -4; }
  });
}

// Non-blank canvas pixel check: sample the map canvas, count non-near-black px.
async function canvasNonBlankRatio(page) {
  return page.evaluate((elName) => {
    const host = document.querySelector(elName);
    const root = host && host.shadowRoot ? host.shadowRoot : document;
    const cv = root.querySelector('canvas.mapboxgl-canvas') || root.querySelector('canvas');
    if (!cv) return -1;
    const w = cv.width, h = cv.height;
    if (!w || !h) return -2;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d');
    try { ctx.drawImage(cv, 0, 0); } catch { return -3; }
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch { return -4; }
    let nonBlank = 0, total = 0;
    for (let i = 0; i < data.length; i += 4 * 137) { // sparse sample
      total++;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r + g + b > 60) nonBlank++;
    }
    return total ? nonBlank / total : 0;
  }, EL);
}

// 09b light-default §1e: read the CURRENT basemap style id from the live map.
// map.getStyle().sprite (or .glyphs / the style name) carries the mapbox style
// slug — but the most robust signal is the style's `name`/sprite URL which both
// contain 'light-v11' / 'dark-v11'. We stringify the whole style head and test
// for the slug so we are resilient to which field carries it across mapbox-gl
// versions. Returns 'light' | 'dark' | 'unknown'.
async function mapStyleTheme(page) {
  return page.evaluate(() => {
    const m = window.__UPG_MAP__;
    if (!m || typeof m.getStyle !== 'function') return 'unknown';
    try {
      const s = m.getStyle() || {};
      const probe = JSON.stringify({
        name: s.name, sprite: s.sprite, glyphs: s.glyphs,
      });
      if (probe.includes('light-v11')) return 'light';
      if (probe.includes('dark-v11')) return 'dark';
      return 'unknown';
    } catch { return 'unknown'; }
  });
}

// Wait until the tapestry SOURCE carries features again (after a setStyle re-add).
async function waitTapestryReady(page, ms = 20000) {
  return page.waitForFunction(() => {
    const m = window.__UPG_MAP__;
    if (!m || !m.getLayer || !m.getLayer('tapestry-fill')) return false;
    const src = m.getSource && m.getSource('tapestry');
    const data = src && src._data;
    return !!(data && Array.isArray(data.features) && data.features.length > 0);
  }, null, { timeout: ms }).then(() => true).catch(() => false);
}

// 09b-9 legend-light-mode: read the legend panel's COMPUTED background + data-theme.
// The legend lives inside the custom element's shadow root. NOTE: .stl-panel itself
// is transparent (rgba(0,0,0,0)) in BOTH themes — the painted chrome background sits
// on its child .stl-inner (SemanticTreeLegend.vue:332 dark #161b22; :633 light #fff).
// The data-theme attribute that gates the theme is on .stl-panel. So we read the bg
// from .stl-inner and the theme flag from .stl-panel. Per the NO-IMAGES rule we
// assert on the computed color string (rgb(...)), never by reading a PNG. Dark inner
// chrome is #161b22 == rgb(22,27,34); light is #fff == rgb(255,255,255).
async function legendPanelStyle(page) {
  return page.evaluate((elName) => {
    const host = document.querySelector(elName);
    const root = host && host.shadowRoot ? host.shadowRoot : document;
    const panel = root.querySelector('.stl-panel');
    if (!panel) return { found: false };
    const inner = panel.querySelector('.stl-inner') || panel;
    const cs = getComputedStyle(inner);
    return {
      found: true,
      bg: cs.backgroundColor,           // .stl-inner — the element that actually paints
      color: cs.color,
      borderColor: cs.borderColor,
      dataTheme: panel.getAttribute('data-theme') || '',  // theme flag is on .stl-panel
    };
  }, EL);
}

// True when the rgb(...) string is a LIGHT background (near-white), i.e. NOT the dark
// #161b22 == rgb(22,27,34). We test the summed channel value: dark chrome sums ~83,
// GitHub-light backgrounds (#fff=765, #f6f8fa=744) sum >600. Threshold 400 cleanly
// separates the two palettes regardless of which light shade the panel resolves to.
function isLightBg(rgb) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb || '');
  if (!m) return false;
  return (Number(m[1]) + Number(m[2]) + Number(m[3])) > 400;
}

// Pierce shadow DOM to get a legend row handle by visible label (exact or prefix).
function legendRow(page, label) {
  // Playwright auto-pierces open shadow roots for locators.
  return page.locator(`${EL} .stl-row`, { hasText: label });
}

// Expand a parent row's children in-place by clicking its caret — IDEMPOTENT:
// only clicks when the caret is currently COLLAPSED (no `.open` class). Clicking
// an already-open caret would COLLAPSE it and hide the leaf rows the gate then
// tries to click (the 09b-6 gate's latent bug, surfaced once we drill to leaves).
async function expandRow(page, label) {
  const row = legendRow(page, label);
  if (!(await row.count())) return false;
  const caret = row.first().locator('.stl-caret');
  if (!(await caret.count())) return false;
  const isOpen = await caret.first().evaluate((el) => el.classList.contains('open')).catch(() => false);
  if (!isOpen) {
    await caret.first().click().catch(() => {});
    await page.waitForTimeout(450);
  }
  return true;
}

// Clear any active isolation filter on the tapestry layers.
async function clearFilter(page) {
  await page.evaluate(() => {
    const m = window.__UPG_MAP__;
    if (m && m.getLayer && m.getLayer('tapestry-fill')) {
      m.setFilter('tapestry-fill', null);
      if (m.getLayer('tapestry-line')) m.setFilter('tapestry-line', null);
    }
  });
  await page.waitForTimeout(400);
}

// Click a leaf row by its visible label, then assert it isolates ≥1 polygon.
// Used for the 4 zones 09b-7 re-tagged (were 0 pre-fix). Returns the isolated count.
async function isolateLeafAndAssert(page, rowLabel, zoneId) {
  await clearFilter(page);
  const row = legendRow(page, rowLabel);
  const found = await row.count();
  let count = -1;
  if (found) {
    await row.first().click().catch(() => {});
    await page.waitForTimeout(1400);
    count = await isolatedFeatureCount(page);
    // sanitize a filename from the zone id
    await page.screenshot({ path: join(SHOTS, `06-${zoneId}.png`) }).catch(() => {});
  } else {
    await page.screenshot({ path: join(SHOTS, `06-${zoneId}.png`) }).catch(() => {});
  }
  check(`(5) ${zoneId} legend row isolates ≥1 polygon (was 0 pre-09b-7 stale tag)`,
    found > 0 && count >= 1, `row="${rowLabel}" found=${found > 0} isolated-features=${count}`);
  return count;
}

async function main() {
  console.log(`================ 09b VISUAL GATE (Firefox) — light-default + theme cycle ================`);
  console.log(`URL: ${URL}`);
  const browser = await firefox.launch();
  // L4 (LESSON-03): locale MUST be explicit — headless Firefox reports no
  // navigator.language, and mapbox-gl-geocoder defaults its `language` option
  // to the browser language, yielding `language=undefined` in the forward-
  // geocode URL → HTTP 422 → the merged remote+local dropdown never renders.
  // en-US makes the geocoder request deterministic (HTTP 200) in the gate env.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ── wait for the custom element + map instance + tapestry source ───────────
    await page.waitForSelector(EL, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__UPG_MAP__, null, { timeout: 25000 }).catch(() => {});
    // The data fetch (2106 UUPGs) + zone resolve runs async; wait until the
    // tapestry SOURCE carries features (viewport-independent — survives zoom-out).
    let painted = -1;
    const ready = await page.waitForFunction(() => {
      const m = window.__UPG_MAP__;
      if (!m || !m.getLayer || !m.getLayer('tapestry-fill')) return false;
      const src = m.getSource && m.getSource('tapestry');
      const data = src && src._data;
      return !!(data && Array.isArray(data.features) && data.features.length > 0);
    }, null, { timeout: 45000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1500); // settle paint
    if (!ready) console.log('  [warn] tapestry source did not report features within 45s');

    // ── (1) BOOT theme MUST be LIGHT (09b light-default §1e-1) ─────────────────
    // The boot ctor style is now light-v11 + isDark=ref(false). Assert BOTH the
    // live style id contains 'light-v11' AND the tapestry polygons paint on it.
    painted = await tapestryFeatureCount(page);
    const bootTheme = await mapStyleTheme(page);
    const ratio1 = await canvasNonBlankRatio(page);
    await page.screenshot({ path: join(SHOTS, '01-boot-light.png') });
    check('(1) BOOT style is LIGHT (light-v11) AND tapestry polygons paint',
      bootTheme === 'light' && painted > 0,
      `bootStyle=${bootTheme} queryRenderedFeatures(tapestry-fill)=${painted}`);
    // ADVISORY: WebGL canvas readback (getImageData) is unreliable on mapbox
    // without preserveDrawingBuffer (returns blank). The authoritative paint
    // assertion is the feature count above. Logged non-gating.
    console.log(`ADVISORY  (1) canvas non-blank pixel ratio = ${ratio1.toFixed(3)} ` +
      `(WebGL readback; non-gating — feature count is authoritative)`);

    // ── (1b) 09b-9 legend follows theme — BOOT: legend panel is LIGHT ──────────
    // The shared SemanticTreeLegend's dark default is #161b22 (rgb(22,27,34)). On a
    // light boot it must render its built-in light chrome (data-theme=light, near-
    // white bg). Asserted via getComputedStyle (NO-IMAGES: no PNG readback).
    const legBoot = await legendPanelStyle(page);
    await page.screenshot({ path: join(SHOTS, 'legend-light.png') }).catch(() => {});
    check('(1b) BOOT legend panel is LIGHT (follows light map, not #161b22)',
      legBoot.found && legBoot.dataTheme === 'light' && isLightBg(legBoot.bg),
      `found=${legBoot.found} data-theme=${legBoot.dataTheme} bg=${legBoot.bg} color=${legBoot.color}`);

    // ── (1c) 09b-oceania-color-fix: oceania-indonesia is ONE color WITHOUT a click ─
    // THE BUG: oceania-indonesia (18 ISO3) looked multi-colored on boot because the
    // `deaf` overlay (#18ffff) double-stamps 16 of its Pacific countries and — before
    // the fix — resolved AFTER it, so deaf over-painted the amber (#ffc400) until a
    // click re-filtered the source. NO-CLICK assertion (per the memory note: assert via
    // queryRenderedFeatures + source order, NOT canvas pixels — WebGL readback is blank):
    //   (i) every rendered oceania-indonesia tapestry feature carries ONE zoneColor; and
    //  (ii) in the LIVE source array, every shared (oceania-indonesia ∩ deaf) country's
    //       land feature sits AFTER its deaf feature → land paints on top (the fix).
    const oceania = await page.evaluate(() => {
      const m = window.__UPG_MAP__;
      const src = m && m.getSource && m.getSource('tapestry');
      const data = src && src._data;
      if (!data || !Array.isArray(data.features)) return { ok: false, reason: 'no-source' };
      const OI = 'oceania-indonesia';
      // (i) rendered single-color: use queryRenderedFeatures (respects paint), fall
      // back to the source set when the zone sits outside the viewport.
      let rendered = [];
      try { rendered = m.queryRenderedFeatures({ layers: ['tapestry-fill'] }); } catch (_) {}
      let oiFeats = rendered.filter((f) => f.properties && f.properties.zoneKey === OI);
      if (!oiFeats.length) oiFeats = data.features.filter((f) => f.properties && f.properties.zoneKey === OI);
      const colors = [...new Set(oiFeats.map((f) => f.properties.zoneColor))];
      // (ii) source draw order: deaf-stamped Pacific countries must come BEFORE the
      // oceania-indonesia stamp of the SAME iso3.
      const deafIdx = new Map();   // iso3 -> latest deaf source index
      const oiIdx = new Map();     // iso3 -> earliest oceania-indonesia source index
      data.features.forEach((f, i) => {
        const p = f.properties || {}; const iso = p.iso3; if (!iso) return;
        if (p.zoneKey === 'deaf') deafIdx.set(iso, i);
        else if (p.zoneKey === OI && oiIdx.get(iso) === undefined) oiIdx.set(iso, i);
      });
      let overlaps = 0, orderBad = 0;
      for (const [iso, di] of deafIdx) {
        const oi = oiIdx.get(iso); if (oi === undefined) continue;
        overlaps++; if (!(oi > di)) orderBad++;
      }
      return {
        ok: colors.length === 1 && orderBad === 0,
        featureCount: oiFeats.length, colors, overlaps, orderBad,
      };
    });
    await page.screenshot({ path: join(SHOTS, '08-oceania-no-click.png') }).catch(() => {});
    check('(1c) oceania-indonesia is ONE color WITHOUT a click (deaf overlay under land)',
      oceania.ok && oceania.featureCount > 0,
      `feats=${oceania.featureCount} colors=${JSON.stringify(oceania.colors)} ` +
      `pacific-overlaps=${oceania.overlaps} order-violations=${oceania.orderBad}`);

    // ── (1d) NO BROWN on the rendered map (slice 09b-no-brown) ─────
    // THE ASK: "not a fan of brown, brown everywhere." Brown = a dark,
    // desaturated WARM hue: hue∈[10,50]° ∧ L<48% ∧ S<100%. Read the ACTUAL painted
    // zoneColor off every rendered tapestry feature (NO-IMAGES: queryRenderedFeatures
    // + in-page HSL, NOT a canvas/PNG pixel read — WebGL readback is blank). Scope
    // to the families this slice owns (Africa / LatAm / Oceania) by their zoneKey
    // prefixes; Asia/blue is a separate gated slice and is NOT asserted here. This
    // can fail: a single brown fill on any of those zones reports the offending
    // zoneKey + hex and the band coordinates.
    const noBrown = await page.evaluate(() => {
      const m = window.__UPG_MAP__;
      const src = m && m.getSource && m.getSource('tapestry');
      const data = src && src._data;
      if (!data || !Array.isArray(data.features)) return { ok: false, reason: 'no-source' };
      // the warm non-Asia families this slice recolored (the brief rules out brown here).
      const WARM_KEYS = new Set([
        'central-africa', 'east-africa', 'southern-africa-islands', 'sudan', 'west-africa',
        'andean-caribbean', 'brazil', 'oceania-indonesia',
      ]);
      const hexToRgb = (hex) => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
      const rgbToHsl = ([r, g, b]) => {
        r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s; const l = (max + min) / 2;
        if (max === min) { h = s = 0; } else {
          const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6;
        }
        return { h: h * 360, s, l };
      };
      const inBrownBand = (hex) => { const { h, s, l } = rgbToHsl(hexToRgb(hex)); return h >= 10 && h <= 50 && l < 0.48 && s < 1.0; };
      // prefer the RENDERED features (respect paint); fall back to the source set
      // when the zone sits outside the viewport (the gate must still cover it).
      let rendered = [];
      try { rendered = m.queryRenderedFeatures({ layers: ['tapestry-fill'] }); } catch (_) {}
      const seen = new Map(); // zoneKey -> zoneColor (one per warm zone)
      const scan = (feats) => {
        for (const f of feats) {
          const p = f.properties || {};
          if (!WARM_KEYS.has(p.zoneKey)) continue;
          if (p.zoneColor && !seen.has(p.zoneKey)) seen.set(p.zoneKey, p.zoneColor);
        }
      };
      scan(rendered);
      // ensure every warm zone is covered even if off-viewport
      scan(data.features);
      const offenders = [];
      let checked = 0;
      for (const [zone, color] of seen) { checked++; if (inBrownBand(color)) offenders.push(`${zone}=${color}`); }
      return { ok: offenders.length === 0 && checked > 0, checked, offenders, colors: [...seen.entries()].map(([z, c]) => `${z}:${c}`) };
    });
    check('(1d) NO BROWN on the rendered map — Africa / LatAm / Oceania fills are vivid red/orange/yellow, never brown (L20)',
      noBrown.ok,
      noBrown.reason ? noBrown.reason
        : `warmZonesChecked=${noBrown.checked} brownOffenders=${JSON.stringify(noBrown.offenders)} colors=${JSON.stringify(noBrown.colors)}`);

    // ── (1e) IDLE tapestry paints the zone-colors.json STRATEGY (/L29) ─
    // THE FIX THIS SLICE SHIPS: before, the idle tapestry-fill painted the rainbow
    // leafColor (the per-feature `zoneColor` property), and the region-
    // inherited strategy in zone-colors.json only appeared on CLICK. Now the idle
    // 'fill-color' match expression resolves every zone through colorForZone() — so
    // the strategy is visible WITHOUT any interaction. We read the ACTUAL painted
    // match expression off tapestry-fill (m.getPaintProperty) — NOT canvas pixels,
    // NOT the stamped property — and assert each sampled zone's painted arm equals
    // the zone-colors.json override (the strategy), AND differs from the rainbow
    // leafColor it replaced. This runs at IDLE: no click has happened yet. The
    // SAMPLE spans every region family the brief named: purple ME, red Africa,
    // green Europe, orange Oceania, yellow/amber LatAm, plus deaf (#18ffff).
    const SAMPLE_ZONES = [
      'middle-east-core', 'maghreb-egypt',          // ME — purple
      'central-africa', 'east-africa',              // Africa — red
      'europe',                                     // Europe — green
      'oceania-indonesia',                          // Oceania — orange
      'andean-caribbean', 'brazil',                 // LatAm — yellow/amber
      'deaf',                                       // deaf — neon cyan (preserved)
    ];
    // resolve each sample zone's painted arm out of the live ['match',…] expr
    const idlePaint = await page.evaluate((keys) => {
      const m = window.__UPG_MAP__;
      if (!m || !m.getLayer || !m.getLayer('tapestry-fill')) return { ok: false, reason: 'no-tapestry-layer' };
      const expr = m.getPaintProperty('tapestry-fill', 'fill-color');
      if (!Array.isArray(expr) || expr[0] !== 'match') return { ok: false, reason: 'fill-color-not-match-expr' };
      // expr = ['match', ['get','zoneKey'], k1,c1, k2,c2, …, fallback]
      const armColor = (key) => {
        for (let i = 2; i + 1 < expr.length; i += 2) { if (expr[i] === key) return expr[i + 1]; }
        return expr[expr.length - 1]; // fallback arm
      };
      // also grab the stamped rainbow zoneColor property per sample key (what idle
      // USED to show) so the gate can prove the painted hue actually CHANGED.
      const src = m.getSource && m.getSource('tapestry');
      const data = src && src._data;
      const stamped = {};
      if (data && Array.isArray(data.features)) {
        for (const f of data.features) {
          const p = f.properties || {};
          if (keys.includes(p.zoneKey) && !(p.zoneKey in stamped)) stamped[p.zoneKey] = p.zoneColor;
        }
      }
      const painted = {};
      for (const k of keys) painted[k] = armColor(k);
      return { ok: true, painted, stamped };
    }, SAMPLE_ZONES);

    let idleOk = idlePaint.ok;
    const idleRows = [];
    if (idlePaint.ok) {
      for (const z of SAMPLE_ZONES) {
        const expected = colorForZone(z, '__no_override__'); // strategy from zone-colors.json
        const painted = (idlePaint.painted[z] || '').toLowerCase();
        const want = (expected || '').toLowerCase();
        const stamped = (idlePaint.stamped[z] || '').toLowerCase();
        // painted idle hue MUST equal the zone-colors.json strategy …
        const matchesStrategy = !!want && want !== '__no_override__' && painted === want;
        // … and MUST NOT still be the old rainbow leafColor (zoneColor property).
        const changedFromRainbow = !stamped || painted !== stamped;
        const ok = matchesStrategy && changedFromRainbow;
        if (!ok) idleOk = false;
        idleRows.push(`${z}: painted=${painted} strategy=${want} oldRainbow=${stamped || 'n/a'} ${ok ? 'OK' : 'MISS'}`);
      }
    }
    check('(1e) IDLE tapestry paints the zone-colors.json strategy (no click) — painted fill == colorForZone, NOT rainbow leafColor (L18/L29 FIX)',
      idleOk,
      idlePaint.reason ? idlePaint.reason : idleRows.join(' | '));

    // ── (1f) Oceania idle == selected BASE hue (the L18 symptom is gone) ─────────
    // L18 was: Oceania+Indonesia changed color between idle and a click. Now both
    // idle and the selected BASE tapestry share ONE source (colorForZone) — selection
    // only overlays opacity/outline via upg-sel-fill, it does NOT change the base hue.
    // Proven by reading the painted oceania arm off tapestry-fill (idle) and the same
    // colorForZone(oceania) the selection BASE inherits — they must be byte-equal.
    const oceaniaIdle = (idlePaint.ok ? (idlePaint.painted['oceania-indonesia'] || '') : '').toLowerCase();
    const oceaniaStrategy = (colorForZone('oceania-indonesia', '') || '').toLowerCase();
    check('(1f) Oceania+Indonesia idle == selected base color (L18 symptom gone)',
      !!oceaniaIdle && oceaniaIdle === oceaniaStrategy,
      `idlePainted=${oceaniaIdle} selectedBase(colorForZone)=${oceaniaStrategy}`);

    // ── (2) FIRST toggle light→DARK: style flips + polygons/pins survive ───────
    // From a LIGHT boot the FIRST toggle goes light→dark (the old code always
    // booted dark, so the first move used to be dark→light). This proves nothing
    // assumed the boot theme: handleToggleTheme flips isDark false→true → setStyle
    // dark-v11 → style.load re-adds tapestry/pins/isolation. The ThemeToggleButton
    // is the .mcb control with data-control="theme" — untranslatable,
    // unlike the "Switch to …" title this used to match, which is localized AND dynamic.
    const themeBtn = page.locator(`${EL} button.mcb[data-control="theme"]`);
    let toggled = false;
    if (await themeBtn.count()) {
      await themeBtn.first().click().catch(() => {});
      toggled = true;
    }
    await page.waitForTimeout(2500); // setStyle wipes + re-adds layers async
    await waitTapestryReady(page);
    const painted2 = await tapestryFeatureCount(page);
    const darkTheme = await mapStyleTheme(page);
    await page.screenshot({ path: join(SHOTS, '02-after-toggle-dark.png') });
    check('(2) FIRST toggle (light→DARK): style becomes dark-v11 AND polygons survive',
      toggled && darkTheme === 'dark' && painted2 > 0,
      `toggled=${toggled} style=${darkTheme} features=${painted2}`);

    // ── (2c) 09b-9 legend follows theme — after light→DARK toggle: legend DARK ──
    // data-theme should drop to 'dark' and the panel bg return to the component's
    // own dark chrome (#161b22 == rgb(22,27,34)) — NOT a light color.
    const legDark = await legendPanelStyle(page);
    check('(2c) after light→DARK toggle the legend panel is DARK again',
      legDark.found && legDark.dataTheme === 'dark' && !isLightBg(legDark.bg),
      `data-theme=${legDark.dataTheme} bg=${legDark.bg}`);

    // ── (2b) SECOND toggle dark→LIGHT: style flips back + polygons survive ─────
    // Proves the full cycle light→dark→light from a light boot (qa §1e-3).
    let toggled2 = false;
    if (await themeBtn.count()) {
      await themeBtn.first().click().catch(() => {});
      toggled2 = true;
    }
    await page.waitForTimeout(2500);
    await waitTapestryReady(page);
    const painted2b = await tapestryFeatureCount(page);
    const lightAgain = await mapStyleTheme(page);
    await page.screenshot({ path: join(SHOTS, '02b-toggle-back-light.png') });
    check('(2b) SECOND toggle (dark→LIGHT): style back to light-v11 AND polygons survive',
      toggled2 && lightAgain === 'light' && painted2b > 0,
      `toggled=${toggled2} style=${lightAgain} features=${painted2b}`);

    // ── (2d) 09b-9 legend follows theme — after dark→LIGHT toggle: legend LIGHT ─
    // Completes the cycle light→dark→light: the legend must be LIGHT again.
    const legLightAgain = await legendPanelStyle(page);
    await page.screenshot({ path: join(SHOTS, 'legend-light-again.png') }).catch(() => {});
    check('(2d) after dark→LIGHT toggle the legend panel is LIGHT again',
      legLightAgain.found && legLightAgain.dataTheme === 'light' && isLightBg(legLightAgain.bg),
      `data-theme=${legLightAgain.dataTheme} bg=${legLightAgain.bg}`);

    // ── (3) the 6 dissolved "Frontier Asia (uncovered)" stub rows are GONE ──────
    // 09b-asia-contiguity-v2: the brief joined the frontier-uncovered stubs to
    // their new groups and REMOVED them from the uncovered list. The legend must
    // NO LONGER show: Nepal / Bhutan + Bangladesh / Mongolia / Japan / Afghanistan
    // + Pakistan / Central Asia. Their coverage now rides IN-A / IN-D / NAS-B (as
    // extraCountryCodes) and the merged `uncovered-nas-a` zone. The "Frontier Asia"
    // parent should now hold only the merged NAS-A row + Scattered/Diaspora.
    await expandRow(page, 'Frontier Asia');
    await page.waitForTimeout(300);
    const DISSOLVED_STUB_LABELS = [
      'Nepal',
      'Bhutan + Bangladesh',
      'Mongolia',
      'Japan',
      'Afghanistan + Pakistan',
      'Central Asia',
    ];
    const stubsStillPresent = [];
    for (const lbl of DISSOLVED_STUB_LABELS) {
      // exact-label match within a legend row (hasText is substring; guard the two
      // that are prefixes of nothing else — these labels are unique enough as-is).
      const cnt = await legendRow(page, lbl).count();
      if (cnt > 0) stubsStillPresent.push(`${lbl}(${cnt})`);
    }
    await page.screenshot({ path: join(SHOTS, '03-frontier-stubs-gone.png') }).catch(() => {});
    check('(3) the 6 dissolved uncovered legend rows are GONE (Nepal / Bhutan+Bangladesh / Mongolia / Japan / Afghanistan+Pakistan / Central Asia)',
      stubsStillPresent.length === 0, `still-present=${JSON.stringify(stubsStillPresent)}`);

    // (3a) the new merged NAS-A frontier row IS present (label starts with "Pakistan + Afghanistan")
    const nasaRow = legendRow(page, 'Pakistan + Afghanistan');
    check('(3a) the merged NAS-A frontier legend row is present (Pakistan + Afghanistan + Uzbekistan + …)',
      (await nasaRow.count()) > 0, `nas-a-row found=${await nasaRow.count()}`);

    // (3a2) Scattered / Diaspora catch-all REMAINS (Brief: KEEP uncovered-scatter)
    const scatterRow = legendRow(page, 'Scattered');
    check('(3a2) Scattered / Diaspora catch-all row remains',
      (await scatterRow.count()) > 0, `scatter-row found=${await scatterRow.count()}`);

    // clear any filter before the next isolate
    await page.evaluate(() => { const m = window.__UPG_MAP__; if (m && m.getLayer('tapestry-fill')) { m.setFilter('tapestry-fill', null); m.setFilter('tapestry-line', null); } });
    await page.waitForTimeout(500);

    // ── (3b) isolate an INDIA cluster (resolves geometry) ──────────────────────
    // India clusters sit under "Asia (admin-1)" ▸ "India". Expand Asia, then click
    // the India PARENT row to isolate the whole India set. NOTE: 2 India ADM1
    // zones (odisha, assam) + 2 China zones (yunnan, tibet) currently resolve 0
    // polygons due to a stale ADM1 listId tagging from 09b-3/09b-4 (see BT
    // blocker) — but the OTHER India leaves (Rajasthan 7, Gujarat 4, …) DO
    // resolve, so isolating the India set still yields features and proves
    // cluster-isolation works for resolved zones.
    await expandRow(page, 'Asia (admin-1)');
    const india = legendRow(page, 'India');
    let indiaOk = false, indiaCount = -1;
    if (await india.count()) {
      await india.first().click().catch(() => {});
      await page.waitForTimeout(1500);
      indiaCount = await isolatedFeatureCount(page);
      indiaOk = indiaCount >= 1;
      await page.screenshot({ path: join(SHOTS, '04-india.png') });
    } else {
      await page.screenshot({ path: join(SHOTS, '04-india.png') });
    }
    check('(3b) India cluster isolates (resolved ADM1 zones present)',
      indiaOk, `india-parent found=${await india.count() > 0} isolated-features=${indiaCount}`);

    await page.evaluate(() => { const m = window.__UPG_MAP__; if (m && m.getLayer('tapestry-fill')) { m.setFilter('tapestry-fill', null); m.setFilter('tapestry-line', null); } });
    await page.waitForTimeout(500);

    // ── (3c) isolate the CHINA cluster — NOW GATING (09b-7 re-tagged the ADM1) ──
    // Pre-09b-7 both China zones (yunnan, tibet) resolved 0 ADM1 polys (stale
    // listId), so this was a NON-GATING advisory. 09b-7 re-tagged the geojson, so
    // the China parent MUST now isolate ≥1 polygon — promoted to a hard check.
    const china = legendRow(page, 'China');
    let chinaCount = -1, chinaRowFound = false;
    if (await china.count()) {
      chinaRowFound = true;
      await china.first().click().catch(() => {});
      await page.waitForTimeout(1500);
      chinaCount = await isolatedFeatureCount(page);
      await page.screenshot({ path: join(SHOTS, '05-china.png') });
    } else {
      await page.screenshot({ path: join(SHOTS, '05-china.png') });
    }
    check('(3c) China cluster isolates ≥1 polygon (09b-7 re-tag — was 0 pre-fix)',
      chinaRowFound && chinaCount >= 1, `china-parent found=${chinaRowFound} isolated-features=${chinaCount}`);

    await page.evaluate(() => { const m = window.__UPG_MAP__; if (m && m.getLayer('tapestry-fill')) { m.setFilter('tapestry-fill', null); m.setFilter('tapestry-line', null); } });

    // ── (5) the 4 PREVIOUSLY-BLANK zones now isolate ≥1 polygon (09b-7 §1d) ─────
    // Click each renamed cluster's leaf row by its visible label and assert it
    // isolates ≥1 polygon (was 0 before the re-tag). India leaves live under
    // "Asia (admin-1)" ▸ "India"; China leaves under ▸ "China". Re-expand both
    // (setStyle/filter churn may have collapsed them) before clicking leaves.
    await expandRow(page, 'Asia (admin-1)');
    await expandRow(page, 'India');
    await isolateLeafAndAssert(page, 'Odisha', 'asia-india-odisha');
    // 09b-asia-contiguity-v2: asia-india-assam was dissolved (its NE members
    // migrated into asia-india-west-bengal, the IN-D successor — commit f5557c3).
    // Follow the successor row so the NE-frontier still gates ≥1 poly.
    await isolateLeafAndAssert(page, 'West Bengal', 'asia-india-west-bengal');
    await expandRow(page, 'China');
    await isolateLeafAndAssert(page, 'Yunnan Province', 'asia-china-yunnan-province');
    await isolateLeafAndAssert(page, 'Tibet Autonomous Region', 'asia-china-tibet-autonomous-region');
    await clearFilter(page);

    // ── (4) controls present in DOM (zoom, theme, fullscreen) ──────────────────
    // ★ QUERY data-control, NEVER THE TITLE. Each wrapper writes
    // data-control="zoom-in|zoom-out|fullscreen|theme|location|help|share" on
    // MapControlButton; it is not a declared prop, so it falls through onto the
    // rendered <button>. Untranslatable, so this works in every locale.
    //
    // This REPLACES a shim that resolved the expected strings out of
    // library/i18n/locales/en/buttons.json. That shim was locale-correct but it made
    // MY gate depend on a key name in STUDIO's catalogue — a rename there would have
    // broken a check here, across an ownership boundary. data-control removes that.
    //
    // The theme button gains the most: its title is DYNAMIC ("Switch to dark" /
    // "Switch to light"), so no single key ever resolved it and it was stuck on a
    // prefix match against English prose. data-control="theme" is fixed identity
    // regardless of toggle state or locale, so its `=== 1` now means what it says.
    const ctl = (name) => `${EL} button.mcb[data-control="${name}"]`;
    const zoomIn = await page.locator(ctl('zoom-in')).count();
    const zoomOut = await page.locator(ctl('zoom-out')).count();
    const fullscreen = await page.locator(ctl('fullscreen')).count();
    const theme = await page.locator(ctl('theme')).count();
    const mcbCount = await page.locator(`${EL} button.mcb`).count();
    check('(4) map controls present in DOM (zoom + theme + fullscreen)',
      zoomIn > 0 && zoomOut > 0 && fullscreen > 0 && theme === 1,
      `zoomIn=${zoomIn} zoomOut=${zoomOut} fullscreen=${fullscreen} theme=${theme} (.mcb total=${mcbCount})`);

    // ── (6) slice 13: pin click → PeopleGroupDetail side panel opens ───────────
    // Clear any isolation so all pins paint, then find a rendered 'upg-pins'
    // feature's screen coords via queryRenderedFeatures and dispatch a real
    // Mapbox click there. Assert the .pg-detail-root wrapper appears in the
    // shadow DOM and shows a people-group name; then assert the component's
    // close button hides it (handleClose → uiStore.selectPeopleGroup(null)).
    await clearFilter(page);
    await page.waitForTimeout(600);

    // Find a rendered 'upg-pins' feature and dispatch the click through Mapbox's
    // OWN event pipeline (m.fire('click', …)) so the layer-scoped click handler
    // (attachPinHandlers) runs. This is viewport- and shadow-DOM-independent — a
    // raw page.mouse.click at projected px is unreliable because the canvas lives
    // inside the shadow root and pins are ~3px (per the memory note: assert via
    // map.queryRenderedFeatures + map events, NOT pixel clicks).
    const pinHit = await page.evaluate(() => {
      const m = window.__UPG_MAP__;
      if (!m || !m.getLayer || !m.getLayer('upg-pins')) return null;
      const feats = m.queryRenderedFeatures({ layers: ['upg-pins'] });
      if (!feats || !feats.length) return null;
      // pick a feature that carries a name (stamped in slice 13) so the panel
      // header has something to show.
      const f = feats.find((x) => x.properties && x.properties.name) || feats[0];
      const lngLat = f.geometry && f.geometry.coordinates;
      if (!lngLat) return null;
      const point = m.project(lngLat);
      m.fire('click', { lngLat: { lng: lngLat[0], lat: lngLat[1] }, point, originalEvent: {} });
      return { slug: f.properties.slug || '', name: f.properties.name || '' };
    });

    let panelOpened = false, panelName = '', panelHadDetail = false;
    if (pinHit) {
      await page.waitForTimeout(1200);
      // assert the panel root appeared (Playwright pierces open shadow roots)
      const panel = page.locator(`${EL} .pg-detail-root`);
      panelOpened = (await panel.count()) > 0;
      if (panelOpened) {
        // the header name / name-lead should carry text (the clicked pin's name)
        panelName = (await panel.first().innerText().catch(() => '')) || '';
        panelHadDetail = panelName.trim().length > 0;
      }
      await page.screenshot({ path: join(SHOTS, '07-pin-detail.png') }).catch(() => {});
    } else {
      await page.screenshot({ path: join(SHOTS, '07-pin-detail.png') }).catch(() => {});
    }
    check('(6) pin click opens PeopleGroupDetail side panel with a name',
      panelOpened && panelHadDetail,
      `pin=${pinHit ? (pinHit.slug || pinHit.name) : 'NONE'} panelOpened=${panelOpened} text=${JSON.stringify(panelName.slice(0, 60))}`);

    // ── (7) slice 13: clicking the panel close button hides it ────────────────
    // Dispatch the close via a real DOM .click() on the component's own
    // .close-button (handleClose → uiStore.selectPeopleGroup(null) → the panel's
    // v-if collapses). We use a DOM-level click() inside page.evaluate rather
    // than a Playwright locator.click() because the panel's slide-in animation +
    // shadow-root containment make Playwright's actionability wait flaky on the
    // 28×32px button — the DOM click fires the same Vue @click handler reliably
    // and is what a user's tap ultimately triggers.
    let panelClosed = false, closeBtnFound = false;
    if (panelOpened) {
      closeBtnFound = await page.evaluate((elName) => {
        const host = document.querySelector(elName);
        const root = host && host.shadowRoot ? host.shadowRoot : document;
        const btn = root.querySelector('.pg-detail-root .close-button');
        if (!btn) return false;
        btn.click();
        return true;
      }, EL);
      await page.waitForTimeout(900);
      panelClosed = (await page.locator(`${EL} .pg-detail-root`).count()) === 0;
    }
    check('(7) close button clears the detail panel (uiStore.selectPeopleGroup(null))',
      closeBtnFound && panelClosed, `closeBtnFound=${closeBtnFound} panelStillPresent=${!panelClosed}`);

    // ── (8) 09b-search-bar §1(f): the unified search index is built + covers all
    // three kinds (PG + zone + territory). Read the coverage off the live handle
    // (window.__UPG_SEARCH__.counts()) — NO-IMAGES: assert via JS, not the PNG.
    await clearFilter(page);
    await page.waitForTimeout(400);
    const idx = await page.evaluate(() => {
      const s = window.__UPG_SEARCH__;
      if (!s) return null;
      return { size: s.size(), counts: s.counts() };
    });
    check('(8) search index built with PG + zone + territory rows',
      idx && idx.size > 0 && idx.counts.pg > 0 && idx.counts.zone > 0 && idx.counts.territory > 0,
      idx ? `total=${idx.size} pg=${idx.counts.pg} zone=${idx.counts.zone} territory=${idx.counts.territory}` : 'NO __UPG_SEARCH__ handle');

    // ── (9) 09b-search-reuse-geocoder §1(b): the search UI is the SHARED
    // GeocoderComponent (mapbox-gl-geocoder), NOT the hand-rolled .upg-search.
    // Assert (a) the .mapboxgl-ctrl-geocoder element EXISTS, (b) the deleted
    // .upg-search input is GONE (de-duplication proof), (c) the geocoder sits
    // ABOVE the legend (.stl-panel) — geocoder.top < legend.top in the shadow DOM.
    // NO-IMAGES: getBoundingClientRect comparisons, not pixel reads.
    const geoDom = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const geo = root.querySelector('.mapboxgl-ctrl-geocoder');
      const geoInput = root.querySelector('.mapboxgl-ctrl-geocoder--input');
      const legend = root.querySelector('.stl-panel') || root.querySelector('.stl-inner');
      const oldInput = root.querySelector('.upg-search-input'); // must be GONE
      const gr = geo ? geo.getBoundingClientRect() : null;
      const lr = legend ? legend.getBoundingClientRect() : null;
      return {
        hasGeocoder: !!geo,
        hasGeoInput: !!geoInput,
        oldSearchGone: !oldInput,
        geoTop: gr ? gr.top : null,
        legendTop: lr ? lr.top : null,
        aboveLegend: gr && lr ? gr.top < lr.top : null,
      };
    }, EL);
    await page.screenshot({ path: join(SHOTS, '10-geocoder.png') }).catch(() => {});
    check('(9) search UI is the SHARED GeocoderComponent (mapbox-gl-geocoder), hand-rolled .upg-search REMOVED, ABOVE the legend',
      geoDom.hasGeocoder && geoDom.hasGeoInput && geoDom.oldSearchGone && geoDom.aboveLegend === true,
      `hasGeocoder=${geoDom.hasGeocoder} hasGeoInput=${geoDom.hasGeoInput} oldSearchGone=${geoDom.oldSearchGone} geoTop=${geoDom.geoTop} legendTop=${geoDom.legendTop} aboveLegend=${geoDom.aboveLegend}`);

    // ── (9b) typing a known PG name into the REAL shared geocoder input surfaces
    // a suggestion row (so a user typing the PG name sees it in the shared UI).
    // Pick the PG label from the live index so the probe isn't tied to a stale slug.
    const knownPg = await page.evaluate(() => {
      const s = window.__UPG_SEARCH__;
      if (!s) return null;
      const frags = ['Brahmin', 'Rajput', 'Yadav', 'Jat', 'Kurd', 'Hui', 'Han', 'Arab', 'Tamil', 'Bengali', 'Pashtun', 'Sayyid', 'Shaikh'];
      for (const fr of frags) {
        const hit = s.query(fr).find((r) => r.kind === 'pg');
        if (hit) return { label: hit.label, target: hit.target };
      }
      for (const c of 'abcdefghijklmnopqrstuvwxyz') {
        const hit = s.query(c).find((r) => r.kind === 'pg');
        if (hit) return { label: hit.label, target: hit.target };
      }
      return null;
    });
    let geoSuggestOk = false, geoSuggestDetail = '';
    if (knownPg) {
      const input = page.locator(`${EL} .mapboxgl-ctrl-geocoder--input`).first();
      const hasInput = await input.count();
      if (hasInput) {
        // first token of the PG name → enough to surface a local suggestion.
        const token = String(knownPg.label).split(/[\s,]+/)[0] || knownPg.label;
        await input.click().catch(() => {});
        await input.fill('').catch(() => {});
        await input.type(token, { delay: 12 }).catch(() => {});
        await page.waitForTimeout(1600); // geocoder debounce + remote round-trip + render
        // L4 (LESSON-03): mapbox-gl-geocoder v5 renders the dropdown as
        // `.suggestions-wrapper > ul.suggestions` — there is NO
        // `.mapboxgl-ctrl-geocoder--suggestions` element in v5; the old selector
        // counted 0 forever even while the dropdown was visibly populated.
        const suggCount = await page.locator(`${EL} .suggestions-wrapper .suggestions li, ${EL} .mapboxgl-ctrl-geocoder--suggestions li`).count().catch(() => 0);
        geoSuggestOk = suggCount > 0;
        geoSuggestDetail = `token="${token}" suggestions=${suggCount}`;
        await input.fill('').catch(() => {}); // clear before the headless fly tests
        await page.waitForTimeout(200);
      } else {
        geoSuggestDetail = 'no .mapboxgl-ctrl-geocoder--input';
      }
    }
    check('(9b) typing a PG name in the shared geocoder surfaces a local suggestion row',
      geoSuggestOk, geoSuggestDetail);

    // ── (10) select a PG via search → the map FLEW toward the PG + detail opened ─
    // Drives __UPG_SEARCH__.select() which routes through the SAME flyToTarget the
    // geocoder's @people-group-result handler (onGeocoderResult) uses, so this
    // proves the geocoder→fly+detail wiring (mobile-friendliness is inherited from
    // the shared GeocoderComponent / mapbox-gl-geocoder, noted in §1b). Capture the
    // center before, select the SAME PG, then assert (a) the map center moved
    // toward the PG's [lng,lat] and (b) the .pg-detail-root panel opened (S-D3).
    // NO-IMAGES: getCenter + DOM, no PNG read.
    let pgFlew = false, pgDetailOpened = false, pgFlyDetail = '';
    if (knownPg && knownPg.target && knownPg.target.type === 'pg') {
      const before = await page.evaluate(() => {
        const m = window.__UPG_MAP__; const c = m.getCenter(); return { lng: c.lng, lat: c.lat };
      });
      const sel = await page.evaluate((label) => {
        const s = window.__UPG_SEARCH__;
        return s ? s.select(label) : null;
      }, knownPg.label);
      await page.waitForTimeout(1200); // let flyTo settle
      const after = await page.evaluate(() => {
        const m = window.__UPG_MAP__; const c = m.getCenter(); return { lng: c.lng, lat: c.lat };
      });
      const tgt = knownPg.target;
      // moved AND moved toward the target (distance-to-target shrank).
      const moved = Math.abs(after.lng - before.lng) > 0.01 || Math.abs(after.lat - before.lat) > 0.01;
      const dBefore = Math.hypot(before.lng - tgt.lng, before.lat - tgt.lat);
      const dAfter = Math.hypot(after.lng - tgt.lng, after.lat - tgt.lat);
      pgFlew = moved && dAfter <= dBefore + 0.001;
      pgDetailOpened = (await page.locator(`${EL} .pg-detail-root`).count()) > 0;
      pgFlyDetail = `sel=${sel ? JSON.stringify(sel.label) : 'null'} before=[${before.lng.toFixed(2)},${before.lat.toFixed(2)}] after=[${after.lng.toFixed(2)},${after.lat.toFixed(2)}] target=[${tgt.lng.toFixed(2)},${tgt.lat.toFixed(2)}] dBefore=${dBefore.toFixed(2)} dAfter=${dAfter.toFixed(2)}`;
    }
    await page.screenshot({ path: join(SHOTS, '09-search-pg-fly.png') }).catch(() => {});
    check('(10) selecting a PG via search FLEW the map toward it AND opened the detail panel',
      pgFlew && pgDetailOpened, `flew=${pgFlew} detailOpened=${pgDetailOpened} ${pgFlyDetail}`);

    // close the detail panel before the zone test (so its open state doesn't leak).
    await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const btn = root.querySelector('.pg-detail-root .close-button');
      if (btn) btn.click();
    }, EL).catch(() => {});
    await page.waitForTimeout(500);

    // ── (11) select a ZONE via search (e.g. "Deaf") → the map fitBounds CHANGED ──
    // Zones fitBounds (no fly-to-point). Capture center+zoom before, select the
    // Deaf zone via search, assert the camera changed (center OR zoom moved).
    let zoneFlew = false, zoneDetail = '';
    {
      const cam0 = await page.evaluate(() => {
        const m = window.__UPG_MAP__; const c = m.getCenter(); return { lng: c.lng, lat: c.lat, z: m.getZoom() };
      });
      const zsel = await page.evaluate(() => {
        const s = window.__UPG_SEARCH__;
        if (!s) return null;
        // prefer an exact zone match; "Deaf" matches the unified deaf zone label.
        const hit = s.query('Deaf').find((r) => r.kind === 'zone')
          || s.query('Deaf')[0] || null;
        if (!hit) return null;
        return s.select(hit.label);
      });
      await page.waitForTimeout(1400); // fitBounds animation
      const cam1 = await page.evaluate(() => {
        const m = window.__UPG_MAP__; const c = m.getCenter(); return { lng: c.lng, lat: c.lat, z: m.getZoom() };
      });
      const moved = Math.abs(cam1.lng - cam0.lng) > 0.05 || Math.abs(cam1.lat - cam0.lat) > 0.05 || Math.abs(cam1.z - cam0.z) > 0.05;
      zoneFlew = !!zsel && moved;
      zoneDetail = `zsel=${zsel ? JSON.stringify(zsel.label) : 'null'} before=[${cam0.lng.toFixed(2)},${cam0.lat.toFixed(2)},z${cam0.z.toFixed(2)}] after=[${cam1.lng.toFixed(2)},${cam1.lat.toFixed(2)},z${cam1.z.toFixed(2)}]`;
    }
    await page.screenshot({ path: join(SHOTS, '09-search-zone-fly.png') }).catch(() => {});
    check('(11) selecting a ZONE via search fitBounds → the map camera CHANGED (flew to zone)',
      zoneFlew, zoneDetail);

    // ── (13) toolA R1.2: BATCH-mode + plain tap on 3 territories → running total ──
    // R1.2 PIVOT: the selection gesture is now "tap the Batch Select button → enter
    // batch mode → plain tap (NO shiftKey) toggles a territory". R1.4 (L4): the
    // SINGLE entry point is the map-rail .upg-rail-batch — this check TAPS it
    // (proving the rail button drives batch mode), asserts the old HUD
    // .upg-batch-btn is GONE and the HUD only appears AFTER engaging, then replays
    // REAL PLAIN clicks (originalEvent:{} — NO modifier key) through mapbox's own pipeline
    // (m.fire('click',…) — the delegated pattern check (6) proved for pins). The
    // expected total is recomputed in NODE from territory-counts.js — independent of
    // the page (the gate must be able to fail).
    //
    // L8 FIX (LESSON-03) carried forward: fitBounds India first (34 dense ADM1 +
    // neighbouring ADM0) so territories are on-screen, and the click point is
    // m.project(centroid) — the SAME real-Point form check (6) uses (a raw {x,y}
    // throws "sub undefined" inside fire's internal qRF). Can still fail: if no 3
    // distinct territories resolve, batch mode didn't engage, or the running total ≠
    // the independent Node Σ, the check reports err / a mismatch.
    await clearFilter(page);
    await page.evaluate(() => { const s = window.__UPG_SELECT__; if (s) s.clear(); });
    // R1.4 (a′/f′ + L4): enter batch mode by TAPPING the SINGLE rail Batch Select
    // button (no setBatchMode shortcut here so the button itself is the exercised
    // surface). Progressive-disclosure assertions: the old HUD .upg-batch-btn must
    // be GONE (0 in the DOM), exactly ONE .upg-rail-batch exists, the .upg-hud is
    // ABSENT before engaging and PRESENT after.
    const batchBtnTapped = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const hudButtons = root.querySelectorAll('.upg-batch-btn').length;   // must be 0 (R1.4)
      const railButtons = root.querySelectorAll('.upg-rail-batch').length; // must be 1
      const hudBefore = !!root.querySelector('.upg-hud');                  // must be false
      const btn = root.querySelector('.map-toolbar .upg-rail-batch');
      if (!btn) return { found: false, hudButtons, railButtons, hudBefore };
      btn.click();
      return { found: true, hudButtons, railButtons, hudBefore };
    }, EL);
    await page.waitForTimeout(300);
    const batchOn = await page.evaluate(() => {
      const s = window.__UPG_SELECT__; return s ? !!s.batchMode : false;
    });
    const hudAfterEngage = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      return !!root.querySelector('.upg-hud');
    }, EL);
    check('(13a) toolA R1.4: the SINGLE rail Batch button engages batch mode; HUD appears ONLY after (no HUD batch button anywhere)',
      batchBtnTapped.found && batchOn && batchBtnTapped.hudButtons === 0
        && batchBtnTapped.railButtons === 1 && batchBtnTapped.hudBefore === false
        && hudAfterEngage === true,
      `rail-found=${batchBtnTapped.found} batchMode=${batchOn} hudBatchBtns(must0)=${batchBtnTapped.hudButtons} ` +
      `railBtns(must1)=${batchBtnTapped.railButtons} hudBefore(mustFalse)=${batchBtnTapped.hudBefore} hudAfter=${hudAfterEngage}`);
    // fitBounds a KNOWN dense region (India + neighbours) so the viewport actually
    // contains clickable tapestry territories, undoing check (11)'s deaf-zone camera.
    await page.evaluate(async () => {
      const m = window.__UPG_MAP__;
      if (m) { m.fitBounds([[68.0, 6.5], [97.5, 35.7]], { padding: 30, duration: 0, maxZoom: 6 }); }
    });
    await page.waitForTimeout(1200); // fitBounds settle (duration:0 + tile/paint)
    const shiftSel = await page.evaluate(async () => {
      const m = window.__UPG_MAP__;
      const s = window.__UPG_SELECT__;
      if (!m || !s) return { err: 'no __UPG_MAP__ / __UPG_SELECT__ handle' };
      // viewport-wide qRF (no point) → rendered tapestry features now in view; for
      // each new territory project an interior centroid to a REAL Point and verify
      // it actually hits the fill layer (skip holes) and carries no pin on top.
      const feats = m.queryRenderedFeatures({ layers: ['tapestry-fill'] });
      const picked = []; const seen = new Set();
      for (const f of feats) {
        const p = f.properties || {};
        const key = p.shapeName ? 'adm1:' + p.shapeName : (p.iso3 ? 'adm0:' + p.iso3 : null);
        if (!key || seen.has(key)) continue;
        const g = f.geometry; if (!g) continue;
        const coords = [];
        const walk = (c) => { if (typeof c[0] === 'number') coords.push(c); else c.forEach(walk); };
        walk(g.coordinates);
        if (!coords.length) continue;
        const avg = coords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]).map((v) => v / coords.length);
        const point = m.project(avg); // REAL mapbox Point — required by fire's qRF
        let hit = []; try { hit = m.queryRenderedFeatures(point, { layers: ['tapestry-fill'] }); } catch (_) {}
        if (!hit.length) continue; // centroid fell in a hole / outside the polygon
        let pins = []; try { pins = m.queryRenderedFeatures(point, { layers: [m.getLayer('upg-pins-hit') ? 'upg-pins-hit' : 'upg-pins'] }); } catch (_) {}
        if (pins.length) continue; // a pin's tap target (the invisible 'upg-pins-hit' twin) is here → a click would open the detail panel
        seen.add(key);
        picked.push({ point, props: { shapeName: p.shapeName || null, iso3: p.iso3 || null } });
        if (picked.length === 3) break;
      }
      if (picked.length < 3) return { err: 'found only ' + picked.length + ' distinct territories in viewport' };
      for (const t of picked) {
        // R1.2: PLAIN tap — originalEvent:{} carries NO shiftKey (proves the
        // selection no longer depends on a modifier; batch mode is already ON).
        m.fire('click', { lngLat: m.unproject(t.point), point: t.point, originalEvent: {} });
      }
      return {
        clicked: picked.map((t) => t.props),
        count: s.count, total: s.total,
        list: s.list.map((x) => ({ key: x.key, name: x.name, count: x.count })),
      };
    });
    let expectSum = -1, hudTotalText = '';
    if (!shiftSel.err) {
      // INDEPENDENT recompute (Node-side tables; the page never sees this number)
      expectSum = shiftSel.clicked.reduce((a, p) => {
        const t = resolveTerritory(p);
        return a + ((t && Number(t.count)) || 0);
      }, 0);
      await page.waitForTimeout(400); // Vue nextTick → HUD DOM update
      hudTotalText = (await page.locator(`${EL} .upg-hud-total`).first().innerText().catch(() => '')) || '';
    }
    await page.screenshot({ path: join(SHOTS, '11-batch-select.png') }).catch(() => {});
    check('(13) toolA R1.2: BATCH-mode plain tap (NO shiftKey) on 3 territories batch-selects + running total == independent Σ + HUD shows it',
      !shiftSel.err && shiftSel.count === 3 && shiftSel.total === expectSum && expectSum > 0
        && hudTotalText.trim() === `${expectSum} UUPG`,
      shiftSel.err ? shiftSel.err :
        `clicked=[${shiftSel.list.map((x) => x.name + ':' + x.count).join(', ')}] total=${shiftSel.total} expectedΣ=${expectSum} hud="${hudTotalText.trim()}"`);

    // ── (14) toolA R1.1 (g): pick a swatch → selected territories PAINT that color ──
    // Click the #0072b2 preset (DOM click inside the shadow root — same rationale as
    // check (7): animation + shadow containment make locator clicks flaky on tiny
    // buttons). Assert the live upg-sel-fill paint took the hue AND the selection
    // layer actually renders features (the preview recolor is visible).
    const swatchClicked = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const sw = root.querySelector('.upg-swatch[data-color="#0072b2"]');
      if (!sw) return false;
      sw.click();
      return true;
    }, EL);
    await page.waitForTimeout(600);
    const colorState = await page.evaluate(() => {
      const m = window.__UPG_MAP__; const s = window.__UPG_SELECT__;
      if (!m || !s || !m.getLayer || !m.getLayer('upg-sel-fill')) return { err: 'no upg-sel-fill layer' };
      const fill = m.getPaintProperty('upg-sel-fill', 'fill-color');
      const opacity = m.getPaintProperty('upg-sel-fill', 'fill-opacity');
      let rendered = 0; try { rendered = m.queryRenderedFeatures({ layers: ['upg-sel-fill'] }).length; } catch (_) {}
      return { handleColor: s.color, fill: String(fill), opacity, rendered };
    });
    await page.screenshot({ path: join(SHOTS, '12-color-pick.png') }).catch(() => {});
    check('(14) toolA R1.1: picking a swatch preview-recolors the selection (upg-sel-fill paints #0072b2 on rendered features)',
      swatchClicked && !colorState.err && colorState.handleColor === '#0072b2'
        && colorState.fill.toLowerCase().includes('0072b2') && colorState.rendered > 0,
      colorState.err || `swatchClicked=${swatchClicked} handleColor=${colorState.handleColor} fill=${colorState.fill} opacity=${colorState.opacity} renderedSelFeatures=${colorState.rendered}`);

    // ── (15) REMOVED 2026-09-28: the Copy payload assertion. It guarded on
    //    .upg-hud-btn.copy existing, but that button went with fc93847bb (batch
    //    selection builds a packet now). The guard skipped only the MEASUREMENT —
    //    copyOk was initialised false and check() ran unconditionally — so this
    //    reported FAIL ("no .upg-hud-btn.copy in HUD") on every run since. A
    //    permanently red assertion for a deleted feature teaches readers to ignore
    //    red, which is worse than no check. Its handler (copySelection/legacyCopy)
    //    and the window.__UPG_LAST_CLIPBOARD__ it read are deleted in the same
    //    commit. formatClipboard survives: __UPG_SELECT__.clipboardText still uses it.

    // ── (16) toolA R1.4 (a‴/f′ + L4): batch mode OFF → a PLAIN tap is NOT a
    // multi-select AND not a clear. Tap the RAIL button again ("Done") to LEAVE
    // batch mode (D-7: selection STATE kept until Clear) — R1.4 progressive
    // disclosure: ZERO batch chrome remains (no HUD, no marked legend rows, no
    // rendered highlight features). Then a plain map-fill tap is a NO-OP for the
    // selection, the legend single-zone isolate still works, and RE-ENTERING batch
    // mode re-reveals the kept selection. NO shiftKey anywhere. L8 real-Point
    // requirement preserved (m.project centroid).
    const batchOff = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const btn = root.querySelector('.map-toolbar .upg-rail-batch');
      if (btn) btn.click(); // toggle batch mode OFF via the SINGLE rail button
      const s = window.__UPG_SELECT__;
      return { off: s ? s.batchMode === false : false, keptSelection: s ? s.count : -1 };
    }, EL);
    await page.waitForTimeout(400);
    const chromeOff = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const s = window.__UPG_SELECT__; const m = window.__UPG_MAP__;
      let rendered = -1;
      try { rendered = m.queryRenderedFeatures({ layers: ['upg-sel-fill'] }).length; } catch (_) {}
      return {
        hud: !!root.querySelector('.upg-hud'),                        // must be false
        marked: s ? s.markedLegendRows().length : -1,                 // must be 0
        rendered,                                                     // must be 0
      };
    }, EL);
    check('(16a) toolA R1.4: rail "Done" leaves batch mode, KEEPS the selection (D-7), and ZERO batch chrome remains (no HUD / legend markers / map highlight)',
      batchOff.off && batchOff.keptSelection === 3 && chromeOff.hud === false
        && chromeOff.marked === 0 && chromeOff.rendered === 0,
      `batchModeOff=${batchOff.off} selectionKept=${batchOff.keptSelection} hud(mustFalse)=${chromeOff.hud} ` +
      `markedRows(must0)=${chromeOff.marked} renderedHighlight(must0)=${chromeOff.rendered}`);
    const plainTap = await page.evaluate(() => {
      const m = window.__UPG_MAP__; const s = window.__UPG_SELECT__;
      if (!m || !s) return { fired: false, countAfter: -1 };
      const feats = m.queryRenderedFeatures({ layers: ['tapestry-fill'] });
      for (const f of feats) {
        const g = f.geometry; if (!g) continue;
        const coords = [];
        const walk = (c) => { if (typeof c[0] === 'number') coords.push(c); else c.forEach(walk); };
        walk(g.coordinates);
        if (!coords.length) continue;
        const avg = coords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]).map((v) => v / coords.length);
        const point = m.project(avg); // REAL Point
        let hit = []; try { hit = m.queryRenderedFeatures(point, { layers: ['tapestry-fill'] }); } catch (_) {}
        if (!hit.length) continue;
        let pins = []; try { pins = m.queryRenderedFeatures(point, { layers: [m.getLayer('upg-pins-hit') ? 'upg-pins-hit' : 'upg-pins'] }); } catch (_) {}
        if (pins.length) continue;
        m.fire('click', { lngLat: m.unproject(point), point, originalEvent: {} }); // NO shift
        return { fired: true, countAfter: s.count };
      }
      return { fired: false, countAfter: -1 };
    });
    await page.waitForTimeout(500);
    // R1.4: out of batch mode a plain map tap is a NO-OP for the selection (the old
    // clear-on-tap silently nuked the D-7 kept selection — an L4 glitch) and the
    // HUD stays hidden. Legend single-zone isolate still works out of batch mode.
    const hudStillHidden = (await page.locator(`${EL} .upg-hud`).count()) === 0;
    await expandRow(page, 'Frontier Asia');
    const nepal2 = legendRow(page, 'Nepal');
    let nepal2Count = -1;
    if (await nepal2.count()) {
      await nepal2.first().click().catch(() => {});
      await page.waitForTimeout(1400);
      nepal2Count = await isolatedFeatureCount(page);
    }
    await clearFilter(page);
    await page.screenshot({ path: join(SHOTS, '13-plain-click-clear.png') }).catch(() => {});
    // Progressive-disclosure ROUND TRIP: re-entering batch mode via the rail button
    // re-reveals the KEPT selection (HUD total returns with the same independent Σ).
    await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const btn = root.querySelector('.map-toolbar .upg-rail-batch');
      if (btn) btn.click();
    }, EL);
    await page.waitForTimeout(400);
    const revealState = await page.evaluate(() => {
      const s = window.__UPG_SELECT__;
      return { batch: s ? !!s.batchMode : null, count: s ? s.count : -1 };
    });
    const hudTotalBack = (await page.locator(`${EL} .upg-hud-total`).first().innerText().catch(() => '')) || '';
    // leave a clean slate for the R1.3 section (it sets its own batch state).
    await page.evaluate(() => { const s = window.__UPG_SELECT__; if (s) { s.clear(); s.setBatchMode(false); } });
    check('(16) toolA R1.4: batch-OFF PLAIN tap is a NO-OP (selection kept, HUD hidden), legend isolate works, AND re-entering batch RE-REVEALS the kept selection',
      plainTap.fired && plainTap.countAfter === 3 && hudStillHidden && nepal2Count >= 1
        && revealState.batch === true && revealState.count === 3
        && hudTotalBack.trim() === `${expectSum} UUPG`,
      `fired=${plainTap.fired} countAfter(must3)=${plainTap.countAfter} hudHidden=${hudStillHidden} ` +
      `nepalIsolated=${nepal2Count} reEnter=${JSON.stringify(revealState)} hudTotalBack="${hudTotalBack.trim()}"`);

    // ════════════════ R1.3 REFINEMENT gate additions (f″) ════════════════════
    // The the brief's headline acceptance: the batch toggle LIVES IN THE MAP CONTROLS
    // RAIL (G-rail), and the legend acts as a TRUE multi-select at 2+ rows wired to
    // the map highlight (G-2row), with a mixed legend+map union (G-mixed). Each Σ is
    // recomputed INDEPENDENTLY — for legend rows we sum the legend's OWN rendered
    // count column (.stl-num, a separate code path from the selection's running
    // total), so a wrong wiring genuinely fails the check.
    await clearFilter(page);
    await page.evaluate(() => { const s = window.__UPG_SELECT__; if (s) { s.setBatchMode(false); s.clear(); } });
    await page.waitForTimeout(300);

    // ── (G-rail) the Batch toggle renders INSIDE the MapToolbar control group ──
    // Query the rail (.map-toolbar) for the profile batch button; assert it is a
    // CHILD of the toolbar (not the .upg-hud), and that a real DOM click on it
    // flips __UPG_SELECT__.batchMode. NO-IMAGES: DOM + handle.
    //
    // ★ FIND BY CLASS, ASSERT THE TITLE SEPARATELY — the title is LOCALIZED.
    // This used to be `.upg-rail-batch[title="Batch Select"]`, which pinned the gate
    // to one English string: once the title became `:title="BATCH_SELECT_TITLE"`
    // the selector matched in `en` and NOWHERE ELSE, and the gate would
    // report "button not in the toolbar" — a product failure — for what is really a
    // broken query. `.upg-rail-batch` is already proven unique by railBtns === 1
    // below, so the class alone is the identity. The title is still checked, as the
    // property that actually matters for a11y: it must be NON-EMPTY, which holds in
    // every locale. That also catches a regression the old equality missed — a
    // :title binding resolving to '' or undefined.
    const railProbe = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const toolbar = root.querySelector('.map-toolbar');
      const btn = toolbar ? toolbar.querySelector('.upg-rail-batch') : null;
      const title = btn ? (btn.getAttribute('title') || '') : null;
      const inHud = !!(root.querySelector('.upg-hud .upg-rail-batch')); // must be FALSE
      // R1.4 (L4): the rail button is the ONLY batch control — the old HUD
      // .upg-batch-btn must not exist anywhere, and exactly ONE rail button.
      const hudBtns = root.querySelectorAll('.upg-batch-btn').length;   // must be 0
      const railBtns = root.querySelectorAll('.upg-rail-batch').length; // must be 1
      const before = window.__UPG_SELECT__ ? !!window.__UPG_SELECT__.batchMode : null;
      if (btn) btn.click(); // engage batch mode via the RAIL button
      return { hasToolbar: !!toolbar, inToolbar: !!btn, title, inHud, hudBtns, railBtns, before };
    }, EL);
    await page.waitForTimeout(250);
    // R1.4 de-glitch of the GATE itself: aria-pressed is a Vue-rendered binding —
    // read it AFTER the flush wait, not synchronously inside the click evaluate
    // (the pre-R1.4 synchronous read raced Vue's patch and reported stale 'false').
    const railOn = await page.evaluate(() => window.__UPG_SELECT__ ? !!window.__UPG_SELECT__.batchMode : false);
    const railAria = await page.evaluate((elName) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const btn = root.querySelector('.map-toolbar .upg-rail-batch');
      return btn ? btn.getAttribute('aria-pressed') : null;
    }, EL);
    await page.screenshot({ path: join(SHOTS, '14-rail-batch.png') }).catch(() => {});
    check('(G-rail) toolA R1.3/R1.4: the SINGLE Batch toggle lives INSIDE the map-controls rail (no HUD button anywhere) AND drives batchMode',
      railProbe.hasToolbar && railProbe.inToolbar && railProbe.inHud === false
        && railProbe.hudBtns === 0 && railProbe.railBtns === 1
        // Titled, in WHATEVER locale is under test — asserted as non-empty, never
        // against an English literal. A returned value nobody asserts on is decoration.
        && typeof railProbe.title === 'string' && railProbe.title.trim() !== ''
        && railProbe.before === false && railOn === true && railAria === 'true',
      `inToolbar=${railProbe.inToolbar} title(mustBeNonEmpty)=${JSON.stringify(railProbe.title)} ` +
      `inHud(mustFalse)=${railProbe.inHud} hudBtns(must0)=${railProbe.hudBtns} ` +
      `railBtns(must1)=${railProbe.railBtns} before=${railProbe.before} afterClick=${railOn} aria-pressed=${railAria}`);

    // ── (G-2row) batch ON → select 2 legend rows → both selected, union highlight
    // == Σ rows' zoneKeys, HUD total == independent Σ of the rows' OWN count column;
    // then deselect one → only the other remains. Pick 2 resolved India leaves.
    // batchMode is already ON from G-rail. Re-expand India so the leaves are visible.
    await expandRow(page, 'Asia (admin-1)');
    await expandRow(page, 'India');
    // R1.4 gate fix: the legend leaf labels are the ZONE labels from clusters.json
    // (e.g. "Rājasthān + Haryāna + …"), NOT bare state names — the R1.3 draft
    // hard-coded 'Rajasthan'/'Gujarat', which never matched any row (marked=[]).
    // Derive the EXACT labels from the SAME data file the profile renders, so the
    // check survives future regrouping of the India clusters.
    const clustersData = JSON.parse(readFileSync(join(__dirname, 'clusters.json'), 'utf8'));
    const zoneLabel = (id) => {
      const z = (clustersData.asia_lists || []).find((a) => a.id === id);
      return z ? z.label : null;
    };
    const ROW_A = zoneLabel('asia-india-rajasthan'), ROW_B = zoneLabel('asia-india-gujarat');
    // independent Σ source: the legend's OWN rendered count column for each row.
    const rowCount = async (label) => page.evaluate(({ elName, lbl }) => {
      const host = document.querySelector(elName);
      const root = host && host.shadowRoot ? host.shadowRoot : document;
      const rows = [...root.querySelectorAll('.stl-row')];
      const row = rows.find((r) => {
        const n = r.querySelector('.stl-name'); return n && n.textContent.trim() === lbl;
      });
      if (!row) return null;
      const num = row.querySelector('.stl-num');
      const txt = num ? num.textContent.replace(/[^0-9]/g, '') : '';
      return txt ? Number(txt) : null;
    }, { elName: EL, lbl: label });
    const cntA = await rowCount(ROW_A);
    const cntB = await rowCount(ROW_B);
    // toggle the two rows ON through the SAME union path a real tap uses.
    const rA = await page.evaluate((l) => window.__UPG_SELECT__.toggleLegendRow(l), ROW_A);
    await page.waitForTimeout(250);
    const rB = await page.evaluate((l) => window.__UPG_SELECT__.toggleLegendRow(l), ROW_B);
    await page.waitForTimeout(400); // Vue flush + marker re-apply
    // (R1.4: the R1.3 draft had an unused twoRow evaluate here referencing
    // undeclared placeholders — dead code removed; the assertions below read
    // markedNow / highlightNow / pageTotal directly.)
    // independent union feature count: Σ-distinct zoneKeys of the 2 rows recomputed
    // in NODE against the live tapestry source (never the page's highlight number).
    const unionExpect = await page.evaluate(({ a, b }) => {
      const m = window.__UPG_MAP__;
      const src = m && m.getSource && m.getSource('tapestry');
      const feats = (src && src._data && src._data.features) || [];
      const keys = new Set([...(a || []), ...(b || [])]);
      let n = 0;
      for (const f of feats) if (keys.has(f.properties && f.properties.zoneKey)) n++;
      return { keys: [...keys], featureCount: n };
    }, { a: rA && rA.zoneKeys, b: rB && rB.zoneKeys });
    const markedNow = await page.evaluate(() => window.__UPG_SELECT__.markedLegendRows());
    const highlightNow = await page.evaluate(() => window.__UPG_SELECT__.highlightFeatureCount());
    const pageTotal = await page.evaluate(() => window.__UPG_SELECT__.total);
    const expectRowSum = (Number(cntA) || 0) + (Number(cntB) || 0);
    const bothMarked = markedNow.includes(ROW_A) && markedNow.includes(ROW_B);
    await page.screenshot({ path: join(SHOTS, '15-2row-union.png') }).catch(() => {});
    check('(G-2row) toolA R1.3: 2 legend rows → BOTH marked selected + map highlight == union Σ + HUD total == independent Σ of rows',
      bothMarked && highlightNow === unionExpect.featureCount && unionExpect.featureCount > 0
        && pageTotal === expectRowSum && expectRowSum > 0,
      `marked=[${markedNow.join(', ')}] bothMarked=${bothMarked} highlight=${highlightNow} unionExpect=${unionExpect.featureCount} ` +
      `hudTotal=${pageTotal} independentΣ(${ROW_A}:${cntA}+${ROW_B}:${cntB})=${expectRowSum}`);

    // deselect ROW_A → only ROW_B remains marked + in the union total.
    await page.evaluate((l) => window.__UPG_SELECT__.toggleLegendRow(l), ROW_A);
    await page.waitForTimeout(400);
    const afterDrop = await page.evaluate(() => ({
      marked: window.__UPG_SELECT__.markedLegendRows(),
      total: window.__UPG_SELECT__.total,
    }));
    check('(G-2row-b) toolA R1.3: deselecting one legend row leaves ONLY the other selected (A removed, B stays)',
      !afterDrop.marked.includes(ROW_A) && afterDrop.marked.includes(ROW_B)
        && afterDrop.total === (Number(cntB) || 0),
      `marked=[${afterDrop.marked.join(', ')}] total=${afterDrop.total} expected(${ROW_B}:${cntB})=${Number(cntB) || 0}`);

    // ── (G-mixed) batch ON → 1 legend row + 1 map polygon → union total == Σ both.
    // ROW_B is still selected from above. Add ONE map territory via a real plain
    // batch-mode click (m.fire, no modifier) and assert total == cntB + that
    // territory's INDEPENDENT Node count (resolveTerritory), and the highlight
    // covers both. fitBounds India first so a clickable polygon is on-screen.
    await page.evaluate(() => {
      const m = window.__UPG_MAP__;
      if (m) m.fitBounds([[68.0, 6.5], [97.5, 35.7]], { padding: 30, duration: 0, maxZoom: 6 });
    });
    await page.waitForTimeout(1000);
    const mapAdd = await page.evaluate(() => {
      const m = window.__UPG_MAP__; const s = window.__UPG_SELECT__;
      const feats = m.queryRenderedFeatures({ layers: ['tapestry-fill'] });
      for (const f of feats) {
        const p = f.properties || {};
        // pick an ADM1/ADM0 territory NOT already selected (skip the zone rows).
        const g = f.geometry; if (!g) continue;
        const coords = [];
        const walk = (c) => { if (typeof c[0] === 'number') coords.push(c); else c.forEach(walk); };
        walk(g.coordinates);
        if (!coords.length) continue;
        const avg = coords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]).map((v) => v / coords.length);
        const point = m.project(avg);
        let hit = []; try { hit = m.queryRenderedFeatures(point, { layers: ['tapestry-fill'] }); } catch (_) {}
        if (!hit.length) continue;
        let pins = []; try { pins = m.queryRenderedFeatures(point, { layers: [m.getLayer('upg-pins-hit') ? 'upg-pins-hit' : 'upg-pins'] }); } catch (_) {}
        if (pins.length) continue;
        const before = s.count;
        m.fire('click', { lngLat: m.unproject(point), point, originalEvent: {} });
        if (s.count > before) {
          // the territory that was just added is the last entry in the list.
          const added = s.list[s.list.length - 1];
          return { added: { shapeName: p.shapeName || null, iso3: p.iso3 || null },
                   addedKey: added.key, total: s.total, highlight: s.highlightFeatureCount() };
        }
      }
      return { err: 'no map territory added' };
    });
    let mixedExpect = -1, mixedOk = false, mixedDetail = '';
    if (!mapAdd.err) {
      const territoryCount = await page.evaluate((props) => {
        // independent Node-equivalent: resolve via the SAME exposed resolver but read
        // the count off the page's resolver is page-side; instead recompute in NODE.
        return null; // computed below in Node
      }, mapAdd.added);
      // Node-side independent count for the added territory.
      const t = resolveTerritory(mapAdd.added);
      const addCount = (t && Number(t.count)) || 0;
      mixedExpect = (Number(cntB) || 0) + addCount;
      mixedOk = mapAdd.total === mixedExpect && mixedExpect > 0 && mapAdd.highlight >= 2;
      mixedDetail = `added=${JSON.stringify(mapAdd.added)} addCount=${addCount} unionTotal=${mapAdd.total} ` +
        `independentΣ(${ROW_B}:${cntB}+territory:${addCount})=${mixedExpect} highlight=${mapAdd.highlight}`;
    } else {
      mixedDetail = mapAdd.err;
    }
    await page.screenshot({ path: join(SHOTS, '16-mixed-union.png') }).catch(() => {});
    check('(G-mixed) toolA R1.3: 1 legend row + 1 map polygon → union total == independent Σ of both',
      mixedOk, mixedDetail);

    // restore clean state for any later checks.
    await page.evaluate(() => { const s = window.__UPG_SELECT__; if (s) { s.clear(); s.setBatchMode(false); } });
    await clearFilter(page);

  } catch (e) {
    check('gate ran to completion', false, `EXCEPTION: ${e && e.message ? e.message : String(e)}`);
  } finally {
    await browser.close();
  }

  // ── (12) PROMOTED-BUNDLE components-mounted smoke check ────────────────────
  // The lesson of the 2026-06-11 P0 (LESSON-03 L1): a single mount-time
  // exception blanks ALL components, and the dev-tree gate alone cannot catch a
  // stale/broken PROMOTED IIFE. So: serve app/my-upg-100-list.js from a tiny
  // throwaway http server, mount the custom element exactly like a host page
  // would, and assert legend root + map controls + geocoder EXIST in the shadow
  // DOM. DOM-presence only (NO-IMAGES) — deep behavior is checks 1-11's job.
  await (async () => {
    const { createServer } = await import('node:http');
    const { readFileSync } = await import('node:fs');
    const APP_ROOT = join(__dirname, '..', '..', '..'); // map-bundler/
    let token = '';
    try {
      const env = readFileSync(join(APP_ROOT, '.env'), 'utf8');
      token = (env.match(/^VITE_MAPBOX_TOKEN=(.+)$/m) || [])[1]?.trim() || '';
    } catch {}
    let bundle = null;
    try { bundle = readFileSync(join(APP_ROOT, 'app', 'my-upg-100-list.js')); } catch {}
    if (!token || !bundle) {
      check('(12) PROMOTED bundle smoke: components mounted (legend + controls + geocoder)',
        false, `token=${token ? 'ok' : 'MISSING'} bundle=${bundle ? bundle.length + 'B' : 'MISSING app/my-upg-100-list.js'}`);
      return;
    }
    const html = [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet" />',
      '<script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"><\/script>',
      '<link href="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.css" rel="stylesheet" />',
      '<script src="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js"><\/script>',
      '<style>html,body{margin:0;height:100%}my-upg-100-list-map{display:block;position:absolute;inset:0}</style>',
      '</head><body>',
      `<my-upg-100-list-map profile-config='${JSON.stringify({ profile: 'upg-100-list', tk: token })}'></my-upg-100-list-map>`,
      '<script src="/app/my-upg-100-list.js"><\/script>',
      '</body></html>',
    ].join('\n');
    const server = createServer((req, res) => {
      if (req.url === '/app/my-upg-100-list.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(bundle);
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const b2 = await firefox.launch();
    try {
      const p2 = await b2.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      await p2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // wait until the legend tree has populated (data fetch done) — up to 60s.
      const mounted = await p2.waitForFunction((elName) => {
        const root = document.querySelector(elName)?.shadowRoot;
        if (!root) return false;
        const legend = root.querySelector('.stl-panel') || root.querySelector('.stl-inner');
        const controls = root.querySelectorAll('.mcb').length;
        const geocoder = root.querySelector('.mapboxgl-ctrl-geocoder');
        return !!legend && controls >= 4 && !!geocoder;
      }, EL, { timeout: 60000 }).then(() => true).catch(() => false);
      const detail = await p2.evaluate((elName) => {
        const root = document.querySelector(elName)?.shadowRoot;
        if (!root) return 'NO shadowRoot';
        return `legend=${!!(root.querySelector('.stl-panel') || root.querySelector('.stl-inner'))}` +
          ` controls=${root.querySelectorAll('.mcb').length}` +
          ` geocoder=${!!root.querySelector('.mapboxgl-ctrl-geocoder')}` +
          ` map=${typeof window.__UPG_MAP__}`;
      }, EL).catch((e) => `evaluate failed: ${e.message}`);
      check('(12) PROMOTED bundle smoke: components mounted (legend + controls + geocoder)', mounted, detail);
    } catch (e) {
      check('(12) PROMOTED bundle smoke: components mounted (legend + controls + geocoder)',
        false, `EXCEPTION: ${e && e.message ? e.message : String(e)}`);
    } finally {
      await b2.close();
      server.close();
    }
  })();

  // ── (17) P0 COLD-LOAD initial paint (SCOPE_ID 4188af3d · LESSON-03 L7/L10) ──
  // The the brief's cold-reload bug: NO polygons/pins until the theme toggle. Root
  // cause: the boot gate armed once('style.load') AFTER the event already fired —
  // isStyleLoaded() needs style JSON + sprite + tiles, but 'style.load' fires at
  // style-JSON-parse and never re-fires until setStyle. This check FORCES that
  // window deterministically: hold the light-v11 SPRITE 10s so the data pipeline
  // finishes while isStyleLoaded() is still false. Then assert, with ZERO
  // interaction, that tapestry polygons AND pins paint anyway; then toggle the
  // theme BOTH directions and assert they survive each style swap.
  await (async () => {
    const SPRITE_DELAY_MS = 10000;
    const b3 = await firefox.launch();
    try {
      const p3 = await b3.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      await p3.route(/light-v11\/sprite/, async (route) => {
        await new Promise((r) => setTimeout(r, SPRITE_DELAY_MS));
        await route.continue().catch(() => {});
      });
      await p3.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p3.waitForFunction(() => !!window.__UPG_MAP__, null, { timeout: 25000 }).catch(() => {});
      // data pipeline done = status badge prints "N polys …" (set right after the
      // boot paint gate arms). NO map interaction anywhere in this check.
      await p3.waitForFunction((elName) => {
        const root = document.querySelector(elName)?.shadowRoot;
        const s = root && root.querySelector('.upg-status');
        return !!(s && /polys/.test(s.textContent || ''));
      }, EL, { timeout: 45000 }).catch(() => {});
      const raceArmed = await p3.evaluate(() => {
        const m = window.__UPG_MAP__;
        return m ? m.isStyleLoaded() === false : null; // false = sprite still held = window forced
      });
      // wait out the sprite hold + paint settle, still ZERO interaction; then the
      // layers must exist (the fix's 'idle' arm fires once the style completes).
      const snap = () => p3.evaluate(() => {
        const m = window.__UPG_MAP__;
        if (!m || !m.getLayer) return { tap: false, pin: false, rendered: -1, pinN: -1 };
        let rendered = -1;
        try { rendered = m.queryRenderedFeatures({ layers: ['tapestry-fill'] }).length; } catch { rendered = -2; }
        const src = m.getSource && m.getSource('tapestry');
        const pinSrc = m.getSource && m.getSource('upg');
        return {
          tap: !!m.getLayer('tapestry-fill'), pin: !!m.getLayer('upg-pins'),
          srcN: (src && src._data && src._data.features && src._data.features.length) || 0,
          pinN: (pinSrc && pinSrc._data && pinSrc._data.features && pinSrc._data.features.length) || 0,
          rendered,
        };
      });
      await p3.waitForFunction(() => {
        const m = window.__UPG_MAP__;
        return !!(m && m.getLayer && m.getLayer('tapestry-fill') && m.getLayer('upg-pins'));
      }, null, { timeout: SPRITE_DELAY_MS + 15000 }).catch(() => {});
      await p3.waitForTimeout(1500); // settle paint
      const cold = await snap();
      await p3.screenshot({ path: join(SHOTS, '17-cold-load-no-interaction.png') }).catch(() => {});
      check('(17) COLD LOAD paints polygons + pins with ZERO interaction (forced isStyleLoaded=false window)',
        raceArmed === true && cold.tap && cold.pin && cold.srcN > 0 && cold.pinN > 0 && cold.rendered > 0,
        `raceArmed=${raceArmed} tapestryLayer=${cold.tap} pinLayer=${cold.pin} srcFeatures=${cold.srcN} pins=${cold.pinN} rendered=${cold.rendered}`);
      // regression guard BOTH directions: light→dark, then dark→light. The route
      // above holds the LIGHT sprite on EVERY request (incl. the re-fetch when
      // toggling back to light), so a fixed wait reads rendered=0 while the held
      // sprite blocks the repaint — POLL for rendered features instead. Still
      // can-fail: if the paint never lands the poll times out and rendered stays 0.
      // The poll must gate on the EXPECTED theme TOO: right after the click the
      // OLD style is still live for a beat, so rendered>0 alone resolves on the
      // stale pre-setStyle state and the snap reads the wrong theme.
      const waitRendered = (expectTheme, timeout) => p3.waitForFunction((want) => {
        const m = window.__UPG_MAP__;
        if (!m || !m.getLayer || !m.getLayer('tapestry-fill')) return false;
        try {
          const s = m.getStyle() || {};
          const probe = JSON.stringify({ name: s.name, sprite: s.sprite, glyphs: s.glyphs });
          if (!probe.includes(want + '-v11')) return false;
          return m.queryRenderedFeatures({ layers: ['tapestry-fill'] }).length > 0;
        } catch { return false; }
      }, expectTheme, { timeout }).then(() => true).catch(() => false);
      const tBtn = p3.locator(`${EL} button.mcb[data-control="theme"]`);
      await tBtn.first().click().catch(() => {});
      await waitRendered('dark', SPRITE_DELAY_MS + 15000);
      const dark = await snap();
      const darkTheme17 = await mapStyleTheme(p3);
      check('(17b) cold-load paint SURVIVES first toggle (light→DARK)',
        darkTheme17 === 'dark' && dark.tap && dark.pin && dark.rendered > 0,
        `style=${darkTheme17} tapestryLayer=${dark.tap} pinLayer=${dark.pin} rendered=${dark.rendered}`);
      await tBtn.first().click().catch(() => {});
      await waitRendered(SPRITE_DELAY_MS + 15000);
      const light = await snap();
      const lightTheme17 = await mapStyleTheme(p3);
      check('(17c) cold-load paint SURVIVES second toggle (dark→LIGHT)',
        lightTheme17 === 'light' && light.tap && light.pin && light.rendered > 0,
        `style=${lightTheme17} tapestryLayer=${light.tap} pinLayer=${light.pin} rendered=${light.rendered}`);
    } catch (e) {
      check('(17) COLD LOAD paints polygons + pins with ZERO interaction (forced isStyleLoaded=false window)',
        false, `EXCEPTION: ${e && e.message ? e.message : String(e)}`);
    } finally {
      await b3.close();
    }
  })();

  console.log('\n---------------- VISUAL GATE SUMMARY ----------------');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log(`shots: ${SHOTS}/{01-boot-light,02-after-toggle-dark,02b-toggle-back-light,03-nepal,04-india,05-china,06-*,10-geocoder}.png`);
  console.log(`RESULT: ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('VISUAL GATE ERROR', e); process.exit(1); });
