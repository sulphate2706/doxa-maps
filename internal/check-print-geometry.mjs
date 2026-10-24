// check-print-geometry — the THREE print paths must each produce their OWN page
// geometry, from the UPG-100 page, in JavaScript.
//
// THE ASK: poster generation works, and the print dialog's aspect ratio follows
// what is being printed, so the print dialog works for the poster, the vertical
// packet and the horizontal cards, all in the JAMstack maps rather than in Python.
//
// One gate over all three because the failure they share is the same: a print
// path silently falling back to letter. Chromium does that SILENTLY for any
// @page size it does not recognise ('A6 portrait' -> 612x792pt, no error), so
// every assertion here is on the MEASURED MediaBox, never on the stylesheet.
//
// Usage: node internal/check-print-geometry.mjs
//   PACKET_ORIGIN (default http://127.0.0.1:4898) — a static server over the repo root
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const ORIGIN = process.env.PACKET_ORIGIN || 'http://127.0.0.1:4898'
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(ORIGIN, ROOT, 'PRINT-GEOMETRY')
const API = process.env.PACKET_API || 'https://pray.doxa.life'
const ISO3 = process.env.PACKET_ISO3 || 'LAO'

// Each path, its expected page in POINTS (72pt = 1in), and its orientation.
const PATHS = [
  { id: 'packet (vertical)', w: 612, h: 792, orient: 'portrait' },
  { id: 'cards (poker)', w: 180, h: 252, orient: 'portrait', stock: 'poker' },
  { id: 'cards (landscape)', w: 252, h: 180, orient: 'landscape', stock: 'pokerLandscape' },
  { id: 'poster', w: null, h: null, orient: 'portrait' },   // raster, not paginated
]

const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } })
const errs = []; pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
await pg.goto(ORIGIN + '/')

const fails = []
const line = (id, got, want) => console.log(`  ${id.padEnd(20)} ${got}${want ? `   (want ${want})` : ''}`)

// ── 1 + 2: the paginated paths, measured through page.pdf ────────────────────
for (const p of PATHS.filter((x) => x.w)) {
  const html = await pg.evaluate(async ({ ORIGIN, API, ISO3, stock }) => {
    const norm = await import(`${ORIGIN}/plugin-designs/my-upg-100-list/data/normalize.js`)
    const strings = await fetch(`${ORIGIN}/library/scripts/posters/packet-strings.json`).then((r) => r.json())
    const recs = norm.normalizeRecords(norm.extractRecords(await (await fetch(
      `${API}/api/people-groups/list?fields=slug,name,country_code,population,religion,image_url,primary_language&lang=en`)).json()))
    const groups = recs.filter((r) => String(r.country_code) === ISO3).slice(0, 6)
    if (stock) {
      const { createCardRenderer } = await import(`${ORIGIN}/library/packet/card-render.js`)
      return createCardRenderer({ strings, lang: 'en', stock }).buildDeck({ id: 'x', label: 'X' }, groups)
    }
    const { createPacketRenderer } = await import(`${ORIGIN}/library/packet/packet-render.js`)
    return createPacketRenderer({ strings, lang: 'en' }).buildPacket({ id: 'x', label: 'X' }, groups, new Map(), '')
  }, { ORIGIN, API, ISO3, stock: p.stock })

  await pg.setContent(html, { waitUntil: 'load' })
  await pg.waitForTimeout(1200)
  const pdf = await pg.pdf({ preferCSSPageSize: true })
  const raw = pdf.toString('latin1')
  const box = [...raw.matchAll(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [+m[1], +m[2]])[0] || [0, 0]
  const [w, h] = box.map((v) => Math.round(v))
  line(p.id, `${w} x ${h} pt`, `${p.w} x ${p.h}`)
  if (Math.abs(w - p.w) > 2 || Math.abs(h - p.h) > 2) {
    fails.push(`${p.id}: page is ${w}x${h}pt, expected ${p.w}x${p.h}pt`
      + (Math.abs(w - 612) < 2 && Math.abs(h - 792) < 2 && p.w !== 612
        ? ' — this is LETTER: the @page size silently fell back' : ''))
  }
  const landscape = w > h
  if ((p.orient === 'landscape') !== landscape) {
    fails.push(`${p.id}: orientation is ${landscape ? 'landscape' : 'portrait'}, expected ${p.orient}`)
  }
}

// ── 3: the poster, which rasterises rather than paginating ───────────────────
const poster = await pg.evaluate(async ({ ORIGIN }) => {
  const { rasterPoster, looksRendered } = await import(`${ORIGIN}/library/packet/poster-raster.js`)
  const res = await fetch(`${ORIGIN}/library/scripts/posters/out/posters/laos.html`)
  if (!res.ok) return { error: `poster HTML ${res.status}` }
  const blob = await rasterPoster(await res.text(), { scale: 1 })
  const bmp = await createImageBitmap(blob)
  return { w: bmp.width, h: bmp.height, ok: await looksRendered(blob), bytes: blob.size }
}, { ORIGIN })
if (poster.error) fails.push(`poster: ${poster.error}`)
else {
  line('poster', `${poster.w} x ${poster.h} px`, 'portrait, painted')
  if (poster.w >= poster.h) fails.push(`poster rasterised ${poster.w}x${poster.h} — expected portrait`)
  if (!poster.ok) fails.push('poster rasterised blank/black')
}

await b.close()
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)
if (fails.length) {
  console.error(`\nPRINT-GEOMETRY: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPRINT-GEOMETRY: PASS — every print path produces its own page geometry.')
