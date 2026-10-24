// build-gallery.mjs — the vision-wall-style HTML gallery (card P4).
// Reads out/manifest.json → writes out/index.html: a grid of poster previews
// with a count, click → fullscreen poster + PRINT (3ft×4ft) + EXPORT (PNG).
// Self-hosted (system fonts only, no Google CDN); pure local; no build step.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sectionsOf } from './poster-regions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const posters = m.posters.slice().sort((a, b) => b.count - a.count);
const totalPgs = posters.reduce((s, p) => s + p.count, 0);

// GROUPED INTO REGIONAL SECTIONS, not one flat grid. The app's poster wall has
// always sectioned these (India, Africa, ...); this page listed all 28 in a
// single count-sorted run, so the same 28 posters read as two different products.
// sectionsOf() is shared with the HD page so the three surfaces cannot drift.
const tile = (p) => `
  <button class="tile" data-html="${esc(p.html)}" data-png="${esc(p.png)}" data-title="${esc(p.title)}">
    <span class="thumb"><img loading="lazy" src="${esc(p.png)}" alt="${esc(p.title)} poster"></span>
    <span class="meta"><span class="t">${esc(p.title)}</span><span class="c">${p.count} PGs</span></span>
  </button>`;

const tiles = sectionsOf(posters).map(({ name, list, total }) => `
  <section class="sec">
    <h2 class="sec-h">${esc(name)}
      <span class="sec-m">${list.length} ${list.length === 1 ? 'map' : 'maps'} \u00b7 ${total} people groups</span>
    </h2>
    <div class="grid">${list.map(tile).join('')}</div>
  </section>`).join('');

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UPG100 Posters — ${posters.length} lists</title>
<style>
  :root{--bg:#efeadd;--panel:#fff;--ink:#241f17;--dim:#6c654f;--line:#ddd3bb;--accent:#9a6b1e;
    --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--serif:Georgia,'Times New Roman',serif;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);padding:40px 28px 80px}
  .wrap{max-width:1700px;margin:0 auto}
  header{margin-bottom:28px}
  .eyebrow{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--accent);font-weight:700}
  h1{font-family:var(--serif);font-size:38px;margin:.18em 0 .1em}
  .sub{color:var(--dim);font-size:15px}
  .count{display:inline-block;margin-top:14px;font-family:var(--serif);font-size:17px;
    background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:20px;margin-top:14px}
  /* Regional sections — the same grouping the app's poster wall uses. */
  .sec{margin-top:34px}
  .sec-h{font-family:var(--serif);font-size:22px;margin:0;padding-bottom:8px;
    border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px}
  .sec-m{font-family:var(--sans);font-size:12.5px;color:var(--dim);font-weight:400}
  .tile{cursor:pointer;background:var(--panel);border:1px solid var(--line);border-radius:12px;
    padding:10px;text-align:left;font:inherit;color:inherit;box-shadow:0 1px 2px rgba(40,32,12,.05);
    transition:transform .12s,box-shadow .12s}
  .tile:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(40,32,12,.13)}
  .thumb{display:block;aspect-ratio:3/4;overflow:hidden;border-radius:7px;background:#f7f4ec;border:1px solid var(--line)}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .meta{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:9px}
  .meta .t{font-weight:600;font-size:13.5px;line-height:1.25}
  .meta .c{color:var(--dim);font-size:12px;white-space:nowrap}
  /* fullscreen viewer */
  .viewer{position:fixed;inset:0;background:rgba(28,24,16,.82);display:none;z-index:50;
    flex-direction:column;align-items:center;padding:0}
  .viewer.on{display:flex}
  .vbar{width:100%;display:flex;gap:10px;align-items:center;justify-content:center;
    padding:12px;background:#1c1810;color:#f3ead6;flex-wrap:wrap}
  .vbar .vt{font-family:var(--serif);font-size:18px;margin-right:auto;padding-left:8px}
  .vbar button,.vbar a{font:inherit;font-size:14px;cursor:pointer;border:1px solid #4d4530;
    background:#2b2616;color:#f3ead6;border-radius:8px;padding:8px 16px;text-decoration:none}
  .vbar button:hover,.vbar a:hover{background:#3c3520}
  .vbar .close{margin-left:8px}
  .stage{flex:1;width:100%;display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:18px}
  .stage iframe{width:600px;height:800px;border:0;background:#fff;box-shadow:0 10px 50px rgba(0,0,0,.5);border-radius:4px}
  @media print{body{display:none}}
</style></head><body>
<div class="wrap">
  <header>
    <div class="eyebrow">Unreached People Groups · printable posters</div>
    <h1>UPG100 — every name, every place</h1>
    <div class="sub">${posters.length} geographic lists · ${totalPgs.toLocaleString()} people-group pins · 3 ft × 4 ft, print-ready. “The harvest is plentiful, the labourers few.” — Luke 10:2</div>
    <div class="count">${posters.length} lists</div>
  </header>
  ${tiles}
</div>

<div class="viewer" id="viewer">
  <div class="vbar">
    <span class="vt" id="vtitle"></span>
    <button id="printBtn" title="Print at 3ft × 4ft">🖨 Print (3×4 ft)</button>
    <a id="exportBtn" download>⬇ Export PNG</a>
    <button class="close" id="closeBtn">✕ Close</button>
  </div>
  <div class="stage"><iframe id="frame" title="poster"></iframe></div>
</div>

<script>
  const viewer = document.getElementById('viewer');
  const frame = document.getElementById('frame');
  const vtitle = document.getElementById('vtitle');
  const exportBtn = document.getElementById('exportBtn');
  const printBtn = document.getElementById('printBtn');
  function open(tile){
    frame.src = tile.dataset.html;
    vtitle.textContent = tile.dataset.title;
    exportBtn.href = tile.dataset.png;
    exportBtn.setAttribute('download', tile.dataset.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.png');
    viewer.classList.add('on');
    document.body.style.overflow='hidden';
  }
  function close(){ viewer.classList.remove('on'); frame.src='about:blank'; document.body.style.overflow=''; }
  document.querySelectorAll('.tile').forEach(t=>t.addEventListener('click',()=>open(t)));
  document.getElementById('closeBtn').addEventListener('click', close);
  viewer.addEventListener('click', e=>{ if(e.target===viewer) close(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') close(); });
  printBtn.addEventListener('click', ()=>{ frame.contentWindow.focus(); frame.contentWindow.print(); });
</script>
</body></html>`;

writeFileSync(join(OUT, 'index.html'), html);
console.log(`gallery → out/index.html  (${posters.length} tiles, ${totalPgs} pins)`);
