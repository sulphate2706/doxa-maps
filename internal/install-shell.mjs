#!/usr/bin/env node
/**
 * install-shell.mjs — install the app wrapper as the CDN root's entry point.
 *
 * WHY THIS EXISTS
 * `public/` is the single SERVED SURFACE (the CDN web-root). The bundler writes
 * bundles to `public/<name>/…`, but a web-root also needs an `index.html` at its
 * TOP level, for two independent reasons:
 *   1. Railway/CDN — visiting the site root should land on the app, not a 404 or
 *      a directory listing.
 *   2. Capacitor — `cap copy` HARD-FAILS with "The web assets directory (./public)
 *      must contain an index.html file" because that file is the app's entry point.
 *      (This is exactly how we found the gap.)
 *
 * WHAT IT DOES
 * Copies the chosen wrapper from `layouts/<wrapper>/` to the root of `public/`,
 * so `public/index.html` is the app shell and `public/<name>/…` are the bundles
 * it mounts. One served tree, two roles.
 *
 * WHY COPY RATHER THAN SYMLINK
 * `cap copy` and static hosts follow real files predictably; a symlink into a
 * sibling directory is fragile across Railway's build, Gradle's asset packaging,
 * and `file://`. Copying keeps the served tree self-describing.
 *
 * TOKEN SAFETY
 * `token.local.js` is gitignored and LOCAL-ONLY. It is copied for local staging
 * (so the map works on your laptop) but MUST NOT ship in a release build — the
 * production token comes from `tokenUrl` at runtime. Pass --no-token to omit it.
 *
 * Usage:  node internal/install-shell.mjs [wrapper] [--no-token]
 *         default wrapper: app-wrapper-material
 */
import { cpSync, existsSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const noToken = args.includes('--no-token')
const wrapper = args.find(a => !a.startsWith('--')) || 'app-wrapper-material'

const src = join(ROOT, 'library', 'layouts', wrapper)
const dst = join(ROOT, 'public')

if (!existsSync(src)) {
  console.error(`[install-shell] FAIL — no such wrapper: layouts/${wrapper}`)
  console.error(`[install-shell] available: ${readdirSync(join(ROOT, 'library', 'layouts')).filter(f => !f.endsWith('.md')).join(', ')}`)
  process.exit(1)
}
if (!existsSync(join(src, 'index.html'))) {
  console.error(`[install-shell] FAIL — layouts/${wrapper}/index.html is missing; a wrapper must have an entry point.`)
  process.exit(1)
}

// Copy every wrapper file to the served root, skipping things that must not ship.
// NOTE: profiles/ and js/ inside the wrapper were dev-time copies of built bundles;
// the real bundles now live at public/<name>/, so those are skipped to avoid
// shipping (and silently staling) a second copy.
// token.local.js is NEVER installed: the shell no longer references it, and a
// credential in the served web-root is the exact failure this repo kept hitting.
const SKIP = new Set(['profiles', 'js', 'token.local.js'])

for (const entry of readdirSync(src)) {
  if (SKIP.has(entry)) continue
  cpSync(join(src, entry), join(dst, entry), { recursive: true })
}

// ⭐ NESTED LAYOUTS. The wrapper is copied to the ROOT of public/, but it imports
// sibling layouts by relative path (e.g. `../pane-wrapper/pane-wrapper.js`). From
// public/index.html that `../` ESCAPES THE WEB ROOT — the module 404s and the whole
// shell dies with a bare "Failed to resolve module specifier". So every layout the
// wrapper imports must be copied INTO public/ at the same relative depth.
// Detected from the source rather than hardcoded, so adding a nested layout needs
// no edit here.
const shellSrc = readFileSync(join(src, 'index.html'), 'utf8')
const nested = [...shellSrc.matchAll(/from\s+['"]\.\.\/([A-Za-z0-9._-]+)\//g)].map(m => m[1])
for (const layout of new Set(nested)) {
  const from = join(ROOT, 'library', 'layouts', layout)
  if (!existsSync(from)) {
    console.error(`[install-shell] FAIL — index.html imports ../${layout}/ but library/layouts/${layout} does not exist.`)
    process.exit(1)
  }
  cpSync(from, join(dst, layout), { recursive: true })
  console.log(`[install-shell] nested layout: layouts/${layout} → public/${layout}/`)
}

// SUBPATH-PORTABLE imports: `../<layout>/` resolves only at the web-root (../ cannot escape
// root); served under a subpath (e.g. as a host-platform plugin at /plugin-assets/doxa-maps-spa/)
// it 404s. The layouts are copied as SIBLINGS of index.html, so `./<layout>/` is correct at
// EVERY depth. Rewrite the copied entry so the shell works both at root and under any subpath.
{
  let entrySrc = readFileSync(join(dst, 'index.html'), 'utf8')
  for (const layout of new Set(nested)) entrySrc = entrySrc.split(`../${layout}/`).join(`./${layout}/`)
  writeFileSync(join(dst, 'index.html'), entrySrc)
}

// ⭐ The wrapper is copied to the ROOT of public/, but generate-tree then fans the
// tree out into public/<name>/<bundle>/ — and in an earlier build order those
// wrapper files got picked up and duplicated INTO every bundle folder. That put
// SIX copies of token.local.js under public/ (gitignored, so never committed, but
// they WOULD have shipped inside the APK). Sweep any that exist so a stale layout
// can never re-introduce them.
for (const leaked of ['token.local.js', 'nav.js', 'icons.js', 'languages.js']) {
  for (const bundleDir of readdirSync(dst, { withFileTypes: true })) {
    if (!bundleDir.isDirectory() || bundleDir.name === 'assets') continue
    for (const sub of readdirSync(join(dst, bundleDir.name), { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const f = join(dst, bundleDir.name, sub.name, leaked)
      if (existsSync(f)) { rmSync(f, { force: true }); console.log(`[install-shell] swept stray ${bundleDir.name}/${sub.name}/${leaked}`) }
    }
    const f2 = join(dst, bundleDir.name, leaked)
    if (existsSync(f2)) { rmSync(f2, { force: true }); console.log(`[install-shell] swept stray ${bundleDir.name}/${leaked}`) }
  }
}

// A stale duplicate bundle tree inside public/ would shadow the real one.
for (const stale of ['profiles', 'js']) {
  const p = join(dst, stale)
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log(`[install-shell] removed stale public/${stale}/`) }
}

console.log(`[install-shell] ${wrapper} → public/  (entry: public/index.html${noToken ? ', token omitted' : ''})`)
