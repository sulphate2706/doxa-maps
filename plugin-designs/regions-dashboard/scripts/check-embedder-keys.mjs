#!/usr/bin/env node
// A cap-4 composite must forward the page keys an EMBEDDER is documented to set -- or the key is a
// promise the shell silently breaks.
//
// PRODUCTION-MATRIX.md's own table for anyone running cells B and C names four keys and what each
// costs when omitted: profile ("no view to render"), dataSource ("wrong/partial data -- Regions uses
// pray-tools"), tk ("basemap never authenticates"), assetsBase ("the one key to CHANGE, not copy").
// A nested pane has NO leaf page of its own, so anything the generator bakes once per page has to be
// forwarded by hand. regions-mfe forwarded assetsBase and not dataSource.
//
// WHY THE LIST IS NOT SIMPLY "ALL FOUR":
//   profile     MUST NOT be inherited. The host's profile would overwrite each pane's own, which is
//               the one thing that makes a pane a pane. Asserted as an EXCLUSION below, so a future
//               "fix" that adds it fails this gate instead of silently collapsing both tabs into one.
//   tk          needs no forwarding: ProfileLoader publishes a token it is handed PAGE-WIDE
//               (ProfileLoader.vue:128) and every pane reads it via useSharedMapToken.
//   tokenUrl    forwarded for symmetry rather than for a live failure -- see the note in the source.
//               The outer loader fetches and publishes, so panes have a token; without the URL they
//               simply cannot re-ask the service themselves.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeOnly } from './strip-code.mjs'

// Resolve the target from THIS FILE's location, not from cwd. A gate that only passes when run from
// the repo root is a gate that silently NOT-MEASURES from anywhere else, and `bun run` is not the
// only way this gets invoked.
const HERE = dirname(fileURLToPath(import.meta.url))

let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

const FILE = resolve(HERE, '..', 'regions-mfe.vue')
const src = codeOnly(readFileSync(FILE, 'utf8'))
const listMatch = /const INHERITED_PAGE_KEYS\s*=\s*\[([^\]]*)\]/.exec(src)
ok(!!listMatch, `regions-mfe declares INHERITED_PAGE_KEYS (${FILE.replace(/.*plugin-designs/, 'plugin-designs')})`)
const keys = listMatch ? listMatch[1].split(',').map((k) => k.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []
console.log(`\n  forwarded keys (${keys.length}): ${keys.join(', ')}\n`)

for (const k of ['assetsBase', 'dataSource', 'tokenUrl', 'locale', 'provider']) {
  ok(keys.includes(k), `forwards '${k}'`)
}
// ★ EXCLUSIONS, asserted so a well-meaning addition cannot pass unnoticed.
for (const k of ['profile', 'instanceId']) {
  ok(!keys.includes(k), `does NOT forward '${k}' -- the host's would overwrite each pane's own, collapsing both tabs into one view`)
}
// The merge must keep a pane's own config last, or the exclusions above stop protecting anything.
ok(/\{\s*\.\.\.inherited,\s*\.\.\.spec\.value\.config,\s*\.\.\.pane\.config\s*\}/.test(src),
  'the merge order is { ...inherited, ...spec.config, ...pane.config } -- a pane\'s own keys win last')
// And the filter must keep `false`, which is the value pinHint:false depends on.
ok(/!==\s*undefined\s*&&[^)]*!==\s*null\s*&&[^)]*!==\s*''/.test(src),
  'the filter rejects only undefined/null/empty-string, so a legitimate `false` (pinHint) still travels')

// ── CONTROLS ────────────────────────────────────────────────────────────────────────────────────
const parse = (t) => { const m = /const INHERITED_PAGE_KEYS\s*=\s*\[([^\]]*)\]/.exec(codeOnly(t)); return m ? m[1].split(',').map((k) => k.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [] }
ok(parse("const INHERITED_PAGE_KEYS = ['a', 'b']").join() === 'a,b', 'POS CONTROL: the key list parses')
ok(!parse("// const INHERITED_PAGE_KEYS = ['profile']").includes('profile'),
  'NEG CONTROL: a COMMENTED-OUT list is not read as the real one')
ok(parse("const INHERITED_PAGE_KEYS = []").length === 0, 'CONTROL: an empty list reads as empty, not as absent')

console.log(fails ? `\nEMBEDDER-KEYS: ${fails} FAIL(s)` : '\nEMBEDDER-KEYS: every documented embedder key is forwarded, and profile/instanceId are correctly not')
process.exit(fails ? 1 : 0)
