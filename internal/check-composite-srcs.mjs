#!/usr/bin/env node
/**
 * check-composite-srcs.mjs — every composite's nested `src:` must resolve to a real built bundle.
 *
 * WHY THIS EXISTS. A capability-4/5 composite nests its children by TAG + BUNDLE URL through
 * StackLayout / VerticalTabsLayout:
 *
 *     { key:'map', element:'doxa-research-map', src:'../../doxa-research-map/doxa-research-map.js' }
 *
 * That `src` is resolved BY THE BROWSER, relative to the composite's generated leaf page, which is
 * served two levels deep (<TREE_NAME>/<bundle>/<profile>/index.html). So a sibling bundle is reached
 * with `../../<bundle>/<bundle>.js`. Get the depth wrong by one and you get a 404.
 *
 * ★ THE FAILURE IS SILENT, WHICH IS WHY IT NEEDS A GATE. StackLayout mounts each section inside a
 * promise chain that ends in `.catch(() => {})` — a deliberate choice, so one broken child cannot
 * take down the whole stack. The cost of that resilience is that a wrong path produces NO error,
 * NO console warning and NO build failure: just a section that is silently EMPTY. The build is
 * green, the element mounts, and a band of the product is missing. Exactly the shape that survives
 * every check an author runs and is found only by a human looking at the page.
 *
 * WHAT IT CHECKS. For every `src:` string in plugin-designs/<bundle>/*.vue, resolve it the way the
 * browser will — against `public/<treeName>/<bundle>/<profile>/` — and assert the file exists in
 * the built tree. It also flags an `element:` whose tag no bundle registers, which is the other
 * half of the same defect (a correct path to a bundle that defines a different tag).
 *
 * NOT A SUBSTITUTE FOR A BROWSER. This proves the URL resolves to a file on disk. It cannot prove
 * the element renders. Pair it with the Playwright smoke.
 *
 * NEGATIVE-TESTED: changing a src's depth (../../ -> ../) makes this FAIL naming the bundle, the
 * section and both the written and resolved paths; restoring it returns PASS. A tree with no
 * composites at all FAILS (vacuous guard) rather than passing on an empty set.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The output tree name comes from the build config, the same source generate-tree uses. Defaulting
// silently would make this gate check a directory the build never writes.
//
// ★ THE FILENAME WAS STALE AND THE READ NEVER RAN (fixed 2026-09-23). This named
// `vite.1040-maps-build-config.json`, the PRE-RENAME project name, and no such file exists — so the
// try ALWAYS threw, the catch ALWAYS fired, and treeName was ALWAYS the hardcoded default. The gate
// was correct only because that default happens to equal the config's current name.
// Rename the tree in the build config and this gate would have checked a directory the build never
// writes, then SKIPped with "an absent tree is not evidence either way" — silent, delayed, and
// exactly the outcome the comment above was written to prevent.
//
// ★ AND THE SOURCE IS NOW REPORTED, not just used. A dead read is invisible when only the RESULT is
// printed: "checked against public/doxa-maps/" looked identical whether the name came from the
// config or from the fallback. Printing WHICH means a future regression shows up in normal output
// instead of waiting for a rename to expose it.
let treeName = TREE_NAME
let treeNameSource = 'built-in default (build config unreadable)'
try {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
  if (cfg?.name) { treeName = cfg.name; treeNameSource = 'vite.doxa-maps-build-config.json' }
  else treeNameSource = 'built-in default (config has no `name`)'
} catch { /* fall through to the default */ }

const TREE = join(ROOT, 'public', treeName)
if (!existsSync(TREE)) {
  console.log(`COMPOSITE-SRCS: SKIP — no built tree at public/${treeName}/. Run \`bun run build\` first.`)
  console.log('  An absent tree is not evidence either way.')
  process.exit(0)
}

const DESIGNS = join(ROOT, 'plugin-designs')
const bundles = readdirSync(DESIGNS, { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name)

// Collect every tag any bundle registers, so an `element:` pointing at a tag nobody defines is
// caught too. Read from the SOURCE entries (index.js), which is where customElements.define lives.
const definedTags = new Map()   // tag -> bundle that defines it
for (const b of bundles) {
  const entry = join(DESIGNS, b, 'index.js')
  if (!existsSync(entry)) continue
  const txt = readFileSync(entry, 'utf8')
  for (const m of txt.matchAll(/customElements\.define\(\s*['"]([^'"]+)['"]/g)) {
    if (!definedTags.has(m[1])) definedTags.set(m[1], b)
  }
}

// A section literal is `{ ... element: 'tag' ... src: '...' ... }`. Rather than parse JS, scan each
// .vue for src/element string pairs within a small window — composites declare them adjacently.
const SRC_RE = /src:\s*['"]([^'"]+\.js)['"]/g
const EL_RE  = /element:\s*['"]([^'"]+)['"]/g

// ── WHICH CHILDREN REQUIRE A profile-config ─────────────────────────────────
// A bundle whose entry mounts ProfileLoader does NOT render a component directly: the loader reads
// profile-config.profile to decide WHICH .vue in that bundle to load. Nest such a child by tag+src
// without that attribute and it still MOUNTS, still reports its tag to any DOM walk, and renders
// ProfileLoader's error state instead of content — "missing or invalid profile-config prop".
//
// ★ THIS SHIPPED (2026-09-22). research-map-plus-grid nested doxa-research-map with no attrs. Every
// structural check passed, including this gate's src+tag assertions and a deep walk that counted
// BOTH children present, because presence was true — only the content was missing. It was caught by
// READING a regenerated README screenshot. Counting mounts proves an element exists, not that it
// rendered anything.
//
// Derived from source (which entries import ProfileLoader), never a hardcoded list, so a new
// loader-based bundle is covered the day it is written.
const profileLoaderBundles = new Set()
for (const b of bundles) {
  const entry = join(DESIGNS, b, 'index.js')
  if (existsSync(entry) && /ProfileLoader/.test(readFileSync(entry, 'utf8'))) profileLoaderBundles.add(b)
}
// `definedTags` (above) already maps tag -> bundle, which is all this needs to resolve an
// `element:` back to whether that bundle mounts ProfileLoader.

const problems = []
let composites = 0
let checked = 0

for (const bundle of bundles) {
  const dir = join(DESIGNS, bundle)
  const vues = readdirSync(dir).filter(f => f.endsWith('.vue'))
  for (const vue of vues) {
    const text = readFileSync(join(dir, vue), 'utf8')
    const srcs = [...text.matchAll(SRC_RE)].map(m => m[1])
    const els  = [...text.matchAll(EL_RE)].map(m => m[1])
    if (!srcs.length && !els.length) continue
    composites++

    // The composite's generated leaf lives at public/<tree>/<bundle>/<profile>/index.html. Profiles
    // are the bundle's own .vue basenames; use the real built dirs so this matches what shipped.
    const bundleOut = join(TREE, bundle)
    if (!existsSync(bundleOut)) {
      problems.push({ bundle, vue, why: `no built output at public/${treeName}/${bundle}/ — did the build emit this bundle?` })
      continue
    }
    const profileDirs = readdirSync(bundleOut, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name)
    if (!profileDirs.length) {
      problems.push({ bundle, vue, why: `built bundle has no profile directory to resolve relative srcs from` })
      continue
    }

    for (const src of srcs) {
      checked++
      // Resolve exactly as the browser would: against the leaf page's directory.
      const leafDir = join(bundleOut, profileDirs[0])
      const resolved = resolve(leafDir, src)
      if (!existsSync(resolved)) {
        problems.push({
          bundle, vue, src,
          why: `resolves to ${resolved.replace(ROOT + '/', '')} — WHICH DOES NOT EXIST`,
          hint: `a sibling bundle is '../../<bundle>/<bundle>.js' from a leaf at <tree>/<bundle>/<profile>/`
        })
      }
    }
    for (const el of els) {
      checked++
      if (!definedTags.has(el)) {
        problems.push({
          bundle, vue, src: el,
          why: `element tag '${el}' is not registered by ANY bundle's index.js`,
          hint: `StackLayout waits for customElements.get('${el}') and gives up silently if it never appears`
        })
        continue
      }
      // A child whose bundle mounts ProfileLoader MUST be given a profile-config naming its profile.
      // Scoped to this element's own section literal (the text between this `element:` and the next
      // one, or the end), so a profile-config belonging to a SIBLING section cannot satisfy it — the
      // exact false pass that would let the original defect through a looser check.
      const owner = definedTags.get(el)
      if (profileLoaderBundles.has(owner)) {
        const at = text.indexOf(`element: '${el}'`) >= 0
          ? text.indexOf(`element: '${el}'`)
          : text.indexOf(`element: "${el}"`)
        const nextEl = text.slice(at + 1).search(/element:\s*['"]/)
        const section = at < 0 ? '' : text.slice(at, nextEl >= 0 ? at + 1 + nextEl : text.length)
        // ★ MATCH THE QUOTED ATTRIBUTE KEY, NOT THE BARE WORD. A first version tested
        // /profile-config/ and PASSED ON ITS OWN DOCUMENTATION: the section's explanatory comment
        // says "profile-config" several times, so renaming the real key still satisfied it. Caught
        // by a negative test that mutated only the quoted key and still went green. A gate that a
        // COMMENT can satisfy is not checking the code.
        const hasKey     = /['"]profile-config['"]\s*:/.test(section)
        const namesAProfile = /\bprofile\s*:\s*['"][^'"]+['"]/.test(section)
        if (!hasKey || !namesAProfile) {
          problems.push({
            bundle, vue, src: el,
            why: `'${el}' comes from ${owner}, whose entry mounts ProfileLoader — it REQUIRES a profile-config naming its profile, and this section passes none`,
            hint: `add attrs: { 'profile-config': JSON.stringify({ profile: '<name>', ... }) }. ` +
                  `Without it the element still MOUNTS and still reports its tag, so a DOM walk says ` +
                  `it is present while ProfileLoader renders "missing or invalid profile-config prop" ` +
                  `instead of content.`
          })
        }
      }
    }
  }
}

console.log(`COMPOSITE-SRCS: ${composites} composite file(s), ${checked} nested reference(s) checked ` +
            `against public/${treeName}/ (tree name from ${treeNameSource}).`)

// Vacuous guard: "0 composites" must never read as "0 problems" — this repo ships several.
const MIN_COMPOSITES = 2
if (composites < MIN_COMPOSITES) {
  console.error(`\nCOMPOSITE-SRCS: FAIL — only ${composites} composite(s) found (expected >= ${MIN_COMPOSITES}).`)
  console.error('  The scan found almost nothing, which means the pattern changed or the scan broke.')
  console.error('  Refusing to pass vacuously.')
  process.exit(1)
}

if (problems.length) {
  console.error(`\nCOMPOSITE-SRCS: FAIL — ${problems.length} nested reference(s) do not resolve:`)
  for (const p of problems) {
    console.error(`  ✗ ${p.bundle}/${p.vue}${p.src ? `  ${p.src}` : ''}`)
    console.error(`      ${p.why}`)
    if (p.hint) console.error(`      ${p.hint}`)
  }
  console.error(
    '\n  A composite nests its children by URL, and StackLayout swallows a failed section on purpose\n' +
    '  (one broken child must not take down the stack). So a wrong path is NOT an error at runtime —\n' +
    '  it is a silently EMPTY band in a green build. Fix the path, or the product ships missing a piece.'
  )
  process.exit(1)
}

console.log('COMPOSITE-SRCS: PASS — every nested src resolves and every nested tag is registered.')
