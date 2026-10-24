#!/usr/bin/env node
// Targeted re-capture: cap1 (vision-card WITH token so it renders, not the token-error state)
// and cap5 (SPA deep-linked to a plugin so a map shows, not "choose a map").
// Retries navigation while concurrent builds churn the tree.
import { chromium } from './lib/playwright-guarded.mjs'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', 'public')
const OUT = resolve(HERE, '..', 'documentation', 'readme-images')
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.css':'text/css', '.webp':'image/webp', '.png':'image/png',
  '.svg':'image/svg+xml', '.geojson':'application/json', '.csv':'text/csv', '.woff2':'font/woff2' }
const server = createServer(async (req, res) => {
  try { let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]))
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' })
    res.end(await readFile(p)) } catch { res.writeHead(404).end('not found') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`
let TK = ''
try { const r = await fetch('https://doxa.life/api/maps/token', { signal: AbortSignal.timeout(8000) })
  TK = r.ok ? ((await r.json()).token || '') : '' } catch {}
console.log(TK ? `token acquired (${TK.length})` : 'NO token')
const browser = await chromium.launch()

async function tryShot(name, path, { vp = { width: 1440, height: 900 }, wait = 5000, dsf = 2, before = null, waitFor = null, tries = 8 } = {}) {
  for (let t = 1; t <= tries; t++) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf })
    const page = await ctx.newPage()
    let ok = false
    // Insert tk into the QUERY, keeping any #hash fragment LAST (else the route breaks).
    const hashAt = path.indexOf('#')
    const basePath = hashAt >= 0 ? path.slice(0, hashAt) : path
    const frag = hashAt >= 0 ? path.slice(hashAt) : ''
    const url = BASE + basePath + (basePath.includes('?') ? '&' : '?') + 'tk=' + encodeURIComponent(TK) + frag
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 })
      if (resp && resp.status() === 404) throw new Error('404')
      if (waitFor) { try { await page.waitForSelector(waitFor, { timeout: 12000 }) } catch {} }
      if (before) await before(page)
      await page.waitForTimeout(wait)
      await page.screenshot({ path: join(OUT, name + '.png') })
      ok = true
      console.log('  OK', name, `(try ${t})`)
    } catch (e) { console.log('  retry', name, t, e.message.split('\n')[0]) }
    finally { await ctx.close() }
    if (ok) return true
    await new Promise(r => setTimeout(r, 4000))
  }
  console.log('  GAVE UP', name)
  return false
}

// cap1: vision-card DEFAULT instance page (TOKEN_FREE=true -> renders the card instantly, no token error).
// Long wait so the aurora backdrop + rotating stat cards fully paint (they animate in).
await tryShot('cap1-single-element', `/${TREE_NAME}/doxa-vision-card/doxa-vision-card/default/index.html`,
  { wait: 9000 })

// cap5: SPA deep-linked to the prayer map instance so a real painted map shows in the right pane.
await tryShot('cap5-doxa-maps-spa', '/index.html#/doxa-simple-map/doxa-simple-map/prayer',
  { wait: 11000, waitFor: '#app' })

await browser.close(); server.close()
console.log('fix done')
