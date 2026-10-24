#!/usr/bin/env node
/**
 * check-composite-interop.mjs — the links between a composite's children must exist on BOTH ends.
 *
 * WHY THIS EXISTS. A capability-4 composite is only a composite because its children talk: the grid
 * narrows the map, "Show on map" moves the map, a region click retitles the dashboard. Every one of
 * those is a NAME (an event, an attribute, a config key) written in two files that nothing ties
 * together. Rename it on one side and the build stays green, both children still render, and the
 * link is silently gone. The interop matrix (2026-09-26) also found the other silent way a link dies:
 * research-map.vue found its host with getCurrentInstance() INSIDE a watcher callback, where Vue
 * returns null, so `map-filtered` was never dispatched, and the only "proof" had fired a synthetic
 * event at the composite. Neither shape needs a browser to see.
 *
 * WHAT IT CHECKS, headless:
 *   A. SOURCE: each link's send pattern is in the sender file and its listen pattern is in the
 *      receiver file (a rename on either side fails, naming both files).
 *   B. BUILT: each link's literal is in every bundle that ships an end of it (what the reader
 *      actually gets; a stale bundle fails here even when the source is right).
 *   C. COVERAGE: every composite (*.meta.json type nested-elements-mfe) has links in LINKS or an
 *      entry in NO_LINKS with its reason. A new composite with neither fails as "unmapped".
 *   D. LATE getCurrentInstance(): in plugin-designs/ and library/, a getCurrentInstance() call
 *      inside a plain function (not setup, not a lifecycle hook, not a use* composable body) is a
 *      host lookup that returns null whenever that function runs from a watcher or an event. Capture
 *      the instance in setup instead. Sites already routed to an owner are listed in LATE_KNOWN and
 *      printed, not failed; delete the entry in the owner's fix commit so the gate enforces it again.
 *
 * NOT A SUBSTITUTE FOR A BROWSER. Both ends existing is necessary, not sufficient: UPG-100's
 * select-zone listener exists and still loses the first click, because the lazy Map pane attaches it
 * too late (measured 2026-09-26). The runtime half is check:gallery-embed's `linked` phase.
 *
 * NEGATIVE-TESTED (2026-09-26, main 521f8b18, PASS with 17 links and the 3 LATE_KNOWN sites), each FAILS:
 *   a receiver renamed in source ('map-filtered' -> 'map-filter' in research-map-plus-grid.vue);
 *   a built bundle out of step ("country-selected" renamed in regions-dashboard.js only);
 *   stack-demo's NO_LINKS entry removed (unmapped composite);
 *   a new getCurrentInstance() in a one-line function, a one-line arrow and a multi-line function;
 *   the emitFilterState site fixed with its LATE_KNOWN entry left behind (stale entry).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PD = 'plugin-designs'
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Common send/listen shapes. `n` is the event name.
const EMIT = (n) => new RegExp(`emit\\(\\s*['"]${esc(n)}['"]`)
const VON = (n) => new RegExp(`@${esc(n)}=`)
const DOM_SEND = (n) => new RegExp(`new CustomEvent\\(\\s*['"]${esc(n)}['"]|['"]${esc(n)}['"][\\s\\S]{0,400}dispatchEvent|dispatch\\(\\s*['"]${esc(n)}['"]`)
const DOM_LISTEN = (n) => new RegExp(`addEventListener\\??\\.?\\(\\s*['"]${esc(n)}['"]`)
const LIT = (s) => new RegExp(esc(s))
const camelOn = (n) => 'on' + n.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())

// ── the links (PRODUCTION-MATRIX.md "Interop matrix") ─────────────────────────────────────────
// send/recv: [file, RegExp]. built: [bundle, literal] — every bundle that ships an end of the link.
const LINKS = [
  // big-picture: children compiled in (Vue emits + props)
  { composite: 'big-picture', id: 'header facets -> grid (research-filter)',
    send: [`${PD}/big-picture/src/components/BpResearchHeader.vue`, EMIT('research-filter')],
    recv: [`${PD}/big-picture/big-picture.vue`, VON('research-filter')],
    built: [['big-picture', '"research-filter"'], ['big-picture', camelOn('research-filter')]] },
  { composite: 'big-picture', id: 'grid total -> header count (groups-filtered)',
    send: [`${PD}/people-groups-grid/people-groups-grid.vue`, EMIT('groups-filtered')],
    recv: [`${PD}/big-picture/big-picture.vue`, VON('groups-filtered')],
    built: [['big-picture', '"groups-filtered"'], ['big-picture', camelOn('groups-filtered')]] },
  // dashboard-plus-grid: children compiled in
  { composite: 'dashboard-plus-grid', id: 'dashboard facets -> grid (dashboard-filter)',
    send: [`${PD}/research-dashboard/research-dashboard.vue`, EMIT('dashboard-filter')],
    recv: [`${PD}/dashboard-plus-grid/dashboard-plus-grid.vue`, VON('dashboard-filter')],
    built: [['dashboard-plus-grid', '"dashboard-filter"'], ['dashboard-plus-grid', camelOn('dashboard-filter')]] },
  // research-map-plus-grid: children composed by src (DOM events + attributes)
  { composite: 'research-map-plus-grid', id: 'grid -> composite (groups-filtered)',
    send: [`${PD}/people-groups-grid/people-groups-grid.vue`, DOM_SEND('groups-filtered')],
    recv: [`${PD}/research-map-plus-grid/research-map-plus-grid.vue`, DOM_LISTEN('groups-filtered')],
    built: [['people-groups-grid', '"groups-filtered"'], ['research-map-plus-grid', '"groups-filtered"']] },
  { composite: 'research-map-plus-grid', id: 'map -> composite (map-filtered)',
    send: [`${PD}/doxa-research-map/research-map.vue`, DOM_SEND('map-filtered')],
    recv: [`${PD}/research-map-plus-grid/research-map-plus-grid.vue`, DOM_LISTEN('map-filtered')],
    built: [['doxa-research-map', '"map-filtered"'], ['research-map-plus-grid', '"map-filtered"']] },
  { composite: 'research-map-plus-grid', id: 'composite -> map (externalFilters)',
    send: [`${PD}/research-map-plus-grid/research-map-plus-grid.vue`, LIT('externalFilters')],
    recv: [`${PD}/doxa-research-map/research-map.vue`, LIT('externalFilters')],
    built: [['research-map-plus-grid', 'externalFilters'], ['doxa-research-map', 'externalFilters']] },
  { composite: 'research-map-plus-grid', id: 'composite -> map (fitSlugs)',
    send: [`${PD}/research-map-plus-grid/research-map-plus-grid.vue`, LIT('fitSlugs')],
    recv: [`${PD}/doxa-research-map/research-map.vue`, /'fitSlugs' in raw/],
    built: [['research-map-plus-grid', 'fitSlugs'], ['doxa-research-map', 'fitSlugs']] },
  ...[['wagf-region', 'wagfRegion'], ['religion-family', 'religionFamily'], ['primary-language', 'primaryLanguage']].map(([attr, prop]) => ({
    composite: 'research-map-plus-grid', id: `composite -> grid (attribute ${attr})`,
    send: [`${PD}/research-map-plus-grid/research-map-plus-grid.vue`, new RegExp(`setAttribute\\(\\s*'${esc(attr)}'`)],
    recv: [`${PD}/people-groups-grid/people-groups-grid.vue`, new RegExp(`^\\s*${prop}\\s*:\\s*\\{\\s*type`, 'm')],
    built: [['research-map-plus-grid', `"${attr}"`], ['people-groups-grid', prop]],
  })),
  // country-posters: tabs (window event scoped by instanceId)
  { composite: 'country-posters', id: 'wall "Show on map" -> composite',
    send: [`${PD}/country-posters/country-poster-wall.vue`, /event-name="doxa-country-posters:show-on-map"/],
    recv: [`${PD}/country-posters/country-posters-mfe.vue`, /['"]doxa-country-posters:show-on-map['"]/],
    built: [['country-posters', 'doxa-country-posters:show-on-map']] },
  // my-upg-100-list: tabs
  { composite: 'my-upg-100-list', id: 'wall "Show on map" -> composite',
    send: [`${PD}/my-upg-100-list/poster-wall.vue`, /event-name="doxa-upg-100-list:show-on-map"/],
    recv: [`${PD}/my-upg-100-list/upg-100-mfe.vue`, DOM_LISTEN('doxa-upg-100-list:show-on-map')],
    built: [['my-upg-100-list', 'doxa-upg-100-list:show-on-map']] },
  { composite: 'my-upg-100-list', id: 'composite -> map (doxa:select-zone)',
    send: [`${PD}/my-upg-100-list/upg-100-mfe.vue`, DOM_SEND('doxa:select-zone')],
    recv: [`${PD}/my-upg-100-list/upg-100-list.vue`, DOM_LISTEN('doxa:select-zone')],
    built: [['my-upg-100-list', '"doxa:select-zone"']] },
  // regions-dashboard: tabs
  ...['region-selected', 'country-selected'].map((n) => ({
    composite: 'regions-dashboard', id: `list -> composite (${n})`,
    send: [`${PD}/regions-dashboard/regions-list.vue`, DOM_SEND(n)],
    recv: [`${PD}/regions-dashboard/regions-mfe.vue`, DOM_LISTEN(n)],
    built: [['regions-dashboard', `"${n}"`]],
  })),
  { composite: 'regions-dashboard', id: 'composite -> dashboards (doxa-regions-dashboard:select)',
    send: [`${PD}/regions-dashboard/regions-mfe.vue`, /SELECT_EVENT = 'doxa-regions-dashboard:select'[\s\S]*dispatchEvent\(new CustomEvent\(SELECT_EVENT/],
    recv: [`${PD}/regions-dashboard/region-dashboards.vue`, /SELECT_EVENT = 'doxa-regions-dashboard:select'[\s\S]*addEventListener\(SELECT_EVENT/],
    built: [['regions-dashboard', 'doxa-regions-dashboard:select']] },
  // gospel-resources (gospel-dashboard): children compiled in, provide/inject
  { composite: 'gospel-resources', id: 'map -> tables (composedFilter)',
    send: [`${PD}/gospel-resources/resources-map.vue`, /composedFilter\.value\s*=/],
    recv: [`${PD}/gospel-resources/data-tables.vue`, /watch\(\s*composedFilter/],
    built: [['gospel-resources', '"composedFilter"']] },
]

// Composites whose children deliberately exchange nothing. The reason is printed on every run.
const NO_LINKS = {
  'stack-demo': 'a demonstration stack: page knobs only; dashboard-plus-grid is the linked version',
  'poster-design': 'two independent views of the poster templates (Styles, Sizes); neither pane drives the other',
}

// ── D: late getCurrentInstance() sites already routed to an owner ─────────────────────────────
const LATE_KNOWN = {
  // (The two reflectDir entries that sat here are gone: landing 11 captured the instance in setup, so
  // a host switching lang to ar after mount does get dir=rtl. This gate refuses a known-issue entry
  // that no longer matches — a stale exemption is a defect it would stop reporting.)
}

const fails = []
const known = []
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null)
const bundleCache = {}
const bundle = (b) => (bundleCache[b] ??= read(`public/${TREE_NAME}/${b}/${b}.js`))

// A + B
for (const l of LINKS) {
  const tag = `${l.composite}: ${l.id}`
  for (const [side, [file, re]] of [['sender', l.send], ['receiver', l.recv]]) {
    const src = read(file)
    if (src == null) fails.push(`${tag} — ${side} file is gone: ${file}`)
    else if (!re.test(src)) fails.push(`${tag} — the ${side} no longer matches ${re} in ${file} (renamed on one side?)`)
  }
  for (const [b, lit] of l.built) {
    const js = bundle(b)
    if (js == null) fails.push(`${tag} — no built bundle public/${TREE_NAME}/${b}/${b}.js`)
    else if (!js.includes(lit)) fails.push(`${tag} — built ${b}.js does not contain ${lit} (stale bundle, or renamed)`)
  }
}

// C
const composites = []
for (const b of readdirSync(join(ROOT, PD))) {
  let files = []
  try { files = readdirSync(join(ROOT, PD, b)) } catch { continue }
  for (const f of files.filter((f) => f.endsWith('.meta.json'))) {
    try { if (JSON.parse(readFileSync(join(ROOT, PD, b, f), 'utf8')).type === 'nested-elements-mfe') composites.push(b) } catch { /* not ours to judge */ }
  }
}
if (!composites.length) fails.push('found no capability-4 composites (vacuous run)')
for (const c of composites) {
  const n = LINKS.filter((l) => l.composite === c).length
  if (!n && !NO_LINKS[c]) fails.push(`${c}: unmapped composite — add its links to LINKS, or an entry to NO_LINKS saying why it has none`)
}

// D
function* sources(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!/node_modules|^\./.test(e.name) && !/\/(scripts|dist)$/.test(rel)) yield* sources(rel) }
    else if (/\.(vue|js)$/.test(e.name)) yield rel
  }
}
const HOOK = /\b(on(Before)?(Mounted|Unmounted|Update|Updated)|onActivated|onDeactivated)\s*\(/
for (const rel of [...sources(PD), ...sources('library')]) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!/getCurrentInstance\(\)/.test(line) || /^\s*(\/\/|\*|import\b)/.test(line)) return
    // Walk the enclosing blocks outward by indentation.
    let ind = line.search(/\S/)
    let verdict = 'top'
    let fnName = ''
    // A one-liner opens its function on the SAME line as the call: read that prefix first.
    const pre = line.slice(0, line.indexOf('getCurrentInstance()'))
    const same = pre.match(/function\s+([A-Za-z0-9_$]+)\s*\(/)
    if (HOOK.test(pre) || /\bsetup\s*\(/.test(pre)) verdict = 'ok'
    else if (same) { verdict = /^use[A-Z]/.test(same[1]) ? 'ok' : 'late'; fnName = same[1] }
    else if (/=>/.test(pre) || /\bfunction\s*\(/.test(pre)) { verdict = 'late'; fnName = (pre.match(/(?:const|let)\s+([A-Za-z0-9_$]+)\s*=/) || [])[1] || '(anonymous)' }
    for (let j = i - 1; verdict === 'top' && j >= 0 && ind > 0; j--) {
      const l = lines[j]
      if (!l.trim() || /^\s*(\/\/|\*)/.test(l)) continue
      const li = l.search(/\S/)
      if (li >= ind) continue
      ind = li
      if (HOOK.test(l) || /\bsetup\s*\(/.test(l)) { verdict = 'ok'; break }
      const m = l.match(/function\s+([A-Za-z0-9_$]+)\s*\(/)
      if (m) { if (/^use[A-Z]/.test(m[1])) { verdict = 'ok'; break } verdict = 'late'; fnName = m[1]; break }
      if (/=>\s*\{?\s*$/.test(l) || /\bfunction\s*\(/.test(l)) { verdict = 'late'; fnName = '(anonymous)'; break }
    }
    if (verdict !== 'late') return
    const key = `${rel}#${fnName}`
    const where = `${rel}:${i + 1} in ${fnName}()`
    if (LATE_KNOWN[key]) known.push(`KNOWN [late getCurrentInstance] ${where} — owner: ${LATE_KNOWN[key]}`)
    else fails.push(`${where}: getCurrentInstance() inside a plain function returns null when it runs from a watcher or an event. Capture \`const inst = getCurrentInstance()\` in setup and use inst here.`)
  })
}
for (const k of Object.keys(LATE_KNOWN)) {
  if (!known.some((m) => m.includes(k.split('#')[0]) && m.includes(k.split('#')[1] + '()'))) {
    fails.push(`LATE_KNOWN entry no longer matches anything: ${k} — it was fixed; delete the entry so the gate enforces it`)
  }
}

console.log(`COMPOSITE-INTEROP: ${composites.length} composite(s), ${LINKS.length} link(s) checked in source and in the built tree (${TREE_NAME})`)
for (const [c, why] of Object.entries(NO_LINKS)) console.log(`  · ${c}: no links, by design — ${why}`)
for (const k of known) console.log(`  ${k}`)
if (fails.length) {
  console.log(`\nCOMPOSITE-INTEROP: FAIL (${fails.length})`)
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('COMPOSITE-INTEROP: PASS — every link is present on both ends, in source and in the built bundles')
