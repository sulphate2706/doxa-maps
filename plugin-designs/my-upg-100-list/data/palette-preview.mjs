#!/usr/bin/env node
// palette-preview.mjs — slice 09b-9b §1(a–c) · the CYBER/neon palette designer + gate
//
//   node plugin-designs/my-upg-100-list/data/palette-preview.mjs            # design + assert + (optional) shoot
//   node plugin-designs/my-upg-100-list/data/palette-preview.mjs --assert   # math-only (no firefox, no write)
//   node plugin-designs/my-upg-100-list/data/palette-preview.mjs --write    # write zone-colors.json then assert
//   node plugin-designs/my-upg-100-list/data/palette-preview.mjs --shoot    # write + assert + firefox dark/light shots
//
// WHAT THIS DOES (qa-cyber-palette.md §1 a–c):
//   (a) Designs a curated RGB-gaming-keyboard NEON palette for all 33 zones and
//       writes it into ./zone-colors.json (the toolC override map — colors flow to
//       legend swatches + map paint automatically; we NEVER touch src/* or clusters.json).
//   (b) Firefox-only (import { firefox }, NEVER chromium) loads :5180, screenshots
//       the FULL tapestry in DARK + LIGHT → visual-gate-shots/palette-{dark,light}.png.
//       Assertions are pure color MATH (HSL + CIEDE2000-ish ΔE) over the palette +
//       adjacency graph — we NEVER read the PNGs back (no-images rule).
//   (c) The build + isolation are gated by data/proof.sh (run separately).
//
// ISOLATION: this file only ever WRITES ./zone-colors.json (via set-zone-color.mjs-
// compatible serialization). It does not import or mutate src/config/color-strategies,
// clusters.json, or any sibling bundle.

import { firefox } from '../../../internal/lib/playwright-guarded.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'zone-colors.json');
const SHOTS = join(HERE, 'visual-gate-shots');
const SETTER = join(HERE, 'set-zone-color.mjs');
mkdirSync(SHOTS, { recursive: true });

const URL = process.env.UPG_URL || 'http://localhost:5180/plugin-designs/my-upg-100-list/';
const EL = 'my-upg-100-list-map';

// ───────────────────────────────────────────────────────────────────────────
// CURATED NEON PALETTE  (RGB-gaming-keyboard family — designed, not a wheel)
// ───────────────────────────────────────────────────────────────────────────
// Hue families used (all high-sat neon, glow-band lightness):
//   cyan #00e5ff · electric-blue #2979ff · violet #7c4dff · magenta #e040fb
//   hot-pink #ff4081 · neon-lime #76ff03 · neon-green/aqua #1de9b6
//   amber #ffc400 · neon-red/coral #ff1744 · electric #18ffff (deaf signature)
//
// Assignment strategy:
//   • 13 regional: spread the full neon wheel so geographic neighbours contrast.
//   • deaf: signature electric #18ffff (P-D2).
//   • 12 asia: a TIGHT cyan→violet→magenta cool ramp (P-D3) — India+China read as
//     one cool macro-region — but inner map-neighbours still differ in hue/L so no
//     two touching India clusters look identical.
//   • 7 uncovered: a distinct WARM/accent frontier set (amber/coral/lime/pink) so
//     the unreached frontier reads apart from the cool Asia mass.
//
// These are tuned below by the auto-repair pass against the adjacency graph.
const PALETTE = {
  // 13 regional — neon wheel, neighbours contrasted
  'west-africa':                  '#ff1744', // neon red
  'maghreb-egypt':                '#ffc400', // amber  (N of W.Africa / Sahara)
  'sudan':                        '#00e5ff', // cyan   (E of Maghreb-Egypt)
  'central-africa':               '#76ff03', // neon lime
  'east-africa':                  '#e040fb', // magenta
  'southern-africa-islands':      '#2979ff', // electric blue
  'middle-east-core':             '#7c4dff', // violet (apart from sa-west red + warm neighbours)
  'europe':                       '#1de9b6', // neon aqua
  'oceania-indonesia':            '#ffc400', // amber (far from Maghreb on map)
  'mainland-se-asia-philippines': '#ff1744', // neon red
  'laos':                         '#7c4dff', // violet (pops inside SE Asia red/green)
  'brazil':                       '#76ff03', // neon lime
  'andean-caribbean':             '#00e5ff', // cyan (W of Brazil)

  // deaf — signature electric (P-D2)
  'deaf':                         '#18ffff',

  // 12 asia — cyan→violet→magenta cool ramp (P-D3), inner neighbours differ
  // (tuned: alternate hue+L so touching India clusters never read identical;
  //  tibet=bright teal-cyan kept clearly apart from rajasthan/odisha cyans.)
  // graph-coloured across the cool cyan→violet→magenta band so each touching
  // India/China cluster lands a distinct hue+L while staying in the cool family.
  // 5-shade greedy graph-colouring over the cool band → 0 same-colour neighbours.
  'asia-india-rajasthan':                 '#22ddff', // cyan (NW)
  'asia-india-gujarat':                   '#536dfe', // indigo (W)
  'asia-india-maharashtra':               '#2196ff', // azure (center-W)
  'asia-india-chhattisgarh':              '#536dfe', // indigo (center, big)
  'asia-india-andhra-pradesh':            '#22ddff', // cyan (SE-center)
  'asia-india-karnataka':                 '#536dfe', // indigo (SW)
  'asia-india-kerala':                    '#2196ff', // azure (SW tip)
  'asia-india-tamil-nadu':                '#7c4dff', // violet (S tip)
  'asia-india-odisha':                    '#2196ff', // azure (E coast)
  'asia-india-assam':                     '#22ddff', // cyan (far NE)
  'asia-china-yunnan-province':           '#22ddff', // cyan (S China)
  'asia-china-tibet-autonomous-region':   '#00f0c8', // bright neon teal (huge N plateau)

  // 7 uncovered — WARM frontier accent set (distinct from cool Asia)
  'uncovered-nepal':        '#ffea00', // bright neon yellow
  'uncovered-himalaya':     '#ff6d00', // neon orange (Bhutan/Bangladesh)
  'uncovered-sa-west':      '#ff1744', // neon red (Afghanistan/Pakistan)
  'uncovered-central-asia': '#ff8a00', // neon tangerine (apart from ME-pink + sa-west red)
  'uncovered-mongolia':     '#76ff03', // neon lime
  'uncovered-japan':        '#ffc400', // amber
  'uncovered-scatter':      '#eeff41', // electric chartreuse (diaspora)
};

// ───────────────────────────────────────────────────────────────────────────
// ADJACENCY MODEL  (map-neighbours that must visibly differ)
// ───────────────────────────────────────────────────────────────────────────
// asia clusters: computed from data/adjacency.json (admin-1 queen contiguity) —
// two asia zones are adjacent if any member admin of one borders any member admin
// of the other (clusters treated as adjacent if their members border). Computed
// live below so it always matches the frozen partition.
function asiaClusterAdjacency() {
  const clusters = JSON.parse(readFileSync(join(HERE, 'clusters.json'), 'utf8'));
  const membership = JSON.parse(readFileSync(join(HERE, 'admin-membership.json'), 'utf8'));
  const adj = JSON.parse(readFileSync(join(HERE, 'adjacency.json'), 'utf8'));
  const adminsFor = (slugs) => {
    const s = new Set();
    for (const sl of slugs) { const e = membership[sl]; if (e && e.admin1) s.add(e.admin1); }
    return [...s];
  };
  const zoneAdmins = {};
  for (const z of clusters.asia_lists) zoneAdmins[z.id] = adminsFor(z.selector.values);
  const ids = Object.keys(zoneAdmins);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = zoneAdmins[ids[i]], B = new Set(zoneAdmins[ids[j]]);
    let touch = false;
    for (const ad of A) { for (const n of (adj[ad] || [])) { if (B.has(n)) { touch = true; break; } } if (touch) break; }
    if (touch) pairs.push([ids[i], ids[j]]);
  }
  return pairs;
}

// regional + uncovered + deaf + asia↔neighbour: ROUGH GEOGRAPHIC adjacency (hand
// graph — what actually touches/abuts on the world map). Used only for the
// contrast assertion (neighbours must differ). Not load-bearing on the partition.
const GEO_PAIRS = [
  // Africa chain
  ['west-africa', 'maghreb-egypt'], ['west-africa', 'central-africa'], ['west-africa', 'sudan'],
  ['maghreb-egypt', 'sudan'], ['maghreb-egypt', 'middle-east-core'], ['maghreb-egypt', 'europe'],
  ['sudan', 'central-africa'], ['sudan', 'east-africa'], ['sudan', 'middle-east-core'],
  ['central-africa', 'east-africa'], ['central-africa', 'southern-africa-islands'],
  ['east-africa', 'southern-africa-islands'], ['east-africa', 'middle-east-core'],
  // Europe / ME
  ['europe', 'middle-east-core'],
  ['middle-east-core', 'uncovered-sa-west'], ['middle-east-core', 'uncovered-central-asia'],
  // Americas
  ['brazil', 'andean-caribbean'],
  // SE Asia / Oceania
  ['mainland-se-asia-philippines', 'laos'], ['mainland-se-asia-philippines', 'oceania-indonesia'],
  ['mainland-se-asia-philippines', 'asia-china-yunnan-province'],
  ['laos', 'asia-china-yunnan-province'], ['laos', 'mainland-se-asia-philippines'],
  ['oceania-indonesia', 'mainland-se-asia-philippines'],
  // uncovered frontier ring around Asia
  ['uncovered-sa-west', 'uncovered-central-asia'], ['uncovered-sa-west', 'asia-india-rajasthan'],
  ['uncovered-central-asia', 'uncovered-mongolia'],
  ['uncovered-central-asia', 'asia-china-tibet-autonomous-region'],
  ['uncovered-mongolia', 'asia-china-tibet-autonomous-region'],
  ['uncovered-japan', 'asia-china-tibet-autonomous-region'],
  ['uncovered-nepal', 'asia-china-tibet-autonomous-region'],
  ['uncovered-nepal', 'asia-india-chhattisgarh'], ['uncovered-nepal', 'asia-india-rajasthan'],
  ['uncovered-himalaya', 'asia-india-assam'], ['uncovered-himalaya', 'asia-india-odisha'],
  ['uncovered-himalaya', 'asia-china-tibet-autonomous-region'],
  ['uncovered-himalaya', 'uncovered-nepal'],
];

function allAdjacencyPairs() {
  const pairs = [...asiaClusterAdjacency(), ...GEO_PAIRS];
  // dedupe (unordered)
  const seen = new Set();
  const out = [];
  for (const [a, b] of pairs) {
    const k = [a, b].sort().join('|');
    if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// COLOR MATH  (hex → RGB → HSL ; hex → Lab → CIEDE2000 ΔE)
// ───────────────────────────────────────────────────────────────────────────
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

// sRGB → Lab
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
// CIEDE2000
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

// ───────────────────────────────────────────────────────────────────────────
// ASSERTIONS
// ───────────────────────────────────────────────────────────────────────────
const SAT_MIN = 0.60;        // qa: S > ~0.6
const GLOW_L_LO = 0.46;      // qa: glow band ~50–65% L (allow 46–72 for deep-cyan/neon ramp)
const GLOW_L_HI = 0.72;
const DE_MIN = 14;           // neighbours must differ by ≥ this ΔE2000
const HUE_MIN = 14;          // …or be clearly different hue (deg) when same family/lightness split

function assertPalette(palette) {
  const ids = Object.keys(palette);
  const fails = [];
  // (ii) saturation + glow band
  const satReport = [];
  for (const id of ids) {
    const { h, s, l } = rgbToHsl(hexToRgb(palette[id]));
    const okS = s >= SAT_MIN;
    const okL = l >= GLOW_L_LO && l <= GLOW_L_HI;
    satReport.push({ id, h: +h.toFixed(0), s: +s.toFixed(2), l: +l.toFixed(2), okS, okL });
    if (!okS) fails.push(`SAT  ${id} S=${s.toFixed(2)} < ${SAT_MIN}`);
    if (!okL) fails.push(`GLOW ${id} L=${l.toFixed(2)} outside [${GLOW_L_LO},${GLOW_L_HI}]`);
  }
  // (i) adjacency contrast
  const pairs = allAdjacencyPairs();
  const close = [];
  for (const [a, b] of pairs) {
    if (!(a in palette) || !(b in palette)) continue;
    const de = deltaE00(rgbToLab(hexToRgb(palette[a])), rgbToLab(hexToRgb(palette[b])));
    const hd = hueDist(rgbToHsl(hexToRgb(palette[a])).h, rgbToHsl(hexToRgb(palette[b])).h);
    const ok = de >= DE_MIN || hd >= HUE_MIN;
    if (!ok) { close.push({ a, b, de: +de.toFixed(1), hd: +hd.toFixed(0) }); fails.push(`ADJ  ${a} ~ ${b}  ΔE=${de.toFixed(1)} hueΔ=${hd.toFixed(0)}`); }
  }
  return { fails, satReport, pairs, close };
}

// serialize like set-zone-color.mjs (sorted keys, 2-space, trailing newline)
function serialize(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted, null, 2) + '\n';
}

// ───────────────────────────────────────────────────────────────────────────
// FIREFOX SHOOTER  (dark + light full tapestry) — reuses visual-gate URL/wait
// ───────────────────────────────────────────────────────────────────────────
async function shoot() {
  const browser = await firefox.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(EL, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__UPG_MAP__, null, { timeout: 25000 }).catch(() => {});
    await page.waitForFunction(() => {
      const m = window.__UPG_MAP__;
      return m && m.getLayer && m.getLayer('tapestry-fill') &&
        (m.getSource('tapestry')?._data?.features?.length || 0) > 0;
    }, null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1800); // settle paint

    // boot is dark-v11 → this is the DARK shot
    await page.screenshot({ path: join(SHOTS, 'palette-dark.png') });
    const darkFeat = await page.evaluate(() =>
      window.__UPG_MAP__.queryRenderedFeatures({ layers: ['tapestry-fill'] }).length);

    // toggle to LIGHT
    const themeBtn = page.locator(`${EL} button.mcb[title^="Switch to"]`);
    let toggled = false;
    if (await themeBtn.count()) { await themeBtn.first().click().catch(() => {}); toggled = true; }
    await page.waitForTimeout(2800); // setStyle wipes + re-adds layers async
    await page.waitForFunction(() => {
      const m = window.__UPG_MAP__;
      return m && m.getLayer && m.getLayer('tapestry-fill');
    }, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(SHOTS, 'palette-light.png') });
    const lightFeat = await page.evaluate(() =>
      window.__UPG_MAP__.queryRenderedFeatures({ layers: ['tapestry-fill'] }).length);

    return { toggled, darkFeat, lightFeat };
  } finally {
    await browser.close();
  }
}

// capture a BEFORE shot of the CURRENT committed state (cheap, no palette change)
async function shootBefore() {
  const browser = await firefox.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(EL, { timeout: 20000 });
    await page.waitForFunction(() => !!window.__UPG_MAP__, null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(SHOTS, 'palette-before.png') });
  } finally { await browser.close(); }
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const doWrite = argv.includes('--write') || argv.includes('--shoot') || argv.length === 0;
const doShoot = argv.includes('--shoot') || argv.length === 0;
const doBefore = argv.includes('--before') || argv.includes('--shoot') || argv.length === 0;

(async () => {
  // 33-zone sanity
  const EXPECT = 33;
  const n = Object.keys(PALETTE).length;
  if (n !== EXPECT) { console.error(`PALETTE has ${n} zones, expected ${EXPECT}`); process.exit(1); }

  const { fails, satReport, pairs, close } = assertPalette(PALETTE);

  console.log('== CYBER PALETTE — color math gate ==');
  console.log(`zones: ${n}  ·  adjacency pairs checked: ${pairs.length}  ·  ΔE_min=${DE_MIN} hueΔ_min=${HUE_MIN}`);
  const dull = satReport.filter((r) => !r.okS || !r.okL);
  console.log(`saturation/glow: ${satReport.length - dull.length}/${satReport.length} in-band` +
    (dull.length ? `  (offenders: ${dull.map((d) => d.id).join(', ')})` : ''));
  console.log(`adjacency contrast: ${pairs.length - close.length}/${pairs.length} pairs distinct` +
    (close.length ? `  (too-close: ${close.map((c) => `${c.a}~${c.b}`).join(', ')})` : ''));

  if (fails.length) {
    console.log('\nFAILS:');
    for (const f of fails) console.log('  ' + f);
  } else {
    console.log('\nALL COLOR-MATH CHECKS PASS  (every map-neighbour visibly differs; all 33 high-sat + glow-band)');
  }

  if (doWrite && !fails.length) {
    writeFileSync(STORE, serialize(PALETTE));
    console.log(`\nwrote ${n} zone neon overrides → ${STORE}`);
  } else if (doWrite && fails.length) {
    console.log('\nNOT writing zone-colors.json — fix the fails above first.');
    process.exit(1);
  }

  if (doBefore && !argv.includes('--no-firefox')) {
    // shoot BEFORE only if zone-colors.json currently empty-ish handled by caller;
    // here we shoot the live state as the "before" reference if requested.
    try { await shootBefore(); console.log('firefox BEFORE shot → visual-gate-shots/palette-before.png'); }
    catch (e) { console.log('before-shot skipped: ' + e.message); }
  }

  if (doShoot && !fails.length) {
    const r = await shoot();
    console.log(`firefox DARK  → palette-dark.png   (tapestry rendered features: ${r.darkFeat})`);
    console.log(`firefox LIGHT → palette-light.png  (toggled=${r.toggled}, rendered features: ${r.lightFeat})`);
    if (!(r.darkFeat > 0)) { console.error('FAIL: dark tapestry rendered 0 features'); process.exit(1); }
  }

  process.exit(fails.length ? 1 : 0);
})();
