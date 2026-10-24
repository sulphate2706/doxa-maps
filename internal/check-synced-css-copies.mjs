#!/usr/bin/env node
/**
 * check-synced-css-copies.mjs — when a component declares the same selector TWICE, both copies
 * must say the same thing.
 *
 * WHY A COMPONENT HAS TWO COPIES AT ALL (this is not duplication by accident). A shared component
 * renders in two different contexts:
 *   - imported as a Vue child, where its scoped `<style>` block applies;
 *   - mounted inside a custom element's shadow root, where scoped CSS does NOT reach it, so the
 *     component injects the same rules with `useShadowStyles(\`…\`)`.
 * Both are load-bearing. The standing rule is that they stay identical — and nothing enforced it.
 *
 * THE DEFECT THIS CATCHES, found by running this audit by hand 2026-09-22:
 * `library/components/PeopleGroupDetail.vue` disagreed with itself on EIGHT colour properties, and
 * the shadow copy was DARK against a light `<style>` copy:
 *     .detail-header  background   style="white"    shadow="#16213e"
 *     .stat-label     color        style="#666"     shadow="#9ca3af"
 *     .description-text color      style="#555"     shadow="#d1d5db"
 * The project rule is material LIGHT only, no dark mode. The literal is unconditional — no media
 * query, no theme check — so the component renders LIGHT when imported as a Vue child and DARK when
 * mounted in a shadow root. Six importers; the dark hex reached four shipped bundles.
 *
 * ★ WHY IT WAS INVISIBLE: it is a TWO-HOST bug. Whichever host you test, the component looks
 * correct there. This is the fourth two-host defect found this week (dropdown containing-block,
 * wheel scroll, grid affordances, and now CSS authoring) — the recurring shape of this codebase.
 *
 * WHAT IT ASSERTS. For every .vue file carrying BOTH a `<style>` block and a `useShadowStyles`
 * literal, every selector present in both must declare the same VALUE for every property present
 * in both. Compared as a property map, so `display: flex;` and `display:flex` are equal — the rule
 * is about meaning, not formatting, and a whitespace-sensitive check would drown real findings in
 * noise (measured: 20 "divergences" in one file, of which 8 were real).
 *
 * A property in only ONE copy is allowed: the two contexts legitimately need different rules (a
 * shadow copy often adds `:host` sizing a scoped block cannot express). Only a CONFLICT — both
 * copies naming the same property with different values — is a defect.
 *
 * SCOPE IS DERIVED, never listed: it walks library/ and plugin-designs/ for the pattern. A
 * hand-maintained file list is how check:template-literal silently missed 36 files (see its header
 * and AP-a-gate-that-is-right-about-the-rule-and-wrong-about-the-files).
 *
 * NEGATIVE-TESTED: changing one colour in either copy of a synced file fails by name.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function vuesUnder(root) {
  const abs = join(ROOT, root)
  if (!existsSync(abs)) return []
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(abs)
  return out
}

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

// A rule body -> { property: value }. Formatting-insensitive on purpose.
const propsOf = (body) => {
  const o = {}
  for (const decl of stripComments(body).split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim()
    if (!k || k.startsWith('-')) continue
    // Normalise COMMA SPACING too, not just run-length. A minified shadow copy writes
    // `color .15s,border-color .15s` where the <style> block writes `color .15s, border-color .15s`
    // — identical meaning, and reporting it buries the real findings. First run of this gate
    // produced 5 conflicts for doxa-simple-map of which 2 were pure comma spacing; a gate whose
    // output is 40% noise is one people learn to skim.
    o[k] = decl.slice(i + 1).trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',')
  }
  return o
}

// Class-selector rules only. Pseudo-element and media-query variants are distinct rules and would
// produce false "divergences" if folded together — an early hand-check reported 12 copies / 5
// distinct for .vtl-nav purely because ::-webkit-scrollbar variants were swept in.
// ★ MERGE every rule for a selector; do NOT let the last one win.
// A selector is routinely declared more than once — a base rule plus media-query overrides. The
// first version of this gate assigned `m[sel] = props`, so only the LAST declaration survived and
// every property that appeared solely in the base rule became invisible.
//
// MEASURED: .stl-titlebar in SemanticTreeLegend.vue has TWO rules in each copy — a base rule
// carrying `gap: 6px` and a media-query rule carrying only `border-color`. Injecting `gap: 99px`
// into the shadow copy produced NO finding, because both maps had already discarded the base rule.
// A gate silently blind to base rules would have passed this file forever.
//
// Merging is the honest model here: the question is "do the two copies ever disagree about this
// property", and a property declared in a base rule is just as real as one in an override. Later
// declarations win within a copy, matching CSS cascade order, so a value genuinely overridden in
// both copies still compares equal.
// ★ THE KEY IS THE FULL SELECTOR, NOT ITS LAST CLASS (fixed 2026-09-23).
// The pattern was /(^|[}\s;])(\.[a-z][\w-]*)\s*\{/ keyed on that one class, so ANY rule whose
// selector ended in a class was filed under that class regardless of what qualified it. A
// CONDITIONAL rule therefore merged into its own UNCONDITIONAL base rule, with two consequences:
//
//   FALSE POSITIVES — the merged pair was reported as the file disagreeing with itself. All 13 of
//   the gate's false findings were this: .dark-mode .detail-header folded into .detail-header,
//   .dsm-dark .dsm-error into .dsm-error, :host(:fullscreen) .dsm-root into .dsm-root. In each case
//   both copies were identical and the code correct — a dark override, and a position that is right
//   precisely WHEN FULLSCREEN.
//
//   MASKED REAL CONFLICTS — merging is last-write-wins within a copy, so a later conditional rule
//   OVERWRITES the base value. MEASURED: poisoning .dsm-root inset 0 -> 7px in the shadow copy
//   produced NO finding, because :host(:fullscreen) .dsm-root{inset:0} was merged in afterwards and
//   restored it. A property can be shared, genuinely divergent, and invisible.
//
// So the 13 false findings and the missed real one are ONE defect, not two.
//
// ★ WHY THIS MATTERED MORE THAN A NOISY GATE: findings that are all false do not stay ignored.
// Someone eventually "fixes" correct code to satisfy them — here that would mean deleting a
// dark-mode override or breaking fullscreen. It is also why this gate is not in build:unlocked: it
// could not be switched on without going red.
//
// The MERGE behaviour is unchanged and still correct: two rules with the SAME full selector (a base
// plus a media-query override) still merge, which is what the .stl-titlebar case proved. Only the
// identity of a selector is corrected. Whitespace is normalised so `.a  .b` and `.a .b` compare
// equal across two hand-maintained copies.
const rulesOf = (css) => {
  const m = {}
  // ★ THE AT-RULE IS PART OF THE KEY. The header above already states that media-query variants are
  // distinct rules — but nothing implemented it, because the selector pattern stops at `@`. MEASURED:
  // PeopleGroupDetail.vue declares `.people-group-name{font-size:18px}` at the top level and
  // `font-size:16px` inside `@media (max-width:480px)`. Folded together they read as the file
  // disagreeing with itself at 18 vs 16, when in truth the shadow copy simply has no mobile rule —
  // and "a property in only ONE copy is allowed" is this gate's own stated contract. Prefixing the
  // key with the enclosing at-rule keeps a responsive override comparable only with its counterpart.
  let guard = 0
  for (const blk of splitAtRules(stripComments(css))) {
    for (const r of blk.css.matchAll(/(?:^|[};])\s*([^{}@;]*?\.[a-z][^{}@;]*?)\s*\{([^}]*)\}/gim)) {
      const sel = r[1].trim().replace(/\s+/g, ' ')
      if (!sel) continue
      const key = blk.at ? blk.at + ' { ' + sel : sel
      m[key] = Object.assign(m[key] || {}, propsOf(r[2]))
      if (++guard > 20000) return m
    }
  }
  return m
}

// Split CSS into the top level plus one entry per at-rule block, each tagged with its condition.
// Brace-matched rather than regex-matched: an at-rule body contains nested `{}` and a lazy pattern
// would stop at the first inner brace.
function splitAtRules(css) {
  const out = []
  let top = ''
  for (let i = 0; i < css.length; i++) {
    if (css[i] !== '@') { top += css[i]; continue }
    const head = css.slice(i, css.indexOf('{', i))
    if (!/^@(media|supports|container|layer)\b/i.test(head)) { top += css[i]; continue }
    let d = 0, j = css.indexOf('{', i)
    const start = j
    for (; j < css.length; j++) {
      if (css[j] === '{') d++
      else if (css[j] === '}' && --d === 0) break
    }
    out.push({ at: head.trim().replace(/\s+/g, ' '), css: css.slice(start + 1, j) })
    i = j
  }
  out.push({ at: '', css: top })
  return out
}

// ── SELF-TEST: prove this gate can still FAIL, on the regressions it exists for ────────────────
// A gate whose findings all turned out to be false is one nobody trusts; a gate that stops finding
// anything is worse. Each case poisons ONE property IN MEMORY (never on disk, so a crash cannot
// leave the tree edited) and requires a finding naming that property.
// `inset` is here deliberately: the previous implementation MISSED it, because
// `:host(:fullscreen) .dsm-root{inset:0}` was merged into the base rule under a last-class key and
// overwrote the poisoned value. It is the regression that proves the selector fix.
if (process.argv.includes('--self-test')) {
  const SUBJECT = join(ROOT, 'plugin-designs/doxa-simple-map/doxa-simple-map.vue')
  const src = readFileSync(SUBJECT, 'utf8')
  const open_ = src.indexOf('useShadowStyles(`')
  const lit = open_ + 'useShadowStyles(`'.length
  const close = src.indexOf('`', lit)
  const compare = (shadowCss) => {
    const A = rulesOf([...src.matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map((m) => m[1]).join('\n'))
    const B = rulesOf(shadowCss)
    const out = []
    for (const sel of Object.keys(A).filter((k) => k in B)) {
      for (const p of Object.keys(A[sel])) if (p in B[sel] && A[sel][p] !== B[sel][p]) out.push(p)
    }
    return out
  }
  const baseline = compare(src.slice(lit, close))
  if (baseline.length) {
    console.error('SYNCED-CSS SELF-TEST: FAIL — the subject already conflicts on ' + baseline.join(', ') +
      '; fix that first or the cases below cannot be read.')
    process.exit(1)
  }
  const cases = [
    ['flex-direction', 'flex-direction:column', 'flex-direction:row-reverse'],
    ['inset', 'inset:0', 'inset:7px'],
    ['overflow', 'overflow:hidden', 'overflow:scroll'],
  ]
  let bad = 0
  for (const [prop, from, to] of cases) {
    const shadow = src.slice(lit, close)
    const poisoned = shadow.replace(from, to)
    if (poisoned === shadow) { console.error(`  ${prop}: POISON DID NOT APPLY — the case proves nothing.`); bad++; continue }
    const caught = compare(poisoned).includes(prop)
    console.log(`  ${prop}: ${caught ? 'caught' : 'NOT CAUGHT'}`)
    if (!caught) bad++
  }
  if (bad) { console.error(`SYNCED-CSS SELF-TEST: FAIL — ${bad} case(s) not caught.`); process.exit(1) }
  console.log('SYNCED-CSS SELF-TEST: PASS — 3 regressions caught; tree untouched (poisoned in memory).')
  process.exit(0)
}

const files = [...vuesUnder('library'), ...vuesUnder('plugin-designs')]
const offenders = []
let pairs = 0
let sharedTotal = 0

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const i = src.indexOf('useShadowStyles(`')
  if (i < 0 || !/<style/.test(src)) continue

  const end = src.indexOf('`', i + 'useShadowStyles(`'.length)
  if (end < 0) continue
  // Slice AFTER the opening backtick. Slicing from `i` leaves the text `useShadowStyles(\`` at
  // the head of the CSS, which a full-selector regex absorbs into the FIRST rule's selector —
  // measured: `.dsm-root` was captured as `useShadowStyles(\` .dsm-root` and so never existed as
  // a key, silently dropping the first rule of every literal.
  const shadowCss = src.slice(i + 'useShadowStyles(`'.length, end)

  // ★ TAKE <style> BLOCKS FROM THE TOP LEVEL ONLY — an SFC block starts at column 0.
  // A loose /<style[^>]*>/ matches the word inside a JS comment too. SemanticTreeLegend.vue has
  // `// CSS — verbatim from PPLR's <style scoped>, injected into shadow root.` 43 characters BEFORE
  // useShadowStyles(, so the regex opened a "style block" there and ran to the next real </style>,
  // SWALLOWING THE WHOLE SHADOW LITERAL into the <style> text. Both maps then read the same bytes,
  // so the two copies could never disagree and no injected conflict was ever detected — a gate that
  // structurally could not fail on its largest file (51 shared selectors).
  // Anchoring to line start also excludes the literal itself, which is what makes the comparison
  // a comparison rather than a tautology.
  const styleCss = [...src.matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map((m) => m[1]).join('\n')

  const A = rulesOf(styleCss)
  const B = rulesOf(shadowCss)
  const shared = Object.keys(A).filter((k) => k in B)
  if (!shared.length) continue
  pairs++
  sharedTotal += shared.length

  const conflicts = []
  for (const sel of shared) {
    for (const p of Object.keys(A[sel])) {
      if (p in B[sel] && A[sel][p] !== B[sel][p]) {
        conflicts.push({ sel, p, a: A[sel][p], b: B[sel][p] })
      }
    }
  }
  if (conflicts.length) offenders.push({ file: f.replace(ROOT + '/', ''), conflicts })
}

if (offenders.length) {
  console.error(`SYNCED-CSS: FAIL — ${offenders.length} file(s) disagree with themselves.\n`)
  for (const o of offenders) {
    console.error(`  ${o.file} — ${o.conflicts.length} conflicting propert(ies):`)
    for (const c of o.conflicts.slice(0, 10)) {
      console.error(`      ${c.sel} { ${c.p} }   <style>="${c.a}"   shadow="${c.b}"`)
    }
    if (o.conflicts.length > 10) console.error(`      …and ${o.conflicts.length - 10} more`)
    console.error('')
  }
  console.error('  The two copies exist because the component renders BOTH as an imported Vue child')
  console.error('  (scoped <style> applies) and inside a shadow root (only the injected literal')
  console.error('  reaches it). They are meant to be identical. A conflict means the component looks')
  console.error('  correct in whichever host you tested and wrong in the other — which is exactly')
  console.error('  how a dark-mode shadow copy shipped in four bundles under a light-only rule.')
  process.exit(1)
}

console.log(`SYNCED-CSS: PASS — ${pairs} file(s) carry both a <style> block and a shadow literal;`)
console.log(`  ${sharedTotal} shared selector(s) agree on every property declared in both.`)
console.log('  A property present in only one copy is allowed — the two contexts legitimately need')
console.log('  different rules. Only a CONFLICT, where both name the same property differently, is')
console.log('  a defect. Compared as property maps, so formatting differences are not reported.')
