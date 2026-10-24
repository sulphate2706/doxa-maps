/**
 * check-reduced-motion.mjs — a library component that animates must carry its own reduced-motion rule.
 *
 * ★ WHY IT CANNOT BE DONE ONCE, AT THE PAGE. A @media (prefers-reduced-motion) rule in the host
 * document does not cross a shadow boundary, and these components render inside one. Measured while
 * writing this: NO generated leaf page ships such a rule at all — 0 occurrences across the whole
 * built tree — so there is not even a page rule to inherit. Every animating component owns its own.
 *
 * ★ WHAT COUNTS AS ANIMATING: a transition:, an animation:, or an @keyframes in the component's
 * source. Motion declared in a template literal, a concatenated string or a <style> block all count
 * — the mechanism varies across this library and the reader does not care which one was used.
 *
 * ★ THE RULE MUST LIVE WHERE THE STYLES DO. A component whose CSS is injected through
 * useShadowStyles but whose reduced-motion rule sits in a <style> block has written a rule that
 * never reaches the shadow root. That is the defect this repo already knows about from the other
 * direction (composables/useShadowStyles.js), so it is asserted rather than trusted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../library/', import.meta.url).pathname
const files = []
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.vue')) files.push(p)
  }
}
walk(ROOT)

const MOTION = /transition\s*:|animation\s*:|@keyframes/
const fail = []
let animating = 0

for (const p of files) {
  const src = readFileSync(p, 'utf8')
  if (!MOTION.test(src)) continue
  // A component whose only "motion" is the reduced-motion rule itself is not animating.
  const withoutRule = src.replace(/@media\s*\(prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/g, '')
  if (!MOTION.test(withoutRule)) continue
  animating++
  const rel = p.split('/library/')[1]

  if (!src.includes('prefers-reduced-motion')) {
    fail.push(`${rel}: ships motion and carries NO prefers-reduced-motion rule`)
    continue
  }
  // If the component injects through useShadowStyles, the rule must be in the injected CSS —
  // a rule stranded in a <style> block would never reach the shadow root.
  const injects = /useShadowStyles\s*\(/.test(src)
  if (injects) {
    const styleAt = src.search(/^<style/m)
    const ruleIdxs = [...src.matchAll(/prefers-reduced-motion/g)].map((m) => m.index)
    const anyInjected = ruleIdxs.some((i) => styleAt === -1 || i < styleAt)
    if (!anyInjected) {
      fail.push(`${rel}: injects via useShadowStyles but its reduced-motion rule is only in a <style> block, which is dropped in a shadow root`)
    }
  }
}

if (fail.length) {
  console.error('REDUCED-MOTION: FAIL')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`REDUCED-MOTION: PASS — ${animating} animating library component(s), each carrying its own rule where its styles are injected.`)
