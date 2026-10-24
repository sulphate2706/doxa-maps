#!/usr/bin/env node
/**
 * check-no-internal-role-nouns — shipped text names no internal process role, and the references already
 * in it may only go away.
 *
 * The rule: a comment, doc, UI string or commit says what the code does and why, never who said what.
 * An open decision reads "provisional, pending a product decision". The gate holds the line
 * FORWARD-ONLY against a baseline:
 *   - a line that uses the role noun and is not in the baseline FAILS (a new reference);
 *   - a baselined line that is gone is fine (owners sweep in parallel); --shrink tidies the baseline.
 *
 * WHAT COUNTS: the role noun as a whole word, in title case or in capitals (not a GPU or device driver,
 * not WebDriver, not an env name with the word in it). The word is assembled at runtime below, so this
 * file does not itself carry it. KEYED by file plus the line's normalised text, with a count, not by
 * line number, so edits elsewhere in a file never trip it; a new line with the same text in the same
 * file raises the count and fails.
 *
 * ⚠ THE CAPITALS FORM WAS MISSING AT FIRST. The first pattern matched only the title-case form, so lines
 * written in capitals passed unseen, and a sweep measured by this gate read as finished while they
 * stayed. The baseline was re-measured once with the wider pattern, the one time it has grown; it only
 * shrinks from here.
 *
 *   node internal/check-no-internal-role-nouns.mjs            check
 *   node internal/check-no-internal-role-nouns.mjs --shrink   drop what is gone (never adds)
 *   node internal/check-no-internal-role-nouns.mjs --init     write the baseline, only if none exists
 *
 * Node only. Exit 0 pass · 1 fail.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'internal/check-no-internal-role-nouns.mjs'
// Files whose JOB is to name the word: a checker's pattern list is not a citation. Exempt by name, each with its
// reason, so no rule wider than one file is ever needed. Anything else in them is still that file's owner's to keep clean.
const PATTERN_FILES = new Set([
  'internal/public-hygiene-check.mjs',   // its egress patterns match the role noun
])
const BASELINE_REL = 'internal/fixtures/internal-role-nouns-baseline.json'
const BASELINE = join(ROOT, BASELINE_REL)
// The role noun, assembled from parts so this file does not carry it; title case and capitals.
const W = ['Dri', 'ver'].join('')
const WU = W.toUpperCase()
const ROLE = new RegExp(`\\b(?:${W}|${WU})\\b`)
const AREAS = ['library', 'plugin-designs', 'internal', 'documentation', 'skills', 'README.md']

export function referencesIn(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    if (ROLE.test(line)) out.push({ line: i + 1, norm: line.replace(/\s+/g, ' ').trim() })
  })
  return out
}
const keyOf = (file, norm) => `${file}\u0000${norm}`

function shippedFiles() {
  const listed = execFileSync('git', ['-C', ROOT, 'ls-files', ...AREAS], { encoding: 'utf8' })
  return listed.split('\n').filter((f) => /\.(vue|js|mjs|md|json|html|css)$/.test(f) && !f.includes('/data/')
    && f !== SELF && f !== BASELINE_REL && !PATTERN_FILES.has(f))
}

function tally(files, read) {
  const counts = new Map(); const where = new Map()
  for (const f of files) {
    let text
    try { text = read(f) } catch { continue }
    for (const r of referencesIn(text)) {
      const k = keyOf(f, r.norm)
      counts.set(k, (counts.get(k) || 0) + 1)
      if (!where.has(k)) where.set(k, { file: f, line: r.line, text: r.norm })
    }
  }
  return { counts, where }
}

// ── self-test: the role noun is found, a device driver is not, and a new line beside a baselined one is isolated
{
  const found = referencesIn(`// the ${W} ruled that numerals stay en-US\n// THE ${WU}'S ASK\n// the GPU driver and WebDriver and ${WU}_MERGE\n`)
  if (found.length !== 2) { console.error('ROLE-NOUNS: SELF-TEST FAILED — the role noun (either case) is not told apart from other drivers'); process.exit(1) }
  const { counts } = tally(['a.vue'], () => `// ${W}: old\n// ${W}: old\n// ${W}: new\n`)
  const base = new Map([[keyOf('a.vue', `// ${W}: old`), 2]])
  const fresh = [...counts].filter(([k, n]) => n > (base.get(k) || 0))
  if (fresh.length !== 1 || !fresh[0][0].endsWith('new')) { console.error('ROLE-NOUNS: SELF-TEST FAILED — a new reference beside baselined ones was not isolated'); process.exit(1) }
}

const { counts, where } = tally(shippedFiles(), (f) => readFileSync(join(ROOT, f), 'utf8'))
const args = process.argv.slice(2)
const toObj = (m) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)))

if (args.includes('--init')) {
  if (existsSync(BASELINE)) { console.error(`ROLE-NOUNS: --init refused, ${BASELINE_REL} exists (use --shrink)`); process.exit(1) }
  writeFileSync(BASELINE, JSON.stringify({ about: 'Lines in shipped text that used the internal role noun when this gate began, keyed by file and text. Owners remove them; the list only shrinks (--shrink).', counts: toObj(counts) }, null, 1) + '\n')
  console.log(`ROLE-NOUNS: baseline written: ${counts.size} line(s) in ${new Set([...where.values()].map((w) => w.file)).size} file(s)`)
  process.exit(0)
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { counts: {} }
const base = new Map(Object.entries(baseline.counts || {}))

if (args.includes('--shrink')) {
  const kept = new Map()
  for (const [k, n] of base) { const now = counts.get(k) || 0; if (now > 0) kept.set(k, Math.min(n, now)) }
  writeFileSync(BASELINE, JSON.stringify({ ...baseline, counts: toObj(kept) }, null, 1) + '\n')
  console.log(`ROLE-NOUNS: baseline shrunk ${base.size} -> ${kept.size} line(s) (it never grows)`)
  process.exit(0)
}

const fresh = [...counts].filter(([k, n]) => n > (base.get(k) || 0)).map(([k]) => where.get(k))
const gone = [...base.keys()].filter((k) => !counts.has(k)).length
if (fresh.length) {
  console.error(`ROLE-NOUNS: FAIL — ${fresh.length} new use(s) of the internal role noun in shipped text:`)
  for (const w of fresh.slice(0, 20)) console.error(`  ✗ ${w.file}:${w.line}  ${w.text.slice(0, 120)}`)
  console.error('  Keep the engineering reason and drop the speaker; an open decision reads "provisional, pending a product decision".')
  process.exit(1)
}
console.log(`ROLE-NOUNS: PASS — no new use of the internal role noun; ${base.size - gone} older line(s) still baselined for the sweep`
  + (gone ? `, ${gone} already swept (tidy with --shrink)` : '') + '.')
