#!/usr/bin/env node
/**
 * check-targets — where each plugin runs, as its <profile>.meta.json "targets" says. Headless.
 *
 * Rules (plugin-targets.mjs holds the shared reading):
 *   - targets, when declared, is a non-empty list of known values: web, mobile, desktop, widget.
 *     Absent = web: a meta never has to declare it.
 *   - "widget" in targets and a meta "widget": { "corner" } go together (the Studio mounts a widget by its corner).
 *   - "backend": "backend/<name>" names an existing folder (desktop:build packages it as the app's sidecar).
 *   - A plugin that is not built for the web (targets without "web") is NOT in the built web tree: no
 *     public/<tree>/<bundle>/ folder and no manifest entry, so neither the /cdn export nor the Research
 *     Gallery can carry it. desktop:build packages it instead.
 * --self-test plants each violation and confirms it is caught.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KNOWN_TARGETS, profileTargets, isWebBuilt } from './plugin-targets.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// One profile's meta against the rules; returns the problems.
export function metaProblems(where, meta, backendExists = (p) => existsSync(join(ROOT, p))) {
  const out = []
  const t = meta.targets
  if (t !== undefined) {
    if (!Array.isArray(t) || !t.length) out.push(`${where}: "targets" must be a non-empty list`)
    else for (const v of t) if (!KNOWN_TARGETS.includes(v)) out.push(`${where}: unknown target "${v}" (known: ${KNOWN_TARGETS.join(', ')})`)
    if (Array.isArray(t) && t.includes('widget') && !meta.widget?.corner) out.push(`${where}: targets include "widget" but there is no "widget": { "corner" }`)
    if (Array.isArray(t) && meta.widget && !t.includes('widget')) out.push(`${where}: has a "widget" corner but its targets leave out "widget"`)
  }
  if (meta.backend !== undefined && !(typeof meta.backend === 'string' && backendExists(meta.backend))) out.push(`${where}: "backend" names no folder ${meta.backend}`)
  return out
}

if (process.argv.includes('--self-test')) {
  const planted = [
    ['unknown value', { targets: ['tv'] }],
    ['empty list', { targets: [] }],
    ['widget without corner', { targets: ['widget'] }],
    ['corner without widget target', { targets: ['desktop'], widget: { corner: 'bottom-right' } }],
    ['missing backend', { targets: ['desktop'], backend: 'backend/no-such-engine' }],
  ]
  let missed = 0
  for (const [name, meta] of planted) if (!metaProblems('planted', meta, () => false).length) { missed++; console.log(`  MISSED  ${name}`) }
  if (metaProblems('ok', { targets: ['desktop', 'widget'], widget: { corner: 'bottom-right' }, backend: 'backend/x' }, () => true).length) { missed++; console.log('  FALSE ALARM on a valid meta') }
  if (missed) { console.log(`TARGETS self-test: FAIL — ${missed}`); process.exit(1) }
  console.log(`TARGETS self-test: PASS — ${planted.length} planted violations caught, a valid meta passes.`)
  process.exit(0)
}

const problems = []
const DESIGNS = join(ROOT, 'plugin-designs')
const TREE = join(ROOT, 'public', TREE_NAME)
let manifest = null
try { manifest = JSON.parse(readFileSync(join(TREE, 'manifest.json'), 'utf8')) } catch { /* no built tree: tree rules skipped */ }
let declared = 0, notWeb = 0
for (const b of readdirSync(DESIGNS)) {
  const dir = join(DESIGNS, b)
  if (!statSync(dir).isDirectory()) continue
  for (const p of profileTargets(dir)) {
    if (p.targets) declared++
    problems.push(...metaProblems(`${b}/${p.profile}.meta.json`, p.meta))
  }
  if (!isWebBuilt(dir)) {
    notWeb++
    if (existsSync(join(TREE, b))) problems.push(`${b} is not a web plugin but public/${TREE_NAME}/${b}/ exists (it would ship in the /cdn export)`)
    if (manifest && (manifest.bundles || []).some((x) => x.bundle === b)) problems.push(`${b} is not a web plugin but the built manifest lists it (the gallery would offer it)`)
  }
}
for (const p of problems) console.log('  FAIL  ' + p)
if (problems.length) { console.log(`TARGETS: FAIL — ${problems.length} problem(s).`); process.exit(1) }
console.log(`TARGETS: PASS — ${declared} profile(s) declare targets (absent = web); ${notWeb} non-web plugin(s), none in the built web tree.`)
