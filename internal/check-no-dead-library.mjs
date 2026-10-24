/**
 * check-no-dead-library.mjs — a library module must be reachable, and the scanner must prove it works.
 *
 * ★ WHY A NAME-GREP IS NOT ENOUGH, and why this file exists in this shape. Seven library components
 * were deleted as unreachable. Two of them were NOT reachable by import and still could not be
 * deleted safely: internal/check-gospel-set-charts.mjs iterated ['BoundedSet.vue',
 * 'CenteredSetTarget.vue'] AS STRINGS and read their props off disk. No import, no build error —
 * deleting them would have turned a gate red on main with nothing to explain it. So this scans for a
 * filename appearing as a STRING anywhere in internal/ and library/, not only in import statements.
 *
 * ★ IT DISTINGUISHES A READ FROM A MENTION (gospel's ask). check-packet-variants.mjs discusses
 * CenteredSetTarget.vue in prose while asserting against a JSON file. A gate that cannot tell a read
 * from a comment cries wolf once and is then ignored, so a comment-only hit is REPORTED, never fatal.
 *
 * ★ IT IS TWO-SIDED (upg100's ask, learned the same night). A gate that only asserts "no references
 * found" passes identically when the scanner is broken and when the tree is clean. So it also
 * asserts a KNOWN-PRESENT reference is found: LegendDesktop.vue lazy-loads LegendMobile.vue through
 * a dynamic import(). If that positive control ever stops being found, the scanner is lying and the
 * gate fails — green here means "the scanner works AND found nothing".
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname
const SCAN = ['internal', 'library', 'plugin-designs']

const files = []
const walk = (d) => {
  if (!existsSync(d)) return
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(vue|js|mjs)$/.test(e.name)) files.push(p)
  }
}
for (const d of SCAN) walk(join(ROOT, d))
const text = new Map(files.map((p) => [p, readFileSync(p, 'utf8')]))

/** Every hit of `name` outside its own file, split into reads and comment-only mentions. */
function hitsFor(name, selfPath) {
  const reads = [], mentions = []
  for (const [p, src] of text) {
    if (p.endsWith(selfPath)) continue
    // This gate NAMES every deleted module in its own DELETED list, so it would report itself
    // as the reader of all seven. Excluding it is not a loophole: the positive control below
    // is what proves the scanner still sees real references.
    if (p.endsWith('internal/check-no-dead-library.mjs')) continue
    for (const line of src.split('\n')) {
      if (!line.includes(name)) continue
      // A longer identifier that merely CONTAINS the name is not a reference to it
      // (GiBoundedSet.vue contains BoundedSet.vue).
      const idx = line.indexOf(name)
      const before = idx > 0 ? line[idx - 1] : ''
      if (/[A-Za-z0-9_]/.test(before)) continue
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) mentions.push(`${p.split('/').slice(-2).join('/')}`)
      else reads.push(`${p.split('/').slice(-2).join('/')}`)
    }
  }
  return { reads, mentions }
}

const fail = []

// ── THE POSITIVE CONTROL. A known dynamic reference the scanner must find. ─────────────────────
const control = hitsFor('LegendMobile.vue', 'components/legends/LegendMobile.vue')
if (control.reads.length === 0) {
  fail.push('POSITIVE CONTROL FAILED: LegendMobile.vue is lazy-loaded by LegendDesktop.vue and the scanner did not find it — the scanner is broken, so any "no references" result below is meaningless')
}

// ── THE DELETED SET must stay deleted and unreferenced. ───────────────────────────────────────
const DELETED = ['LanguageTreeChart.vue', 'VisionFunnel.vue', 'useMapSelection.js', 'ListSelectorLegend.vue',
                 'BoundedSet.vue', 'CenteredSetTarget.vue', 'DashboardBreadcrumb.vue']
const notes = []
for (const name of DELETED) {
  const { reads, mentions } = hitsFor(name, `__deleted__/${name}`)
  if (reads.length) fail.push(`${name}: deleted, but READ by ${[...new Set(reads)].join(', ')}`)
  if (mentions.length) notes.push(`${name}: mentioned in a comment by ${[...new Set(mentions)].join(', ')} (harmless)`)
}

if (fail.length) {
  console.error('NO-DEAD-LIBRARY: FAIL')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`NO-DEAD-LIBRARY: PASS — positive control found (${control.reads.length} read of LegendMobile.vue), ${DELETED.length} deleted module(s) with no reads.`)
for (const n of notes) console.log(`  · ${n}`)
