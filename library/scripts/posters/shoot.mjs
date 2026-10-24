// shoot.mjs — Playwright (Firefox, NO Google Chrome) screenshots each poster
// HTML → a high-DPI PNG (3ft × 4ft @ ~150 DPI). Mirrors the vision-wall
// HTML→PNG mechanism. Pure local; no network.
//
//   node shoot.mjs              # all posters in out/manifest.json
//   ONLY=laos node shoot.mjs    # one poster
//
// deviceScaleFactor 4 over a 1350×1800 CSS poster ⇒ 5400×7200 px PNG.

import { firefox } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const ONLY = process.env.ONLY;
const DSF = Number(process.env.DSF || 4);

let list;
if (ONLY) {
  list = [{ zoneKey: ONLY, html: `posters/${ONLY}.html`, png: `posters/${ONLY}.png` }];
} else {
  const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
  list = m.posters;
}

const browser = await firefox.launch();
// Viewport must be at least as large as the sheet or the .stage element screenshot
// is clipped. The sheet is no longer always 3x4 portrait (FORMAT=3x3 is 1500x1500),
// so these are overridable rather than hardcoded to the portrait dimensions.
const VW = Number(process.env.VW || 1500);
const VH = Number(process.env.VH || 1800);
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
const page = await ctx.newPage();
let n = 0;
for (const p of list) {
  const url = pathToFileURL(join(OUT, p.html)).href;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(120);
  const el = await page.$('.stage');
  await el.screenshot({ path: join(OUT, p.png) });
  n++;
  console.log(`  📸 ${p.png}`);
}
await browser.close();
console.log(`\n${n} screenshot(s) @ dsf=${DSF} (≈${1350 * DSF}×${1800 * DSF}px)`);
