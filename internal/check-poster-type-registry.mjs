#!/usr/bin/env node
/**
 * check-poster-type-registry.mjs — the poster type registry is ONE per page, whichever bundle's copy asks.
 *
 * Every bundle inlines its own copy of library/components/poster/posterTypes.js, and <dxm-poster-section> is
 * defined by whichever bundle loads first. A module-level registry made that element see only its own bundle's
 * types: a type another bundle registered rendered "none". So the registry is page-global (globalThis).
 *
 * ASSERTS, with TWO independent copies of the module loaded side by side (as two bundles are on one page):
 *   A. a type registered through copy B is found through copy A (the copy that defined the element);
 *   B. the built-in 'country' is listed by both copies, once;
 *   C. a name registered twice keeps the FIRST registration (the second returns false);
 *   D. every registration is announced on window ('dxm-poster-type-registered', { name }), so a section that asked
 *      before its type arrived can render when it does;
 *   E. PosterSectionView.vue re-resolves its type on that event.
 * `--self-test`: the per-bundle (module-level Map) registry must FAIL arm A.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'library/components/poster/posterTypes.js')
const VIEW = join(ROOT, 'library/components/poster/PosterSectionView.vue')

// A stand-in window that records the announcements.
const events = []
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true } }
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail } }

async function copies(source) {
  // Two copies = two module instances (as two IIFE bundles each inline one). Written to a scratch dir with a stub
  // for the lazily imported country adapter, so nothing else loads.
  const dir = mkdtempSync(join(tmpdir(), 'dxm-pt-'))
  mkdirSync(join(dir, 'types'))
  writeFileSync(join(dir, 'types', 'countryPosterType.js'), 'export default { items: () => [], title: () => "", actions: () => ({}) }\n')
  const code = source.replace(/import\.meta\.env\s*&&\s*import\.meta\.env\.DEV/g, 'false')
  writeFileSync(join(dir, 'a.mjs'), code); writeFileSync(join(dir, 'b.mjs'), code)
  const a = await import(pathToFileURL(join(dir, 'a.mjs')).href)
  const b = await import(pathToFileURL(join(dir, 'b.mjs')).href)
  return { a, b, done: () => rmSync(dir, { recursive: true, force: true }) }
}

async function audit(source, viewSrc) {
  const fails = []
  for (const k of Object.getOwnPropertyNames(globalThis)) if (k === '__DXM_POSTER_TYPES__') delete globalThis[k]
  events.length = 0
  const { a, b, done } = await copies(source)
  try {
    const fixture = { items: () => [{ id: 'x' }], title: () => 'X', actions: () => ({}) }
    b.registerPosterType('gate-b-type', fixture)
    if (!(await a.posterType('gate-b-type'))) fails.push('A: a type registered through one bundle\'s copy is NOT found through another\'s (a per-bundle registry)')
    const na = a.posterTypeNames(), nb = b.posterTypeNames()
    if (na.filter((n) => n === 'country').length !== 1 || nb.filter((n) => n === 'country').length !== 1) fails.push(`B: 'country' is not listed exactly once by each copy (${na.join(',')} | ${nb.join(',')})`)
    const second = a.registerPosterType('gate-b-type', { items: () => [], title: () => 'Y', actions: () => ({}) })
    const kept = await b.posterType('gate-b-type')
    if (second !== false || !kept || kept.title() !== 'X') fails.push('C: a name registered twice did not keep the FIRST registration')
    if (!events.some((e) => e.type === 'dxm-poster-type-registered' && e.detail && e.detail.name === 'gate-b-type')) fails.push('D: a registration is not announced on window (dxm-poster-type-registered)')
  } finally { done() }
  if (!/dxm-poster-type-registered|TYPE_REGISTERED_EVENT/.test(viewSrc)) fails.push('E: PosterSectionView.vue does not re-resolve its type when one is registered later')
  return fails
}

if (process.argv.includes('--self-test')) {
  // The per-bundle registry this gate exists to stop: a module-level Map.
  const perBundle = `const LOADERS = new Map([['country', () => import('./types/countryPosterType.js')]])
const CACHE = new Map()
export function registerPosterType(name, a) { LOADERS.set(name, typeof a === 'function' ? a : () => Promise.resolve({ default: a })); CACHE.delete(name); return true }
export function posterType(name) { if (!LOADERS.has(name)) return Promise.resolve(null); if (!CACHE.has(name)) CACHE.set(name, LOADERS.get(name)().then((m) => m.default || m)); return CACHE.get(name) }
export const posterTypeNames = () => [...LOADERS.keys()]
`
  const f = await audit(perBundle, readFileSync(VIEW, 'utf8'))
  const ok = f.some((x) => x.startsWith('A:'))
  console.log(ok ? `✓ caught: a per-bundle registry -> ${f.find((x) => x.startsWith('A:'))}` : '✗ MISSED: the per-bundle registry passed arm A')
  process.exitCode = ok ? 0 : 1
} else {
  const f = await audit(readFileSync(SRC, 'utf8'), readFileSync(VIEW, 'utf8'))
  if (f.length) { for (const x of f) console.log('✗ ' + x); console.log(`FAIL check:poster-type-registry (${f.length})`); process.exitCode = 1 }
  else console.log('PASS check:poster-type-registry — one registry per page: a type registered through one bundle\'s copy is found through another\'s; the first registration wins; registrations are announced and the section re-resolves')
}
