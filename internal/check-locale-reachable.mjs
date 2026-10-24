// check-locale-reachable — a reader must be able to CHOOSE one of the 11 locales.
//
// ★ THE BUG THIS EXISTS FOR IS UNREACHABILITY, not incorrectness. The packet ships
// in 11 languages and every string is translated — and detectLocale() read ONLY
// document.documentElement.lang, which EVERY generated leaf page in this repo
// hardcodes to "en" (measured: 20 of 20). On the built static tree — the jamstack
// case these bundles exist for — ten of the eleven translations could not be
// reached by any reader. Correct, complete, and invisible.
//
// So this asserts two separate things, because they fail separately:
//   1. RESOLUTION — ?lang= / ?locale= selects a supported locale, a bad value falls
//      back to English, and a region tag (pt-BR) resolves to its base language.
//      Tested against the SHIPPED source of detectLocale, not a copy.
//   2. REACHABILITY — the built leaf pages still declare a lang, so the host-page
//      path (Polylang on WordPress) keeps working. If someone later makes the pages
//      lang-less, the URL path alone would silently become the only way in.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const REPO = process.env.DOXA_REPO
  // FOURTH instance of this pattern in one flight (check-zone-census, check-share-policy,
  // check-poster-prints, now this). DOXA_REPO still wins; only the default becomes portable,
  // per the idiom check-no-absolute-paths.mjs prints in its own failure text. A gate that
  // hardcodes its author's worktree turns build:unlocked red for every other builder.
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(REPO, 'library/i18n/index.js'), 'utf8')

const SUPPORTED = (src.match(/SUPPORTED_LOCALES = \[([^\]]*)\]/) || [])[1]
  ?.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) || []

// Evaluate the SHIPPED detectLocale rather than reimplementing it — a gate that
// reimplements the thing it tests only ever proves the copy agrees with itself.
// ★ TAKE THE FUNCTION, NOT THE GAP BETWEEN TWO LANDMARKS.
// This used to slice from `export function detectLocale` to `export function createAppI18n` and eval
// whatever lay between. That is a promise about the ORDER OF A FILE the gate does not own: the day
// someone exported a helper between those two lines, the slice carried a bare `export` into
// new Function() and this gate died with "Unexpected token 'export'" — twice, once for a helper I
// added myself. It was then "fixed" by moving the helper, which only re-armed the trap for the next
// person. Extract detectLocale by matching its own braces, and strip any export keyword that
// survives, so the gate reads the function it names and nothing else.
function extractFunction(source, name) {
  const start = source.search(new RegExp('(export\\s+)?function\\s+' + name + '\\s*\\('))
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}
const body = extractFunction(src, 'detectLocale').replace(/\bexport\s+/g, '')
if (!body) {
  console.error('LOCALE-REACHABLE: FAIL — could not find detectLocale() in library/i18n/index.js.')
  console.error('  The gate evaluates the SHIPPED function rather than reimplementing it, so if the')
  console.error('  function is renamed this must be updated — silence here would be a gate that')
  console.error('  stopped testing anything.')
  process.exit(1)
}
// …and every top-level helper of the same file that detectLocale CALLS, transitively. 09d03c60 moved
// the URL half into localeFromUrl(), and a gate that extracted detectLocale alone died with
// "localeFromUrl is not defined" on every case — reporting a working feature as broken. Following the
// calls keeps the gate on the shipped code whatever it is factored into.
const helpers = []
const seen = new Set(['detectLocale'])
const queue = [body]
while (queue.length) {
  const code = queue.shift()
  for (const [, name] of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (seen.has(name)) continue
    seen.add(name)
    const fn = extractFunction(src, name)
    if (fn) { const clean = fn.replace(/\bexport\s+/g, ''); helpers.push(clean); queue.push(clean) }
  }
}
const make = new Function('SUPPORTED_LOCALES', 'window', 'document',
  `${helpers.join('\n')}\n${body}\n; return detectLocale;`)
const detect = (search, htmlLang) =>
  make(SUPPORTED, { location: { search } }, { documentElement: { lang: htmlLang } })()

const CASES = [
  ['?lang=es', 'en', 'es', 'a lang param selects a supported locale'],
  ['?locale=fr', 'en', 'fr', 'the locale spelling works too'],
  ['?lang=pt-BR', 'en', 'pt', 'a region tag resolves to its base language'],
  ['?lang=zz', 'en', 'en', 'an unsupported value falls back to English'],
  ['?lang=', 'de', 'de', 'an empty param defers to the host page'],
  ['', 'de', 'de', 'with no param the host page still wins'],
  ['?lang=ar', 'en', 'ar', 'RTL locales are selectable like any other'],
]

const fails = []
for (const [q, htmlLang, want, why] of CASES) {
  let got
  try { got = detect(q, htmlLang) } catch (e) { got = `THREW: ${e.message}` }
  if (got !== want) fails.push(`${q || '(no param)'} with html lang="${htmlLang}" -> "${got}", expected "${want}" (${why})`)
}

// Every packet language must be reachable: the two lists cannot drift apart.
const strings = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8'))
const packetLangs = Object.keys(strings).filter((k) => !k.startsWith('_'))
const unreachable = packetLangs.filter((l) => !SUPPORTED.includes(l))
if (unreachable.length) {
  fails.push(`the packet ships ${unreachable.join(', ')} but SUPPORTED_LOCALES does not list them — `
    + 'those translations cannot be selected')
}

// The host-page path must survive: leaf pages still declare a lang.
const leafRoot = join(REPO, `public/${TREE_NAME}`)
let leaves = 0
let withLang = 0
if (existsSync(leafRoot)) {
  for (const bundle of readdirSync(leafRoot)) {
    const bdir = join(leafRoot, bundle)
    let subs = []
    try { subs = readdirSync(bdir) } catch { continue }
    for (const sub of subs) {
      const page = join(bdir, sub, 'index.html')
      if (!existsSync(page)) continue
      leaves += 1
      if (/<html[^>]*\blang=/.test(readFileSync(page, 'utf8'))) withLang += 1
    }
  }
}
if (leaves && withLang !== leaves) {
  fails.push(`${leaves - withLang} of ${leaves} leaf pages declare no lang — `
    + 'the host-page detection path is broken for them')
}

console.log(`  supported locales : ${SUPPORTED.length} (${SUPPORTED.join(' ')})`)
console.log(`  packet languages  : ${packetLangs.length} (${packetLangs.join(' ')})`)
console.log(`  resolution cases  : ${CASES.length - fails.filter((f) => f.includes('->')).length}/${CASES.length} correct`)
console.log(`  leaf pages w/ lang: ${withLang}/${leaves}`)

if (fails.length) {
  console.error(`\nLOCALE-REACHABLE: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nLOCALE-REACHABLE: PASS — all ${packetLangs.length} packet languages are selectable.`)
