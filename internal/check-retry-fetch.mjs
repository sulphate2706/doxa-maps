#!/usr/bin/env node
/**
 * check-retry-fetch — a runtime data fetch survives a transport blip, and a real error still fails.
 *
 * THE DEFECT (reported 2026-09-28): net::ERR_NETWORK_CHANGED killed an embedded UPG-100's load.
 *
 * ★ THE URLs IN HIS CONSOLE CANNOT BE FIXED, BECAUSE THEY DO NOT EXIST IN PRODUCTION. They were module
 * URLs — locale JSON with ?import, useOptionalT.js, useShadowStyles.js, useMapTheme.js. The build is
 * IIFE with inlineDynamicImports (vite.config.js:216-220), so every one of those is inside the single
 * bundle and is never fetched separately. Those failures are dev-server module requests. Wrapping them
 * in a retry is impossible AND unnecessary; saying so is the useful part of this card.
 *
 * ★ THE FAILURE CLASS IS REAL ONE LAYER DOWN, and that is what this guards. A built bundle still makes
 * runtime requests — boundaries geojson, the people-group list, prayer statistics — and none of them
 * retried. The same blip takes out whichever was in flight, and the feature is simply ABSENT: an empty
 * map, a missing outline, a statistic that never arrives, with nothing a reader could act on.
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { retryFetch } = await import(resolve(ROOT, 'library/composables/retryFetch.js'))
const fails = []
const ok = (w, c, d = '') => { if (!c) fails.push(`${w}${d ? `\n      ${d}` : ''}`) }
const realFetch = globalThis.fetch

// ── behaviour ────────────────────────────────────────────────────────────────────────────────────
{
  let n = 0
  globalThis.fetch = async () => { if (++n < 3) throw new TypeError('Failed to fetch'); return { ok: true, attempt: n } }
  const r = await retryFetch('u', undefined, { backoff: () => 1 })
  ok('a transport blip is survived', r.attempt === 3, `resolved on attempt ${r.attempt}`)
}
{
  // ★ COUNT THE ATTEMPTS, do not merely assert that it throws. An unbounded loop with a short backoff
  // ALSO throws eventually, so "it failed in the end" passes a retry policy that hammers a dead server
  // forever — caught by this gate's own negative test, which is the only reason the weak version did
  // not ship. The property is BOUNDED give-up, and the bound is the number.
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch') }
  let threw = false
  try { await retryFetch('u', undefined, { backoff: () => 1 }) } catch { threw = true }
  ok('a persistently dead endpoint still FAILS — retrying forever would hide real breakage', threw)
  ok('...after a BOUNDED number of attempts, not indefinitely', calls === 3, `fetch called ${calls}x, expected 3`)
  calls = 0
  try { await retryFetch('u', undefined, { attempts: 5, backoff: () => 1 }) } catch { /* expected */ }
  ok('...and the bound is the caller\'s, when they state one', calls === 5, `fetch called ${calls}x, expected 5`)
}
{
  // A 404/500 RESOLVES. It must be handed back untouched, not retried: the server said something.
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: false, status: 404 } }
  const r = await retryFetch('u', undefined, { backoff: () => 1 })
  ok('a 404 is returned, not retried', r.status === 404 && calls === 1, `fetch called ${calls}x`)
}
{
  // An abort is a DECISION, never a blip.
  let calls = 0
  globalThis.fetch = async () => { calls++; const e = new Error('aborted'); e.name = 'AbortError'; throw e }
  let threw = false
  try { await retryFetch('u', undefined, { backoff: () => 1 }) } catch (e) { threw = e.name === 'AbortError' }
  ok('an abort is not retried', threw && calls === 1, `fetch called ${calls}x`)
}
globalThis.fetch = realFetch

// ── and the shared data paths actually use it ────────────────────────────────────────────────────
// ★ ONE SITE IS DELIBERATELY EXEMPT AND IS NAMED, not silently skipped. usePosterPrints probes for an
// OPTIONAL pre-rendered .webp and falls through to generating the poster when it is absent — a miss is
// the expected path, so retrying would delay the fallback for an asset that is legitimately not there.
// Everything else in that file, and every other runtime request, must retry.
const EXEMPT = new Map([['library/composables/usePosterPrints.js', 1]])
for (const rel of [
  'library/composables/useMapLayers.js',
  'library/composables/useCountryOutline.js',
  'library/lists/peopleGroupList.js',
  'library/composables/usePrayerStatistics.js',
  'library/composables/usePosterPrints.js',
  'library/composables/useSharedMapToken.js',
  'library/composables/useCsvExport.js',
  'library/components/PeopleGroupDetail.vue',
]) {
  const src = readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const bare = (src.match(/(?<![A-Za-z.])fetch\s*\(/g) || []).length
  const allowed = EXEMPT.get(rel) || 0
  if (bare > allowed) {
    fails.push(`${rel} has ${bare} bare fetch() call(s) for a runtime request, ${allowed} allowed — a transport\n`
      + '      blip there leaves the feature silently absent. Use retryFetch().')
  }
}

if (fails.length) {
  console.error('RETRY-FETCH: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('RETRY-FETCH: PASS — a blip is survived, a dead endpoint still fails, a 404 and an abort are not '
  + 'retried, and the shared data paths all go through it.')
