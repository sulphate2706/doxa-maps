#!/usr/bin/env node
/**
 * check-doc-quotes-scripts.mjs — a doc that QUOTES package.json must still match it.
 *
 * THE DEFECT THIS CATCHES, found 2026-09-23. documentation/README-SECTION-3-cli-commands.md
 * transcribes the package.json scripts verbatim so a reader can see them without opening the file.
 * That is a genuinely useful doc and a copy that can never stay true on its own: `bun run serve` was
 * changed from `python3 -m http.server` to `node internal/serve-strict.mjs` two commits earlier, and
 * the doc still taught the old one. An inheritor following the CLI reference would have started the
 * PERMISSIVE server — the one whose forgiveness hid a URL bug in two gates for a whole flight.
 *
 * ★ WHY A GATE AND NOT JUST THE FIX. The repo already carries
 * AP-a-doc-that-QUOTES-a-config-file-silently-stops-matching-it. Hand-fixing this instance leaves
 * the NEXT script change to rot the same way, silently, because nothing reads the doc. It is the
 * same answer the repo reached for capability exemplars: prose that cites a checkable source can be
 * checked; prose that cites memory cannot.
 *
 * WHAT IT ASSERTS. Every `"name": "body"` line in the doc that names a REAL package.json script must
 * agree with it. Comparison is deliberately loose in three ways, because the doc is for humans:
 *   - a trailing `# …` comment in package.json is ignored (several scripts carry long explanations);
 *   - a trailing `// …` comment in the DOC is ignored (the doc annotates some entries);
 *   - the doc may TRUNCATE a long script, so a prefix match in either direction passes. build:unlocked
 *     is ~700 characters and no reader wants it in full; what matters is that the part shown is true.
 * A name the doc quotes that does NOT exist in package.json is a hard failure — that is a command an
 * inheritor would type and get "script not found".
 *
 * NOT ASSERTED: that every script is documented. The doc is a curated subset by design, and demanding
 * completeness would make it churn on every internal gate added.
 *
 * NEGATIVE-TESTED via `--self-test`: poisons the doc in memory two ways (a changed body, and a script
 * name that does not exist) and requires both to be caught. In-memory so a crash cannot leave the
 * tree edited.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(ROOT, 'documentation/README-SECTION-3-cli-commands.md')
const REL = 'documentation/README-SECTION-3-cli-commands.md'

const fail = (m) => { console.error('DOC-QUOTES-SCRIPTS: FAIL — ' + m); process.exit(1) }

// Strip what is presentational rather than semantic: package.json's inline `#` notes and the doc's
// `//` annotations. Both are explanation, not command.
const norm = (s) => s.split(/\s+#\s/)[0].split(/\s+\/\/\s/)[0].trim().replace(/,$/, '').trim()

function audit(docText, scripts) {
  const problems = []
  const quoted = [...docText.matchAll(/^"([a-z0-9:_-]+)":\s*"((?:[^"\\]|\\.)*)"/gm)]
  if (!quoted.length) {
    problems.push('found 0 quoted `"name": "body"` lines in ' + REL + '.\n' +
      '    A gate with nothing to assert is not passing; it is not running. If the doc was restructured,\n' +
      '    update this gate in the same commit.')
    return { problems, checked: 0 }
  }

  let checked = 0
  for (const m of quoted) {
    const name = m[1]
    const shown = norm(m[2].replace(/\\"/g, '"'))
    if (!(name in scripts)) {
      problems.push(`${REL} quotes a script that does NOT EXIST: "${name}".\n` +
        '    An inheritor typing it gets "script not found". Remove it or add it to package.json.')
      continue
    }
    checked++
    const real = norm(scripts[name])
    // The doc may truncate a long script; a prefix match in either direction is fine.
    const head = Math.min(30, shown.length, real.length)
    if (head > 0 && (real.startsWith(shown.slice(0, head)) || shown.startsWith(real.slice(0, head)))) continue
    problems.push(`${REL} — "${name}" no longer matches package.json.\n` +
      `      doc : ${shown.slice(0, 70)}\n` +
      `      real: ${real.slice(0, 70)}\n` +
      '    The doc transcribes package.json so a reader need not open it, which means it rots on every\n' +
      '    script change unless something checks it. Update the doc, not this gate.')
  }
  return { problems, checked }
}

const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {}

if (process.argv.includes('--self-test')) {
  const original = readFileSync(DOC, 'utf8')
  if (audit(original, scripts).problems.length) {
    console.error('DOC-QUOTES-SCRIPTS SELF-TEST: FAIL — the tree is already failing; fix that first.')
    process.exit(1)
  }
  const cases = [
    ['body-drifted', (s) => s.replace(/^"serve":\s*"[^"]*"/m, '"serve":           "python3 -m http.server 4173"')],
    ['script-does-not-exist', (s) => s.replace(/^"dev":/m, '"dveloop":')],
  ]
  let bad = 0
  for (const [name, poison] of cases) {
    const mutated = poison(original)
    if (mutated === original) { console.error(`  ${name}: POISON DID NOT APPLY — the case proves nothing.`); bad++; continue }
    const caught = audit(mutated, scripts).problems.length > 0
    console.log(`  ${name}: ${caught ? 'caught' : 'NOT CAUGHT'}`)
    if (!caught) bad++
  }
  if (bad) { console.error(`DOC-QUOTES-SCRIPTS SELF-TEST: FAIL — ${bad} case(s) not caught.`); process.exit(1) }
  console.log('DOC-QUOTES-SCRIPTS SELF-TEST: PASS — both regressions caught; tree untouched (poisoned in memory).')
  process.exit(0)
}

const { problems, checked } = audit(readFileSync(DOC, 'utf8'), scripts)
if (problems.length) {
  console.error(`DOC-QUOTES-SCRIPTS: FAIL — ${problems.length} problem(s).\n`)
  for (const p of problems) console.error('  ✗ ' + p + '\n')
  process.exit(1)
}
console.log(`DOC-QUOTES-SCRIPTS: PASS — ${checked} quoted script(s) match package.json.`)
console.log('  Truncation is allowed (build:unlocked is ~700 chars); what is SHOWN must be true.')
console.log('  Completeness is deliberately not asserted — the doc is a curated subset.')
