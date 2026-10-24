#!/usr/bin/env node
/**
 * clean.mjs — wipe + recreate the default output tree root before a build.
 *
 * The output folder name is configurable (vite.doxa-maps-build-config.json `name`, default
 * "doxa-maps"), so this reads the same config instead of hardcoding the name —
 * otherwise renaming the tree would leave a stale folder behind. Runs BEFORE the
 * per-bundle vite builds (which emit into public/<name>/); generate-tree.mjs runs after.
 */
import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function config() {
  try {
    const cfg = JSON.parse(readFileSync(resolve(__dirname, '..', 'vite.doxa-maps-build-config.json'), 'utf8'))
    const name = (typeof cfg?.name === 'string' && cfg.name.trim()) ? cfg.name.trim() : TREE_NAME
    const paths = Array.isArray(cfg?.paths) ? cfg.paths.filter(p => typeof p === 'string' && p.trim()) : []
    return { name, paths }
  } catch { return { name: TREE_NAME, paths: [] } }
}

const { name, paths } = config()

// ⭐ BUG FIXED 2026-07-30 — CLEAN EVERY DESTINATION, NOT JUST app/.
// This used to reset ONLY app/<name>/, leaving each `paths` destination untouched.
// Result: a RECURSIVE SELF-NESTING pollution that grew with every build —
//   public/doxa-maps/<bundle>/doxa-maps/<bundle>/doxa-maps/...
// because generate-tree copies app/<name>/ into <path>/<name>/, and on the next
// build the (never-cleaned) nested copies were still there to be copied again.
// It shipped 7 duplicate copies of the same 576 KB bundle into git before it was
// caught by a pre-push file-size audit.
// LESSON: a clean step must clear EVERY output destination the build writes to.
// Cleaning only the canonical outDir is a silent, compounding leak.
// The build writes into public/<name>/ directly (public/ is the committed served
// web-root). That ONE subfolder is reset — never public/ itself (write-token's public/api/ lives there).
const roots = [
  resolve(__dirname, '..', 'public', name),
  ...paths.map(p => resolve(__dirname, '..', p, name)),
]

for (const root of roots) {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  console.log(`[clean] reset ${root}`)
}

// ONE FOLDER (decision, card BUILD-OUTPUT-IS-ONE-FOLDER, 2026-09-25): public/ now holds only the
// output folder + a generated README.md. These are the entries the OLD layout wrote beside the tree;
// removing them here lets a checkout that still has them converge on the new layout at its next build
// instead of carrying them forever. (public/api/ is left alone: write-token owns it, and only when a
// MAPBOX_TOKEN is supplied.)
for (const legacy of ['index.html', 'assets', '__gallery']) {
  const p = resolve(__dirname, '..', 'public', legacy)
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log(`[clean] removed public/${legacy} (no longer part of the output)`) }
}
