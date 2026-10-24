#!/usr/bin/env node
/**
 * sync-app-shells.mjs — point the native app shells at the OUTPUT FOLDER, from the tree's name.
 *
 * public/ holds only the output folder (decision, card BUILD-OUTPUT-IS-ONE-FOLDER), so the app
 * shells load THAT folder as their web root:
 *   capacitor.config.json                  "webDir": "public/<tree>"
 *       `cap copy` hard-fails unless webDir holds an index.html; the tree's front page is its
 *       index.html (the Plugin Studio), and set-app-start-page then installs the app's start page.
 *   deployment/src-tauri/tauri.conf.json   build.frontendDist "../../public/<tree>"
 *                                          windows[].url relative to that folder
 *       The window url used to carry the tree's name ("doxa-maps/doxa-maps-spa/…"), so renaming the
 *       tree opened a BLANK desktop window (check:tauri caught it in the zz-maps rename proof).
 *
 * Both files are hand-formatted JSON, so only those values are replaced in place — nothing else
 * moves. Idempotent. generate-tree runs this after writing the tree, so a rename stays ONE line
 * (vite.doxa-maps-build-config.json "name").
 *
 * USAGE  node internal/sync-app-shells.mjs [--check]      --check: exit 1 if a file is out of date.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Returns [{ file, changed: bool, notes: [] }]; writes unless check. */
export function syncAppShells({ check = false } = {}) {
  const out = []
  // ── Capacitor ──
  const cap = resolve(ROOT, 'capacitor.config.json')
  if (existsSync(cap)) {
    const src = readFileSync(cap, 'utf8')
    const want = `public/${TREE_NAME}`
    const next = src.replace(/("webDir"\s*:\s*)"[^"]*"/, `$1"${want}"`)
    out.push({ file: 'capacitor.config.json', changed: next !== src, notes: [`webDir -> ${want}`] })
    if (next !== src && !check) { JSON.parse(next); writeFileSync(cap, next) }
  }
  // ── Tauri ──
  const tauri = resolve(ROOT, 'deployment', 'src-tauri', 'tauri.conf.json')
  if (existsSync(tauri)) {
    const src = readFileSync(tauri, 'utf8')
    const conf = JSON.parse(src)
    const want = `../../public/${TREE_NAME}`
    let next = src.replace(/("frontendDist"\s*:\s*)"[^"]*"/, `$1"${want}"`)
    const notes = [`frontendDist -> ${want}`]
    // A window url that still starts with a tree folder (any name that is a sibling of the bundles, i.e.
    // the first segment is not a bundle) is made relative to the tree.
    for (const w of (conf.app && conf.app.windows) || []) {
      if (!w.url || /^[a-z]+:/i.test(w.url)) continue
      const segs = w.url.split('/')
      if (segs.length > 1 && !existsSync(resolve(ROOT, 'public', TREE_NAME, segs[0])) && existsSync(resolve(ROOT, 'public', TREE_NAME, ...segs.slice(1)))) {
        const rel = segs.slice(1).join('/')
        next = next.replace(`"url": "${w.url}"`, `"url": "${rel}"`)
        notes.push(`window url ${w.url} -> ${rel}`)
      }
    }
    out.push({ file: 'deployment/src-tauri/tauri.conf.json', changed: next !== src, notes })
    if (next !== src && !check) { JSON.parse(next); writeFileSync(tauri, next) }
  }
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const res = syncAppShells({ check })
  for (const r of res) console.log(`  ${r.changed ? (check ? 'STALE' : 'wrote') : 'ok   '}  ${r.file}  (${r.notes.join('; ')})`)
  if (check && res.some((r) => r.changed)) { console.log('APP-SHELLS: FAIL — run node internal/sync-app-shells.mjs (generate-tree does it on every build).'); process.exit(1) }
  console.log(`APP-SHELLS: ${check ? 'PASS — both shells load' : 'synced to'} public/${TREE_NAME}/`)
}
