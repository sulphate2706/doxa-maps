#!/usr/bin/env node
/**
 * check-dashboard-filter-a11y.mjs — the dashboard's cross-filter must be OPERABLE and AUDIBLE.
 *
 * THE TWO DEFECTS THIS EXISTS TO PREVENT (both measured on main, 2026-09-26, both shipped).
 *
 *   1. A FILTER YOU CAN SET BUT CANNOT CLEAR WITHOUT A MOUSE. The filter chips were
 *      `<span data-chip>` with click delegation on the bar. A span is not focusable, carries no
 *      role, and the browser fires no click for it on Enter or Space. Every control that SETS a
 *      filter is keyboard-operable (the tree rail's rows, the dropdowns, the geocoder), so a
 *      keyboard user could walk into a narrowed board with no way out but reloading the page.
 *      That asymmetry — reachable in, unreachable out — is the defect, not the missing role.
 *
 *   2. A CROSS-FILTER THAT ANNOUNCES NOTHING. The whole point of brushing-and-linking is that
 *      acting on ONE control changes a number somewhere ELSE. The element contained exactly one
 *      role="status" (the table's selection pill) and ZERO aria-live regions, so a sighted user
 *      watched 2,107 become 693 across six surfaces while a screen-reader user was told nothing
 *      at all. The filter worked; the feedback did not exist.
 *
 * PLUS the localization half of the same class: a `role="separator"` resize handle whose
 * aria-label is a RAW ENGLISH LITERAL announces itself in English in all 11 locales. Four of the
 * five handles read theirs through T(); the map/table one did not, and it survived review because
 * each half looks correct on its own — the ternary is right, the strings are right, and only the
 * missing T( is wrong.
 *
 * ★ WHY THIS IS AN AST WALK AND NOT A GREP. grep cannot tell `:aria-label="T(...)"` (a bound
 * expression) from `aria-label="T(...)"` (a literal that happens to contain the characters), cannot
 * tell a chip that is a <button> from a <span> whose class is named like one, and cannot see that a
 * live region sits inside a v-show'd cell. The template is parsed with @vue/compiler-sfc and the
 * ELEMENT TREE is asserted, so every check is about the structure that ships.
 *
 * ★ AND WHY IT ALSO READS THE BUILT BUNDLE. Source-correct + bundle-stale is a real, repeated
 * failure here (check-composite-interop carries the same part B for the same reason): a gate that
 * only reads source will pass while the reader gets last week's element.
 *
 * NO BROWSER. Playwright runs only in the browser QA step (project policy). Nothing here launches one.
 *
 * NEGATIVE-TESTED 2026-09-26 — each of these makes it FAIL, naming the file and the reason:
 *   chips back to <span>                        -> A1 "chip is a <span>, not a <button>"
 *   type="button" removed                       -> A2
 *   :aria-label removed from the chip           -> A3 (no accessible name)
 *   the live region given v-if="…"              -> B3
 *   aria-live changed to "assertive"            -> B1 (no polite region)
 *   the map/table aria-label put back to a raw  -> C   "aria-label is a raw literal"
 *   string literal
 *   a stale bundle (source fixed, not rebuilt)  -> D
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { TREE_NAME } from '../../../internal/_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CHIPS = join(ROOT, 'library/components/dashboards/DashboardFilterChips.vue')   // moved by kit landing 4c-2
const SHELL = join(ROOT, 'plugin-designs/research-dashboard/research-dashboard.vue')
// ★ THE CHIPS THE USER ACTUALLY TOUCHES ARE NOT IN DashboardFilterChips.vue.
// That component is exported from the kit's index.js and mounted by NOBODY — DashboardTopBar's
// header records why (round 1 of BUG-DUPLICATE-FILTER-BADGES removed it, and the second header's
// SearchFilterHeader has rendered the live strip ever since). A gate that only read the kit file
// would therefore be green about a screen that does not exist and blind to the one that does —
// the same "numeric probe for the wrong noun" that let the duplicate-badges bug survive ~50
// reports. Both are checked: the LIVE strip so a regression is caught, and the kit file so the
// defect is not lying in wait for the next dashboard that mounts it.
const LIVE_CHIPS = join(ROOT, 'library/components/search/SearchFilterHeader.vue')

const fails = []
const notes = []
const fail = (code, msg) => fails.push(`${code}  ${msg}`)

// ── template AST helpers ─────────────────────────────────────────────────────────────────────
// @vue/compiler-sfc node types: 1 = ELEMENT, 2 = TEXT, 5 = INTERPOLATION.
// props entries: type 6 = plain ATTRIBUTE (name/value), type 7 = DIRECTIVE (v-bind/v-if/v-show/…).
function templateAst(file) {
  const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file })
  if (errors && errors.length) throw new Error(`${file}: ${errors[0].message}`)
  if (!descriptor.template) throw new Error(`${file}: no <template>`)
  return descriptor.template.ast
}
function walk(node, visit) {
  if (!node) return
  if (node.type === 1) visit(node)
  for (const c of node.children || []) walk(c, visit)
}
function elements(ast) { const out = []; walk(ast, (n) => out.push(n)); return out }

/** A plain attribute's value, or undefined when it is absent or bound. */
const attr = (el, name) => {
  const p = (el.props || []).find((q) => q.type === 6 && q.name === name)
  return p ? (p.value ? p.value.content : '') : undefined
}
/** A v-bind:<name> / :<name> directive's expression source, or undefined. */
const bound = (el, name) => {
  const p = (el.props || []).find((q) => q.type === 7 && q.name === 'bind'
    && q.arg && q.arg.type === 4 && q.arg.content === name)
  return p && p.exp ? p.exp.content : undefined
}
/** True when the element carries the named structural directive (v-if / v-else-if / v-show). */
const hasDirective = (el, name) => (el.props || []).some((q) => q.type === 7 && q.name === name)
/** True when the element renders any non-whitespace text or interpolation, at any depth. */
function hasText(el) {
  let found = false
  const rec = (n) => {
    if (found || !n) return
    if (n.type === 2 && String(n.content).trim()) found = true
    if (n.type === 5) found = true
    for (const c of n.children || []) rec(c)
  }
  for (const c of el.children || []) rec(c)
  return found
}
const has = (el, name) => attr(el, name) !== undefined || bound(el, name) !== undefined

// ── A. THE CHIPS ARE OPERABLE BUTTONS ────────────────────────────────────────────────────────
{
  const ast = templateAst(CHIPS)
  const chips = elements(ast).filter((el) => has(el, 'data-chip'))
  if (!chips.length) fail('A0', `${CHIPS}: no [data-chip] element found — the chip bar moved or was renamed; this gate is now blind.`)
  for (const el of chips) {
    const which = attr(el, 'data-chip') !== undefined ? `data-chip="${attr(el, 'data-chip')}"` : 'data-chip (bound)'
    if (el.tag !== 'button') {
      fail('A1', `DashboardFilterChips.vue: ${which} is a <${el.tag}>, not a <button> — not focusable, and Enter/Space fire no click, so a filter set by keyboard cannot be cleared by keyboard.`)
      continue
    }
    if (attr(el, 'type') !== 'button') {
      fail('A2', `DashboardFilterChips.vue: ${which} has no type="button" — inside a partner page's <form> it would default to submit and post the form on every chip press.`)
    }
    // Accessible name precedence: aria-label -> visible text. `title` is NOT one.
    //
    // ★ THE TWO CHIPS HAVE OPPOSITE REQUIREMENTS, and that is not an inconsistency.
    // A REMOVABLE chip ([data-filter-chip]) reads "Religion: Islam". That is a perfectly good
    // accessible NAME and a useless accessible ACTION: announced alone it tells the user what the
    // filter is, never that pressing removes it. So it must carry an explicit aria-label naming
    // the action. (This is the one case where "it already has visible text" is the wrong answer,
    // which is why it is asserted rather than inferred.)
    // The RESET-ALL chip reads "Reset all" — the words already ARE the action, so an aria-label
    // would only override what the user can see and break voice control ("click Reset all").
    const label = bound(el, 'aria-label') ?? attr(el, 'aria-label')
    const removable = has(el, 'data-filter-chip')
    if (removable && !label) {
      fail('A3', `DashboardFilterChips.vue: ${which} is removable but has no aria-label — its visible text names the FILTER ("Religion: Islam"), not the ACTION, so it announces as a filter you cannot tell is a remove button. (title is a tooltip, not an accessible name.)`)
    }
    if (!removable && !label && !hasText(el)) {
      fail('A3', `DashboardFilterChips.vue: ${which} has neither an aria-label nor visible text — it would be announced as a bare "button".`)
    }
    if (!removable && label && hasText(el)) {
      fail('A4', `DashboardFilterChips.vue: ${which} has BOTH visible text and an aria-label — the label overrides the words the user can see, which breaks voice control.`)
    }
  }
  notes.push(`kit chips (unmounted): ${chips.length} [data-chip] element(s), all <button type="button"> with an accessible name`)
}

// ── A-LIVE. THE STRIP THAT IS ACTUALLY ON SCREEN ─────────────────────────────────────────────
// SearchFilterHeader is library/ (rule 5B — studio lands changes to it). This gate only READS it,
// and it PASSES today: the ✕ is already a real <button type="button"> with a localized aria-label
// and "Clear All" is already a real button. That is worth pinning precisely BECAUSE it is already
// right — the failure mode here is a future refactor turning either back into a <span>, which no
// build error would catch.
{
  const ast = templateAst(LIVE_CHIPS)
  const els = elements(ast)
  const x = els.filter((el) => (attr(el, 'class') || '').split(/\s+/).includes('sfh__chip-x'))
  const clear = els.filter((el) => (attr(el, 'class') || '').split(/\s+/).includes('sfh__clear'))
  if (!x.length) fail('A5', `SearchFilterHeader.vue: no .sfh__chip-x remove control found — the LIVE chip strip moved or was renamed; this gate is now blind to the only chips on screen.`)
  for (const el of x) {
    if (el.tag !== 'button') fail('A6', `SearchFilterHeader.vue: the chip ✕ is a <${el.tag}>, not a <button> — a filter that can be SET from the keyboard could not be CLEARED from the keyboard.`)
    else if (attr(el, 'type') !== 'button') fail('A7', `SearchFilterHeader.vue: the chip ✕ has no type="button".`)
    const label = bound(el, 'aria-label') ?? attr(el, 'aria-label')
    if (!label) fail('A8', `SearchFilterHeader.vue: the chip ✕ has no aria-label — its only content is "×", which announces as nothing useful.`)
    else if (attr(el, 'aria-label') !== undefined) fail('A9', `SearchFilterHeader.vue: the chip ✕ aria-label is a raw literal (${JSON.stringify(attr(el, 'aria-label'))}) — it announces in English in all 11 locales.`)
  }
  if (!clear.length) fail('A5', `SearchFilterHeader.vue: no .sfh__clear control found.`)
  for (const el of clear) {
    if (el.tag !== 'button') fail('A6', `SearchFilterHeader.vue: "Clear all" is a <${el.tag}>, not a <button>.`)
  }
  notes.push(`live chips (SearchFilterHeader): ✕ and "Clear all" are real <button type="button">, ✕ named from the catalogue`)

  // ── THE ✕ IS BIG ENOUGH TO HIT (WCAG 2.5.8) ────────────────────────────────────────────────
  // The chip's box is pinned to --dx-sel-row-h (16px) to hold a measured fixed-height invariant,
  // and the ✕ carries padding:0 — so the only way OUT of a narrowed board was a ~13x16px glyph.
  // The fix cannot be a taller button (that reopens the layout-shift bug the pin exists for), so
  // it is an absolutely-positioned 24x24 ::after: pointer surface without intrinsic size.
  // ASSERTED IN CSS because there is nothing else to read — no DOM, no browser. The failure this
  // catches is a future author deleting the overlay as "an empty pseudo-element doing nothing".
  {
    const { descriptor } = parse(readFileSync(LIVE_CHIPS, 'utf8'), { filename: LIVE_CHIPS })
    const css = (descriptor.styles || []).map((s) => s.content).join('\n')
    const rule = /\.sfh__chip-x::after\s*\{([^}]*)\}/.exec(css)
    if (!rule) {
      fail('A10', `SearchFilterHeader.vue: no .sfh__chip-x::after rule — the chip ✕ is back to a ~13x16px target, and it is the ONLY way out of a narrowed board. (2.5.8 is a TARGET SIZE criterion: the floor applies at every width, never behind @media (pointer: coarse).)`)
    } else {
      const body = rule[1]
      for (const dim of ['width', 'height']) {
        const m = new RegExp(`(?:^|;|\\s)${dim}\\s*:\\s*(\\d+)px`).exec(body)
        if (!m) fail('A11', `SearchFilterHeader.vue: .sfh__chip-x::after has no explicit ${dim} in px — the hit area is not measurable.`)
        else if (Number(m[1]) < 24) fail('A11', `SearchFilterHeader.vue: .sfh__chip-x::after ${dim} is ${m[1]}px, under the 24px target-size floor.`)
      }
      if (!/position\s*:\s*absolute/.test(body)) {
        fail('A12', `SearchFilterHeader.vue: .sfh__chip-x::after is not position:absolute — an in-flow 24px box would grow the chip past the pinned --dx-sel-row-h and reopen the layout shift that pin exists to prevent.`)
      }
      notes.push('live chip ✕: a 24x24 absolutely-positioned hit area, so the row height is untouched')
    }
  }
}

// ── B. THE SHELL HAS ONE ALWAYS-PRESENT POLITE LIVE REGION ───────────────────────────────────
const shellAst = templateAst(SHELL)
{
  const all = elements(shellAst)
  const polite = all.filter((el) => (attr(el, 'aria-live') || bound(el, 'aria-live')) === 'polite')
  if (!polite.length) {
    fail('B1', `research-dashboard.vue: no aria-live="polite" region. A cross-filter changes a number FAR from the control that changed it; with no live region a screen-reader user is told nothing when 2,107 becomes 693.`)
  } else if (polite.length > 1) {
    fail('B2', `research-dashboard.vue: ${polite.length} polite live regions — a single brush would be announced once per region, and polite announcements QUEUE, so the user waits through every repeat.`)
  } else {
    const el = polite[0]
    for (const d of ['if', 'else-if', 'show']) {
      if (hasDirective(el, d)) {
        fail('B3', `research-dashboard.vue: the live region carries v-${d}. A region inserted already holding its text is routinely NOT announced — the accessibility tree has to be observing the node when the text changes. It must always be rendered and start empty.`)
      }
    }
    if (attr(el, 'role') !== 'status') fail('B4', `research-dashboard.vue: the live region has no role="status".`)
    if ((attr(el, 'aria-atomic') || bound(el, 'aria-atomic')) !== 'true') {
      fail('B5', `research-dashboard.vue: the live region is not aria-atomic="true" — only the changed word is re-read, and "693" announced alone is not information.`)
    }
    if (!hasText(el)) fail('B6', `research-dashboard.vue: the live region renders no interpolation — it can never say anything.`)
    notes.push('live region: one polite role="status" aria-atomic region, always rendered')
  }
}

// ── C. EVERY RESIZE HANDLE'S NAME COMES FROM THE CATALOGUE ───────────────────────────────────
{
  const handles = elements(shellAst).filter((el) => has(el, 'data-resize'))
  if (!handles.length) fail('C0', `research-dashboard.vue: no [data-resize] handle found — this gate is now blind.`)
  for (const el of handles) {
    const which = `[data-resize="${attr(el, 'data-resize') ?? '?'}"]`
    for (const name of ['aria-label', 'title']) {
      const lit = attr(el, name)
      const exp = bound(el, name)
      if (lit !== undefined) {
        fail('C1', `research-dashboard.vue: ${which} ${name} is a raw literal (${JSON.stringify(lit)}) — it announces in English in all 11 locales.`)
      } else if (exp === undefined) {
        fail('C2', `research-dashboard.vue: ${which} has no ${name}. A role="separator" with no accessible name is announced as an unnamed widget.`)
      } else if (!/\bT\(/.test(exp)) {
        fail('C3', `research-dashboard.vue: ${which} ${name} is bound but never reaches the catalogue (no T( in ${JSON.stringify(exp)}) — it announces in English in all 11 locales.`)
      }
    }
  }
  notes.push(`resize handles: ${handles.length}, every aria-label and title read through T()`)
}

// ── D. THE SHIPPED BUNDLE CARRIES ALL OF IT ──────────────────────────────────────────────────
// Source-correct and bundle-stale is a real, repeated failure here. SKIP (not pass) when nothing
// is built, so a clean checkout is not failed for a tree it does not have.
{
  const bundle = join(ROOT, 'public', TREE_NAME, 'research-dashboard', 'research-dashboard.js')
  if (!existsSync(bundle)) {
    notes.push(`built bundle: SKIPPED — ${bundle.replace(ROOT + '/', '')} does not exist (nothing built)`)
  } else {
    const js = readFileSync(bundle, 'utf8')
    // ONLY markers that are actually MOUNTED. `data-filter-chip` and `aria.removeFilter` belong to
    // the unmounted kit component and are correctly tree-shaken out of this bundle — requiring them
    // here would be a gate demanding that dead code ship, which is how a check teaches the next
    // author to mount something that was asked to be removed.
    const need = [
      ['aria-live', 'the polite live region'],
      ['data-live-region', 'the live region marker'],
      ['aria.resizeMapTableSplit', 'the map/table handle catalogue key'],
      ['sfh__chip-x', 'the live chip remove button'],
    ]
    for (const [lit, what] of need) {
      if (!js.includes(lit)) fail('D', `built research-dashboard.js is missing ${JSON.stringify(lit)} (${what}) — the source is fixed but the SHIPPED element is not. Run: BUNDLE=research-dashboard bun x vite build && bun run tree && bun run fix:sri`)
    }
    if (!fails.some((f) => f.startsWith('D'))) notes.push('built bundle: carries the live region, the live chip button and the map/table catalogue key')
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────
for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error('\nDASHBOARD-FILTER-A11Y: FAIL')
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log('DASHBOARD-FILTER-A11Y: PASS — the chips are keyboard-operable and named, the shell announces every brush once, and no handle name is raw English.')
