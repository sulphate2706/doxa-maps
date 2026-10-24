#!/usr/bin/env node
/**
 * fix-sri.mjs — rewrite every baked SRI hash in an ALREADY-BUILT tree, and nothing else.
 *
 * ★ WHY THIS EXISTS, and the premise it CORRECTS.
 *   The dispatch that asked for this said: "`bun run tree` regenerates manifest.json + leaf pages
 *   but NOT the baked SRI hashes, so `bun run check:sri` fails." MEASURED 2026-09-23, that is
 *   FALSE — generate-tree.mjs hashes each bundle (its `integrity` local, ~line 1054) and threads
 *   the value into every page it writes. Proven by poisoning one leaf's integrity
 *   (check:sri -> exit 1), running `bun run tree`, and re-checking (exit 0).
 *
 *   So the cheap path was never missing. What was missing is the SIGNPOST and the SIZE:
 *
 *   1. THE SIGNPOST. check:sri's own failure text said "FIX: run a full `bun run build`". An agent
 *      that trusts the gate it just ran is then sent straight at the destructive path — whose first
 *      step deletes public/doxa-maps/ and tears the tree out from under every concurrent reader
 *      (measured 3+ times: a 461-file phantom deletion, several false "element did not mount"
 *      diagnoses). The gate was TEACHING the failure mode the build-lock guard exists to prevent.
 *      That message now names this script. A gate that diagnoses correctly and prescribes the
 *      dangerous remedy is worse than one that says nothing, because it is obeyed.
 *
 *   2. THE SIZE. `bun run tree` is cheap only next to a full build. MEASURED on this box: 2.7-4.5s,
 *      and it WRITES 1234 files under public/ (450 under public/doxa-maps) every single run,
 *      because it re-copies 401 runtime assets and re-emits all 48 pages. That churn is not free
 *      to your neighbours: internal/settled-tree-gate.mjs fails a tree with ANY write in the last
 *      45s, so one `bun run tree` blinds every other agent's check:settled for three quarters of a
 *      minute, and those agents are told "do NOT measure or publish this tree."
 *
 *      Worse, on a SHARED BRANCH `tree` regenerates pages FROM SOURCE — so it silently bakes a
 *      neighbour's in-flight .vue edits into leaf pages under YOUR change. Same family as the
 *      measured hazard of committing a built bundle on a shared branch.
 *
 *      This script writes ONLY the pages whose hash actually disagrees. In the normal case that is
 *      one file, and when the tree is already consistent it is ZERO files — nothing to churn,
 *      nothing to un-settle, no source re-read at all.
 *
 * ★ WHAT IT DOES NOT DO — and this limit is the point, not an omission.
 *   It makes the HASHES AGREE. It does not make the BUNDLE CORRECT. If public/doxa-maps/x/x.js was
 *   built from stale source, this bakes a matching hash for stale code and check:sri goes green.
 *   That is equally true of `bun run tree`, and it is why this is a REPAIR verb, not a build verb:
 *   build the bundle first (`BUNDLE=x bun x vite build`), then run this to re-agree the leaves.
 *   Bundle FRESHNESS is a different question with its own gate — `bun run check:composite`.
 *   It also asserts nothing about how many leaves SHOULD exist; a tree gutted by a partial build
 *   is still unpublishable after this passes. That is settled-tree-gate.mjs's signal 4.
 *   The publish runbook still runs BOTH: `bun run check:settled && bun run check:sri`.
 *
 * WHAT IT REWRITES
 *   - every `<script src="<local>.js" integrity="...">` on every index.html in the tree
 *   - manifest.json's `bundles[].integrity` (what check:catalog-identity compares the LIVE bytes
 *     against — leaving this stale would trade one broken gate for another)
 *   - manifest.json's `bundles[].profiles[].embed.script` snippet, which carries its own integrity
 *     and is pasted VERBATIM by partners (deployment method 2)
 *   A tag with no integrity at all gets one, in generate-tree's exact emitted shape
 *   (`integrity="..." crossorigin="anonymous"`), because a leaf shipped without SRI is a silent
 *   downgrade of a protection this repo deliberately added, and check:sri cannot see it: that gate
 *   only compares the hashes that are PRESENT.
 *
 * USAGE
 *   node internal/fix-sri.mjs [treeDir ...]   # default public/doxa-maps
 *   node internal/fix-sri.mjs --dry-run       # report what would change, write nothing
 *   node internal/fix-sri.mjs --self-test     # NEGATIVE test, see below
 * Exit 0 = tree consistent. 1 = a referenced script DOES NOT EXIST (torn tree; cannot be
 * repaired by rehashing — that needs the bundle built). 2 = tree not found.
 *
 * NEGATIVE-TESTED via `--self-test`: builds a synthetic tree in a temp dir carrying (a) a leaf with
 * a WRONG integrity, (b) a leaf with NO integrity, (c) a manifest with a wrong bundle hash and a
 * wrong embed snippet; requires sri-consistency-check to go RED on it FIRST (a fixer whose check
 * could not fail proves nothing), then requires green, then requires a second run to write zero
 * files. Temp dir only — a crash can never leave the real tree edited.
 */
import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHECKER = join(HERE, 'sri-consistency-check.mjs')

const argv = process.argv.slice(2)
const SELF_TEST = argv.includes('--self-test')
const DRY = argv.includes('--dry-run')
const TREES = argv.filter((a) => !a.startsWith('--'))

// One bundle .js is referenced by up to 5 leaves plus the manifest, and these are ~400KB IIFEs,
// so hashing per REFERENCE instead of per FILE made a 100-reference tree read 100 files. Cache by
// absolute path: a single run is one pass over an unchanging tree, and the caller is expected to
// build BEFORE repairing (see the header) — so a mid-run change to a .js is out of contract.
const HASHES = new Map()
function sri(file) {
  let h = HASHES.get(file)
  if (h === undefined) {
    h = 'sha384-' + createHash('sha384').update(readFileSync(file)).digest('base64')
    HASHES.set(file, h)
  }
  return h
}

function leafPages(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) leafPages(p, out)
    else if (e.name === 'index.html') out.push(p)
  }
  return out
}

/**
 * Re-agree every local <script src> tag in `html` with the bytes on disk.
 * `resolveSrc` maps an href to an absolute path (pages resolve against themselves; the manifest's
 * embed snippets resolve against the tree root). Third-party (mapbox CDN) srcs are left alone —
 * we cannot hash what we do not serve.
 */
function rewriteTags(html, resolveSrc, st) {
  return html.replace(/<script\b[^>]*>/g, (tag) => {
    const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1]
    if (!src || /^https?:|^\/\//.test(src)) return tag
    const file = resolveSrc(src)
    if (!file || !existsSync(file)) { st.missing.push(src); return tag }
    const want = sri(file)
    const have = (tag.match(/\bintegrity="(sha384-[^"]+)"/) || [])[1]
    if (have === want) { st.agreed++; return tag }
    if (have) {
      st.rehashed++
      return tag.replace(/\bintegrity="sha384-[^"]*"/, 'integrity="' + want + '"')
    }
    st.added++
    // Preserve whatever trailing whitespace / self-closing slash the tag had.
    const m = tag.match(/^([\s\S]*?)(\s*\/?)>$/)
    return m[1] + ' integrity="' + want + '" crossorigin="anonymous"' + m[2] + '>'
  })
}

function fixTree(root) {
  const st = { agreed: 0, rehashed: 0, added: 0, missing: [], filesWritten: [] }
  if (!existsSync(root)) {
    console.error('FIX-SRI: tree not found: ' + root)
    process.exit(2)
  }

  for (const page of leafPages(root)) {
    const before = readFileSync(page, 'utf8')
    const after = rewriteTags(before, (src) => resolve(dirname(page), src), st)
    if (after !== before) {
      if (!DRY) writeFileSync(page, after)
      st.filesWritten.push(page)
    }
  }

  const mf = join(root, 'manifest.json')
  if (existsSync(mf)) {
    const before = readFileSync(mf, 'utf8')
    const m = JSON.parse(before)
    for (const b of (m.bundles || [])) {
      if (b.scriptUrl && !/^https?:|^\/\//.test(b.scriptUrl)) {
        const js = resolve(root, b.scriptUrl)
        if (existsSync(js)) {
          const want = sri(js)
          if (b.integrity !== want) { b.integrity = want; st.rehashed++ } else st.agreed++
        } else st.missing.push(b.scriptUrl)
      }
      for (const p of (b.profiles || [])) {
        if (!p.embed || typeof p.embed.script !== 'string') continue
        p.embed.script = rewriteTags(p.embed.script, (src) => resolve(root, src), st)
      }
    }
    // Same serialization generate-tree.mjs uses, so a repair produces no formatting diff.
    const after = JSON.stringify(m, null, 2) + '\n'
    if (after !== before) {
      if (!DRY) writeFileSync(mf, after)
      st.filesWritten.push(mf)
    }
    // The Research Gallery reads a BYTE-IDENTICAL copy of the manifest first when it runs on a foreign
    // origin (generate-tree writes it; see doxa-maps-spa.vue). Repairing the root manifest alone left the
    // copy with the OLD integrity, so an embedded gallery refused the rebuilt bundle (measured 2026-09-25).
    for (const rel of ['doxa-maps-spa/manifest.json']) {
      const copy = join(root, rel)
      if (existsSync(copy) && readFileSync(copy, 'utf8') !== after) {
        if (!DRY) writeFileSync(copy, after)
        st.filesWritten.push(copy)
      }
    }
  }
  return st
}

function report(root, st) {
  const verb = DRY ? 'WOULD rewrite' : 'rewrote'
  console.log(
    'FIX-SRI[' + root + ']: ' + st.agreed + ' already agreed, ' + verb + ' ' + st.rehashed +
    ' stale hash(es), added ' + st.added + ' missing one(s), ' +
    (DRY ? 'would write ' : 'wrote ') + st.filesWritten.length + ' file(s).'
  )
  for (const f of st.filesWritten) console.log('  ' + (DRY ? '~ ' : '+ ') + f)
  if (st.missing.length) {
    const uniq = [...new Set(st.missing)]
    console.error('\nFIX-SRI: ' + uniq.length + ' referenced script(s) DO NOT EXIST — rehashing cannot')
    console.error('         repair this; the bundle has to be BUILT. Run, for each one:')
    console.error('           BUNDLE=<name> bun x vite build   # then re-run this script')
    for (const s of uniq.slice(0, 10)) console.error('  missing: ' + s)
    return 1
  }
  return 0
}

// ── NEGATIVE TEST ────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const dir = join(tmpdir(), 'fix-sri-selftest-' + process.pid)
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg); else console.log('  ok — ' + msg) }
  try {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, 'b', 'p'), { recursive: true })
    mkdirSync(join(dir, 'b', 'q'), { recursive: true })
    writeFileSync(join(dir, 'b', 'b.js'), 'console.log("b")\n')
    const REAL = sri(join(dir, 'b', 'b.js'))
    const WRONG = 'sha384-' + 'A'.repeat(64)

    // (a) a leaf whose baked hash is WRONG — the case check:sri exists to catch
    writeFileSync(join(dir, 'b', 'p', 'index.html'),
      '<!doctype html><script src="../b.js" integrity="' + WRONG + '" crossorigin="anonymous"></script>\n')
    // (b) a leaf with NO integrity at all — invisible to check:sri, still a real downgrade
    writeFileSync(join(dir, 'b', 'q', 'index.html'),
      '<!doctype html><script src="../b.js"></script>\n')
    // (c) a manifest with a wrong bundle hash AND a wrong paste-verbatim embed snippet
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      schema: 'self-test', bundles: [{
        bundle: 'b', scriptUrl: './b/b.js', integrity: WRONG,
        profiles: [{ profile: 'p', embed: { script: '<script src="./b/b.js" integrity="' + WRONG + '"></script>' } }],
      }],
    }, null, 2) + '\n')

    // 1. THE CONTROL MUST BE ABLE TO GO RED. A fixer validated by a check that has only ever
    //    printed PASS proves nothing at all.
    const red = spawnSync(process.execPath, [CHECKER, dir], { encoding: 'utf8' })
    ok(red.status === 1, 'check:sri goes RED on the poisoned tree (exit ' + red.status + ', expected 1)')
    ok(/b\/p\/index\.html/.test(red.stderr + red.stdout),
      'it goes red for the RIGHT page (b/p/index.html named in the output)')

    // 2. repair
    const st = fixTree(dir)
    ok(st.rehashed >= 2, 'rehashed the stale leaf AND the stale manifest bundle (rehashed=' + st.rehashed + ', expected >=2)')
    ok(st.added === 1, 'added the ONE missing integrity (added=' + st.added + ')')
    ok(st.missing.length === 0, 'no unresolvable script refs (missing=' + st.missing.length + ')')

    // 3. GREEN AFTER — and not vacuously green: it must have had something to check.
    const green = spawnSync(process.execPath, [CHECKER, dir], { encoding: 'utf8' })
    ok(green.status === 0, 'check:sri goes GREEN after the repair (exit ' + green.status + ')')
    const checked = Number((green.stdout.match(/checked (\d+) script reference/) || [])[1] || 0)
    ok(checked >= 2, 'the green run actually MEASURED both leaves (checked=' + checked + ', expected >=2) — a tree with nothing to compare also prints PASS')

    // 4. the manifest, which check:sri never reads, is repaired too
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    ok(m.bundles[0].integrity === REAL, 'manifest bundles[].integrity now matches the bytes')
    ok(m.bundles[0].profiles[0].embed.script.includes(REAL), 'the paste-verbatim embed snippet now matches the bytes')
    ok(readFileSync(join(dir, 'b', 'q', 'index.html'), 'utf8').includes('integrity="' + REAL + '" crossorigin="anonymous"'),
      'the integrity-less leaf gained one, in generate-tree\'s emitted shape')

    // 5. IDEMPOTENT — the whole point is that a consistent tree costs ZERO writes, so running
    //    this never un-settles the tree for a neighbouring agent.
    const again = fixTree(dir)
    ok(again.filesWritten.length === 0, 'a second run writes 0 file(s) (wrote ' + again.filesWritten.length + ')')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (fails.length) {
    console.error('\nFIX-SRI SELF-TEST: FAIL — ' + fails.length + ' assertion(s):')
    for (const f of fails) console.error('  ✗ ' + f)
    process.exit(1)
  }
  console.log('\nFIX-SRI SELF-TEST: PASS — the repair is proven against a check that was first proven to fail.')
}

if (SELF_TEST) {
  selfTest()
} else {
  let code = 0
  for (const root of (TREES.length ? TREES : [`public/${TREE_NAME}`])) {
    code = report(root, fixTree(root)) || code
  }
  process.exit(code)
}
