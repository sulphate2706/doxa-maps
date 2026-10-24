#!/usr/bin/env node
/**
 * check-window-globals-released — a component that puts something on `window` must take it back.
 *
 * Heap snapshots at 722ac7789 measured Simple Research and All People
 * Groups mounted twice: 54.2 MB -> 65.1 MB, live Vue apps 6 -> 8. EVERY unmounted app stayed in
 * memory, one copy per mount, and the retainers were all the same shape — a window key set during
 * setup and never cleared:
 *
 *   window.__doxaLogoOwner -> Map -> div.rm-map-canvas -> ShadowRoot -> app
 *   window.__researchMapFilterState -> closure -> app
 *   window.__peopleGroupsGridVocabulary -> closure -> app
 *   window.__rdashPinAt -> closure -> app
 *
 * None of these is a leak in the usual sense; each is one line that assigns a closure to a global.
 * The closure keeps its component, the component keeps its shadow root, and a whole application
 * survives its own unmount. An element property (`el.__vocabulary = …`) dies with the element and is
 * fine; a window key outlives everything and is not.
 *
 * So the rule is ownership, checked mechanically: if a file writes `window.__x`, the same file must
 * release it — `delete window.__x` or `window.__x = null`. The check does not care WHERE, because a
 * release can legitimately live in onBeforeUnmount, onUnmounted or a destroy() the hook calls; it
 * cares that the file takes responsibility for what it set.
 *
 * Headless, no browser, no dependencies. Exit 0 pass · 1 fail.
 */
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fails = []

// Globals owned by somebody else: we may read or even set them, but we do not control their life.
// Identity checking is REPORTED by default and ENFORCED with STRICT_IDENTITY=1. It is not on by
// default only because other owners' plugins have not adopted it yet; flip it once they have, which
// is a smaller change than re-finding this reasoning later.
const STRICT = process.env.STRICT_IDENTITY === '1'

const NOT_OURS = new Set(['__VUE_INSTANCE_SETTERS__', '__VUE_DEVTOOLS_GLOBAL_HOOK__', '__vite_plugin_react_preamble_installed__'])

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'public' || e === 'dist') continue
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    // A plugin's scripts/check-*.mjs runs INSIDE a Playwright page and plants hooks on that page's
    // window on purpose; the page is thrown away after the run and there is no component to retain.
    else if (/\.(vue|js|mjs)$/.test(e) && !/[\\/]scripts[\\/]/.test(p)) out.push(p)
  }
  return out
}
// Comments are skipped per LINE. A global regex that deletes block comments also deletes real code
// whenever a slash-star appears inside an ordinary string, which cost this repo a check that
// confidently reported nothing was wrong.
const isCommentLine = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)

const files = [...walk(resolve(ROOT, 'library')), ...walk(resolve(ROOT, 'plugin-designs'))]
let checked = 0, owned = 0, identityChecked = 0

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  if (!/window\s*\.\s*__/.test(raw)) continue
  checked++
  const lines = raw.split('\n')
  const set = new Map()      // name -> [lines]
  const released = new Set()
  const guarded = new Set()
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return
    // an assignment TO the global (not a comparison, not a read)
    for (const m of line.matchAll(/window\s*\.\s*(__[\w$]+)\s*=(?!=)/g)) {
      const name = m[1]
      if (NOT_OURS.has(name)) continue
      const after = line.slice(m.index + m[0].length).trim()
      // `window.__x = null` / `= undefined` is a release, not a claim
      if (/^(null|undefined)\b/.test(after)) { released.add(name); continue }
      // ★ ONLY VALUES THAT ACTUALLY RETAIN. Two shapes on window are deliberate and must not be
      // reported, or the check becomes noise that gets switched off:
      //   - a LATCH: `window.__doxaNoTokenWarned = true` exists to warn once per PAGE, and deleting
      //     it on unmount would restore the warning it was added to stop. A boolean retains nothing.
      //   - a PAGE-WIDE CACHE keyed off itself: `window.__x = window.__x || {}` is shared on purpose
      //     across every component on the page, so no single component may clear it.
      // What does retain is a closure (it captures the component) or a bare reference to one of its
      // objects — which is every case the snapshots actually found.
      if (/^(true|false|-?\d|['"`])/.test(after)) continue
      if (new RegExp(`window\\s*\\.\\s*${name}\\b`).test(after)) continue
      if (!set.has(name)) set.set(name, [])
      set.get(name).push(i + 1)
    }
    for (const m of line.matchAll(/delete\s+window\s*\.\s*(__[\w$]+)/g)) {
      released.add(m[1])
      // An identity-checked release only drops what THIS instance installed:
      //   if (window.__x === _hookX) delete window.__x
      // Without it, unmounting one of two instances on a page strips the live one's hook, which
      // reads as a missing hook on a healthy component rather than as a leak.
      // The comparison need not share the line with the delete: an `if (…) {` on the line above is
      // the same guard and just as readable. Looking only at the delete's own line reported a file
      // that WAS identity-checked, so the window covers the few lines leading up to it. A check
      // must not quietly dictate formatting in order to recognise correct code.
      const near = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
      if (new RegExp(`window\\s*\\.\\s*${m[1]}\\s*===`).test(near)) guarded.add(m[1])
    }
  })
  for (const [name, at] of set) {
    owned++
    if (released.has(name)) {
      if (guarded.has(name)) identityChecked++
      else if (STRICT) fails.push(`${relative(ROOT, file)}: releases window.${name} WITHOUT an identity check\n` +
        `      use \`if (window.${name} === _hook) delete window.${name}\` so one instance unmounting cannot strip another's hook`)
      continue
    }
    fails.push(`${relative(ROOT, file)}: sets window.${name} (line${at.length > 1 ? 's' : ''} ${at.join(', ')}) and never releases it\n` +
      `      add \`delete window.${name}\` (or \`window.${name} = null\`) to this file's unmount path\n` +
      `      a window key holding a closure keeps the component, its shadow root and the whole app alive after unmount`)
  }
}

if (!checked) fails.push('no file was scanned — the walk is broken, not the code')

if (fails.length) {
  console.error('WINDOW-GLOBALS-RELEASED: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`WINDOW-GLOBALS-RELEASED: PASS — ${owned} component-owned window global(s) across ${checked} file(s) are released by the file that sets them; ` +
  `${identityChecked}/${owned} release only what that instance installed` + (STRICT ? ' (identity checking ENFORCED).' : '. Run with STRICT_IDENTITY=1 to require it.'))
