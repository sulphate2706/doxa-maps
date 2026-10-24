#!/usr/bin/env node
/**
 * check-no-cross-plugin-imports — a plugin imports another plugin only through library/, never by reaching
 * into its folder.
 *
 * WHY (2026-09-26, regions' C1a): research-dashboard and dashboard-plus-grid imported
 * '../doxa-research-map/src/…' — another plugin's PRIVATE folder. That couples two owners' code invisibly
 * (a refactor inside doxa-research-map/src breaks a bundle its owner never builds), and it is how two
 * private copies of the same palette drifted apart. Shared code belongs in library/ (@map/…).
 *
 * RULE: in plugin-designs/<bundle>/**, a relative import (static, dynamic, export-from, import.meta.glob)
 * must not resolve into plugin-designs/<other>/ — except another bundle's PUBLIC profile component (a .vue at
 * that bundle's root), which is how a capability-4 composite mounts it. Anything deeper (src/, utils) is refused.
 * --self-test plants a crossing import and requires a FAIL.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PD = join(ROOT, 'plugin-designs')
const SPEC = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\.meta\.glob\s*\(\s*['"]([^'"]+)['"]/g

/** [{file, spec, target}] for every relative import in `src` (at `file`) that lands in another bundle. */
export function crossings(file, src) {
  const own = relative(PD, file).split(sep)[0]
  const out = []
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1] || m[2] || m[3] || m[4]
    if (!spec || !spec.startsWith('.')) continue
    const abs = resolve(dirname(file), spec)
    const rel = relative(PD, abs)
    if (rel.startsWith('..')) continue                       // left plugin-designs/ (library/, data/): fine
    const parts = rel.split(sep)
    const target = parts[0]
    if (!target || target === own) continue
    // A composite mounting another bundle's PUBLIC profile (a .vue at that bundle's root) is composition,
    // the documented capability-4 pattern. Reaching any deeper (src/, utils, data) is the private coupling.
    if (parts.length === 2 && /\.vue$/.test(parts[1])) continue
    out.push({ file: relative(ROOT, file), spec, target })
  }
  return out
}

if (process.argv.includes('--self-test')) {
  const f = join(PD, 'research-dashboard', 'x.vue')
  const hits = crossings(f, "import A from '../doxa-research-map/src/a.js'\nimport B from './src/b.js'\nimport C from '../../library/c.js'\nimport D from '../people-groups-grid/people-groups-grid.vue'")
  if (hits.length === 1 && hits[0].target === 'doxa-research-map') { console.log('NO-CROSS-PLUGIN-IMPORTS: SELF-TEST PASS — a reach into another plugin\'s src/ is caught; its own src/, library/ and another bundle\'s public profile .vue are not.'); process.exit(0) }
  console.error('NO-CROSS-PLUGIN-IMPORTS: SELF-TEST FAIL — ' + JSON.stringify(hits)); process.exit(1)
}

const files = []
const walk = (d) => { for (const e of readdirSync(d)) { if (e === 'node_modules' || e.startsWith('.')) continue; const p = join(d, e); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(vue|m?js)$/.test(e) && !/\/(scripts|data)\//.test(p.replace(/\\/g, '/'))) files.push(p) } }
walk(PD)
const bad = files.flatMap((f) => crossings(f, readFileSync(f, 'utf8')))
for (const b of bad) console.log(`  FAIL  ${b.file}: imports '${b.spec}' from another plugin (${b.target}); move the shared code to library/ and import it as @map/…`)
if (bad.length) { console.log(`NO-CROSS-PLUGIN-IMPORTS: FAIL — ${bad.length} import(s) reach into another plugin's folder.`); process.exit(1) }
console.log(`NO-CROSS-PLUGIN-IMPORTS: PASS — ${files.length} plugin source file(s); none imports from another plugin's folder.`)
