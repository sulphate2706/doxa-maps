#!/usr/bin/env node
/**
 * check-url-resolver.mjs — every cap-5 shell's resolve() must handle ROOTED refs and single-slash joins.
 *
 * THE OUTAGE THIS PREVENTS (measured 2026-09-22). Introducing `tree-base` so the dev server could tell
 * the studio where its manifest lives 404'd EVERY ONE of the studio's 29 tabs:
 *     404 /__plugin-gallery//plugin-designs/big-picture/index.js
 *                          ^^ a base concatenated onto an ALREADY-ROOTED path
 * Every tab read "Could not load <plugin>", which looks like 29 broken plugins rather than one broken
 * string join. It read as none of the plugins working.
 *
 * ★ WHY NO EXISTING GATE COULD HAVE CAUGHT IT — this is the reason this file exists rather than a test
 * inside the build. The BUILT manifest hands RELATIVE refs ("./big-picture/big-picture.js"), so
 * concatenation is correct there and the latent assumption is never exercised. The DEV manifest hands
 * ROOTED ones ("/plugin-designs/big-picture/index.js"). So the defect lives ONLY in the dev surface,
 * and the entire build-time gate suite passes green while every developer's studio is broken. A product
 * that must work on ten laptops cannot be verified by the build alone.
 *
 * ★ THE DUPLICATE-IMPLEMENTATION MULTIPLIER. plugin-studio.vue and doxa-maps-spa.vue carried BYTE-
 * IDENTICAL resolve() implementations, so one latent assumption produced TWO independent outages that
 * had to be diagnosed separately — the second only surfaced because three 404s refused to disappear
 * after the "fix". This gate therefore checks EVERY shell that defines a resolve(), not a named list:
 * a third shell copied from either of them is caught on its first run.
 *
 * WHAT IT ASSERTS, per shell:
 *   1. an already-rooted ref ("/x/y.js") is returned UNCHANGED (no base prefix);
 *   2. a scheme-relative or absolute URL ("//cdn/x", "https://cdn/x") is returned UNCHANGED;
 *   3. a relative ref joins through EXACTLY ONE slash even when the base has a trailing one;
 *   4. the relative fallback (no base) still works, so the built tree is unaffected.
 *
 * NEGATIVE-TESTED: reverting either shell's resolve() to the old
 *     if (this.base) return this.base + r
 * makes assertions 1 and 3 FAIL naming the file. A run that finds FEWER than MIN_SHELLS resolvers
 * FAILS rather than passing vacuously — "0 shells checked" must never read as "0 problems".
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve as pathResolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGNS = join(ROOT, 'plugin-designs')

// A shell is any .vue that defines a resolve(ref) method — discovered, never hard-coded, so a NEW
// shell copied from an existing one is covered the day it lands.
function findResolvers(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) findResolvers(p, out)
    else if (e.name.endsWith('.vue')) {
      const src = readFileSync(p, 'utf8')
      if (/\n\s*resolve\s*\(\s*ref\s*\)\s*\{/.test(src)) out.push({ file: p, src })
    }
  }
  return out
}

const shells = findResolvers(DESIGNS)
const MIN_SHELLS = 2
if (shells.length < MIN_SHELLS) {
  console.error(`URL-RESOLVER: FAIL — found only ${shells.length} resolve(ref) implementation(s), expected >= ${MIN_SHELLS}.`)
  console.error('  The scan is broken or a shell was renamed. Refusing to pass vacuously.')
  process.exit(1)
}

// Extract the resolve() body and evaluate it against a stubbed `this`, so the ACTUAL shipped code is
// tested rather than a re-implementation of it. Re-implementing the rule in the gate is how a gate
// ends up agreeing with itself while the product disagrees.
function extractResolve(src) {
  const start = src.search(/\n\s*resolve\s*\(\s*ref\s*\)\s*\{/)
  if (start < 0) return null
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  return null
}

const CASES = [
  { name: 'rooted ref is untouched',        base: '/__plugin-gallery/', ref: '/plugin-designs/x/index.js', want: '/plugin-designs/x/index.js' },
  { name: 'rooted leaf is untouched',       base: '/__plugin-gallery/', ref: '/__leaf/a/b',                 want: '/__leaf/a/b' },
  { name: 'absolute URL is untouched',      base: '/__plugin-gallery/', ref: 'https://cdn.example/x.js',    want: 'https://cdn.example/x.js' },
  { name: 'scheme-relative is untouched',   base: '/__plugin-gallery/', ref: '//cdn.example/x.js',          want: '//cdn.example/x.js' },
  { name: 'single slash join (base has /)', base: '/__plugin-gallery/', ref: 'manifest.json',               want: '/__plugin-gallery/manifest.json' },
  { name: 'single slash join (no trailing)',base: '/__plugin-gallery',  ref: 'manifest.json',               want: '/__plugin-gallery/manifest.json' },
  { name: 'dot-slash is stripped',          base: '/__plugin-gallery/', ref: './a/b.js',                    want: '/__plugin-gallery/a/b.js' },
  { name: 'no base keeps relative fallback',base: '',                   ref: 'a/b.js',                      want: '../a/b.js' },
]

let failed = 0
for (const shell of shells) {
  const rel = shell.file.replace(ROOT + '/', '')
  const body = extractResolve(shell.src)
  if (!body) { console.error(`  ✗ ${rel}: resolve(ref) found but its body could not be extracted`); failed++; continue }

  let fn
  try { fn = new Function('ref', `const self=this; ${body}`) }
  catch (e) { console.error(`  ✗ ${rel}: resolve() body does not parse — ${e.message}`); failed++; continue }

  const bad = []
  for (const c of CASES) {
    let got
    try { got = fn.call({ base: c.base }, c.ref) } catch (e) { got = 'THREW: ' + e.message }
    if (got !== c.want) bad.push(`${c.name}\n        ref=${JSON.stringify(c.ref)} base=${JSON.stringify(c.base)}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(c.want)}`)
  }
  if (bad.length) {
    console.error(`  ✗ ${rel} — ${bad.length}/${CASES.length} case(s) wrong:`)
    for (const b of bad) console.error('      ' + b)
    failed++
  } else {
    console.log(`  ✓ ${rel} — ${CASES.length}/${CASES.length}`)
  }
}

console.log(`URL-RESOLVER: ${shells.length} shell resolver(s) checked.`)

if (failed) {
  console.error(`\nURL-RESOLVER: FAIL — ${failed} shell(s) mishandle a URL they will actually be given.`)
  console.error(
    '\n  A base prefix must NEVER be applied to an already-rooted ref: a URL anchored at the root needs\n' +
    '  no base by definition. The built manifest hands RELATIVE refs and the dev manifest hands ROOTED\n' +
    '  ones, so a resolver that only concatenates looks correct for as long as nobody runs the dev\n' +
    '  server — and then 404s every tab at once. Required shape:\n' +
    '      if (/^(https?:)?\\/\\//.test(raw) || raw.startsWith("/")) return raw\n' +
    '      if (this.base) return this.base.replace(/\\/+$/, "") + "/" + r\n' +
    '  See AP-a-base-prefix-must-never-be-applied-to-an-already-rooted-url.'
  )
  process.exit(1)
}

console.log('URL-RESOLVER: PASS — every cap-5 shell handles rooted refs and joins through one slash.')
console.log('  This is the DEV-surface defect class the build-time gates structurally cannot see: the')
console.log('  built manifest hands relative refs, so concatenation is correct there and the bug hides.')
