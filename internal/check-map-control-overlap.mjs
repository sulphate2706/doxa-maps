#!/usr/bin/env node
/**
 * check-map-control-overlap — two controls pinned to the same corner of the dashboard map must not
 * land on top of each other.
 *
 * Reported 2026-09-28 (test round 2, #3): some map controls overlap each other.
 *
 * WHAT HAPPENED, because it is the interesting part. The projection toggle (.rd-proj) sits at
 * top:8px and the zoom toolbar (.rd-zoomtools) was pinned at top:34px — a hand-tuned number chosen
 * when the toggle measured 23px tall, which the panel's own comment records as a live measurement
 * ("this rendered 74x23"). A later accessibility fix gave the toggle min-height:24px to satisfy WCAG
 * 2.5.8. Nothing in that shadow root sets box-sizing globally, so 24 was a CONTENT height: the
 * rendered box became 24 + 4+4 padding + 1+1 border = 34px, ending at y=42 and running 8px into a
 * toolbar whose z-index:10 drew straight over it. A correct fix to one control broke another,
 * because the agreement between them lived as a magic number in a second rule.
 *
 * So this check does not assert either number. It COMPUTES the toggle's rendered height from its own
 * declarations — honouring box-sizing, the way a browser does — and requires the toolbar to start
 * below it. Restating "34" here would have re-created the bug in a different file.
 *
 * Headless, no browser, no dependencies. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = 'plugin-designs/research-dashboard/src/components/dashboards/DashboardMapPanel.vue'
const SRC = readFileSync(resolve(ROOT, FILE), 'utf8')
// Comments record measurements and mention the old numbers on purpose; they must not be readable
// as declarations. (A predicate matching a docstring is a mistake this repo's gates have made.)
const CSS = SRC.replace(/\/\*[\s\S]*?\*\//g, '')

const fails = []
const ok = (what, cond, detail) => { if (!cond) fails.push(what + (detail ? `\n      ${detail}` : '')) }

// ── read the declarations we depend on ────────────────────────────────────────
const ruleBody = (selector) => {
  // last matching rule wins, the way the cascade would for equal specificity
  const re = new RegExp(String.raw`(^|[\s},])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*\{([^}]*)\}`, 'g')
  let m, body = null
  while ((m = re.exec(CSS))) body = m[2]
  return body
}
const allBodies = (selector) => {
  const re = new RegExp(String.raw`(^|[\s},])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*\{([^}]*)\}`, 'g')
  const out = []; let m
  while ((m = re.exec(CSS))) out.push(m[2])
  return out
}
const decl = (body, prop) => {
  if (!body) return null
  const re = new RegExp(String.raw`(?:^|;)\s*${prop}\s*:\s*([^;]+)`, 'i')
  const m = body.match(re)
  return m ? m[1].trim() : null
}
const px = (v) => { const m = String(v ?? '').match(/(-?[\d.]+)px/); return m ? parseFloat(m[1]) : null }

// custom properties, read from the element that declares them
const wrap = ruleBody('.rd-mapwrap')
const VARS = {}
for (const name of ['--rd-proj-h', '--rd-proj-top', '--rd-ctl-gap']) {
  VARS[name] = px(decl(wrap, name.replace('--', '--')))
  ok(`${name} is declared on .rd-mapwrap`, VARS[name] != null,
    'the toolbar derives its offset from these; an undeclared one silently falls back to the literal default')
}

// resolve a value that may be a var() or a calc() of vars/lengths
const resolveLen = (raw) => {
  if (raw == null) return null
  let v = String(raw)
  v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fb) => {
    const got = VARS[name]
    return got != null ? `${got}px` : (fb ? fb.trim() : '0px')
  })
  const calc = v.match(/^calc\((.+)\)$/)
  if (calc) {
    const parts = calc[1].split('+').map((p) => px(p.trim()))
    if (parts.some((p) => p == null)) return null
    return parts.reduce((a, b) => a + b, 0)
  }
  return px(v)
}

// ── .rd-proj: what the browser will actually render ───────────────────────────
const projBodies = allBodies('.rd-proj')
ok('.rd-proj is declared', projBodies.length > 0)
const proj = projBodies.join(';')
const projTop = resolveLen(decl(proj, 'top'))
const projMinH = resolveLen(decl(proj, 'min-height'))
const projPad  = decl(proj, 'padding')
const projBorder = decl(proj, 'border')
const projBox  = (decl(proj, 'box-sizing') || 'content-box').trim()

ok('.rd-proj declares a top', projTop != null)
ok('.rd-proj declares a min-height (the WCAG 2.5.8 touch target)', projMinH != null)

// padding: "4px 9px" -> vertical is the first value
const padY = projPad ? (px(projPad.split(/\s+/)[0]) ?? 0) * 2 : 0
const borderY = projBorder ? (px(projBorder.split(/\s+/)[0]) ?? 0) * 2 : 0
// content-box adds padding and border OUTSIDE the declared min-height; border-box does not.
const projH = projBox === 'border-box' ? projMinH : (projMinH ?? 0) + padY + borderY
const projBottom = (projTop ?? 0) + projH

// ── .rd-zoomtools: every rule that sets a top, including the mobile restatement ─
const toolTops = allBodies('.rd-zoomtools.rd-zoomtools')
  .map((b) => resolveLen(decl(b, 'top')))
  .filter((t) => t != null)
ok('.rd-zoomtools pins a top somewhere', toolTops.length > 0)

for (const top of toolTops) {
  ok('THE ZOOM TOOLBAR CLEARS THE PROJECTION TOGGLE (they share the top-right corner)',
    top >= projBottom,
    `.rd-proj renders ${projH}px tall as ${projBox} (min-height ${projMinH} + ${padY} padding + ${borderY} border) ` +
    `at top ${projTop}, so it ends at y=${projBottom}; a toolbar top of ${top} overlaps by ${projBottom - top}px`)
}

// The toolbar must DERIVE its offset, not restate a number: that is what let the two drift apart.
const derived = allBodies('.rd-zoomtools.rd-zoomtools')
  .map((b) => decl(b, 'top')).filter(Boolean)
ok('the toolbar offset is derived from the toggle, not hard-coded',
  derived.length > 0 && derived.every((t) => /var\(\s*--rd-proj-h/.test(t)),
  'a literal top here is the exact shape of the original bug: correct today, wrong the next time the toggle changes size')

// And the toggle must stay a legitimate touch target after the box-sizing change.
ok('.rd-proj is still at least 24px tall (WCAG 2.5.8)', projH >= 24,
  `border-box means min-height includes padding and border; rendered ${projH}px`)

if (fails.length) {
  console.error('MAP-CONTROL-OVERLAP: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`MAP-CONTROL-OVERLAP: PASS — the projection toggle renders ${projH}px as ${projBox} and ends at y=${projBottom}; every .rd-zoomtools rule starts at or below that, and each derives the offset from --rd-proj-h rather than restating it.`)
