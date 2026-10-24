#!/usr/bin/env node
/**
 * check-nested-token-delivery.mjs — every shipped leaf must carry its OWN map token.
 *
 * WHY THIS IS NOT COVERED BY THE EXISTING SMOKES. Both `smoke:embeds` and `verify:5-caps` open a
 * page with `page.addInitScript(tk => { window.MAP_TOKEN = tk })` — they INJECT the token before
 * the page runs. That is correct for what those checks test (does the element mount, does the
 * capability hold), but it means the test SUPPLIES the very thing under test. A real user opening
 * a shipped leaf has no Playwright injecting anything: the leaf must already carry a baked token.
 * So no gate currently proves the delivery path itself. This one does, and it needs no browser.
 *
 * ★ WHY DELIVERY IS A SEPARATE PROPERTY FROM PAINT. A token can be present and the basemap still
 * blank (this build box has no WebGL; Mapbox's URL restriction can also 403 the tiles). Those are
 * CONSUMPTION failures. This gate asserts DELIVERY only — "does the token reach the page?" — which
 * is the half that is our fault when it breaks, deterministic, and checkable offline.
 *
 * ★ WHY IT MATTERS FOR NESTING (the card this came from). A cap-5 SPA nests its children as
 * iframes, and `window.MAP_TOKEN` does NOT cross an iframe boundary — each frame is its own
 * window. A nested map therefore cannot inherit the parent's token; it works only because the
 * CHILD LEAF carries its own baked copy. Proven live 2026-09-22: 13 of 13 nested frames in the
 * cap-5 SPA reported a real pk. token, including a map nested two levels deep (SPA -> cap-4
 * composite -> cap-3 map). That proof was a one-off browser run; this makes it a standing gate.
 *
 * WHAT IT CHECKS: every leaf the manifest actually ships (profile leaves and instance leaves)
 * contains a real `pk.` token. It reads the BUILT manifest rather than walking directories, so it
 * checks the set that is published, not whatever happens to be on disk.
 *
 * ★ AND IT ENFORCES THE INVARIANT IN BOTH DIRECTIONS: a token belongs in leaf HTML and must NEVER
 * appear in a `.js` bundle. A bundle is cached, SRI-pinned and reused across hosts; a token baked
 * into one cannot be rotated without a rebuild, and it leaks into every embed. The leaf is the
 * right place precisely because it is regenerated on every build.
 *
 * NEGATIVE-TESTED: stripping the token from one leaf makes this FAIL naming that leaf; planting a
 * pk. string in a .js bundle makes this FAIL naming the bundle; restoring returns PASS. A manifest
 * with no leaves FAILS (vacuous guard).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ★ REPORT WHERE THE TREE NAME CAME FROM, not just what it is (2026-09-23).
// This read named `vite.1040-maps-build-config.json` — the PRE-RENAME project name, a file that
// does not exist — so the try always threw and treeName was always the hardcoded default. It was
// correct only because the default happens to equal the config's current name. A dead read is
// INVISIBLE when only the result is printed, so the source is now part of the output: a future
// regression shows up on every run instead of waiting for a tree rename to expose it.
let treeName = TREE_NAME
let treeNameSource = 'built-in default (build config unreadable)'
try {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
  if (cfg?.name) { treeName = cfg.name; treeNameSource = 'vite.doxa-maps-build-config.json' }
  else treeNameSource = 'built-in default (config has no `name`)'
} catch { /* default */ }

const TREE = join(ROOT, 'public', treeName)
const MANIFEST = join(TREE, 'manifest.json')

if (!existsSync(MANIFEST)) {
  console.log(`NESTED-TOKEN: SKIP — no built manifest at public/${treeName}/manifest.json.`)
  console.log('  Run `bun run build` first. An absent tree is not evidence either way.')
  process.exit(0)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
} catch (e) {
  console.error(`NESTED-TOKEN: FAIL — manifest does not parse (${String(e.message).slice(0, 60)}).`)
  process.exit(1)
}

// A real Mapbox public token. Deliberately strict about the `pk.` prefix and a minimum body: an
// empty string or a placeholder like "REPLACE_ME" must NOT read as delivered.
const TOKEN_RE = /pk\.[A-Za-z0-9._-]{20,}/

// Collect every leaf URL the manifest publishes. Profiles carry iframeUrl; instances nest one
// level deeper and carry their own. Reading the manifest (not the filesystem) keeps this aligned
// with what is actually served.
const leaves = []
for (const b of manifest.bundles || []) {
  for (const p of b.profiles || []) {
    if (p.iframeUrl) leaves.push({ bundle: b.bundle, profile: p.profile, url: p.iframeUrl })
    for (const inst of p.instances || []) {
      if (inst.iframeUrl) leaves.push({ bundle: b.bundle, profile: `${p.profile}/${inst.id || inst.instance}`, url: inst.iframeUrl })
    }
  }
}

// Vacuous guard: "0 leaves" must never read as "0 problems".
const MIN_LEAVES = 20
if (leaves.length < MIN_LEAVES) {
  console.error(`NESTED-TOKEN: FAIL — manifest lists only ${leaves.length} leaf page(s) (expected >= ${MIN_LEAVES}).`)
  console.error('  The manifest is truncated or the shape changed. Refusing to pass vacuously.')
  process.exit(1)
}

// ★ THE AUTO CONTRACT (2026-09-26, by project decision: no Mapbox token in the public repo). With the
// build config's "token" EMPTY — the shipped default — a leaf must carry NO token, and must instead carry
// the runtime engine ladder (EXPLICIT / HAS_TOKEN): with no token it draws MapLibre, keyless; with one
// from the host, ?tk=, a paste or a token service, Mapbox. A builder who opts into baking a token
// ("token": "pk.…" in their own config) gets the original check: every leaf carries it.
let bakedToken = ''
try { bakedToken = String(JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8')).token || '') } catch { /* none */ }
const BAKED = TOKEN_RE.test(bakedToken)
const AUTO_RE = /var EXPLICIT = [^;]*;[\s\S]*?var HAS_TOKEN = /

const missing = []
let checked = 0
for (const leaf of leaves) {
  const rel = leaf.url.replace(/^\.\//, '')
  const abs = join(TREE, rel)
  if (!existsSync(abs)) {
    missing.push({ ...leaf, why: 'leaf file does not exist in the built tree' })
    continue
  }
  checked++
  const html = readFileSync(abs, 'utf8')
  if (BAKED && !TOKEN_RE.test(html)) {
    missing.push({ ...leaf, why: 'no pk. token baked into the leaf — a nested map here would get NOTHING' })
  }
  if (!BAKED && TOKEN_RE.test(html)) {
    missing.push({ ...leaf, why: 'a pk. token is in the leaf, but the build config bakes none — a token leaked into public output' })
  }
  if (!BAKED && !AUTO_RE.test(html)) {
    missing.push({ ...leaf, why: 'no runtime engine ladder (EXPLICIT/HAS_TOKEN) — with no token this leaf cannot fall back to MapLibre' })
  }
}

// The other direction: a token must never be compiled into a .js bundle.
const inBundles = []
for (const b of manifest.bundles || []) {
  const rel = (b.scriptUrl || '').replace(/^\.\//, '')
  if (!rel) continue
  const abs = join(TREE, rel)
  if (!existsSync(abs)) continue
  if (TOKEN_RE.test(readFileSync(abs, 'utf8'))) inBundles.push(b.bundle)
}

console.log(`NESTED-TOKEN: ${checked} shipped leaf page(s) checked, ${(manifest.bundles || []).length} bundle(s) scanned.`)

if (missing.length || inBundles.length) {
  if (missing.length) {
    console.error(`\nNESTED-TOKEN: FAIL — ${missing.length} leaf page(s) break the token contract (${BAKED ? 'baked token' : 'auto, no token'}):`)
    for (const m of missing.slice(0, 20)) console.error(`  ✗ ${m.bundle}/${m.profile}\n      ${m.url}\n      ${m.why}`)
    if (missing.length > 20) console.error(`  … +${missing.length - 20} more`)
    console.error(
      '\n  window.MAP_TOKEN does NOT cross an iframe boundary — each frame is its own window. A cap-5\n' +
      '  SPA nests its children as iframes, so a nested map cannot inherit the parent\'s token: it\n' +
      '  works only because the CHILD leaf carries its own baked copy. A leaf without one is a map\n' +
      '  that silently renders nothing for every user who opens it directly or through a shell.'
    )
  }
  if (inBundles.length) {
    console.error(`\nNESTED-TOKEN: FAIL — ${inBundles.length} bundle(s) have a token COMPILED IN:`)
    for (const b of inBundles) console.error(`  ✗ ${b}`)
    console.error(
      '\n  A token belongs in leaf HTML, never in a .js bundle. Bundles are cached, SRI-pinned and\n' +
      '  reused across hosts, so a baked-in token cannot be rotated without a rebuild and leaks into\n' +
      '  every embed. Leaves are regenerated on every build, which is exactly why they are the right\n' +
      '  place. Check whether a source file reads the token at module scope instead of at mount.'
    )
  }
  process.exit(1)
}

console.log(`NESTED-TOKEN: tree public/${treeName}/ (name from ${treeNameSource}).`)
console.log(BAKED ? 'NESTED-TOKEN: PASS — every shipped leaf carries its own token, and no bundle does.'
  : 'NESTED-TOKEN: PASS (auto) — no leaf or bundle carries a token, and every leaf picks its engine at runtime (MapLibre keyless without one).')
console.log('  This is DELIVERY only. It does not prove a basemap paints: that needs a real GPU and')
console.log('  a token whose URL restrictions allow the serving host (see verify:map-paint).')
