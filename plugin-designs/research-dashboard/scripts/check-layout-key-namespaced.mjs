#!/usr/bin/env node
/**
 * check-layout-key-namespaced.mjs — two dashboards on one page must not share a saved layout.
 *
 * useDashboardLayout persists the four divider positions to localStorage. Until kit landing 2 the
 * key was a single constant, so every dashboard wrote to the same slot. That was invisible while
 * there was exactly one dashboard — and SHARING THE ENGINE IS PRECISELY WHAT MAKES A SECOND ONE
 * POSSIBLE, which is why SPEC-DASHBOARD-KIT section 8 named it as landing 2's risk and why the fix
 * belongs in the commit that shares the engine rather than in the one that first trips over it.
 *
 * The failure it prevents is quiet and confusing rather than loud: drag a divider in dashboard A,
 * reload, and dashboard B has moved. Neither is wrong on its own, nothing errors, and the reader
 * has no reason to suspect the other element on the page.
 *
 * WHAT IT CHECKS, statically — no DOM, no browser:
 *   A. the shell does not pass a BARE STRING as storageKey; the key must be derived from something
 *      per-dashboard (the profile's own `id`).
 *   B. two different dashboard ids produce two different keys, by evaluating the expression the
 *      shell actually passes rather than a retyped copy of it.
 *   C. the legacy shared key is READ and never WRITTEN — namespacing must not silently reset a
 *      reader's saved layout, and a migration that also deletes cannot be rolled back.
 *
 * NEGATIVE-TESTED: putting a bare literal back fails A; making the expression ignore the id fails
 * B; adding a setItem on the legacy key fails C.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'LAYOUT-KEY-NAMESPACED'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SHELL = join(ROOT, 'plugin-designs/research-dashboard/research-dashboard.vue')
const ENGINE = join(ROOT, 'library/composables/useDashboardLayout.js')
const fails = []
const notes = []

if (!existsSync(ENGINE)) { console.log(`${TAG}: SKIP — no ${ENGINE.replace(ROOT + '/', '')} (kit landing 2 not applied).`); process.exit(0) }

// ── A + B. the key the shell passes ──────────────────────────────────────────────────────────
{
  const src = readFileSync(SHELL, 'utf8')
  const m = /storageKey:\s*([^\n]+?),\s*$/m.exec(src)
  if (!m) {
    fails.push('A  research-dashboard.vue passes no storageKey — the engine would fall back to its shared default and every dashboard on the page would collide.')
  } else {
    const expr = m[1].trim()
    if (/^'[^']*'$/.test(expr) || /^"[^"]*"$/.test(expr)) {
      fails.push(`A  storageKey is the bare literal ${expr} — a second dashboard on the same page reads and writes this one's layout.`)
    } else {
      // Evaluate the REAL expression with two different configs rather than retyping the rule: a
      // gate carrying its own copy of the thing it checks passes while the product is broken.
      try {
        const keyFor = new Function('mergedConfig', `return ${expr}`)
        const a = keyFor({ value: { id: 'doxa-research-dashboard' } })
        const b = keyFor({ value: { id: 'gospel-internet' } })
        const none = keyFor({ value: {} })
        if (a === b) fails.push(`B  two different dashboard ids produce the SAME key (${JSON.stringify(a)}) — the expression does not actually vary with the dashboard.`)
        if (!String(a).includes('doxa-research-dashboard')) fails.push(`B  the key ${JSON.stringify(a)} does not carry the dashboard id, so it cannot be unique per dashboard.`)
        if (!none) fails.push('B  a config with no id yields an empty key — a dashboard that forgets its id must still get a usable slot, not localStorage[""].')
        if (!fails.some((f) => f.startsWith('B'))) notes.push(`key: ${JSON.stringify(a)} vs ${JSON.stringify(b)} — distinct per dashboard`)
      } catch (e) {
        fails.push(`B  could not evaluate the storageKey expression (${e.message}) — it may be correct, but this gate cannot prove it, which is the same as not being checked.`)
      }
    }
  }
}

// ── C. the legacy key is read, never written ─────────────────────────────────────────────────
{
  const src = readFileSync(ENGINE, 'utf8')
  const legacy = /const LEGACY_SHARED_KEY = '([^']+)'/.exec(src)
  if (!legacy) {
    fails.push('C  useDashboardLayout no longer reads the pre-namespacing key — every reader who had dragged a divider silently loses their layout on upgrade.')
  } else {
    const name = 'LEGACY_SHARED_KEY'
    if (!new RegExp(`getItem\\(\\s*${name}\\s*\\)`).test(src)) fails.push(`C  ${name} is declared but never read, so it protects nobody.`)
    if (new RegExp(`(setItem|removeItem)\\(\\s*${name}`).test(src)) {
      fails.push(`C  ${name} is WRITTEN or REMOVED. The read-through exists so namespacing does not reset a saved layout; a migration that also deletes cannot be rolled back.`)
    }
    if (!fails.some((f) => f.startsWith('C'))) notes.push(`legacy key ${JSON.stringify(legacy[1])}: read once, never written`)
  }
}

// ── D. the drag mirrors under RTL, and the keyboard agrees with it ───────────────────────────
// Found 2026-09-27: the x delta was computed once, in LTR. Under dir=rtl the grid mirrors — the
// facet rail sits on the RIGHT — so dragging its handle toward the map moves clientX the other way,
// and in Arabic the facet handle shrank the CHARTS rail. It reaches Big Picture in ar, not only a
// new consumer. The keyboard path is asserted too: if only the pointer mirrored, the two input
// methods would disagree about which way widens, and aria-valuenow would announce the wrong
// direction to someone who cannot see the drag.
{
  const src = readFileSync(ENGINE, 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  // ★ ASSERT THE BEHAVIOUR, NOT THE PHRASING. This arm used to require the literal
  // `direction === 'rtl'`, which pinned one spelling of the probe: moving it from the shell to the
  // drag handle (so the sign matches the element the GRID lays out with) kept the behaviour and
  // broke the gate. A check that fails on a correct refactor teaches people to edit the check.
  // What matters is that the engine READS a computed direction and FLIPS a sign from it.
  const readsDirection = /getComputedStyle/.test(code) && /\.direction\b/.test(code) && /'rtl'/.test(code)
  const flipsSign = /-1/.test(code)
  if (!readsDirection || !flipsSign) {
    fails.push('D  useDashboardLayout never reads the computed direction, so the drag cannot mirror: in ar the facet handle moves the wrong rail.')
  } else {
    if (!/startFacet \+ xSign \* \(ev\.clientX - startX\)/.test(code) || !/startRail - xSign \* \(ev\.clientX - startX\)/.test(code)) {
      fails.push('D  the pointer drag does not apply the direction sign to BOTH widths — mirroring one and not the other is worse than mirroring neither, because the two handles then disagree.')
    }
    if (!/kSign/.test(code)) {
      fails.push('D  the arrow keys do not follow the direction sign, so keyboard and pointer disagree about which way widens under rtl.')
    }
    if (!fails.some((f) => f.startsWith('D'))) notes.push('drag: mirrors under rtl, pointer and arrows share one sign')
  }
}

// ── E. the legacy read-through applies ONLY to the default key ───────────────────────────────
// My own regression from kit landing 2: I added the read-through so namespacing would not discard a
// saved layout, and applied it unconditionally — so a caller passing its OWN key, which is the whole
// point of namespacing, inherited Big Picture's widths. The migration meant to protect one
// dashboard's layout was handing it to every other dashboard.
{
  const src = readFileSync(ENGINE, 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  if (/getItem\(storageKey\) \|\| localStorage\.getItem\(LEGACY_SHARED_KEY\)/.test(code)) {
    fails.push('E  the legacy key is read even when the caller passed its own storageKey, so a second dashboard inherits the first one\'s layout. Gate it on storageKey === DEFAULT_STORAGE_KEY.')
  } else if (!/storageKey === DEFAULT_STORAGE_KEY/.test(code)) {
    fails.push('E  the legacy read-through is not gated on the default key — either it is gone (a reader loses their layout) or it is gated on something this gate cannot see.')
  } else notes.push('legacy read-through: only for the default key')
}

for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`${TAG}: PASS — each dashboard owns its saved layout, and upgrading does not discard one.`)
