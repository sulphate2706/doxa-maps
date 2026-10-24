#!/usr/bin/env node
/**
 * check-tab-radius-token.mjs — the vertical tab rows must read the shared radius token, not a
 * hard-coded pill.
 *
 * THE DEFECT THIS EXISTS FOR. The tabs shipped at border-radius:999px — a full stadium on a 48px
 * row — under a real instruction to imitate the YouTube active row. Measured against the rest of
 * the product that is the only thing shaped that way: .vtl-collapse is 8px, the filter toggles in
 * library/components/search are 8px, and 8px is already the most common radius in the layout file.
 * That was reversed: nothing else in the app has that same roundedness.
 *
 * ★ WHY A GATE AND NOT JUST THE FIX. The 999px rationale is still in the file, kept deliberately as
 * history. A superseded rationale that still reads as current is exactly how a reversed decision
 * gets quietly undone — the same trap another agent hit today with a stale "navy pin >= 7:1 PASS"
 * acceptance line that no longer described anything that ships. A future reader who trusts that
 * comment would restore the pill and believe they were fixing a regression.
 *
 * WHAT IT ASSERTS, and why each assertion is here rather than the obvious one:
 *   A. .vtl-tab declares its radius through var(--vtl-radius,…), not a literal. Asserting the
 *      TOKEN rather than the value "8px" is the point: the requirement is that the tabs,
 *      the collapse button and the filter toggles agree, which a shared knob guarantees and three
 *      matching literals only coincidentally satisfy.
 *   B. The token's fallback equals .vtl-collapse's literal radius, READ FROM THE FILE. A hard-coded
 *      expectation of 8px here would pass while the collapse button moved to 10px and the two
 *      surfaces silently diverged — the gate would be asserting a number instead of the rule.
 *   C. Neither .vtl-tab copy carries a pill radius (anything >= 100px). This is the actual
 *      regression: a literal reintroduced beside the token would leave A passing.
 *
 * NOT ASSERTED, deliberately: .vtl-cap keeps border-radius:999px and should. The complaint was
 * about the ratio of radius to size — a 16px badge at 999px is a chip, a 48px row at 999px is a
 * stadium. A gate that banned 999px everywhere would over-apply the correction.
 *
 * ★ BOTH COPIES. VerticalTabsLayout.vue carries this CSS TWICE (VTL_SHADOW_CSS and the scoped
 * <style> block) and they must stay byte-identical. Every .vtl-tab occurrence is checked, so a fix
 * applied to only one copy fails here rather than shipping correct in one host and wrong in the
 * other.
 *
 * NEGATIVE-TESTED: replacing the token with border-radius:999px in either copy exits 1 naming the
 * line. Restoring exits 0. Run `bun run check:tab-radius:self-test` to re-prove it — an in-memory
 * poisoning, so a crash can never leave the tree edited.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'library/layouts/VerticalTabsLayout.vue')
const REL = 'library/layouts/VerticalTabsLayout.vue'

const fail = (m) => { console.error('TAB-RADIUS: FAIL — ' + m); process.exit(1) }

// A pill is any radius at least half the row height; 48px rows make 100px a safe floor that still
// catches 999px, 9999px and the occasional 50vh.
const PILL_MIN = 100

// Does this line open a rule whose selector list names `cls` as a WHOLE selector? `.vtl-collapse, .vtl-home {`
// counts (the home link joined Collapse's rule so the two share one box); `.vtl-collapse:hover`,
// `.vtl-collapse-tx` and `.vtl.rail-collapsed .vtl-collapse` do not.
function opensRuleFor(ln, cls) {
  const m = ln.match(/^\s*([^{}]+)\{/)
  return !!m && m[1].split(',').map((x) => x.trim()).includes(cls)
}

function auditLines(lines) {
  const problems = []

  // ── the reference: .vtl-collapse's literal radius, read from the file, never assumed ──────────
  const collapse = []
  lines.forEach((ln, i) => {
    if (!opensRuleFor(ln, '.vtl-collapse')) return
    const m = ln.match(/border-radius:\s*([^;]+);/)
    if (m) collapse.push({ line: i + 1, value: m[1].trim() })
  })
  if (!collapse.length) {
    problems.push('could not find a .vtl-collapse rule with a border-radius to use as the reference.\n' +
      '    This gate derives the expected value from the collapse button rather than hard-coding it,\n' +
      '    because the rule is "the tabs agree with the collapse button", not "the tabs are 8px".')
    return problems
  }
  const reference = collapse[0].value
  if (collapse.some((c) => c.value !== reference)) {
    problems.push('the .vtl-collapse copies disagree with each other: ' +
      collapse.map((c) => `:${c.line}=${c.value}`).join(' vs ') +
      '\n    Fix that first — the reference this gate measures against is not self-consistent.')
  }

  // ── the subject: every .vtl-tab rule (both synced copies) ────────────────────────────────────
  const tabs = []
  lines.forEach((ln, i) => {
    // `.vtl-tab {` only — not .vtl-tab-badge, .vtl-tab-fallback, or .vtl-tab:hover
    if (!/^\s*\.vtl-tab\s*\{/.test(ln)) return
    const m = ln.match(/border-radius:\s*([^;]+);/)
    tabs.push({ line: i + 1, value: m ? m[1].trim() : null })
  })
  if (!tabs.length) {
    problems.push('found 0 `.vtl-tab {` rules in ' + REL + '.\n' +
      '    A gate with nothing to assert is not passing; it is not running. If the class was\n' +
      '    renamed, update this gate in the same commit.')
    return problems
  }
  if (tabs.length < 2) {
    problems.push(`found only ${tabs.length} \`.vtl-tab {\` rule. This file carries its CSS TWICE ` +
      '(VTL_SHADOW_CSS and the scoped style block) and both must be present and identical — a\n' +
      '    component that is correct in one host and wrong in the other is this repo\'s most\n' +
      '    frequent defect shape.')
  }

  for (const t of tabs) {
    if (!t.value) { problems.push(`${REL}:${t.line} — .vtl-tab declares no border-radius at all.`); continue }

    // C. the regression: a pill literal reintroduced
    const px = t.value.match(/^(\d+)px$/)
    if (px && Number(px[1]) >= PILL_MIN) {
      problems.push(`${REL}:${t.line} — .vtl-tab is back to a PILL (${t.value}).\n` +
        '    The 999px stadium was SUPERSEDED on 2026-09-23. The YouTube rationale still in this\n' +
        '    file is kept as history, NOT as a current instruction — do not restore the pill from it.\n' +
        `    Expected: border-radius:var(--vtl-radius,${reference});`)
      continue
    }

    // A. the token
    const tok = t.value.match(/^var\(\s*--vtl-radius\s*,\s*([^)]+)\)$/)
    if (!tok) {
      problems.push(`${REL}:${t.line} — .vtl-tab uses the literal "${t.value}" instead of the shared token.\n` +
        '    The requirement is that the tabs, the collapse button and the filter toggles AGREE.\n' +
        '    A shared knob guarantees that; three matching literals only coincidentally satisfy it.\n' +
        `    Expected: border-radius:var(--vtl-radius,${reference});`)
      continue
    }

    // B. the fallback tracks the reference
    if (tok[1].trim() !== reference) {
      problems.push(`${REL}:${t.line} — the token fallback is ${tok[1].trim()} but .vtl-collapse ` +
        `(line ${collapse[0].line}) is ${reference}.\n` +
        '    These are the two surfaces named as needing to match. Change both or neither.')
    }
  }

  // both copies must agree with each other
  const distinct = [...new Set(tabs.map((t) => t.value))]
  if (distinct.length > 1) {
    problems.push('the two synced copies of .vtl-tab disagree: ' +
      tabs.map((t) => `:${t.line}=${t.value}`).join(' vs ') +
      '\n    Edit both or neither — check:synced-css enforces the same rule file-wide.')
  }

  return problems
}

// ── self-test: prove the gate catches the real regression, in memory ────────────────────────────
if (process.argv.includes('--self-test')) {
  const original = readFileSync(FILE, 'utf8')
  if (auditLines(original.split('\n')).length) {
    console.error('TAB-RADIUS SELF-TEST: FAIL — the tree is already failing; fix that first.')
    process.exit(1)
  }
  const cases = [
    ['pill-restored', (s) => s.replace('cursor:pointer; border-radius:var(--vtl-radius,8px); font:inherit;',
      'cursor:pointer; border-radius:999px; font:inherit;')],
    ['literal-instead-of-token', (s) => s.replace('cursor:pointer; border-radius:var(--vtl-radius,8px); font:inherit;',
      'cursor:pointer; border-radius:8px; font:inherit;')],
    // the reference must be read from Collapse's rule even inside a selector list: change ONLY that rule's
    // radius and the (unchanged) tabs no longer agree with it.
    ['collapse-radius-moved', (s) => s.split('\n').map((l) => (opensRuleFor(l, '.vtl-collapse') ? l.replace(/border-radius:\s*8px;/, 'border-radius:12px;') : l)).join('\n')],
  ]
  let bad = 0
  for (const [name, poison] of cases) {
    const mutated = poison(original)
    if (mutated === original) { console.error(`  ${name}: POISON DID NOT APPLY — the gate proves nothing.`); bad++; continue }
    const caught = auditLines(mutated.split('\n')).length > 0
    console.log(`  ${name}: ${caught ? 'caught' : 'NOT CAUGHT'}`)
    if (!caught) bad++
  }
  if (bad) { console.error(`TAB-RADIUS SELF-TEST: FAIL — ${bad} case(s) not caught.`); process.exit(1) }
  console.log('TAB-RADIUS SELF-TEST: PASS — every regression caught; tree untouched (poisoned in memory).')
  process.exit(0)
}

const problems = auditLines(readFileSync(FILE, 'utf8').split('\n'))
if (problems.length) {
  console.error(`TAB-RADIUS: FAIL — ${problems.length} problem(s).\n`)
  for (const p of problems) console.error('  ✗ ' + p + '\n')
  process.exit(1)
}
console.log('TAB-RADIUS: PASS — .vtl-tab reads var(--vtl-radius) in both synced copies, and the')
console.log('  fallback matches .vtl-collapse. The .vtl-cap badge keeps its pill by design: the')
console.log('  complaint was the ratio of radius to size, not the shape itself.')
