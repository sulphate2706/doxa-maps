#!/usr/bin/env node
// generate-region-shades.mjs — slice 09b-9 (color-strategy) §1(b) · the SHADE GENERATOR
//
//   node plugin-designs/my-upg-100-list/data/generate-region-shades.mjs            # write non-Asia families
//   node plugin-designs/my-upg-100-list/data/generate-region-shades.mjs --dry      # print ladder, write nothing
//
// WHAT THIS DOES (qa-color-strategy.md §1b + IDEATION shade sketch):
//   For each NON-ASIA WAGF region family, give every child zone a DISTINCT SHADE of
//   the parent region's hue — hue locked (well within ±8°), lightness spread across
//   the family's N zones so every pair is clearly distinguishable. Inheritance is
//   COPY-THE-HUE-AS-DATA: the region hue table below is copied verbatim from
//   src/config/color-strategies/geo-region.js — this file MUST NOT import it.
//
// SCOPE OF THIS PASS (cleanly partitioned — the Asia-contiguity-v2 agent owns Asia):
//   Recolor ONLY: middle-east, africa, latam, europe, oceania.
//   DEFER (leave bytes untouched, carried through from the current store):
//     - asia family (12 + uncovered = blue) — being rewritten right now by the
//       Asia agent; coloring it here would be rework.
//     - deaf — "double portion" exception (Q3): keep #18ffff, proof-exempt.
//
// HAND-SET SUPREMACY (Q4-A): full regeneration of the in-scope families in one diff.
//   A zone listed in OPTIONAL ./color-locks.json is NEVER overwritten (a hex the
//   hand-set stays supreme). Post-regeneration hand-picks win anyway via
//   ordinary last-write-wins through set-zone-color.mjs.
//
// ISOLATION: writes ONLY ./zone-colors.json, via the same stable serializer as
//   set-zone-color.mjs (sorted keys, 2-space, trailing \n) → byte-stable, idempotent.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'zone-colors.json');
// zone-regions.json moved to data/tables/ (the shared asset pool the tree copies into
// public/dx-maps/assets/tables/) because the gospel legend renders IN THE BROWSER and needs it at
// runtime. HERE is still this plugin's data dir, so the path walks up to the repo root.
const REGIONS = join(HERE, '..', '..', '..', 'data', 'tables', 'zone-regions.json');
const LOCKS = join(HERE, 'color-locks.json'); // optional

// ── region hue table — COPIED AS DATA from geo-region.js:25-34 (DO NOT import) ──
// Asia #3498db is intentionally present for reference but NOT recolored this pass.
const REGION_HEX = {
  'asia': '#3498db',          // DEFERRED (other agent owns it)
  'middle-east': '#9b59b6',   // purple
  'africa': '#e74c3c',        // red
  'europe': '#2ecc71',        // green
  'latam': '#f39c12',         // yellow-orange
  'oceania': '#e67e22',       // orange
};

// Families recolored in THIS pass (Asia + exempt deliberately excluded).
const IN_SCOPE = ['middle-east', 'africa', 'europe', 'latam', 'oceania'];

// ── color math (HSL) — copied locally; no shared import ─────────────────────────
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
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; // wrap (the hue fan can push past 0°/360° for warm families)
  h /= 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// ── shade ladder ────────────────────────────────────────────────────────────────
// For N zones: keep the parent HUE within ±8° (the ideation window), spread
// LIGHTNESS across a band, taper SATURATION (lighter rungs slightly less
// saturated), and — where ΔE compresses — apply a small per-rung HUE FAN so every
// adjacent pair clears ΔE2000 ≥ 10. N=1 just keeps the family's single shade.
//
// NO-BROWN PERCEPTUAL FLOOR (slice 09b-no-brown — Brief: "not a fan
// of brown, brown everywhere"). Brown ≈ a dark, desaturated red/orange/yellow:
// formally hue ∈ [10°,50°] AND L < 48% AND S < 100% (see region-hue-proof brown
// gate). The OLD ladder spread the red/orange families down to L26–42 (central-
// africa #7e1207 L26, oceania-indonesia #884911 L30, andean-caribbean #ce8109 L42),
// which read as BROWN. The FIX: raise each warm family's lightness FLOOR above the
// brown band so the darkest rung is still a vivid red / orange / yellow, never
// brown. Africa's 5-zone family can't hold ΔE ≥ 10 on lightness alone above the
// floor (LESSON-07: ΔE compresses hard in light reds), so it ALSO uses a small
// zig-zag hue fan (max |Δ|=6°, inside ±8°) to recover adjacent distinctness without
// ever dipping into the brown band. Middle-East (purple) + Europe (green) never
// read brown and are unchanged in spirit (kept here for completeness).
//
// Per-family band: [Lmin%, Lmax%, Smin, Smax, hueFan?]. hueFan (optional) is a
// per-rung hue OFFSET array (length = N), each entry ≤ ±8°; absent ⇒ 0° (hue
// locked to parent). Lightness floors below are all ABOVE the brown band for the
// warm families.
const BANDS = {
  // family : [Lmin%, Lmax%, Smin, Smax, hueFan?]
  'middle-east': [32, 68, 0.42, 0.42],                          // 2 zones · purple — never brown
  'africa':      [38, 86, 1.00, 0.50, [-6, 4, -6, 2, -4]],      // 5 zones · red — floor 38% (vivid crimson, not L26 brown) + hue fan → adj ΔE ≥ 10, no brown
  'latam':       [55, 72, 0.95, 0.85],                          // 2 zones · yellow-orange — floor 55% (was L42 brown on andean-caribbean)
  'europe':      [50, 50, 0.59, 0.59],                          // 1 zone · green — never brown
  'oceania':     [56, 56, 0.85, 0.85],                          // 1 zone · orange — floor 56% (was L30 brown on oceania-indonesia); still ΔE ≥ 10 vs latam
};

function ladder(parentHex, n, band) {
  const { h } = rgbToHsl(hexToRgb(parentHex));
  const [lo, hi, sLo, sHi, hueFan] = band;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const L = (lo + (hi - lo) * t) / 100;
    const S = sLo + (sHi - sLo) * t;
    const H = h + (hueFan ? hueFan[i] : 0); // small fan (≤±8°) where ΔE compresses; hslToRgb wraps mod 360
    out.push(hslToRgb(H, S, L));
  }
  return out;
}

// stable serializer — byte-identical to set-zone-color.mjs:26-30
function serialize(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted, null, 2) + '\n';
}

// ── main ─────────────────────────────────────────────────────────────────────────
const dry = process.argv.slice(2).includes('--dry');

const regions = JSON.parse(readFileSync(REGIONS, 'utf8'));
const store = JSON.parse(readFileSync(STORE, 'utf8'));
const locks = existsSync(LOCKS) ? JSON.parse(readFileSync(LOCKS, 'utf8')) : {};

// group in-scope zones by family, in stable (sorted) order for deterministic ladders
const byFamily = {};
for (const fam of IN_SCOPE) byFamily[fam] = [];
for (const zone of Object.keys(regions).sort()) {
  const fam = regions[zone];
  if (IN_SCOPE.includes(fam)) byFamily[fam].push(zone);
}

const next = { ...store };
const report = [];
for (const fam of IN_SCOPE) {
  const zones = byFamily[fam];
  if (!zones.length) continue;
  const shades = ladder(REGION_HEX[fam], zones.length, BANDS[fam]);
  zones.forEach((zone, i) => {
    if (locks[zone]) {
      report.push({ zone, fam, hex: store[zone], locked: true });
      return; // hand-set hex is supreme — never overwrite
    }
    next[zone] = shades[i];
    const { h, l } = rgbToHsl(hexToRgb(shades[i]));
    report.push({ zone, fam, hex: shades[i], h: +h.toFixed(1), l: +(l * 100).toFixed(1) });
  });
}

// ── status line (legibility is a feature — this project's signature failure was a
//    builder silent for 40 minutes) ───────────────────────────────────────────────
console.log('== generate-region-shades (non-Asia families) ==');
for (const fam of IN_SCOPE) {
  const rows = report.filter((r) => r.fam === fam);
  console.log(`\n${fam.toUpperCase()} (parent ${REGION_HEX[fam]}, ${rows.length} zone${rows.length === 1 ? '' : 's'}):`);
  for (const r of rows) {
    console.log(`  ${r.zone.padEnd(28)} ${r.hex}` +
      (r.locked ? '  [HAND-LOCKED — kept]' : `  hue=${r.h}° L=${r.l}%`));
  }
}
const deferred = Object.keys(regions).filter((z) => regions[z] === 'asia');
console.log(`\nDEFERRED (Asia agent owns): ${deferred.length} zones carried through untouched`);
console.log(`EXEMPT (deaf double-portion): deaf = ${store['deaf']} (untouched)`);

if (dry) {
  console.log('\n--dry: wrote nothing.');
  process.exit(0);
}

writeFileSync(STORE, serialize(next));
console.log(`\nwrote ${STORE} (in-scope families recolored; Asia + deaf bytes preserved)`);
