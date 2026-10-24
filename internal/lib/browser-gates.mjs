/** internal/lib/browser-gates.mjs — which package.json scripts drive a real browser (read from the gate FILE).
 *  Shared by run-parallel (to route them through browser-slot.sh) and check-browser-gates-guarded (--list). */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Does this step drive a real browser? Asked of the GATE FILE, not of a hand-kept list:
 * a list goes stale the first time someone adds a gate, and a browser gate missing from it
 * is exactly the one that rejoins the dogpile. package.json names the file; the file says
 * whether it imports playwright.
 */
export function isBrowserGate(ROOT, name) {
  try {
    const scripts = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts || {}
    const m = String(scripts[name] || '').match(/([\w./-]+\.mjs)/)
    if (!m) return false
    const file = resolve(ROOT, m[1])
    if (!existsSync(file)) return false
    const src = readFileSync(file, 'utf8')
    // Two ways a step can drive chrome: it launches one itself, or it is a RUNNER that
    // launches gates which do. `verify` is the second kind — verify-all.mjs imports no
    // playwright and would have been graded static, while three of the gates it spawns
    // (posters, app-tables, map-paint) render pages. It already marks those `browser: true`
    // for its own reasons, so that declaration is honoured here rather than duplicated.
    // …but a runner only drives chrome when ASKED to: verify-all runs its browser guards only with --full,
    // so plain `verify` is a static step (it printed "ALL GUARDS PASS (browser guards skipped)" and was
    // still routed through the browser slot, where a headless seat could only fail or skip it).
    // playwright-guarded.mjs is how every repo gate reaches playwright now (a firefox-only gate names no chromium).
    if (/from 'playwright'|require\('playwright'\)|from\s+['"][^'"]*playwright-guarded\.mjs['"]|import\(\s*['"][^'"]*playwright-guarded\.mjs|chromium/.test(src)) return true
    return /browser:\s*true/.test(src) && /--full\b/.test(String(scripts[name]))
  } catch { return false }
}
