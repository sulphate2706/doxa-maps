#!/usr/bin/env node
/**
 * check-ui-strings-have-keys.mjs — user-visible text must come from the catalogue, and the ground
 * we have won must not be given back.
 *
 * ★ WHY THIS EXISTS, AND WHY NO EXISTING CHECK COULD SEE IT.
 * check:composite-locale-leaks asks "does the catalogue translate this string, and is the page
 * showing English anyway?" — a LOOKUP, and a good one. But its criterion is that the catalogue
 * already HOLDS the string, so a string nobody ever added is invisible to it by construction. And
 * it runs in a browser, so it only ever sees what happens to be rendered on one screen.
 *
 * That blind spot was measured, not guessed: after both composites passed the leak gate with 0
 * findings, a source audit of the same two trees found 31 more user-visible strings — 24 with no
 * catalogue entry at all and 7 that HAD a translation in eleven languages and were still typed into
 * the template. Most were aria-labels, titles and tooltips: text only a screen-reader user or a
 * hovering mouse ever meets. Our localization verification had been "what can I see", and the blind
 * spot was exactly the readers who most need the words.
 *
 * TWO CLASSES, because they are different defects with different fixes:
 *   NO KEY         wording must be written and translated — a decision, sometimes a product decision.
 *   HAS A KEY      the translation already ships in eleven locales and the reader is shown English
 *                  anyway. The cheapest defect in the catalogue: the work was done and wasted.
 *
 * ★ WARN-ONLY AGAINST A BASELINE, ON PURPOSE. Failing on the whole backlog would make this
 * unlandable and it would be switched off within a day. It fails on what is NEW — a string added
 * today with no key, or a newly hardcoded one — so the count can only fall. When a batch lands,
 * refresh the baseline with --update and the gate holds the new line.
 *
 * QaCorner is excluded by name: it is an opt-in DEVELOPER widget, not reader-facing, and studio is
 * making it host-neutral or removing it. Eleven locales for a corner only we open is not worth the
 * translations, and that is a judgement worth writing down rather than leaving as a silent gap.
 *
 * USAGE  node .../check-ui-strings-have-keys.mjs            check against the baseline
 *        node .../check-ui-strings-have-keys.mjs --update   rewrite the baseline from today's tree
 * Exit: 0 clean or only improvements · 1 a NEW uncatalogued or newly hardcoded string.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSFC } from '@vue/compiler-sfc'

const TAG = 'UI-STRINGS-HAVE-KEYS'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BASELINE = join(ROOT, 'plugin-designs', 'research-map-plus-grid', 'scripts', 'ui-strings-baseline.json')
const ROOTS = ['plugin-designs', 'library']
// Not reader-facing: an opt-in developer widget, being made host-neutral or removed.
const EXCLUDE = [/\/qa\/QaCorner\.vue$/]

// ── the catalogue: English value -> the key(s) that hold it ─────────────────────────────────────
const flat = (o, p, out) => {
  for (const [k, v] of Object.entries(o || {})) {
    const K = p ? `${p}.${k}` : k
    if (v && typeof v === 'object') flat(v, K, out); else out[K] = v
  }
  return out
}
const en = {}
const enDir = join(ROOT, 'library/i18n/locales/en')
for (const f of readdirSync(enDir).filter((f) => f.endsWith('.json'))) {
  flat(JSON.parse(readFileSync(join(enDir, f), 'utf8')), f.replace(/\.json$/, ''), en)
}
const known = new Map()
for (const [k, v] of Object.entries(en)) {
  const t = String(v).trim()
  if (!t) continue
  if (!known.has(t)) known.set(t, [])
  known.get(t).push(k)
}

const vues = (d, out = []) => {
  let es; try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) vues(p, out); else if (e.endsWith('.vue')) out.push(p)
  }
  return out
}

const VISIBLE_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'aria-placeholder', 'aria-description'])
/** Worth translating? Real words, not a glyph, a number, a class name or a CSS value. */
const worthIt = (t) => {
  const s = String(t || '').trim()
  if (s.length < 3 || s.length > 120) return false
  if (!/[A-Za-z]{2}/.test(s)) return false
  if (!/[A-Za-z]/.test(s[0])) return false
  if (/^[a-z][a-z0-9-]*$/.test(s)) return false
  if (/[{}<>;]|:\s*\d|px$|rem$|%$/.test(s)) return false
  if (/^(true|false|null|undefined)$/i.test(s)) return false
  return true
}

function walk(node, hit) {
  if (!node) return
  if (node.type === 2 && node.content) hit(node.content)
  if (node.type === 1) {
    for (const p of node.props || []) {
      if (p.type === 6 && VISIBLE_ATTRS.has(p.name) && p.value && p.value.content) hit(p.value.content)
    }
  }
  for (const c of node.children || []) walk(c, hit)
  if (node.branches) for (const b of node.branches) walk(b, hit)
}

const findings = { noKey: {}, hasKey: {} }
let scanned = 0
for (const r of ROOTS) {
  for (const file of vues(join(ROOT, r))) {
    const rel = relative(ROOT, file)
    if (EXCLUDE.some((re) => re.test(rel))) continue
    let d
    try { ({ descriptor: d } = parseSFC(readFileSync(file, 'utf8'), { filename: file })) } catch { continue }
    if (!d.template || !d.template.ast) continue
    scanned++
    const seen = new Set()
    walk(d.template.ast, (text) => {
      const t = String(text).replace(/\s+/g, ' ').trim()
      if (!worthIt(t) || seen.has(t)) return
      seen.add(t)
      const bucket = known.has(t) ? findings.hasKey : findings.noKey
      ;(bucket[rel] ||= []).push(t)
    })
  }
}
for (const b of [findings.noKey, findings.hasKey]) for (const k of Object.keys(b)) b[k].sort()

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(findings, null, 2) + '\n')
  const n = (b) => Object.values(b).reduce((a, l) => a + l.length, 0)
  console.log(`${TAG}: baseline rewritten — ${n(findings.noKey)} without a key, ${n(findings.hasKey)} hardcoded-with-a-key, across ${scanned} components.`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.log(`${TAG}: FAIL — no baseline at ${relative(ROOT, BASELINE)}. Create it with --update, and read it before you do.`)
  process.exit(1)
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
const inBase = (cls, file, text) => (base[cls]?.[file] || []).includes(text)

const fresh = { noKey: [], hasKey: [] }
const fixed = { noKey: [], hasKey: [] }
for (const cls of ['noKey', 'hasKey']) {
  for (const [file, list] of Object.entries(findings[cls])) {
    for (const t of list) if (!inBase(cls, file, t)) fresh[cls].push([file, t])
  }
  for (const [file, list] of Object.entries(base[cls] || {})) {
    for (const t of list) if (!(findings[cls][file] || []).includes(t)) fixed[cls].push([file, t])
  }
}

const count = (b) => Object.values(b).reduce((a, l) => a + l.length, 0)
console.log(`${TAG}: ${scanned} component(s); ${count(findings.noKey)} string(s) with no catalogue entry, ${count(findings.hasKey)} with a key but hardcoded.`)
if (fixed.noKey.length || fixed.hasKey.length) {
  console.log(`  ✓ ${fixed.noKey.length + fixed.hasKey.length} baseline string(s) fixed since it was set — refresh with --update to hold the new line.`)
}
if (fresh.noKey.length || fresh.hasKey.length) {
  console.log(`\n${TAG}: FAIL — ${fresh.noKey.length + fresh.hasKey.length} NEW string(s) since the baseline:`)
  for (const [f, t] of fresh.noKey) console.log(`  ✗ no key      ${f}  ${JSON.stringify(t)}`)
  for (const [f, t] of fresh.hasKey) console.log(`  ✗ has a key   ${f}  ${JSON.stringify(t)}  — the translation already ships; read it instead of typing it`)
  console.log('\n  A string with NO key needs wording and eleven translations, which is sometimes the')
  console.log('  A product decision. A string that HAS a key needs one edit: the work is already done.')
  process.exit(1)
}
console.log(`${TAG}: PASS — no new English has appeared in a template since the baseline.`)
