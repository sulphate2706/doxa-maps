#!/usr/bin/env node
/**
 * check-poster-action-print — a poster button prints unless its consumer says why it downloads. Headless.
 *
 * The rule since 2026-09-28: an export-poster button opens the PRINT DIALOG with a preview, never a direct
 * download. PosterWall defaults posterAction to 'print'; this asserts that (a) the default stays 'print',
 * and (b) any consumer passing posterAction 'download' has a `posterAction-download:` comment with its
 * reason within the 3 lines above.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const fail = (m) => { bad++; console.log('  FAIL  ' + m) }

const wall = readFileSync(join(ROOT, 'library/components/poster/PosterWall.vue'), 'utf8')
if (!/posterAction:\s*\{\s*type:\s*String,\s*default:\s*'print'\s*\}/.test(wall)) fail("PosterWall's posterAction default is not 'print'")
// PosterDialog too (gospel's audit, card 7): its Render button only ever downloaded.
const dialog = readFileSync(join(ROOT, 'library/components/poster/PosterDialog.vue'), 'utf8')
if (!/action:\s*\{\s*type:\s*String,\s*default:\s*'print'\s*\}/.test(dialog)) fail("PosterDialog's action default is not 'print'")

const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}
const shipped = [...walk(join(ROOT, 'plugin-designs')), ...walk(join(ROOT, 'library'))]

// ── arm 1: a consumer passing posterAction 'download' must say why ────────────
const USE = /(?:posterAction|<PosterDialog[^>]*\baction)\s*[=:]\s*["']download["']|:poster-action\s*=\s*["']'download'["']|poster-action\s*=\s*["']download["']/
let optIns = 0
for (const f of shipped) {
  if (f.endsWith('PosterWall.vue') || f.endsWith('PosterDialog.vue')) continue
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((l, i) => {
    if (!USE.test(l)) return
    optIns++
    const above = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
    if (!/posterAction-download:\s*\S/.test(above)) fail(`${relative(ROOT, f)}:${i + 1} opts into posterAction 'download' without a "posterAction-download: <why>" comment`)
  })
}

// ── arm 2: a poster IMAGE download that never tries to print ──────────────────
// Arm 1 only sees consumers that pass a PosterWall/PosterDialog prop. A component
// that hand-rolls its own <a download> for an image bypasses it entirely — GiTree's
// "Download SVG" button does, sitting right beside its own print path. Data exports
// (csv, txt, json) are out of scope: the rule is about POSTERS.
// Legitimate shapes, both allowed: a FALLBACK reached only after a print attempt
// failed (`if (!opened)`), and the prop-gated opt-in arm 1 already polices.
// The founding bug was GiTree.vue's "Download SVG" button, sibling to its own
// printPoster(); gospel removed it in cbb0ba1df. Since no offender remains in the
// tree, the self-tests at the foot of this file are the whole proof that this arm
// still fires — keep them, and keep the GiTree line among them.
const IMAGE_DL = /\.download\s*=\s*[`'"][^`'"]*\.(?:svg|png|webp|pdf|jpe?g)\b|\.download\s*=\s*`[^`]*\.(?:svg|png|webp|pdf|jpe?g)\b/i
const GUARDED = /if\s*\(\s*!\s*(?:opened|w|win|frame|printed)\b|posterAction\s*===\s*['"]download['"]|action\s*===\s*['"]download['"]/
for (const f of shipped) {
  const lines = readFileSync(f, 'utf8').split('\n')
  const rel = relative(ROOT, f)
  lines.forEach((l, i) => {
    if (!IMAGE_DL.test(l)) return
    const ctx = lines.slice(Math.max(0, i - 4), i + 1).join('\n')
    if (GUARDED.test(ctx)) return
    if (/posterAction-download:\s*\S/.test(ctx)) { optIns++; return }
    fail(`${rel}:${i + 1} writes a poster image to disk with no print attempt first — a poster button opens the print dialog (if it truly must save, say why in a "posterAction-download: <reason>" comment)`)
  })
}
// Self-tests: prove arm 2 fires on the real defect and stays quiet on the real
// exceptions. Without these the arm's PASS would be worth nothing.
const t = (name, src, shouldFail) => {
  const lines = src.split('\n')
  let hit = false
  lines.forEach((l, i) => {
    if (!IMAGE_DL.test(l)) return
    const ctx = lines.slice(Math.max(0, i - 4), i + 1).join('\n')
    if (GUARDED.test(ctx) || /posterAction-download:\s*\S/.test(ctx)) return
    hit = true
  })
  if (hit !== shouldFail) fail(`self-test "${name}": expected ${shouldFail ? 'FAIL' : 'pass'}, got ${hit ? 'FAIL' : 'pass'}`)
}
t('GiTree-shaped poster download', "a.download = `gospel-language-tree-${p.size}in.svg`", true)
t('print-blocked fallback', "const opened = openPrintFrame(html)\nif (!opened) _download(blob, `${name}.png`)\na.download = `${name}.png`", false)
t('gated opt-in', "if (props.posterAction === 'download')\n  a.download = `${id}-poster.webp`", false)
t('explained exception', "// posterAction-download: the print shop needs the vector file\na.download = 'map.pdf'", false)
t('csv export', "a.download = 'gospel-internet.csv'", false)
t('text letter', "a.download = 'letter.txt'", false)

if (bad) { console.log(`POSTER-ACTION-PRINT: FAIL — ${bad} problem(s).`); process.exit(1) }
console.log(`POSTER-ACTION-PRINT: PASS — PosterWall prints by default; ${optIns} explicit download opt-in(s), each with its reason; 0 unguarded poster-image downloads.`)
