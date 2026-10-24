#!/usr/bin/env node
/**
 * check-no-silent-engine-substitution — a profile must never fall back to a DIFFERENT map engine than
 * the one its provider asked for.
 *
 * THE DEFECT, found by the C3 review (2026-09-26):
 *
 *     const gl = engineGlobal(provider) || window.mapboxgl
 *
 * That `||` looks like ordinary defensive coding and is not. engineGlobal() ALREADY resolves mapbox's own
 * global for the mapbox case — useMapInstance.js:115 is
 * `ENGINES[provider]?.global || ENGINES.mapbox.global`, which falls back to mapbox's NAME only for an
 * UNKNOWN provider name, never for a missing engine. So the expression can fire in exactly ONE situation:
 * the page asked for 'maplibre' and MapLibre failed to load. It then hands back MAPBOX — the token-gated
 * engine — to a page that explicitly asked for the keyless one, breaking the keyless contract
 * research-map.instances.json documents.
 *
 * ★ AND THE SUBSTITUTE IS BROKEN BY CONSTRUCTION, which is what makes this worth a gate rather than a
 * one-line fix. These profiles gate `gl.accessToken = token` on `if (!isMaplibre)`, so a maplibre request
 * that fell through to Mapbox got Mapbox WITHOUT a token: 401s on every tile instead of a legible failure.
 * A fallback that cannot produce a working map even in principle is strictly worse than no fallback,
 * because it converts a diagnosable error into a mysterious one.
 *
 * ⚠ WHY THE THREE EXISTING ENGINE GATES DID NOT CATCH IT, and why this is not a duplicate of them:
 *   check-leaf-engine-per-provider  — a leaf loads the engine its provider asks for
 *   check-provider-switch          — the page-level switch reaches a raw-built map
 *   check-auto-engine              — 'auto' resolves to Mapbox with a token, MapLibre without
 * All three assert the HAPPY PATH: what happens when engines load. This bug only appears when one does
 * NOT load, so all three were green for as long as it existed. The property here is the negative one —
 * "when the requested engine is absent, no other engine is substituted" — and nothing asserted it.
 *
 * ⚠ IT IS A SOURCE CHECK, ON PURPOSE. Reproducing it at the rendered layer means serving a leaf with
 * MapLibre deliberately blocked, which is a browser run for a defect whose whole signature is one
 * expression. The source is the authoritative place: the fallback either appears in the file or it does
 * not. A browser gate here would cost a slot to measure something a grep decides.
 *
 * Usage: node internal/check-no-silent-engine-substitution.mjs
 *        node internal/check-no-silent-engine-substitution.mjs --self-test
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const ROOT = join(REPO, 'plugin-designs')

// ⚠ FLAGS FILTERED FROM THE POSITIONAL READ. A bare `--self-test` was otherwise taken as a path, which
// has bitten this repo three times (--self-test read as a leaf, --emit read as a baseUrl, --poison read
// as a packet).
const SELF_TEST = process.argv.includes('--self-test')

// The substitution to refuse: engineGlobal(...) OR-ed with a specific engine's global. Any of these
// named globals on the right of a `||` after engineGlobal is a cross-engine fallback by definition —
// engineGlobal already returns the RIGHT global for the requested provider, so the only thing an `||`
// can add is a DIFFERENT engine.
const ENGINE_GLOBALS = ['mapboxgl', 'maplibregl']
const PATTERN = new RegExp(
  String.raw`engineGlobal\s*\([^)]*\)\s*\|\|\s*(?:window\.)?(${ENGINE_GLOBALS.join('|')})\b`,
  'g',
)

function scan(text) {
  const hits = []
  const lines = text.split('\n')
  // ⚠ BLOCK-COMMENT STATE, not a per-line prefix test. The first version asked only whether a line
  // STARTS with //, * or /*, and that is not what a comment is: it misses every CONTINUATION line of a
  // /* … */ block whose text happens to begin with something else.
  //
  // IT COST A FALSE ACCUSATION, 2026-09-27, and the accusation was aimed at the correct fix. gospel
  // fixed this defect in resources-map.vue — `const gl = engineGlobal(grProvider)`, no `||` — and
  // documented what they removed in a /* */ block whose second line begins with a BACKTICK:
  //       `engineGlobal(grProvider) || window.mapboxgl`. engineGlobal already defaults to mapbox, so
  // The prefix test saw no comment marker, matched the quoted pattern, and reported gospel as the last
  // remaining offender at main 9df086e5. That was relayed as fact and it was wrong: the
  // line number had also moved three times (1490 -> 1505 -> 1509) purely because their file grew, which
  // is what made a stale card look like a live defect.
  // ★ A GATE THAT FAILS ON THE EXPLANATION OF A FIX IS WORSE THAN NO GATE. It tells the one person who
  // did the right thing that they did the wrong thing, and the cheapest way to make it green is to
  // DELETE the explanation — so the gate actively destroys the reasoning it should protect. This file's
  // own header quotes the pattern for the same reason, which is why the skip existed at all; it was
  // just too shallow to cover the form another agent actually used.
  let inBlock = false
  lines.forEach((line, i) => {
    const t = line.trim()
    const wasInBlock = inBlock
    // Track /* and */ on this line so the NEXT line knows where it stands. Deliberately simple: a
    // block marker inside a string literal would fool it, and the alternative is a JS parser for a
    // one-expression grep. The failure mode of over-skipping is a missed offender, which the
    // --self-test guards against by keeping real forms in the MUST-MATCH list.
    const opens = (line.match(/\/\*/g) || []).length
    const closes = (line.match(/\*\//g) || []).length
    if (opens > closes) inBlock = true
    else if (closes > opens) inBlock = false
    if (wasInBlock || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    PATTERN.lastIndex = 0
    let m
    while ((m = PATTERN.exec(line)) !== null) hits.push({ line: i + 1, engine: m[1], text: t.slice(0, 110) })
  })
  return hits
}

if (SELF_TEST) {
  // ★ PROVE THE PATTERN FIRES BEFORE TRUSTING A GREEN RUN. A source gate that has never matched anything
  // is indistinguishable from a broken regex, and this one's whole value is that it matches.
  const should = [
    'const gl = engineGlobal(upgProvider) || window.mapboxgl',
    '  const gl = engineGlobal(p)||maplibregl',
    'let gl = engineGlobal( provider ) || window.maplibregl;',
  ]
  const shouldNot = [
    'const gl = engineGlobal(upgProvider)',
    '// const gl = engineGlobal(p) || window.mapboxgl  <- the removed fallback',
    'const gl = engineGlobal(p) || null',
    'const token = mapboxToken?.value || profileConfig?.value?.tk || \'\'',
  ]
  // ★ MULTI-LINE CASES, because the single-line list above cannot express the bug that actually
  // happened: a CONTINUATION line of a /* */ block. Each entry is scanned as one text so the
  // block-comment state machine is what is under test, not the prefix check.
  const shouldNotMultiline = [
    // gospel's real fix at resources-map.vue, verbatim in shape — the line that was falsely accused
    // begins with a BACKTICK, so no prefix test could ever have skipped it.
    [`  /* ⚠ NEVER SWITCH ENGINES SILENTLY. This used to read
     \`engineGlobal(grProvider) || window.mapboxgl\`. engineGlobal already defaults to mapbox, so
     the fallback could only ever fire for provider 'maplibre'. */
  const gl = engineGlobal(grProvider)`, 'a /* */ block quoting the removed fallback, then the correct fix'],
    // and the inverse: a real offender AFTER a block comment closes must still be caught, or the fix
    // above would have traded a false positive for a false negative.
    [`  /* explanation that mentions engineGlobal(p) || window.mapboxgl and then ends */
  const gl = engineGlobal(p) || window.mapboxgl`, null],
  ]
  let bad = 0
  for (const s of should) {
    const n = scan(s).length
    console.log(`  ${n ? 'MATCHED ' : 'MISSED  '} ${s.trim().slice(0, 62)}`)
    if (!n) bad++
  }
  for (const s of shouldNot) {
    const n = scan(s).length
    console.log(`  ${n ? 'FALSE+  ' : 'ignored '} ${s.trim().slice(0, 62)}`)
    if (n) bad++
  }
  // The multi-line pairs: a label means "must be IGNORED and here is why", null means "must MATCH".
  // Both directions are asserted together on purpose — fixing the false positive by skipping more is
  // only correct if a real offender after the block still fails.
  for (const [text, why] of shouldNotMultiline) {
    const n = scan(text).length
    const wantHit = why === null
    const ok = wantHit ? n > 0 : n === 0
    if (!ok) bad++
    console.log(`  ${ok ? (wantHit ? 'MATCHED ' : 'ignored ') : (wantHit ? 'MISSED  ' : 'FALSE+  ')} `
      + `[multi-line] ${wantHit ? 'a real offender AFTER a closed block comment' : why}`)
  }
  if (bad) {
    console.error(`\nNO-SILENT-ENGINE-SUBSTITUTION --self-test: FAIL — ${bad} case(s) wrong.`)
    process.exit(1)
  }
  console.log('\nNO-SILENT-ENGINE-SUBSTITUTION --self-test: PASS — the pattern matches every real form '
    + 'and ignores comments, a null fallback and an unrelated token chain.')
  process.exit(0)
}

if (!existsSync(ROOT)) {
  console.log(`NO-SILENT-ENGINE-SUBSTITUTION: NOT MEASURED — no plugin-designs tree at ${ROOT}`)
  process.exit(75)
}

const findings = []
let scanned = 0
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      walk(p)
    } else if (/\.(vue|js|mjs)$/.test(e.name)) {
      let text
      try { text = readFileSync(p, 'utf8') } catch { continue }
      if (!text.includes('engineGlobal')) continue
      scanned++
      for (const h of scan(text)) findings.push({ file: p.slice(REPO.length + 1), ...h })
    }
  }
}
walk(ROOT)

console.log('NO-SILENT-ENGINE-SUBSTITUTION')
console.log(`  ${scanned} file(s) call engineGlobal()`)

// ⚠ REFUSE TO JUDGE rather than pass vacuously. If nothing in the tree calls engineGlobal at all, the
// pattern had nothing to match and a green result would mean "I found no files", not "the code is clean".
if (!scanned) {
  console.log('NO-SILENT-ENGINE-SUBSTITUTION: NOT MEASURED — no file calls engineGlobal(), so there was '
    + 'nothing to check. Exit 75 rather than 0: "found nothing" is not "found nothing wrong".')
  process.exit(75)
}

if (findings.length) {
  console.error(`\nNO-SILENT-ENGINE-SUBSTITUTION: FAIL — ${findings.length} silent engine substitution(s).`)
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}  falls back to ${f.engine}`)
    console.error(`      ${f.text}`)
  }
  console.error('\n  engineGlobal() ALREADY returns the right global for the requested provider, so an `||`')
  console.error('  after it can only supply a DIFFERENT engine — and it fires only when the page asked for')
  console.error('  maplibre and maplibre failed to load. A page that asked for the KEYLESS engine then')
  console.error('  receives the TOKEN-GATED one, and because accessToken is gated on !isMaplibre it')
  console.error('  receives it WITHOUT a token: 401s instead of a legible error.')
  console.error('\n  FIX: delete the fallback. Keep the requested engine, and let the profile\'s existing')
  console.error('  !gl branch fail visibly — console.warn plus the map\'s error/empty state, never a blank,')
  console.error('  and never another engine. Name the engine in the message so a partner can tell an')
  console.error('  honoured request from a silent downgrade.')
  process.exit(1)
}
console.log('NO-SILENT-ENGINE-SUBSTITUTION: PASS — every engineGlobal() call keeps the engine its provider '
  + 'asked for.')
