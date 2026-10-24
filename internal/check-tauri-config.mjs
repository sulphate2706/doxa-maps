#!/usr/bin/env node
/**
 * check-tauri-config.mjs — the Tauri analogue of `cap:verify`.
 *
 * WHY THIS EXISTS: capacitor.config.json documents the failure mode in capitals — "a wrong
 * webDir yields an EMPTY assets/public and a BLANK WHITE SCREEN at launch, NOT AN ERROR."
 * Tauri has the identical shape: point `build.frontendDist` at the wrong place, or name a
 * window `url` that does not exist in the built tree, and the app launches to a blank white
 * window with no message. Neither `cargo build` nor any web gate catches it, because the
 * path is only resolved by the webview at runtime.
 *
 * This check runs with NO Rust toolchain and NO Tauri CLI — it is pure config-vs-filesystem
 * assertion, so it works in CI (which installs only bun) exactly as `check:mobile` does.
 * What it CANNOT do is prove the binary builds or launches; that still needs
 * `cargo tauri build` on a machine with the Tauri CLI and system webview libs.
 *
 * Exit 0 = the config points at files that exist. Exit 1 = a launch-blank-window defect.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// CANONICAL LOCATION: deployment/src-tauri/tauri.conf.json, NOT the repo root.
// This was found the expensive way (2026-09-21): the config was first written to the repo
// root, this gate PASSED because it only validated the file's CONTENTS, and `cargo check`
// then compiled 228 crates before tauri-build died with "unable to read Tauri config file
// at .../src-tauri/tauri.conf.json because entity not found". A gate that validates a file
// the toolchain never reads is worse than no gate — it certifies a build that cannot work.
const CONF = join(ROOT, 'deployment', 'src-tauri', 'tauri.conf.json')
const STRAY = join(ROOT, 'tauri.conf.json')
const fail = []
const ok = []

if (!existsSync(CONF)) {
  console.error('TAURI-CONFIG: FAIL — deployment/src-tauri/tauri.conf.json is missing.')
  if (existsSync(STRAY)) {
    console.error('  Found tauri.conf.json at the REPO ROOT instead. tauri-build reads it from')
    console.error('  deployment/src-tauri/ only; at the root it is invisible to the build. Move it:')
    console.error('    git mv tauri.conf.json deployment/src-tauri/tauri.conf.json')
  }
  process.exit(1)
}
// A stray root copy is its own defect: two configs, and the one a human edits may be the
// one the toolchain ignores.
if (existsSync(STRAY)) {
  fail.push('a SECOND tauri.conf.json exists at the repo root — tauri-build ignores it, so edits there silently do nothing')
}

let conf
try {
  conf = JSON.parse(readFileSync(CONF, 'utf8'))
} catch (e) {
  console.error(`TAURI-CONFIG: FAIL — tauri.conf.json does not parse: ${e.message}`)
  process.exit(1)
}

// 1. identifier must match Capacitor's appId — one product, one reverse-DNS identity.
const capPath = join(ROOT, 'capacitor.config.json')
if (existsSync(capPath)) {
  const appId = JSON.parse(readFileSync(capPath, 'utf8')).appId
  if (conf.identifier !== appId) {
    fail.push(`identifier "${conf.identifier}" != capacitor appId "${appId}" — one product should carry one identity`)
  } else {
    ok.push(`identifier matches capacitor appId (${appId})`)
  }
}

// 2. frontendDist must resolve to a real directory. Tauri resolves it RELATIVE TO deployment/src-tauri/,
//    which is the single easiest thing to get wrong in this file.
const dist = conf?.build?.frontendDist
if (!dist) {
  fail.push('build.frontendDist is unset — the webview would have nothing to load')
} else {
  const resolved = resolve(ROOT, 'deployment', 'src-tauri', dist)
  if (!existsSync(resolved)) {
    fail.push(`build.frontendDist "${dist}" resolves to ${resolved}, which does not exist`)
  } else {
    ok.push(`frontendDist "${dist}" -> ${resolved.replace(ROOT + '/', '')}/`)
  }
}

// 3. EVERY window url must exist inside frontendDist. This is the blank-white-window check.
const windows = conf?.app?.windows || []
if (!windows.length) {
  fail.push('app.windows is empty — no window would open')
}
for (const w of windows) {
  if (!w.url) { ok.push(`window "${w.title || '(untitled)'}" uses the default entry`); continue }
  const page = resolve(ROOT, 'deployment', 'src-tauri', dist || '.', w.url)
  if (!existsSync(page)) {
    fail.push(`window url "${w.url}" does not exist in the built tree (${page.replace(ROOT + '/', '')}) — THIS LAUNCHES A BLANK WHITE WINDOW`)
  } else {
    const bytes = readFileSync(page, 'utf8').length
    ok.push(`window url "${w.url}" exists (${bytes} bytes)`)
  }
}

// 4. The Rust crate the config depends on must be present.
for (const f of ['deployment/src-tauri/Cargo.toml', 'deployment/src-tauri/build.rs', 'deployment/src-tauri/src/main.rs']) {
  if (!existsSync(join(ROOT, f))) fail.push(`${f} is missing — \`cargo tauri build\` would fail`)
  else ok.push(`${f} present`)
}

// 5. Cargo.lock must be PRESENT AND TRACKED — added 2026-09-22 after finding it gitignored.
//
// It had been ignored by association with /target and /gen in the same .gitignore. Those two are
// genuinely regenerated; a lockfile is not — it is the RESOLUTION RECORD, the only artifact that
// makes `cargo build` reproducible. Cargo's rule splits on crate type (commit for a binary, ignore
// for a library) and `cargo metadata` reports this crate as kinds=['bin'].
//
// THE STAKES, measured: Cargo.toml pins nothing tighter than `tauri = { version = "2" }` while the
// lockfile pins 430 packages. Without it an inheritor resolves a different dependency tree than the
// one that produced the shipped 64 MB binary — and method 5 is already "built, not shot", so its
// build must at least be REPEATABLE. Checking tracked-ness (not just existence) is the point: the
// file was on disk the whole time and still absent from every clone.
{
  const rel = 'deployment/src-tauri/Cargo.lock'
  if (!existsSync(join(ROOT, rel))) {
    fail.push(`${rel} is missing — run \`cargo metadata\` in deployment/src-tauri to generate it`)
  } else {
    let tracked = false
    try {
      execSync(`git ls-files --error-unmatch ${JSON.stringify(rel)}`, { cwd: ROOT, stdio: 'pipe' })
      tracked = true
    } catch { /* not tracked */ }
    if (!tracked) fail.push(`${rel} exists but is NOT TRACKED — a clone gets no lockfile, so the build is not reproducible`)
    else ok.push(`${rel} present and tracked (reproducible build)`)
  }
}

for (const line of ok) console.log(`  · ${line}`)
if (fail.length) {
  console.error(`\nTAURI-CONFIG: FAIL — ${fail.length} problem(s):`)
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nTAURI-CONFIG: PASS — config points at files that exist; no blank-window defect.')
console.log('  This is the CONFIG contract only. Separately verified 2026-09-21 with the real')
console.log('  toolchain: `cargo check` compiles the crate clean (0 errors, 0 warnings), so the')
console.log('  config parses under Tauri\'s STRICT schema and the icon embeds.')
console.log('  STILL NOT PROVEN: that a packaged binary launches and renders. That needs')
console.log('  `cargo install tauri-cli` then `cargo tauri build` — status stays "built, not shot".')
