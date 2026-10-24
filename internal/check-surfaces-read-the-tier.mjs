/**
 * check-surfaces-read-the-tier.mjs — one place decides "this group has nothing".
 *
 * THE BUG THIS EXISTS FOR, THREE TIMES OVER. The pin index computes a tier per group:
 * 0 means no resource was found in any pool checked. The charts profile used to decide the
 * same thing again, by listing the resource fields by hand:
 *
 *     none: !c.s && !c.f && !c.au && !c.bv && !c.z && !(c.d && c.d.length)
 *
 * Every time a source was added, that list was one field short and the two views of the same
 * dataset disagreed — 7 codes the first time, then 28 when Scripture Earth landed: drawn as
 * having nothing by the chart while the map offered them a working link. Nothing failed. The
 * chart simply told a quieter, wronger story than the map, and only a hand count found it.
 *
 * THE RULE. A surface may READ the tier the pin index computed. It may not RE-DERIVE it from
 * the raw resource fields. Adding a source should reach every view for free.
 *
 * Run with --poison to prove the check can fail: it re-injects the hand-rolled formula into
 * a copy of each surface and requires every one to be caught.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(HERE, '../plugin-designs/gospel-resources')
const POISON = process.argv.includes('--poison')

/**
 * A hand-rolled "has nothing" decision: a negated resource field, joined by && to at least
 * two more negated field reads. Matching the SHAPE rather than one spelling is the point —
 * the next drift will use a different field list, not this one.
 */
const FIELD = String.raw`!\s*c\.(?:s|f|au|bv|se|ga|z|gp|d)\b[^\n]{0,40}`
const HANDROLLED = new RegExp(`${FIELD}&&\\s*${FIELD}&&\\s*${FIELD}`)

/**
 * THE SECOND SHAPE, and the one that got through. The first pattern only caught NEGATED c.*
 * fields joined by &&. The country sheet wrote the positive form over the MAPPED row —
 * `const hasAny = (r) => !!(r.scripture_url || r.film_url || r.audio || ...)` — so neither
 * the keyword filter nor the field pattern saw it. It was stale by 729 groups and 77.9
 * million people before this caught it.
 *
 * WHY THIS IS A NAME RULE AND NOT A CLEVERER PATTERN. Two broader patterns were tried first
 * and BOTH produced confident false findings on honest code: "three OR-ed resource fields"
 * flags canHear(), which ORs media precisely because it must EXCLUDE text; "spans text and
 * media" flags `!!c.s || !!(c.au && /text/…)`, because c.au is text OR audio depending on a
 * qualifier, and a `|| ''` default inflates the operator count. A detector that cannot see
 * how the expression is constructed reports the wrong thing confidently — the same failure
 * this repo has now met in a forced token, a swallowed flag and a class extractor.
 *
 * So this asks one narrow question it can actually answer: a predicate NAMED for "has
 * anything" is deciding the tier by definition, and must read it. Narrow and true beats
 * broad and wrong.
 */
const ANYTHING_PREDICATE = /\b(?:hasAny|hasAnything|hasResources|hasRes|anyResource)\b/

function offendersIn(src, label) {
  const isScript = label.startsWith('scripts/')
  const out = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    /* Only lines that are actually deciding emptiness, not e.g. a render guard. */
    const namesEmptiness = /\bnone\b|\bgap\b|\bnothing\b|hasNothing/.test(line)
    if (namesEmptiness && HANDROLLED.test(line)) {
      out.push(`${label}:${i + 1}  ${line.trim().slice(0, 90)}`)
      continue
    }
    /* A predicate named for "has anything" IS the tier question; it must read the tier.
       Only its DEFINITION is judged — call sites mention the name and decide nothing — and
       `_tier` counts, since a mapped row carries it under that name. */
    const defines = new RegExp(`(?:const|let|function)\\s+${ANYTHING_PREDICATE.source}`).test(line)
    if (!defines) continue
    if (isScript) {
      /* A build script COMPUTES the tier, so it cannot read one. What it must do instead is
         name every pool: the drift here is always a field list that never learned about the
         newest source. */
      const missing = ['se', 'ga'].filter((f) => !new RegExp(`\\.${f}\\b`).test(line))
      if (missing.length) {
        out.push(`${label}:${i + 1}  omits ${missing.join(', ')} — ${line.trim().slice(0, 70)}`)
      }
      continue
    }
    if (!/_?\btier\b|\b_tier\b/.test(line)) {
      out.push(`${label}:${i + 1}  ${line.trim().slice(0, 90)}`)
    }
  }
  return out
}

/* .vue AND the build scripts. The fifth occurrence of this bug was in
   scripts/refresh-legacy-resource-flags.mjs, which this check never looked at — so it
   reported "nothing to change" across 122 curated rows, 8.9 million people, that the index
   could already reach. A gate that only watches one half of a bundle certifies the other. */
const SCRIPTS = resolve(DIR, 'scripts')
const surfaces = [
  ...readdirSync(DIR).filter((f) => f.endsWith('.vue')),
  ...readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`),
]
if (!surfaces.length) {
  console.error('SURFACES-READ-THE-TIER: no .vue surfaces found — the check would pass vacuously.')
  process.exit(1)
}

if (POISON) {
  /* Both real shapes, so the self-test proves the check against the two defects it exists
     for rather than one — the second is the line that actually got through. */
  const INJECT =
    '        none: !c.s && !c.f && !c.au && !c.bv && !c.z && !(c.d && c.d.length),\n' +
    '        const hasAny = (r) => !!(r.scripture_url || r.film_url || r.audio || r.bible_video)\n' +
    '        const hasAny = (c) => !!(c.s || c.f || c.au || c.bv)'
  let caught = 0
  for (const f of surfaces) {
    const poisoned = `${readFileSync(resolve(DIR, f), 'utf8')}\n${INJECT}\n`
    if (offendersIn(poisoned, f).length) caught++
    else console.error(`  NOT CAUGHT in ${f}`)
  }
  if (caught === surfaces.length) {
    console.log(
      `SURFACES-READ-THE-TIER --poison: ${caught}/${surfaces.length} surface(s) caught the injected formula.`,
    )
    console.log('SURFACES-READ-THE-TIER: SELF-TEST PASS — the check fails as designed.')
    process.exit(0)
  }
  console.error('SURFACES-READ-THE-TIER: SELF-TEST FAIL — the check cannot detect the bug it exists for.')
  process.exit(1)
}

const offenders = surfaces.flatMap((f) => offendersIn(readFileSync(resolve(DIR, f), 'utf8'), f))
if (offenders.length) {
  console.error(`SURFACES-READ-THE-TIER: FAIL — ${offenders.length} surface line(s) re-derive "has nothing":`)
  for (const o of offenders) console.error(`  ${o}`)
  console.error('  Read the tier the pin index computed (pins[i][6] === 0) instead of listing')
  console.error('  the resource fields again — that list goes stale every time a source is added.')
  process.exit(1)
}
console.log(
  `SURFACES-READ-THE-TIER: PASS — ${surfaces.length} file(s) checked, none re-derives the tier.`,
)
