#!/usr/bin/env node
/**
 * inline-parse-check.mjs — parse-verify every inline <script> in the built tree.
 *
 * WHY (EXP-627, 2026-07-11): the blank-staging bug class survived TWO grep-verified
 * "fixes" — (1) import.meta inside a classic script, (2) manifest embed snippets
 * containing a literal script-close tag that terminates the inline script in every
 * browser. Both are PARSE-level failures invisible to grep. Verification depth
 * ladder: grep-presence < PARSE < render. This is the parse rung, wired into the
 * build so a page that cannot even parse can never ship silently again.
 *
 * Usage: node internal/inline-parse-check.mjs [treeDir]   (default: app/<name> from build config)
 * Exit 0 = every inline script in every page parses · Exit 1 = failures listed.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { TREE_NAME } from './_tree-name.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bundlerRoot = resolve(here, '..')
let treeDir = process.argv[2]
if (!treeDir) {
  let name = TREE_NAME
  const cfg = join(bundlerRoot, 'vite.doxa-maps-build-config.json')
  if (existsSync(cfg)) { try { name = JSON.parse(readFileSync(cfg, 'utf8')).name || name } catch {} }
  treeDir = join(bundlerRoot, 'public', name)
}
if (!existsSync(treeDir)) { console.error(`inline-parse-check: no tree at ${treeDir} (build first)`); process.exit(1) }

const pages = []
;(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (e.endsWith('.html')) pages.push(p)
  }
})(treeDir)

let fails = 0, scripts = 0
for (const page of pages) {
  const html = readFileSync(page, 'utf8')
  const rel = relative(treeDir, page) || 'index.html'
  const re = /<script>([\s\S]*?)<\/script>/g
  let m, i = 0
  while ((m = re.exec(html))) {
    i++; scripts++
    const tmp = join(tmpdir(), `ipc-${process.pid}-${scripts}.js`)
    writeFileSync(tmp, m[1])
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }) }
    catch (e) {
      fails++
      const msg = String(e.stderr || e.message).split('\n').filter(Boolean).pop() || 'parse error'
      console.error(`FAIL ${rel} script#${i}: ${msg.slice(0, 140)}`)
    }
    unlinkSync(tmp)
  }
}
if (fails) { console.error(`INLINE-PARSE: FAIL — ${fails}/${scripts} inline script(s) do not parse (page would blank in the browser).`); process.exit(1) }
console.log(`INLINE-PARSE: PASS — ${scripts} inline script(s) across ${pages.length} page(s) all parse.`)
