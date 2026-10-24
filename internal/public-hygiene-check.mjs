#!/usr/bin/env node
/**
 * public-hygiene-check.mjs — prove a drop-in (or this repo's public/) is fit to be PUBLISHED:
 * only minified bundles, the leaf pages that host them, and the data/assets they fetch.
 *
 * WHY: the day the source is published, the served folder must carry no internal data — no local
 * paths, no internal repo names, no tokens, no source maps, no docs, no preview/staging surfaces.
 * "Looks clean" is not a gate; this scan is, and it can FAIL and say why.
 *
 * WHAT IT CHECKS (each finding prints file + rule):
 *   leaks   — absolute local paths (/home/…, /Users/…, C:\…), internal repo/folder names
 *             (eco-dx, qa-cycle, _archive), dev-server URLs (localhost:5174 / :3001 / :3033)
 *   secrets — JWT-shaped Mapbox tokens (pk./sk./tk. + eyJ… ≥ 20 chars; the 9-char docs
 *             placeholder "MAPBOX_PUBLIC_TOKEN" is allowed), .env files, token.json / token.local.js
 *   debug   — *.map files and sourceMappingURL comments, console.log/debug in bundles
 *   docs    — *.md / *.txt anywhere in the tree
 *   staging — preview surfaces: <tree>/index.html and <tree>/<bundle>/index.html (the internal
 *             staging pages; leaf pages live one level deeper) — reported as WARN unless
 *             --strict, because the shell root may be product for a host site
 *   contract — the drop-in contract: a served root holds ONLY index.html (the generated root
 *             page), assets/ (data) and <tree>/ (the bundle folders + manifest.json). Every other
 *             root entry — a shell's nav.js, external/, _headers … — is a FINDING under --strict
 *             ("outside the drop-in contract"); without --strict it is a warning
 *   meta    — working notes shipped as data: a JSON under assets/ whose top-level "meta" carries
 *             a key named like a to-do or an internal rule (unchecked, blocked, todo, HARD_LIMIT,
 *             THE_BOUNDARY, robots, NEVER) or a value quoting one ("Brief:", "not yet", "TODO",
 *             "NEVER-DO"). A served data file carries provenance, not notes — a FINDING under
 *             --strict, a warning otherwise
 * Also prints an inventory (bundles, leaf pages, staging pages, assets by folder, total size).
 *
 * Usage:  node internal/public-hygiene-check.mjs [<dir> | --root <dir>] [--tree doxa-maps] [--strict] [--json out.json]
 *           <dir> defaults to this repo's public/; for the website pass its drop-in folder.
 * Exit:   0 clean · 1 findings (or warnings with --strict) · 2 bad arguments
 */
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const VALUE_FLAGS = new Set(['--tree', '--json', '--root'])
const DIR = resolve(argOf('--root', '') || args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) || join(ROOT, 'public'))
const TREE = argOf('--tree', TREE_NAME)
const STRICT = args.includes('--strict')
const JSON_OUT = argOf('--json', '')
if (!existsSync(DIR) || !statSync(DIR).isDirectory()) { console.error(`[hygiene] not a directory: ${DIR}`); process.exit(2) }

const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.htm', '.css', '.json', '.geojson', '.txt', '.md', '.svg', '.xml', '_headers',
  // ★ EXTENSIONLESS but TEXT: the map client fetches /api/maps/token (no suffix) and
  // write-token.mjs emits it, so its CONTENTS must be scanned for a JWT-shaped token.
  // Without this the filename rule flagged it while the content scan skipped it entirely.
  'token'])
const norm = p => p.split(sep).join('/')
const files = []
;(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else files.push({ rel: norm(relative(DIR, p)), abs: p, size: st.size }) } })(DIR)

const findings = [], warnings = []
const hit = (list, rule, rel, detail = '') => list.push({ rule, file: rel, detail })
const LEAK = [
  [/\/home\/[a-z0-9_-]+\//i, 'local path (/home/…)'], [/\/Users\/[A-Za-z0-9_-]+\//, 'local path (/Users/…)'], [/[A-Z]:\\Users\\/, 'local path (C:\\Users\\…)'],
  [/\beco-dx\b/, 'internal folder name (eco-dx)'], [/qa-cycle/, 'internal folder name (qa-cycle)'], [/\b_archive\b/, 'internal folder name (_archive)'],
  [/localhost:(5174|3001|3033)\b/, 'dev-server URL'],
  // ★ HARD in every mode (critical, 2026-09-24): the private entry-policy (visa) table must never
  // ship in ANY public tree -- it maps how workers enter closed countries. Found live-served
  // before this rule existed. Filename AND content patterns, no strict-tier softening. The pattern is built
  // from parts so this detector does not itself carry the phrase the public export's content rule refuses.
  [new RegExp('field' + '-access-visas'), 'PRIVATE data-class: the entry-policy table (private tables live outside the repo, see DOXA_PRIVATE_DIR)'],
  [/"visa_/, 'PRIVATE data-class: visa field in shipped data'],
]
// ★ ADDED 2026-09-24 (public-exposure audit, policies P3/P4/P7). A public tree carries
// ARTIFACTS, never PROCESS or operational context — each of these was found live in a public
// mirror by anonymous clone before this rule existed. They are WARNINGS in the normal build
// (the source tree's own public/ still carries them, and failing build:unlocked for every
// writer overnight would get this gate disabled) and FINDINGS under --strict, which the
// publish/export flow MUST run (policy P5: publishing is a gated action, not a habit).
const ROLE_NOUN = ['Dri', 'ver'].join('')   // built from parts so this file does not itself carry the word
const LEAK_STRICT = [
  [new RegExp('\\bthe ' + ROLE_NOUN + '\\b'), 'internal role noun — process vocabulary'],
  [new RegExp('\\b' + ROLE_NOUN + '\\b'), 'internal role noun — process vocabulary'],
  [/doxa-life\/doxa-maps/, 'private repo name'],
  [/\bdoxa-life\b/, 'private org name'],
  [/\bforgejo\b/i, 'self-hosted forge name'],
  [new RegExp('\\b' + ['nuxt', 'base'].join('') + '\\b'), 'internal platform name'],  // built from parts so this file does not itself carry the name
  [/\bpersecution\b/, 'operational-context vocabulary (allowed only inside data CSVs)'],
  [/\.forgejo\/workflows/, 'CI workflow path — process, never ships in a public tree'],
]
// ★ ONE PRAYER IS ALLOWED, WORD FOR WORD: the prayer is for the whole world, and every packet carries the
// same prayer. The operational-vocabulary rule
// skips EXACTLY that prayer: the text at packet-strings.json <locale>.points[0].text (the packets' prayer
// point 1, which UPG-100's Two-Cross packet shows too), read from its source in every locale, removed from
// a scanned file before the rule looks at it. Scoped by file and key, never by the word: the same word
// anywhere else still counts.
const PRAYER_ALLOWED = (() => {
  try {
    const src = JSON.parse(readFileSync(join(ROOT, 'library/scripts/posters/packet-strings.json'), 'utf8'))
    const out = []
    for (const [lc, v] of Object.entries(src)) {
      const text = !lc.startsWith('_') && v?.points?.[0]?.text
      if (typeof text === 'string' && text) out.push(text, JSON.stringify(text).slice(1, -1))   // raw, and as a JS/JSON string literal
    }
    return out
  } catch { return [] }
})()
const withoutPrayer = (t) => PRAYER_ALLOWED.reduce((acc, s) => acc.split(s).join(''), t)

// ★ WIDENED 2026-09-21. This held ONE pattern (the Mapbox JWT), on the reasoning that public/
// is a tree we GENERATE, so the only realistic leak is the token the build itself writes.
// THAT REASONING WAS WRONG: 855 files under public/ are TRACKED, 95 of them text — boundaries,
// people-group data, brand assets, leaf pages — hand-curated and committed by a human. A
// hand-committed file is exactly where a pasted credential lands, and this tree is rsynced to a
// PUBLIC catalog. Measured before fixing: a planted `ghp_…` PAT and an `AKIA…` AWS key both
// passed as "clean — 0 findings".
// Each entry identifies a KNOWN credential FORMAT rather than guessing from entropy: an
// entropy rule over this tree would fire on every SRI hash and base64 image and be ignored.
// ★ pk. IS DELIBERATELY NOT HERE (ruled 2026-09-21): every map may use the pk from the API, and a
// host that wants to set a Mapbox sk can. A Mapbox `pk.` is a PUBLIC key: it
// is designed to ship in client code and is protected by URL RESTRICTIONS, not by secrecy
// (measured: the same pk. serves tiles 200 with a doxa.life Referer and 403s with the live test host's Referer).
// Flagging it made the token ladder's rung-3 baked token UNBUILDABLE — this gate runs inside
// build:unlocked, so `pk.` in public/ failed the build that is supposed to produce it.
// `sk.` (SECRET key) and `tk.` (temporary) stay flagged: those are real credentials.
const SECRET = [
  [/\b(sk|tk)\.eyJ[A-Za-z0-9_-]{20,}/, 'JWT-shaped Mapbox SECRET/temporary token (sk./tk.)'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub personal-access token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access-key id'],
  [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private-key block'],
  [/\bBearer\s+[A-Za-z0-9_\-.]{30,}/, 'literal Bearer token'],
  // NOTE the trailing /i — JavaScript has no inline (?i:…) group (that is Python/PCRE);
  // written that way it throws "Invalid regular expression" and takes the whole gate down.
  [/coolify[^\n]{0,40}?[=:]\s*["']?[A-Za-z0-9_-]{32,}/i, 'Coolify API token'],
]
for (const f of files) {
  const ext = extname(f.rel).toLowerCase(), base = f.rel.split('/').pop()
  if (base === '.env' || /^\.env\./.test(base)) hit(findings, 'secrets', f.rel, '.env file')
  // ★ EXTENSIONLESS `token` COUNTS TOO — the map client requests /api/maps/token (never .json),
  // so write-token.mjs emits BOTH paths. The old rule required a .js/.json suffix and so MISSED
  // the bare file entirely: the gate flagged token.json while the same secret sat beside it,
  // unflagged, under a name the consumer actually fetches. Measured 2026-09-20.
  if (/^token(\.local)?(\.js(on)?)?$/.test(base)) hit(findings, 'secrets', f.rel, 'token file')
  if (ext === '.map') hit(findings, 'debug', f.rel, 'source map file')
  // NOTE: 'docs' here is the FINDING-CATEGORY name documented in this file's header, not a
  // folder path. It deliberately did NOT change when docs/ was renamed to documentation/.
  // The ONE exception is public/README.md: the build generates it (generate-tree publicReadme) to explain
  // the folder, per the decision BUILD-OUTPUT-IS-ONE-FOLDER (only the output folder + a short
  // README.md). A doc anywhere else — inside the tree included — is still a finding.
  if ((ext === '.md' || ext === '.markdown' || ext === '.txt') && f.rel !== 'README.md') hit(findings, 'docs', f.rel, 'documentation in a served folder')
  const isText = TEXT_EXT.has(ext) || TEXT_EXT.has(base)
  if (!isText || f.size > 40 * 1024 * 1024) continue
  const t = readFileSync(f.abs, 'utf8')
  for (const [re, why] of LEAK) if (re.test(t)) hit(findings, 'leaks', f.rel, why)
  const tNoPrayer = PRAYER_ALLOWED.length && /persecution/.test(t) ? withoutPrayer(t) : t
  for (const [re, why] of LEAK_STRICT) if (re.test(re.source.includes('persecution') ? tNoPrayer : t) && !/\.csv$/.test(f.rel)) hit(STRICT ? findings : warnings, 'leaks', f.rel, why)
  // ★ P2 (2026-09-24): a credential is a DOCUMENT, not a string. Every JWT-shaped value gets
  // its payload DECODED and its claims reviewed: 'it is a public token' is not sufficient —
  // the pk. accepted by the 2026-09-21 ruling turned out to carry a `u` claim naming a real,
  // searchable ACCOUNT in base64 anyone can decode. The ruling covered the token's scope,
  // not the identity inside it. Flag any claim value that looks like a meaningful name.
  for (const m of t.matchAll(/\b(?:pk|sk|tk)\.(eyJ[A-Za-z0-9_-]{8,})/g)) {
    try {
      const pad = m[1] + '='.repeat((4 - (m[1].length % 4)) % 4)
      const claims = JSON.parse(Buffer.from(pad, 'base64').toString('utf8'))
      for (const [k, v] of Object.entries(claims)) {
        if (typeof v === 'string' && /^[a-z][a-z0-9_-]{3,}$/i.test(v) && !/^[0-9a-f]+$/i.test(v)) {
          hit(STRICT ? findings : warnings, 'secrets', f.rel, `JWT claim "${k}" carries a name-like value (${v.length} chars) — decode + review before publishing`)
          break
        }
      }
    } catch { /* not decodable — not a JWT payload */ }
  }
  for (const [re, why] of SECRET) if (re.test(t)) hit(findings, 'secrets', f.rel, why)
  if (/sourceMappingURL=/.test(t)) hit(warnings, 'debug', f.rel, 'sourceMappingURL comment (map file absent → harmless, but points at a missing map)')
  if (ext === '.js' && /console\.(log|debug)\(/.test(t)) hit(warnings, 'debug', f.rel, 'console.log/debug in a shipped bundle')
}
// working notes in data: a JSON under assets/ whose top-level "meta" carries a key named like a
// to-do or an internal rule, or a value that quotes one. Provenance ships; notes do not.
const META_KEY = /unchecked|blocked|todo|hard_limit|the_boundary|robots|never/i
const META_VALUE = [[/Brief:/, '"Brief:"'], [/\bnot yet\b/i, '"not yet"'], [/\bTODO\b/, '"TODO"'], [/NEVER-DO/, '"NEVER-DO"']]
for (const f of files) {
  if (!f.rel.startsWith('assets/') || extname(f.rel).toLowerCase() !== '.json' || f.size > 40 * 1024 * 1024) continue
  let doc; try { doc = JSON.parse(readFileSync(f.abs, 'utf8')) } catch { continue }
  const meta = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.meta : null
  if (!meta || typeof meta !== 'object') continue
  const notes = new Set()
  ;(function scan(node, path) {
    if (Array.isArray(node)) { node.forEach((v, i) => scan(v, `${path}[${i}]`)); return }
    if (node && typeof node === 'object') { for (const [k, v] of Object.entries(node)) { const p = `${path}.${k}`; if (META_KEY.test(k)) notes.add(`key ${p} reads as a working note`); scan(v, p) }; return }
    if (typeof node === 'string') for (const [re, why] of META_VALUE) if (re.test(node)) notes.add(`${path} contains ${why}`)
  })(meta, 'meta')
  for (const d of notes) hit(STRICT ? findings : warnings, 'meta', f.rel, d)
}
// staging surfaces: <tree>/index.html and <tree>/<bundle>/index.html (leaf pages are deeper)
// <tree>/index.html is NOT a staging page any more: it is the Plugin Studio, the output's front page
// (decision BUILD-PLUGIN-STUDIO-IS-THE-OUTPUT-FRONT-PAGE). A <tree>/<bundle>/index.html chooser still would be.
const staging = files.filter(f => /^[^/]+\/[^/]+\/index\.html$/.test(f.rel) && f.rel.startsWith(`${TREE}/`)).map(f => f.rel)
for (const s of staging) hit(STRICT ? findings : warnings, 'staging', s, 'preview/staging page (internal surface) — exclude from a public mirror or accept knowingly')
// The drop-in contract: only the entries vite.doxa-maps-build-config.json `dropin.include` declares
// may sit at the root. Strict = every other root entry is a finding; otherwise a warning.
//
// ★ READ FROM THE CONFIG, DO NOT RESTATE IT. This was a hardcoded
// `new Set(['index.html', 'assets', TREE])` while its own comment said "the same three entries
// dropin.include declares" — two copies of one fact with nothing forcing agreement, which is how
// this repo has been bitten before (a doc that QUOTES package.json drifted twice; one capability
// number lived in a gate and the README and disagreed). Adding __gallery/ to the config in 2026-09
// would have left this gate failing the build on a directory the contract explicitly allows.
// The literal is kept only as the fallback for an unreadable config, so the gate still works
// standalone rather than crashing.
const CONTRACT = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
    const inc = cfg?.dropin?.include
    // The output folder is always part of the contract (it is the product); include lists the extras.
    if (Array.isArray(inc)) return new Set([TREE, ...inc])
  } catch { /* fall through */ }
  return new Set(['README.md', TREE])
})()
const rootEntries = [...new Set(files.map(f => f.rel.split('/')[0]))].sort()
for (const e of rootEntries) {
  if (CONTRACT.has(e)) continue
  const label = files.some(f => f.rel.startsWith(`${e}/`)) ? `${e}/` : e
  // ALWAYS a finding, not a strict-mode warning: public/ holding ONLY the output folder + README.md is a
  // product decision (BUILD-OUTPUT-IS-ONE-FOLDER), not a style preference. MEASURED 2026-09-25: a rebuild
  // under the OLD tree name re-added public/doxa-maps/ beside public/dx-maps/, and this gate only warned.
  hit(findings, 'contract', label, `outside the drop-in contract (${[...CONTRACT].join(', ')} only)`)
}

// inventory
const inv = {
  dir: DIR, files: files.length, totalMB: +(files.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(1),
  bundles: files.filter(f => f.rel.startsWith(`${TREE}/`) && f.rel.endsWith('.js')).length,
  leafPages: files.filter(f => /^[^/]+\/[^/]+\/[^/]+(\/[^/]+)?\/index\.html$/.test(f.rel) && f.rel.startsWith(`${TREE}/`)).length,
  stagingPages: staging.length,
  assetsMB: Object.fromEntries([...new Set(files.filter(f => f.rel.startsWith('assets/')).map(f => f.rel.split('/')[1]))].map(k => [k, +(files.filter(f => f.rel.startsWith(`assets/${k}/`)).reduce((n, f) => n + f.size, 0) / 1048576).toFixed(1)])),
}
const fmt = x => `${x.rule.padEnd(8)} ${x.file}${x.detail ? ' — ' + x.detail : ''}`
console.log(`[hygiene] ${DIR}\n[hygiene] ${inv.files} files · ${inv.totalMB} MB · bundles ${inv.bundles} · leaf pages ${inv.leafPages} · staging pages ${inv.stagingPages} · assets MB ${JSON.stringify(inv.assetsMB)}`)
if (findings.length) { console.log(`\nFINDINGS (${findings.length}):`); findings.forEach(x => console.log('  ✗ ' + fmt(x))) }
if (warnings.length) { console.log(`\nWARNINGS (${warnings.length})${STRICT ? ' — strict: counted as findings' : ''}:`); warnings.slice(0, 20).forEach(x => console.log('  ! ' + fmt(x))); if (warnings.length > 20) console.log(`  … +${warnings.length - 20} more`) }
console.log(`\n[hygiene] ${findings.length ? 'NOT CLEAN' : 'clean'} — ${findings.length} finding(s), ${warnings.length} warning(s)`)
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ inventory: inv, findings, warnings, strict: STRICT }, null, 2))
process.exit(findings.length ? 1 : 0)
