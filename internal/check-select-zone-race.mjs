#!/usr/bin/env node
/**
 * check-select-zone-race — "Show on map" works on the FIRST click, not the second.
 *
 * THE DEFECT (PRODUCTION-MATRIX:422, measured in a browser): the composite's list pane dispatches
 * 'doxa:select-zone' at the map pane, but the map pane attaches its listener in onMounted and the
 * pane mounts lazily. So the first click landed before any listener existed, did nothing, and only
 * a SECOND click selected the zone. A control you must press twice reads as broken.
 *
 * ★ IT IS A THREE-LAYER DEFECT AND THE FIX HAS THREE PARTS, so this gate asserts them SEPARATELY —
 * removing any one of them alone must fail by name. A single "does it work" assertion would go
 * green on two of three and let the third rot back in:
 *   1 DELIVERY    an element dispatch has no replay, so the request is written as an ATTRIBUTE
 *                 first (state survives custom-element upgrade); the event stays as the live path.
 *   2 ARRIVAL     the pane reads that attribute on mount AND observes it afterwards, so a request
 *                 that predates the pane and one that follows it both arrive.
 *   3 EFFECT      onLegendSelect bails while the map's tapestry layer is down, so an arrived
 *                 request is RETAINED (_pendingZoneId) and drained at the readiness signal.
 *                 Delivery and arrival both succeeding still lost the selection without this.
 *
 * Source-level and headless: the race is a lifecycle ordering between two custom elements, which a
 * DOM-less runner cannot stage and which the browser seat measures end to end.
 * What this pins is that none of the three mechanisms quietly disappears.
 *
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const P = (f) => join(resolve(HERE, '..'), 'plugin-designs', 'my-upg-100-list', f)
const MFE = readFileSync(P('upg-100-mfe.vue'), 'utf8')
const LIST = readFileSync(P('upg-100-list.vue'), 'utf8')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// ── 1. DELIVERY: the attribute is written, and written BEFORE the event ────────────────────────
ok(/setAttribute\('select-zone'/.test(MFE),
  "the composite no longer writes the select-zone ATTRIBUTE — an element dispatch has no replay, so a request that predates the map pane is lost and the first click does nothing")
ok(/removeAttribute\('select-zone'/.test(MFE),
  'clearing a selection no longer removes the attribute — a stale attribute would re-apply an old zone when the pane mounts')
{
  const iAttr = MFE.indexOf("setAttribute('select-zone'")
  const iEvt = MFE.indexOf("doxa:select-zone', { detail")
  ok(iAttr > 0 && iEvt > 0 && iAttr < iEvt,
    'the event is dispatched BEFORE the attribute is written — record the request, then announce it, or a listener that runs synchronously reads the old value')
}

// ── 2. ARRIVAL: read on mount, and observed after ──────────────────────────────────────────────
ok(/getAttribute\('select-zone'\)/.test(LIST),
  'the map pane never READS select-zone — the composite would be writing state nobody consumes, which looks identical to a fix')
ok(/attributeFilter:\s*\['select-zone'\]/.test(LIST),
  'the select-zone MutationObserver is gone — a request made AFTER the pane mounted would never arrive')
ok(/addEventListener\('doxa:select-zone'/.test(LIST),
  'the live event path is gone — a map that is already up would wait for a mutation that never comes')

// ── 3. EFFECT: retained while unready, drained at the readiness signal ─────────────────────────
// ⚠ THE SUBTLEST LAYER. Delivery and arrival can both succeed and the selection still not hold,
// because onLegendSelect returns early while the tapestry layer is down. A browser check read that state
// twice, 13 ms apart, with the correct id.
// ⚠ TWO DISTINCT RETAIN SITES, and a single /_pendingZoneId = zoneId/ match passes while ONE of
// them is deleted — measured: removing the not-found retain left the gate green on the other.
// They are different failures: the legend has no such node YET (arrival before data), versus the
// node resolved and onLegendSelect refused because the tapestry layer was down (arrival before
// readiness). Count them.
{
  const retains = (LIST.match(/_pendingZoneId\s*=\s*zoneId/g) || []).length
  ok(retains >= 2,
    `only ${retains} retain site(s) for an un-applied request; expected both — the node-not-found case AND the applied-but-no-selection case, which fail at different layers and are each discarded silently without their own retain`)
}
ok(/if \(_pendingZoneId\)/.test(LIST) && /applySelectZone\(id\)/.test(LIST),
  'the retained request is never DRAINED at the readiness signal — it would be remembered forever and never applied')
// The drain must re-check identity: a second request between retain and drain must win.
ok(/if \(_pendingZoneId === id\)/.test(LIST),
  'the drain does not re-check which request it is draining — a newer selection made while the map was loading would be overwritten by the older one')

// ── 4. ONE APPLY PATH, TWO TRIGGERS ────────────────────────────────────────────────────────────
// Both the attribute and the event must end in the same function, or the two paths drift into two
// different meanings of "select a zone" — the class this repo keeps finding as two copies of a fact.
{
  const applies = (LIST.match(/applySelectZone\(/g) || []).length
  ok(applies >= 3, `applySelectZone is called ${applies} time(s); expected the attribute path, the event path and the drain to share it`)
}

if (fails.length) {
  console.error('SELECT-ZONE-RACE: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('SELECT-ZONE-RACE: PASS — the request is recorded as state before it is announced, read on mount and observed after, retained while the map is unready and drained (identity-checked) when it is ready, with one apply path behind both triggers.')
