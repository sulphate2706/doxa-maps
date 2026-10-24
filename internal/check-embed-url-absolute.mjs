#!/usr/bin/env node
/**
 * check-embed-url-absolute — a share/embed url must never be relative.
 *
 * THE DEFECT (2026-09-28, found testing live): the link copied from Simple Research was
 * `research-map-plus-grid/research-map-plus-grid/index.html` while the page was
 * `http://127.0.0.1:5192/#f=…`, a clear case of an embed that could not work.
 *
 * WHY IT SURVIVED SO LONG, and it is the reason this is a gate rather than a fix: a relative share link
 * WORKS WHEN CLICKED. The browser resolves it against the page you copied it from, so the person testing
 * sees it open correctly. It is the EMBED that breaks — an <iframe src="…"> on a partner's site resolves
 * against THEIR page — so the failure is invisible exactly where it is checked and visible only where it
 * ships. Nobody was careless; the test that a human naturally performs cannot see it.
 *
 * WHERE IT CAME FROM: resolveShareUrl's tier 1 returns its input VERBATIM, correctly, because a host
 * handing over a whole url has decided. Two composites BUILD a tier-1 url themselves and both wrote
 *     base ? base + '/' + leaf : leaf
 * so on any host where the tree root cannot be derived from the script url — a dev server, an ESM build,
 * a tree served from a path that does not match `<name>/<name>.js` — base is '' and the else branch
 * hands tier 1 a relative path.
 *
 * TWO ARMS: the behaviour (absoluteEmbedUrl really is absolute with NO base, which is the failing case),
 * and the shape (no plugin builds a share url with the `: leaf` fallback again).
 *
 * Exit 0 pass · 1 fail.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'EMBED-URL-ABSOLUTE'
const fails = []

// ── ARM A: the resolver, with the tree root UNKNOWN — the case the old code got wrong ────────────
// There is no document in node, so absoluteEmbedUrl cannot resolve against baseURI; a stand-in document
// is supplied so the browser path is the one under test rather than the SSR fallback.
globalThis.document = { baseURI: 'http://127.0.0.1:5192/' }
const { absoluteEmbedUrl, resolveShareUrl } = await import(resolve(ROOT, 'library/utils/embedBase.js'))
const LEAF = 'research-map-plus-grid/research-map-plus-grid/index.html'

const got = absoluteEmbedUrl(LEAF)
if (!/^https?:\/\//i.test(got)) {
  fails.push(`absoluteEmbedUrl returned a RELATIVE url with no tree root: "${got}".\n`
    + '      That is the exact value that was copied. It must resolve against the runtime origin.')
}
if (got !== 'http://127.0.0.1:5192/' + LEAF) {
  fails.push(`absoluteEmbedUrl did not resolve against the page origin: "${got}"`)
}
if (absoluteEmbedUrl('https://cdn.example.org/x/index.html') !== 'https://cdn.example.org/x/index.html') {
  fails.push('an already-absolute url must pass through unchanged')
}
if (absoluteEmbedUrl('') !== '') fails.push('an empty leaf must stay empty rather than becoming the page')
// A configured base still wins — the ladder is unchanged, this only replaces its last rung.
if (absoluteEmbedUrl(LEAF, { embedBaseUrl: 'https://cdn.example.org/maps' }) !== 'https://cdn.example.org/maps/' + LEAF) {
  fails.push('a host-supplied embedBaseUrl must still win over the runtime origin')
}
// And tier 1 must still return a WHOLE url verbatim — that contract is what makes the above necessary.
if (resolveShareUrl({ shareUrl: 'https://x.example/a' }) !== 'https://x.example/a') {
  fails.push('resolveShareUrl tier 1 no longer returns a whole url verbatim; this gate assumes it does')
}

// ── ARM B: nobody rebuilds the relative fallback ─────────────────────────────────────────────────
const PD = join(ROOT, 'plugin-designs')
for (const b of readdirSync(PD)) {
  const dir = join(PD, b)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.vue') || x.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    // `base ? base + '/' + leaf : leaf` in any spelling: a ternary whose ELSE hands back the bare path.
    if (/\bbase\s*\?\s*base\s*\+[^:]*:\s*(leaf|rel|path)\b/.test(src)) {
      fails.push(`${b}/${f} builds a share url that falls back to a RELATIVE path when no tree root\n`
        + '      resolves. Use absoluteEmbedUrl() — it resolves against the runtime origin instead.')
    }
  }
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — a share url resolves against the runtime origin when no tree root is known, a `
  + 'configured base still wins, and no plugin rebuilds the relative fallback.')
