#!/usr/bin/env node
/**
 * check-element-bootstrap — every plugin that ships a custom element must build it the same way.
 *
 * ★ THE BUG THIS EXISTS FOR WAS LIVE IN FIVE PLUGINS AT ONCE. A profile element is
 * defineCustomElement(ProfileLoader, { configureApp }) and the configureApp has four steps; the fourth,
 * `app.provide('appI18n', i18n)`, is the one that gets dropped. ProfileLoader injects that instance
 * (ProfileLoader.vue:176) to drive its locale from profile-config, so without it the drive never runs
 * and every useI18n()/t() string is stuck at the boot locale — while setRuntimeLocale() on the next line
 * still fires, so tStatic strings DO follow the host. The element renders a convincing MIXTURE of the
 * reader's language and English.
 *
 * Nothing throws, because the t() shim falls back to its key. So it reads as "a few strings not
 * translated yet" and it survived in country-posters, key-cities, gospel-resources, cities-internet and
 * my-upg-100-list simultaneously — confirmed independently by a census of all 19 entry
 * files and found the same five and no sixth.
 *
 * ★ AND A CENSUS THAT COUNTED FUNCTION BODIES SAW FOUR OF SIXTEEN. That is why this gate greps for the
 * SHAPE (`defineCustomElement(ProfileLoader`) rather than for a known list: eleven of the sites are not
 * `function buildXElement()` at all, they are `const El = defineCustomElement(...)`, and a check written
 * around the four that matched would have passed the twelve that did not.
 *
 * TWO ARMS:
 *   A. no plugin entry may call defineCustomElement(ProfileLoader, …) directly — use the helper;
 *   B. the helper itself must provide appI18n, PLANTED as a negative case, so the regression cannot
 *      return by editing library instead of a plugin.
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'ELEMENT-BOOTSTRAP'
const HELPER = 'library/elements/defineMapElement.js'
const fails = []

// Stated exemptions. An element that wraps its OWN root component rather than ProfileLoader is a
// different thing and is not in scope: it has no ProfileLoader to inject anything.
const EXEMPT = new Map([])

// ── ARM A: no entry builds a profile element by hand ─────────────────────────────────────────────
const PD = join(ROOT, 'plugin-designs')
let entries = 0, viaHelper = 0
for (const p of readdirSync(PD)) {
  const f = join(PD, p, 'index.js')
  if (!existsSync(f)) continue
  const src = readFileSync(f, 'utf8')
  const buildsProfileElement = /defineCustomElement\s*\(\s*ProfileLoader/.test(src)
  const usesHelper = /defineMapElement\s*\(/.test(src)
  if (!buildsProfileElement && !usesHelper) continue
  entries++
  if (usesHelper) viaHelper++
  // ★ CALLED IS NOT IMPORTED. The first version of this migration called defineMapElement in eleven
  // entries that never imported it: a build does not fail on an unbound name, only the element's
  // first import does (ReferenceError), so the shape check above stayed green while eleven plugins
  // could not load. The landing precondition caught it by importing the profiles.
  if (usesHelper && !/import\s*\{[^}]*\bdefineMapElement\b[^}]*\}\s*from\s*['"][^'"]*defineMapElement(\.js)?['"]/.test(src)) {
    fails.push(`${p}/index.js calls defineMapElement(…) but never imports it: the element throws\n`
      + `      "defineMapElement is not defined" the moment it loads.`)
  }
  if (buildsProfileElement) {
    if (EXEMPT.has(p)) continue
    fails.push(`${p}/index.js calls defineCustomElement(ProfileLoader, …) directly.\n`
      + `      Use ${HELPER}. Building it by hand is how five plugins shipped without\n`
      + "      provide('appI18n') and rendered a mixture of the reader's language and English.")
  }
}
if (entries < 10) {
  fails.push(`only ${entries} profile-element entries found — the detection stopped matching and this `
    + 'gate would pass while checking almost nothing.')
}

// ── ARM B: the helper provides appI18n, proved by PLANTING its absence ───────────────────────────
const helperSrc = existsSync(join(ROOT, HELPER)) ? readFileSync(join(ROOT, HELPER), 'utf8') : ''
if (!helperSrc) {
  fails.push(`${HELPER} does not exist — every entry above is pointing at nothing.`)
} else {
  // ★ COMMENTS STRIPPED FIRST, and this gate's own negative case is what caught the need. The helper's
  // docstring QUOTES the provide line in prose, so a predicate over the raw source matched the
  // documentation and reported the code present even after the code was removed — it would have passed
  // a helper that only talked about providing appI18n. A check that reads comments is reading the
  // author's intentions, not the program.
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // Either spelling counts: app.provide('appI18n', …) or provideOwn(app, 'appI18n', …). The second
  // exists because a NESTED element must shadow its parent's instance deliberately (see
  // library/elements/provide-own.js); what this gate cares about is that the instance reaches
  // ProfileLoader at all, not which function put it there.
  const provides = (s) => /(?:app\.provide\(\s*|provideOwn\(\s*app\s*,\s*)['"]appI18n['"]\s*,/.test(code(s))
  const installs = (s) => /app\.use\(\s*i18n\s*\)|app\.use\(\s*createAppI18n\(\)\s*\)/.test(code(s))
  if (!provides(helperSrc)) {
    fails.push(`${HELPER} installs i18n but never provides it. ProfileLoader injects 'appI18n' to drive\n`
      + '      the locale; without the provide the element is permanently at its boot locale, silently.')
  }
  if (!installs(helperSrc)) fails.push(`${HELPER} does not install an i18n instance at all.`)
  // THE PLANT: the same predicate, run against a bootstrap with the provide removed, MUST report it.
  // /gm, not /m: the docstring quotes the line too, so removing only the FIRST match deleted the
  // DOCUMENTATION and left the code — the plant then "failed to detect" a provide that was still there.
  // Caught by this assertion failing on a correct helper, which is the plant doing its job on itself.
  const planted = helperSrc.replace(/^.*(?:app\.provide\(\s*|provideOwn\(\s*app\s*,\s*)['"]appI18n['"].*$/gm, '')
  if (provides(planted)) {
    fails.push('the check for the provide cannot detect its absence — it is measuring nothing. '
      + 'A gate that passes its own negative case is worse than no gate.')
  }
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — ${viaHelper}/${entries} profile elements are built through ${HELPER}, which provides `
  + "appI18n; an element built without it is detected, so the 'permanently English' regression cannot return quietly.")
