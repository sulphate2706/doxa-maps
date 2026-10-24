#!/usr/bin/env node
// check-batch-selection-export — UPG-100's batch selection EXPORTS its selection (restored 2026-09-30).
//
// WHY IT MATTERS: when the people-group data changes, partners redraw the zones on the map, Copy or Export the
// selection, and hand it to an agent that regroups the zones (data/apply-grouping.mjs) and regenerates the
// posters. The copy/export path was removed once and the maps stopped being reproducible, so this pins it.
//
// Headless, no browser, no network. Asserts:
//   A. Copy's FIRST line is exactly what data/apply-grouping.mjs parses: fed through its own parsePayload, the
//      text returns the selected territory names, the UUPG total and the colour. The CSV after it must not
//      change that.
//   B. The CSV: the header is the declared columns; a cell with a comma, a quote or a line break survives a
//      real CSV parse; a leading = + - @ is neutralised (a spreadsheet never runs a name as a formula); one row
//      per people group, carrying the territories that contain it and the picked colour.
//   C. The HUD wires it: the colour swatches + hex input, Copy and Export CSV buttons with their handlers, and
//      batch mode prefetching the records so a tap copies inside its user activation.
//   D. The nine new strings exist in all 11 locales, non-empty, and translated (not English) outside en.
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(REPO, ...a)
const fails = []
const notes = []
const ok = (cond, msg, note) => { if (!cond) fails.push(msg); else if (note) notes.push(`  ok    ${note}`) }

let X, parsePayload, runApply, formatClipboard
try {
  X = await import(pathToFileURL(P('plugin-designs/my-upg-100-list/data/selection-export.js')).href)
  ;({ parsePayload, runApply } = await import(pathToFileURL(P('plugin-designs/my-upg-100-list/data/apply-grouping.mjs')).href))
  ;({ formatClipboard } = await import(pathToFileURL(P('plugin-designs/my-upg-100-list/data/territory-counts.js')).href))
} catch (e) {
  console.error(`BATCH-SELECTION-EXPORT: NOT MEASURED (exit 75) — an input did not load: ${e.message}`)
  process.exit(75)
}

// ── A. the clipboard's first line round-trips through apply-grouping ─────────────────────────────
const selection = [
  { key: 'adm1:Mahārāshtra', name: 'Mahārāshtra', count: 54, kind: 'adm1' },
  { key: 'adm1:Goa', name: 'Goa', count: 5, kind: 'adm1' },
  { key: 'adm0:NPL', name: 'Nepal', count: 34, kind: 'adm0' },
]
const records = [
  { slug: 'agaria', name: 'Agaria', country_code: 'IND', population: 12000 },
  { slug: 'q-comma', name: 'Bhil, Tadvi "Hill"', country_code: 'IND', population: 3100 },
  { slug: 'q-formula', name: '=HYPERLINK("x")', country_code: 'NPL', population: 450 },
  { slug: 'q-newline', name: 'Line one\nLine two', country_code: 'NPL', population: 7 },
  { slug: 'q-tab', name: '\t=cmd', country_code: 'NPL', population: 1 },
]
const from = new Map([['agaria', ['Mahārāshtra', 'Goa']], ['q-comma', ['Goa']], ['q-formula', ['Nepal']], ['q-newline', ['Nepal']], ['q-tab', ['Nepal']]])
const color = '#e69f00'
const csv = X.selectionCsv(records, from, { color })
const text = X.selectionClipboard(selection, { color }, csv)
let parsed = null
try { parsed = parsePayload(text) } catch (e) { fails.push(`apply-grouping's parsePayload REFUSED the Copy text: ${e.message}`) }
if (parsed) {
  const machine = ['Mahārāshtra', 'Goa', 'NPL']
  ok(JSON.stringify(parsed.names) === JSON.stringify(machine),
    `apply-grouping reads the names as ${JSON.stringify(parsed.names)}, expected ${JSON.stringify(machine)}`,
    'Copy\'s first line parses in apply-grouping: the 3 territories in machine names (a country as its ISO3), in order')
  ok(parsed.total === 93, `apply-grouping reads the total as ${parsed.total}, expected 93`, 'the UUPG total (93) and the colour survive the CSV after them')
  ok(parsed.hex === color, `apply-grouping reads the colour as ${parsed.hex}, expected ${color}`)
}
ok(text.split('\n')[0] === 'Mahārāshtra, Goa, NPL — 93 UUPG · #e69f00', `Copy's first line is "${text.split('\n')[0]}"`)
ok(text.split('\n')[1] === 'Mahārāshtra 54, Goa 5, Nepal 34', `Copy's second line (the reader's names) is "${text.split('\n')[1]}"`)
ok(text.includes('\n\n' + csv), 'Copy does not carry the CSV after a blank line')
ok(X.selectionClipboard(selection, {}, '').split('\n').length === 2, 'Copy without people groups is not exactly the two territory lines')

// ── A2. apply-grouping RESOLVES line 1 in ANY UI language ───────────────────────────────────────────────
// parsePayload only splits the names; resolution happens later (upsertPayloadZone), so this runs the tool's own
// dry run. In Arabic the HUD shows "نيبال", and a line 1 carrying it was rejected ("unresolved territory name(s)").
// The NEGATIVE CONTROL proves this check can fail: the same selection formatted with the reader's names must be
// refused by the same dry run.
const arabic = [
  { key: 'adm0:NPL', name: 'نيبال', count: 34, kind: 'adm0' },
  { key: 'adm0:BTN', name: 'بوتان', count: 13, kind: 'adm0' },
]
const dry = (payloadText) => { try { const r = runApply({ payloadText, dry: true, quiet: true }); return r && r.ok !== false ? 'ok' : 'not ok' } catch (e) { return 'threw: ' + String(e.message || e).slice(0, 120) } }
const arText = X.selectionClipboard(arabic, { color: '#0072b2' })
ok(dry(arText) === 'ok', `apply-grouping's dry run REFUSES the Arabic Copy: ${dry(arText)} (line 1 "${arText.split('\n')[0]}")`,
  'an ARABIC selection\'s Copy resolves in apply-grouping\'s own dry run (line 1 "NPL, BTN — 47 UUPG · #0072b2")')
ok(arText.split('\n')[1] === 'نيبال 34, بوتان 13', `the Arabic Copy's second line is "${arText.split('\n')[1]}", expected the reader's names`)
ok(dry(formatClipboard(arabic, { color: '#0072b2' })) !== 'ok', 'NEGATIVE CONTROL: a line 1 in the reader\'s Arabic names should be refused by the dry run, and was not: this check cannot fail',
  'negative control: the same selection in the reader\'s names IS refused (the check can fail)')
const indiaText = X.selectionClipboard([{ key: 'adm1:Mahārāshtra', name: 'Mahārāshtra', count: 54, kind: 'adm1' }, { key: 'adm1:Goa', name: 'Goa', count: 5, kind: 'adm1' }], {})
ok(dry(indiaText) === 'ok', `apply-grouping's dry run refuses an India state selection: ${dry(indiaText)}`, 'an India state selection resolves too (shape names are canonical)')

// ── A3. the client's regroupable() agrees with apply-grouping's own verdict ─────────────────────────────
// Copy warns when its first line will not regroup (a mix of kinds, or a legend zone). The warning is only honest if
// regroupable() says exactly what the tool's dry run says, so each case is run through BOTH.
const T = (key, name, count, kind, country) => ({ key, name, count, kind, ...(country ? { country } : {}) })
const REGROUP_CASES = {
  'India states': [T('adm1:Mahārāshtra', 'Mahārāshtra', 54, 'adm1', 'IND'), T('adm1:Goa', 'Goa', 5, 'adm1', 'IND')],
  'a China province': [T('adm1:Gansu Province', 'Gansu Province', 3, 'adm1', 'CHN')],
  'countries': [T('adm0:NPL', 'Nepal', 34, 'adm0'), T('adm0:BTN', 'Bhutan', 13, 'adm0')],
  'a state + a country': [T('adm1:Goa', 'Goa', 5, 'adm1', 'IND'), T('adm0:NPL', 'Nepal', 34, 'adm0')],
  'India + China': [T('adm1:Goa', 'Goa', 5, 'adm1', 'IND'), T('adm1:Gansu Province', 'Gansu Province', 3, 'adm1', 'CHN')],
  'a legend zone': [T('zone:test', 'Test Zone', 12, 'zone')],
}
const disagree = []
for (const [name, sel] of Object.entries(REGROUP_CASES)) {
  const tool = dry(X.selectionClipboard(sel, {})) === 'ok'
  if (X.regroupable(sel) !== tool) disagree.push(`${name}: regroupable ${X.regroupable(sel)}, apply-grouping ${tool ? 'accepts' : 'refuses'}`)
}
// …and the COUNTRY an ADM1 territory needs for that verdict is always known: from the feature's own props on a
// map tap, else from the baked table (a props-only toggle once left it null, which read as a false warning).
const { resolveTerritory, ADM1_COUNTS, ADM1_COUNTRY } = await import(pathToFileURL(P('plugin-designs/my-upg-100-list/data/territory-counts.js')).href)
const noCountry = Object.keys(ADM1_COUNTS).filter((n) => !['IND', 'CHN'].includes(ADM1_COUNTRY[n]))
ok(!noCountry.length && resolveTerritory({ shapeName: 'Mahārāshtra' }).country === 'IND' && resolveTerritory({ shapeName: 'Guizhou Province' }).country === 'CHN',
  `an ADM1 territory without a known country: ${noCountry.slice(0, 5).join(', ') || 'a props-only toggle'}`, 'every ADM1 name resolves its country, even from a props-only toggle')
ok(!disagree.length, `Copy's regroup warning disagrees with apply-grouping: ${disagree.join('; ')}`,
  `the regroup warning matches apply-grouping's own verdict in all ${Object.keys(REGROUP_CASES).length} cases (India, China, countries, and the three it refuses)`)

// ── A4. A STALLED people-group load can never hang Copy ─────────────────────────────────────────────────
// Copy races the people-group detection against COPY_WAIT_MS through settleWithin(); past it, it copies the territory
// lines alone (they need no network) and says why. The self-test: a promise that NEVER settles must still resolve to
// the marker in time; a value passes through; a failure still rejects (its own message is kept).
{
  const MARK = {}, t0 = Date.now()
  // The gate's own backstop: if settleWithin waited for ever, this reads 'GATE-TIMEOUT' and FAILS by name.
  const stalled = await Promise.race([X.settleWithin(new Promise(() => {}), 60, MARK), new Promise((r) => setTimeout(() => r('GATE-TIMEOUT'), 2000))])
  const quick = await X.settleWithin(Promise.resolve('v'), 1000, MARK)
  const failed = await X.settleWithin(Promise.reject(new Error('down')), 1000, MARK).then(() => 'resolved', (e) => e.message)
  ok(stalled === MARK && Date.now() - t0 < 1000 && quick === 'v' && failed === 'down',
    `settleWithin: a stalled source gave ${stalled === MARK ? 'the marker' : JSON.stringify(stalled)}, a value gave ${quick}, a failure gave ${failed}`,
    'a NEVER-settling people-group load still lets Copy settle in time (and a value / a failure pass through)')
}

// ── A5. A FAILED load never shows the reader a raw browser message ─────────────────────────────────────
// The second Copy after the 30 s abort flashed "signal is aborted without reason". The self-test aborts a REAL fetch
// (the signal is aborted before the request starts, so nothing is sent) and makes a real one fail (a refused
// localhost port, bounded at 2 s); both must read as the keyed stall text. A keyed error keeps its own text. The NEGATIVE CONTROL is
// the old path, errorText without asReaderError, which must still show the raw message, so this test can see the defect.
{
  const { keyedError, errorText } = await import(pathToFileURL(P('library/i18n/keyedError.js')).href)
  const en = JSON.parse(readFileSync(P('library/i18n/locales/en/upgMap.json'), 'utf8'))
  const tr = (k, p = {}) => { const v = k.startsWith('upgMap.') ? en[k.slice(7)] : undefined; return v == null ? k : v.replace(/\{(\w+)\}/g, (m, x) => (p[x] != null ? String(p[x]) : m)) }
  const stillLoading = () => keyedError('upgMap.peopleStillLoading', 'the people groups are still loading, try again in a moment')
  const aborted = await fetch('http://127.0.0.1:9/', { signal: AbortSignal.abort() }).then(() => null, (e) => e)
  // Bounded: a host running the discard service ACCEPTS port 9 and would hang; a timeout is a failure too.
  const refused = await fetch('http://127.0.0.1:9/', { signal: AbortSignal.timeout(2000) }).then(() => null, (e) => e)
  const keyed = keyedError('upgMap.selectionAdm1NoData', 'no people-group data for {names}', { names: 'Yunnan' })
  const shown = (e) => errorText(X.asReaderError(e, stillLoading), tr)
  const want = en.peopleStillLoading
  ok(aborted && aborted.name === 'AbortError' && /abort/i.test(errorText(aborted, tr)),
    `NEGATIVE CONTROL: an aborted fetch gave ${aborted && aborted.name} "${aborted && errorText(aborted, tr)}" on the old path, so the test cannot see the defect`,
    'negative control: on the old path an aborted fetch shows the raw "' + (aborted ? errorText(aborted, tr) : '') + '"')
  ok(shown(aborted) === want && refused && shown(refused) === want && shown(keyed) === tr('upgMap.selectionAdm1NoData', { names: 'Yunnan' }),
    `a failed load reads: aborted "${shown(aborted)}", refused "${refused && shown(refused)}", keyed "${shown(keyed)}"`,
    'an aborted or refused people-group fetch reads as the stall text; a keyed error keeps its own')
}

// ── A6. A STATE-ONLY selection titles its Prayer list / Card deck ───────────────────────────────────────
// Development threw "Reduce of empty array" for a state-only selection: the title named zones and countries only, so
// a selection of Gujarāt alone had NO names. On the REAL served table: Gujarāt alone is titled "Gujarāt"; a state +
// a country names both; a province with no table beside it is not named; Mizoram (no groups listed) alone gives the
// keyed "no people groups" text. NEGATIVE CONTROL: the old naming (zones + countries) gives [] and reduce() throws.
{
  const { keyedError, errorText } = await import(pathToFileURL(P('library/i18n/keyedError.js')).href)
  const wallEn = JSON.parse(readFileSync(P('library/i18n/locales/en/wall.json'), 'utf8'))
  const tr = (k) => k.split('.').slice(1).reduce((o, x) => (o == null ? o : o[x]), wallEn) ?? k
  const states = JSON.parse(readFileSync(P('data/people-groups/india-states.json'), 'utf8')).states
  const st = (shape) => states.find((x) => x.shapeName === shape)
  const guj = st('Gujarāt'), miz = st('Mizoram')
  const fromOf = (pairs) => { const m = new Map(); for (const [slugs, name] of pairs) for (const s of slugs) m.set(s, [...(m.get(s) || []), name]); return m }
  const noRecords = () => keyedError('wall.hud.noRecords', 'that list has no people groups to print')
  const join = (a, b) => `${a} + ${b}`
  const T = (kind, name) => ({ kind, name })
  const alone = X.selectionTitleNames([], [T('adm1', 'Gujarāt')], fromOf([[guj.slugs, 'Gujarāt']]), noRecords)
  const both = X.selectionTitleNames([], [T('adm0', 'Nepal'), T('adm1', 'Gujarāt')], fromOf([[['npl-a', 'npl-b'], 'Nepal'], [guj.slugs, 'Gujarāt']]), noRecords)
  const withProvince = X.selectionTitleNames([], [T('adm1', 'Guizhou Province'), T('adm1', 'Gujarāt')], fromOf([[guj.slugs, 'Gujarāt']]), noRecords)
  let empty = ''
  try { X.selectionTitleNames([], [T('adm1', 'Mizoram')], fromOf([[miz.slugs, 'Mizoram']]), noRecords); empty = 'no throw' } catch (e) { empty = errorText(e, tr) }
  let oldThrows = false
  try { [].reduce(join) } catch (_) { oldThrows = true }
  const oldNames = [...[], ...[T('adm1', 'Gujarāt')].filter((t) => t.kind === 'adm0').map((t) => t.name)]
  ok(guj.count === 90 && miz.count === 0 && oldNames.length === 0 && oldThrows,
    `NEGATIVE CONTROL: Gujarāt ${guj.count} / Mizoram ${miz.count} groups, the old naming gave ${JSON.stringify(oldNames)}`,
    'negative control: on the old naming a Gujarāt-only selection has no names, and reduce() throws')
  ok(alone.length === 1 && alone.reduce(join) === 'Gujarāt' && both.join('|') === 'Nepal|Gujarāt' && withProvince.join('|') === 'Gujarāt' && empty === tr('wall.hud.noRecords'),
    `titles: alone ${JSON.stringify(alone)}, with a country ${JSON.stringify(both)}, with a province ${JSON.stringify(withProvince)}, Mizoram alone "${empty}"`,
    `a state-only selection is titled "Gujarāt"; a state + a country names both; a province with no table is not named; Mizoram alone reads "${empty}"`)
}

// ── A7. A selection too big for a PHONE'S PRINT starts nothing there ────────────────────────────────────
// Printing the whole selection (2,209 groups, 113 sheets) crashed the page in a 2.5 GB browser; 1,857 finished. The
// ceiling (half of that, for a phone tab's memory) is recorded beside its measurement in data/selection-export.js.
// Self-test: a phone over the ceiling is blocked; a desktop over it is not; a phone at or under it (India alone, 905)
// is not. The wiring (arm C) checks each of Prayer list, Card deck and Poster asks BEFORE it prints.
{
  const c = X.PHONE_GROUP_CEILING
  const src = readFileSync(P('plugin-designs/my-upg-100-list/data/selection-export.js'), 'utf8')
  const cases = [[2209, true, true], [1001, true, true], [2209, false, false], [c, true, false], [905, true, false]]
  const wrong = cases.filter(([n, phone, want]) => X.overPhoneCeiling(n, phone) !== want).map(([n, phone]) => `${n} on a ${phone ? 'phone' : 'desktop'}`)
  ok(c === 1000 && !wrong.length && /2,209 groups +113 sheets +the page CRASHED/.test(src) && /1,857 groups/.test(src),
    `phone ceiling ${c}: wrong for ${wrong.join(', ') || '(none)'}; the measurement beside it is ${/2,209 groups/.test(src) ? 'present' : 'MISSING'}`,
    `a phone over ${c} groups prints nothing (2,209 → blocked); a desktop is never blocked; India alone (905) still prints on a phone`)
}

// ── B. the CSV ───────────────────────────────────────────────────────────────────────────────────
function parseCsv(s) {   // RFC 4180: quoted fields, doubled quotes, CRLF records
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += c
  }
  row.push(cell); rows.push(row)
  return rows
}
const rows = parseCsv(csv)
ok(JSON.stringify(rows[0]) === JSON.stringify(X.SELECTION_CSV_COLUMNS), `the CSV header is ${JSON.stringify(rows[0])}`, `the CSV header: ${X.SELECTION_CSV_COLUMNS.join(',')}`)
ok(rows.length === 1 + records.length, `the CSV has ${rows.length - 1} data rows for ${records.length} people groups`)
const col = (r, k) => r[X.SELECTION_CSV_COLUMNS.indexOf(k)]
ok(col(rows[2], 'name') === 'Bhil, Tadvi "Hill"', `a name with a comma and quotes reads back as ${JSON.stringify(col(rows[2], 'name'))}`)
ok(col(rows[4], 'name') === 'Line one\nLine two', `a name with a line break reads back as ${JSON.stringify(col(rows[4], 'name'))}`,
  'commas, quotes and line breaks survive a real CSV parse')
ok(col(rows[3], 'name') === '\'=HYPERLINK("x")', `a leading = reads back as ${JSON.stringify(col(rows[3], 'name'))}: a spreadsheet would run it`,
  'a leading = + - @ is neutralised')
ok(col(rows[5], 'name') === "'\t=cmd", `a leading TAB reads back as ${JSON.stringify(col(rows[5], 'name'))}: OWASP lists it as a formula trigger`,
  'a leading TAB or CR is neutralised too (OWASP)')
ok(col(rows[1], 'territories') === 'Mahārāshtra; Goa' && col(rows[1], 'color') === color && col(rows[1], 'slug') === 'agaria',
  `row 1 is ${JSON.stringify(rows[1])}`, 'each row carries its slug, the territories that contain it, and the colour')

// ── C. the HUD wires it ──────────────────────────────────────────────────────────────────────────
const vue = readFileSync(P('plugin-designs/my-upg-100-list/upg-100-list.vue'), 'utf8')
const wired = {
  'the colour swatches': /class="upg-swatch"[\s\S]{0,400}@click="setSelectionColor\(c\)"/.test(vue),
  'the custom hex input': /class="upg-hex"[\s\S]{0,200}@change="onHexInput"/.test(vue),
  'the Copy button': /@click="copySelection">\{\{ t\('upgMap\.copySelection'\) \}\}/.test(vue),
  'the Export CSV button': /@click="exportSelectionCsv">/.test(vue) && vue.includes("t('upgMap.exportCsv')"),
  'the prefetch on batch mode': /if \(next\) selectionRecordsLoad\(\)/.test(vue),
  'one detection for every action': (vue.match(/await selectionPeople\(\)/g) || []).length >= 2 && /settleWithin\(selectionPeople\(\)/.test(vue),
  // India's states resolve through the served table (library/data/indiaStates.js), fetched only once a state is selected
  'Copy waits at most COPY_WAIT_MS for the people groups': /settleWithin\(selectionPeople\(\), COPY_WAIT_MS, STALLED\)/.test(vue) && /if \(p === STALLED\) \{ note = t\('upgMap\.peopleStillLoading'\); return selectionClipboard\(sel, \{ color \}\); \}/.test(vue),
  'the records fetch times out and leaves the cache': /setTimeout\(\(\) => ctrl\.abort\(\), RECORDS_TIMEOUT_MS\)/.test(vue) && /signal: ctrl \? ctrl\.signal : undefined/.test(vue),
  'every failed load reads as the stall, never a raw message': /const readerError = \(e\) => asReaderError\(e, stillLoading\)/.test(vue)
    && /\}\)\(\)\.catch\(\(e\) => \{ throw readerError\(e\); \}\);/.test(vue)
    && /note = errorText\(readerError\(e\), t\)/.test(vue) && /csvFailed', \{ reason: errorText\(readerError\(e\), t\)/.test(vue),
  // In batch mode a tap on a pin opens NO detail sheet (it covered the whole HUD on a phone); the tapestry
  // listener under it toggles the territory. The real-tap proof is a browser check; this pins the guard in the source.
  'a pin tap in batch mode opens no sheet': /map\.on\('click', 'upg-pins-hit', \(e\) => \{[\s\S]{0,700}?if \(batchMode\.value\) return\s*\n\s*const f = e && e\.features/.test(vue),
  // …and that tap toggles the territory EXACTLY ONCE: the tapestry listener already does it, so the pin handler
  // must not toggle a second time (select-then-deselect in one tap).
  'the pin handler adds no second toggle': (() => {
    const at = vue.indexOf("map.on('click', 'upg-pins-hit', (e) => {"); if (at < 0) return false
    const body = vue.slice(at, vue.indexOf('\n  })', at))
    return !/toggleTerritory|toggleByProps|toggleZoneSelection/.test(body)
  })(),
  // Each print action asks the phone ceiling BEFORE it prints, and says so in the house words.
  'a big selection on a phone prints nothing': (() => {
    const body = (name) => { const at = vue.indexOf(`async function ${name}() {`); return at < 0 ? '' : vue.slice(at, vue.indexOf('\n}\n', at)) }
    const before = (name, call) => { const b = body(name); const g = b.indexOf('phoneTooBig('), p = b.indexOf(call); return g > 0 && p > g }
    return before('makeSelectionPacket', 'packetPrints.printPacket(') && before('makeSelectionCards', 'packetPrints.printCardDeck(')
      && before('makeSelectionPoster', 'packetPrints.printPoster(') && /hudSay\(t\('poster\.phoneLimitAll'\), 6000\)/.test(vue)
      && /const ON_PHONE = isPhonePrint\(\);/.test(vue)
  })(),
  // ★ ON A PHONE .upg-status IS display:none, so a batch message written only there is INVISIBLE (a reader tapped
  // Prayer List and nothing visible happened). Every batch action's message, and the print's progress, reach the
  // HUD's line (.upg-hud-flash, a polite live region that no rule hides) as well as the status badge.
  'batch messages and progress reach the visible HUD on a phone': (() => {
    const body = (name) => { const at = vue.indexOf(`async function ${name}() {`); return at < 0 ? '' : vue.slice(at, vue.indexOf('\n}\n', at)) }
    const actions = ['makeSelectionPacket', 'makeSelectionCards', 'makeSelectionPoster'].map(body)
    const tooBig = vue.slice(vue.indexOf('function phoneTooBig('), vue.indexOf('function phoneTooBig(') + 300)
    return /const hudSay = \(text, ms\) => \{ flashStatus\(text, ms\); flashRef\(copyFlash, text, ms\); \};/.test(vue)
      && /hudSay\(t\('poster\.phoneLimitAll'\)/.test(tooBig) && !/flashStatus\(/.test(tooBig)
      && actions.every((b) => b && !/flashStatus\(/.test(b))
      && /class="upg-hud-flash" role="status" aria-live="polite">\{\{ copyFlash \|\| hudProgress \}\}/.test(vue)
      && /hudProgress\.value = printStatus;/.test(vue)
      // …and it sits ABOVE the action rows: on a phone the PinHint toast covers the HUD's bottom edge
      && vue.indexOf('class="upg-hud-flash"') > 0 && vue.indexOf('class="upg-hud-flash"') < vue.indexOf('class="upg-hud-actions"')
      && !/\.upg-hud-flash\{[^}]*display:\s*none/.test(vue) && !/@media[^{]*\{[^}]*\.upg-hud-flash\{[^}]*display:\s*none/.test(vue)
  })(),
  'the regroup warning on Copy': /const warn = regroupable\(sel\) \? '' : t\('upgMap\.copyNotRegroupable'\)/.test(vue),
  // The packet / card-deck title goes through selectionTitleNames (arm A6 proves it), with the keyed empty case.
  'the title names come from selectionTitleNames': /const names = selectionTitleNames\(zoneNames, selectedTerritories\.value, from,\s*\n\s*\(\) => keyedError\('wall\.hud\.noRecords'/.test(vue)
    && !/const names = \[\.\.\.zoneNames, \.\.\.countryNames\]/.test(vue),
  'India states detected from the served table': /import \{ loadIndiaStates \} from '@map\/data\/indiaStates\.js'/.test(vue)
    && /india\.byShapeName\.get\(t\.name\)/.test(vue) && /t\.kind === 'adm1'\) indiaStates\(\)\.catch/.test(vue),
}
const missingWires = Object.entries(wired).filter(([, v]) => !v).map(([k]) => k)
ok(!missingWires.length, `the HUD is missing: ${missingWires.join(', ')}`, 'the HUD wires the swatches, hex input, Copy, Export CSV, the prefetch, and India\'s states from the served table')

// ── D. the strings, ×11 ──────────────────────────────────────────────────────────────────────────
const LANGS = ['en', 'es', 'fr', 'pt', 'de', 'it', 'ro', 'ru', 'ar', 'hi', 'zh']
const KEYS = {
  poster: ['phoneLimitAll'],
  upgMap: ['copySelection', 'exportCsv', 'copyNotRegroupable', 'peopleStillLoading', 'selectionColourGroup', 'selectionColour', 'customColour', 'copiedSelection', 'copiedTerritoriesOnly', 'csvSaved', 'csvFailed'] }
const cat = (l, f) => JSON.parse(readFileSync(P('library/i18n/locales', l, `${f}.json`), 'utf8'))
const bad = []
for (const [f, keys] of Object.entries(KEYS)) {
  const en = cat('en', f)
  for (const l of LANGS) {
    const c = cat(l, f)
    for (const k of keys) {
      if (typeof c[k] !== 'string' || !c[k].trim()) bad.push(`${l} ${f}.${k} missing`)
      else if (l !== 'en' && c[k] === en[k]) bad.push(`${l} ${f}.${k} is English`)
    }
  }
}
ok(!bad.length, `strings: ${bad.slice(0, 8).join('; ')}${bad.length > 8 ? ` (+${bad.length - 8})` : ''}`, `the ${KEYS.upgMap.length} new strings in all ${LANGS.length} locales, translated`)

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('BATCH-SELECTION-EXPORT: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('BATCH-SELECTION-EXPORT: PASS — Copy parses in apply-grouping, the CSV is well-formed and safe, the HUD wires both, and the strings are in all 11 locales.')
