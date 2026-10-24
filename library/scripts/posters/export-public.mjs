// export-public.mjs — mirror the rendered posters into doxa-maps' public tree,
// filed into REGION FOLDERS so they can be browsed in a file manager.
//
// It exports every image into a upg-100-posters folder, with a sub-folder per
// division (India, etc.), so the images can be browsed in a folder rather than
// downloaded one at a time.
//
//   node export-public.mjs
//     -> <doxa-maps>/public/upg-100-posters/<Region>/<Title>.png   (3000x3000)
//        <doxa-maps>/public/upg-100-posters/index.html             (browsable index)
//
// WHERE THIS GOES — AND WHY NOT public/ ────────────────────────────────────
// capacitor.config.json sets `webDir: "public"`, and Capacitor packages that
// directory WHOLESALE — there is no per-path exclude. So anything in public/
// ships inside the Android APK.
//
// The posters must NOT ship inside the Android application: that much static
// content does not belong in an app bundle when it can be served from a CDN
// later, or generated inside the app.
//
// Measured: the export is 52 MB of an 88 MB public/ — 59% of the APK would have
// been print-resolution posters. It also re-duplicated 11x per build (631 MB)
// because the per-bundle vite build sweeps the served root into every MFE.
//
// So the export lives OUTSIDE the repo's build output: nothing packages it,
// nothing copies it, nothing wipes it. Desktop/web can serve it from here or
// from a CDN; the phone gets posters from a CDN or generates them on device.
// Override with DOXA_PUBLIC=/some/path.
//
// Filenames use the poster TITLE, not the zone key: a person browsing folders
// wants "North India + Nepal.png", not "asia-india-uttarakhand.png".

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { sectionsOf } from './poster-regions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const DEST = process.env.DOXA_PUBLIC
  ? resolve(process.env.DOXA_PUBLIC)
  // Sibling of the repo, NOT inside public/ — capacitor packages public/ whole,
  // and these are 52 MB of print-resolution posters that must not ship in the APK.
  : resolve(__dirname, '..', '..', '..', '..', 'upg-100-posters');

const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Keep the title readable but filesystem-safe on every platform.
const safe = (s) => String(s).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

// Rebuild from scratch so a renamed zone cannot leave a stale duplicate behind.
if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const sections = sectionsOf(manifest.posters);
let copied = 0, missing = [];

for (const { name, list } of sections) {
  const dir = join(DEST, safe(name));
  mkdirSync(dir, { recursive: true });
  for (const p of list) {
    const src = join(OUT, p.png);
    if (!existsSync(src)) { missing.push(p.zoneKey); continue; }
    copyFileSync(src, join(dir, `${safe(p.title)}.png`));
    copied++;
  }
}

// A plain index so the folder is browsable in a browser as well as a file manager.
const kb = (f) => Math.round(statSync(f).size / 1024);
const body = sections.map(({ name, list, total }) => `
  <section>
    <h2>${esc(name)} <span class="m">${list.length} maps · ${total} people groups</span></h2>
    <ul>
      ${list.map((p) => {
        const rel = `${encodeURIComponent(safe(name))}/${encodeURIComponent(safe(p.title))}.png`;
        const f = join(DEST, safe(name), `${safe(p.title)}.png`);
        // href-escaped-ok: rel is built two lines up entirely from encodeURIComponent(), which
        // percent-encodes a quote, so it cannot break out of the attribute. (check:popup-href-escaped)
        return `<li><a href="${rel}">${esc(p.title)}</a>
          <span class="m">${p.count} UPG · ${existsSync(f) ? kb(f) : 0} KB</span></li>`;
      }).join('')}
    </ul>
  </section>`).join('');

writeFileSync(join(DEST, 'index.html'), `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UPG-100 posters — files</title>
<style>
 body{margin:0;padding:28px 24px 60px;background:#f7f4ec;color:#1c1c17;
   font:15px/1.6 Lato,'Segoe UI',system-ui,sans-serif;max-width:900px}
 h1{font:700 22px/1.2 Georgia,serif;margin:0 0 4px}
 .sub{color:#8a8470;font-size:13px;margin-bottom:22px}
 h2{font:700 17px/1.2 Georgia,serif;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid #e2dccc}
 .m{font-weight:400;font-size:12.5px;color:#8a8470;margin-left:8px}
 ul{list-style:none;padding:0;margin:0}
 li{padding:5px 0;border-bottom:1px solid #efeade;display:flex;justify-content:space-between;gap:16px}
 a{color:#6B4A78;font-weight:600;text-decoration:none}
 a:hover{text-decoration:underline}
</style></head><body>
<h1>UPG-100 posters</h1>
<div class="sub">${copied} posters · 3000×3000 PNG · one folder per region</div>
${body}
</body></html>`);

console.log(`[export-public] ${copied} posters -> ${DEST}`);
console.log(`[export-public] folders: ${sections.map((s) => safe(s.name)).join(', ')}`);
if (missing.length) console.warn(`[export-public] MISSING png for: ${missing.join(', ')}`);
