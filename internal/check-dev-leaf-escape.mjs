#!/usr/bin/env node
/**
 * check-dev-leaf-escape.mjs — a dev leaf URL cannot write markup into the page it opens.
 *
 * THE DEFECT. The dev server's leaf route, /__leaf/<bundle>/<profile>[/<instance>] (and a production embed URL,
 * <bundle>/<profile>[/<instance>]/index.html, rewritten onto it), writes the URL's parts into the page it serves: the
 * <title> and the element's profile-config='…' attribute. It refused only `..` and `/`, so a quote or a tag in the path
 * was written raw, and a crafted link broke out of the attribute on a publicly reachable dev server.
 * internal/plugin-gallery/dev-plugin.mjs now refuses any part outside LEAF_PART (the shape every bundle folder, profile
 * id and instance id has) before either sink, and escapes the <title> as well.
 *
 * The plugin's own middleware answers each request (no server, no browser):
 *   A. every leaf the dev manifest advertises (galleryModel), as /__leaf/… AND as its production embed URL → 200 with
 *      its element: the rule refuses no real page;
 *   B. a hostile part (a quote, a double quote, a tag, an ampersand, a space, a backtick, an encoded slash or
 *      backslash, `..`, `.`, an attribute break-out) in each position, both URL forms → refused here (400) or left to
 *      Vite, never a page;
 *   C. escHtml leaves none of & < > " ' raw;
 *   D. with the part rule set back to the old one (`..` and `/` only), a tag in the profile still reaches the <title>
 *      escaped: the title has its own escaping, not only the rule in front of it.
 * Response bodies are never printed: a leaf page carries the build config's token.
 * `--self-test`: the old guard, a rule too strict for a real profile, an unescaped <title> and an escHtml that misses
 * the quote must each FAIL.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { discoverSpaRegistry } from './plugin-gallery/discover.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, 'plugin-gallery/dev-plugin.mjs')
const SRC = readFileSync(PLUGIN, 'utf8')
const GUARD = 'parts.some(s => !LEAF_PART.test(s))'
const OLD_GUARD = "parts.some(s => !s || s.includes('..') || s.includes('/'))"
const RULE = 'export const LEAF_PART = /^[A-Za-z0-9][\\w-]{0,63}$/'
const TITLE = '${escHtml(bundle)} · ${escHtml(profile)}'
const ESC_CLASS = `/[&<>"']/g`

// A copy of the plugin, altered or not, imported from beside the original so its relative imports resolve; the
// file is removed as soon as it is loaded.
let seq = 0
async function load(src) {
  if (src === SRC) return import(pathToFileURL(PLUGIN).href)
  const tmp = join(HERE, 'plugin-gallery', `.tmp-check-dev-leaf-escape-${process.pid}-${++seq}.mjs`)
  writeFileSync(tmp, src)
  try { return await import(pathToFileURL(tmp).href) } finally { rmSync(tmp, { force: true }) }
}

// The plugin's middleware, answering one GET: { status, body } ('next' = not answered here, Vite would).
function client(mod) {
  let mw = null
  mod.autoSpaDevPlugin('').configureServer({ middlewares: { use: (f) => { if (!mw) mw = f } } })
  return (url) => new Promise((done) => {
    const res = { statusCode: 200, setHeader() {}, end: (b) => done({ status: res.statusCode, body: String(b ?? '') }) }
    try { mw({ url, method: 'GET', headers: {} }, res, () => done({ status: 'next', body: '' })) }
    catch (e) { done({ status: 'threw', body: String(e && e.message) }) }
  })
}

// Every /__leaf/ URL the dev manifest advertises, with the tag its page must mount.
function advertised(mod) {
  const out = []
  const walk = (o, tag) => {
    if (!o || typeof o !== 'object') return
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && v.startsWith('/__leaf/')) out.push({ url: v.split(/[?#]/)[0], tag })
      else walk(v, tag)
    }
  }
  for (const b of mod.galleryModel(discoverSpaRegistry()).bundles) walk(b, (b.elements || [])[0])
  return [...new Map(out.map((x) => [x.url, x])).values()]
}

const HOSTILE = ["a'b", 'a"b', 'a<b', 'a>b', 'a&b', 'a b', 'a`b', 'a/b', 'a\\b', '..', '.', "x'><img src=x onerror=alert(1)>"]

async function audit(src) {
  const f = []
  let mod
  try { mod = await load(src) } catch (e) { return [`load: the plugin does not import (${e.message})`] }
  const get = client(mod)
  const leaves = advertised(mod)
  if (leaves.length < 20) f.push(`A: only ${leaves.length} advertised leaves found (the manifest walk is broken)`)
  for (const { url, tag } of leaves) {
    for (const u of [url, url.replace('/__leaf/', '/') + '/index.html']) {
      const r = await get(u)
      if (r.status !== 200 || !r.body.includes(`<${tag} `)) f.push(`A: ${u} → ${r.status}${r.status === 200 ? `, no <${tag}>` : ''} (a real page refused)`)
    }
  }
  const [b0, p0] = (leaves[0] ? leaves[0].url : '/__leaf/x/x').slice('/__leaf/'.length).split('/')
  for (const h of HOSTILE) {
    const e = encodeURIComponent(h)
    for (const parts of [[e, p0], [b0, e], [b0, p0, e]]) {
      const leaf = '/__leaf/' + parts.join('/')
      const r = await get(leaf)
      if (r.status !== 400) f.push(`B: ${leaf} → ${r.status} (want 400)`)
      const embed = '/' + parts.join('/') + '/index.html'
      const r2 = await get(embed)
      if (r2.status !== 400 && r2.status !== 'next') f.push(`B: ${embed} → ${r2.status} (want 400, or left to Vite)`)
    }
  }
  const esc = mod.escHtml ? mod.escHtml(`&<>"'`) : null
  if (esc !== '&amp;&lt;&gt;&quot;&#39;') f.push(`C: escHtml(& < > " ') = ${JSON.stringify(esc)}`)
  if (!src.includes(GUARD)) f.push('D: the leaf guard is not the LEAF_PART rule, so the title cannot be tested behind the old one')
  else {
    let loose
    try { loose = await load(src.replace(GUARD, OLD_GUARD)) } catch (e) { f.push(`D: ${e.message}`) }
    if (loose) {
      const r = await client(loose)(`/__leaf/${b0}/${encodeURIComponent('<b>x')}`)
      const title = (/<title>([^]*?)<\/title>/.exec(r.body) || [])[1]
      if (r.status !== 200 || title === undefined) f.push(`D: behind the old rule the page did not render (${r.status})`)
      else if (title.includes('<b>') || !title.includes('&lt;b&gt;')) f.push('D: behind the old rule a tag in the profile reached the <title> raw')
    }
  }
  return f
}

if (process.argv.includes('--self-test')) {
  const poisons = [
    ['the old guard (`..` and `/` only)', SRC.replace(GUARD, OLD_GUARD), /^B: /],
    ['a rule too strict for a real profile', SRC.replace(RULE, 'export const LEAF_PART = /^[a-z]{1,63}$/'), /^A: /],
    ['an unescaped <title>', SRC.replace(TITLE, '${bundle} · ${profile}'), /^D: /],
    ['an escHtml that misses the quote', SRC.replace(ESC_CLASS, `/[&<>"]/g`), /^C: /],
  ]
  let missed = 0
  for (const [name, src, rx] of poisons) {
    if (src === SRC) { console.log(`✗ MISSED: ${name} (not planted: its source line was not found)`); missed++; continue }
    const f = await audit(src); const hit = f.find((x) => rx.test(x))
    console.log(hit ? `✓ caught: ${name} -> ${hit}` : `✗ MISSED: ${name}${f.length ? ` (failed instead: ${f[0]})` : ''}`)
    if (!hit) missed++
  }
  if (missed) process.exitCode = 1
} else {
  const f = await audit(SRC)
  if (f.length) { for (const x of f.slice(0, 40)) console.log('✗ ' + x); console.log(`FAIL check:dev-leaf-escape (${f.length})`); process.exitCode = 1 }
  else console.log(`PASS check:dev-leaf-escape — every advertised dev leaf is served in both URL forms; ${HOSTILE.length} hostile parts are refused in every position of both forms; the <title> escapes on its own`)
}
