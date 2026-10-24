#!/usr/bin/env node
/**
 * check-browser-gates-guarded — no repo gate reaches Playwright except through the slot guard. Headless.
 *
 * Browsers run only on the browser seat and only inside internal/browser-slot.sh. The rule is enforced
 * by internal/lib/playwright-guarded.mjs (a launch refuses, exit 75, without DOXA_BROWSER_SLOT), so a
 * file that imports 'playwright' DIRECTLY would bypass it. This fails any such file under internal/ or
 * plugin-designs/. `--list` prints every gate script that launches a browser instead.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBrowserGate } from './lib/browser-gates.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.includes('--list')) {
  const scripts = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts || {}
  const names = Object.keys(scripts).filter((n) => !n.startsWith('gates:') && isBrowserGate(ROOT, n)).sort()
  console.log(names.join('\n'))
  console.error(`${names.length} script(s) launch a browser: run each as internal/browser-slot.sh bun run <name>`)
  process.exit(0)
}
// A REAL import, not text that names one: a static import statement at the start of a line, or a literal
// dynamic import or require of the playwright package. The detectors (browser-gates.mjs, this file) spell the
// pattern inside regex literals, escaped, which none of these match, so they need no exclusion and a real
// import added to one still fails. Only the guard itself imports playwright, by design.
// Also a PATH to the package (node_modules/playwright…, or playwright-core) anywhere in code: a gate imported
// resolve(ROOT, 'node_modules/playwright/index.mjs') dynamically, named no specifier, and launched outside the
// slot while this check passed it (upg100 found and measured it).
const DIRECT = /^\s*import\b[^;\n]*\bfrom\s+['"]playwright(?:-core)?['"]|\bimport\(\s*['"]playwright(?:-core)?['"]\s*\)|\brequire\(\s*['"]playwright(?:-core)?['"]\s*\)|node_modules[\/\\]playwright(?:-core)?\b/m
const files = execFileSync('git', ['ls-files', '--', 'internal', 'plugin-designs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(mjs|js|cjs)$/.test(f) && f !== 'internal/lib/playwright-guarded.mjs')
const bad = []
for (const f of files) {
  const code = readFileSync(resolve(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (DIRECT.test(code)) bad.push(f)
}
if (bad.length) {
  for (const f of bad) console.log(`  FAIL  ${f} imports playwright directly; import it from internal/lib/playwright-guarded.mjs`)
  console.log(`BROWSER-GATES-GUARDED: FAIL — ${bad.length} file(s) can launch a browser outside the slot.`)
  process.exit(1)
}
console.log(`BROWSER-GATES-GUARDED: PASS — no repo file imports playwright except through the slot guard (${files.length} files read).`)
