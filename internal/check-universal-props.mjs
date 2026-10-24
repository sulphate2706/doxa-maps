#!/usr/bin/env node
/**
 * check-universal-props.mjs — every plugin honours the props the Plugin Studio header sets for all
 * of them (documentation/reference-universal-props.md): map ENGINE, LOCALE (+dir), Mapbox TOKEN and
 * token-service URL, and the people-group LIST (library/lists/). HEADLESS: no browser, no server. It reads what each bundle's source and SHIPPED
 * bundle consume, and fails on a bypass: a literal or a private global where the library resolver
 * belongs.
 *
 * WHY STATIC. A bypass is a line of code, and it is the same line whether or not anyone is looking
 * at the map: a `setStyle('mapbox://…')` breaks the MapLibre engine switch, a `window.DOXA_TOKEN`
 * read ignores the page's token, a `toLocaleString('en-US')` ignores the locale. Each was found in
 * this tree by reading the source (the census behind the contract page). Rendering proves the
 * happy path; this proves nobody went around it.
 *
 * RULES (id · prop · what fails):
 *   ENG-STYLE   engine  a `mapbox://` style literal in map.setStyle() or a raw `new gl.Map({style})`
 *                       outside a resolveNamedStyle/registry fallback: MapLibre cannot load it
 *                       (a style handed to useMapInstance is translated there, so it passes)
 *   ENG-GLOBAL  engine  `new mapboxgl.X` / `new window.mapboxgl.X` (build it with engineFor(map))
 *   ENG-PIN     engine  a literal provider:'mapbox'|'maplibre' handed to useMapInstance (ALLOW-listed
 *                       where it is the plugin's design)
 *   TOK-GLOBAL  token   reading window.DOXA_TOKEN (nothing sets it on a built page; use the injected
 *                       mapboxToken, fed by profile-config.tk and window.MAP_TOKEN)
 *   TOK-LITERAL token   a `pk.ey…` token literal in code (comments excluded)
 *   LOC-ENUS    locale  toLocaleString('en-US') / Intl.NumberFormat('en-US') (use the active locale).
 *                       WARN only: whether numerals follow the locale is pending a product decision
 *   LIST-FETCH  list    a file that fetches the people-group list (/api/people-groups/list, a
 *                       source's endpoints.bulk, or the doxa-people-groups.json roster) without
 *                       applyPeopleGroupList: that map would show DOXA's list whatever list was asked
 *   LIST-DSM    list    `new DataSourceManager(...)` without `profileConfig`: the manager applies the
 *                       list itself, but without the embed's config only ?list= / window.MAP_LIST reach it
 *   LIST-KEYS   list    a composite's INHERITED_PAGE_KEYS without 'list': its panes never hear it
 * Source = plugin-designs/<bundle>/**.{vue,js} minus index.html dev pages and scripts/. Shipped =
 * public/<tree>/<bundle>/<bundle>.js, checked for the TOK-GLOBAL and TOK-LITERAL strings the
 * minifier cannot rename.
 *
 * ALLOW: a documented exception per bundle+rule, with its reason. Nothing else passes.
 * Self-test: every rule must fire on a synthetic violation, or the gate exits 3.
 * Usage: node internal/check-universal-props.mjs [--only a,b] [--report]
 * Exit: 0 conforms · 1 a bypass · 3 self-test could not see a planted bypass.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null
const REPORT = argv.includes('--report')

// ★ THE POPULATION IS DERIVED, NOT TYPED (2026-09-29). It used to be a hand list of 19 names, and it
// drifted: the PRODUCTION country-map was never on it, so the LIST-FETCH it carried passed unseen, and
// big-picture fetched the list correctly with nothing to catch a regression. Now every plugin-designs/<b>/
// with an index.js is measured unless EXCLUDED names it with a reason, so a new bundle is covered the day
// it lands, and leaving one out is a decision someone wrote down.
const EXCLUDED = {}
const BUNDLES = readdirSync(resolve(ROOT, 'plugin-designs'))
  .filter((b) => existsSync(resolve(ROOT, 'plugin-designs', b, 'index.js')) && !(b in EXCLUDED)).sort()
// Fail loud, never narrow silently: an --only name that is not a measured bundle measured NOTHING and
// used to print "PASS: 0 bundles"; an exclusion naming no bundle is a stale decision.
{
  const unknown = (ONLY || []).filter((x) => !BUNDLES.includes(x))
  const stale = Object.keys(EXCLUDED).filter((b) => !existsSync(resolve(ROOT, 'plugin-designs', b, 'index.js')))
  if (unknown.length || stale.length) {
    if (unknown.length) console.error(`UNIVERSAL-PROPS: --only names no measured bundle: ${unknown.join(', ')} (measured: ${BUNDLES.join(', ')})`)
    if (stale.length) console.error(`UNIVERSAL-PROPS: EXCLUDED names no bundle: ${stale.join(', ')} (a stale exclusion)`)
    process.exit(2)
  }
}
const ALLOW = {
  '*:LOC-ENUS:library/utils/formatCount.js':
    'HELD DECISION, and this file IS the decision: formatCount() is the one place the count locale is '
    + 'chosen, so COUNT_LOCALE = \'en-US\' is the policy written down rather than a bundle ignoring the '
    + 'reader. NUMERALS ARE HELD -- counts do not follow the locale -- and folding every dashboard onto '
    + 'this constant is what makes that auditable in one line instead of scattered across eight call '
    + 'sites. Bundle-wildcarded ON PURPOSE: the alternative is one entry per importer, so the LOCALE '
    + 'column warns every time a bundle adopts the shared helper -- punishing the fix and teaching '
    + 'people to stop reading the column. Restricted to library/ (see the lookup): no per-bundle source '
    + 'can be wildcarded, and a new toLocaleString(\'en-US\') inside research-dashboard or '
    + 'people-groups-grid still warns. Revisit only if the numerals decision changes.',
  'prayer-walk-planner:ENG-PIN': 'keyless by design: always MapLibre, needs no token (index.js header)',
  'demo-map:LIST-DSM': 'scaffolding: demo-map demonstrates the raw DataSourceManager path itself, and it is off the '
    + 'production and Experimental shelves (the gallery\'s NOT_EXPERIMENTAL, the 2026-09-24 roundup ruling). '
    + 'Its other props are still measured. Revisit if it is ever shelved for readers.',
  '*:LOC-ENUS:library/components/maps/RegionCountryMap.vue':
    'HELD DECISION, not an oversight: the map popup formats population as fixed en-US on purpose. '
    + 'Their own site renders en-US numerals, which is the evidence on the card '
    + 'NUMERALS-REVERTED-POPUP-TO-FIXED-EN-US-AND-THEIR-OWN-CONVENTION-IS-EVIDENCE, and '
    + '_chk-numerals-held-format-does-not-vary-by-locale ASSERTS it does not vary by locale -- so '
    + 'making it locale-derived would break a gate that exists to keep it fixed. Scoped to this FILE, for '
    + 'every bundle that imports it (regions-dashboard, country-map): the rest of each bundle is still '
    + 'answerable for a new en-US. Revisit only if the numerals policy changes.',
  'all-people-groups:LIST-DSM': 'draws the IMB dataset (all 12,379 groups), not the DOXA list: a list there is Tier B (library/lists/README.md)',
  'upg-neighbor:LIST-FETCH:plugin-designs/upg-neighbor/src/mobilize.vue':
    'a PHOTO LOOKUP, not a list: the neighbours prayer packet (doxaPhotos) asks the doxa list for slug + image_url '
    + 'only, and joins photos onto ITS OWN rows (near-neighbors.json, the IMB grain) by slug. No row from this fetch '
    + 'is shown, counted or filtered, so the list prop does not apply; it is config-only and fail-closed (no API '
    + 'configured = no photos) like upg100. Site-scoped to this one file, so a real list fetch anywhere else in '
    + 'the bundle still fails.',
}

const stripComments = (src) => src
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))

const RULES = [
  { id: 'ENG-STYLE', prop: 'engine', test(src) {
      // useMapInstance swaps any non-http style for an OpenFreeMap one under MapLibre
      // (maplibreStyle() in useMapInstance.js), so a mapbox:// default handed to IT is fine. What is
      // not translated: a direct map.setStyle('mapbox://…') and a raw `new gl.Map({ style: 'mapbox://…' })`.
      const out = []
      const res = [/setStyle\s*\(([^;]{0,220}?)mapbox:\/\/styles\//g, /new\s+[\w.]+\.Map\s*\(\s*\{[^}]{0,400}?style\s*:([^,}]{0,160}?)mapbox:\/\/styles\//g]
      for (const re of res) { let m; while ((m = re.exec(src))) {
        const win = src.slice(Math.max(0, m.index - 160), m.index + m[0].length)
        if (/resolveNamedStyle|registry|\.style\s*\|\|/.test(win)) continue   // a fallback behind the registry
        out.push(m.index)
      } }
      return out } },
  { id: 'ENG-GLOBAL', prop: 'engine', re: /new\s+(?:window\.)?mapboxgl\.(?:Marker|Popup|Map|NavigationControl|FullscreenControl|GeolocateControl|ScaleControl|AttributionControl)\b/g },
  { id: 'ENG-PIN', prop: 'engine', re: /useMapInstance\s*\(\s*\{[^}]{0,400}?provider\s*:\s*['"](?:mapbox|maplibre)['"]/g },
  { id: 'TOK-GLOBAL', prop: 'token', re: /window\.DOXA_TOKEN\b/g, shipped: 'DOXA_TOKEN' },
  { id: 'TOK-LITERAL', prop: 'token', re: /['"`]pk\.ey[A-Za-z0-9_-]{20,}/g, shipped: /pk\.eyJ[A-Za-z0-9_-]{20,}/ },
  { id: 'LOC-ENUS', prop: 'locale', warn: true, test(src) {
      // ★ A CATCH-BLOCK FALLBACK IS NOT A FIXED FORMAT, and the bare regex was WARNING THE CORRECT
      // PATTERN. regions formats with `${locale}-u-nu-latn` -- a verbatim clone of DX-life's
      // RegionDetail.vue:16, Latin digits with the reader's grouping -- and falls back to 'en-US' only
      // inside a catch, because a bad locale tag throws RangeError in toLocaleString and blanking the
      // page is worse than one wrong separator. Flagging that told the matrix's locale column to say
      // "ignores the locale" about code that honours it, which is the kind of false warn that teaches
      // people to stop reading the column.
      // MEASURED before changing the rule: of the NINE LOC-ENUS sites in the tree, exactly TWO are
      // such fallbacks (region-dashboards.vue, regions-list.vue). The other seven are genuinely
      // operative fixed en-US and are still flagged, including RegionCountryMap's popup, which is a
      // HELD product decision with its own card rather than an oversight.
      const out = []
      const re = /(?:toLocaleString|NumberFormat|DateTimeFormat)\s*\(\s*['"]en(?:-US)?['"]/g
      let m
      while ((m = re.exec(src))) {
        const before = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index)
        // both halves required: a catch, AND a locale-DERIVED format call it is the fallback for.
        // A lone `catch` nearby must not excuse a hardcoded format that never consulted the locale.
        const isFallback = /\bcatch\b/.test(before)
          && /(?:toLocaleString|NumberFormat|DateTimeFormat)\s*\(\s*`[^`]*\$\{/.test(before)
        if (!isFallback) out.push(m.index)
      }
      // ★ THE NAMED CONSTANT COUNTS TOO, or folding the literal into one module LOOKS like fixing it.
      // library/utils/formatCount.js now holds the fleet's en-US decision and calls
      // toLocaleString(COUNT_LOCALE) — no literal — so the pattern above went quiet and 8 of the
      // tree's 13 warns vanished with the BEHAVIOUR unchanged. That is the same false-green as a
      // precondition that skips the file under test: the audit stopped seeing a decision still in
      // force. One site, attributed to every bundle that imports it, is what "held in one place"
      // should read as in the matrix — not zero.
      const constRe = /COUNT_LOCALE\s*=\s*['"]en(?:-US)?['"]/g
      while ((m = constRe.exec(src))) out.push(m.index)
      return out
    } },
  // A whole-file rule: the fetch and the helper need not be on the same line, only in the same file.
  { id: 'LIST-FETCH', prop: 'list', test(src) {
      const m = /\/api\/people-groups\/list|endpoints\?\.bulk|doxa-people-groups\.json/.exec(src)
      return m && !/applyPeopleGroupList\s*\(/.test(src) ? [m.index] : [] } },
  { id: 'LIST-DSM', prop: 'list', re: /new\s+DataSourceManager\s*\((?![^)]*\bprofileConfig\b)[^)]*\)/g },
  { id: 'LIST-KEYS', prop: 'list', re: /INHERITED_PAGE_KEYS\s*=\s*\[(?![^\]]*['"]list['"])[^\]]*\]/g },
]
const run = (rule, src) => rule.test ? rule.test(src) : [...src.matchAll(rule.re)].map((m) => m.index)
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

// ── self-test: every rule must see a planted violation ─────────────────────────────────────────
// The TOK-LITERAL sample is ASSEMBLED HERE, never written as one literal: a committed string shaped like a
// real Mapbox token is itself what that rule forbids, and reads as a leaked credential to any secret scan.
// It is plainly fake ('example, not a token'), yet shaped like one: pk. + base64url JSON + . + a tail, which
// is all the rule's regex looks for, so the self-test still proves the rule fires.
const FAKE_TOKEN = 'pk.' + Buffer.from('{"u":"example","note":"not-a-token"}').toString('base64url') + '.' + 'x'.repeat(22)
const PLANTED = `
  map.setStyle(isDark ? 'mapbox://styles/mapbox/dark-v11' : 'x')
  const m2 = new gl.Map({ container: el, style: 'mapbox://styles/mapbox/light-v11' })
  const p = new mapboxgl.Popup()
  useMapInstance({ container: el, provider: 'mapbox' })
  const tk = window.DOXA_TOKEN
  const t = '${FAKE_TOKEN}'
  n.toLocaleString('en-US')
  const r = await fetch(base + '/api/people-groups/list?fields=slug')
  const dsm = new DataSourceManager({ locale: 'en' })
  const INHERITED_PAGE_KEYS = ['locale', 'provider']`
const missed = RULES.filter((r) => !run(r, stripComments(PLANTED)).length).map((r) => r.id)
const CLEAN = `map.setStyle(resolveNamedStyle('ink', p).style || 'mapbox://styles/mapbox/dark-v11')
  useMapInstance({ container: el, style: cfg.style ?? 'mapbox://styles/mapbox/light-v11' })
  // new mapboxgl.Popup() in a comment is not code
  n.toLocaleString(locale.value)
  try { return v.toLocaleString(\`\${locale.value || 'en'}-u-nu-latn\`) } catch (_) { return v.toLocaleString('en-US') }
  const r2 = await applyPeopleGroupList((await fetch(base + '/api/people-groups/list')).posts, cfg)
  const dsm2 = new DataSourceManager({ locale: 'en', profileConfig })
  const INHERITED_PAGE_KEYS = ['locale', 'provider', 'list']`
const falsePos = RULES.filter((r) => run(r, stripComments(CLEAN)).length).map((r) => r.id)

// ── LOC-ENUS discrimination, tested on purpose ──────────────────────────────────────────────────
// The fallback exemption is the one rule here that can WIDEN by accident: loosen it and a hardcoded
// format with a catch anywhere near it stops being seen. So the three adversarial shapes are pinned.
const locRule = RULES.find((r) => r.id === 'LOC-ENUS')
const LOC_CASES = [
  [false, "try { return v.toLocaleString(`${locale.value || 'en'}-u-nu-latn`) } catch (_) { return v.toLocaleString('en-US') }"],
  [true,  "try { return v.toLocaleString('en-US') } catch (_) { return '' }"],
  [true,  "try { return fmt(v) } catch (_) { return v.toLocaleString('en-US') }"],
  [true,  "const pop = Number(p.population).toLocaleString('en-US')"],
]
const locWrong = LOC_CASES.filter(([shouldFlag, line]) => (run(locRule, line).length > 0) !== shouldFlag)
if (locWrong.length) {
  console.error(`UNIVERSAL-PROPS: SELF-TEST FAILED — LOC-ENUS misjudged ${locWrong.length} case(s); `
    + 'the catch-fallback exemption must skip ONLY a locale-derived primary: '
    + locWrong.map(([f, l]) => `${f ? 'missed' : 'false-flagged'}: ${l.slice(0, 56)}`).join(' | '))
  process.exit(3)
}
// The bundle-wildcard is honoured ONLY under library/. Pinned because the failure is silent: widen it
// to any path and one entry could clear the column for a bundle's own source.
const wildcardKeys = Object.keys(ALLOW).filter((k) => k.startsWith('*:'))
const badWildcard = wildcardKeys.filter((k) => !k.split(':').slice(2).join(':').startsWith('library/'))
if (badWildcard.length) {
  console.error('UNIVERSAL-PROPS: SELF-TEST FAILED — a `*:RULE:file` ALLOW entry outside library/ would '
    + 'never be honoured by the lookup, so it silently exempts nothing: ' + badWildcard.join(', '))
  process.exit(3)
}
if (missed.length || falsePos.length) {
  console.error(`UNIVERSAL-PROPS: SELF-TEST FAILED — ${missed.length ? 'rules blind to a planted bypass: ' + missed.join(', ') : ''}${falsePos.length ? ' false positives on clean code: ' + falsePos.join(', ') : ''}`)
  process.exit(3)
}

// ── scan ───────────────────────────────────────────────────────────────────────────────────────
function files(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n === 'scripts' || n === 'data' || n === 'assets') continue
    const st = statSync(p)
    if (st.isDirectory()) out.push(...files(p))
    else if (/\.(vue|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}
/* ★ A BUNDLE'S SOURCE IS NOT ONLY ITS OWN FOLDER ANY MORE. This gate scanned
 * plugin-designs/<bundle>/** and nothing else, which was right while every panel lived in its
 * plugin. The dashboard-kit extraction moves panels into library/components/dashboards/, and a
 * bundle still COMPILES them — so a rule that fires on the source stopped firing the moment the
 * file moved, with the code unchanged. MEASURED: kit landing 4c-3 moved DashboardFacetRail.vue,
 * which holds 3 toLocaleString('en-US') calls, and this matrix went from 13 warns to 10. Nothing
 * improved; the audit just stopped looking. LOC-ENUS has no `shipped` matcher, so the built-bundle
 * pass below could not catch them either.
 * So each bundle is now audited over the library files it actually IMPORTS, resolved from its own
 * `@map/...` specifiers and followed transitively. Attribution stays per-bundle, which is what
 * makes the matrix actionable: a library file consumed by four bundles is reported against all
 * four, because all four ship it. */
function libraryImportsFrom(startFiles) {
  const seen = new Set()
  const queue = [...startFiles]
  while (queue.length) {
    const f = queue.shift()
    let src = ''
    try { src = readFileSync(f, 'utf8') } catch (_) { continue }
    for (const m of stripComments(src).matchAll(/from\s*['"]@map\/([^'"]+)['"]/g)) {
      const rel = join('library', m[1])
      const abs = resolve(ROOT, rel)
      if (seen.has(abs) || !existsSync(abs)) continue
      // Same extension filter the per-bundle walk uses. Without it the sweep picked up
      // library/api/sources.json — the endpoint REGISTRY — and LIST-FETCH reported it as a file that
      // fetches the list, three times over. A .json file declares endpoints; it fetches nothing.
      if (!/\.(vue|js|mjs)$/.test(abs)) continue
      let st
      try { st = statSync(abs) } catch (_) { continue }
      if (!st.isFile()) continue
      seen.add(abs)
      queue.push(abs)
    }
  }
  return [...seen]
}
const filesWithLibrary = (dir) => { const own = files(dir); return [...own, ...libraryImportsFrom(own)] }

const findings = []
const matrix = {}
for (const b of BUNDLES.filter((x) => !ONLY || ONLY.includes(x))) {
  const dir = resolve(ROOT, 'plugin-designs', b)   // derived from the tree above, so it exists
  matrix[b] = { engine: 'ok', token: 'ok', locale: 'ok', list: 'ok' }
  for (const f of filesWithLibrary(dir)) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const r of RULES) for (const idx of run(r, src)) {
      // A module is not a bypass of its own contract. library/api/DataSourceManager.js ends with
      // `const dataSourceManager = new DataSourceManager()` — the singleton it exports — and LIST-DSM
      // exists to catch a CALLER constructing one without profileConfig. Reported against three
      // bundles when the sweep first reached it, which is a gate telling four owners that the library
      // is broken because it read the definition as a use.
      if (r.id === 'LIST-DSM' && /library\/api\/DataSourceManager\.js$/.test(f.replace(/\\/g, '/'))) continue
      // ★ ALLOW IS NOW SITE-SCOPABLE, because bundle-wide was the wrong granularity for a HELD
      // decision. regions-dashboard's one LOC-ENUS is a deliberate fixed en-US in the map popup, with
      // a card and DX-life's own convention as evidence. Allowing it at `bundle:RULE` would also have
      // silenced any FUTURE operative en-US anywhere in that bundle -- clearing a column by going
      // blind. A `bundle:RULE:file` key exempts the one file that earned it and leaves the rest of the
      // bundle answerable.
      // ★ AND A SHARED LIBRARY FILE CAN BE ALLOWED FOR EVERY BUNDLE THAT IMPORTS IT. A `*:RULE:file`
      // key is honoured only for a path under library/, because that is the one case where the site is
      // not the bundle's: library/utils/formatCount.js holds the HELD numerals decision for eight call
      // sites, and it is attributed to every bundle that compiles it. Per-importer entries would mean
      // the LOCALE column warns each time a bundle adopts the shared helper -- the column punishing the
      // fold that made the policy auditable. The library/ restriction is the whole guard: a bundle's own
      // source can never be wildcarded, so this cannot be used to clear a column broadly.
      const rel = relative(ROOT, f).replace(/\\/g, '/')
      const allowed = ALLOW[`${b}:${r.id}:${rel}`] || ALLOW[`${b}:${r.id}`]
        || (rel.startsWith('library/') ? ALLOW[`*:${r.id}:${rel}`] : undefined)
      if (allowed) { if (matrix[b][r.prop] === 'ok') matrix[b][r.prop] = 'allowed'; continue }
      findings.push({ b, rule: r.id, prop: r.prop, warn: !!r.warn, where: `${relative(ROOT, f)}:${lineOf(src, idx)}`, text: src.slice(idx, idx + 70).replace(/\s+/g, ' ').trim() })
      matrix[b][r.prop] = r.warn ? (matrix[b][r.prop] === 'BYPASS' ? 'BYPASS' : 'warn') : 'BYPASS'
    }
  }
  const shipped = resolve(ROOT, 'public', TREE_NAME, b, `${b}.js`)
  if (existsSync(shipped)) {
    const js = readFileSync(shipped, 'utf8')
    for (const r of RULES.filter((x) => x.shipped)) {
      const hit = typeof r.shipped === 'string' ? js.includes(r.shipped) : r.shipped.test(js)
      if (hit && !ALLOW[`${b}:${r.id}`]) { findings.push({ b, rule: r.id, prop: r.prop, where: relative(ROOT, shipped), text: '(in the shipped bundle)' }); matrix[b][r.prop] = 'BYPASS' }
    }
  }
}

if (REPORT) {
  console.log('bundle'.padEnd(24) + 'engine'.padEnd(10) + 'token'.padEnd(10) + 'locale'.padEnd(10) + 'list')
  for (const [b, m] of Object.entries(matrix)) console.log(b.padEnd(24) + m.engine.padEnd(10) + m.token.padEnd(10) + m.locale.padEnd(10) + m.list)
}
for (const f of findings) console.log(`${f.warn ? 'WARN   ' : 'BYPASS '} ${f.b.padEnd(22)} ${f.rule.padEnd(11)} ${f.where}  ${f.text}`)
const hard = findings.filter((f) => !f.warn)
if (findings.length - hard.length) console.log(`UNIVERSAL-PROPS: ${findings.length - hard.length} WARN(s): LOC-ENUS fixes numerals to en-US whatever the locale. Warn-only until the numerals policy is decided.`)
if (hard.length) {
  console.log(`UNIVERSAL-PROPS: FAIL — ${hard.length} bypass(es) in ${new Set(hard.map((f) => f.b)).size} bundle(s). Read the prop through the library (documentation/reference-universal-props.md), or ALLOW it here with the reason it is by design.`)
  process.exit(1)
}
console.log(`UNIVERSAL-PROPS: PASS — ${Object.keys(matrix).length} bundles read engine, token, locale and list through the library (self-test: ${RULES.length} rules each caught a planted bypass).`)
