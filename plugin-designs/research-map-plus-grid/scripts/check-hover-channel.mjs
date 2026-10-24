#!/usr/bin/env node
/**
 * check-hover-channel.mjs — hover points at a record; it must never commit to one.
 *
 * SPEC-DASHBOARD-KIT D3. The bus carries three coordinated channels: filterSet NARROWS scope,
 * selectionSet MARKS individuals, and hoverKey POINTS at the one record under the pointer.
 * kepler.gl treats hover as a configured interaction alongside filters for the same reason — it is
 * how a reader sweeps a table and watches the map answer without choosing anything.
 *
 * WHY THIS IS GATED RATHER THAN REVIEWED. Hover looks like a weaker selection, and the cheap way to
 * implement it is to put the key in selectionSet "just while hovering". Every consequence of that
 * is bad and none of them are obvious at the call site:
 *   - selectionSet is a plain Set with a version counter, and useSelectionCamera watches that
 *     counter. A hover that bumped it would fly the camera at every mousemove — the resize-strobe
 *     bug wearing a new hat, on a reader who is photosensitive.
 *   - the CSV exporter reads selection > filter > all, so a hover would silently change what an
 *     export contains.
 *   - the table's selection pill and the shell's live region both report selection counts, and
 *     both would narrate the pointer.
 * So the contract is asserted: hover is its own ref, it does not touch the selection, and a repeat
 * is a no-op (hover fires on every mousemove across 2,107 rows; a channel that woke every panel on
 * an unchanged value would need a debounce it should not need).
 *
 * NOT CHECKED: which panels light up on hover. D3 says panels opt in, and the first opt-in belongs
 * with a consumer that has a reason — wiring one into Big Picture speculatively would be a visual
 * change to the flagship with no reader asking for it. This gate guards the CHANNEL so the first
 * panel to use it inherits the rules rather than inventing them.
 *
 * NEGATIVE-TESTED: routing setHover through selectionSet fails A; dropping the equality guard
 * fails B; removing hoverKey from the returned surface fails the import check.
 */
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'HOVER-CHANNEL'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BUS = join(ROOT, 'library/composables/useSelectionBus.js')
if (!existsSync(BUS)) { console.log(`${TAG}: SKIP — no ${BUS.replace(ROOT + '/', '')} (kit landing 1 not applied).`); process.exit(0) }
const { createSelectionBus } = await import(BUS)

const fails = []
const notes = []
const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }

const bus = createSelectionBus()
if (!bus.hoverKey || typeof bus.setHover !== 'function') {
  fails.push('the bus exposes no hoverKey/setHover — D3\'s channel is missing, and a panel wanting hover would have to invent its own, which is how selectionSet gets abused for it.')
} else {
  // ── A. hover is not selection ──────────────────────────────────────────────────────────────
  bus.selectMany(['keep-me'])
  const versionBefore = bus.selectionVersion.value
  bus.setHover('abkhaz')
  eq('A hoverKey holds the record', bus.hoverKey.value, 'abkhaz')
  eq('A hover does NOT enter the selection', [...bus.selectionSet], ['keep-me'])
  eq('A hover does NOT bump selectionVersion (the camera watches it)', bus.selectionVersion.value, versionBefore)
  eq('A hover does NOT touch the filters', Object.keys(bus.filterSet), [])

  // ── B. a repeat is a no-op, and clearing is explicit ───────────────────────────────────────
  let emitted = 0
  bus.on('hover', () => { emitted++ })
  bus.setHover('same'); bus.setHover('same'); bus.setHover('same')
  eq('B three identical hovers emit once', emitted, 1)
  bus.setHover(null)
  eq('B null clears', bus.hoverKey.value, null)
  eq('B clearing emits', emitted, 2)
  bus.setHover()
  eq('B a bare call means nothing hovered', bus.hoverKey.value, null)
  eq('B clearing an already-clear hover is a no-op', emitted, 2)

  // ── C. clearing the selection leaves hover alone, and vice versa ────────────────────────────
  bus.setHover('x'); bus.clearSelection()
  eq('C clearing the selection does not clear hover', bus.hoverKey.value, 'x')
  bus.selectMany(['y']); bus.setHover(null)
  eq('C clearing hover does not clear the selection', [...bus.selectionSet], ['y'])
  if (!fails.length) notes.push('hover: its own ref, never the selection, no-op on repeat, independent of both other channels')
}

for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`${TAG}: PASS — hover points without committing.`)
