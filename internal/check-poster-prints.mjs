// check-poster-prints — the SHARED print actions must produce real documents.
//
// Context: the poster wall was generalised into library/components/poster/
// PosterWall.vue and two bundles migrated onto it, but the ORIGINAL 903-line
// my-upg-100-list wall — the one carrying the actual print actions — was left
// behind. So the shared component's packet path was a "coming soon" stub, and
// every print fix in the 100-list was invisible to the three bundles using the
// shared wall. usePosterPrints.js closes that: the ACTIONS are shared, the RECORD
// FETCHING stays per-bundle behind a `records` provider.
//
// ★ THE SEAM IS THE THING TO ASSERT. A wall WITH a provider must produce a real
// document; a wall WITHOUT one must degrade honestly rather than failing at click
// time. Both directions are checked, because "the button is there" and "the button
// works" are different claims — this flight has repeatedly found the first true
// and the second false.
//
// Runs the composable in a browser page (it calls document/DOM), driving it with a
// fake records provider so the assertion is about the DOCUMENTS, not about any
// bundle's API being reachable.
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.DOXA_REPO
  // Third instance of one pattern this flight (after check-zone-census and
  // check-share-policy): a gate authored in one worktree hardcodes THAT worktree as its
  // fallback, and check:no-abs-paths — which is inside build:unlocked — turns red for every
  // other builder. DOXA_REPO still wins; only the default is made portable, using the idiom
  // check-no-absolute-paths.mjs prints in its own failure text.
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Measure THIS build, or measure nothing (exit 75 = NOT MEASURED; see a9550858 / _serves-this-tree.mjs).
{ const { requireThisRepo } = await import('./_serves-this-tree.mjs'); requireThisRepo(REPO, resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'POSTER-PRINTS') }
const src = readFileSync(resolve(REPO, 'library/composables/usePosterPrints.js'), 'utf8')
const frame = readFileSync(resolve(REPO, 'library/composables/printInPlace.js'), 'utf8')
// The composable dynamically imports its renderers by RELATIVE path. Under a blob
// URL there is no directory to resolve '../packet/...' against, so those imports
// fail with "Failed to resolve module specifier" — a harness limitation, not a
// product bug (Vite resolves them, and the built bundle inlines both renderers).
// Read them here and substitute blob URLs so the gate exercises the REAL code.
const packetRender = readFileSync(resolve(REPO, 'library/packet/packet-render.js'), 'utf8')
const cardRender = readFileSync(resolve(REPO, 'library/packet/card-render.js'), 'utf8')
const qr = readFileSync(resolve(REPO, 'library/packet/qr.js'), 'utf8')
const strings = readFileSync(resolve(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8')

const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 1000, height: 800 } })
const errs = []
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
await pg.setContent('<!DOCTYPE html><html><body></body></html>')

const r = await pg.evaluate(async ({ src, frame, packetRender, cardRender, qr, strings }) => {
  // Shim the two module deps so the composable can be evaluated standalone: a tiny
  // `ref`, and printInPlace's real source so the frame mechanism is the real one.
  const frameUrl = URL.createObjectURL(new Blob([frame], { type: 'text/javascript' }))
  const vueShim = URL.createObjectURL(new Blob([
    'export const ref = (v) => ({ value: v })',
  ], { type: 'text/javascript' }))
  const blob = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const qrUrl = blob(qr)
  const packetUrl = blob(packetRender.replace("from './qr.js'", `from '${qrUrl}'`))
  const cardUrl = blob(cardRender.replace("from './qr.js'", `from '${qrUrl}'`))
  const stringsUrl = URL.createObjectURL(new Blob([`export default ${strings}`], { type: 'text/javascript' }))
  const patched = src
    .replace("from 'vue'", `from '${vueShim}'`)
    .replace("from './printInPlace.js'", `from '${frameUrl}'`)
    .replace("'../packet/packet-render.js'", `'${packetUrl}'`)
    .replace("'../packet/card-render.js'", `'${cardUrl}'`)
    .replace(/'\.\.\/scripts\/posters\/packet-strings\.json'/g, `'${stringsUrl}'`)
  const modUrl = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }))
  const { usePosterPrints } = await import(modUrl)

  const ROWS = [
    { slug: 'a', name: 'Aheu', country_code_label: 'Laos', population: 2700, religion_label: 'Animism' },
    { slug: 'b', name: 'Akha', country_code_label: 'Laos', population: 113000, religion_label: 'Animism' },
  ]
  const out = {}

  // ── with a provider ──────────────────────────────────────────────────────
  // ⚠ CAPTURE THE HTML, do not read the frame back. openPrintFrame calls
  // window.print() under autoprint, which BLOCKS in headless Chromium, and the
  // frame self-removes on afterprint — so reading it back measured a frame that had
  // already gone and reported 0 rows for a correct document. Intercept the document
  // the composable hands to the frame instead: that IS what gets printed.
  let printed = ''
  const realCreate = document.createElement.bind(document)
  document.createElement = (tag) => {
    const el = realCreate(tag)
    if (tag === 'iframe') {
      Object.defineProperty(el, 'contentDocument', {
        get: () => ({ open() {}, close() {}, write(h) { printed += h } }),
      })
      Object.defineProperty(el, 'contentWindow', { get: () => ({ addEventListener() {} }) })
    }
    return el
  }
  const withProv = usePosterPrints({ records: async () => ROWS, label: (i) => i.label })
  await withProv.printList({ id: 'laos', label: 'Laos' })
  await new Promise((r2) => setTimeout(r2, 400))
  document.createElement = realCreate
  const doc = new DOMParser().parseFromString(printed, 'text/html')
  out.listRows = doc ? doc.querySelectorAll('tbody tr').length : 0
  out.listHasCheckbox = doc ? /□/.test(doc.body.innerText) : false
  out.listPhase = withProv.exportState.value?.phase ?? 'cleared'

  // ── the PACKET action: same provider, the full booklet ───────────────────
  // Migrated from upg-100-list.vue, where it was a second hand-maintained copy of
  // the same renderer call. Asserted here so the shared version cannot regress
  // silently — the packet is the product's core artefact.
  const PKT = [
    { slug: 'a', name: 'Aheu', country_code_label: 'Laos', population: 2700, image_url: 'x.jpg' },
    { slug: 'b', name: 'Akha', country_code_label: 'Laos', population: 113000, image_url: 'y.jpg' },
  ]
  printed = ''
  document.createElement = (tag) => {
    const el = realCreate(tag)
    if (tag === 'iframe') {
      Object.defineProperty(el, 'contentDocument', {
        get: () => ({ open() {}, close() {}, write(h) { printed += h } }),
      })
      Object.defineProperty(el, 'contentWindow', { get: () => ({ addEventListener() {} }) })
    }
    return el
  }
  const pk = usePosterPrints({ records: async () => PKT, label: (i) => i.label })
  await pk.printPacket({ id: 'laos', label: 'Laos' })
  await new Promise((r2) => setTimeout(r2, 600))
  document.createElement = realCreate
  const pdoc = new DOMParser().parseFromString(printed, 'text/html')
  out.packetSheets = pdoc.querySelectorAll('.sheet').length
  out.packetCards = pdoc.querySelectorAll('.card').length
  out.packetWheel = pdoc.querySelectorAll('svg path[fill^="hsl"]').length
  // ⚠ NOT /Gadarenes/. That is an ENGLISH proper noun from the World English Bible
  // text, so this assertion would go RED on a CORRECTLY TRANSLATED packet and passes
  // today only because point4_passage is still English in all ten non-English blocks
  // (DECIDE-MARK5-SCRIPTURE-IS-ENGLISH-IN-EVERY-TRANSLATED-PACKET). The check and the
  // bug were locked together — the same fix already applied in check-packet-render
  // and check-packet-browser. Assert the passage BLOCK and its length, which holds in
  // any language.
  out.packetMark5Len = (pdoc.querySelector('.p4-passage') || { textContent: '' }).textContent.trim().length
  // Point 4 prints THE HEAVENLY FATHER'S HEART (seven readings) in place of Mark 5:1-20 in full (2026-09-30).
  out.packetHeartItems = pdoc.querySelectorAll('.p4-heart li').length

  // ── without a provider: must FAIL HONESTLY, not throw ────────────────────
  const noProv = usePosterPrints({ label: (i) => i.label })
  await noProv.printList({ id: 'x', label: 'X' })
  out.noProvPhase = noProv.exportState.value?.phase
  out.noProvMsg = noProv.exportState.value?.message || ''
  return out
}, { src, frame, packetRender, cardRender, qr, strings })
await b.close()

const fails = []
if (r.listRows !== 2) fails.push(`the list print rendered ${r.listRows} row(s), expected 2`)
if (!r.listHasCheckbox) fails.push('the list print has no prayer checkbox column')
if (r.noProvPhase !== 'error') {
  fails.push(`without a records provider the phase was "${r.noProvPhase}", expected "error" — `
    + 'it must degrade honestly rather than silently doing nothing')
}
if (!/no records provider/i.test(r.noProvMsg)) {
  fails.push(`the no-provider message was "${r.noProvMsg}" — it should name the missing provider`)
}
// The packet is the product's core artefact: map page + people pages + points +
// wheel. Assert its SHAPE, not merely that bytes were produced. With 2 groups
// that is 1 map + 1 people page + points + wheel = 4 sheets.
if (r.packetSheets !== 4) fails.push(`the packet printed ${r.packetSheets} sheets, expected 4`)
if (r.packetCards !== 2) fails.push(`the packet printed ${r.packetCards} people cards, expected 2`)
if (r.packetWheel !== 12) fails.push(`the prayer wheel has ${r.packetWheel} segments, expected 12`)
// Point 4 prints Mark 5:18-20 AND THE HEAVENLY FATHER'S HEART, seven readings, on the points page (2026-09-30).
if (r.packetMark5Len < 250) {
  fails.push(r.packetMark5Len === 0
    ? 'the packet is missing Mark 5:18-20 (no .p4-passage block)'
    : `Mark 5:18-20 looks truncated: ${r.packetMark5Len} chars`)
}
if (r.packetHeartItems !== 7) {
  fails.push(r.packetHeartItems === 0
    ? "the packet is missing point 4's reading list (no .p4-heart block)"
    : `point 4's reading list prints ${r.packetHeartItems} of 7 readings`)
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log(`  list print        : ${r.listRows} rows, checkbox=${r.listHasCheckbox}`)
console.log(`  without provider  : phase=${r.noProvPhase} "${r.noProvMsg.slice(0, 60)}"`)
console.log(`  packet            : ${r.packetSheets} sheets, ${r.packetCards} cards, `
  + `${r.packetWheel} wheel segments, Mark5=${r.packetMark5Len} chars, point 4 list=${r.packetHeartItems}`)
console.log(`  page errors       : ${errs.length}`)

if (fails.length) {
  console.error(`\nPOSTER-PRINTS: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPOSTER-PRINTS: PASS — shared print actions produce real documents, and degrade honestly without a provider.')
