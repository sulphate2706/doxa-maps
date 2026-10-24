#!/usr/bin/env node
/**
 * check-mst-clustering — the "MST" clustering mode draws a true minimum spanning tree, fast enough to
 * run on the main thread. Headless.
 *
 * WHY (2026-09-26): MST built and sorted every pair of pins (~2.2 million edges for the 2,107-pin roster),
 * ~12 s on the main thread, twice over with a stats pass. Choosing "MST" froze the page, and the browser
 * gate check:clustering-modes read the map before any line existed ("MST drew no cluster lines").
 * MSTClusteringUtil now runs Prim in O(n²).
 *
 * ASSERTS  (1) on sizes 2-400, capped and uncapped, the util's tree has the SAME edge count and total
 *          length as a reference all-pairs Kruskal written here; (2) 2,107 pins in under 1.5 s of CPU.
 *
 * ★ CPU TIME, NOT WALL TIME (2026-09-29). gates:post runs several checks at once on a shared box, and a
 * Date.now() budget measured the neighbours as well: 723 ms of work failed a 3,000 ms budget once. The
 * budget is now this process's own CPU (process.cpuUsage, user + system), which the load does not
 * inflate. Measured on a loaded 8-core box, the util takes about 0.5 s of CPU (24 copies at once: max
 * 0.6 s, against 5.3 s of wall), and the pre-924a185aa all-pairs path 4.4 to 6.9 s. The budget sits near
 * the log-midpoint of the two, 1,500 ms, so each side keeps a margin of about 2.5x (0.6 s is 2.4x under
 * it, 4.4 s is 2.9x over): a CPU 1.5x faster (a laptop, a CI runner) cannot let the old path pass, and
 * one 1.5x slower cannot fail the new path.
 * EXIT 0 pass · 1 fail
 */
import MST from '../library/utils/MSTClusteringUtil.js'
import { euclideanDistance } from '../library/utils/ClusterHelpers.js'

const kruskal = (pts, cap) => {
  const e = []
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = euclideanDistance(pts[i].latitude, pts[i].longitude, pts[j].latitude, pts[j].longitude)
    if (d <= cap) e.push([d, i, j])
  }
  e.sort((a, b) => a[0] - b[0])
  const p = pts.map((_, i) => i), f = (x) => (p[x] === x ? x : (p[x] = f(p[x])))
  let n = 0, len = 0
  for (const [d, i, j] of e) { const a = f(i), b = f(j); if (a !== b) { p[a] = b; n++; len += d } }
  return { n, len }
}
const pts = (n, k = 1) => Array.from({ length: n }, (_, i) => ({ latitude: Math.sin(i * 1.7 * k) * 60, longitude: Math.cos(i * 1.3 * k) * 170 }))
const quiet = console.warn; console.warn = () => {}
let bad = 0
for (const [n, cap] of [[2, Infinity], [3, Infinity], [50, Infinity], [400, Infinity], [400, 12], [400, 4]]) {
  const P = pts(n), ref = kruskal(P, cap)
  const L = new MST({ maxConnectionDistance: cap }).generateMSTLines(P)
  const len = L.reduce((a, f) => a + f.properties.distance, 0)
  const ok = L.length === ref.n && Math.abs(len - ref.len) < 1e-6
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${String(n).padStart(4)} pins, cap ${cap}: ${L.length} edges, length ${len.toFixed(4)} (reference ${ref.n}, ${ref.len.toFixed(4)})`)
}
console.warn = quiet
const t = Date.now(), cpu0 = process.cpuUsage()
const L = new MST({}).generateAllMSTLines({ A: pts(1500, 1.1), B: pts(607, 0.9) })
const cpu = process.cpuUsage(cpu0), ms = Math.round((cpu.user + cpu.system) / 1000), wall = Date.now() - t
const BUDGET_CPU_MS = 1500
const fast = ms < BUDGET_CPU_MS && L.length === 2105
if (!fast) bad++
console.log(`  ${fast ? 'ok  ' : 'FAIL'}  2,107 pins in two groups: ${L.length} lines in ${ms} ms CPU (budget ${BUDGET_CPU_MS} ms CPU; wall ${wall} ms, not budgeted)`)
if (bad) { console.log(`MST-CLUSTERING: FAIL — ${bad} case(s).`); process.exit(1) }
console.log('MST-CLUSTERING: PASS — a true minimum spanning tree/forest, and fast enough for the main thread.')
