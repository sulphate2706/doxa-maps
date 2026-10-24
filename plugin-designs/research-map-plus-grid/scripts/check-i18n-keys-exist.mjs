#!/usr/bin/env node
/**
 * check-i18n-keys-exist.mjs — a localized CALL SITE is not a localized STRING.
 *
 * THE FAILURE CLASS, found twice in one day and invisible both times.
 *
 *   1. The research dashboard's five resize handles read their accessible names through
 *      `T('aria.resizeFiltersRail', 'Resize filters rail')`. Reviewed, they look correct: the call
 *      goes to the catalogue, the fallback is only a fallback. But `aria.json` held ELEVEN keys and
 *      not one of them was a resize key — so every handle had been announcing itself in English in
 *      all eleven locales. Nothing was watching the JOIN between the call and the catalogue.
 *   2. big-picture's footer reads `tStatic('dashboard.bp_subtitle') || "Search and filter the
 *      world's people groups · least-reached shown first"`. Same shape, same silence.
 *
 * ★ WHY NO EXISTING GATE SEES IT. check:i18n-parity asks whether every locale has the same keys as
 * English — it does, because the key is missing from ALL of them equally. check:english-leaks and
 * check:composite-locale-leaks both need the catalogue to HOLD the string before they can call its
 * appearance a leak, and it does not. check:ui-strings-have-keys reads TEMPLATES for typed English.
 * Every one of them is looking at a different end of the same wire. This asks the one question none
 * of them asks: does the key this code names actually exist?
 *
 * THE FALLBACK IS WHAT MAKES IT SILENT, and the fallback is right to exist — a missing key must
 * degrade to readable English, not to "dashboard.bp_subtitle" on screen. So the defect can only be
 * seen by reading the two sides together, which is a gate's job and not a reviewer's.
 *
 * WHAT IT CHECKS. Every `tStatic('a.b')` / `T('a.b', …)` / `L('x', …)`-style literal key in
 * plugin-designs/ and library/ resolves to a string in library/i18n/locales/en/. English is the
 * reference because check:i18n-parity already guarantees the other ten match it — so one missing
 * English key is eleven missing strings, and a key present in en is present everywhere.
 *
 * DYNAMIC KEYS ARE NOT GUESSED AT. `tStatic('dashboard.' + k)` and template literals are reported
 * as UNRESOLVED and counted, never failed: this gate refuses to invent the key set a runtime
 * expression might produce. A count that a reader can see is honest; a silent skip is not.
 *
 * NEGATIVE-TESTED 2026-09-26: deleting `aria.resetAllFilters` from en/aria.json makes it FAIL
 * naming the key and the call site; restoring it returns PASS. It FAILS on today's tree.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'I18N-KEYS-EXIST'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : '' }
// ★ --rev READS A TREE YOU ARE NOT STANDING IN, straight from the object store.
// A fleet-wide census has to be taken against CURRENT main, not against one owner's worktree: every
// bundle but mine is stale here, and a stale scan reports keys another owner added an hour ago. That
// would mean mailing seven owners a list of defects they had already fixed — the cried-wolf failure,
// arriving in somebody else's inbox. Checking out a second tree was not an option either (the box is
// at 97% disk), so the files are read as blobs. No worktree, no temp copy, no writes.
const REV = argOf('--rev')
const BY_BUNDLE = process.argv.includes('--by-bundle')
const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 28 })

// ── the tree under measurement: a path -> contents reader, from disk or from a revision ──────
let listFiles, readFile, describeTree
if (REV) {
  // One ls-tree, then ONE cat-file --batch for every blob: ~400 files in two processes rather than
  // 400. The batch stream is "<sha> blob <size>\n<bytes>\n", so it is parsed by length, never by
  // scanning for a delimiter that could occur inside a file.
  const entries = String(git(['ls-tree', '-r', REV, '--', 'plugin-designs', 'library']))
    .split('\n').filter(Boolean)
    .map((l) => { const [meta, path] = l.split('\t'); const [, type, sha] = meta.split(/\s+/); return { type, sha, path } })
    .filter((e) => e.type === 'blob')
  const wanted = entries.filter((e) => /\.(vue|js|mjs|json)$/.test(e.path))
  const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: ROOT, input: wanted.map((e) => e.sha).join('\n') + '\n', maxBuffer: 1 << 28 })
  const contents = new Map()
  let off = 0
  for (const e of wanted) {
    const nl = batch.indexOf(0x0a, off)
    const size = Number(String(batch.subarray(off, nl)).split(' ')[2])
    contents.set(e.path, batch.subarray(nl + 1, nl + 1 + size).toString('utf8'))
    off = nl + 1 + size + 1
  }
  listFiles = (pred) => [...contents.keys()].filter(pred)
  readFile = (p) => contents.get(p)
  describeTree = `${REV} (${String(git(['rev-parse', '--short', REV])).trim()})`
} else {
  const all = []
  const walkDir = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walkDir(p)
      else all.push(relative(ROOT, p))
    }
  }
  for (const s of ['plugin-designs', 'library']) { const p = join(ROOT, s); if (existsSync(p) && statSync(p).isDirectory()) walkDir(p) }
  listFiles = (pred) => all.filter(pred)
  readFile = (p) => readFileSync(join(ROOT, p), 'utf8')
  describeTree = 'the working tree'
}

// ── the English catalogue, as one flat key set: "<area>.<path.to.key>" ───────────────────────
// The area is the FILE NAME, because that is how every call site spells it: tStatic('aria.foo')
// reads aria.json. Nested objects flatten with dots, the way tStatic walks them.
const CAT = /^library\/i18n\/locales\/en\/[^/]+\.json$/
const catalogues = listFiles((p) => CAT.test(p))
if (!catalogues.length) { console.log(`${TAG}: SKIP — no English catalogue in ${describeTree}.`); process.exit(0) }
const AREAS = new Set()
const KEYS = new Set()
for (const p of catalogues) {
  const area = p.split('/').pop().replace(/\.json$/, '')
  AREAS.add(area)
  const walk = (node, path) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, path ? path + '.' + k : k)
    } else if (typeof node === 'string') KEYS.add(area + '.' + path)
  }
  try { walk(JSON.parse(readFile(p)), '') } catch (e) {
    console.error(`${TAG}: ${p} does not parse — ${e.message}`); process.exit(1)
  }
}

// ── every source file that could name a key ──────────────────────────────────────────────────
// `scripts/` is build and gate TOOLING, not product UI. Skipping it is not a convenience: this
// gate's own header quotes two real call sites as examples, and scanning itself reported them as
// missing keys — a check that fails on its own documentation is a check nobody trusts.
const files = listFiles((p) => /\.(vue|js|mjs)$/.test(p) && !p.includes('/scripts/') && !p.includes('/locales/'))

// ── ★ A TRANSLATOR CAN ARRIVE FROM A COMPOSABLE, NOT ONLY FROM A LOCAL WRAPPER ───────────────
// a poison key was planted behind `const T = useGiT()` and this gate PASSED. Three failures of
// the same shape stacked up: (1) the file never writes the word tStatic, so the precondition below
// skipped it outright; (2) `useGiT` is not `tStatic`, so aliasesIn() found no alias at all; and
// (3) the alias is PREFIXED — useOptionalT carries a namespace — while its call sites pass BARE
// keys, which the full-key pattern cannot match because it requires a dot. Any one of the three
// alone would have hidden the key. A census says this was never one bundle's problem: 26 alias
// sites across three factories (useOptionalT, useNeighborT, usePplrT).
//
// THE NAMESPACE IS READ, NOT LISTED, for the same reason the wrapper names are. Every factory in
// this tree is one line — `return useOptionalT('neighbor')` — so following it costs nothing, and
// the next useXxxT() is covered the day it is written instead of the day someone remembers to come
// back here. A factory whose namespace this gate cannot read is left alone rather than guessed at.
const FACTORY_NS = new Map([['useOptionalT', null], ['useOptionalI18n', null]])   // null = read the call site's own first argument
const factoriesIn = (src, into) => {
  // 1. THE EXACT SHAPE, kept first and unchanged: `export function useX() { return useOptionalT('ns') }`.
  //    Its namespace is READ, not guessed, and that precision is worth keeping for every factory
  //    written that way.
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*return\s+useOptional(?:T|I18n)\s*\(\s*'([^']*)'/g)) into.set(m[1], m[2])
  // 2. ★ AND ANY OTHER EXPORTED FUNCTION THAT BUILDS A TRANSLATOR, because requiring the one-liner is
  //    how this gate lost a whole bundle. gospel's useGiT stopped being `return useOptionalT('gospelInternet')`
  //    and became a WRAPPER — `const t = useOptionalT()` then a returned arrow that adds a fallback
  //    argument. Perfectly reasonable code; it simply no longer matched, so useGiT was not a factory,
  //    `const T = useGiT()` was not an alias, and every T('…') in that bundle was not a call site.
  //    The gate reported PASS over two planted poison keys, three rounds running.
  //
  //    The body is taken to the next top-level `export`, which is where a function ends in practice in
  //    this tree. A namespace is used only if the call states one literally; otherwise the factory is
  //    registered with null, which now means UNRESOLVED-AND-REPORTED rather than silently dropped.
  //    Registering it wrongly-but-loudly beats not registering it at all: the failure is visible.
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1]
    if (into.has(name)) continue
    const rest = src.slice(m.index)
    const end = rest.indexOf('\nexport ', 1)
    const body = end === -1 ? rest : rest.slice(0, end)
    const call = /useOptional(?:T|I18n)\s*\(\s*(?:'([^']*)')?/.exec(body)
    if (!call) continue
    into.set(name, call[1] === undefined ? null : call[1])
  }
  return into
}
for (const f of files) {
  let src = ''
  try { src = readFile(f) || '' } catch (_) { continue }
  if (src.includes('useOptional')) factoriesIn(src, FACTORY_NS)
}
let FACTORIES = [...FACTORY_NS.keys()].join('|')
let fallbackOnly = 0
// ★ A TRANSLATOR WHOSE NAMESPACE THIS GATE CANNOT READ. Distinct from useOptionalT(''), which is an
// author DECLARING no namespace; this is the gate failing to determine one, and the two must not be
// reported as the same thing. Round three of gospel-internet being invisible was exactly this, silent.
const unresolvedAliases = []
const seesFile = (src) => !!src && (src.includes('tStatic') || src.includes('$t(') || src.includes(' t(')
  || new RegExp(`(?:${FACTORIES})\\s*\\(`).test(src))

// ── ★ ALIASES ARE DISCOVERED PER FILE, NOT HARDCODED ─────────────────────────────────────────
// The first version of this gate matched tStatic/$t/t and found four missing keys while sailing
// past the ten it was written for, because the house pattern is a file-local wrapper. Adding `T` by
// hand took it to 22 — and that fix was the same mistake one level up, because a census of the tree
// finds FOUR wrapper names, not one: `const T` x16, `const L` x6, `const tr` x1
// (library/layouts/VerticalTabsLayout.vue) and `const v` x1. A gate that knows about T and not tr is
// blind to whichever bundle used the other name, and reports it CLEAN. So the names are read out of
// each file instead of listed here, and the next author's alias is covered the day they write it.
//
// TWO SHAPES, because the tree has two:
//   FULL-KEY   const T = (key, en) => tStatic(key) || en          -> T('aria.foo')
//   PREFIXED   const L = (key, en) => tStatic('dashboard.' + key) -> L('foo')  =>  dashboard.foo
// The prefixed form may carry a LADDER — ResearchMapSideMenu's is
// `tStatic('controls.' + key) || tStatic('dashboard.' + key) || en` — and at runtime the first hit
// wins, so a key RESOLVES if ANY prefix in the ladder holds it. Those were previously counted as
// unresolved and left unchecked; they are ordinary keys with a known prefix, and declining to
// resolve them was leaving most of this gate's coverage on the floor.
const BASE_FULL = ['tStatic', '$t', 't']
function aliasesIn(src) {
  const full = new Set(BASE_FULL)
  const prefixed = new Map()           // name -> [prefix, …]
  // `const NAME = ... tStatic(...)` on one line — all eight declarations in the tree are one-liners.
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]*tStatic[^\n]*)/g)) {
    const [, name, body] = m
    const prefixes = [...body.matchAll(/tStatic\(\s*'([A-Za-z_][\w]*)\.'\s*\+/g)].map((x) => x[1])
    if (prefixes.length) prefixed.set(name, prefixes)
    // A wrapper passes its FIRST PARAMETER straight through: `(key, en) => tStatic(key)`. Matching
    // on the parameter NAME rather than on the word "key" keeps it honest if someone calls it `k`.
    else {
      const param = /\(\s*([A-Za-z_$][\w$]*)/.exec(body)?.[1]
      if (param && new RegExp(`tStatic\\(\\s*${param}\\b`).test(body)) full.add(name)
      else if (/=\s*tStatic\s*$/.test(body.trim())) full.add(name)
    }
  }
  // A NAME BOUND FROM A FACTORY: `const t = useOptionalT('connectivity')`, `const nt =
  // useNeighborT()`, `const { t: T, te } = useOptionalI18n('gospel')`.
  for (const m of src.matchAll(new RegExp(`(?:const|let|var)\\s+(?:([A-Za-z_$][\\w$]*)|\\{([^}]*)\\})\\s*=\\s*(${FACTORIES})\\s*\\(([^\\n]*)`, 'g'))) {
    const [, plain, destructured, factory, argsTail] = m
    const declared = FACTORY_NS.get(factory)
    const ns = declared === null || declared === undefined ? (/^\s*'([^']*)'/.exec(argsTail)?.[1] ?? null) : declared
    // ★ `continue` HERE IS HOW THIS GATE WENT BLIND TO A WHOLE BUNDLE, THREE TIMES. ns === null means
    // the namespace could not be READ — the factory was called with no string literal, as
    // `useGiT()` became when its body changed to `const t = useOptionalT()`. Dropping the binding
    // silently unregistered the alias, so every T('…') in those files stopped being a call site at
    // all and the bundle passed by having nothing looked at. Two planted poisons sat there unreported
    // while the gate printed PASS.
    //
    // Note what it is NOT: useOptionalT('') gives ns === '' — an author explicitly declaring no
    // namespace — which is handled below and counted. Empty is a decision; null is this gate's own
    // ignorance, and ignorance must be stated rather than skipped.
    //
    // So the binding is still registered for the FULL-KEY pass, because a fully dotted key
    // (T('gospelInternet.foo')) is checkable no matter what the namespace is, and BARE calls it
    // genuinely cannot resolve are counted and FAIL. The gate now says which it could not see.
    if (ns === null) {
      const nms = plain ? [plain]
        : [...String(destructured).matchAll(/\bt\s*:\s*([A-Za-z_$][\w$]*)|(?:^|,)\s*(t)\s*(?=,|$)/g)].map((x) => x[1] || x[2]).filter(Boolean)
      for (const n of nms) {
        full.add(n)
        const bare = (src.match(new RegExp(`(?:^|[^\\w$.])${n}\\(\\s*'[\\w-]+'`, 'g')) || []).length
        unresolvedAliases.push({ name: n, factory, bare })
      }
      continue
    }
    const names = plain ? [plain]
      : [...String(destructured).matchAll(/\bt\s*:\s*([A-Za-z_$][\w$]*)|(?:^|,)\s*(t)\s*(?=,|$)/g)].map((x) => x[1] || x[2]).filter(Boolean)
    for (const n of names) {
      if (ns) {
        // qualify() prefixes a BARE key and leaves an already-qualified one alone, so ONE name is
        // both shapes: prefixed for t('map_title'), full-key for t('connectivity.map_title'). The
        // two patterns below are disjoint — one demands a dot, the other forbids it — so
        // registering the name twice double-counts nothing.
        prefixed.set(n, [...new Set([...(prefixed.get(n) || []), ns])])
        full.add(n)
      } else {
        // ★ AN EMPTY NAMESPACE PLUS A BARE KEY WOULD BE OUTSIDE THIS GATE'S MODEL, so it is counted
        // rather than assumed away. useOptionalT('') leaves the key alone, so t('approx') would ask
        // for a TOP-LEVEL key, while the catalogue is indexed area-first ("aria.foo") the way
        // tStatic walks it — unfindable here either way. MEASURED at zero: all five empty-namespace
        // sites (poster-wall, upg-100-mfe, resources-map, ApproxPinNote, FilterDropdown) pass FULLY
        // DOTTED keys, so every one of them is checked by the full-key pass above and nothing is
        // being waved through. The counter stays because the shape is writable, and the day someone
        // writes it this prints a stated limit instead of a clean result.
        full.add(n)
        fallbackOnly += (src.match(new RegExp(`(?:^|[^\\w$.])${n}\\(\\s*'[\\w-]+'`, 'g')) || []).length
      }
    }
  }
  return { full, prefixed }
}

// ── ★ SELF-TEST, BECAUSE THIS GATE ALREADY PASSED A PLANTED POISON KEY ────────────────────────
// a poison key `T('poison_key')` was planted behind `const T = useGiT()` and this gate reported the tree
// clean. That is the failure a check cannot be forgiven for: a red gate gets fixed, a green one that
// should be red gets BELIEVED, and this one guards goal (d). Measured before and after, with the
// same poison on disk: the version on main PASSES it, this version FAILS it as
// `neighbor.zzz_not_a_real_key (via nt())`. Coverage went 683 -> 743 full-key and 49 -> 56 prefixed
// call sites, so 67 sites that were being scored as clean were simply not being read.
//
// The three things asserted are the three that were independently broken; any one of them alone
// hid the key, so testing them together would not have told me which was fixed.
{
  const FIXTURE_FACTORY = "export function useGiT() {\n  return useOptionalT('gospelInternet')\n}"
  const FIXTURE_SITE = "const T = useGiT()\nconst a = T('poison_key')\nconst b = T('gospelInternet.qualified_key')"
  // Registered in the REAL map, because aliasesIn() resolves a factory's namespace through it — a
  // copy would have the self-test exercise a lookup the scan does not use.
  const probe = factoriesIn(FIXTURE_FACTORY, FACTORY_NS)
  const saved = FACTORIES
  FACTORIES = [...probe.keys()].join('|')
  const fails = []
  // 1. the factory's namespace is READ from its one-line body, not guessed.
  if (probe.get('useGiT') !== 'gospelInternet') fails.push('a useXxxT() factory\'s namespace is not read from its body')
  // 2. a file whose ONLY translator comes from a composable is not skipped before anything runs.
  if (!seesFile(FIXTURE_SITE)) fails.push('a file with no tStatic but a composable translator is still skipped')
  // 3. the binding becomes BOTH shapes, because qualify() prefixes a bare key and leaves a
  //    qualified one alone — bare-only would miss T('poison_key'), full-only would miss nothing
  //    visible and is exactly how this passed before.
  const al = aliasesIn(FIXTURE_SITE)
  if (!(al.prefixed.get('T') || []).includes('gospelInternet')) fails.push('a composable-bound alias is not registered as PREFIXED')
  if (!al.full.has('T')) fails.push('a composable-bound alias is not also registered as FULL-key')
  FACTORIES = saved
  FACTORY_NS.delete('useGiT')      // the fixture's factory is not part of this tree
  if (fails.length) {
    console.error(`${TAG}: SELF-TEST FAILED — ${fails.join('; ')}.`)
    console.error('  This gate cannot be trusted while blind to a composable-bound translator: that is how a planted key passed.')
    process.exit(3)
  }
}

// ── ★ ROUND THREE: THE FACTORY STOPPED BEING A ONE-LINER, AND THE GATE STOPPED SEEING THE BUNDLE ──
// The fixture above pins `export function useGiT() { return useOptionalT('gospelInternet') }`. Real
// useGiT is no longer that: it became a WRAPPER — `const t = useOptionalT()` and a returned arrow that
// adds an English-fallback argument. Ordinary refactoring, and it moved the whole bundle outside this
// gate, because factoriesIn() demanded the one-line shape, so useGiT was not a factory, `const T =
// useGiT()` was not an alias, and every T('…') was not a call site. Two poison keys were planted in
// gospel-internet and reported nothing, three rounds running.
//
// Both poisons are pinned HERE rather than left in gospel's tree, so the proof does not depend on
// another agent keeping deliberately-broken code on main, and so this gate fails on its own evidence.
// MEASURED on the tree those poisons were planted in: before, 1 missing key; after, 15 — the 2 poisons
// plus the 12 real keys of gospel's new panels that had been missing in all eleven locales, unseen.
{
  const WRAPPER = "export function useGiT() {\n  const t = useOptionalT()\n  return (key, en, params) => t(key, params)\n}"
  const SITE = "const T = useGiT()\nconst a = T('gospelInternet.zzz_poison_not_a_real_key')\nconst b = T('gospelInternet.zzz_board_poison')\nconst c = T('bare_key_it_cannot_qualify')"
  const probe = factoriesIn(WRAPPER, FACTORY_NS)
  const saved = FACTORIES
  FACTORIES = [...probe.keys()].join('|')
  const mark = unresolvedAliases.length
  const fails = []
  // 1. a wrapper factory is DISCOVERED at all — this is the one that regressed.
  if (!probe.has('useGiT')) fails.push('a factory that WRAPS useOptionalT() instead of returning it is not discovered')
  // 2. and discovered as UNRESOLVED, not invented: the call states no namespace, so none is guessed.
  if (probe.get('useGiT') !== null) fails.push('a namespace was guessed for a factory that states none')
  const al = aliasesIn(SITE)
  // 3. its binding is still registered for the FULL-KEY pass, which is what makes a fully dotted
  //    poison catchable even though the namespace is unknown.
  if (!al.full.has('T')) fails.push('an unresolved translator binding is dropped, so its dotted keys are checked by nothing')
  // 4. and the bare call it genuinely cannot qualify is RECORDED rather than skipped in silence.
  const rec = unresolvedAliases.slice(mark)
  if (!rec.some((u) => u.name === 'T' && u.bare > 0)) fails.push('a bare key behind an unresolved translator is not counted, so the gate would pass over it')
  unresolvedAliases.length = mark   // the fixture's findings are not this tree's
  FACTORIES = saved
  FACTORY_NS.delete('useGiT')
  if (fails.length) {
    console.error(`${TAG}: SELF-TEST FAILED — ${fails.join('; ')}.`)
    console.error('  A translator this gate cannot resolve must be REPORTED, never skipped: skipping is what made a whole')
    console.error('  bundle invisible three times while the gate printed PASS.')
    process.exit(3)
  }
}

const missing = new Map()   // key -> { sites: [], via: Set }
let literalCount = 0, prefixedCount = 0, dynamicCount = 0
const lineAt = (src, i) => src.slice(0, i).split('\n').length
const record = (key, site, via) => {
  if (!missing.has(key)) missing.set(key, { sites: [], via: new Set() })
  const e = missing.get(key); e.sites.push(site); e.via.add(via)
}

// ★ A BUNDLE WITH NO CALL SITES SCORES PERFECTLY HERE, AND THAT IS NOT THE SAME AS CLEAN.
// This gate asks whether the keys a bundle NAMES exist. A bundle that names none — upg-neighbor and
// wall-of-people-groups have no t() anywhere, per the universal-props matrix — has nothing to be
// missing and passes in silence. Reporting only the misses would let "0 missing keys" be read as
// "fully localized", which is the opposite of true for exactly those bundles. So participation is
// counted and printed alongside, and the two are never merged into one number.
const callSites = new Map()   // bundle -> count
for (const f of files) {
  const src = readFile(f)
  // seesFile()'s last clause is not decoration: a file whose only translator comes from a composable
  // never writes the word tStatic, and skipping it here is how the poison key got past everything
  // below. The self-test above drives this exact predicate for that reason.
  if (!seesFile(src)) continue
  const { full, prefixed } = aliasesIn(src)
  const names = [...full, ...prefixed.keys()].map((n) => n.replace('$', '\\$')).join('|')
  if (!names) continue

  // FULL dotted key.
  for (const m of src.matchAll(new RegExp(`(?:^|[^\\w$.])(?:${names})\\(\\s*'([A-Za-z_][\\w]*(?:\\.[\\w-]+)+)'`, 'g'))) {
    const key = m[1]
    literalCount++
    if (KEYS.has(key)) continue
    // Only keys whose AREA is a real catalogue file are this gate's business: `props.t.total`,
    // `config.map.provider` and friends are not i18n keys and must not be reported as missing.
    if (!AREAS.has(key.split('.')[0])) continue
    record(key, `${f}:${lineAt(src, m.index)}`, 'literal')
  }
  // BARE key through a prefix helper.
  for (const [name, prefixes] of prefixed) {
    // ★ AN EMPTY ENGLISH FALLBACK IS A DELIBERATE FALLTHROUGH, NOT A MISSING KEY.
    // BpResearchHeader renders `L('reset_all', '') || tStatic('controls.reset_all') || 'Reset'`:
    // the author is saying "if this prefix has nothing, fall to the next rung", and controls.reset_all
    // does hold it. A first run of the prefix resolution reported that as a defect — a gate inventing
    // a problem out of a working ladder, which is the exact failure I am about to mail seven owners
    // about. `,''` is the author's own signal that the miss is intended.
    for (const m of src.matchAll(new RegExp(`(?:^|[^\\w$.])${name}\\(\\s*'([\\w-]+)'\\s*(,\\s*''\\s*\\))?`, 'g'))) {
      const bare = m[1]
      if (m[2]) continue
      prefixedCount++
      if (prefixes.some((p) => KEYS.has(p + '.' + bare))) continue
      record(prefixes.map((p) => p + '.' + bare).join(' | '), `${f}:${lineAt(src, m.index)}`, `${name}()`)
    }
  }
  // Genuinely DYNAMIC: a concatenation or a template literal as the first argument.
  for (const _ of src.matchAll(new RegExp(`(?:^|[^\\w$.])(?:${names})\\(\\s*(?:'[^']*'\\s*\\+|\`)`, 'g'))) dynamicCount++
  const b = f.startsWith('plugin-designs/') ? f.split('/')[1] : 'library'
  const n = (src.match(new RegExp(`(?:^|[^\\w$.])(?:${names})\\(`, 'g')) || []).length
  callSites.set(b, (callSites.get(b) || 0) + n)
}

const bundleOf = (site) => {
  const p = site.split(':')[0]
  if (p.startsWith('plugin-designs/')) return p.split('/')[1]
  return 'library'
}

console.log(`  · tree: ${describeTree}`)
console.log(`  · ${KEYS.size} English keys across ${catalogues.length} catalogue(s); ${literalCount} full-key and ${prefixedCount} prefixed call site(s) in ${files.length} file(s)`)
if (dynamicCount) {
  console.log(`  · ${dynamicCount} DYNAMIC key expression(s) not checked — this gate will not invent the key set a runtime expression might produce.`)
}
if (fallbackOnly) {
  console.log(`  · ${fallbackOnly} bare-key call site(s) behind useOptionalT('') are OUTSIDE this model and not checked: an empty namespace leaves the key`)
  console.log(`    unqualified, while the catalogue is indexed area-first the way tStatic walks it. Those sites pass their own literal fallback MAP`)
  console.log(`    rather than the catalogue, by the decision recorded in library/composables/useOptionalT.js — a limit, not a clean result.`)
}
{
  const bundles = listFiles((p) => /^plugin-designs\/[^/]+\//.test(p)).map((p) => p.split('/')[1])
  const silent = [...new Set(bundles)].filter((b) => !callSites.get(b)).sort()
  if (silent.length) {
    console.log(`  · ${silent.length} bundle(s) name NO catalogue key at all, so they cannot fail this gate and their pass means nothing: ${silent.join(', ')}`)
  }
}

// ── ★ A TRANSLATOR THIS GATE COULD NOT RESOLVE IS A FINDING, NOT A SKIP ────────────────────────
// Three rounds of gospel-internet being invisible all ended here. The namespace was unreadable, the
// binding was dropped, and the bundle passed because nothing was looked at — which reads identically
// to a bundle with no problems. Fully dotted keys behind such an alias ARE still checked above; what
// cannot be checked is a BARE key, because there is no namespace to qualify it with. That count is
// the failure: it is the number of strings this gate is silently not looking at.
let unresolvedFail = 0
if (unresolvedAliases.length) {
  const byName = new Map()
  for (const u of unresolvedAliases) {
    const k = `${u.name}() <- ${u.factory}()`
    byName.set(k, (byName.get(k) || 0) + u.bare)
  }
  unresolvedFail = [...byName.values()].reduce((a, b) => a + b, 0)
  console.log(`  · ${byName.size} translator binding(s) whose NAMESPACE could not be read — the factory was called with no`)
  console.log(`    string literal, so a bare key behind them cannot be qualified. Fully dotted keys ARE checked; bare ones are not:`)
  for (const [k, bare] of [...byName].sort()) {
    console.log(`      ${k}  —  ${bare} bare-key call site(s) unchecked`)
  }
  if (unresolvedFail) {
    console.log('    Give the factory a namespace it states literally (useOptionalT(\'area\')), or pass fully dotted keys at every')
    console.log('    call site. Until then those strings are outside every i18n gate in this repo.')
  }
}

if (missing.size) {
  if (BY_BUNDLE) {
    const byBundle = new Map()
    for (const [key, e] of missing) for (const s of e.sites) {
      const b = bundleOf(s)
      if (!byBundle.has(b)) byBundle.set(b, new Map())
      if (!byBundle.get(b).has(key)) byBundle.get(b).set(key, [])
      byBundle.get(b).get(key).push(s)
    }
    console.error('')
    for (const [b, keys] of [...byBundle].sort((a, c) => c[1].size - a[1].size)) {
      console.error(`── ${b} — ${keys.size} missing key(s)`)
      for (const [key, sites] of [...keys].sort()) console.error(`   ${key}\n       ${sites.join('\n       ')}`)
    }
  }
  console.error(`\n${TAG}: FAIL — ${missing.size} key(s) are named in code and exist in NO catalogue, so every locale renders the English fallback:`)
  if (!BY_BUNDLE) for (const [key, e] of [...missing].sort()) {
    console.error(`  ✗ ${key}${e.via.has('literal') ? '' : '   (via ' + [...e.via].join(', ') + ')'}`)
    for (const s of e.sites.slice(0, 4)) console.error(`      ${s}`)
    if (e.sites.length > 4) console.error(`      … and ${e.sites.length - 4} more`)
  }
  console.error('\n  The call sites are RIGHT; the catalogue never caught up. Add the key to')
  console.error('  library/i18n/locales/*/<area>.json in all eleven locales, keeping the English')
  console.error('  wording exactly as the fallback reads it — translating existing wording is not a')
  console.error('  product decision, but changing it is.')
  process.exit(1)
}
if (unresolvedFail) {
  console.error(`\n${TAG}: FAIL — ${unresolvedFail} bare-key call site(s) sit behind a translator whose namespace this gate could`)
  console.error('  not read, so they are checked by nothing. A pass that excludes them is not a pass: it is the same silence')
  console.error('  that let two planted poison keys through three times. See the binding(s) listed above.')
  process.exit(1)
}
console.log(`${TAG}: PASS — every catalogue key named in code exists in English.`)
