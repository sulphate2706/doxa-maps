#!/usr/bin/env node
/**
 * check-export-poster-prints.mjs — the Simple Research "Export poster" button opens the PRINT DIALOG
 * with the poster in it, on ONE click, in its own leaf AND inside the Research Gallery, in en AND ar.
 * It must NEVER hand over a file.
 *
 * ★ THE RULE CHANGED, AND THIS GATE ASSERTED THE OLD ONE (ruled 2026-09-28: "an export-poster
 * button must open the print dialog with a poster preview, never a direct download"). It was
 * check-export-one-click, and it passed while the button did exactly what has now been ruled
 * against: render a PNG and drop it in the downloads folder. A gate that encodes a superseded ruling
 * is worse than no gate — it defends the defect. The earlier history is still why the click path is
 * measured so carefully: before 2026-09-25 one click produced NOTHING, no dialog, no file, no error.
 *
 * WHAT IT ASSERTS, per host × language:
 *   1. exactly ONE click on the ALWAYS-VISIBLE export button in the map toolbar
 *      (button.export-poster-btn). The drawer's "Export poster…" does not count: the drawer is CLOSED
 *      by default (translated off screen), so it costs an extra click to reach — measured 2026-09-25,
 *      and in Arabic the button could not be clicked at all;
 *   2. within 120s and with no further click, some frame calls window.print();
 *   3. the printing document IS the poster: an <img> at the print size (US Letter at 200 DPI =
 *      1700x2200) on an @page sized 8.5in x 11in, or both turned (2200x1700 on 11in x 8.5in), because
 *      the paper turns landscape when the map is wider than it is tall. The image and the sheet must
 *      turn TOGETHER. A dialog over a blank or letter-defaulted sheet is not a preview of what was
 *      rendered;
 *   4. NO download arrives. This is the half that encodes the new rule, and it is asserted for the
 *      whole run rather than at a moment, because a download that lands late is still a download;
 *   5. 0 page errors.
 *
 * ★ window.print IS STUBBED, not called through. The native dialog is modal and would hang the run
 * forever, so the init script records the call and returns. That makes this a test of everything up to
 * the dialog — the frame, the sheet size and the image — and not of the browser's own chrome, which is
 * the correct boundary for a headless gate.
 *
 * Runs through internal/browser-slot.sh like every browser gate. Starts its own servers on
 * OS-assigned ports and proves the server is THIS checkout's tree before measuring.
 * --provider maplibre runs the same four on the keyless engine.
 * Exit: 0 pass · 1 fail · 2 SKIP (no built tree / no playwright) · 75 NOT MEASURED (server identity)
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// The tree's name comes from the build config, never a literal: the doxa-maps -> dx-maps rename
// turned the literal into a silent SKIP (exit 2) that measured nothing.
const { TREE_NAME } = await import(resolve(ROOT, 'internal/_tree-name.mjs'))
if (!existsSync(resolve(ROOT, `public/${TREE_NAME}/research-map-plus-grid/research-map-plus-grid.js`))) {
  console.log('SKIP check-export-poster-prints: no built research-map-plus-grid'); process.exit(2)
}
let chromium
try { ({ chromium } = await import('../../../internal/lib/playwright-guarded.mjs')) } catch { console.log('SKIP check-export-poster-prints: playwright not installed'); process.exit(2) }

const freePort = () => new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const PROVIDER = process.argv.includes('--provider') ? process.argv[process.argv.indexOf('--provider') + 1] : ''   // maplibre = the keyless engine
const TP = await freePort(), HP = await freePort()
const TREE = `http://127.0.0.1:${TP}/${TREE_NAME}`
let lang = 'en'
const srv = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(TP)], { cwd: ROOT, stdio: 'ignore' })
const host = createServer((_, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><html lang="${lang}"><body style="margin:0"><script src="${TREE}/doxa-maps-spa/doxa-maps-spa.js"></script><doxa-maps-spa tab="research-map-plus-grid"${PROVIDER ? ` provider="${PROVIDER}"` : ''} style="height:900px"></doxa-maps-spa></body></html>`) }).listen(HP, 'localhost')
const cleanup = () => { try { srv.kill() } catch {} try { host.close() } catch {} }
await new Promise(r => setTimeout(r, 800))

// Server identity by CONTENT: the served manifest must be this checkout's.
{
  const disk = readFileSync(resolve(ROOT, `public/${TREE_NAME}/manifest.json`), 'utf8')
  let served = ''
  for (let i = 0; i < 20 && !served; i++) {
    try { const r = await fetch(`${TREE}/manifest.json`); if (r.ok) served = await r.text() } catch { /* not up yet */ }
    if (!served) await new Promise(r => setTimeout(r, 300))
  }
  if (served !== disk) { console.log(`NOT MEASURED: :${TP} is not serving this checkout's tree. Re-run.`); cleanup(); process.exit(75) }
}

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const fails = []
try {
  for (lang of ['en', 'ar']) for (const where of ['leaf', 'gallery']) {
    const url = where === 'leaf' ? `${TREE}/research-map-plus-grid/research-map-plus-grid/index.html?lang=${lang}${PROVIDER ? `&provider=${PROVIDER}` : ''}` : `http://localhost:${HP}/`
    const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } })
    // Every frame, because the poster prints from an iframe the app creates (printInPlace.js). The
    // override lives on the WINDOW, which survives the document.open()/write() that fills that frame.
    // acceptDownloads stays TRUE on purpose: a download must be observable to be failed on.
    await ctx.addInitScript(() => {
      window.__printed = []
      window.print = function () {
        const img = document.querySelector('img')
        const style = document.querySelector('style')
        window.__printed.push({
          imgW: img ? img.naturalWidth : 0,
          imgH: img ? img.naturalHeight : 0,
          page: style ? (String(style.textContent).match(/@page\{size:([^;}]+)/) || [])[1] || '' : '',
        })
      }
    })
    const p = await ctx.newPage(); const errs = []
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
    // A failed export is CAUGHT and logged (console.error), never thrown: read the console, or a dead
    // button reports "no file" with no reason.
    const consoleErrs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrs.push(m.text().slice(0, 200)) })
    const downloads = []; p.on('download', d => downloads.push(d))
    await p.goto(url); await p.waitForTimeout(12000)
    const btn = p.locator('button.export-poster-btn').first()
    const onScreen = await btn.evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }).catch(() => false)
    if (!onScreen) errs.push('the export button is not on screen without a prior click')
    const label = ((await btn.getAttribute('title', { timeout: 20000 }).catch(() => '')) || '').trim()
    let clicks = 0
    // ONE PHYSICAL CLICK at the button's centre, as a reader makes it. Not locator.click(): that
    // re-checks its hit target and RETRIES, and by the retry the button is already disabled (the
    // export is running), so it reported "timeout" on exports whose file then arrived — measured
    // 2026-09-25 in gallery-ar and leaf-en. What the click achieved is judged by the file below.
    try {
      const box = await btn.boundingBox({ timeout: 20000 })
      if (!box) throw new Error('the export button has no box')
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); clicks = 1
    } catch (e) { errs.push('could not click: ' + String(e.message || e).split('\n')[0]) }
    // Poll every frame: the print call happens in the iframe printInPlace creates, which is not
    // attached when the click is made. A frame that has gone away is skipped rather than failing the
    // poll — the app reclaims its print frame, and a reclaimed frame is a completed print, not an error.
    const readPrints = async () => {
      const out = []
      for (const f of p.frames()) {
        const got = await f.evaluate(() => window.__printed || []).catch(() => [])
        out.push(...got)
      }
      return out
    }
    let prints = []
    for (let i = 0; i < 120 && !prints.length; i++) { await p.waitForTimeout(1000); prints = await readPrints() }
    let info = ''
    if (prints.length) {
      const pr = prints[0]
      info = `${pr.imgW}x${pr.imgH} on @page ${pr.page || '(none)'}`
      // The poster, at the size it was rendered, on the sheet it was rendered for. Either orientation
      // (research-map.vue turns the paper to match the map), but the image's shape must be the sheet's.
      // A negated <= so a missing image (NaN) fails rather than passes.
      const sheet = /(\d+(?:\.\d+)?)in\s+(\d+(?:\.\d+)?)in/.exec(pr.page || '')
      const [sw, sh] = sheet ? [+sheet[1], +sheet[2]] : [0, 0]
      if (Math.min(pr.imgW, pr.imgH) < 1600 || Math.max(pr.imgW, pr.imgH) < 2100) errs.push(`the printed document is not the poster (${info})`)
      if (Math.min(sw, sh) !== 8.5 || Math.max(sw, sh) !== 11) errs.push(`the sheet is not the poster's page size (@page ${pr.page || 'missing'})`)
      else if (!(Math.abs(pr.imgW / pr.imgH - sw / sh) <= 0.02)) errs.push(`the poster and its sheet are not the same shape (${info})`)
    } else {
      for (const c of consoleErrs.filter(c => /poster|print|useMapPoster/i.test(c)).slice(-2)) errs.push(c)
      // SLOW or DEAD? A button still busy at the deadline is a render still running; an idle one is an
      // export that ended without opening anything. The verdict is FAIL either way; the reason says which.
      const busy = await btn.evaluate(el => el.disabled || el.getAttribute('aria-busy') === 'true').catch(() => null)
      errs.push(busy ? 'still rendering at the deadline (button busy)' : 'the export ended with no print dialog (button idle)')
    }
    // ★ THE NEW RULE'S OTHER HALF. A button that opens the dialog AND saves a file still breaks it.
    if (downloads.length) errs.push(`the button downloaded a file (${downloads[0].suggestedFilename()}) instead of only printing`)
    const ok = clicks === 1 && prints.length === 1 && !downloads.length && !errs.length
    // Exactly one dialog: two print frames would mean the click was handled twice, which a reader sees
    // as a second dialog appearing behind the first.
    if (clicks === 1 && prints.length > 1) errs.push(`${prints.length} print dialogs opened on one click`)
    console.log(`${ok ? 'PASS' : 'FAIL'} [${where} ${lang}${PROVIDER ? ' ' + PROVIDER : ''}] "${label}" · 1 click → ${prints.length ? `print dialog (${info})` : 'NO PRINT DIALOG within 120s'}${errs.length ? ' · ' + [...new Set(errs)].slice(0, 3).join(' | ') : ' · 0 errors, 0 downloads'}`)
    if (!ok) fails.push(`${where} ${lang}`)
    await ctx.close()
  }
} finally { await b.close(); cleanup() }

if (fails.length) { console.log(`\ncheck-export-poster-prints: FAIL (${fails.join(', ')})`); process.exit(1) }
console.log('\ncheck-export-poster-prints: PASS — one click opens the print dialog on the poster and downloads nothing, leaf and gallery, en and ar')
