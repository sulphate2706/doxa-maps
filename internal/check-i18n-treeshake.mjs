#!/usr/bin/env node
/**
 * check-i18n-treeshake — each built bundle carries every translation area its code asks for, and (with
 * --sizes) reports what the narrowing saved. Headless.
 *
 * CRITIC-10 (2026-09-26): the build narrows library/i18n's catalogue glob to the areas
 * internal/i18n-areas.mjs finds in the bundle's source graph. Omitting an area a bundle uses would show
 * raw keys instead of text, so this re-reads the BUILT output: every "area.key" literal (and every bare
 * 'area' literal, for keys assembled at runtime) in <bundle>.js must belong to an area the build included
 * for that bundle. Only area-PREFIXED literals are judged here (a bare 'template' or 'options' is also
 * ordinary Vue/JS vocabulary); the build includes an area on a bare literal too, which only over-includes.
 * EXIT 0 pass · 1 an area the bundle needs was left out
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { allAreas, areasForBundle } from './i18n-areas.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AREAS = allAreas(ROOT)
const TREE = join(ROOT, 'public', TREE_NAME)

// ★ THE LOCALE ARM. The area arm above asks "is every area this bundle uses present?" — it names
// locales nowhere, so it is equally green whether a bundle carries eleven locales or one. That is
// fine today, when the glob inlines them all. It stops being fine the moment the build narrows by
// locale too (DESIGN-i18n-ship-only-the-active-locale): a per-locale file that fails to emit would
// fall back to English silently, which is a defect nobody sees and no gate reports.
//
// So: every locale the app says it supports must be REACHABLE from each built bundle — either
// inlined in the IIFE, or emitted as an asset beside it. Written now, while the answer is "all
// inlined", so it is already guarding when the build changes underneath it.
//
// ⚠ READ FROM SUPPORTED_LOCALES, NOT FROM THE FOLDER LIST. The folders are what happens to exist on
// disk; SUPPORTED_LOCALES is what the runtime will actually try to resolve — detectLocale() only
// ever returns a member of it. A locale added to the list without a catalogue is the failure this
// must catch, and comparing the folders against themselves could never catch it.
const I18N_SRC = readFileSync(join(ROOT, 'library/i18n/index.js'), 'utf8')
const LOCALES = ((I18N_SRC.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]*)\]/) || [])[1] || '')
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)

/**
 * Is `loc` reachable from the built bundle at `js`?
 *  · 'inlined'  — a value only that locale has appears in the IIFE
 *  · 'asset'    — <bundle>/locales/<loc>.json sits beside it
 * A locale with no translated content of its own to probe for is reported as 'unprobeable' rather
 * than as present: a check that cannot see a thing must not vote that the thing is there.
 */
function localeReachable(code, loc, bundleDir, includedAreas) {
  if (existsSync(join(bundleDir, 'locales', `${loc}.json`))) return 'asset'
  const dir = join(ROOT, 'library/i18n/locales', loc)
  if (!existsSync(dir)) return 'no-catalogue'
  // ⚠ PROBE ONLY THE AREAS THIS BUNDLE INCLUDES. Searching the whole locale folder asks the bundle
  // for text the build deliberately left out, and reports 'absent' for a locale that is present and
  // correct — which is how this first reported five bundles as broken when none of them were.
  const en = areaValues(join(ROOT, 'library/i18n/locales', 'en'), includedAreas)
  // ⚠ "NOT IN en" IS NOT THE SAME AS "IS A TRANSLATION". The ar catalogue holds an English
  // developer note that en does not, and one such string was enough to report ar as present in a
  // bundle with every Arabic character stripped out — the probe voted on a string no reader sees.
  // For a locale written in its own script, require that script; that is the evidence that what is
  // in the bundle is the translation and not a note about it.
  const SCRIPT = { ar: /[؀-ۿ]/, ru: /[Ѐ-ӿ]/, hi: /[ऀ-ॿ]/, zh: /[一-鿿]/ }
  const script = SCRIPT[loc]
  // ⚠ THE LENGTH FLOOR IS PER SCRIPT. A 25-character Chinese string is a whole sentence, so a
  // Latin-calibrated ">24" kept only the longest prose and found none of it in a composite that
  // carries short labels — reporting zh absent from a bundle with Chinese plainly in it. Chinese
  // says in ~8 characters what English needs 25 for; the floor only has to be long enough that the
  // string is not a coincidence.
  const floor = loc === 'zh' ? 8 : 24
  const mine = areaValues(dir, includedAreas)
    .filter((v) => v.length > floor && !en.includes(v) && (!script || script.test(v)))
  if (!mine.length) return 'unprobeable'
  return mine.slice(0, 40).some((v) => code.includes(v)) ? 'inlined' : 'absent'
}
/** Does this bundle's own source call a translator? Recursive: leaves keep their text in src/. */
function asksForTranslation(dir) {
  if (!existsSync(dir)) return false
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (asksForTranslation(p)) return true; continue }
    if (!/\.(vue|js|mjs)$/.test(e.name)) continue
    let src
    try { src = readFileSync(p, 'utf8') } catch { continue }
    if (/\b(?:t|tf|tStatic|\$t)\s*\(\s*['"`][\w-]+\./.test(src) || /\buseI18n\s*\(/.test(src)) return true
  }
  return false
}

/** Every string value in a locale folder, flattened — restricted to `areas` when given. */
function areaValues(dir, areas) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    if (areas && !areas.has(f.slice(0, -5))) continue
    let d
    try { d = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
    ;(function walk(o) {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') out.push(v)
        else if (v && typeof v === 'object') walk(v)
      }
    })(d)
  }
  return out.sort((a, b) => b.length - a.length)
}

let bad = 0, checked = 0, localeBad = 0
for (const b of readdirSync(join(ROOT, 'plugin-designs'))) {
  const js = join(TREE, b, `${b}.js`)
  if (!existsSync(join(ROOT, 'plugin-designs', b, 'index.js')) || !existsSync(js)) continue
  const code = readFileSync(js, 'utf8')
  const included = new Set(areasForBundle(ROOT, b).areas)
  const asked = AREAS.filter((a) => new RegExp('["\'`@]' + a + '\\.[A-Za-z_$]').test(code))
  const missing = asked.filter((a) => !included.has(a))
  checked++
  if (missing.length) { bad++; console.log(`  FAIL  ${b}: its built code asks for ${missing.join(', ')}, which the build left out`) }
  else console.log(`  ok    ${b.padEnd(24)} ${included.size}/${AREAS.length} areas bundled; every area its code asks for is in`)

  // ── locale arm ──
  // ⚠ ONLY BUNDLES THAT RENDER TRANSLATED TEXT THEMSELVES. Two shapes have nothing for a locale to
  // be missing from, and reporting either one describes an absence that is correct:
  //   · no areas included at all — the bundle carries no catalogue;
  //   · a COMPOSITE HOST, which mounts leaf bundles at runtime (bundleSrc) and renders no catalogue
  //     text of its own. stack-demo makes zero translator calls in its own source; its areas come
  //     from the shared library it links, not from anything it displays. Its locales live in the
  //     leaves it loads, and failing the host would send someone looking for a bug in the wrong file.
  // The discriminator is whether the bundle's OWN source asks for a translation, not its size and
  // not whether it happens to include an area.
  const usesI18n = asksForTranslation(join(ROOT, 'plugin-designs', b))
  if (!included.size || !usesI18n) {
    console.log(`        ${' '.repeat(24)} locales: n/a — ${!included.size ? 'no translation areas' : 'renders no catalogue text of its own (composite host)'}`)
    continue
  }
  const reach = LOCALES.map((loc) => [loc, localeReachable(code, loc, join(TREE, b), included)])
  const unreachable = reach.filter(([, how]) => how === 'absent' || how === 'no-catalogue')
  const unprobeable = reach.filter(([, how]) => how === 'unprobeable').map(([l]) => l)
  if (unreachable.length) {
    localeBad++
    console.log(`  FAIL  ${b}: ${unreachable.map(([l, how]) => `${l} (${how})`).join(', ')} — `
      + 'not inlined and no locales/<loc>.json beside the bundle, so a reader who asks for it gets English with no error')
  } else {
    const byHow = reach.reduce((m, [, how]) => (m[how] = (m[how] || 0) + 1, m), {})
    const shape = Object.entries(byHow).map(([k, n]) => `${n} ${k}`).join(', ')
    console.log(`        ${' '.repeat(24)} locales: ${shape}`
      + (unprobeable.length ? ` — ${unprobeable.join(', ')} have no locale-unique text long enough to probe` : ''))
  }
}
if (!checked) { console.log('I18N-TREESHAKE: FAIL — no built bundles (vacuous)'); process.exit(1) }
// A locale list that failed to parse would make the locale arm compare an empty set and pass — the
// same vacuous-green the bundle check above already guards against.
if (!LOCALES.length) { console.log('I18N-TREESHAKE: FAIL — SUPPORTED_LOCALES did not parse; the locale arm would be vacuous'); process.exit(1) }
if (bad) { console.log(`I18N-TREESHAKE: FAIL — ${bad} bundle(s) would show raw keys.`); process.exit(1) }
if (localeBad) { console.log(`I18N-TREESHAKE: FAIL — ${localeBad} bundle(s) cannot reach a locale they claim to support.`); process.exit(1) }
console.log(`I18N-TREESHAKE: PASS — ${checked} bundle(s): each carries every translation area its code asks for, `
  + `and every one of the ${LOCALES.length} supported locales is reachable (inlined or as an emitted asset).`)
