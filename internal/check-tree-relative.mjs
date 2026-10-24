#!/usr/bin/env node
// check-tree-relative — the committed tree names no host of its own.
//
// ★ WHY. An absolute embed address works where it was built and breaks everywhere else. That
// is how the CDN route failed and was retired (2026-09-29): its absolute addresses worked on
// a laptop and broke in the cloud. The build config's embedBaseUrl is "" on purpose, so the
// committed tree is relative and a deploy makes it absolute at build time (EMBED_BASE_URL,
// read by generate-tree). But a tree built with EMBED_BASE_URL set looks like any other tree,
// and check:drop cannot see the difference: it looks for root-relative "/..." references and
// deliberately skips https:// ones. Committing such a tree would pin every snippet to one host.
//
// With embedBaseUrl empty in the build config, the manifest must say embedBase "." and every
// address a page or a partner loads the tree from must be relative: each bundle's and profile's
// scriptUrl and iframeUrl, and the src of each copy-paste embed snippet. Data addresses
// (runtime.apiBaseUrl, instance props) are not the tree and are not checked. With embedBaseUrl
// set in the config, absolute addresses are intended: SKIP.
//
// Usage: node internal/check-tree-relative.mjs [manifest.json]   (default: the built tree's)
// Static: reads files, starts nothing. Exit 0 pass or skip, 1 fail.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME, BUILD_CONFIG_FILE } from './_tree-name.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(BUILD_CONFIG_FILE, 'utf8'))
const configured = typeof cfg.embedBaseUrl === 'string' ? cfg.embedBaseUrl.trim() : ''
if (configured) {
  console.log(`TREE-RELATIVE: SKIP — the build config sets embedBaseUrl (${configured}), so absolute embed addresses are intended`)
  process.exit(0)
}

const file = process.argv[2] ? resolve(process.argv[2]) : join(REPO, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(file)) {
  console.error(`TREE-RELATIVE: FAIL — no manifest at ${file} (build the tree first)`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(file, 'utf8'))

const absolute = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')
const srcs = (html) => [...String(html || '').matchAll(/\bsrc="([^"]*)"/g)].map((m) => m[1])
const fails = []
let checked = 0
const check = (where, url) => {
  if (typeof url !== 'string' || !url) return
  checked += 1
  if (absolute(url)) fails.push(`${where}: ${url}`)
}

if (manifest.embedBase !== '.' && manifest.embedBase !== '') fails.push(`embedBase: ${JSON.stringify(manifest.embedBase)}`)
for (const b of manifest.bundles || []) {
  check(`${b.bundle} scriptUrl`, b.scriptUrl)
  for (const p of b.profiles || []) {
    const at = `${b.bundle}/${p.profile}`
    check(`${at} scriptUrl`, p.scriptUrl)
    check(`${at} iframeUrl`, p.iframeUrl)
    for (const s of srcs(p.embed?.script)) check(`${at} script snippet src`, s)
    for (const s of srcs(p.embed?.iframe)) check(`${at} iframe snippet src`, s)
  }
}

// Refuse to pass vacuously: a manifest with no addresses means the walk or the shape is wrong.
if (checked === 0) fails.push('no embed addresses found in the manifest: the check read nothing')

if (fails.length) {
  console.error(`TREE-RELATIVE: FAIL — ${fails.length} problem(s) in ${file}`)
  for (const f of fails.slice(0, 20)) console.error(`  ✗ ${f}`)
  if (fails.length > 20) console.error(`  … and ${fails.length - 20} more`)
  console.error('  A tree built with EMBED_BASE_URL is for a deploy, not a commit: rebuild it without EMBED_BASE_URL.')
  process.exit(1)
}
console.log(`TREE-RELATIVE: PASS — embedBase "${manifest.embedBase}" and ${checked} embed addresses, all relative`)
