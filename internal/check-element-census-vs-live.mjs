#!/usr/bin/env node
/**
 * check-element-census-vs-live — what is on ONE side and not the other, ours vs the live page we clone.
 *
 * ★ WHY. Every clone-fidelity gate here compares PROPERTIES of NAMED selectors ("the region card
 * matches on 37 of 37 properties"). All of them are blind to an element that exists on only one side,
 * because an element nobody named is an element nobody measured. Regions found an extra control and
 * an invented bar chart by eye, past eight green gates. The scope ruling is binary: it exists on
 * their page and must MATCH, or it is a sanctioned addition. This executes it.
 * (Promoted from regions' _probe-element-census-vs-live.mjs, 2026-09-25.)
 *
 * HOW, per page pair (our leaf vs the live URL): harvest every VISIBLE TEXT NODE through every shadow
 * root on both sides (text nodes, not leaf elements — a leaf-element walk lost every country name that
 * shares its anchor with a count span and passed vacuously), then diff the two SETS:
 *   OURS-ONLY, unaccounted   an invention — a scope violation                         → FAIL
 *   OURS-ONLY, sanctioned    on the preset's allowlist, which carries the ruling + date + card
 *   THEIRS-ONLY              a clone omission — something of theirs never ported        → FAIL
 *   DATA DRIFT               the same label with different digits (their pages are SSR snapshots, ours
 *                            is live) — reported, not failed
 * Third-party attribution (Mapbox/OSM/©) and the live site's header/nav/footer chrome are excluded.
 *
 * ★ THE NEGATIVE CONTROL IS MANDATORY. A census that cannot see a known ours-only string is blind, and
 * every "0 additions" it prints is worthless — its first version was exactly that. Each preset names one
 * string that is on our page and not on theirs; unless it lands in the OURS-ONLY set, the run prints
 * CENSUS IS BLIND and exits 75. No preset or ad-hoc run is accepted without one.
 *
 * PRESETS: internal/element-census/<name>.json — { owner, pages:[{name, leaf, live}], neg:{leaf, text},
 * sanctioned:[{match, flags, what, ruling, date, card, theirs?, theirsFlags?}] }. `theirs` makes the entry a
 * SANCTIONED PAIR: their string for the same control (e.g. our "Hide Filters" / their "Show Filters"),
 * excused as an omission only while our half is on the page. An allowlist entry without the ruling,
 * a date and a card is REFUSED (exit 2): it is evidence, not an ignore list.
 *
 * USAGE  node internal/check-element-census-vs-live.mjs                      every preset
 *        node internal/check-element-census-vs-live.mjs --preset regions-dashboard
 *        node internal/check-element-census-vs-live.mjs --leaf <bundle/profile/index.html[#hash]>
 *             --live <https://…> --neg "<text on ours only>" [--sanctioned <preset.json>] [--no-h1]
 *        [--dir <tree root>]  Serves THIS checkout's public/ (or --dir) on an OS-assigned port.
 *        Run through internal/browser-slot.sh.
 * EXIT   0 no unaccounted addition and no omission · 1 either · 2 bad preset/arguments ·
 *        75 NOT MEASURED (live page unreachable, a side never rendered, or the census is blind).
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRESET_DIR = join(ROOT, 'internal', 'element-census')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIR = resolve(arg('--dir', resolve(ROOT, 'public')))
const NOT_MEASURED = 75
const bad = (msg) => { console.log(`ELEMENT-CENSUS: BAD INPUT — ${msg}`); process.exit(2) }

// ── presets ───────────────────────────────────────────────────────────────────────────────────────
function validate(p, from) {
  if (!Array.isArray(p.pages) || !p.pages.length) bad(`${from}: no pages`)
  for (const pg of p.pages) if (!pg.leaf || !/^https?:\/\//.test(pg.live || '')) bad(`${from}: every page needs a leaf and an http(s) live URL`)
  if (!p.neg || !p.neg.text) bad(`${from}: the negative control is mandatory — give neg.text, a string on OUR page that the live page does not have`)
  p.neg.leaf = p.neg.leaf || p.pages[0].leaf
  if (!p.pages.some((pg) => pg.leaf === p.neg.leaf)) p.pages.push({ name: 'neg control page', leaf: p.neg.leaf, live: p.pages[0].live, negOnly: true })
  p.sanctioned = (p.sanctioned || []).map((s, i) => {
    for (const k of ['match', 'ruling', 'date', 'card']) if (!s[k]) bad(`${from}: sanctioned[${i}] has no "${k}" — every allowance carries the ruling, the date and the card`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) bad(`${from}: sanctioned[${i}].date must be YYYY-MM-DD`)
    let re; try { re = new RegExp(s.match, s.flags || '') } catch (e) { bad(`${from}: sanctioned[${i}].match is not a regex: ${e.message}`) }
    // A SANCTIONED PAIR: `theirs` names THEIR string for the same control in its other state (their
    // "Show Filters" vs our sanctioned "Hide Filters") under the same citation, so a sanctioned
    // difference does not leave a phantom omission behind.
    let theirsRe = null
    if (s.theirs !== undefined) { try { theirsRe = new RegExp(s.theirs, s.theirsFlags ?? s.flags ?? '') } catch (e) { bad(`${from}: sanctioned[${i}].theirs is not a regex: ${e.message}`) } }
    return { ...s, re, theirsRe }
  })
  return p
}
const loadPreset = (file) => { try { return validate(JSON.parse(readFileSync(file, 'utf8')), basename(file)) } catch (e) { if (e && e.code === 'ENOENT') bad(`no preset ${file}`); throw e } }

let presets
if (arg('--leaf', '')) {
  const extra = arg('--sanctioned', '') ? JSON.parse(readFileSync(resolve(arg('--sanctioned', '')), 'utf8')).sanctioned || [] : []
  presets = [['ad-hoc', validate({ owner: 'ad-hoc', pages: [{ name: arg('--leaf'), leaf: arg('--leaf'), live: arg('--live', '') }],
    neg: arg('--neg', '') ? { text: arg('--neg') } : null, sanctioned: extra, requireH1: !argv.includes('--no-h1') }, 'arguments')]]
} else if (arg('--preset', '')) {
  presets = [[arg('--preset'), loadPreset(join(PRESET_DIR, arg('--preset').replace(/\.json$/, '') + '.json'))]]
} else {
  const files = existsSync(PRESET_DIR) ? readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).sort() : []
  if (!files.length) bad(`no presets in ${PRESET_DIR}`)
  presets = files.map((f) => [f.replace(/\.json$/, ''), loadPreset(join(PRESET_DIR, f))])
}

// ── the live side must be reachable before anything is judged ─────────────────────────────────────
for (const [, p] of presets) for (const pg of p.pages) {
  if (pg.negOnly) continue
  const r = await fetch(pg.live, { redirect: 'follow', signal: AbortSignal.timeout(20000) }).catch((e) => ({ ok: false, status: e.name }))
  if (!r.ok) { console.log(`ELEMENT-CENSUS: NOT MEASURED — the live page ${pg.live} is unreachable (${r.status}).`); process.exit(NOT_MEASURED) }
}

// ── our side: this checkout's tree on an OS-assigned port ─────────────────────────────────────────
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)) }) })
const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', DIR, '--exit-with-parent'], { stdio: 'ignore' })
const stopSrv = () => { try { srv.kill() } catch { /* already gone */ } }
let up = false
for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 150)); up = await fetch(`http://127.0.0.1:${port}/${TREE_NAME}/manifest.json`).then((r) => r.ok).catch(() => false) }
if (!up) { stopSrv(); console.log(`ELEMENT-CENSUS: NOT MEASURED — could not serve ${DIR}`); process.exit(NOT_MEASURED) }

const THIRD_PARTY = /mapbox|openstreetmap|improve this map|maxar|geoboundaries|©/i
const HARVEST = `(() => {
  const out = new Set()
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot)
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue || '').replace(/\\s+/g, ' ').trim()
      if (!t) continue
      const el = n.parentElement
      if (!el) continue
      if (el.closest && el.closest('header, nav, footer')) continue   // the live site's chrome, not the clone
      if (['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT'].includes(el.tagName)) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      out.add(t)
    }
  }
  walk(document)
  return [...out]
})()`
const H1 = `(() => { const find = (root) => { const h = root.querySelector('h1'); if (h) return h
  for (const e of root.querySelectorAll('*')) if (e.shadowRoot) { const x = find(e.shadowRoot); if (x) return x } return null }
  return (find(document)?.textContent || '').replace(/\\s+/g, ' ').trim() })()`

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const read = async (url) => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  try {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
    await p.waitForTimeout(9000)
    return { list: await p.evaluate(HARVEST).catch(() => []), h1: await p.evaluate(H1).catch(() => '') }
  } finally { await p.close() }
}

let violations = 0, omissions = 0, unmeasured = 0, blind = 0
for (const [name, p] of presets) {
  console.log(`\n══ ${name} (owner: ${p.owner || '?'}) ══`)
  const sanctionedBy = (s) => { const hit = p.sanctioned.find((x) => x.re.test(s)); return hit ? `${hit.what || hit.card} — ruled ${hit.date}: ${hit.ruling}` : null }
  const oursByLeaf = new Map()
  let negSeenInOursOnly = null
  for (const pg of p.pages) {
    const ours = await read(`http://127.0.0.1:${port}/${TREE_NAME}/${pg.leaf}`)
    oursByLeaf.set(pg.leaf, ours)
    const theirs = await read(pg.live)
    const needH1 = p.requireH1 !== false
    // NEVER DIFF A PAGE IN AN UNKNOWN STATE: a side that did not render gives a huge one-sided list
    // that is a loading artefact, not a finding.
    if (!ours.list.length || !theirs.list.length || (needH1 && (!ours.h1 || !theirs.h1))) {
      console.log(`  ${pg.name}: NOT MEASURED — ours ${ours.list.length} strings (h1 "${ours.h1}"), theirs ${theirs.list.length} (h1 "${theirs.h1}")`)
      unmeasured++; continue
    }
    const T = new Set(theirs.list), O = new Set(ours.list)
    const oursOnly = ours.list.filter((s) => !T.has(s) && !THIRD_PARTY.test(s))
    let theirsOnly = theirs.list.filter((s) => !O.has(s) && !THIRD_PARTY.test(s))
    if (pg.leaf === p.neg.leaf && negSeenInOursOnly !== true) negSeenInOursOnly = oursOnly.some((t) => t.toLowerCase().includes(p.neg.text.toLowerCase()))
    if (pg.negOnly) continue
    console.log(`  ${pg.name}: ours ${ours.list.length} visible strings (h1 "${ours.h1}") · theirs ${theirs.list.length} (h1 "${theirs.h1}")`)
    // A DIGIT THAT MOVED IS NOT AN INVENTED ELEMENT: pair same-shaped strings (digit runs → #).
    const shape = (t) => t.replace(/[\d,.]+/g, '#')
    const theirShapes = new Map(theirsOnly.map((t) => [shape(t), t]))
    const invented = [], allowed = [], drift = []
    for (const s of oursOnly) {
      const why = sanctionedBy(s)
      if (why) { allowed.push([s, why]); continue }
      const paired = theirShapes.get(shape(s))
      if (paired !== undefined && /\d/.test(s)) { drift.push([s, paired]); continue }
      invented.push(s)
    }
    const driftShapes = new Set(drift.map(([s]) => shape(s)))
    theirsOnly = theirsOnly.filter((t) => !driftShapes.has(shape(t)))
    // Pairs: THEIR half is excused only when OUR half of the same entry is actually on this page. If
    // our control vanished, their string is a real omission again — a pair can never hide a gap.
    const pairedTheirs = []
    for (const x of p.sanctioned.filter((x) => x.theirsRe)) {
      if (!ours.list.some((t) => x.re.test(t))) continue
      theirsOnly = theirsOnly.filter((t) => { if (x.theirsRe.test(t)) { pairedTheirs.push([t, x]); return false } return true })
    }
    console.log(`    OURS-ONLY: ${allowed.length} sanctioned · ${invented.length} unaccounted`)
    for (const [s, why] of allowed) console.log(`      ok  "${s.slice(0, 60)}" — ${why.slice(0, 140)}`)
    for (const s of invented) console.log(`      ??  "${s.slice(0, 80)}"`)
    violations += invented.length
    if (drift.length) {
      console.log(`    DATA DRIFT (same label, different figure — their page is an SSR snapshot, ours is live): ${drift.length}`)
      for (const [o, t] of drift.slice(0, 10)) console.log(`      ~   ours ${JSON.stringify(o.slice(0, 44))} vs theirs ${JSON.stringify(t.slice(0, 44))}`)
    }
    for (const [t, x] of pairedTheirs) console.log(`      ok  their "${t.slice(0, 50)}" — the other half of a sanctioned pair (${x.what || x.card}, ruled ${x.date})`)
    console.log(`    THEIRS-ONLY (ported nowhere on our side): ${theirsOnly.length}`)
    for (const s of theirsOnly.slice(0, 25)) console.log(`      !!  "${s.slice(0, 80)}"`)
    if (theirsOnly.length > 25) console.log(`      … and ${theirsOnly.length - 25} more`)
    omissions += theirsOnly.length
  }
  // ★ NEG CONTROL: the known ours-only string must be IN THE OURS-ONLY SET — harvested AND diffed.
  console.log(`  NEG control — does the census see "${p.neg.text}" as ours-only on ${p.neg.leaf}? ${negSeenInOursOnly ? 'YES' : 'NO'}`)
  if (!negSeenInOursOnly) { console.log('  ⚠ CENSUS IS BLIND for this preset: the known ours-only string is not in the ours-only set. Its counts above are not evidence.'); blind++ }
}
await browser.close(); stopSrv()

console.log(`\n── ${violations} unaccounted addition(s) · ${omissions} omission(s) · ${unmeasured} page(s) not measured · ${blind} blind preset(s) ──`)
if (violations || omissions) {
  console.log('ELEMENT-CENSUS: FAIL — an unaccounted addition is a scope violation under the binary scope test; an omission is a clone gap. Read the lists: this reports, the owner adjudicates.')
  process.exit(1)
}
if (blind || unmeasured) { console.log('ELEMENT-CENSUS: NOT MEASURED — a page did not render or the census could not see its own negative control.'); process.exit(NOT_MEASURED) }
console.log('ELEMENT-CENSUS: PASS — every string on our side is on theirs or sanctioned, and nothing of theirs is missing.')
