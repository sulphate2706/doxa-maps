#!/usr/bin/env node
/**
 * sync-dropin.mjs — mirror the built web-root (public/) into a HOST checkout as a "drop-in".
 *
 * WHY: the website (doxa-life) consumes this bundler's output as generated files: the tree folder
 * (dx-maps/) dropped straight into its public/, so one server serves the site and the maps. Hand-
 * editing there is forbidden — the ONLY way a map changes
 * on the site is: change the bundler → `bun run build` → sync. This is that one honest step,
 * so it is a script and not a remembered rsync incantation.
 *
 * WHAT IT DOES: mirrors <from> (default public/) → <dest>: adds/updates every file, deletes
 * files that no longer exist in the source. EXCEPT:
 *   · credentials are NEVER copied — api/maps/token.json and token.local.js (the site serves
 *     its own /api/maps/token; the leaf pages' token ladder falls through to it);
 *   · documentation is NEVER copied — *.md / *.markdown / *.txt: the served folder is product,
 *     the README and docs stay private with the bundler (a stray doc already in <dest> is
 *     removed like any other stale file);
 *   · staging/preview pages are NEVER copied — <tree>/index.html and <tree>/<bundle>/index.html
 *     are internal surfaces; partners embed the LEAF pages one level deeper (--keep-staging to
 *     opt back in);
 *   · host-owned files can be PROTECTED with --protect (none by default) — never overwritten,
 *     never deleted;
 *   · built data that no page fetches is NOT shipped — "dropin.exclude" in the build-config (path
 *     prefixes relative to public/, inside the allowlist; internal scripts still read them here).
 *     Honoured with --from-config; counted as "excluded (not shipped)"; a copy already in <dest>
 *     is removed like any other stale file.
 *
 * THE DROP-IN CONTRACT (allowlist): a host does not need the whole web-root. The website takes
 * ONLY the bundles it embeds, declared ONCE in vite.doxa-maps-build-config.json under
 * "dropin.include" — path prefixes relative to public/ (a folder, or a single file such as
 * doxa-maps/manifest.json) — and nothing at the drop-in root.
 *   --from-config   take the allowlist from that build-config (fails if it declares none);
 *   --only a,b      pass an allowlist explicitly (wins over --from-config);
 *   --prune         also delete destination files OUTSIDE the allowlist (an older full mirror:
 *                   the shell, assets/, headers …) so the drop-in ends up exactly the contract.
 *                   --protect is still honoured and nothing outside <dest> is ever touched.
 * Without an allowlist the tool is the plain full mirror it always was; --prune then has no
 * effect. Files in <dest> outside the allowlist are left alone unless --prune is given.
 * Refuses to CREATE <dest>: the drop-in folder is the host's decision, not this script's.
 * Gate: `node internal/public-hygiene-check.mjs <dest> --strict` must pass before a public push.
 *
 * Usage:  node internal/sync-dropin.mjs <dest> [--from public] [--tree doxa-maps] [--keep-staging] [--if-present]
 *           [--only a,b | --from-config] [--prune] [--protect a.txt,other] [--dry-run]
 *   e.g.  bun run dropin      (= --from-config, into dropin.dest: ../doxa-life/public)
 * Prints: copied · unchanged · deleted (stale inside the allowlist) · pruned (outside it) ·
 *         excluded (credentials/docs/staging) · excluded (not shipped: dropin.exclude), then the
 *         destination's top-level tree after the sync.
 * Exit:   0 synced (or dry-run printed) · 1 bad arguments / dest missing / no allowlist in config
 * Review the result with `git -C <host> status` — the host repo is the restore point.
 */
import { readdirSync, statSync, lstatSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve, dirname, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'vite.doxa-maps-build-config.json')
const norm = p => p.split(sep).join('/')
const args = process.argv.slice(2)
const VALUE_FLAGS = new Set(['--from', '--tree', '--protect', '--only'])
const argOf = (k, d) => { const i = args.indexOf(k); const v = args[i + 1]; return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d }
// Destination: positional <dest> · else DOXA_DROPIN_DEST · else "dropin.dest" in the build-config
// (the ONE place the host folder is declared; moving the drop-in = changing that line).
// A config that EXISTS but does not parse is recorded, never swallowed: with --if-present a silent null would read
// as "no destination configured" and a green build would never refresh the site.
let configBroken = ''
const configDest = (() => { try { const d = JSON.parse(readFileSync(CONFIG, 'utf8')).dropin?.dest; return typeof d === 'string' && d.trim() ? resolve(ROOT, d.trim()) : null } catch (e) { if (existsSync(CONFIG)) configBroken = e.message; return null } })()
const DEST = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) || process.env.DOXA_DROPIN_DEST || configDest
const FROM = resolve(ROOT, argOf('--from', 'public'))
const DRY = args.includes('--dry-run')
const PRUNE = args.includes('--prune')
const PROTECT = new Set(String(argOf('--protect', '')).split(',').map(s => s.trim()).filter(Boolean))
// Never ship a credential into a host repo — these are gitignored here for the same reason.
const EXCLUDE = new Set(['api/maps/token.json', 'token.local.js'])
// Never ship documentation into a served folder: the README/story stays private with the bundler.
const isDoc = (f) => /\.(md|markdown|txt)$/i.test(f)
// Staging/preview pages are INTERNAL surfaces: <tree>/index.html and <tree>/<bundle>/index.html
// (the leaf pages partners embed live one level deeper). A public mirror carries bundles, leaf
// pages and the data they fetch — not previews. --keep-staging opts back in.
const TREE = String(argOf('--tree', TREE_NAME)).replace(/\/+$/, '')
const KEEP_STAGING = args.includes('--keep-staging')
const isStaging = (f) => !KEEP_STAGING && (f === `${TREE}/index.html` || new RegExp(`^${TREE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/index\\.html$`).test(f))
// Built data nothing shipped fetches: "dropin.exclude" in the build-config (read with --from-config,
// below) — path prefixes relative to public/. Internal scripts still read them in this repo.
let NOT_SHIPPED = []
const isNotShipped = (f) => NOT_SHIPPED.some(p => f === p || f.startsWith(p + '/'))
const excludedInternal = (f) => EXCLUDE.has(f) || isDoc(f) || isStaging(f)
const excluded = (f) => excludedInternal(f) || isNotShipped(f)

const usage = 'usage: node internal/sync-dropin.mjs [<dest>] [--from public] [--only a,b | --from-config] [--prune] [--protect a,b] [--dry-run]   (<dest> defaults to $DOXA_DROPIN_DEST, then dropin.dest in vite.doxa-maps-build-config.json)'
if (configBroken && (args.includes('--if-present') || args.includes('--from-config'))) {
  console.error(`[sync-dropin] build config unreadable: ${norm(relative(ROOT, CONFIG))}: ${configBroken}`)
  process.exit(1)
}
if (!DEST && args.includes('--if-present')) { console.log('[sync-dropin] skipped: no drop-in destination configured (dropin.dest)'); process.exit(0) }
if (!DEST) { console.error(`[sync-dropin] ${usage}`); process.exit(1) }
const dest = resolve(DEST)
// ★ --prune INTO A SITE'S WEB-ROOT WOULD DELETE THE SITE. --prune removes every file in <dest> outside the
// allowlist, which was right while <dest> was a folder of its own (public/embed/doxa-maps-build). The
// one-server drop-in goes straight into the site's public/, so <dest> IS the site and everything outside
// dx-maps/ would go. Refuse it outright rather than trust that nobody types it.
if (PRUNE && basename(dest) === 'public') {
  console.error(`[sync-dropin] refusing --prune into ${dest}: it is a site's web-root, and --prune would delete every file of the site outside the drop-in. Sync without --prune (bun run dropin); stale files INSIDE the drop-in are still removed.`)
  process.exit(1)
}
// --if-present (the full build's last step): the configured host is OPTIONAL. Its absence is a skip, not an error.
// Only the ONE configured path is checked (dropin.dest, or DOXA_DROPIN_DEST): nothing on the filesystem is searched
// for other repos or sites. DOXA_DROPIN=off skips it even when the host is there.
if (args.includes('--if-present')) {
  if (process.env.DOXA_DROPIN === 'off') { console.log('[sync-dropin] skipped: DOXA_DROPIN=off'); process.exit(0) }
  if (!existsSync(dest) || !statSync(dest).isDirectory()) { console.log(`[sync-dropin] skipped: no host at the configured path ${dest}`); process.exit(0) }
}
if (!existsSync(dest) || !statSync(dest).isDirectory()) { console.error(`[sync-dropin] dest does not exist or is not a directory: ${dest} — create the drop-in folder in the host first`); process.exit(1) }
if (!existsSync(FROM)) { console.error(`[sync-dropin] source missing: ${FROM} — run \`bun run build\` first`); process.exit(1) }

// The allowlist: path prefixes relative to <from>. A prefix names a folder (everything under it)
// or one file. --only wins; --from-config reads "dropin.include" from the build-config.
const normPrefix = p => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
let ALLOW = null, ALLOW_FROM = ''
if (args.includes('--only')) {
  ALLOW = String(argOf('--only', '')).split(',').map(normPrefix).filter(Boolean)
  ALLOW_FROM = '--only'
} else if (args.includes('--from-config')) {
  let cfg
  try { cfg = JSON.parse(readFileSync(CONFIG, 'utf8')) } catch (e) { console.error(`[sync-dropin] cannot read ${CONFIG}: ${e.message}`); process.exit(1) }
  const inc = cfg?.dropin?.include
  if (!Array.isArray(inc) || !inc.length || !inc.every(s => typeof s === 'string')) { console.error(`[sync-dropin] --from-config: ${norm(relative(ROOT, CONFIG))} declares no "dropin": { "include": [ …path prefixes relative to public/… ] }`); process.exit(1) }
  // The OUTPUT FOLDER is always shipped: it is the product, and naming it here would put the tree's
  // name in a second place in the config (a rename must stay one line). include lists the EXTRAS.
  ALLOW = [TREE, ...inc.map((s) => s.replaceAll('{tree}', TREE))].map(normPrefix).filter(Boolean)
  ALLOW_FROM = `${norm(relative(ROOT, CONFIG))} · dropin.include`
  const exc = cfg?.dropin?.exclude
  if (exc !== undefined && (!Array.isArray(exc) || !exc.every(s => typeof s === 'string'))) { console.error(`[sync-dropin] --from-config: "dropin.exclude" must be an array of path prefixes relative to public/`); process.exit(1) }
  NOT_SHIPPED = (exc || []).map((s) => s.replaceAll('{tree}', TREE)).map(normPrefix).filter(Boolean)
  if (NOT_SHIPPED.some(p => p.split('/').includes('..'))) { console.error(`[sync-dropin] dropin.exclude climbs out of ${norm(relative(ROOT, FROM))}/: ${JSON.stringify(NOT_SHIPPED)}`); process.exit(1) }
}
if (ALLOW && (!ALLOW.length || ALLOW.some(p => p.split('/').includes('..')))) { console.error(`[sync-dropin] allowlist is empty or climbs out of ${norm(relative(ROOT, FROM))}/: ${JSON.stringify(ALLOW)}`); process.exit(1) }
const allowed = f => !ALLOW || ALLOW.some(p => f === p || f.startsWith(p + '/'))

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p)
    if (st.isDirectory()) walk(p, base, out); else out.push(norm(relative(base, p)))
  }
  return out
}
const sha = p => createHash('sha1').update(readFileSync(p)).digest('hex')
// A deletion only ever happens to a path that really lives under <dest> (a symlink that points
// elsewhere is refused, not followed).
const destReal = realpathSync(dest)
const insideDest = f => { try { return realpathSync(join(dest, f)).startsWith(destReal + sep) } catch { return false } }

const allSrc = walk(FROM)
const excludedCount = allSrc.filter(excludedInternal).length
const notShippedCount = allSrc.filter(f => !excludedInternal(f) && isNotShipped(f)).length
const src = allSrc.filter(f => !excluded(f) && allowed(f))
const outsideSrc = allSrc.length - excludedCount - notShippedCount - src.length   // built, but not part of the contract
const have = new Set(walk(dest))
const result = new Set()                                          // what <dest> holds after the sync
let copied = 0, unchanged = 0, deleted = 0, pruned = 0, kept = 0, protectedSkips = 0, refused = 0
for (const f of src) {
  if (PROTECT.has(f)) { protectedSkips++; if (have.has(f)) result.add(f); continue }
  const s = join(FROM, f), d = join(dest, f)
  result.add(f)
  if (have.has(f) && statSync(s).size === statSync(d).size && sha(s) === sha(d)) { unchanged++; continue }
  if (!DRY) { mkdirSync(dirname(d), { recursive: true }); copyFileSync(s, d) }
  copied++
}
const srcSet = new Set(src)
for (const f of have) {
  if (srcSet.has(f)) continue
  // stale = not in the source, not protected. Credentials and docs found in <dest> are stale too:
  // they must not sit in a served folder (a stray README, a token file).
  if (PROTECT.has(f)) { result.add(f); continue }
  if (!allowed(f) && !PRUNE) { kept++; result.add(f); continue }
  if (!insideDest(f)) { refused++; result.add(f); continue }
  if (!DRY) rmSync(join(dest, f))
  if (allowed(f)) deleted++; else pruned++
}
// prune directories emptied by deletions (deepest first; symlinked folders are never entered)
if (!DRY) {
  const dirs = []; (function collect(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (lstatSync(p).isDirectory()) { collect(p); dirs.push(p) } } })(dest)
  for (const d of dirs) if (readdirSync(d).length === 0) rmSync(d, { recursive: true })
}

// Top-level tree of the destination (two levels; deeper folders show a file count).
function renderTree(paths, depth = 2) {
  const root = {}
  for (const p of paths) { let n = root; for (const s of p.split('/')) n = (n[s] ??= {}) }
  const isDir = n => Object.keys(n).length > 0
  const count = n => Object.values(n).reduce((a, c) => a + (isDir(c) ? count(c) : 1), 0)
  const show = (n, indent, level) => {
    const names = Object.keys(n).sort((a, b) => (isDir(n[b]) ? 1 : 0) - (isDir(n[a]) ? 1 : 0) || a.localeCompare(b))
    for (const name of names) {
      if (!isDir(n[name])) { console.log(`${indent}${name}`); continue }
      console.log(`${indent}${name}/${level >= depth ? `  (${count(n[name])} files)` : ''}`)
      if (level < depth) show(n[name], indent + '  ', level + 1)
    }
  }
  if (!paths.length) console.log('  (empty)'); else show(root, '  ', 1)
}

console.log(`[sync-dropin] ${DRY ? 'DRY RUN — ' : ''}${norm(relative(ROOT, FROM))}/ → ${dest}`)
if (ALLOW) console.log(`[sync-dropin] allowlist (${ALLOW_FROM}): ${ALLOW.join(', ')} — ${PRUNE ? '--prune: everything else in the destination is removed' : 'no --prune: destination files outside it are left alone'}`)
else if (PRUNE) console.log('[sync-dropin] --prune has no effect without an allowlist (--only or --from-config) — full mirror as usual')
if (NOT_SHIPPED.length) console.log(`[sync-dropin] not shipped (dropin.exclude): ${NOT_SHIPPED.join(', ')}`)
console.log(`[sync-dropin] copied ${copied} · unchanged ${unchanged} · deleted ${deleted} · pruned ${pruned} · protected ${protectedSkips}${PROTECT.size ? ` (${[...PROTECT].join(', ')})` : ''} · excluded ${excludedCount} (credentials/docs/staging)${NOT_SHIPPED.length ? ` · excluded (not shipped) ${notShippedCount} (dropin.exclude)` : ''}${ALLOW ? ` · outside allowlist: ${outsideSrc} built file(s) not shipped${kept ? `, ${kept} destination file(s) left` : ''}` : ''}${refused ? ` · refused ${refused} (resolve outside the destination)` : ''}`)
console.log(`[sync-dropin] destination${DRY ? ' (as it would be)' : ''}: ${result.size} file(s)`)
renderTree([...result])
