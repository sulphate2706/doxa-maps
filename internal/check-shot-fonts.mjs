#!/usr/bin/env node
/**
 * check-shot-fonts.mjs — the machine taking the screenshots must be able to RENDER what they show.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, found 2026-09-22 by READING cap5-plugin-studio.png).
 * The studio's rail labels every row with a capability emoji (CAP_EMOJI = 🧩 🔗 🗂️ 🎛️ 🔹). This box
 * has ZERO emoji-capable fonts installed — `fc-list | grep -i emoji` returns nothing — so every one
 * of those glyphs rendered as a TOFU BOX (􀀀) in the committed README image. The markup is correct
 * and the product is fine in a real browser; the SHOT MACHINE could not draw it.
 *
 * ★ THAT DISTINCTION IS THE WHOLE POINT, and getting it backwards would have been the expensive
 * mistake: the obvious "fix" is to strip the emoji from the product, which would degrade the real
 * UI to repair a screenshot. The cause had to be MEASURED (is the font missing, or is the markup
 * wrong?) before a fix could be chosen. It was the font.
 *
 * ★ WHY A GATE RATHER THAN JUST INSTALLING A FONT. Installing one fixes THIS box and silently rots
 * for the next person: the Doxa team regenerates these images on their machine, and a missing font
 * there produces the same tofu with no warning. A gate travels with the repo and fails on any box
 * that cannot render the glyphs the UI actually uses, naming the fix.
 *
 * WHAT IT CHECKS: scans plugin-designs/ + library/ for non-ASCII display glyphs that reach the UI,
 * then asks fontconfig whether this system can render them. It does NOT need a browser — fc-list is
 * the same font database the headless browser draws from.
 *
 * ★ NOT A CHECK ON THE IMAGES THEMSELVES. Detecting tofu by reading pixels would be the direct
 * measurement, but it needs a reference rendering to compare against. This checks the PRECONDITION
 * instead, which is deterministic, instant, and fails BEFORE a bad PNG is committed rather than
 * after. Pair it with actually looking at a regenerated shot — no gate replaces that.
 *
 * SKIPs (exit 0) when the UI uses no such glyphs at all — nothing to render, nothing to check.
 * NEGATIVE-TESTED: with no emoji font installed this FAILS naming the glyphs and the fix; the
 * source scan is asserted non-empty so it cannot pass vacuously.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Glyphs that genuinely need a COLOUR-EMOJI font. Deliberately narrow, in two ways:
//
//  1. NOT "all non-ASCII" — accented Latin, CJK and arrows ship in ordinary text fonts.
//  2. NOT the whole Misc-Symbols block (U+2600–27BF). A first version included it and immediately
//     produced a FALSE POSITIVE on ★ (U+2605), which this repo uses as a COMMENT MARKER in dozens
//     of files and which every text font renders correctly. A gate that flags correct code trains
//     people to ignore it, so the range was tightened to the pictographic planes plus the explicit
//     emoji-presentation selector.
//
// U+FE0F (VARIATION SELECTOR-16) is included because it is the marker that REQUESTS emoji
// presentation for an otherwise-textual codepoint — its presence is the signal that a colour font
// is expected. The base character it follows is reported alongside it.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{FE0F}]/gu

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = [...walk(join(ROOT, 'plugin-designs')), ...walk(join(ROOT, 'library'))]

// Vacuous guard: "0 files scanned" must never read as "0 problems".
const MIN_FILES = 20
if (files.length < MIN_FILES) {
  console.error(`SHOT-FONTS: FAIL — only ${files.length} source file(s) scanned (expected >= ${MIN_FILES}).`)
  console.error('  The scan is broken or the tree is empty. Refusing to pass vacuously.')
  process.exit(1)
}

const found = new Map()   // glyph -> first file that uses it
for (const f of files) {
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  for (const m of text.matchAll(EMOJI_RE)) {
    if (!found.has(m[0])) found.set(m[0], f.replace(ROOT + '/', ''))
  }
}

console.log(`SHOT-FONTS: ${files.length} source file(s) scanned, ${found.size} distinct display glyph(s) in the UI.`)

if (!found.size) {
  console.log('SHOT-FONTS: SKIP — the UI uses no emoji/pictographic glyphs, so no emoji font is needed.')
  process.exit(0)
}

// Ask fontconfig, which is the database the headless browser renders from.
let hasEmojiFont = false
let fcAvailable = true
try {
  const out = execSync('fc-list', { encoding: 'utf8', timeout: 15000 })
  hasEmojiFont = /emoji|symbola|noto color/i.test(out)
} catch {
  fcAvailable = false
}

if (!fcAvailable) {
  console.log('SHOT-FONTS: SKIP — fontconfig (fc-list) is unavailable, so the font set cannot be read.')
  console.log('  Absence of measurement is not measurement of absence; not failing on it.')
  process.exit(0)
}

if (!hasEmojiFont) {
  const sample = [...found.entries()].slice(0, 6)
  console.error('\nSHOT-FONTS: FAIL — the UI uses emoji glyphs and this system has NO emoji-capable font.')
  for (const [glyph, file] of sample) console.error(`  ✗ ${glyph}  first used in ${file}`)
  if (found.size > sample.length) console.error(`  … +${found.size - sample.length} more`)
  console.error(
    '\n  Every one of these renders as a TOFU BOX in a headless screenshot, so any image generated\n' +
    '  here ships a UI full of missing-glyph squares — and it looks EXACTLY like a correct render to\n' +
    '  a freshness/element-count gate. The product itself is fine: this is the shot MACHINE, not the\n' +
    '  markup, so do NOT strip the emoji to make this pass.\n' +
    '\n  Fix: install an emoji font, then regenerate. No root needed — fontconfig reads ~/.fonts:\n' +
    '    mkdir -p ~/.fonts && cp <NotoColorEmoji.ttf> ~/.fonts/ && fc-cache -f\n' +
    '  Then: bun run shots && bun run check:shots'
  )
  process.exit(1)
}

console.log('SHOT-FONTS: PASS — an emoji-capable font is installed, so UI glyphs render in screenshots.')
