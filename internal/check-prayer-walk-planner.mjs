#!/usr/bin/env node
/**
 * check-prayer-walk-planner.mjs — the Prayer Walk Planner must be a full-page tool that prints a
 * real walking map.
 *
 * WHAT THIS PROTECTS (as reported: the prayer walk planner was still a very tiny map that did not
 * fill the page, and the printed map was a ~10px sliver):
 *   1. SIZE — the map canvas fills the page below the toolbar, standalone (its leaf) AND inside the
 *      Research Gallery, at 1280x800 and 390x844. Measured before the fix: 747x76 in the gallery on
 *      desktop and 390x0 on a phone, while the leaf filled — the gallery's inline host style fell
 *      through onto the component's root and turned its flex column into a block.
 *   2. PRINT — a real zone in a real city (Balat, Istanbul) renders a print-resolution map (>=2000px
 *      each way) that is not blank: many distinct colours, mostly non-white. The image is saved so a
 *      human can READ it: streets, building footprints, the zone outline on top.
 *   3. LOCALE — ?lang=es gives a Spanish toolbar.   4. 0 page errors on the print page.
 *   5. FULL SCREEN — from a 520px embed, the whole planner takes the viewport.
 *   6. PRINT RESOLUTION — the printed map measures >= 300 DPI at the sheet's printable width.
 *
 * Starts its own servers on OS-assigned ports; needs only a built tree. Run it inside the shared
 * browser locks, like every browser gate. OUT=<dir> chooses where the print PNG is written.
 * Exit: 0 pass · 1 fail · 2 SKIP (no built tree / no playwright) · 75 NOT MEASURED (server identity).
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(resolve(ROOT, `public/${TREE_NAME}/prayer-walk-planner/prayer-walk-planner.js`))) { console.log('SKIP check-prayer-walk-planner: no built planner'); process.exit(2) }
let chromium
try { ({ chromium } = await import('./lib/playwright-guarded.mjs')) } catch { console.log('SKIP check-prayer-walk-planner: playwright not installed'); process.exit(2) }
const OUT = process.env.OUT || '/tmp'
const free = () => new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const TP = await free(), HP = await free(), TREE = `http://127.0.0.1:${TP}/${TREE_NAME}`
const srv = spawn('node', ['internal/serve-strict.mjs', '--port', String(TP), '--exit-with-parent'], { cwd: ROOT, stdio: 'ignore' })
const host = createServer((q, r) => { const l = new URL(q.url, 'http://x').searchParams.get('l') || 'en'; r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><html lang="${l}"><body style="margin:0"><script src="${TREE}/doxa-maps-spa/doxa-maps-spa.js"></script><doxa-maps-spa tab="prayer-walk-planner" style="height:100vh"></doxa-maps-spa></body></html>`) }).listen(HP, 'localhost')
await new Promise(r => setTimeout(r, 800))

// ★ SERVER IDENTITY BY CONTENT, before a single measurement. A readiness check that only waits for
// HTTP 200 can adopt a STALE server: if the spawn above died (EADDRINUSE; its output is ignored) and
// something else answers on the port, every result would describe someone else's tree. So the served
// manifest must be byte-identical to THIS checkout's. A mismatch is NOT MEASURED (exit 75), never a
// pass or a fail — the same code the shared browser locks use for "busy, re-run later".
{
  const { readFileSync } = await import('node:fs')
  const disk = readFileSync(resolve(ROOT, `public/${TREE_NAME}/manifest.json`), 'utf8')
  let served = ''
  for (let i = 0; i < 20 && !served; i++) {
    try { const r = await fetch(`http://127.0.0.1:${TP}/${TREE_NAME}/manifest.json`); if (r.ok) served = await r.text() } catch { /* not up yet */ }
    if (!served) await new Promise(r => setTimeout(r, 300))
  }
  if (served !== disk) {
    console.log(`NOT MEASURED: the server on :${TP} is not serving this checkout's tree (manifest ${served ? 'differs' : 'unreachable'}). Re-run.`)
    try { srv.kill() } catch {} try { host.close() } catch {} process.exit(75)
  }
}
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const findEl = () => { const f = (root) => { const e = root.querySelector('prayer-walk-planner'); if (e) return e; for (const n of root.querySelectorAll('*')) if (n.shadowRoot) { const x = f(n.shadowRoot); if (x) return x } return null }; return f(document) }
const results = []
try {
  // 1. SIZE, 4 cells
  for (const [W, H] of [[1280, 800], [390, 844]]) for (const where of ['leaf', 'gallery']) {
    const p = await b.newPage({ viewport: { width: W, height: H } }); const errs = []
    p.on('pageerror', e => errs.push(String(e).slice(0, 140)))
    await p.goto(where === 'leaf' ? `${TREE}/prayer-walk-planner/prayer-walk-planner/index.html` : `http://localhost:${HP}/`)
    await p.waitForTimeout(9000)
    const m = await p.evaluate(`(() => { const el = (${findEl.toString()})(); if (!el) return null; const sr = el.shadowRoot, r = n => n ? Math.round(n.getBoundingClientRect().height) : 0; const pw = sr.querySelector('.pwp'); return { host: r(el), pwp: r(pw), toolbar: r(sr.querySelector('.pwp-toolbar')), canvas: r(sr.querySelector('canvas')), pwpDisplay: pw && getComputedStyle(pw).display, pwpDir: pw && getComputedStyle(pw).flexDirection } })()`)
    const ok = m && m.canvas >= (m.host - m.toolbar - 60) && m.canvas > 300
    results.push({ check: `size ${where} ${W}x${H}`, ok, m, errs })
    console.log(`${ok ? 'PASS' : 'FAIL'} size ${where} ${W}x${H}: ${JSON.stringify(m)} ${errs.length ? 'ERR ' + errs.join(' | ') : '0 errors'}`)
    await p.close()
  }
  // 1b. FULL SCREEN from inside a small embed: the whole planner (toolbar + map) takes the viewport.
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
    const fsHost = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><body style="margin:0"><h1 style="height:80px;margin:0">host</h1><script src="${TREE}/doxa-maps-spa/doxa-maps-spa.js"></script><doxa-maps-spa tab="prayer-walk-planner" style="height:520px"></doxa-maps-spa></body>`) })
    const FP = await new Promise(ok => fsHost.listen(0, 'localhost', () => ok(fsHost.address().port)))
    await p.goto(`http://localhost:${FP}/`); await p.waitForTimeout(9000)
    const fs = await p.evaluate(`(async () => { const el = (${findEl.toString()})(); const btn = el.shadowRoot.querySelector('.pwp-map-controls button'); if (!btn) return null; const before = Math.round(el.shadowRoot.querySelector('canvas').getBoundingClientRect().height); btn.click(); await new Promise(r => setTimeout(r, 2500)); const r = el.getBoundingClientRect(); return { before, after: Math.round(el.shadowRoot.querySelector('canvas').getBoundingClientRect().height), host: [Math.round(r.width), Math.round(r.height)] } })()`)
    const fok = !!fs && fs.host[0] >= 1270 && fs.host[1] >= 790 && fs.after > fs.before
    console.log(`${fok ? 'PASS' : 'FAIL'} full screen from a 520px embed: ${JSON.stringify(fs)}`); results.push({ check: 'full screen', ok: fok })
    await p.close(); fsHost.close()
  }
  // 2. PRINT MAP of a real zone (Balat, Istanbul: dense houses on small streets) + 4. LOCALE (es)
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)))
  await p.goto(`${TREE}/prayer-walk-planner/prayer-walk-planner/index.html?lang=es`)
  await p.waitForTimeout(8000)
  const ui = await p.evaluate(`(() => { const el = (${findEl.toString()})(); return [...el.shadowRoot.querySelectorAll('.pwp-btn')].map(b => b.textContent.trim()).slice(0, 4) })()`)
  const lok = ui.some(t => /Dibujar|Seleccionar/.test(t))
  console.log(`${lok ? 'PASS' : 'FAIL'} locale es toolbar: ${JSON.stringify(ui)}`); results.push({ check: 'locale es', ok: lok })
  const zone = [[28.9468, 41.0307], [28.9502, 41.0318], [28.9519, 41.0297], [28.9487, 41.0283]]
  const shot = await p.evaluate(`(async () => { const el = (${findEl.toString()})(); const id = el.addPolygon(${JSON.stringify(zone)}, 'Balat'); const url = await el.renderZoneMap(id); return url })()`)
  if (shot) {
    writeFileSync(`${OUT}/pwp-print-balat.png`, Buffer.from(shot.split(',')[1], 'base64'))
    const st = await p.evaluate(async (url) => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; const cols = new Set(); let nonBg = 0; for (let i = 0; i < d.length; i += 4 * 97) { cols.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); if (!(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)) nonBg++ } return { w: img.naturalWidth, h: img.naturalHeight, distinctColours: cols.size, nonWhiteShare: +(nonBg / (d.length / 4 / 97)).toFixed(2) } }, shot)
    const pok = st.w >= 2000 && st.h >= 2000 && st.distinctColours > 40 && st.nonWhiteShare > 0.3
    console.log(`${pok ? 'PASS' : 'FAIL'} print map: ${JSON.stringify(st)} -> ${OUT}/pwp-print-balat.png`); results.push({ check: 'print map', ok: pok, st })
  } else { console.log('FAIL print map: renderZoneMap returned null'); results.push({ check: 'print map', ok: false }) }
  console.log(`${errs.length ? 'FAIL' : 'PASS'} page errors on print page: ${errs.length} ${errs.join(' | ')}`); results.push({ check: 'errors', ok: !errs.length })

  // 5. PRINT RESOLUTION, MEASURED: the real printed sheet laid out as PRINT at the printable width
  // (8.5in - 2 x 12mm @page margins = 725 CSS px; emulateMedia alone does NOT apply @page margins,
  // which is how a first measurement read the frame as 8.48in wide). DPI = natural px / printed in.
  // The ask: a print that stays sharp when zoomed — at >= 300 DPI a zoomed PDF shows real
  // street names and house outlines, not an upscaled screen grab.
  await p.evaluate(() => { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === 'IFRAME') { try { n.contentWindow.print = () => {} } catch (_) {} window.__pwpFrame = n } }).observe(document.body, { childList: true }) })
  await p.evaluate(`(async () => { const el = (${findEl.toString()})(); const z = el.listPolygons().find(x => x.title === 'Balat'); el.selectPolygon(z.id, true); await el.print() })()`)
  await p.waitForTimeout(3000)
  const sheet = await p.evaluate(() => window.__pwpFrame ? window.__pwpFrame.contentDocument.documentElement.outerHTML : '')
  if (sheet) {
    const q = await b.newPage(); await q.emulateMedia({ media: 'print' }); await q.setViewportSize({ width: 725, height: 965 })
    await q.setContent('<!DOCTYPE html>' + sheet.replace(/<script>[\s\S]*?<\/script>/g, ''), { waitUntil: 'load' }); await q.waitForTimeout(1200)
    const dpi = await q.evaluate(() => { const i = document.querySelector('.snapshot'); if (!i) return null; const r = i.getBoundingClientRect(); return { naturalPx: [i.naturalWidth, i.naturalHeight], printedInches: [+(r.width / 96).toFixed(2), +(r.height / 96).toFixed(2)], dpi: [Math.round(i.naturalWidth / (r.width / 96)), Math.round(i.naturalHeight / (r.height / 96))] } })
    const dok = !!dpi && dpi.dpi[0] >= 300 && dpi.dpi[1] >= 300
    console.log(`${dok ? 'PASS' : 'FAIL'} print resolution: ${JSON.stringify(dpi)}`); results.push({ check: 'print dpi', ok: dok })
    await q.close()
  } else { console.log('FAIL print resolution: the print frame never appeared'); results.push({ check: 'print dpi', ok: false }) }
  await p.close()
} finally { await b.close(); host.close(); srv.kill() }
const bad = results.filter(r => !r.ok).length
console.log(bad ? `check-prayer-walk-planner: FAIL (${bad})` : 'check-prayer-walk-planner: PASS — the map fills the page in the leaf and the gallery at desktop and phone, and prints a street-level map')
process.exit(bad ? 1 : 0)
