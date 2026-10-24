/**
 * plugin-targets.mjs — where a plugin runs, read from its own <profile>.meta.json "targets".
 *
 * Known values: web (a published map or tool), mobile, desktop (the Tauri app, `bun run desktop:build`),
 * widget (the Plugin Studio's corner). ABSENT = web: most plugins never declare it and never need to.
 * A plugin is built into the WEB tree (bun run build, the /cdn export, the Research Gallery) unless every
 * profile declares targets and none of them is "web" — Rudder (["desktop","widget"]) is built only by
 * desktop:build, and the dev server still discovers it from source for the Studio's corner.
 * Read by run-parallel (--bundles), check-composite-freshness, check-shared-component-reached-bundles,
 * desktop-build and check:targets, so there is ONE rule.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const KNOWN_TARGETS = ['web', 'mobile', 'desktop', 'widget']

/** [{ profile, targets|null, meta }] for every <profile>.meta.json in a bundle folder. */
export function profileTargets(bundleDir) {
  if (!existsSync(bundleDir)) return []
  return readdirSync(bundleDir).filter((f) => f.endsWith('.meta.json')).map((f) => {
    let meta = {}
    try { meta = JSON.parse(readFileSync(join(bundleDir, f), 'utf8')) } catch { /* unreadable meta = no declaration */ }
    return { profile: f.replace(/\.meta\.json$/, ''), targets: Array.isArray(meta.targets) ? meta.targets : null, meta }
  })
}

/** True unless every profile declares targets and none of them is "web". No meta at all = web. */
export function isWebBuilt(bundleDir) {
  const p = profileTargets(bundleDir)
  if (!p.length) return true
  return p.some((x) => !x.targets || x.targets.includes('web'))
}

/** The profile a desktop app opens, or null: the first profile whose targets include "desktop". */
export function desktopProfile(bundleDir) {
  return profileTargets(bundleDir).find((x) => x.targets && x.targets.includes('desktop')) || null
}
