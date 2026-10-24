#!/usr/bin/env node
/**
 * check-shadow-reduced-motion.mjs — every animating library component honours prefers-reduced-motion.
 *
 * WHY: a page's own reduced-motion reset never crosses a shadow boundary, so a component rendered inside a
 * custom element's shadow root animates for a reader who asked for less motion unless the root carries its
 * own reset (ProgressBar; ten legend and map-control components had none).
 *
 * WHAT: (1) library/composables/useShadowStyles.js injects REDUCED_MOTION_CSS, a prefers-reduced-motion:
 * reduce block, once per shadow root; (2) every library/components/**.vue that declares a transition or an
 * animation either styles itself through useShadowStyles (so the reset reaches it) or carries its own
 * @media (prefers-reduced-motion: reduce) block. The self-test runs on every invocation.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.DOXA_REPO || join(dirname(fileURLToPath(import.meta.url)), '..')
const ANIMATES = /(^|[;{\s])(transition|animation)(-[a-z-]+)?\s*:/m
const OWN_GUARD = /prefers-reduced-motion\s*:\s*reduce/
const USES_SHADOW = /\buseShadowStyles\s*\(/

export function uncovered(file, src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return ANIMATES.test(code) && !USES_SHADOW.test(code) && !OWN_GUARD.test(code) ? [file] : []
}

// self-test, every run
if (uncovered('a.vue', '.x{transition:width 1s}').length !== 1
  || uncovered('b.vue', "useShadowStyles(`.x{transition:width 1s}`)").length
  || uncovered('c.vue', '.x{transition:width 1s} @media (prefers-reduced-motion: reduce){.x{transition:none}}').length
  || uncovered('d.vue', '/* transition: none */ .x{color:red}').length) {
  console.error('SHADOW-REDUCED-MOTION: self-test FAIL'); process.exit(3)
}

let bad = 0
const uss = readFileSync(join(ROOT, 'library/composables/useShadowStyles.js'), 'utf8')
if (!/export const REDUCED_MOTION_CSS\s*=\s*`@media \(prefers-reduced-motion: reduce\)/.test(uss) || !/data-shadow-styles', 'reduced-motion'/.test(uss)) {
  console.error('  ✗ useShadowStyles.js no longer injects its prefers-reduced-motion reset into each shadow root'); bad++
}
const files = execFileSync('git', ['ls-files', '--', 'library/components'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.vue'))
const miss = files.flatMap((f) => uncovered(f, readFileSync(join(ROOT, f), 'utf8')))
for (const m of miss) { console.error(`  ✗ ${m}: animates, but neither styles itself through useShadowStyles nor carries its own reduced-motion block`); bad++ }
if (bad) { console.error(`\nSHADOW-REDUCED-MOTION: FAIL — ${bad} problem(s)`); process.exit(1) }
console.log(`SHADOW-REDUCED-MOTION: PASS — useShadowStyles resets motion in every shadow root; ${files.length} library components checked, every animating one is covered.`)
