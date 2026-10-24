#!/usr/bin/env node
/**
 * generate-capability-exemplars.mjs — write documentation/reference-capability-exemplars.md from the manifest.
 *
 * WHY THIS IS DERIVED AND NOT HAND-WRITTEN
 * "Which bundle is the capability-N example?" has been answered wrongly three times in three
 * different artifacts, each fixed in isolation while the others kept the bug:
 *   · internal/verify-5-capabilities.mjs cited doxa-vision-card as cap-1 — it ships an
 *     *.instances.json, so it is parameterized (cap-2). Fixed there; its own comment records that
 *     the gate had been "sampling cap-2 TWICE and cap-1 NEVER".
 *   · README.md made the identical claim in a caption and a section. Fixed 2026-09-21, and only
 *     then gated by check:capability-citations.
 *   · the /plugin-designer skill still cites doxa-vision-card as cap-1 AND cites
 *     `unified-research-dashboard` as a cap-4 reference — a bundle that DOES NOT EXIST.
 *
 * ★ THE SKILL CANNOT BE GATED FROM THIS REPO. It lives in the session config directory, in no git
 * repo, so a checker pointed at it would PASS on this machine and SKIP SILENTLY on every other —
 * the "gate that cannot fail" shape. The durable fix is not to police the skill but to give the
 * repo an authoritative, generated answer the skill (and any doc, and any future agent) can cite.
 * Prose that cites a generated file can be checked; prose that cites memory cannot.
 *
 * THE SOURCE OF TRUTH IS manifest.json, because it is what the BUILD computed from each folder's
 * real shape — an *.instances.json makes a bundle parameterized however simple it looks, and a
 * meta.json `type` declares tiers 3/4/5. capability = 5 - PROFILE_TIER (discover.mjs).
 *
 * Run: bun run capability-exemplars      Check: bun run check:capability-exemplars
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const OUT = join(ROOT, 'documentation', 'reference-capability-exemplars.md')

if (!existsSync(MANIFEST)) {
  console.error('CAPABILITY-EXEMPLARS: manifest.json not found — run a build first.')
  process.exit(1)
}

const CAP_OF_TYPE = {
  'single': 1,
  'parameterized': 2, 'preset-element': 2,
  'monolithic': 3, 'multi-view-element': 3,
  'nested-elements-mfe': 4, 'composite-element': 4,
  'nested-mfe-spa': 5, 'app-shell': 5,
}
const CAP_NAME = {
  1: 'single-element', 2: 'preset-element (prop-table)', 3: 'multi-view-element (monolithic)',
  4: 'composite-element (nested-element SPA)', 5: 'app-shell (nested-SPA)',
}

const mf = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const byCap = new Map([[1, []], [2, []], [3, []], [4, []], [5, []]])

for (const b of (mf.bundles || [])) {
  for (const p of (b.profiles || [])) {
    const cap = CAP_OF_TYPE[p.type]
    if (!cap) continue
    byCap.get(cap).push({ bundle: b.bundle, profile: p.profile, type: p.type })
  }
}

const lines = []
lines.push('# Reference — capability exemplars (GENERATED)')
lines.push('')
lines.push('> **Do not hand-edit.** Regenerate with `bun run capability-exemplars`; `bun run')
lines.push('> check:capability-exemplars` fails if this file falls behind the manifest.')
lines.push('>')
lines.push('> This answers one question authoritatively: **which bundles are the capability-N')
lines.push(`> examples right now?** It is derived from \`public/${TREE_NAME}/manifest.json\`, which is what`)
lines.push('> the build computed from each folder\'s real shape — so it cannot drift from what ships.')
lines.push('>')
lines.push('> **Cite this file rather than remembering.** The same citation has been wrong in three')
lines.push('> separate places: a gate, the README, and the `/plugin-designer` skill. The trap is that a')
lines.push('> folder\'s apparent simplicity does not decide its tier — an `*.instances.json` makes a')
lines.push('> bundle `parameterized` (cap-2) no matter how light it looks, and a `meta.json` `type`')
lines.push('> declares tiers 3/4/5.')
lines.push('')
lines.push(`Generated from ${(mf.bundles || []).length} bundle(s).`)
lines.push('')

// ── ONE CANONICAL EXEMPLAR PER TIER — the copy-paste answer ──────────────────────────────────
// WHY THIS BLOCK EXISTS (2026-09-22). The full tables below are authoritative but ~60 rows, so
// correcting a miscitation still meant reading them and DECIDING which row to quote. That is the
// step where a wrong citation gets re-invented. This picks one exemplar per tier by a stated,
// reproducible rule, so a doc or skill can quote a single line without judgement.
//
// THE RULE, in order: (1) prefer the bundle whose NAME EQUALS its profile name — a whole bundle
// that IS that one capability, rather than one profile of a multi-profile bundle; (2) DEPRIORITISE
// demo/template/self-test bundles, because an exemplar is something a reader should IMITATE and
// those exist to illustrate the machinery, not the product; (3) then alphabetical — arbitrary but
// STABLE, so this block does not churn between builds.
//
// ★ (2) WAS ADDED AFTER THE FIRST RUN PICKED `stack-demo` AS THE CAP-4 EXEMPLAR. It satisfied the
// original rule perfectly (name === profile, shortest) and was still the wrong answer to hand
// someone: `big-picture` is the canonical cap-4 composite, named as such in the Gate-1 chain and in
// the skill. A reproducible rule is not automatically a GOOD rule — check what it actually selects.
lines.push('### One canonical exemplar per tier (generated — quote these)')
lines.push('')
lines.push('| Capability | Machine key | Cite this |')
lines.push('|---|---|---|')
for (const cap of [1, 2, 3, 4, 5]) {
  const rows = byCap.get(cap) || []
  if (!rows.length) { lines.push(`| ${cap} — ${CAP_NAME[cap]} | — | _none built_ |`); continue }
  const isDemo = (n) => /^(demo|template|stack-demo|golden-path-check)|-demo$|^template-/.test(n)
  const pick = [...rows].sort((a, b) =>
    (a.bundle === a.profile ? 0 : 1) - (b.bundle === b.profile ? 0 : 1) ||
    (isDemo(a.bundle) ? 1 : 0) - (isDemo(b.bundle) ? 1 : 0) ||
    a.bundle.localeCompare(b.bundle))[0]
  lines.push(`| ${cap} — ${CAP_NAME[cap]} | \`${pick.type}\` | \`${pick.bundle}\` |`)
}
lines.push('')
lines.push('> **Known-wrong citations this block replaces** (both measured 2026-09-22, both in the')
lines.push('> `/plugin-designer` skill, which lives outside this repo and so cannot be gated from here):')
lines.push('> `unified-research-dashboard` as the cap-4 reference — **that bundle does not exist**; it')
lines.push('> became `research-dashboard` (cap-3) plus `dashboard-plus-grid` (cap-4). And')
lines.push('> `doxa-vision-card` as the cap-1 example — it ships a `doxa-vision-card.instances.json`')
lines.push('> with 2 instances, which makes it **cap-2 parameterized** by the project\'s own rule.')
lines.push('')

for (const cap of [1, 2, 3, 4, 5]) {
  const rows = byCap.get(cap)
  lines.push(`## Capability ${cap} — ${CAP_NAME[cap]}`)
  lines.push('')
  if (!rows.length) {
    lines.push('_No built bundle currently declares this tier._')
    lines.push('')
    continue
  }
  lines.push('| Bundle | Profile | Machine key |')
  lines.push('|---|---|---|')
  for (const r of rows) lines.push(`| \`${r.bundle}\` | \`${r.profile}\` | \`${r.type}\` |`)
  lines.push('')
}

writeFileSync(OUT, lines.join('\n') + '\n')
const total = [...byCap.values()].reduce((n, v) => n + v.length, 0)
console.log(`[capability-exemplars] wrote documentation/reference-capability-exemplars.md — ` +
            `${total} profile(s) across ${[...byCap.values()].filter(v => v.length).length} tier(s)`)
