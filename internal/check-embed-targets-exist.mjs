#!/usr/bin/env node
/**
 * check-embed-targets-exist.mjs — every embed.iframe src in the manifest must resolve to a FILE
 * THAT EXISTS on disk.
 *
 * WHY THIS GATE EXISTS. The manifest's embed.iframe snippets ARE deployment-method 1 (iframe) —
 * one of only two of the five methods that are actually proven, and a shipped deliverable: a
 * partner site pastes that snippet verbatim. Those snippets point at <bundle>/<profile>/index.html
 * (and <bundle>/<profile>/<instance>/index.html). Nothing else in the build asserts the targets
 * are still emitted, so a generator change that stops writing a page class turns every affected
 * snippet into a 404 on someone else's website — silently, because the manifest still LOOKS right
 * and every other gate walks only files that EXIST (the liveness-vs-correctness blind spot
 * drop-portability-check.mjs names: "a gate that walks only what EXISTS is structurally blind to
 * absence").
 *
 * Written for the 2026-09-22 change that stopped emitting the 19 bundle-level chooser pages. Those
 * were referenced ZERO times; the 28 profile leaves + 15 instance leaves are referenced 43 times
 * between them. This gate is what makes that distinction a CHECKED FACT rather than a careful
 * reading.
 *
 * ★ IT IS BUILT TO FAIL, AND THAT IS TESTED. --self-test injects a deliberately wrong src into an
 * in-memory copy of the manifest and asserts the checker REPORTS it. A gate that cannot fail is
 * worse than no gate: it converts "unverified" into a confident PASS. Run the self-test whenever
 * you touch the matching logic — the failure mode of a checker is passing everything, which looks
 * exactly like success.
 *
 * Usage:  node internal/check-embed-targets-exist.mjs [--self-test]
 * Exit:   0 every target exists (or the self-test behaved) · 1 a target is missing · 2 bad setup
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CFG = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
const TREE = CFG.name
const TREE_DIR = join(ROOT, 'public', TREE)

/** Every `src="…"` inside every embed.iframe snippet, with the path that produced it. */
function collectIframeSrcs(manifest) {
  const out = []
  const walk = (node, trail) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${trail}[${i}]`))
    if (!node || typeof node !== 'object') return
    for (const [k, v] of Object.entries(node)) {
      if (k === 'iframe' && typeof v === 'string') {
        for (const m of v.matchAll(/src="([^"]+)"/g)) out.push({ src: m[1], where: `${trail}.${k}` })
      } else walk(v, `${trail}.${k}`)
    }
  }
  walk(manifest, '$')
  return out
}

/**
 * Resolve a snippet src to a path under the tree dir.
 * embedBase is '.' by default, so srcs look like "./bundle/profile/index.html?utm_source=…";
 * with embedBaseUrl set they are absolute and carry the tree name. Strip the query (it is a
 * marketing param, not part of the path) and any leading tree segment, then resolve under the
 * tree. An off-site absolute URL is not ours to check and is reported as SKIP, not PASS —
 * silently counting it as fine is how a gate quietly stops covering things.
 */
function resolveSrc(src) {
  const noQuery = src.split('?')[0].split('#')[0]
  if (/^(https?:)?\/\//i.test(noQuery)) {
    // The same effective base generate-tree bakes: EMBED_BASE_URL wins over the committed config.
    const base = ((process.env.EMBED_BASE_URL || '').trim() || CFG.embedBaseUrl || '').replace(/\/+$/, '')
    if (!base || !noQuery.startsWith(base)) return { kind: 'skip', reason: 'off-site absolute URL' }
    let rest = noQuery.slice(base.length).replace(/^\/+/, '')
    if (rest.startsWith(TREE + '/')) rest = rest.slice(TREE.length + 1)
    return { kind: 'file', rel: rest }
  }
  let rel = noQuery.replace(/^\.\//, '').replace(/^\/+/, '')
  if (rel.startsWith(TREE + '/')) rel = rel.slice(TREE.length + 1)
  return { kind: 'file', rel }
}

function run(manifest, treeDir) {
  const srcs = collectIframeSrcs(manifest)
  const missing = []
  let checked = 0, skipped = 0
  for (const { src, where } of srcs) {
    const r = resolveSrc(src)
    if (r.kind === 'skip') { skipped++; continue }
    checked++
    if (!existsSync(join(treeDir, r.rel))) missing.push({ src, rel: r.rel, where })
  }
  return { total: srcs.length, checked, skipped, missing }
}

// ── --self-test: PROVE THE GATE CAN FAIL ───────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  const manifest = JSON.parse(readFileSync(join(TREE_DIR, 'manifest.json'), 'utf8'))
  const clean = run(manifest, TREE_DIR)
  // Inject one deliberately wrong target into a COPY. If the checker still reports zero missing,
  // the matching logic is not actually looking at these strings and every PASS it has ever printed
  // is meaningless.
  const poisoned = JSON.parse(JSON.stringify(manifest))
  const first = poisoned.bundles?.[0]?.profiles?.[0]
  if (!first || !first.embed || typeof first.embed.iframe !== 'string') {
    console.error('SELF-TEST: FAIL — could not find a profile embed.iframe to poison (manifest shape changed).')
    process.exit(2)
  }
  first.embed.iframe = first.embed.iframe.replace(/src="[^"]+"/, 'src="./__this_page_does_not_exist__/index.html"')
  const bad = run(poisoned, TREE_DIR)
  const detected = bad.missing.some(m => m.rel.includes('__this_page_does_not_exist__'))
  console.log(`SELF-TEST: clean manifest → ${clean.missing.length} missing (checked ${clean.checked})`)
  console.log(`SELF-TEST: poisoned manifest → ${bad.missing.length} missing, wrong-path detected = ${detected}`)
  if (!detected) {
    console.error('SELF-TEST: FAIL — the gate did NOT notice a deliberately wrong src. It cannot fail, so it cannot pass.')
    process.exit(1)
  }
  if (bad.missing.length !== clean.missing.length + 1) {
    console.error(`SELF-TEST: FAIL — expected exactly one NEW miss, got ${bad.missing.length} vs a clean ${clean.missing.length}.`)
    process.exit(1)
  }
  console.log('SELF-TEST: PASS — the gate detects a wrong target and is therefore capable of failing.')
  process.exit(0)
}

// ── normal run ─────────────────────────────────────────────────────────────────────────────────
const manifestPath = join(TREE_DIR, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`EMBED-TARGETS: FAIL — no ${manifestPath}. Run \`bun run build\` first.`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const { total, checked, skipped, missing } = run(manifest, TREE_DIR)

// A manifest with no iframe snippets at all would otherwise print a serene PASS while the whole
// iframe deployment method had vanished — absence again. Treat it as a failure.
if (total === 0) {
  console.error('EMBED-TARGETS: FAIL — the manifest declares ZERO embed.iframe snippets; deployment-method 1 is gone.')
  process.exit(1)
}
if (missing.length) {
  console.error(`EMBED-TARGETS: FAIL — ${missing.length}/${checked} embed.iframe target(s) do not exist on disk:`)
  for (const m of missing) console.error(`  ${m.src}\n    → expected public/${TREE}/${m.rel}   (${m.where})`)
  console.error('  Every one of these is a paste-anywhere snippet that would 404 on a partner site.')
  process.exit(1)
}
console.log(`EMBED-TARGETS: PASS — all ${checked} embed.iframe target(s) exist under public/${TREE}/${skipped ? ` (${skipped} off-site, skipped)` : ''}.`)
