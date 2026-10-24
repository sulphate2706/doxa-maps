/**
 * i18n-areas.mjs — which translation AREAS (library/i18n/locales/<lc>/<area>.json) a bundle can use.
 *
 * WHY (CRITIC-10, 2026-09-26): library/i18n/index.js globbed EVERY area into every bundle, so each of 19
 * bundles carried all 25 areas x 11 locales (~320 KB raw) — other plugins' strings included — and each new
 * area grew every bundle. The build now bundles only the areas this function returns.
 *
 * HOW, conservatively: walk the bundle's SOURCE import graph from plugin-designs/<bundle>/index.js
 * (relative and @map/ imports, dynamic import(), export-from, and import.meta.glob patterns), then keep an
 * area if its name appears in any reached file as a key prefix ('area.' in a string or template literal) or
 * as a bare string literal ('area', which covers keys assembled at runtime as `${area}.${key}`).
 * Runtime-fetched data carries no i18n keys (measured: no data/ JSON holds an "area.key" string), so the
 * source graph is the whole story. Over-inclusion costs bytes; omission would cost strings, so every rule
 * errs toward including. check:i18n-treeshake verifies the result against the BUILT bundle.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'

export function allAreas(root) {
  return readdirSync(join(root, 'library/i18n/locales/en')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
}

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const GLOB_RE = /import\.meta\.glob\s*\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g

function resolveFile(p) {
  for (const cand of [p, p + '.js', p + '.mjs', p + '.vue', p + '.json', join(p, 'index.js')]) {
    try { if (existsSync(cand) && statSync(cand).isFile()) return cand } catch { /* next */ }
  }
  return null
}

function expandGlob(pattern, fromDir) {
  // Only the shapes this repo uses: a directory part plus a file pattern with * (and optionally a * dir).
  const abs = resolve(fromDir, pattern)
  const parts = abs.split('/')
  const out = []
  const walk = (i, dir) => {
    if (i === parts.length) return
    const seg = parts[i]
    if (i === 0) return walk(1, '/')
    if (!seg.includes('*')) {
      const next = join(dir, seg)
      if (i === parts.length - 1) { if (existsSync(next)) out.push(next) } else walk(i + 1, next)
      return
    }
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) if (re.test(e)) {
      if (i === parts.length - 1) out.push(join(dir, e)); else walk(i + 1, join(dir, e))
    }
  }
  walk(0, '/')
  return out
}

/** Every source file reachable from the bundle's entry (library/i18n/locales excluded). */
export function bundleGraph(root, bundle) {
  const entry = join(root, 'plugin-designs', bundle, 'index.js')
  const seen = new Set()
  const queue = [entry]
  const LOCALES = join(root, 'library/i18n/locales')
  while (queue.length) {
    const f = queue.pop()
    if (!f || seen.has(f) || f.startsWith(LOCALES) || f.includes('/node_modules/')) continue
    seen.add(f)
    let src = ''
    try { src = readFileSync(f, 'utf8') } catch { continue }
    const dir = dirname(f)
    const add = (spec) => {
      if (!spec) return
      let p = null
      if (spec.startsWith('@map/')) p = join(root, 'library', spec.slice(5))
      else if (spec.startsWith('.') || spec.startsWith('/')) p = spec.startsWith('/') ? join(root, spec) : resolve(dir, spec)
      else return                                   // a package: carries none of our keys
      p = p.replace(/\?.*$/, '')
      const r = resolveFile(p)
      if (r) queue.push(r)
    }
    for (const m of src.matchAll(IMPORT_RE)) add(m[1] || m[2] || m[3])
    for (const m of src.matchAll(GLOB_RE)) {
      const pats = m[1].startsWith('[') ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : [m[1].slice(1, -1)]
      for (const pat of pats) {
        if (pat.startsWith('!')) continue
        const base = pat.startsWith('@map/') ? join(root, 'library') : dir
        for (const hit of expandGlob(pat.replace(/^@map\//, ''), base)) queue.push(hit)
      }
    }
  }
  return [...seen]
}

/** The areas a bundle needs, sorted. `extra` is always included (areas the i18n core itself reads). */
export function areasForBundle(root, bundle, { extra = [] } = {}) {
  const areas = allAreas(root)
  const files = bundleGraph(root, bundle)
  const text = files.map((f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }).join('\n')
  const used = new Set(extra)
  // ★ A BARE NAME COUNTS ONLY WHERE IT BUILDS A KEY. The first version kept an area wherever its name
  // appeared as ANY string literal, to cover keys assembled at runtime. But several area names are also
  // ordinary ids — 'gospel' is a colour strategy, a data source and a chart id; 'religion', 'regions',
  // 'detail', 'poster' are fields and modes — so every bundle importing those modules carried catalogues
  // it never shows: measured, 80 area inclusions across 26 bundles, and gospel's catalogue alone pushed
  // country-posters 9.5 KB over the 1.5 MB ceiling. The ways a bare name really does build a key here are
  // few and named: a namespace helper (useOptionalT / useOptionalI18n / qualify) or a translator reading a
  // whole area (tm / t / te / tStatic / rt with the name alone). A bundle whose code assembles a key with a
  // leading `${…}` keeps the old, generous rule, since its area cannot be read from the source.
  const assemblesUnknownKeys = /\b(?:t|te|tm|tStatic|T)\(\s*`\$\{/.test(text)
  for (const a of areas) {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`['"\`]${esc}\\.`).test(text)) { used.add(a); continue }                  // 'area.key'
    if (new RegExp(`\\b(?:useOptionalT|useOptionalI18n|qualify|tm|t|te|tStatic|rt)\\(\\s*['"\`]${esc}['"\`]`).test(text)) { used.add(a); continue }
    if (assemblesUnknownKeys && new RegExp(`['"\`]${esc}['"\`]`).test(text)) used.add(a)
  }
  return { areas: [...used].filter((a) => areas.includes(a)).sort(), files: files.map((f) => relative(root, f)) }
}
