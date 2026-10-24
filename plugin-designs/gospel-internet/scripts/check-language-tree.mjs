#!/usr/bin/env node
/**
 * check-language-tree.mjs — the language tree is complete, coloured by its stated rule, and laid out as a
 * tapestry that does not overlap. Headless: the geometry is measured in Web Mercator pixels at zoom 0
 * (the space the map engine draws it in), no browser.
 *
 *   1. current: the committed files are what the builder makes from main's inputs;
 *   2. complete: every roster language (ISO 639-3) is a node, and none is lost;
 *   3. colours: a language is g/y/r by the stated rule (recomputed here from the same inputs);
 *      no dialect claims its own evidence (every dialect status is inherited, inh:1, unless its
 *      ISO code is itself a roster language);
 *   4. tapestry: no two FAMILY circles overlap; every node lies inside its own family's circle;
 *   5. spacing: no two nodes of one family closer than a floor (they would print one on the other).
 * `--png <file>` also writes a preview (dots + links, coloured) to read with an image viewer.
 * `--poison` shifts one family onto another and requires check 4 to FAIL.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const argv = process.argv.slice(2)
const POISON = argv.includes('--poison')
const PNG = argv.includes('--png') ? argv[argv.indexOf('--png') + 1] : ''
let fails = 0
const ok = (c, m) => { if (c) console.log('ok   ' + m); else { fails++; console.log('FAIL ' + m) } }

let current = true
try { execFileSync('node', [resolve(HERE, 'build-language-tree.mjs'), '--check'], { stdio: 'pipe' }) } catch { current = false }
ok(current, 'the tree files are what the builder makes from main\'s inputs')

const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
const tree = T('gospel-internet-tree.json')
const gi = T('gospel-internet.json')
const nodes = tree.nodes
const byId = new Map(nodes.map((n) => [n.id, n]))

// 2. complete
const langs = new Set(gi.rows.map((r) => r.iso639_3))
const onTree = new Set(nodes.filter((n) => n.iso).map((n) => n.iso))
const lost = [...langs].filter((l) => !onTree.has(l))
ok(lost.length === 0, `every roster language is on the tree (${langs.size}; lost: ${lost.slice(0, 5).join(', ') || 'none'})`)
ok(nodes.every((n) => !n.p || byId.has(n.p)), 'every parent link resolves')

// 3. colours, recomputed
const eb = T('ebible-index.json').codes || {}
const links = T('gospel-resource-links.json').rows
const nt = new Set(Object.entries(eb).filter(([, v]) => v && (v.nt || v.full)).map(([k]) => k))
for (const r of links) if (/^(New Testament|Full Bible)$|^(27|66) parts/.test(r.scope || '')) nt.add(r.iso639_3)
for (const [iso, c] of Object.entries(T('people-group-pins.json').codes || {})) if (/^(27|66) parts/.test((c && c.au && c.au.vsc) || '')) nt.add(iso)
const some = new Set(gi.rows.filter((r) => r.access_detail && r.access_detail !== 'none').map((r) => r.iso639_3))
const want = (iso) => nt.has(iso) ? 'g' : some.has(iso) ? 'y' : 'r'
const wrong = nodes.filter((n) => n.iso && langs.has(n.iso) && n.st !== want(n.iso))
ok(wrong.length === 0, `every roster language coloured by the rule (${wrong.length} wrong${wrong[0] ? ': ' + wrong[0].iso : ''})`)
const ownDialect = nodes.filter((n) => n.lv === 'd' && !n.inh && !(n.iso && langs.has(n.iso)))
ok(ownDialect.length === 0, `no dialect claims its own evidence (${ownDialect.length})`)

// 4 + 5. geometry in Mercator pixels at z0 (512-px world, the engines' tile size)
const W = 512
const px = ([lng, lat]) => {
  const x = (lng + 180) / 360 * W
  const s = Math.sin(lat * Math.PI / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W
  return [x, y]
}
const rootOf = (n) => { let c = n; while (c.p) c = byId.get(c.p); return c }
const roots = nodes.filter((n) => !n.p)
const circ = new Map(roots.map((r) => [r.id, { c: px(r.c), R: (r.R || 0) * W }]))
if (POISON && roots.length > 1) { const [a, b] = roots; circ.get(a.id).c = circ.get(b.id).c }
let overlaps = 0
for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
  const A = circ.get(roots[i].id), B = circ.get(roots[j].id)
  if (Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]) < A.R + B.R - 1e-6) overlaps++
}
ok(overlaps === 0, `no two family circles overlap (${overlaps} overlapping pairs of ${roots.length} families)`)
let outside = 0
for (const n of nodes) {
  const r = rootOf(n), C = circ.get(r.id), p = px(n.c)
  if (Math.hypot(p[0] - C.c[0], p[1] - C.c[1]) > C.R + 1e-6) outside++
}
ok(outside === 0, `every node lies inside its family's circle (${outside} outside)`)
// spacing: the true nearest pair, via a 1-px grid (any pair closer than 1 px shares a 3x3 block)
const cell = 1
const grid = new Map()
let minD = Infinity, pair = null
nodes.forEach((n, i) => {
  const p = px(n.c), cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell)
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const [q, j] of grid.get(`${cx + dx},${cy + dy}`) || []) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < minD) { minD = d; pair = [i, j] } }
  }
  const k = `${cx},${cy}`
  if (!grid.has(k)) grid.set(k, [])
  grid.get(k).push([p, i])
})
const ext = roots.reduce((m, r) => Math.max(m, circ.get(r.id).R), 0)
if (minD === Infinity) console.log('NOT MEASURED: no two nodes within 1 px at z0; the spacing measure found nothing to compare')
console.log(`info closest two nodes: ${minD.toFixed(4)} px at z0 = ${(minD * 128).toFixed(1)} px at z7 (${pair ? nodes[pair[0]].n + ' / ' + nodes[pair[1]].n : ''}); largest family radius ${ext.toFixed(1)} px at z0`)
// Dialect labels first show at z5.6 (dots at every zoom); two dots closer than 4 px by z7 print as one.
ok(minD * 2 ** 7 >= 4, 'no two nodes print on one another at zoom 7 (>= 4 px apart)')

// 6. the poster: no two labels overlap, at both sheet sizes; every family is named at 4 x 4 ft; the
//    language coverage does not fall below what was measured when the poster shipped (671 / 779 of 858)
{
  const M = await import(resolve(HERE, '../src/model.js'))
  const { buildTreePoster } = await import(resolve(HERE, '../src/treePoster.js'))
  const ixP = M.indexTree(tree)
  const scP = M.treeScope(ixP, M.normalizeRows(gi))
  const ovl = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
  for (const [size, floor] of [[36, 660], [48, 770]]) {
    const { svg, stats } = buildTreePoster(ixP, scP, { sizeIn: size })
    const L = stats.labelBoxes
    let ov = POISON ? 1 : 0
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (L[i].some((a) => L[j].some((b) => ovl(a, b)))) ov++
    const texts = (svg.match(/<text /g) || []).length
    ok(ov === 0, `poster ${size} in: no two labels overlap (${stats.labels} labels, ${ov} overlapping pairs)`)
    ok(858 - stats.dropped.l >= floor, `poster ${size} in: ${858 - stats.dropped.l} of 858 languages named (floor ${floor})`)
    ok(texts >= stats.labels, `poster ${size} in: every placed label is in the SVG (${texts} text elements)`)
    if (size === 48) ok(stats.dropped.f === 0, `poster 48 in: every family named (${stats.dropped.f} left off)`)
  }
}

if (PNG) {
  // a tiny RGBA rasteriser: links, then dots, then family rings. No dependency.
  const S = 1400, scale = S / W
  const buf = Buffer.alloc(S * S * 4, 255)
  for (let i = 0; i < S * S; i++) { buf[i * 4] = 243; buf[i * 4 + 1] = 243; buf[i * 4 + 2] = 241 }
  const set = (x, y, [r, g, b], a = 1) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    buf[i] = buf[i] * (1 - a) + r * a; buf[i + 1] = buf[i + 1] * (1 - a) + g * a; buf[i + 2] = buf[i + 2] * (1 - a) + b * a
  }
  const line = (a, b, col, alpha) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let i = 0; i <= n; i++) set(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, col, alpha) }
  const disc = (c, r, col) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r) set(c[0] + dx, c[1] + dy, col) }
  const COL = { g: [16, 150, 90], y: [232, 180, 40], r: [180, 35, 24] }
  // centre the tapestry in the frame
  const all = nodes.map((n) => px(n.c))
  const mx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2
  const my = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2
  const span = Math.max(...all.map((p) => Math.max(Math.abs(p[0] - mx), Math.abs(p[1] - my)))) * 2.1
  const tp = (p) => [(p[0] - mx) / span * S + S / 2, (p[1] - my) / span * S + S / 2]
  for (const n of nodes) if (n.p) line(tp(px(byId.get(n.p).c)), tp(px(n.c)), [110, 118, 110], 0.35)
  for (const r of roots) { const C = circ.get(r.id); const c = tp(C.c), R = C.R / span * S; for (let a = 0; a < 6.283; a += 0.5 / Math.max(R, 1)) set(c[0] + R * Math.cos(a), c[1] + R * Math.sin(a), [150, 160, 150], 0.6) }
  const worst = new Map()
  for (const n of nodes) if (n.st && !n.inh) { let p = n; while (p) { const w = worst.get(p.id); if (!w || 'gyr'.indexOf(n.st) > 'gyr'.indexOf(w)) worst.set(p.id, n.st); p = p.p ? byId.get(p.p) : null } }
  for (const n of nodes) {
    const st = n.st || worst.get(n.id) || 'g'
    const r = n.lv === 'f' ? 5 : n.lv === 'b' ? 1 : n.lv === 'l' ? 2 : 1
    disc(tp(px(n.c)), r, n.inh ? COL[st].map((v) => Math.round(v + (255 - v) * 0.5)) : COL[st])
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const raw = Buffer.alloc(S * (S * 4 + 1))
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
  writeFileSync(PNG, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
  console.log('info preview written: ' + PNG)
}

if (POISON) { console.log(fails ? `POISON OK: ${fails} caught` : 'POISON FAILED'); process.exitCode = fails ? 0 : 1 }
else { console.log(fails ? `FAIL check-language-tree: ${fails}` : 'PASS check-language-tree'); process.exitCode = fails ? 1 : 0 }
