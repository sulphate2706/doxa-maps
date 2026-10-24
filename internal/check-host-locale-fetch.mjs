#!/usr/bin/env node
/**
 * check-host-locale-fetch — a locale supplied through profile-config must fetch its catalogue.
 *
 * ★ WHAT THIS CAUGHT. When the build ships one locale (DX_SHIP_ONE_LOCALE), the preload in
 * library/i18n/index.js fires once at script evaluation from detectLocale(), which reads only the
 * URL and <html lang>. A locale arriving through profile-config — the HOST channel, the one a
 * partner page uses — reaches ProfileLoader's watchEffect and nowhere else. Without a loadLocale()
 * call there, that embed sets its locale, mirrors its direction, and then renders English, with no
 * error anywhere: the silent-fallback shape this gate family exists to refuse.
 *
 * ⚠ ASSERTED ON THE SEAM, NOT ON A STRING. "ProfileLoader mentions loadLocale" would pass on an
 * import that nothing calls, and on a call in a branch that never runs. So the watchEffect's own
 * body is read, and the call has to sit beside the setRuntimeLocale() that marks the host-channel
 * path — the two belong together because they answer the same question for different consumers.
 *
 * Reads real source. Headless, no browser, no network. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

const PL = read('library/ProfileLoader.vue')
const I18N = read('library/i18n/index.js')

// ── 1. THE HOST CHANNEL EXISTS AND STILL LOOKS THE WAY THIS GATE ASSUMES ───────────────────────
ok(/config\.value\?\.locale \|\| config\.value\?\.lang/.test(PL),
  'ProfileLoader no longer reads the locale from profile-config — this gate is judging a path that moved')

// ── 2. THE WATCHEFFECT THAT APPLIES IT ALSO FETCHES IT ─────────────────────────────────────────
// The body is taken by brace depth from the watchEffect that calls setRuntimeLocale, so a call
// sitting elsewhere in the file cannot satisfy this.
const at = PL.indexOf('watchEffect(() => {\n  if (!lang.value) return')
ok(at >= 0, 'the locale watchEffect was not found — it was renamed or restructured')
if (at >= 0) {
  const open = PL.indexOf('{', PL.indexOf('=>', at))
  let depth = 0, end = open
  for (let i = open; i < PL.length; i++) {
    if (PL[i] === '{') depth++
    else if (PL[i] === '}' && --depth === 0) { end = i; break }
  }
  const body = PL.slice(at, end + 1)
  ok(/setRuntimeLocale\(lang\.value\)/.test(body),
    'the watchEffect no longer publishes the locale — this gate is anchored to the wrong effect')
  ok(/loadLocale\([^)]*lang\.value\)/.test(body),
    'the locale watchEffect does not call loadLocale(), so a locale set through profile-config never '
    + 'fetches its catalogue: the embed mirrors its direction and renders English with no error')
}
ok(/import \{[^}]*\bloadLocale\b[^}]*\} from '\.\/i18n\/index\.js'/.test(PL),
  'ProfileLoader does not import loadLocale from the i18n module')

// ── 3. THE FETCH IS PINNED, AND UNREACHABLE WITHOUT A PIN ──────────────────────────────────────
// Keying on the hash map is what keeps the flag-OFF build off the network: a bundle with no areas
// inlines nothing, so a messages[] test would let the preload request a file that was never emitted.
ok(/if \(!LOCALE_SRI\[c\]\) return/.test(I18N),
  'loadLocale no longer refuses to fetch without a pin — the flag-off build would hit the network, '
  + 'and any fetch that did happen would be unpinned')
ok(/fetch\(url, \{ integrity: LOCALE_SRI\[c\] \}\)/.test(I18N),
  'the catalogue fetch does not pass its integrity hash unconditionally')

// ── 4. THE RTL HOLD NEVER REACHES THE MAP ──────────────────────────────────────────────────────
// A blanket rule on descendants would hide the map subtree, which is the outcome the hold exists to
// avoid: the map must paint while only text waits.
const held = [...PL.matchAll(/\[data-locale-pending\] :deep\(\.([a-z0-9-]+)\)/g)].map((m) => m[1])
ok(held.length > 0, 'no chrome classes are held while an RTL catalogue is in flight — the hold is not wired')
ok(!/\[data-locale-pending\]\s*\{/.test(PL) && !/\[data-locale-pending\] :deep\(\*\)/.test(PL),
  'the hold is applied to the whole subtree rather than to named chrome, so it would hide the map')
for (const cls of held) {
  ok(!/^(map|mapbox|maplibre|canvas)/.test(cls),
    `the hold names .${cls}, which looks like a map container — only text chrome may ever wait`)
}
ok(/\[data-locale-pending\][\s\S]{0,900}visibility: hidden/.test(PL),
  'the hold uses something other than visibility — display:none would reflow the chrome back in when '
  + 'the text lands, which is the same visual defect as the flip')

if (fails.length) {
  console.error('HOST-LOCALE-FETCH: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`HOST-LOCALE-FETCH: PASS — a profile-config locale fetches its catalogue, the fetch is `
  + `unreachable without a pin, and the RTL hold covers ${held.length} named chrome class(es) and no map.`)
