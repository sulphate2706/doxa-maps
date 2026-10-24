#!/usr/bin/env node
/**
 * check-no-fleet-names.mjs — source text names no build-team member, attributes no request to a user, and carries
 * no dated QA-round tag.
 *
 * The tracked source of this repo is published. Comments are where provenance creeps in: who measured a thing,
 * which request a choice answered, which QA round found it. The technical fact belongs in the comment; the person,
 * the request and the date-stamped round do not. A sweep removed every such line; this gate keeps the count at 0.
 *
 * SCANS every tracked text file EXCEPT research data (data/, plugin-designs/<plugin>/data/) and build output
 * (public/). The translation catalogues ARE scanned: a name can hide in a string as well as a comment, and a
 * translation that ever collides with a short name is allowed by its line, not by skipping the folder. Names match
 * in any case. Three classes:
 *   1. a build-team member's name (the fleet's agent names);
 *   2. a per-user attribution (the words "per" and "user" in a row: a request credited to a person);
 *   3. a dated QA-round tag (a lowercase or uppercase QA label followed by a 20xx date).
 * ALLOWED: named LINES only (ALLOW below: a file plus the exact line pattern, with the reason), never a whole file,
 * so a new name added to an allowlisted file still fails. It is empty today: this gate builds its own patterns
 * from parts, so it does not match itself.
 * --self-test plants each class (and a clean line, and an allowed line) and must see exactly the planted ones.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Built from parts so this file does not match itself line by line.
const NAMES = ['dx-' + 'shepherd', 'exp-' + 'shepherd', 'go-' + 'int', 'msg-' + 'agent', 're' + 'ga']
// The plugin agents are named <plugin>-plugin; the folders and bundles never carry that suffix.
const PLUGIN_AGENTS = ['deep-research', 'prayer-progress', 'poster-design', 'country-posters', 'wall-of-people-groups',
  'simpleresearch', 'regions', 'big-picture', 'bible-poster', 'upg100', 'gospel', 'cities'].map((p) => p + '-' + 'plugin')
const CLASSES = [
  ['a build-team member named', new RegExp('\\b(' + NAMES.concat(PLUGIN_AGENTS).join('|') + ')\\b', 'i')],
  ['a per-user attribution', new RegExp('\\bper ' + 'user\\b', 'i')],
  ['a dated QA tag', new RegExp('\\(q' + 'a:|\\bq' + 'a: ?20\\d\\d-|\\bQ' + 'A 20\\d\\d-\\d\\d')],
]
const SKIP = [/^data\//, /^public\//, /^plugin-designs\/[^/]+\/data\//, /\/node_modules\//]
const TEXT = /\.(m?js|cjs|ts|vue|html|css|json|md|sh|go|py|ya?ml|txt|svg)$|(^|\/)(Dockerfile|\.gitignore|\.gitattributes)$/
// { file, line: RegExp matching the WHOLE allowed line, why }. A detector that must name what it detects goes here,
// one line at a time. Empty today.
export const ALLOW = []

export function scanText(text, file = '', allow = ALLOW) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    if (allow.some((a) => a.file === file && a.line.test(line))) return
    for (const [what, re] of CLASSES) if (re.test(line)) hits.push({ file, line: i + 1, what, text: line.trim().slice(0, 140) })
  })
  return hits
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8')
  return out.split('\0').filter((f) => f && TEXT.test(f) && !SKIP.some((re) => re.test(f)))
}

if (process.argv.includes('--self-test')) {
  const planted = [
    ['measured by ' + NAMES[4] + ' at 390', 1],
    ['(' + NAMES[0] + "'s ruling)", 1],
    ['// Per ' + 'user 2026-05-02: drop the prefix', 1],
    ['/* fits the band (q' + 'a: 2026-05-02 iter-9) */', 1],
    ['// Q' + 'A 2026-04-27: rows match desktop', 1],
    ['// the drawer opens from the right in ar', 0],
    ['// a user of the map can pick a language', 0],
    ['// ' + NAMES[4].toUpperCase().slice(0, 1) + NAMES[4].slice(1) + ' measured it at 390', 1],
    ['(' + NAMES[0].toUpperCase() + "'s call)", 1],
    ['// on ' + PLUGIN_AGENTS[9] + "'s argument", 1],
    ['// the ' + PLUGIN_AGENTS[3].replace('-' + 'plugin', '') + ' bundle', 0],
    ['// the irrigation (reg' + 'ar) field', 0],
  ]
  let bad = 0
  for (const [line, want] of planted) {
    const got = scanText(line, 'x.js').length
    const ok = got === want
    console.log(`  ${ok ? 'ok ' : 'BAD'} ${want ? 'caught' : 'clean '}: ${line}`)
    if (!ok) bad++
  }
  // A name inside a translation catalogue is scanned like any other file.
  const localeFile = 'library/i18n/locales/en/x.json'
  if (SKIP.some((re) => re.test(localeFile)) || scanText('{ "note": "by ' + NAMES[0] + '" }', localeFile).length !== 1) { console.log('  BAD locales: a name in a catalogue was not caught'); bad++ }
  // The allowlist is per LINE: an allowed line passes, a different flagged line in the SAME file still fails.
  const allow = [{ file: 'd.mjs', line: /^const PATTERN = .*detects$/, why: 'self-test' }]
  const allowedLine = 'const PATTERN = "' + NAMES[0] + '" // detects'
  if (scanText(allowedLine, 'd.mjs', allow).length !== 0) { console.log('  BAD allowlist: an allowed line was flagged'); bad++ }
  if (scanText(allowedLine + '\n// measured by ' + NAMES[4], 'd.mjs', allow).length !== 1) { console.log('  BAD allowlist: a new name in an allowlisted file passed'); bad++ }
  if (scanText(allowedLine, 'other.mjs', allow).length !== 1) { console.log('  BAD allowlist: the allowed line passed in another file'); bad++ }
  if (bad) { console.error(`NO-FLEET-NAMES SELF-TEST: FAIL — ${bad} line(s) judged wrong.`); process.exit(1) }
  console.log(`NO-FLEET-NAMES SELF-TEST: PASS — ${planted.filter((p) => p[1]).length} planted lines caught, ${planted.filter((p) => !p[1]).length} clean lines passed, the per-line allowlist holds (3 cases), catalogues are scanned.`)
  process.exit(0)
}

const files = trackedFiles()
const hits = []
for (const f of files) { let t; try { t = readFileSync(join(ROOT, f), 'utf8') } catch { continue } hits.push(...scanText(t, f)) }
if (hits.length) {
  console.error(`NO-FLEET-NAMES: FAIL — ${hits.length} line(s) in ${new Set(hits.map((h) => h.file)).size} file(s). State the fact; drop the person, the request and the dated round:`)
  for (const h of hits.slice(0, 40)) console.error(`  ✗ ${h.file}:${h.line} (${h.what}): ${h.text}`)
  process.exit(1)
}
console.log(`NO-FLEET-NAMES: PASS — ${files.length} tracked source files name no build-team member, attribute no request to a user and carry no dated QA-round tag.`)
