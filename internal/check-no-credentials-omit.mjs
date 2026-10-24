#!/usr/bin/env node
/**
 * check-no-credentials-omit.mjs — no data fetch in library/ or plugin-designs/ may use credentials:'omit'.
 *
 * WHY (2026-09-27): behind any login gate (basic auth, a session cookie, OIDC) the Research
 * Gallery said "Could not load Big Picture", because doxa-maps-spa fetched its SAME-ORIGIN manifest with
 * credentials:'omit', so the gate's cookie never went and the request was refused. 'same-origin' (the fetch
 * default) sends credentials only to the page's own origin: a cross-origin CDN or token service still
 * receives nothing, so the CORS setup is unaffected.
 *
 * A site that genuinely needs 'omit' (a same-origin request that must NOT carry the session) says so on the
 * same line: `// credentials-omit: <reason>`. Comments are stripped before matching, so prose that merely
 * mentions the option does not count. --self-test proves a planted 'omit' is caught.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.DOXA_REPO || join(dirname(fileURLToPath(import.meta.url)), '..')
const OMIT = /credentials\s*:\s*['"]omit['"]/

export function offenders(file, src) {
  const out = []
  src.split('\n').forEach((line, i) => {
    if (/credentials-omit:\s*\S/.test(line)) return
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
    if (OMIT.test(code)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 110)}`)
  })
  return out
}

if (process.argv.includes('--self-test')) {
  const bad = offenders('x.js', "fetch(u, { credentials: 'omit' })")
  const ok1 = offenders('x.js', "// credentials: 'omit' is what broke the gallery")
  const ok2 = offenders('x.js', "fetch(u, { credentials: 'omit' }) // credentials-omit: public beacon, no session")
  if (bad.length !== 1 || ok1.length || ok2.length) { console.error('NO-CREDENTIALS-OMIT self-test: FAIL'); process.exit(1) }
  console.log('NO-CREDENTIALS-OMIT self-test: PASS — a planted omit is caught; prose and an annotated site are not.')
  process.exit(0)
}

const files = execFileSync('git', ['ls-files', '--', 'library', 'plugin-designs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(m?js|vue|ts)$/.test(f))
const bad = files.flatMap((f) => offenders(f, readFileSync(join(ROOT, f), 'utf8')))
if (bad.length) {
  console.error(`NO-CREDENTIALS-OMIT: FAIL — ${bad.length} fetch(es) use credentials:'omit':`)
  for (const b of bad) console.error('  ✗ ' + b)
  console.error("\n  Behind a login gate a same-origin request then drops the session cookie and is refused. Use 'same-origin'")
  console.error("  (it never sends credentials cross-origin), or annotate a deliberate one: // credentials-omit: <reason>.")
  process.exit(1)
}
console.log(`NO-CREDENTIALS-OMIT: PASS — ${files.length} source files, no fetch drops a same-origin session.`)
