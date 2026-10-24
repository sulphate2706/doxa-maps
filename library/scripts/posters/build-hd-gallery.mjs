// build-hd-gallery.mjs — an HD review page for the 28 posters.
//
// One page shows every poster's HD version, each with a copy-to-clipboard action.
//
// What it gives you per poster:
//   • the FULL-RESOLUTION PNG (3000x3000), lazily loaded so the page opens fast
//   • Copy image  -> the actual PNG bitmap on the clipboard, ready to paste
//   • Copy link   -> its absolute URL
//   • Open PNG / Open HTML -> the raw artefacts
//
// Clipboard note: navigator.clipboard.write() needs a SECURE CONTEXT. Browsers
// treat http://localhost as secure but NOT a bare LAN IP, so over
// http://<ip>:8090 the image copy is unavailable — the page detects that and
// says so rather than silently failing. Copy-link always works.
//
//   node build-hd-gallery.mjs      ->  out/hd.html

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { regionFor, sectionsOf } from './poster-regions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));

// Sections come from the SHARED region map (poster-regions.mjs), which the
// preview gallery uses too — three copies of this mapping would drift.
const posters = manifest.posters.map((p) => {
  const png = join(OUT, p.png);
  const kb = existsSync(png) ? Math.round(statSync(png).size / 1024) : 0;
  return { ...p, region: regionFor(p.zoneKey), kb };
});

const ordered = sectionsOf(posters);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cards = ordered.map(({ name, list, total }) => `
  <section class="sec">
    <h2>${esc(name)} <span class="meta">${list.length} maps · ${total} people groups</span></h2>
    <div class="grid">
      ${list.map((p) => `
        <figure class="card" data-png="${esc(p.png)}">
          <a class="shot" href="${esc(p.png)}" target="_blank" rel="noopener">
            <img loading="lazy" decoding="async" src="${esc(p.png)}" alt="${esc(p.title)}">
          </a>
          <figcaption>
            <div class="ttl">${esc(p.title)}</div>
            <div class="sub">${p.count} UPG · ${p.kb} KB · 3000×3000</div>
            <div class="btns">
              <button class="btn copy-img">Copy image</button>
              <button class="btn copy-link">Copy link</button>
              <a class="btn ghost" href="${esc(p.png)}" download>PNG</a>
              <a class="btn ghost" href="${esc(p.html)}" target="_blank" rel="noopener">HTML</a>
            </div>
          </figcaption>
        </figure>`).join('')}
    </div>
  </section>`).join('');

const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UPG-100 posters — HD review</title>
<style>
  :root{--paper:#f7f4ec;--ink:#1c1c17;--dim:#8a8470;--zc:#6B4A78;--line:#e2dccc}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:15px/1.5 Lato,'Segoe UI',system-ui,sans-serif}
  header{position:sticky;top:0;z-index:5;background:rgba(247,244,236,.96);
    backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 22px}
  h1{margin:0;font:700 20px/1.2 Georgia,serif;letter-spacing:-.01em}
  .hint{margin-top:4px;font-size:12.5px;color:var(--dim)}
  .warn{margin-top:6px;font-size:12.5px;color:#8a5a2a;display:none}
  .sec{padding:26px 22px 6px}
  h2{margin:0 0 14px;font:700 17px/1.2 Georgia,serif;border-bottom:1px solid var(--line);padding-bottom:7px}
  .meta{font:400 12.5px Lato,sans-serif;color:var(--dim);margin-left:8px}
  .grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{margin:0;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;
    box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .shot{display:block;aspect-ratio:1/1;background:#faf8f2}
  .shot img{width:100%;height:100%;object-fit:contain;display:block}
  figcaption{padding:11px 13px 13px;border-top:1px solid var(--line)}
  .ttl{font-weight:700;font-size:14.5px;line-height:1.25}
  .sub{font-size:12px;color:var(--dim);margin-top:3px;font-variant-numeric:tabular-nums}
  .btns{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}
  .btn{font:600 12px Lato,sans-serif;padding:6px 11px;border-radius:6px;cursor:pointer;
    border:1px solid var(--zc);background:var(--zc);color:#fff;text-decoration:none;display:inline-block}
  .btn.ghost{background:transparent;color:var(--zc)}
  .btn[disabled]{opacity:.4;cursor:not-allowed}
  .btn.ok{background:#2f7d4f;border-color:#2f7d4f}
  .btn.err{background:#9b3b3b;border-color:#9b3b3b}
</style></head><body>
<header>
  <h1>UPG-100 posters — HD review</h1>
  <div class="hint">${posters.length} posters · 3000×3000 PNG · click a poster to open it full size</div>
  <div class="warn" id="warn">Image-copy needs a secure context — open this page via <b>localhost</b>
    (or HTTPS) to enable it. “Copy link” works anywhere.</div>
</header>
${cards}
<script>
// Image copy requires a secure context AND ClipboardItem support.
var CAN_COPY_IMG = window.isSecureContext && !!(navigator.clipboard && window.ClipboardItem);
if (!CAN_COPY_IMG) {
  document.getElementById('warn').style.display = 'block';
  document.querySelectorAll('.copy-img').forEach(function (b) { b.disabled = true; });
}
function flash(btn, text, cls) {
  var old = btn.textContent;
  btn.textContent = text; btn.classList.add(cls);
  setTimeout(function () { btn.textContent = old; btn.classList.remove(cls); }, 1400);
}
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.btn'); if (!btn) return;
  var card = e.target.closest('.card'); if (!card) return;
  var png = card.getAttribute('data-png');

  if (btn.classList.contains('copy-link')) {
    var url = new URL(png, location.href).href;
    // execCommand fallback: navigator.clipboard is also gated on secure context.
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(function(){ flash(btn,'Copied','ok'); },
        function(){ flash(btn,'Failed','err'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash(btn,'Copied','ok'); }
      catch (err) { flash(btn,'Failed','err'); }
      document.body.removeChild(ta);
    }
    return;
  }

  if (btn.classList.contains('copy-img')) {
    if (!CAN_COPY_IMG) return;
    btn.textContent = 'Copying…';
    // Fetch the real PNG bytes; the clipboard needs a Blob, not the <img>.
    fetch(png).then(function (r) { return r.blob(); }).then(function (blob) {
      return navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
    }).then(function () { flash(btn, 'Copied', 'ok'); })
      .catch(function () { flash(btn, 'Failed', 'err'); });
  }
});
</script>
</body></html>`;

writeFileSync(join(OUT, 'hd.html'), html);
console.log(`[hd-gallery] ${posters.length} posters -> out/hd.html`);
