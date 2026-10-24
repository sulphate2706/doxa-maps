#!/usr/bin/env node
/**
 * check-studio-rail — the Plugin Studio's rail is laid out like plugin-designs/. Headless.
 *
 * The ask (2026-09-26): one FOLDER per BUNDLE with its ELEMENTS inside, bundles sorted by
 * capability, highest first. Runs the studio's REAL treeSections / compositionTrees / rowsFromManifest
 * (loaded through Vite, no browser) against the BUILT manifest and asserts:
 *   - EVERY bundle sits in a capability section (they run CAP 5 → 1), in the section of its HIGHEST
 *     capability, once; there is no Experimental section: every plugin is capability 1-5 (since
 *     2026-09-27), and a non-production bundle says so on its own rows;
 *   - bundles within a section are in name order;
 *   - a bundle with several elements is ONE folder holding all of them; a single-element bundle is its element;
 *   - every studio row has exactly ONE canonical node (one identity per plugin; parts only target it).
 * EXIT 0 pass · 1 fail · 0 with SKIP when there is no built manifest
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

/**
 * Every PRODUCTION profile that declares no "label". Pure — takes a manifest, returns messages — so
 * the self-test below can run it over a fixture without standing up Vite or a built tree.
 */
function undeclaredLabels(manifest) {
  const out = []
  for (const b of manifest.bundles || []) {
    for (const p of b.profiles || []) {
      // ⚠ PROFILE STAGE, NOT BUNDLE STAGE — the same trap, a third time. A BUNDLE reads
      // `stage: production` when ANY ONE of its profiles is production, so scoping the loop by
      // b.stage drags every experimental sibling in with it. Measured: cities-internet is a
      // production bundle whose connectivity-list and data-tables are EXPERIMENTAL, and
      // gospel-resources likewise for charts / data-tables / resources-list. That was 5 false
      // violations out of 7 (caught 2026-09-28).
      // I had already moved off stageOf (bundle-keyed) once; moving to b.stage was the SAME
      // mistake wearing a different field name. The profile's own stage is the only one that
      // answers "is this row production".
      if (p.stage !== 'production') continue
      const declared = p.label
      if (declared === null || declared === undefined || !String(declared).trim()) {
        out.push(`${b.bundle}/${p.profile} is PRODUCTION but declares no "label" in its <profile>.meta.json — the rail falls back to a humanized id, which names nothing`)
      }
    }
  }
  return out
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
// ★ A PLANTED VIOLATION, because the first version of this rule PASSED on a manifest that contained
// the very defect it was written for. Two cases, and the SECOND is the one that matters: a rule that
// fails everything is as useless as one that fails nothing.
if (process.argv.includes('--self-test')) {
  const fixture = { bundles: [
    { bundle: 'planted-prod', stage: 'production',   profiles: [{ profile: 'nameless', stage: 'production', label: null }] },
    { bundle: 'planted-exp',  stage: 'experimental', profiles: [{ profile: 'nameless', stage: 'experimental', label: null }] },
    { bundle: 'planted-ok',   stage: 'production',   profiles: [{ profile: 'named', stage: 'production', label: 'A Real Name' }] },
    // An EMPTY STRING is nameless too — `label: ""` would satisfy a null check and render blank.
    { bundle: 'planted-blank', stage: 'production',  profiles: [{ profile: 'blank', stage: 'production', label: '   ' }] },
    // ★ THE CASE THE FIRST SELF-TEST MISSED, and the bug it would have caught. A BUNDLE reads
    // production when ANY profile is, so a mixed bundle must flag ONLY its production profile.
    // The earlier fixture gave every bundle one profile, so bundle-stage and profile-stage agreed
    // and scoping by the wrong one was invisible. A fixture where the two CANNOT disagree cannot
    // test which one you read.
    { bundle: 'planted-mixed', stage: 'production', profiles: [
      { profile: 'prod-nameless', stage: 'production',   label: null },
      { profile: 'exp-nameless',  stage: 'experimental', label: null },
    ] },
  ] }
  const hits = undeclaredLabels(fixture)
  const cases = [
    ['production + no label FAILS',        hits.some((h) => h.startsWith('planted-prod/'))],
    ['experimental + no label PASSES',    !hits.some((h) => h.startsWith('planted-exp/'))],
    ['production + a real label PASSES',  !hits.some((h) => h.startsWith('planted-ok/'))],
    ['production + whitespace-only FAILS', hits.some((h) => h.startsWith('planted-blank/'))],
    ['mixed bundle: its PRODUCTION profile FAILS',      hits.some((h) => h.startsWith('planted-mixed/prod-nameless'))],
    ['mixed bundle: its EXPERIMENTAL profile PASSES',  !hits.some((h) => h.startsWith('planted-mixed/exp-nameless'))],
  ]
  let ok = 0
  for (const [name, pass] of cases) { console.log(`  ${pass ? '✓' : '✗'} ${name}`); if (pass) ok++ }
  console.log(ok === cases.length
    ? `STUDIO-RAIL SELF-TEST: PASS — ${ok}/${cases.length}`
    : `STUDIO-RAIL SELF-TEST: FAIL — ${ok}/${cases.length}`)
  process.exit(ok === cases.length ? 0 : 1)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(MANIFEST)) { console.log('STUDIO-RAIL: SKIP — no built manifest'); process.exit(0) }
const { createServer } = await import('vite')
const { default: vue } = await import('@vitejs/plugin-vue')
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, plugins: [vue({ customElement: true })],
  resolve: { alias: { '@map': join(ROOT, 'library') } }, define: { __DOXA_TREE_NAME__: JSON.stringify(TREE_NAME) } })
globalThis.window = globalThis
globalThis.localStorage = { getItem: () => null, setItem() {} }
let bad = 0
const fail = (m) => { bad++; console.log('  FAIL  ' + m) }
try {
  const comp = (await server.ssrLoadModule('/plugin-designs/plugin-studio/plugin-studio.vue')).default
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const ctx = { manifestBundles: manifest.bundles, tr: (k) => k, cfg: {}, base: '' }
  ctx.rows = comp.methods.rowsFromManifest.call(ctx, manifest)
  ctx.resolveRef = (ref, fb) => comp.methods.resolveRef.call(ctx, ref, fb)
  ctx.compositionTrees = comp.computed.compositionTrees.call(ctx)
  const secs = comp.computed.treeSections.call(ctx)
  const stageOf = new Map(manifest.bundles.map((b) => [b.bundle, b.stage === 'production' ? 'production' : 'experimental']))
  for (const s of secs) if (!(s.cap >= 1 && s.cap <= 5)) fail(`section ${s.id} is not a capability 1-5 section (cap ${s.cap})`)
  const caps = secs.map((s) => s.cap)
  if (caps.join() !== [...caps].sort((a, b) => b - a).join()) fail(`sections not CAP 5 → 1: ${caps.join(',')}`)
  const byBundle = new Map()
  for (const r of ctx.rows) { if (!byBundle.has(r.bundle)) byBundle.set(r.bundle, []); byBundle.get(r.bundle).push(r) }
  const seen = new Map()
  for (const s of secs) {
    const tops = s.nodes.filter((n) => n.depth === 0)
    const names = tops.map((n) => (n.folder ? n.label : ctx.rows.find((r) => r.key === n.target)?.bundle))
    const want = [...names].sort((a, b) => a.localeCompare(b))
    if (names.join() !== want.join()) fail(`CAP ${s.cap}: bundles not in order (${names.join(', ')})`)
    for (const [i, n] of tops.entries()) {
      const b = names[i]; const rows = byBundle.get(b) || []
      if (seen.has(b)) fail(`bundle ${b} appears twice (CAP ${seen.get(b)} and CAP ${s.cap})`)
      seen.set(b, s.cap)
      const top = Math.max(...rows.map((r) => r.cap))
      if (top !== s.cap) fail(`bundle ${b} (highest CAP ${top}) filed under CAP ${s.cap}`)
      if (rows.length > 1) {
        if (!n.folder) fail(`bundle ${b} has ${rows.length} elements but is not a folder`)
        const kids = s.nodes.filter((k) => k.parent === n.id && k.canonical).map((k) => k.target).sort()
        if (kids.join() !== rows.map((r) => r.key).sort().join()) fail(`folder ${b} holds ${kids.length} of its ${rows.length} elements`)
      } else if (n.folder) fail(`single-element bundle ${b} is shown as a folder`)
    }
  }
  for (const b of byBundle.keys()) if (!seen.has(b)) fail(`bundle ${b} is missing from the rail`)
  // A row is NAMED, never shown as a bare id (Gospel x Internet read just "board").
  for (const r of ctx.rows) if (r.label === r.profile || r.label === r.bundle) fail(`${r.key} shows a bare id ("${r.label}") — give its <profile>.meta.json a "label"`)
  // ★ AND A PRODUCTION PROFILE MUST DECLARE ITS NAME, not inherit one.
  //
  // ⚠ THE OBVIOUS VERSION OF THIS RULE IS A NO-OP, and writing it first is how I found out. Testing
  // the RAIL's label for null/empty can never fail: rowsFromManifest falls back to humanize(id)
  // (plugin-studio.vue:421,429), so a profile that declares NOTHING still arrives here as
  // "Doxa Simple Map" — not empty, and not equal to the bare id either, so the bare-id rule above
  // misses it too. humanize() defeats BOTH rules, which is why country-posters could ship a tile
  // nobody had named while this gate stayed green.
  //
  // So the property is the DECLARATION, read from the manifest, not the rendered label: does this
  // profile's <profile>.meta.json carry a "label"? A humanized id is a reasonable DEFAULT and a bad
  // NAME — "Doxa Simple Map" tells a reader nothing the folder did not already say.
  //
  // ⚠ PRODUCTION-STAGE ONLY, deliberately. 15 profiles declare no label today and 14 are
  // experimental — work in progress nobody has named yet, which is not a defect. Failing those
  // would make this gate red for a condition the repo accepts, and a gate that is red for an
  // accepted condition gets ignored. A profile earns the obligation when it reaches production.
  for (const m of undeclaredLabels(manifest)) fail(m)
  const canon = secs.flatMap((s) => s.nodes.filter((n) => n.canonical))
  for (const r of ctx.rows) { const c = canon.filter((n) => n.target === r.key).length; if (c !== 1) fail(`${r.key} has ${c} canonical nodes (want 1)`) }
  const nProd = [...stageOf.values()].filter((v) => v === 'production').length
  console.log(`STUDIO-RAIL: ${byBundle.size} bundle(s) (${nProd} production, ${byBundle.size - nProd} experimental), ${ctx.rows.length} element(s), ${secs.length} section(s); folders: ${secs.flatMap((s) => s.nodes.filter((n) => n.folder).map((n) => n.label + '(' + n.kids + ')')).join(', ')}`)
} finally { await server.close() }
if (bad) { console.log(`STUDIO-RAIL: FAIL — ${bad} problem(s).`); process.exit(1) }
console.log('STUDIO-RAIL: PASS — one folder per bundle with its elements inside; every bundle grouped by its highest capability (5 → 1) in name order, no Experimental section; one identity per plugin.')
