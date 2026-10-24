#!/usr/bin/env node
/**
 * check-preview-flag-dev-only.mjs — the "preview unreleased content" flag never reaches a built bundle.
 *
 * globalThis.DXM_PREVIEW_UNRELEASED = true makes a page show what is withheld from the public (the whole-India
 * country poster). It is set only under the Vite dev server (library/elements/defineMapElement.js, behind
 * import.meta.env.DEV, a compile-time false in every build). The built tree (public/dx-maps) goes to the research
 * landing and to DX Life's /dx-maps, so one assignment there would print India publicly.
 *
 * ASSERTS:
 *   A. NO file under public/ MENTIONS the flag at all. An assignment there would turn the preview on, and a READ
 *      there means the withheld path itself shipped, behind a global any embedding page or console can set (that
 *      IS shipping it). Every read is compiled away by its DEV guard, so the built tree never names the flag;
 *   B. every SOURCE line that mentions it, read OR write (library/, plugin-designs/, outside scripts/ and tests;
 *      comments aside), carries import.meta.env.DEV on the same line.
 * `--self-test` plants each defect in memory and exits 0 only if all are caught.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MENTION = /DXM_PREVIEW_UNRELEASED/
const TEXT = /\.(m?js|html|json|css|txt)$/

function* walk(dir) {
  let names = []
  try { names = readdirSync(dir) } catch (_) { return }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    let st; try { st = statSync(p) } catch (_) { continue }
    if (st.isDirectory()) yield* walk(p)
    else yield p
  }
}

function auditBuilt(files) {
  const fails = []
  for (const [rel, text] of files) {
    if (!MENTION.test(text)) continue
    const line = text.split('\n').findIndex((l) => MENTION.test(l)) + 1
    fails.push(`A ${rel}:${line} names DXM_PREVIEW_UNRELEASED in the built tree (a setter would show withheld content; a read means the withheld path shipped)`)
  }
  return fails
}
function auditSource(files) {
  const fails = []
  for (const [rel, text] of files) {
    text.split('\n').forEach((l, i) => {
      if (MENTION.test(l) && !/import\.meta\.env\.DEV/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) fails.push(`B ${rel}:${i + 1} reads or writes DXM_PREVIEW_UNRELEASED outside an import.meta.env.DEV guard`)
    })
  }
  return fails
}

const built = () => [...walk(join(ROOT, 'public'))].filter((p) => TEXT.test(p)).map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')])
const source = () => [...walk(join(ROOT, 'library')), ...walk(join(ROOT, 'plugin-designs'))]
  .filter((p) => /\.(m?js|vue)$/.test(p) && !/\/(scripts|tests?|__tests__)\//.test(p))
  .map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')])

if (process.argv.includes('--self-test')) {
  const a = auditBuilt([['public/dx-maps/x/set.js', 'var a=1;globalThis.DXM_PREVIEW_UNRELEASED=!0;'], ['public/dx-maps/x/read.js', 'if(globalThis.DXM_PREVIEW_UNRELEASED===!0)showIndia()'], ['public/dx-maps/x/ok.js', 'showOthers()']])
  const b = auditSource([['library/set.js', 'globalThis.DXM_PREVIEW_UNRELEASED = true'], ['library/read.js', "export const previewUnreleased = () => typeof globalThis !== 'undefined' && globalThis.DXM_PREVIEW_UNRELEASED === true"],
    ['library/ok.js', 'if (import.meta.env.DEV) globalThis.DXM_PREVIEW_UNRELEASED = true'], ['library/okread.js', 'export const p = () => import.meta.env.DEV && globalThis.DXM_PREVIEW_UNRELEASED === true'], ['library/c.js', '// DXM_PREVIEW_UNRELEASED is named in a comment']])
  const okA = a.length === 2 && a.some((x) => /set\.js/.test(x)) && a.some((x) => /read\.js/.test(x))
  const okB = b.length === 2 && b.some((x) => /library\/set\.js/.test(x)) && b.some((x) => /library\/read\.js/.test(x))
  console.log(okA ? '✓ caught: a built bundle that SETS the flag (=!0) and one that READS it (the withheld path shipped); a clean one passes' : '✗ MISSED: a built-tree setter or reader')
  console.log(okB ? '✓ caught: an unguarded source SETTER and an unguarded source READ (the plain previewUnreleased()); the DEV-guarded ones and comments pass' : '✗ MISSED: an unguarded source setter or read')
  process.exitCode = okA && okB ? 0 : 1
} else {
  const fails = [...auditBuilt(built()), ...auditSource(source())]
  if (fails.length) { for (const f of fails) console.log('✗ ' + f); console.log(`FAIL check:preview-flag-dev-only (${fails.length})`); process.exitCode = 1 }
  else console.log('PASS check:preview-flag-dev-only — no built file names DXM_PREVIEW_UNRELEASED; every source read and write is behind import.meta.env.DEV')
}
