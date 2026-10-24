/**
 * check-gospel-map-paints.mjs — the map must put PIXELS on the screen, not just features.
 *
 * THE FAILURE THIS EXISTS FOR, which I shipped into my own tree and nearly landed. Injecting
 * mapbox-gl.css into this profile's shadow root was correct, and it collapsed the canvas from
 * 1440x900 to 1440x300 because .mapboxgl-map carries position:relative and cancelled the
 * container's absolute box. The result was a WHITE RECTANGLE. And every assertion I had went
 * green over it:
 *   - verify-gospel-map    : 2,107 of 2,107 pins "rendered"
 *   - check:leaves-mount   : element defined, shadow root full of text
 *   - the i18n gates       : every label translated, nothing clipped
 * queryRenderedFeatures does not care whether anything is visible, and neither does text. I
 * caught it by opening the screenshot, which is not a system.
 *
 * SO THIS ASKS THE ONE QUESTION NONE OF THEM ASK: is there a map there? It screenshots the
 * map element itself and counts distinct colours, the same technique check-embed-basemap
 * uses in an iframe — a basemap with land, water, borders and pins has hundreds; a blank
 * rectangle has one or two. It also checks the canvas fills its container, because a
 * correctly-coloured 300px strip in a 900px box is the exact defect that started this.
 *
 * Run with --poison to prove it can fail: it hides the canvas and requires a red verdict.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PORT = Number(process.env.PORT || 5399)
const BASE = process.env.BASE_URL || ('http://127.0.0.1:' + PORT)
const POISON = process.argv.includes('--poison')
const MIN_COLOURS = Number(process.env.MIN_MAP_COLOURS || 40)
const MIN_FILL = 0.7

let srv = null
if (!process.env.BASE_URL) srv = serveReaped(resolve(REPO, 'public'), PORT)

const countColours = async (page, b64) => page.evaluate(async (data) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + data
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const seen = new Set()
  for (let i = 0; i < d.length; i += 4) seen.add(((d[i] >> 3) << 10) | ((d[i+1] >> 3) << 5) | (d[i+2] >> 3))
  return seen.size
}, b64)

let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(BASE + `/${TREE_NAME}/gospel-resources/resources-map/index.html`,
    { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForFunction(() => window.__grState && window.__grState().pins > 0, null, { timeout: 60000 })
  await page.waitForTimeout(9000)

  if (POISON) {
    /* Reproduce the REAL defect rather than an approximation of it. Hiding the canvas was
       the first attempt and it did not work: the region still showed 316 colours, because a
       hidden GL canvas is not the same as an empty rectangle and other chrome sits in the
       frame. What actually happened was a stylesheet collapsing the container to 300px in a
       900px box, so that is what this injects — and the fill assertion is the arm that
       should catch it. A poison that does not mirror the incident tests the wrong thing. */
    await page.evaluate(() => {
      const sr = document.querySelector('gospel-resources-map').shadowRoot
      const map = sr.querySelector('.gm-map')
      if (map) { map.style.position = 'relative'; map.style.height = '300px'; map.style.inset = 'auto' }
      const cv = sr.querySelector('canvas')
      if (cv) { cv.style.height = '300px' }
    })
    await page.waitForTimeout(800)
  }

  /* THE RATIO THAT MATTERS IS MAP-TO-HOST, NOT CANVAS-TO-MAP. The first version compared the
     canvas to its own container, and the poison proved that useless: in the real incident the
     stylesheet collapsed the CONTAINER and the canvas dutifully followed, so canvas/container
     stayed 1.0 and the check would have passed the very defect it was written for. What
     actually went wrong is that the map stopped filling the ELEMENT, so that is the
     measurement. */
  const geom = await page.evaluate(() => {
    const el = document.querySelector('gospel-resources-map')
    const sr = el.shadowRoot
    const map = sr.querySelector('.gm-map')
    const cv = sr.querySelector('canvas')
    const eb = el.getBoundingClientRect()
    const mb = map ? map.getBoundingClientRect() : null
    const cb = cv ? cv.getBoundingClientRect() : null
    return {
      host: Math.round(eb.width) + 'x' + Math.round(eb.height),
      container: mb ? Math.round(mb.width) + 'x' + Math.round(mb.height) : 'none',
      canvas: cb ? Math.round(cb.width) + 'x' + Math.round(cb.height) : 'none',
      fill: mb && eb.height ? mb.height / eb.height : 0,
    }
  })

  /* ═══ SAMPLE THE MAP, NOT THE PANEL OVER IT ═════════════════════════════════════════
   * The first version screenshotted the whole custom element and counted 427 colours with
   * the canvas HIDDEN — because the legend card is itself full of colour and sits on top.
   * The poison arm caught that, which is the entire reason a gate carries one: a check that
   * measures the wrong rectangle passes for the wrong reason. The legend occupies the left
   * edge, so the sample is taken from the right of it and looks at map alone. */
  const clip = await page.evaluate(() => {
    const sr = document.querySelector('gospel-resources-map').shadowRoot
    const map = sr.querySelector('.gm-map') || sr.host
    const legend = sr.querySelector('.gm-legend')
    const m = map.getBoundingClientRect()
    const left = legend ? legend.getBoundingClientRect().right + 12 : m.left
    return { x: Math.round(left), y: Math.round(m.top), width: Math.max(8, Math.round(m.right - left)), height: Math.max(8, Math.round(m.height)) }
  })
  const shot = await page.screenshot({ clip })
  const colours = await countColours(page, shot.toString('base64'))

  console.log('  host ' + geom.host + ' · map ' + geom.container + ' · canvas ' + geom.canvas +
              ' · map fills ' + Math.round(geom.fill * 100) + '% of the element')
  console.log('  distinct colours on screen: ' + colours + ' (floor ' + MIN_COLOURS + ')')

  const problems = []
  if (colours < MIN_COLOURS) problems.push('only ' + colours + ' distinct colours — this is a blank rectangle, not a map')
  if (geom.fill < MIN_FILL) problems.push('the map fills only ' + Math.round(geom.fill * 100) + '% of the element height; a stylesheet has collapsed it')

  if (POISON) {
    if (!problems.length) {
      console.error('MAP-PAINTS: SELF-TEST FAIL — a collapsed map passed as a painted one.')
      process.exitCode = 1
    } else {
      console.log('MAP-PAINTS --poison: caught it — ' + problems[0])
      console.log('MAP-PAINTS: SELF-TEST PASS — the check fails as designed.')
    }
  } else if (problems.length) {
    console.error('MAP-PAINTS: FAIL — ' + problems.length + ' problem(s):')
    for (const p of problems) console.error('  ' + p)
    console.error('  Pin counts and rendered text cannot see this: queryRenderedFeatures')
    console.error('  answers happily over a white rectangle. Open the screenshot.')
    process.exitCode = 1
  } else {
    console.log('MAP-PAINTS: PASS — the map paints, and the canvas fills its container.')
  }
} finally {
  await browser?.close()
  srv?.stop()
}
