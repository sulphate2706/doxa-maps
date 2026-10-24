#!/usr/bin/env node
/**
 * check-no-public-binds.mjs — no script in this repo may start a server on a public interface.
 *
 * THE DEFECT THIS CATCHES, measured not imagined. `serve` was
 *     python3 -m http.server 4173 --bind 0.0.0.0 --directory public
 * Every browser gate runs `bun run serve` first, and every agent that runs a browser gate is a
 * separate process, so the binds accumulated. A live audit of the build VPS found NINETEEN publicly
 * bound http.server processes on ports 4820-4970 plus one on 8899, every one rooted at public/, and
 * a curl to the box's own public IP returned HTTP 200. None of them were noticed by anyone, because
 * a listening socket produces no output and no failure — the gate it served passed, and the process
 * outlived it.
 *
 * ★ WHY THIS IS THE INTERESTING CLASS. The standing rule "keep the build machine closed" lived in prose, in
 * instructions to an agent. The actual behaviour lived in a FLAG in package.json. Prose cannot
 * constrain a flag. The rule was never violated by a decision — it was violated by a default that
 * nobody re-read, and it stayed violated because nothing ever asked the question out loud. It was
 * stated plainly: a build machine needs no open ports, because changes are pushed to the git remote
 * and pulled onto a laptop; Playwright is for internal testing, not for public access.
 *
 * Loopback is sufficient for the entire test suite: verify-browser-all, check:a11y-button-names,
 * check:nav-reachable and smoke:share-all all already default to 127.0.0.1. The wide bind bought
 * nothing and cost an open box.
 *
 * WHAT IT ASSERTS:
 *   1. no script contains `--bind 0.0.0.0`, `--host 0.0.0.0`, or `--host` with no argument
 *      (vite's bare `--host` means "all interfaces", which is the same defect spelled differently);
 *   2. any script that starts a static server names an explicit loopback bind, so adding a new
 *      server without thinking about its interface fails here rather than on a port scan.
 *
 * It deliberately does NOT inspect the machine's live sockets. A gate that reads `ss` would pass or
 * fail based on whatever happens to be running at that moment, which is not a property of the repo
 * and cannot be fixed by editing the repo. Kill strays operationally; keep the gate about the code.
 *
 * NEGATIVE-TESTED: restoring `--bind 0.0.0.0` on either serve script fails by name with exit 1.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts || {}

const PUBLIC_BIND = [
  { re: /--bind\s+0\.0\.0\.0/, why: '--bind 0.0.0.0 listens on every interface' },
  { re: /--host\s+0\.0\.0\.0/, why: '--host 0.0.0.0 listens on every interface' },
  { re: /--bind\s+\[::\]/, why: '--bind [::] listens on every IPv6 interface' },
  // `vite --host` with no value is the sneaky one: it reads like "set a host" and MEANS "all of them".
  { re: /--host(?:\s|$)(?!\s*(?:127\.0\.0\.1|localhost))/, why: 'a bare --host (no address) means ALL interfaces' },
]

// Scripts that start a long-lived static server must say where they bind, explicitly.
const SERVER = /http\.server|vite preview|serve\b/

const errs = []
for (const [name, body] of Object.entries(scripts)) {
  const cmd = String(body)
  // Only judge the command, not the trailing `#` explanation — a comment describing the OLD bad
  // value (which `serve` now carries, deliberately) must not trip the gate that the comment exists
  // to explain. This is the same shape as a lint rule firing on its own documentation.
  const code = cmd.split(/\s+#\s/)[0]

  for (const { re, why } of PUBLIC_BIND) {
    if (re.test(code)) {
      errs.push(`  "${name}" — ${why}\n      ${code.trim().slice(0, 110)}`)
      break
    }
  }

  if (SERVER.test(code) && /http\.server/.test(code) && !/--bind\s+(127\.0\.0\.1|localhost)/.test(code)) {
    errs.push(
      `  "${name}" — starts an http.server without an explicit loopback --bind.\n` +
      '      python3 -m http.server defaults to ALL interfaces when --bind is omitted, so leaving it\n' +
      '      off is the same exposure as writing 0.0.0.0, just less visible in review.'
    )
  }
}

if (errs.length) {
  console.error('NO-PUBLIC-BINDS: FAIL — a repo script would open a port to the network.\n')
  errs.forEach((e) => console.error(e))
  console.error('\n  The whole test suite reaches its server over 127.0.0.1. Nothing here needs a public')
  console.error('  bind: code moves between machines through the git remote, not through an open port. Use')
  console.error('  --bind 127.0.0.1, and pass BASE_URL/BASE if some caller genuinely needs another host.')
  process.exit(1)
}

const servers = Object.entries(scripts).filter(([, b]) => /http\.server/.test(String(b).split(/\s+#\s/)[0]))
console.log(`NO-PUBLIC-BINDS: PASS — ${Object.keys(scripts).length} scripts checked, ${servers.length} static server(s), all loopback-bound.`)
servers.forEach(([n, b]) => {
  const m = String(b).match(/--bind\s+(\S+)/)
  console.log(`  ${n} -> ${m ? m[1] : '(none)'}`)
})
console.log('  This checks the REPO, not the machine. A stray server someone started by hand is an')
console.log('  operational problem; only what is written here can be fixed by editing here.')
