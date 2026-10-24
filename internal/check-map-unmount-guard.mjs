/* check-map-unmount-guard — the fast, browser-free half of the unmount-race proof (by the gospel-resources owner,
   adopted into internal/ by the studio lane; the end-to-end half is check-map-unmount-mid-init.mjs).

   Proves the guard by REPRODUCING the race against the real file: take the shipped source,
   run its ensureEngineCSS with a null element (what an unmounted pane hands it), and do the
   same against a copy with the guard stripped. One must throw, the other must not — a fix
   that cannot be shown to matter is not evidence. */
import { readFileSync } from 'node:fs'
const SRC = readFileSync('library/composables/useMapInstance.js', 'utf8')
const grab = (src) => {
  const i = src.indexOf('async function ensureEngineCSS')
  const j = src.indexOf('\n}\n', i)
  return src.slice(i, j + 2)
}
const body = grab(SRC)
const stripped = body.replace('  if (!element) return\n', '')
if (stripped === body) { console.error('CONTROL BROKEN — the guard line was not found, so the negative arm proves nothing.'); process.exit(1) }

const run = async (fnSrc) => {
  const f = new Function('ShadowRoot', `${fnSrc}; return ensureEngineCSS`)(class ShadowRoot {})
  try { await f(null, 'https://example.invalid/x.css'); return 'resolved' } catch (e) { return `threw: ${e.message}` }
}
const withGuard = await run(body)
const without = await run(stripped)
console.log(`  guarded   -> ${withGuard}`)
console.log(`  unguarded -> ${without}`)
const ok = withGuard === 'resolved' && /getRootNode/.test(without)
console.log(ok ? 'UNMOUNT-RACE: PASS — the guard turns studio\'s crash into a clean return.'
               : 'UNMOUNT-RACE: FAIL — the arms did not separate; this proves nothing.')
process.exit(ok ? 0 : 1)
