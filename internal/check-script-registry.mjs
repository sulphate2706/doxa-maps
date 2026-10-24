#!/usr/bin/env node
/**
 * check-script-registry — one bundle script executes ONCE PER PAGE, not once per bundle that asks.
 *
 * WHY THIS TEST EXISTS AND WHY IT IS SHAPED LIKE THIS. Every plugin ships as a self-contained IIFE,
 * so library/utils/embedScript.js is compiled separately into each one: eleven bundles on
 * origin/main each carry their own copy. A module-scoped cache in that file is therefore one cache
 * PER BUNDLE, and two shells on one page each loaded the same child — fetched from the HTTP cache,
 * so no failed request and no extra network row, then the whole bundle EXECUTED a second time and
 * its guarded `customElements.define` quietly declined. Nothing threw. Nothing warned.
 *
 * The test reproduces the packaging rather than describing it: it imports the module TWICE under
 * two different URLs, which in ESM yields two independent module instances sharing one globalThis —
 * structurally the same thing as two IIFEs on one page.
 *
 * ★ THERE ARE TWO LAYERS AND THIS FILE TESTS THEM SEPARATELY, BECAUSE MUTATION-TESTING SHOWED THEY
 * MASK EACH OTHER. Reverting the page registry to module scope did NOT change the number of
 * <script> tags: the second bundle still found the first one's tag in the DOM and adopted it. So
 * "one tag on the page" is evidence for the DOM layer, not for the registry, and asserting only
 * that would have let the original bug back in wearing the fix's clothes. The registry is asserted
 * by PROMISE IDENTITY instead — the second caller must receive the very promise the first is
 * waiting on, which nothing but a page-scoped cache can hand it, and which is the difference
 * between the second shell waiting for the real load and merely assuming it happened.
 *
 * Headless, no network, no browser: the DOM is a stub small enough to read, and it models the one
 * browser behaviour the code depends on — assigning a relative `src` and reading back an absolute
 * one. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_URL = pathToFileURL(resolve(ROOT, 'library/utils/embedScript.js')).href
const REGISTRY_KEY = '__dxMapsScriptRegistry1'
const BASE = 'https://host.example/page/'

const fails = []
const ok = (what, cond) => { if (!cond) fails.push(what) }
const eq = (what, got, want) => { if (got !== want) fails.push(`${what}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }

// ── the DOM stub ──────────────────────────────────────────────────────────────
let appended, planted, failNext, warnings
function makeScript() {
  const o = { _src: '', type: '', onload: null, onerror: null, setAttribute(k, v) { o[k] = v } }
  // A real <script> resolves a relative src against the document on assignment and reads back
  // absolute. existingScriptFor() compares against that absolute form, so the stub must too —
  // otherwise this test would pass while the browser found nothing.
  Object.defineProperty(o, 'src', { get: () => o._src, set: (v) => { o._src = new URL(v, BASE).href } })
  return o
}
function resetDom() {
  appended = []; planted = []; failNext = false; warnings = []
  globalThis.document = {
    baseURI: BASE,
    createElement: () => makeScript(),
    querySelectorAll: () => planted.concat(appended),
    head: {
      appendChild(s) {
        appended.push(s)
        queueMicrotask(() => { if (failNext) { failNext = false; s.onerror && s.onerror() } else s.onload && s.onload() } )
      },
    },
  }
  globalThis.console = { ...console, warn: (m) => warnings.push(String(m)) }
}
function resetPage() { delete globalThis[REGISTRY_KEY]; resetDom() }

// Two module instances = two bundles on one page.
resetPage()
const A = await import(MODULE_URL + '?bundle=doxa-maps-spa')
const B = await import(MODULE_URL + '?bundle=plugin-studio')
ok('the two imports really are separate module instances', A !== B && A.loadScriptOnce !== B.loadScriptOnce)

const CHILD = '/dx-maps/doxa-research-map/doxa-research-map.js'

// 1. THE BUG: the second bundle must not execute the child again.
resetPage()
await A.loadScriptOnce(CHILD)
eq('first bundle injects the child', appended.length, 1)
await B.loadScriptOnce(CHILD)
eq('SECOND BUNDLE REUSES IT — one <script> on the page, not two', appended.length, 1)

// 1b. …and it reused the FIRST BUNDLE'S PROMISE, which is the part only the page registry can do.
//     Same tick, no await between, so the DOM-adoption path cannot be what answers B.
resetPage()
const pA = A.loadScriptOnce(CHILD)
const pB = B.loadScriptOnce(CHILD)
ok('the second bundle waits on the first bundle\'s load, not its own guess', pA === pB)
await Promise.all([pA, pB])
eq('and still only one <script>', appended.length, 1)

// 2. the test can still see the old behaviour, so case 1 is not vacuous.
resetPage()
await A.loadScriptOnce(CHILD)
resetPage()                       // wipe the page registry AND the DOM: this is per-bundle caching
await B.loadScriptOnce(CHILD)
eq('with no shared page registry the second load DOES inject (what the bug looked like)', appended.length, 1)

// 3. the two shells do not pass the same string; the file is still one file.
resetPage()
await A.loadScriptOnce(CHILD)
await B.loadScriptOnce('https://host.example' + CHILD)
eq('relative and absolute spellings of one file share one entry', appended.length, 1)
resetPage()
await A.loadScriptOnce(CHILD)
await B.loadScriptOnce('/dx-maps/people-groups-grid/people-groups-grid.js')
eq('and a genuinely different bundle is NOT swallowed', appended.length, 2)

// 4. a tag from a bundle built before this registry, or written by the host page, is honoured.
resetPage()
const foreign = makeScript(); foreign.src = CHILD; planted.push(foreign)
await A.loadScriptOnce(CHILD)
eq('an existing <script> for the same file is adopted, not duplicated', appended.length, 0)

// 5. the dev-server ES-module rule (measured 2026-09-22) must survive the rewrite.
resetPage()
await A.loadScriptOnce('/plugin-designs/stack-demo/index.js')
eq('a dev entry is still type=module', appended.length === 1 && appended[0].type, 'module')
resetPage()
await A.loadScriptOnce(CHILD)
eq('a built IIFE is still a classic script', appended.length === 1 && appended[0].type, '')

// 6. an empty url stays a no-op (a <script src=""> refetches the page).
resetPage()
await A.loadScriptOnce('')
eq('empty url injects nothing', appended.length, 0)

// 7. a failed load must not poison the cache: a retry has to be able to try again.
resetPage()
failNext = true
let threw = false
await A.loadScriptOnce(CHILD).catch(() => { threw = true })
ok('a failed load rejects', threw)
planted = []; appended = []            // the failed tag is gone from the page
await A.loadScriptOnce(CHILD)
eq('and a retry injects again rather than resolving a dead promise', appended.length, 1)

// 8. SRI still reaches the element.
resetPage()
await A.loadScriptOnce(CHILD, { integrity: 'sha384-abc' })
eq('integrity is applied', appended.length === 1 && appended[0].integrity, 'sha384-abc')

// 9. claimTag: silent for the normal case, audible for the real collision.
resetPage()
A.claimTag('doxa-research-map', CHILD)
B.claimTag('doxa-research-map', CHILD)
eq('two shells nesting the SAME leaf is normal and silent', warnings.length, 0)
A.claimTag('people-groups-grid', '/dx-maps/people-groups-grid/people-groups-grid.js')
B.claimTag('people-groups-grid', '/dx-maps/big-picture/big-picture.js')
eq('two bundles shipping one tag warns once', warnings.length, 1)
ok('and the warning names both bundles', !!warnings[0] && warnings[0].includes('people-groups-grid.js') && warnings[0].includes('big-picture.js'))
A.claimTag('', CHILD); A.claimTag('x', '')
eq('a missing tag or url is ignored rather than recorded', warnings.length, 1)

// 10. the registry is shared across instances by identity, not by copy.
resetPage()
await A.loadScriptOnce(CHILD)
ok('both instances see one registry object', globalThis[REGISTRY_KEY] && Object.keys(globalThis[REGISTRY_KEY].loaded).length === 1)

if (fails.length) {
  console.error('SCRIPT-REGISTRY: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('SCRIPT-REGISTRY: PASS — two bundles on one page load a child once, different spellings of one file share an entry, a foreign <script> is adopted, the dev-module rule and SRI survive, a failed load can be retried, and one tag shipped by two bundles is audible.')
