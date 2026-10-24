#!/usr/bin/env node
/**
 * verify-gospel-map.mjs — the gospel-resources map must render its pins and answer a tap.
 *
 * WHY THIS IS A GATE AND NOT A SCRATCH PROBE. Every browser check written for this bundle
 * lived in _qa-cycle/, which is gitignored: a dozen probes that proved the pins render, the
 * sheet opens with real links, and the deep link filters the table — all of which vanish
 * with the working tree. check:coverage-consistent guards the DATA and cannot see the map.
 * The repo has carded orphaned gates twice; this is the same loss one step earlier, a gate
 * that was never committed at all.
 *
 * WHAT IT ASSERTS, against the SHIPPED tree through the production-parity server:
 *   1. the element mounts and exposes window.__grState — a stale-SRI leaf silently refuses
 *      to execute its script, which looks exactly like a mount failure;
 *   2. every pin in the source is RENDERED, not merely loaded;
 *   3. tapping a pin opens a group whose language is NAMED and whose links are real URLs
 *      belonging to the screened hosts — never a fabricated or off-list link;
 *   4. the gap filter actually filters: fewer features, and only tier 0 left;
 *   5. the sheet's "every resource" link carries the group's own ISO code.
 *
 * ★ WAIT FOR IDLE BEFORE COUNTING. queryRenderedFeatures before first paint returns 0,
 * which is indistinguishable from a layer that is not painting — the first version of this
 * check reported a false negative on itself for exactly that reason.
 *
 * ★ AND THE HOST LIST IS THE DOCTRINE BOUNDARY, enforced here rather than trusted: only
 * eBible/PNG.Bible/Door43/JESUS Film may appear. A link to an excluded publisher would be
 * a doctrinal failure, not a broken link, so it fails this gate loudly.
 *
 * ★ IT STARTS ITS OWN SERVER. Browser gates in this repo rot because they need a server
 * someone else remembered to start: verify:browser-all is invoked NOWHERE, build:unlocked
 * runs only `bun run verify`, and verify-all.mjs skips anything marked browser:true unless
 * --full is passed. The repo has already lost two gates that way — "both had rotted
 * unnoticed precisely because the build chain has never run them". A gate with a manual
 * precondition is a gate that will not run, so this one removes the precondition: if
 * nothing answers, it spawns serve-strict on an ephemeral port and shuts it down after.
 *
 * An explicit BASE_URL or argv[2] is honoured as-is and never auto-served — a caller
 * naming a host means it, and silently pointing at a different tree would be worse than
 * failing.
 *
 * USAGE: node internal/verify-gospel-map.mjs [baseUrl]    (no setup needed)
 * Skips loudly (exit 0) only if the tree is not built, the way CI sees it.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { servesThisTree } from './_serves-this-tree.mjs'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

// The data files this gate judges; declared to servesThisTree so their served bytes must equal disk.
const GOSPEL_DATA = ['assets/tables/people-group-pins.json', 'assets/tables/doxa-gospel-access.json']
const BASE = (process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:4173').replace(/\/+$/, '')
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox']
// The screened publishers. Anything else is a doctrine failure, not a typo.
//
// ★ FOUR HOSTS WERE MISSING AND THAT WAS NOT AN OVERSIGHT IN THE LIST — it was the scan being
// too narrow to ever meet them. pray.doxa.life (Doxa's own prayer pages), fivefish.org (Global
// Recordings Network's Words of Life), scriptureearth.org (SIL) and now sun.bible are all pools
// this build already draws from, yet the regex had never seen one: the pin-index scan reads only
// some of the index's link fields, and the access table was not scanned at all. Adding the hosts
// without widening the scan would have been the worse fix — a longer list that still proves
// nothing about the links nobody looks at.
const ALLOWED = /^(https:\/\/)?([a-z0-9-]+\.)*(ebible\.org|png\.bible|alkitab\.pw|git\.door43\.org|jesusfilm\.org|arc\.gt|zume\.training|bible\.is|knowgod\.com|sun\.bible|pray\.doxa\.life|fivefish\.org|scriptureearth\.org)(\/|$)/i

/* ★ A CONTACT IS NOT A PUBLISHER, AND THE TWO LISTS MUST NOT MERGE (2026-09-26). The credit line
   now links the translating organisation, so cr.u is a FIFTH place a URL lives in the index — the
   omission class this file already warns about, caught on the build that introduced it. These
   hosts are screened as organisations a mobiliser may CONTACT, not as publishers whose text this
   map serves, and they are spelled out here rather than read from the data file they came from:
   a screen that trusts the file it is screening is not a screen. A contact host is therefore
   still a failure if it ever appears as a resource link, because ALLOWED does not list it. */
const ALLOWED_CONTACT = /^https:\/\/([a-z0-9-]+\.)*(wycliffe\.org|wycliffe\.ca|wycliffe\.org\.au|twftw\.org|biblica\.com|pioneerbible\.org|seedcompany\.com|sim\.org|bibleleague\.org|door43\.org|bridgeconn\.com|btlkenya\.org|kartidaya\.org|liebenzell\.org|sil\.org|lockman\.org)\/?$/i

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const EXPLICIT = !!(process.env.BASE_URL || process.argv[2])

let base = BASE
let server = null
// ADOPTING A SERVER REQUIRES PROVING IT SERVES *THIS* TREE.
// This used to accept anything that answered 200 on the default port, and that is not the
// same question. Measured: port 4173 was held by an unrelated python3 process belonging to
// another worktree, the gate adopted it, and it spent three runs reporting on a build that
// was not this one — first a PASS, then a mount timeout that looked exactly like a
// regression in code that had nothing to do with it.
// The fingerprint is the built bundle itself: if the bytes served differ from the bytes on
// disk, it is a different tree and must not be used.
const alive = async (b) => {
  const r = await fetch(`${b}/${TREE_NAME}/gospel-resources/resources-map/index.html`).catch(() => null)
  if (!(r && r.ok)) return false
  // The tables this gate judges are declared, so a server whose manifest matches but whose DATA does
  // not (another worktree) is not adopted — the gate starts its own server for THIS checkout instead.
  const tree = await servesThisTree(b, REPO, { assets: GOSPEL_DATA })
  if (tree.ok) return true
  console.log(`GOSPEL-MAP: not adopting ${b} — ${tree.why}`)
  return 'different'   // reachable, but not THIS tree — distinct from "nothing there"
}

const adopted = await alive(base)
if (adopted === 'different' && EXPLICIT) {
  // You NAMED this server and it is another tree: that is NOT MEASURED, never a skip (exit 0 read as
  // green while the gate had measured nothing of this checkout).
  console.log(`GOSPEL-MAP: NOT MEASURED — ${base} is not serving THIS checkout (see above).`)
  process.exit(75)
}
if (adopted !== true) {
  if (EXPLICIT) {
    console.log(`GOSPEL-MAP: SKIP — nothing served at ${base} (you named it explicitly, so none was started).`)
    process.exit(0)
  }
  if (!existsSync(resolve(REPO, `public/${TREE_NAME}/gospel-resources/resources-map/index.html`))) {
    console.log('GOSPEL-MAP: SKIP — no built tree. Run `bun run tree` (cheap) or a full build first.')
    process.exit(0)
  }
  // Ephemeral port so two gates running at once cannot collide on 4173.
  const port = 5100 + Math.floor(Math.random() * 800)
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [resolve(HERE, 'serve-strict.mjs'), '--port', String(port), '--directory', resolve(REPO, 'public'), '--exit-with-parent'], { stdio: 'ignore', detached: false })
  const until = Date.now() + 15000
  while (Date.now() < until && !(await alive(base))) await new Promise((r) => setTimeout(r, 250))
  if (!(await alive(base))) {
    try { server.kill() } catch (_) {}
    console.error('GOSPEL-MAP: FAIL — could not start serve-strict for the check.')
    process.exit(1)
  }
  console.log(`GOSPEL-MAP: started serve-strict on ${port} for this run.`)
}
const PAGE_URL = `${base}/${TREE_NAME}/gospel-resources/resources-map/index.html`

const fails = []
let linkCount = 0
let contactCount = 0
let exitCode = 0
const browser = await chromium.launch({ headless: true, args: GL })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

try {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 })
  // 1 — mounted. A stale-SRI leaf never executes, and that reads as "did not mount".
  await page.waitForFunction(() => typeof window.__grState === 'function', { timeout: 45000 })
  // ★ idle FIRST: counting before first paint returns 0 and looks like a dead layer.
  await page.evaluate(() => new Promise((r) => {
    const m = window.__grMap
    m.loaded() ? r() : m.once('idle', r)
    setTimeout(r, 8000)
  }))

  const st = await page.evaluate(() => window.__grState())
  if (!st.hasLayer || !st.hasSource) fails.push('pin layer or source missing')
  // 2 — rendered, not merely loaded
  if (!st.pins || st.rendered !== st.pins) {
    fails.push(`${st.rendered} of ${st.pins} pins rendered`)
  }

  // 3 — a tap answers, with a named language and real links
  const opened = await page.evaluate(() => {
    const f = window.__grMap.getSource('gr-pin-src')._data.features
    for (const x of f) {
      window.__grOpenPin(x.properties.i)
      const g = window.__grState().group
      if (g && (g.scripture_url || g.film_url)) {
        return { pg: g.people_group, lang: g.language, iso: g.iso639_3, s: g.scripture_url, f: g.film_url }
      }
    }
    return null
  })
  if (!opened) fails.push('no pin opened a group carrying a link')
  else if (!String(opened.lang || '').trim()) fails.push(`${opened.pg} opened with no language name`)

  // ★ EVERY link in the index the page loaded, not just the one group we opened. The
  // first version checked only the opened group's two URLs — a sample of 1 out of 2,685
  // codes — so an excluded publisher injected anywhere else passed cleanly. MEASURED: a
  // jw.org URL planted in the served data did NOT fail this gate until the scan covered
  // the whole index. The doctrine boundary is the one thing here that must never be
  // spot-checked: a single off-list link is a doctrinal failure, not a broken link.
  /**
   * ═══ PROVE THE SERVER HOLDS *THESE* TABLES, NOT JUST *A* BUILD ═══════════════════════════
   *
   * servesThisTree fingerprints public/doxa-maps/manifest.json, and that is not enough here.
   * MEASURED 2026-09-25: this gate adopted a python3 -m http.server on the default port 4173
   * belonging to a DIFFERENT worktree (wt-packet) and reported PASS on it. The three manifests
   * — mine, wt-packet's on disk, and the one being served — are byte-identical, because a
   * manifest describes the BUNDLES and the change under test was to a DATA asset it never
   * mentions. So the guard did its job correctly and still could not tell the trees apart.
   *
   * It was caught only because a planted jw.org link went UNDETECTED: the doctrine scan passed
   * on a tree that did not contain the link. That is the worst possible failure for this
   * particular gate — the one check here that must never be spot-checked was reading someone
   * else's data — and nothing about the output looked wrong.
   *
   * So the tables this gate is about are compared to disk BY CONTENT before they are judged.
   * The general weakness belongs to _serves-this-tree.mjs and every gate that relies on it;
   * this only closes it for the two files this gate actually measures.
   */
  // (The per-gate copy of this check that used to live here is now the shared helper's `assets`
  // option — the weakness was in _serves-this-tree.mjs, so the fix is there, for every gate.)
  const ident = await servesThisTree(base, REPO, { assets: GOSPEL_DATA })
  if (!ident.ok) {
    console.error(`GOSPEL-MAP: NOT MEASURED — ${ident.why}.`)
    console.error(`  Serving ${base}. Point BASE_URL at a server for THIS checkout, or stop the`)
    console.error('  one holding the port; a PASS here would be about somebody else\'s data.')
    if (server) server.kill()
    process.exit(75)
  }

  const idxRes = await fetch(`${base}/${TREE_NAME}/assets/tables/people-group-pins.json`)
  if (!idxRes.ok) fails.push(`pin index not served (${idxRes.status})`)
  else {
    const idx = await idxRes.json()
    const bad = [], contactBad = []
    let scanned = 0, contacts = 0
    for (const [c, v] of Object.entries(idx.codes || {})) {
      /* ⚠ ga (Words of Life) and se (Scripture Earth) were absent from this list, so every link
         from those two pools went unscreened — the doctrine boundary is the one thing that must
         never be spot-checked, and this was spot-checking by omission. */
      for (const u of [v.s, v.f, v.z, v.za && v.za.u, v.au && v.au.u, v.bv && v.bv.u, v.gp && v.gp.u,
        v.ga && v.ga.u, v.se && (v.se.u || v.se), ...(v.d || []).map((d) => d.u)]) {
        if (!u) continue
        scanned++
        if (!ALLOWED.test(u)) bad.push(`${c} -> ${u}`)
      }
      /* The translator contact, screened against the OTHER list. Counted apart so "every link is
         on a screened publisher" keeps meaning exactly that. */
      const cu = v.cr && v.cr.u
      if (cu) {
        contacts++
        if (!ALLOWED_CONTACT.test(cu)) contactBad.push(`${c} -> ${cu}`)
      }
    }
    /* ★ THE SUN BLOCK IS A THIRD PLACE URLS LIVE (2026-09-25). The Deaf bridge is carried as a
       single top-level object rather than per-language under codes[], because SUN is one signed
       language for all of them — so the loop above cannot see it. Scanned here the moment it was
       added, rather than discovered later the way the access table was. */
    for (const u of [idx.sun?.scripture?.u, idx.sun?.stories?.u, idx.sun?.about]) {
      if (!u) continue
      scanned++
      if (!ALLOWED.test(u)) bad.push(`sun -> ${u}`)
    }
    if (!scanned) fails.push('pin index carries no links at all — this check would pass vacuously')
    if (bad.length) fails.push(`${bad.length} link(s) on an unscreened publisher (e.g. ${bad[0]})`)
    if (contactBad.length) fails.push(`${contactBad.length} translator contact(s) on an unscreened organisation (e.g. ${contactBad[0]})`)

    /* ★ THE PROVINCE TABLE IS A SIXTH PLACE URLS LIVE (2026-09-26). Its rows now carry a prayer
       page — the first move for that state — and a table added after this scan was written is
       exactly how the access table went unscreened for weeks. Read from DISK, like the access
       table below, so it is checked even when the province layer was never opened in the page. */
    try {
      const prov = JSON.parse(readFileSync(resolve(REPO, 'data/tables/gospel-by-province.json'), 'utf8'))
      let provScanned = 0
      const provBad = []
      for (const row of prov.rows || []) {
        const u = row.pray_first && row.pray_first.url
        if (!u) continue
        provScanned++
        if (!ALLOWED.test(u)) provBad.push(`${row.province} -> ${u}`)
      }
      if (!provScanned) fails.push('the province table carries no prayer link at all — this arm would pass vacuously')
      if (provBad.length) fails.push(`${provBad.length} province prayer link(s) on an unscreened host (e.g. ${provBad[0]})`)
      linkCount += provScanned
    } catch (e) { fails.push(`could not screen the province table: ${e.message}`) }
    contactCount = contacts
    linkCount = scanned

    // ★ THE ACCESS TABLE IS THE OTHER HALF, AND IT WAS NEVER SCREENED (2026-09-25).
    // This gate scanned the pin index only. But doxa-gospel-access.json carries its own URLs —
    // every resource link plus the bridge links — and it is the table the page renders AND the
    // CSV a team exports to put on a poster or behind a QR code. So the least supervised link in
    // the build was the one most likely to be printed and handed to a stranger.
    // Same lesson this repo already wrote down once: a gate that watches one half of a bundle
    // quietly certifies the other.
    const accRes = await fetch(`${base}/${TREE_NAME}/assets/tables/doxa-gospel-access.json`)
    if (!accRes.ok) fails.push(`access table not served (${accRes.status})`)
    else {
      const acc = await accRes.json()
      const urlFields = (acc.columns || []).filter((c) => c.type === 'url').map((c) => c.field)
      if (!urlFields.length) fails.push('access table declares no url columns — this scan would pass vacuously')
      const accBad = []
      let accScanned = 0
      for (const row of acc.rows || []) {
        for (const f of urlFields) {
          const u = row[f]
          if (!u) continue
          accScanned++
          if (!ALLOWED.test(u)) accBad.push(`${row.people_group} ${f} -> ${u}`)
        }
      }
      if (!accScanned) fails.push('access table carries no links at all — this scan would pass vacuously')
      if (accBad.length) {
        fails.push(`${accBad.length} access-table link(s) on an unscreened publisher (e.g. ${accBad[0]})`)
      }
      linkCount += accScanned
    }
  }

  // 5 — the table deep link carries this group's own code
  await page.waitForTimeout(400)
  const href = await page.evaluate(() => {
    const walk = (r) => {
      for (const el of r.querySelectorAll('*')) {
        const h = el.getAttribute && el.getAttribute('href')
        if (el.tagName === 'A' && h && /data-tables/.test(h)) return h
        if (el.shadowRoot) { const f = walk(el.shadowRoot); if (f) return f }
      }
      return null
    }
    return walk(document)
  })
  if (opened?.iso && (!href || !href.includes(`iso=${opened.iso}`))) {
    fails.push(`table link does not carry iso=${opened.iso} (got ${href})`)
  }

  // 4 — the gap filter filters
  const filtered = await page.evaluate(async () => {
    const click = (i) => {
      const walk = (r) => {
        const b = [...r.querySelectorAll('.gm-kbtn')]
        if (b[i]) { b[i].click(); return true }
        for (const el of r.querySelectorAll('*')) if (el.shadowRoot && walk(el.shadowRoot)) return true
        return false
      }
      return walk(document)
    }
    const m = window.__grMap
    const before = m.queryRenderedFeatures({ layers: ['gr-pins'] }).length
    click(2)
    // ★ WAIT FOR IDLE, not a fixed sleep. setFilter is applied asynchronously and the
    // layer re-renders after it; querying on a 900ms timer read the layer MID-TRANSITION
    // and still saw tier 1 and 2 features. MEASURED at 1 failure in 3 runs — a gate that
    // fails a third of the time on correct code is a gate that gets switched off, which
    // is worse than not having written it. The file's own header says to wait for idle
    // before counting; clause 4 was not doing it.
    await new Promise((r) => { m.once('idle', r); setTimeout(r, 6000) })
    const after = m.queryRenderedFeatures({ layers: ['gr-pins'] })
    return { before, after: after.length, tiers: [...new Set(after.map((f) => f.properties.tier))] }
  })
  if (!(filtered.after > 0 && filtered.after < filtered.before)) {
    fails.push(`gap filter did not reduce the layer (${filtered.before} -> ${filtered.after})`)
  }
  if (filtered.tiers.length !== 1 || filtered.tiers[0] !== 0) {
    fails.push(`gap filter left tiers ${JSON.stringify(filtered.tiers)}, expected only [0]`)
  }

  if (pageErrors.length) fails.push(`page error: ${pageErrors[0].slice(0, 120)}`)

  if (fails.length) {
    console.error(`GOSPEL-MAP: FAIL — ${fails.length} problem(s):`)
    for (const f of fails) console.error(`  ${f}`)
    // ★ NOT process.exit() here. Calling it inside the try terminates the process before
    // the finally block's cleanup runs, so a FAILING run left its spawned server alive
    // while a passing run did not. Measured: 0 strays after a pass, 1 after a fail — a
    // gate that leaks only when it fails leaks exactly when someone is re-running it.
    exitCode = 1
  } else {
    console.log(`GOSPEL-MAP: PASS — ${st.pins} pins rendered; "${opened.pg}" (${opened.lang}) opens with`)
    console.log(`  a named language; all ${linkCount} links in the index are on screened publishers;`)
    console.log(`  ${contactCount} translator contact(s) are on screened organisations;`)
    console.log(`  the table link carries iso=${opened.iso}; the gap filter`)
    console.log(`  cuts ${filtered.before} features to ${filtered.after}, all tier 0.`)
  }
} finally {
  await browser.close()
  // Never leave a stray server behind, on any exit path.
  if (server) { try { server.kill('SIGTERM') } catch (_) {} }
}
process.exit(exitCode)
