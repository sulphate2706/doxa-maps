/**
 * _tree-name.mjs — the ONE place the output tree's name is read.
 *
 * The built tree lives at public/<TREE_NAME>/ and every embeddable URL carries it
 * (…/<TREE_NAME>/<bundle>/<profile>/index.html). Its name has always been configurable —
 * vite.doxa-maps-build-config.json `name` — but a census on 2026-09-25 found 61 tooling files
 * that ignored the knob and hardcoded 'doxa-maps' (181 literals), so changing the config renamed
 * the build while those gates kept reading the old folder. Every tool now imports TREE_NAME from
 * here, which makes renaming the tree a one-line config change (see
 * _qa-cycle/03-deployment-cycle/qa-loops/RENAME-IMPACT-dx.md, mechanism A).
 *
 *   import { TREE_NAME, BUILD_CONFIG_FILE } from './_tree-name.mjs'
 *   TREE=$(node internal/_tree-name.mjs)            # from a shell script
 *
 * The fallback, used only when the config is missing or has no name, is the historical name,
 * so a checkout without the config behaves exactly as before.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BUILD_CONFIG_FILE = resolve(ROOT, 'vite.doxa-maps-build-config.json')
const FALLBACK = 'doxa-maps'

function read() {
  let name = ''
  try {
    const cfg = JSON.parse(readFileSync(BUILD_CONFIG_FILE, 'utf8'))
    if (cfg && typeof cfg.name === 'string') name = cfg.name.trim()
  } catch { /* no config: the fallback */ }
  if (!name) return FALLBACK
  // A tree name is ONE path segment that also appears in public URLs: refuse anything that could
  // escape public/ or need escaping in a URL, rather than build into a surprising place.
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.includes('..')) {
    throw new Error(`[_tree-name] build config "name" must be a single URL-safe path segment, got ${JSON.stringify(name)}`)
  }
  return name
}

export const TREE_NAME = read()
// GATED profiles (the config's gatedProfiles): bundles that build but must never reach a public surface.
// generate-tree leaves them out of the manifest and pages; vite.config.js builds them OUTSIDE public/
// (.gated/<tree>/); check:gated-not-in-tree fails if one appears in the tree anyway.
function readGated() {
  try {
    const cfg = JSON.parse(readFileSync(BUILD_CONFIG_FILE, 'utf8'))
    return Array.isArray(cfg.gatedProfiles) ? cfg.gatedProfiles.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []
  } catch { return [] }
}
export const GATED_PROFILES = readGated()

// The PUBLIC address of the tree for the Share menu's Embed tab (the config's shareBaseUrl): an https URL with no
// trailing slash, or '' (unset). vite.config.js bakes it as __DOXA_SHARE_BASE__; library/utils/embedBase.js reads it.
function readShareBase() {
  let v = ''
  try {
    const cfg = JSON.parse(readFileSync(BUILD_CONFIG_FILE, 'utf8'))
    v = typeof cfg.shareBaseUrl === 'string' ? cfg.shareBaseUrl.trim().replace(/\/+$/, '') : ''
  } catch { return '' }
  if (v && !/^https:\/\/[^\s"'<>]+$/i.test(v)) throw new Error(`[_tree-name] build config "shareBaseUrl" must be an https URL, got ${JSON.stringify(v)}`)
  return v
}
export const SHARE_BASE = readShareBase()

// The name escaped for use inside a RegExp source (a '.' in a future name must not match any char).
export const TREE_NAME_RE = TREE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(TREE_NAME + '\n')
