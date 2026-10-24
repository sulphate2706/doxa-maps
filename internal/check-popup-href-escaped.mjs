#!/usr/bin/env node
/**
 * check-popup-href-escaped — a URL built into an HTML string is escaped before it lands in href=.
 *
 * ★ THE BUG THIS WAS WRITTEN FOR (regions, 2026-09-29). RegionCountryMap builds its map popup by
 * string concatenation, and every value in it went through esc() — the name, the religion, the
 * description, the image src, the button labels — except the two URLs:
 *
 *     <a class="cm-popup__btn" href="${profileUrl}">      <- raw
 *
 * Both are built by joinBase(props.researchUrl, p.slug), and joinBase is explicit that it only
 * normalises slashes; it escapes nothing. So two untrusted values reach an HTML attribute unescaped:
 * the slug, which is API data, and the base URL, which is an attribute set by whoever embeds the
 * element. DEMONSTRATED before the fix, with a slug of `x" onerror=alert(1) data-x="`:
 *     <a href="https://doxa.life/research/x" onerror=alert(1) data-x="">
 * i.e. out of the attribute and into arbitrary new ones. esc() closes it; it was already imported
 * in that file and used on every other value.
 *
 * ★ WHY A GATE AND NOT JUST THE FIX. The popup is built in a template literal, so no template
 * analysis and no linter sees the attribute. It also only renders once a map DRAWS, and that popup
 * had never been exercised — the Regions map was grey — so review was the only thing standing
 * between this and production, and review had already passed it.
 *
 * WHAT COUNTS. Only HTML being BUILT: href=" or src=" immediately followed by an interpolation, in
 * a .vue or .js under library/ or plugin-designs/. A querySelector(`link[href="${CONST}"]`) is not
 * HTML generation and is skipped by requiring the match to sit in a string that also opens a tag.
 * An interpolation is accepted when its FIRST call is an escaper (esc/escapeHtml/encodeURI*), or
 * when it is a bare constant-cased identifier (HREF, MAPBOX_CSS) which cannot carry user data.
 *
 * EXIT 0 pass · 1 an unescaped URL interpolation
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
let exempt = 0
let quiet = false                 // self-tests probe the same function without printing
const fail = (m) => { bad++; if (!quiet) console.log('  FAIL  ' + m) }

const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}

// href=" or src=" followed straight by ${...}. The capture is the interpolation body.
const ATTR_INTERP = /\b(href|src)="\$\{([^}]*)\}/g
// Safe, and every entry here is a value a quote CANNOT reach — verified at each call site, not
// assumed from the name:
//   esc/escapeHtml/escapeAttr  escape it.
//   safeUrl(...)               validates the protocol AND calls escapeHtml (library/utils/html.js:17).
//   encodeURI/encodeURIComponent  percent-encode the quote. Accepted anywhere in the expression,
//                              because export-public.mjs builds `${enc(a)}/${enc(b)}` and the first
//                              call is not the only one that matters.
//   a SCREAMING_CASE constant  is a module constant, not user data.
//   objectUrl / dataUrl        URL.createObjectURL gives blob:<uuid>, and FileReader.readAsDataURL
//                              gives base64 — neither can contain a quote. Matched by NAME, which is
//                              weaker than the others, so the name must be exactly one of these.
const SAFE = new RegExp(
  '^\\s*(?:esc|escapeHtml|escapeAttr|safeUrl)\\s*\\('           // escaped at the call
  + '|(?:encodeURI|encodeURIComponent)\\s*\\('                   // percent-encoded anywhere
  + '|^\\s*[A-Z][A-Z0-9_]*\\s*$'                                // a module constant
  + '|^\\s*(?:url|objectUrl|dataUrl|blobUrl)\\s*$')             // blob: / data: — quote-free by construction
// HTML generation, not a selector: the same line (or the two before it) opens a tag.
const OPENS_TAG = /<\s*[a-zA-Z][^>]*$|<\s*[a-zA-Z][a-zA-Z0-9]*\s/

const check = (src, rel) => {
  const lines = src.split('\n')
  lines.forEach((l, i) => {
    for (const m of l.matchAll(ATTR_INTERP)) {
      const body = m[2]
      if (SAFE.test(body)) continue
      const ctx = lines.slice(Math.max(0, i - 2), i + 1).join('\n')
      if (!OPENS_TAG.test(ctx)) continue                      // a querySelector, not built HTML
      // An escape hatch for a value this check cannot see the safety of — a URL built from
      // encodeURIComponent on an earlier line, or a module constant reached through a property.
      // The reason must be written down, in the 4 lines above, so the next reader can re-judge it.
      const why = lines.slice(Math.max(0, i - 4), i + 1).join('\n')
      if (/href-escaped-ok:\s*\S/.test(why)) { exempt++; continue }
      fail(`${rel}:${i + 1} builds ${m[1]}="\${${body.trim().slice(0, 44)}}" without escaping — a quote in the value escapes the attribute (use esc())`)
    }
  })
}

for (const f of [...walk(join(ROOT, 'library')), ...walk(join(ROOT, 'plugin-designs'))]) {
  check(readFileSync(f, 'utf8'), relative(ROOT, f))
}

// ── self-tests: the arm must fire on the founding bug and stay quiet on the real safe shapes ──
const t = (name, src, shouldFail) => {
  const before = bad
  quiet = true
  check(src, '<self-test>')
  quiet = false
  const fired = bad > before
  bad = before
  if (fired !== shouldFail) { bad++; console.log(`  FAIL  self-test "${name}": expected ${shouldFail ? 'FAIL' : 'pass'}, got ${fired ? 'FAIL' : 'pass'}`) }
}
t('the founding bug', '`<a class="b" href="${profileUrl}">x</a>`', true)
t('escaped with esc()', '`<a class="b" href="${esc(profileUrl)}">x</a>`', false)
t('encodeURI', '`<img src="${encodeURIComponent(u)}">`', false)
t('a SCREAMING_CASE constant', '`<link rel="stylesheet" href="${MAPBOX_CSS}">`', false)
t('querySelector, not built HTML', 'root.querySelector(`link[href="${cssUrl}"]`)', false)
t('src on an img', '`<img class="p" src="${p.imageUrl}" alt="a">`', true)

if (bad) { console.log(`POPUP-HREF-ESCAPED: FAIL — ${bad} problem(s).`); process.exit(1) }
console.log(`POPUP-HREF-ESCAPED: PASS — every href/src interpolation in built HTML is escaped or explained; ${exempt} documented exception(s); 6 self-tests.`)
