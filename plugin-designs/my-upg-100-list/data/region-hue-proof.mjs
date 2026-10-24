#!/usr/bin/env node
// region-hue-proof.mjs — slice 09b-9 (color-strategy) §1(d) · the CAN-FAIL CT GATE
//
//   node plugin-designs/my-upg-100-list/data/region-hue-proof.mjs
//
// Proves the tapestry zones inherit their parent WAGF region hue (data-copy only),
// scoped to the families recolored THIS pass (Asia is DEFERRED to the Asia agent):
//
//   (1) HUE INHERITANCE — every in-scope zone's hue is within ±8° of its parent
//       region hue (the ideation ±8° window).
//   (1b) NO-BROWN — no in-scope zone sits in the perceptual brown band (a dark,
//        desaturated warm hue: hue∈[10,50]° ∧ L<48% ∧ S<100%). The the brief rules out
//        brown (); the warm families (Africa/LatAm/Oceania) carry a
//        lightness floor above the band so the darkest rung still reads as its hue.
//   (2) WITHIN-FAMILY DISTINCTNESS — every PAIR of zones in a family clears
//       ΔE2000 ≥ 10 (so each shade is individually distinguishable on the map).
//   (3) CROSS-FAMILY near-collision — Oceania (≈28°) and LatAm (≈37°) parents sit
//       only ~9° apart; assert every oceania×latam zone pair clears ΔE2000 ≥ 10
//       (separation leans on lightness, per qa §3 watch-item).
//   (4) NO-IMPORT — the generator copies hues as DATA; grep-assert it never imports
//       src/config/color-strategies/ (inheritance must not couple to the registry).
//   (5) DEAF EXEMPT — deaf is in the exempt-list, present, and keeps its #18ffff
//       (the "double portion" accent is outside region inheritance by design).
//
// Region hues are copied as DATA from geo-region.js:25-34 — NOT imported.
// Asia + uncovered zones are DEFERRED: present in zone-regions.json as `asia` but
// NOT asserted here (the Asia agent re-colors them in a second pass).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'zone-colors.json');
// zone-regions.json moved to data/tables/ (the shared asset pool the tree copies into
// public/dx-maps/assets/tables/) because the gospel legend renders IN THE BROWSER and needs it at
// runtime. HERE is still this plugin's data dir, so the path walks up to the repo root.
const REGIONS = join(HERE, '..', '..', '..', 'data', 'tables', 'zone-regions.json');
const GENERATOR = join(HERE, 'generate-region-shades.mjs');

// region hue table — COPIED AS DATA (geo-region.js:25-34), never imported
const REGION_HEX = {
  'middle-east': '#9b59b6',
  'africa': '#e74c3c',
  'europe': '#2ecc71',
  'latam': '#f39c12',
  'oceania': '#e67e22',
  'asia': '#3498db', // reference only — NOT asserted (deferred)
};

const IN_SCOPE = ['middle-east', 'africa', 'europe', 'latam', 'oceania'];
const EXEMPT = ['deaf'];
const HUE_TOL = 8;     // ±8° (Q5 default)
const DE_MIN = 10;     // ΔE2000 ≥ 10 within family (Q5 default ≥10)
const DEAF_HEX = '#18ffff';

// NO-BROWN gate (slice 09b-no-brown). The the brief rules out brown
// ("not a fan of brown, brown everywhere"). Brown = a dark, desaturated warm hue:
// hue ∈ [BROWN_HUE_LO, BROWN_HUE_HI] AND L < BROWN_L_MAX AND S < 1.0 (a fully-
// saturated warm color reads as its hue even when dark, so 100%-S is exempt).
// Every NON-ASIA, non-deaf zone must sit OUTSIDE this band — the families this
// slice recolors (Africa/LatAm/Oceania) are the warm ones at risk.
const BROWN_HUE_LO = 10;   // °
const BROWN_HUE_HI = 50;   // °
const BROWN_L_MAX = 0.48;  // lightness floor — below this a warm desaturated hue reads brown

// ── color math (HSL + Lab + CIEDE2000) — copied locally, no shared import ─────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s; const l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}
function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
// NO-BROWN: true when a hex sits in the perceptual brown band (dark, desaturated warm).
function inBrownBand(hex) {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));
  return h >= BROWN_HUE_LO && h <= BROWN_HUE_HI && l < BROWN_L_MAX && s < 1.0;
}
function rgbToLab([r, g, b]) {
  let [R, G, B] = [r, g, b].map((v) => {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  [x, y, z] = [x, y, z].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function deltaE00(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const avgLp = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;
  const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;
  let dhp = h2p - h1p;
  if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI / 180) / 2);
  let avgHp = h1p + h2p;
  if (Math.abs(h1p - h2p) > 180) avgHp += avgHp < 360 ? 360 : -360;
  avgHp /= 2;
  const T = 1 - 0.17 * Math.cos((avgHp - 30) * Math.PI / 180) + 0.24 * Math.cos((2 * avgHp) * Math.PI / 180)
    + 0.32 * Math.cos((3 * avgHp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * avgHp - 63) * Math.PI / 180);
  const dRo = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(2 * dRo * Math.PI / 180) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
    + Rt * (dCp / Sc) * (dHp / Sh),
  );
}
const de = (h1, h2) => deltaE00(rgbToLab(hexToRgb(h1)), rgbToLab(hexToRgb(h2)));

// ── load ──────────────────────────────────────────────────────────────────────
const store = JSON.parse(readFileSync(STORE, 'utf8'));
const regions = JSON.parse(readFileSync(REGIONS, 'utf8'));
const genSrc = readFileSync(GENERATOR, 'utf8');

const fails = [];
const log = (...a) => console.log(...a);
log('== region-hue-proof (color-strategy CT gate, non-Asia families) ==');
log(`hue tolerance ±${HUE_TOL}° · within-family ΔE2000 ≥ ${DE_MIN} · NO-BROWN (hue∈[${BROWN_HUE_LO},${BROWN_HUE_HI}]° ∧ L<${BROWN_L_MAX * 100}% ∧ S<100%) · exempt: ${EXEMPT.join(', ')}\n`);

// group in-scope zones by family
const byFamily = {};
for (const fam of IN_SCOPE) byFamily[fam] = [];
for (const z of Object.keys(regions).sort()) {
  if (IN_SCOPE.includes(regions[z])) byFamily[regions[z]].push(z);
}

// (1) hue inheritance + (2) within-family distinctness
for (const fam of IN_SCOPE) {
  const zones = byFamily[fam];
  const parentHue = rgbToHsl(hexToRgb(REGION_HEX[fam])).h;
  log(`${fam.toUpperCase()}  (parent hue ${parentHue.toFixed(1)}°, ${zones.length} zone${zones.length === 1 ? '' : 's'})`);
  for (const z of zones) {
    if (!(z in store)) { fails.push(`MISSING  ${z} has no color in zone-colors.json`); continue; }
    const { h, s, l } = rgbToHsl(hexToRgb(store[z]));
    const hd = hueDist(h, parentHue);
    const hueOk = hd <= HUE_TOL;
    const brown = inBrownBand(store[z]); // NO-BROWN gate ()
    const ok = hueOk && !brown;
    log(`  ${z.padEnd(28)} ${store[z]}  hue=${h.toFixed(1)}° (Δ${hd.toFixed(1)}°) L=${(l * 100).toFixed(0)}% S=${(s * 100).toFixed(0)}%  ${brown ? 'BROWN-FAIL' : (hueOk ? 'OK' : 'HUE-FAIL')}`);
    if (!hueOk) fails.push(`HUE  ${z} hueΔ=${hd.toFixed(1)}° > ±${HUE_TOL}° from ${fam}`);
    if (brown) fails.push(`BROWN  ${z} ${store[z]} in brown band (hue∈[${BROWN_HUE_LO},${BROWN_HUE_HI}]° ∧ L<${(BROWN_L_MAX * 100)}% ∧ S<100%) — the brief rules out brown (L20)`);
  }
  // pairwise distinctness
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    if (!(zones[i] in store) || !(zones[j] in store)) continue;
    const d = de(store[zones[i]], store[zones[j]]);
    if (d < DE_MIN) fails.push(`DIST ${zones[i]} ~ ${zones[j]} ΔE=${d.toFixed(1)} < ${DE_MIN} (same family)`);
  }
}

// (3) cross-family Oceania ↔ LatAm near-collision (~9° apart parents)
log('\nCROSS-FAMILY  oceania × latam (parents ~9° apart):');
for (const oz of byFamily['oceania']) for (const lz of byFamily['latam']) {
  if (!(oz in store) || !(lz in store)) continue;
  const d = de(store[oz], store[lz]);
  const ok = d >= DE_MIN;
  log(`  ${oz} ~ ${lz}  ΔE=${d.toFixed(1)}  ${ok ? 'OK' : 'COLLISION'}`);
  if (!ok) fails.push(`XFAM ${oz} ~ ${lz} ΔE=${d.toFixed(1)} < ${DE_MIN} (oceania/latam collision)`);
}

// (4) no-import — inheritance is data-copy, not a module import
log('\nNO-IMPORT  generate-region-shades.mjs must not import the shared registry:');
const importHit = /import[^;]*from\s+['"][^'"]*src\/config\/color-strategies/.test(genSrc);
log(`  imports src/config/color-strategies/ : ${importHit ? 'YES (FAIL)' : 'no (OK)'}`);
if (importHit) fails.push('IMPORT generate-region-shades.mjs imports src/config/color-strategies/* (inheritance must be data-copy)');

// (5) deaf exempt + untouched
log('\nDEAF EXEMPT  (double-portion accent, outside region inheritance):');
const deafOk = store['deaf'] === DEAF_HEX && EXEMPT.includes('deaf') && regions['deaf'] === 'exempt';
log(`  deaf = ${store['deaf']}  (expected ${DEAF_HEX}, region=${regions['deaf']})  ${deafOk ? 'OK' : 'FAIL'}`);
if (!deafOk) fails.push(`DEAF deaf=${store['deaf']} (expected exempt ${DEAF_HEX})`);

// ── verdict ──────────────────────────────────────────────────────────────────────
if (fails.length) {
  log('\nFAILS:');
  for (const f of fails) log('  ' + f);
  log('\n== REGION-HUE PROOF RED ==');
  process.exit(1);
}
log('\n== REGION-HUE PROOF GREEN — every in-scope zone inherits its parent hue (±8°), NO BROWN, pairwise-distinct, deaf exempt, no shared import ==');
process.exit(0);
