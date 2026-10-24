#!/usr/bin/env node
/**
 * check-one-scroll-container — a plugin pinned into the gallery's pane must not assert a height FLOOR
 * the pane cannot honour.
 *
 * THE DEFECT THIS EXISTS FOR (2026-09-28, a much-disliked bug): on DX Life's
 * research page a capability-4 plugin with tabs at the top had an EXTRA element-level scrollbar, and
 * scrolling it scrolled the TAB HEADER out of view — on top of the plugin's own content scroll.
 *
 * WHY IT HAPPENED, AND WHY A COMMENT WAS NOT ENOUGH. doxa-maps-spa pins each fixed-viewport plugin
 * with position:absolute;inset:0;height:100% and its own comment states the invariant: "fills the pane
 * exactly, so scrollHeight===clientHeight and overflow:auto paints NO scrollbar." CSS does not grant
 * that. A used height is CLAMPED between min-height and max-height, so a child's own min-height beats
 * the height:100% the shell sets — it is a floor, not a preference. Wherever the pane was shorter than
 * that floor the pinned element grew taller than the pane, .dms-slot grew with it, and .dms-pane's
 * overflow-y:auto became a real scroll container wrapping the WHOLE plugin, tab strip included.
 *
 * SO THIS GATE ASSERTS BOTH HALVES, because either alone rots:
 *   1. the shell still pins with min-height:0 — the one property that defeats a :host floor;
 *   2. no plugin grows a NEW floor on an element inside its own shadow root, where (1) cannot reach.
 * (2) is the half that matters over time: a fixed shell plus a plugin that adds .foo{min-height:700px}
 * next month is the same bug again, and nobody would connect it to this.
 *
 * Source-level and headless BY DESIGN. This gate runs no browser, and the browser proof is a separate
 * scroll-container count. This is the cheap guard that keeps the class from coming back between runs.
 * ★ THIS GATE IS RED ON PURPOSE AT LANDING, and is NOT wired into gates:pre yet. gospel-internet's
 * .gb still carries min-height:640px; that fix belongs to its owner, not to me, and wiring a red gate
 * into gates:pre would block the whole fleet on someone else's file. Add the gates:pre entry in the
 * same landing that fixes .gb -- until then this is the work item, afterwards it is the guard.
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'ONE-SCROLL-CONTAINER'
const fails = []

// ── 1. the shell pins with a defeated floor ────────────────────────────────────────────────────
const SHELL = join(ROOT, 'plugin-designs/doxa-maps-spa/doxa-maps-spa.vue')
const shell = readFileSync(SHELL, 'utf8')
const pinned = shell.match(/'display:block;position:absolute;inset:0;[^']*'/)
if (!pinned) {
  fails.push('doxa-maps-spa: could not find the pinned cssText at all — it was rewritten; re-read this gate')
} else if (!/min-height:\s*0/.test(pinned[0])) {
  fails.push(`doxa-maps-spa pins a plugin WITHOUT min-height:0, so any child floor wins over height:100%:\n      ${pinned[0]}`)
}

// ── 2. no plugin asserts a floor the shell cannot defeat ───────────────────────────────────────
// A floor on :host is FINE: the shell's inline min-height:0 outranks it. A floor on an inner selector
// is not reachable from outside the shadow root, so it must be relative (inherit / %) rather than a
// constant taller than a short pane. THRESHOLD: 400px. Below that a floor cannot exceed a realistic
// pane, and small min-heights (rows, buttons, toolbars) are everywhere and are not this bug.
const THRESHOLD = 400
const DESIGNS = join(ROOT, 'plugin-designs')
for (const bundle of readdirSync(DESIGNS)) {
  const dir = join(DESIGNS, bundle)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
  if (!readdirSync(dir).some((f) => f.endsWith('.vue'))) continue
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.vue'))) {
    // Join CSS built by JS string concatenation ('…' + \n '…') so a rule split across lines is seen.
    const src = readFileSync(join(dir, file), 'utf8').replace(/'\s*\+\s*\n\s*'/g, '')
    for (const rule of src.match(/[^;{}\n]*\{[^{}]*min-height:\s*\d+px[^{}]*\}/g) || []) {
      const px = Number((rule.match(/min-height:\s*(\d+)px/) || [])[1])
      if (!Number.isFinite(px) || px < THRESHOLD) continue
      // ★ THE DEFECT IS A CONTRADICTION IN ONE RULE, not a large min-height on its own. The flagged
      // shape is an element that says height:100% -- "I fill whatever box holds me" -- and in the same
      // breath refuses to be shorter than N. Only that element is trying to be the pane and failing.
      // A deliberately TALL inner region is not this bug: gospel-resources' .gd-map is
      // height:80svh;min-height:420px, a map sized to the viewport on purpose, and it scrolls inside
      // its own root's content scroller, which is the ONE scrollbar the plugin is allowed. Flagging it
      // would have sent its owner after a non-bug, which is worse than not having this gate.
      if (!/height:\s*100%/.test(rule)) continue
      // The CSS is often a JS string, so a selector can arrive carrying the opening quote and the
      // tail of a concatenation. Strip those before testing, or a :host rule reads as ":host and
      // reports itself as an inner selector — which it is not, and the shell already defeats it.
      const selector = rule.slice(0, rule.indexOf('{')).trim().split('\n').pop()
        .replace(/^[\s'"+,]+/, '').trim()
      // :host floors are defeated by the shell; anything else is not.
      if (/^:host/.test(selector)) continue
      fails.push(
        `${bundle}/${file}: "${selector}" sets min-height:${px}px inside the shadow root.\n` +
        '      The shell cannot defeat this from outside, so in a pane shorter than ' + px + 'px it\n' +
        '      grows a second scroll container that scrolls the tab strip away. Use min-height:inherit\n' +
        '      (defer to :host, which the shell pins to 0) or drop the floor.',
      )
    }
  }
}

// ── ★ THE HOST-SIZED SCROLLER IS A THREE-LINE SHAPE, AND IT MUST BE PORTED WHOLE ────────────────
// A pane that fills its host absolutely AND turns on overflow is also, necessarily, the thing that
// scrolls whatever its child overflows by. library/ProfileLoader.vue floors EVERY profile at
// `min-height: var(--profile-min-h, 100svh)` -- a VIEWPORT measurement -- while such a pane measures
// against its HOST. So on any page with chrome above it, the child is taller than the pane by exactly
// the height of that chrome, and the pane scrolls the whole plugin, tab strip and all.
//
// That floor lives inside the child's SHADOW ROOT, where no host-page selector reaches. The single
// lever is the inherited custom property, which ProfileLoader documents as the opt-out. So the three
// belong together: fill the host, own the overflow, and release the child's viewport floor.
//
// ★ THIS IS GATED BECAUSE IT WAS ALREADY PORTED ONCE AND ARRIVED SHORT. doxa-maps-spa's .dms-pane was
// copied from VerticalTabsLayout's .vtl-host -- its own comment says "porting the same proven shape" --
// and took the first two lines. A browser check measured the result: 12 of 16 gallery tabs overflowing by exactly
// the DX-life header height, on plugins with no floor of their own. Two thirds of a fix reads as a
// whole one in review, which is precisely why a reviewer cannot be the check.
for (const [file, label] of [
  ['plugin-designs/doxa-maps-spa/doxa-maps-spa.vue', '.dms-pane'],
  ['library/layouts/VerticalTabsLayout.vue', '.vtl-host'],
]) {
  const p = join(ROOT, file)
  if (!existsSync(p)) { fails.push(`${file} is gone — this gate names it by path and now checks nothing`); continue }
  const src = readFileSync(p, 'utf8')
  // The rule for each pane: any rule that is BOTH absolutely-filling AND scrolling must release the floor.
  const rules = src.match(/[^{}\n]*\{[^{}]*\}/g) || []
  const scrollers = rules.filter((r) => /position:\s*absolute/.test(r) && /inset:\s*0/.test(r) && /overflow(-y)?:\s*auto/.test(r))
  if (!scrollers.length) {
    fails.push(`${file}: no absolutely-filling scroller found for ${label} — the shape moved and this gate is now blind to it`)
    continue
  }
  for (const r of scrollers) {
    if (!/--profile-min-h:\s*0/.test(r)) {
      const sel = r.slice(0, r.indexOf('{')).trim().split('\n').pop().trim()
      fails.push(`${file}: "${sel}" fills its host and owns the overflow but does NOT set --profile-min-h:0.\n`
        + '      ProfileLoader floors every child at 100svh (the VIEWPORT), so on a page with a header the\n'
        + '      child is taller than this pane by the header height and this pane scrolls the whole plugin,\n'
        + '      tab strip included. The three lines are one shape: fill, scroll, release the floor.')
    }
  }
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — the gallery pins plugins with min-height:0, and no plugin asserts a floor inside its shadow root that a short pane could not honour, and every host-sized scroller releases ProfileLoader's viewport floor.`)
