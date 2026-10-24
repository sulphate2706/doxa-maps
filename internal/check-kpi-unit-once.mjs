#!/usr/bin/env node
/**
 * check-kpi-unit-once.mjs — a KPI must print its unit exactly once.
 *
 * THE DEFECT THIS CATCHES. The dashboard rendered "99%  % UNREACHED" and "1%  ADOPTED %".
 * `kpiText()` returns `k.value` unchanged when `kind === 'pct'`, and that value already carries its
 * percent sign; the labels in dashboard.config.js carried a second one ('% unreached', 'Adopted %').
 *
 * ★ WHY IT SURVIVED REVIEW, which is the point of gating it. Each half is correct on its own. A
 * label reading '% unreached' is a perfectly reasonable label. A formatter that returns a
 * ready-formatted percentage is a perfectly reasonable formatter. Only the COMPOSITION is wrong,
 * and nothing in either file mentions the other. It was found by reading the rendered screenshot —
 * no amount of reading either source file would have shown it.
 *
 * WHAT IT ASSERTS. No `kind: 'pct'` KPI label contains a '%'. That is the whole rule, and it is
 * one-sided on purpose: the VALUE is the right place for the unit (it is produced by the formatter
 * that knows the number), so the label must not repeat it. If a future KPI kind formats without a
 * unit, add that kind here rather than relaxing the rule.
 *
 * Parses the config as TEXT rather than importing it. dashboard.config.js is plain data, but the
 * research-dashboard module graph reaches library/colors/_registry.js, which uses Vite's
 * `import.meta.glob` and throws under plain node — the trap documented in
 * documentation/reference.md. Text parsing keeps the gate hermetic: no build, no browser, no
 * network, so it can live in build:unlocked.
 *
 * NEGATIVE-TESTED: restoring either label ('% unreached' or 'Adopted %') fails by name with exit 1.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CFG = join(ROOT, 'plugin-designs/research-dashboard/dashboard.config.js')

if (!existsSync(CFG)) {
  console.error('KPI-UNIT: FAIL — dashboard.config.js not found at ' + CFG.replace(ROOT + '/', ''))
  process.exit(1)
}
const src = readFileSync(CFG, 'utf8')

// Strip comments before scanning. This file now DOCUMENTS the defect in a comment right above the
// fixed line, and a naive scan matches that prose and fails on the explanation of the fix — the
// same self-reference that has bitten three gates in this repo already.
// The translated labels live in the catalogue, so the rule has to reach them too.
const LOC_DIR = resolve(ROOT, 'library/i18n/locales')
const LOCALES = existsSync(LOC_DIR) ? readdirSync(LOC_DIR) : []
const catalogue = (loc) => {
  try { return JSON.parse(readFileSync(resolve(LOC_DIR, loc, 'dashboard.json'), 'utf8')) } catch { return {} }
}

const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// Each KPI entry is an object literal: { id: '…', label: '…', kind: '…', … }.
// ★ IT MAY NOW CONTAIN ONE LEVEL OF NESTED BRACES. The labels became GETTERS when the dashboard was
// translated (`get label() { return tStatic('dashboard.unreached') || 'unreached' }`), and the old
// single-brace pattern stopped matching every entry — the gate found ZERO pct KPIs and failed
// exactly as it was built to, rather than printing a green PASS about nothing. That refusal is the
// gate working; this is the parse catching up with the config, not a relaxation of the rule.
const entries = [...code.matchAll(/\{(?:[^{}]|\{[^{}]*\})*\bid:\s*'([^']+)'(?:[^{}]|\{[^{}]*\})*\}/g)]
const offenders = []
let pctSeen = 0

for (const m of entries) {
  const body = m[0]
  const kind = (body.match(/\bkind:\s*'([^']+)'/) || [])[1]
  if (kind !== 'pct') continue
  pctSeen++
  // Two label forms: a plain literal, or a getter that falls back to one.
  const plain = (body.match(/\blabel:\s*'([^']*)'/) || [])[1]
  const viaGetter = body.match(/get label\(\)\s*\{[^}]*?tStatic\('([^']+)'\)\s*\|\|\s*'([^']*)'/)
  const label = plain ?? (viaGetter ? viaGetter[2] : undefined)
  if (label && label.includes('%')) offenders.push({ id: m[1], label })
  // ★ AND CHECK WHAT A NON-ENGLISH READER SEES. The rule is about the rendered label carrying a
  // second percent sign, and a translation can reintroduce one where the English fallback has none.
  if (viaGetter) {
    const key = viaGetter[1].replace(/^dashboard\./, '')
    for (const loc of LOCALES) {
      const v = catalogue(loc)[key]
      if (typeof v === 'string' && v.includes('%')) offenders.push({ id: m[1] + ' [' + loc + ']', label: v })
    }
  }
}

if (!pctSeen) {
  // A gate that finds nothing to check must say so rather than printing a green PASS. If the
  // config is refactored so this regex stops matching, silence would read as success forever.
  console.error("KPI-UNIT: FAIL — found no `kind: 'pct'` KPI entries to check.")
  console.error('  Either the config changed shape or the parse broke. A gate with nothing to')
  console.error('  assert is not passing; it is not running.')
  process.exit(1)
}

if (offenders.length) {
  console.error(`KPI-UNIT: FAIL — ${offenders.length} percent KPI label(s) carry a redundant '%'.\n`)
  for (const o of offenders) {
    console.error(`  id "${o.id}" has label '${o.label}'`)
    console.error(`      renders as "<value>%  ${o.label.toUpperCase()}" — the unit twice.`)
  }
  console.error("\n  kpiText() returns k.value unchanged for kind:'pct', and that value already")
  console.error('  carries its percent sign. The VALUE owns the unit; the LABEL says what is being')
  console.error('  measured. Drop the % from the label.')
  process.exit(1)
}

console.log(`KPI-UNIT: PASS — ${pctSeen} percent KPI(s), none repeating the unit in its label.`)
console.log('  Each half of this bug looks correct alone; only the composition was wrong, which is')
console.log('  why it was found by reading a screenshot rather than by reading either source file.')
